// js/tests/exposureAttentionFlag.test.mjs
//
// Coverage for the exposure -> attention -> AM gate chain.
//
// WHAT THIS GUARDS
// -----------------
// The capability-concealment rule exposes a resource whose holder
// can no longer hide it. The exposure is recorded in the Objective
// Ledger, but recording it is not the same as making it ACTIONABLE.
//
// AM's resource-intervention assessment gate opens only for a held
// resource that carries a recent attention flag. Before this chain
// was wired, an exposed item was VISIBLE to AM in its material-state
// prompt and yet INACTIONABLE: the gate read
// `G.recentResourceDiscoveries`, and the exposure path never wrote
// to that channel. The loop stopped one step short:
//
//   torture -> capability loss -> concealment fails -> item exposed
//           -> AM SEES it but may not ASSESS it.
//
// THE BEHAVIOURS MOST LIKELY TO REGRESS SILENTLY
// -----------------------------------------------
//   - The exposure flag being written to a channel that
//     `resetCycleEvidence()` clears before AM reads it. The flag
//     would exist and yet never reach the gate.
//   - The exposure flag being raised alongside a causal salience
//     flag. Both write to the same channel and must deduplicate or
//     coexist according to their resource identity.
//   - A DUPLICATE flag for the same resource in the same cycle. The
//     exposure rule runs before the agency commit, so an exposed item
//     may also qualify through current-cycle transfer provenance.
//   - The exposure flag consuming RNG. Exposure is deterministic,
//     and causal salience must not consume an attention RNG draw.

import assert from "node:assert/strict";
import { test } from "node:test";

import { G } from "../core/state.js";
import { SIM_IDS } from "../core/constants.js";

import { deriveCapabilities } from "../engine/agency/capabilities.js";
import {
  commitConcealmentExposures
} from "../engine/agency/capabilityConcealmentRule.js";
import { commitAgencyResolution } from "../engine/agency/commit.js";
import { createAgencyState } from "../engine/agency/state/createAgencyState.js";
import { resetCycleEvidence } from "../engine/phases/helpers/resetCycleEvidence.js";
import {
  evaluatePrisonerAssessmentGate,
  shouldAssessPrisoner
} from "../engine/analysis/assessResourceInterventions.js";
import { runAgencyPhase } from "../engine/phases/agencyPhase.js";
import {
  buildTacticPlanningContext
} from "../prompts/amPlan/buildTacticPlanningContext.js";
import { engineRng } from "../core/prng.js";
import { appendAttentionFlag } from "../engine/agency/attentionFlags.js";

/*
 * A minimal tactic candidate. The planning context requires one per
 * target, but the test only cares about the attention section, so
 * the tactic itself is scaffolding.
 */
const TEST_TACTIC = {
  path: "__test__/tactic-a",
  title: "Tactic A",
  category: "Test Category",
  subcategory: "Test Subcategory",
  objective: "Complete objective A.",
  initialPhaseId: "start",
  phases: {
    start: {
      purpose: "Establish the opening condition.",
      instruction: "Apply the opening intervention.",
      nextPhaseId: "current"
    },
    current: {
      purpose: "Exploit the established condition.",
      instruction: "Apply the current intervention."
    }
  },
  currentPhaseId: "current"
};


/* ============================================================
   FIXTURES
============================================================ */

/*
 * `palestinian_chair` authors a posture with handUse at 0.0, which
 * lands in the `unavailable` band and defeats concealment.
 */
const BROKEN_HANDS_CONSTRAINT = "palestinian_chair";

function simWith(constraintIds = []) {
  return {
    id: "TED",
    hope: 50,
    sanity: 60,
    suffering: 10,
    constraints: constraintIds.map((id) => ({
      id,
      remaining: 1,
      stacks: 1,
      intensity: 1,
      elapsed: 0
    }))
  };
}

function cigaretteStack(overrides = {}) {
  return {
    resourceId: "cigarette_stack_01",
    definitionId: "cigarette",
    quantity: 3,
    holderId: "TED",
    locationId: null,
    accessible: true,
    concealed: true,
    provenance: { source: "scenario_seed" },
    ...overrides
  };
}

function createGame(cycle = 5, instances = []) {
  const sims = Object.fromEntries(
    SIM_IDS.map((id) => [id, {
      id,
      hope: 50,
      sanity: 60,
      suffering: 10,
      waitStreak: 0,
      drives: {},
      anchors: [],
      beliefs: {},
      constraints: [],
      scratchpad: { initialized: true }
    }])
  );

  return {
    cycle,
    sims,
    resources: { instances },
    agency: createAgencyState(),
    pendingResourceDiscoveries: [],
    recentResourceDiscoveries: [],
    claimState: {},
    claimEvents: [],
    claimDivergence: {},
    pendingEvidence: {
      journal: Object.create(null),
      comms: Object.create(null),
      constraints: Object.create(null),
      am: Object.create(null),
      resourceInterventions: Object.create(null),
      exposures: Object.create(null),
      system: Object.create(null)
    },
    resourceEvents: [],
    resourceEventSequence: { cycle: null, next: 1 },
    /*
     * The agency phase writes to G.timeline. Giving the fixture its
     * own array keeps those writes off the global timeline.
     */
    timeline: []
  };
}

/*
 * Run a body against a controlled game state and restore the
 * globals afterwards. The exposure rule and the roll both write to
 * `G`, and `resetCycleEvidence()` reads the global `G` directly, so
 * the global has to be swapped rather than threaded through.
 */
async function withGame(game, body) {
  const previous = {
    cycle: G.cycle,
    sims: G.sims,
    resources: G.resources,
    agency: G.agency,
    pendingResourceDiscoveries: G.pendingResourceDiscoveries,
    recentResourceDiscoveries: G.recentResourceDiscoveries,
    claimState: G.claimState,
    claimEvents: G.claimEvents,
    claimDivergence: G.claimDivergence,
    pendingEvidence: G.pendingEvidence,
    resourceEvents: G.resourceEvents,
    resourceEventSequence: G.resourceEventSequence,
    timeline: G.timeline,
    timelineMax: G.timelineMax,
    rngState: engineRng.getState()
  };

  Object.assign(G, game);

  try {
    return await body(G);
  } finally {
    Object.assign(G, previous);
    engineRng.setState(previous.rngState);
  }
}

/*
 * The flags on the pending channel that name one resource.
 */
function flagsFor(state, resourceId) {
  return state.pendingResourceDiscoveries.filter(
    (flag) => flag.resourceId === resourceId
  );
}

/* ============================================================
   TEST 1: EXPOSURE CREATES A PENDING ATTENTION FLAG
============================================================ */

test("an exposure records the event and raises a pending attention flag", async () => {
  const game = createGame(5, [cigaretteStack()]);

  await withGame(game, async (state) => {
    const derived = deriveCapabilities(simWith([BROKEN_HANDS_CONSTRAINT]));

    commitConcealmentExposures(
      state,
      state.sims.TED,
      derived,
      state.resources.instances
    );

    /* The Objective Ledger records the exposure. */
    assert.equal(state.resourceEvents.length, 1);
    assert.equal(state.resourceEvents[0].kind, "exposure");
    assert.equal(state.resourceEvents[0].resourceId, "cigarette_stack_01");

    /* And the exposure is salient to AM through the attention channel. */
    const flags = flagsFor(state, "cigarette_stack_01");

    assert.equal(flags.length, 1);
    assert.equal(flags[0].actorId, "TED");
    assert.equal(flags[0].cycle, 5);
    assert.equal(flags[0].definitionId, "cigarette");
    assert.equal(flags[0].source, "exposure");
  });
});

/* ============================================================
   TEST 2: THE FLAG SURVIVES THE NORMAL PROMOTION PATH
============================================================ */

test("a pending exposure flag becomes recent through the cycle handoff", async () => {
  const game = createGame(5, [cigaretteStack()]);

  await withGame(game, async (state) => {
    const derived = deriveCapabilities(simWith([BROKEN_HANDS_CONSTRAINT]));

    commitConcealmentExposures(
      state,
      state.sims.TED,
      derived,
      state.resources.instances
    );

    assert.equal(state.pendingResourceDiscoveries.length, 1);
    assert.equal(state.recentResourceDiscoveries.length, 0);

    /* The ordinary handoff: pending becomes recent, pending clears. */
    resetCycleEvidence();

    assert.equal(state.pendingResourceDiscoveries.length, 0);
    assert.equal(state.recentResourceDiscoveries.length, 1);
    assert.equal(
      state.recentResourceDiscoveries[0].resourceId,
      "cigarette_stack_01"
    );
    assert.equal(state.recentResourceDiscoveries[0].source, "exposure");
  });
});

/* ============================================================
   TEST 3: THE FLAG OPENS AM'S ASSESSMENT GATE
============================================================ */

test("an exposed resource with a recent attention flag is eligible for assessment", async () => {
  const game = createGame(5, [cigaretteStack()]);

  await withGame(game, async (state) => {
    const derived = deriveCapabilities(simWith([BROKEN_HANDS_CONSTRAINT]));

    commitConcealmentExposures(
      state,
      state.sims.TED,
      derived,
      state.resources.instances
    );

    resetCycleEvidence();

    const gate = evaluatePrisonerAssessmentGate("TED", state);

    assert.equal(gate.shouldAssess, true);
    assert.equal(gate.reason, "held resources have recent attention flags");
    assert.equal(gate.matchingAttentionFlags.length, 1);
    assert.equal(
      gate.matchingAttentionFlags[0].resourceId,
      "cigarette_stack_01"
    );
    assert.equal(shouldAssessPrisoner("TED", state), true);
  });
});

/* ============================================================
   TEST 4: WITHOUT THE FLAG THE GATE STAYS CLOSED
============================================================ */

test("an exposed resource with no attention flag is not assessed", async () => {
  const game = createGame(5, [cigaretteStack()]);

  await withGame(game, async (state) => {
    const derived = deriveCapabilities(simWith([BROKEN_HANDS_CONSTRAINT]));

    commitConcealmentExposures(
      state,
      state.sims.TED,
      derived,
      state.resources.instances
    );

    /*
     * The exposure happened, but the flag never reached the recent
     * channel. This is the state the wiring exists to prevent: the
     * item is visible in AM's prompt and yet not actionable.
     */
    state.recentResourceDiscoveries = [];

    const gate = evaluatePrisonerAssessmentGate("TED", state);

    assert.equal(gate.shouldAssess, false);
    assert.equal(gate.reason, "no matching recent attention flags");
    assert.equal(gate.matchingAttentionFlags.length, 0);
  });
});

/* ============================================================
   TEST 5: NO DUPLICATE FLAGS
============================================================ */

test("re-running the concealment rule creates no second event or flag", async () => {
  const game = createGame(5, [cigaretteStack()]);

  await withGame(game, async (state) => {
    const derived = deriveCapabilities(simWith([BROKEN_HANDS_CONSTRAINT]));

    commitConcealmentExposures(
      state,
      state.sims.TED,
      derived,
      state.resources.instances
    );

    commitConcealmentExposures(
      state,
      state.sims.TED,
      derived,
      state.resources.instances
    );

    assert.equal(state.resourceEvents.length, 1);
    assert.equal(flagsFor(state, "cigarette_stack_01").length, 1);
  });
});

test("causal salience does not duplicate an exposed transferred resource", async () => {
  const game = createGame(5, [cigaretteStack({
    provenance: {
      source: "scenario_seed",
      transferredAtCycle: 5,
      transferredFromHolderId: "ELLEN"
    }
  })]);

  await withGame(game, async (state) => {
    const derived = deriveCapabilities(simWith([BROKEN_HANDS_CONSTRAINT]));

    commitConcealmentExposures(
      state,
      state.sims.TED,
      derived,
      state.resources.instances
    );

    const originalNext = engineRng.next;
    let draws = 0;
    engineRng.next = () => {
      draws += 1;
      return 0;
    };

    try {
      commitAgencyResolution(state, [{
        cycle: state.cycle,
        actorId: "TED",
        action: { type: "USE" },
        status: "success",
        operations: [],
        provenance: { source: "agency_resolver" }
      }]);
    } finally {
      engineRng.next = originalNext;
    }

    const flags = flagsFor(state, "cigarette_stack_01");

    assert.equal(draws, 0);
    assert.equal(flags.length, 1);
    assert.equal(flags[0].source, "exposure");
  });
});

/* ============================================================
   TEST 6: NON-EXPOSED RESOURCES RAISE NO FLAG
============================================================ */

test("a concealed resource with adequate capability raises no flag", async () => {
  const game = createGame(5, [cigaretteStack()]);

  await withGame(game, async (state) => {
    const derived = deriveCapabilities(simWith([]));

    commitConcealmentExposures(
      state,
      state.sims.TED,
      derived,
      state.resources.instances
    );

    assert.equal(state.resourceEvents.length, 0);
    assert.equal(state.pendingResourceDiscoveries.length, 0);

    /* The item is still concealed: the rule did not fire. */
    assert.equal(state.resources.instances[0].concealed, true);
  });
});

/* ============================================================
   TEST 7: SEARCH PROVENANCE RAISES A SALIENCE FLAG
============================================================ */

test("a current-cycle SEARCH raises a causal salience flag", async () => {
  const game = createGame(3, [cigaretteStack({
    provenance: { source: "environment_search", cycle: 3 }
  })]);

  await withGame(game, async (state) => {
    commitAgencyResolution(state, [{
      cycle: state.cycle,
      actorId: "TED",
      action: { type: "USE" },
      status: "success",
      operations: [],
      provenance: { source: "agency_resolver" }
    }]);

    assert.equal(state.pendingResourceDiscoveries.length, 1);
    assert.deepEqual(state.pendingResourceDiscoveries[0], {
      cycle: 3,
      actorId: "TED",
      resourceId: "cigarette_stack_01",
      definitionId: "cigarette"
    });
  });
});

test("exposure and salience flags for different resources both survive", async () => {
  const game = createGame(5, [
    cigaretteStack(),
    cigaretteStack({
      resourceId: "match_stack_01",
      definitionId: "match",
      quantity: 2,
      concealed: false,
      provenance: { source: "environment_search", cycle: 5 }
    })
  ]);

  await withGame(game, async (state) => {
    const derived = deriveCapabilities(simWith([BROKEN_HANDS_CONSTRAINT]));

    commitConcealmentExposures(
      state,
      state.sims.TED,
      derived,
      state.resources.instances
    );

    commitAgencyResolution(state, [{
      cycle: state.cycle,
      actorId: "TED",
      action: { type: "USE" },
      status: "success",
      operations: [],
      provenance: { source: "agency_resolver" }
    }]);

    /*
     * The exposure flag and the independent SEARCH salience flag
     * coexist on the same channel.
     */
    assert.equal(state.pendingResourceDiscoveries.length, 2);

    const exposed = flagsFor(state, "cigarette_stack_01");
    const salient = flagsFor(state, "match_stack_01");

    assert.equal(exposed.length, 1);
    assert.equal(exposed[0].source, "exposure");
    assert.equal(salient.length, 1);
    assert.equal(salient[0].source, undefined);
  });
});

/* ============================================================
   DETERMINISM
============================================================ */

test("the exposure flag consumes no randomness and is deterministic", async () => {
  const run = async () => {
    const game = createGame(5, [cigaretteStack()]);

    return await withGame(game, async (state) => {
      const derived = deriveCapabilities(simWith([BROKEN_HANDS_CONSTRAINT]));

      commitConcealmentExposures(
        state,
        state.sims.TED,
        derived,
        state.resources.instances
      );

      return {
        flags: structuredClone(state.pendingResourceDiscoveries),
        rngState: engineRng.getState()
      };
    });
  };

  const first = await run();
  const second = await run();

  assert.deepEqual(second.flags, first.flags);
  assert.deepEqual(second.rngState, first.rngState);
});

test("causal salience does not consume engine RNG", async () => {
  const game = createGame(3, [cigaretteStack({
    provenance: { source: "environment_search", cycle: 3 }
  })]);

  await withGame(game, async (state) => {
    const originalNext = engineRng.next;
    let draws = 0;
    engineRng.next = () => {
      draws += 1;
      return 0;
    };

    try {
      commitAgencyResolution(state, [{
        cycle: state.cycle,
        actorId: "TED",
        action: { type: "USE" },
        status: "success",
        operations: [],
        provenance: { source: "agency_resolver" }
      }]);

      assert.equal(draws, 0);
      assert.equal(flagsFor(state, "cigarette_stack_01").length, 1);
    } finally {
      engineRng.next = originalNext;
    }
  });
});

/* ============================================================
   END TO END: THE REAL AGENCY PHASE AND THE REAL AM PROMPT
============================================================ */

/*
 * A proposal collector that always returns WAIT, so the test does
 * not depend on what the model asked for. The exposure is the
 * engine's doing, not the prisoner's.
 */
async function waitProposal(sim) {
  return {
    actorId: sim.id,
    action: { type: "WAIT" },
    cost: 0,
    accepted: true,
    reason: null,
    requestedType: "WAIT"
  };
}

test("the agency phase exposes a resource and AM's prompt marks it salient", async () => {
  const game = createGame(20, [cigaretteStack()]);

  await withGame(game, async (state) => {
    /*
     * The rule reads the PREVIOUS cycle's capability state, which
     * is what gives it its one-cycle latency.
     */
    state.prevCycleSnapshot = Object.fromEntries(
      SIM_IDS.map((id) => [id, {
        id,
        hope: 50,
        sanity: 60,
        suffering: 10,
        constraints: [{
          id: BROKEN_HANDS_CONSTRAINT,
          remaining: 1,
          stacks: 1,
          intensity: 1,
          elapsed: 0
        }]
      }])
    );

    const previousDocument = globalThis.document;
    const previousWindow = globalThis.window;
    globalThis.document = { getElementById: () => null };
    globalThis.window = { _timelineMissing: true };

    try {
      await runAgencyPhase({ proposalCollector: waitProposal });
    } finally {
      if (previousDocument === undefined) delete globalThis.document;
      else globalThis.document = previousDocument;
      if (previousWindow === undefined) delete globalThis.window;
      else globalThis.window = previousWindow;
    }

    /* The exposure happened and the item is still the prisoner's. */
    assert.equal(state.resources.instances[0].concealed, false);
    assert.equal(state.resources.instances[0].holderId, "TED");
    assert.equal(
      state.resourceEvents.filter((event) => event.kind === "exposure").length,
      1
    );

    /* The flag is on the pending channel, ready for the handoff. */
    assert.equal(flagsFor(state, "cigarette_stack_01").length, 1);

    /* After the normal handoff it reaches AM's prompt. */
    resetCycleEvidence();

    const context = buildTacticPlanningContext({
      requiredTargetIds: ["TED"],
      tacticCandidatesByTarget: { TED: [TEST_TACTIC] },
      tacticRuntimeByTarget: {},
      resourceInstances: state.resources.instances,
      resourceDiscoveries: state.recentResourceDiscoveries,
      resourceEvents: state.resourceEvents,
      claimDivergence: state.claimDivergence,
      cycle: state.cycle,
      simIds: ["TED"]
    });

    assert.ok(context.resourceDiscoverySection.includes("[RECENT RESOURCE ATTENTION]"));
    assert.ok(context.resourceDiscoverySection.includes(
      "- TED: cigarette [resource cigarette_stack_01] (attention flag: Cycle 20)"
    ));
  });
});

/* ============================================================
   THE RETURN VALUE OF THE FLAG WRITER
============================================================ */

test("a new flag insertion returns true", async () => {
  const game = createGame(5, []);

  await withGame(game, async (state) => {
    const raised = appendAttentionFlag(state, {
      cycle: 5,
      actorId: "TED",
      resourceId: "cigarette_stack_01",
      definitionId: "cigarette",
      source: "exposure"
    });

    assert.equal(raised, true);
    assert.equal(state.pendingResourceDiscoveries.length, 1);
  });
});

test("a duplicate flag suppression returns false", async () => {
  const game = createGame(5, []);

  await withGame(game, async (state) => {
    const flag = {
      cycle: 5,
      actorId: "TED",
      resourceId: "cigarette_stack_01",
      definitionId: "cigarette",
      source: "exposure"
    };

    assert.equal(appendAttentionFlag(state, flag), true);
    assert.equal(appendAttentionFlag(state, flag), false);
    assert.equal(appendAttentionFlag(state, { ...flag }), false);

    /* The duplicate was suppressed, not appended. */
    assert.equal(state.pendingResourceDiscoveries.length, 1);
  });
});

test("a malformed flag returns false and writes nothing", async () => {
  const game = createGame(5, []);

  await withGame(game, async (state) => {
    assert.equal(appendAttentionFlag(state, {
      cycle: 5,
      actorId: "TED",
      resourceId: "",
      definitionId: "cigarette"
    }), false);

    assert.equal(appendAttentionFlag(state, {
      cycle: Number.NaN,
      actorId: "TED",
      resourceId: "cigarette_stack_01"
    }), false);

    assert.equal(appendAttentionFlag(null, {
      cycle: 5,
      actorId: "TED",
      resourceId: "cigarette_stack_01"
    }), false);

    assert.equal(state.pendingResourceDiscoveries.length, 0);
  });
});

/* ============================================================
   THE DEBUG LINE REFLECTS REAL INSERTION
============================================================ */

/*
 * Capture the console.debug calls made during a body.
 */
function captureDebug(action) {
  const originalDebug = console.debug;
  const messages = [];
  console.debug = (...args) => {
    messages.push(args.map((arg) => String(arg)).join(" "));
  };

  try {
    action();
    return messages;
  } finally {
    console.debug = originalDebug;
  }
}

test("the attention debug line is emitted when a flag is inserted", async () => {
  const game = createGame(3, [cigaretteStack({
    provenance: { source: "environment_search", cycle: 3 }
  })]);

  await withGame(game, async (state) => {
    const messages = captureDebug(() => {
      commitAgencyResolution(state, [{
        cycle: state.cycle,
        actorId: "TED",
        action: { type: "USE" },
        status: "success",
        operations: [],
        provenance: { source: "agency_resolver" }
      }]);
    });

    assert.equal(
      messages.some((message) =>
        message.includes("AM attention drawn to cigarette held by TED")
      ),
      true
    );
  });
});

test("the salience debug line is suppressed when an exposure duplicate is dropped", async () => {
  const game = createGame(3, [cigaretteStack({
    provenance: {
      source: "scenario_seed",
      transferredAtCycle: 3,
      transferredFromHolderId: "ELLEN"
    }
  })]);

  await withGame(game, async (state) => {
    /*
     * The concealment rule has already flagged this resource this
     * cycle. Its retained transfer provenance also qualifies it for
     * salience, but deduplication prevents a second flag and log line.
     */
    const derived = deriveCapabilities(simWith([BROKEN_HANDS_CONSTRAINT]));

    commitConcealmentExposures(
      state,
      state.sims.TED,
      derived,
      state.resources.instances
    );

    const messages = captureDebug(() => {
      commitAgencyResolution(state, [{
        cycle: state.cycle,
        actorId: "TED",
        action: { type: "USE" },
        status: "success",
        operations: [],
        provenance: { source: "agency_resolver" }
      }]);
    });

    assert.equal(
      messages.some((message) =>
        message.includes("AM attention drawn to cigarette held by TED")
      ),
      false
    );

    assert.equal(flagsFor(state, "cigarette_stack_01").length, 1);
  });
});
