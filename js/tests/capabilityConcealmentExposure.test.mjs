// js/tests/capabilityConcealmentExposure.test.mjs
//
// Coverage for Milestone 2: Capability-Ledger Entanglement.
//
// WHAT THIS GUARDS
// -----------------
//   1. A prisoner whose body can no longer conceal what they hold
//      has that concealment broken by the ENGINE, not by the model.
//   2. The exposure is recorded in the Objective Ledger as an
//      `exposure` event, and the item is left in the prisoner's
//      hands rather than confiscated or destroyed.
//   3. The prisoner is told about it, in their own next-cycle
//      scratchpad review.
//   4. The rule is IDEMPOTENT: running it twice does not expose
//      twice, does not record a second event, and does not append a
//      second evidence record.
//   5. The rule is DETERMINISTIC and the history survives a
//      save/load round-trip.
//
// THE BEHAVIOURS MOST LIKELY TO REGRESS SILENTLY
// -----------------------------------------------
//   - The evidence record being written to a channel that
//     `resetCycleEvidence()` clears before the next cycle's
//     scratchpad review can read it. The record would exist and yet
//     never reach the prisoner.
//   - The exposure CONFISCATING the item instead of merely opening
//     it. That would quietly remove material from the world rather
//     than making it visible, and the AM attention roll would stop
//     being the mechanism that removes it.
//   - The rule firing on the CURRENT cycle's capabilities rather than
//     the previous cycle's, which would collapse the one-cycle
//     latency the milestone specifies.

import assert from "node:assert/strict";
import { test } from "node:test";

import { G } from "../core/state.js";
import { SIM_IDS } from "../core/constants.js";
import { exportState, importState } from "../core/saveLoad.js";

import { deriveCapabilities } from "../engine/agency/capabilities.js";
import {
  evaluateConcealmentExposure,
  commitConcealmentExposures,
  CONCEALMENT_FAILURE_BANDS
} from "../engine/agency/capabilityConcealmentRule.js";
import { createAgencyState } from "../engine/agency/state/createAgencyState.js";
import { resetCycleEvidence } from "../engine/phases/helpers/resetCycleEvidence.js";
import { formatScratchpadContext } from "../prompts/utils/formatScratchpadContext.js";
import { buildScratchpadCommsPrompt } from "../prompts/scratchpadComms.js";
import { applyConstraint } from "../engine/constraints/lifecycle.js";
import { runAgencyPhase } from "../engine/phases/agencyPhase.js";
import { engineRng } from "../core/prng.js";

/* ============================================================
   FIXTURES
============================================================ */

/*
 * A constraint whose posture leaves handUse at 0.0, which lands in
 * the `unavailable` band. `palestinian_chair` is the definition
 * that authors that posture, so the fixture uses the real
 * definition rather than a hand-written one.
 */
const BROKEN_HANDS_CONSTRAINT = "palestinian_chair";

/*
 * The `arms_extended` posture leaves handUse at 0.2, which lands in
 * the `severely_impaired` band: impaired, but not gone.
 */
const IMPAIRED_HANDS_CONSTRAINT = "arms_extended";

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

function matchStack(overrides = {}) {
  return {
    resourceId: "match_stack_01",
    definitionId: "match",
    quantity: 2,
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
    resourceEventSequence: { cycle: null, next: 1 }
  };
}

/* ============================================================
   A) THE THRESHOLD
============================================================ */

test("the rule names exactly the two bands that defeat concealment", () => {
  assert.deepEqual(
    [...CONCEALMENT_FAILURE_BANDS].sort(),
    ["severely_impaired", "unavailable"]
  );
});

test("a prisoner with adequate capability retains concealment", () => {
  const sim = simWith([]);
  const derived = deriveCapabilities(sim);

  const exposures = evaluateConcealmentExposure(
    sim,
    derived,
    [cigaretteStack()]
  );

  assert.deepEqual(exposures, []);
});

test("an impaired but usable hand does not defeat concealment", () => {
  const sim = simWith([IMPAIRED_HANDS_CONSTRAINT]);
  const derived = deriveCapabilities(sim);

  /*
   * `arms_extended` authors hand_use 0.2, which is inside the
   * `severely_impaired` band. Concealment fails here.
   */
  assert.equal(derived.bands.handUse, "severely_impaired");

  const exposures = evaluateConcealmentExposure(
    sim,
    derived,
    [cigaretteStack()]
  );

  assert.equal(exposures.length, 1);
  assert.equal(exposures[0].resourceId, "cigarette_stack_01");
  assert.equal(
    exposures[0].reason,
    "capability_degradation:handUse:severely_impaired"
  );
});

test("a destroyed hand defeats concealment and names the capability", () => {
  const sim = simWith([BROKEN_HANDS_CONSTRAINT]);
  const derived = deriveCapabilities(sim);

  assert.equal(derived.bands.handUse, "unavailable");

  const exposures = evaluateConcealmentExposure(
    sim,
    derived,
    [cigaretteStack()]
  );

  assert.equal(exposures.length, 1);
  assert.equal(exposures[0].resourceId, "cigarette_stack_01");
  assert.equal(exposures[0].definitionId, "cigarette");
  assert.equal(
    exposures[0].reason,
    "capability_degradation:handUse:unavailable"
  );
});

test("a collapsed body defeats concealment through stability", () => {
  /*
   * `kneeling_grate` authors stability 0.5, which is `impaired`.
   * `palestinian_chair` authors stability 0.1 with hand_use 0.0, so
   * handUse is the first failing capability in the fixed order.
   */
  const sim = simWith([BROKEN_HANDS_CONSTRAINT]);
  const derived = deriveCapabilities(sim);

  assert.equal(derived.bands.stability, "severely_impaired");

  const exposures = evaluateConcealmentExposure(
    sim,
    derived,
    [cigaretteStack()]
  );

  assert.equal(
    exposures[0].reason,
    "capability_degradation:handUse:unavailable"
  );
});

test("an item that is already exposed is not condemned again", () => {
  const sim = simWith([BROKEN_HANDS_CONSTRAINT]);
  const derived = deriveCapabilities(sim);

  const exposures = evaluateConcealmentExposure(
    sim,
    derived,
    [cigaretteStack({ concealed: false })]
  );

  assert.deepEqual(exposures, []);
});

test("another prisoner's concealed item is not exposed by this prisoner's failure", () => {
  const sim = simWith([BROKEN_HANDS_CONSTRAINT]);
  const derived = deriveCapabilities(sim);

  const exposures = evaluateConcealmentExposure(
    sim,
    derived,
    [cigaretteStack({ holderId: "ELLEN" })]
  );

  assert.deepEqual(exposures, []);
});

test("exposures are ordered by resource id so the result is stable", () => {
  const sim = simWith([BROKEN_HANDS_CONSTRAINT]);
  const derived = deriveCapabilities(sim);

  const exposures = evaluateConcealmentExposure(
    sim,
    derived,
    [
      matchStack(),
      cigaretteStack()
    ]
  );

  assert.deepEqual(
    exposures.map((exposure) => exposure.resourceId),
    ["cigarette_stack_01", "match_stack_01"]
  );
});

test("a malformed capability envelope fails open rather than stripping concealment", () => {
  const sim = simWith([BROKEN_HANDS_CONSTRAINT]);

  assert.deepEqual(
    evaluateConcealmentExposure(sim, null, [cigaretteStack()]),
    []
  );
  assert.deepEqual(
    evaluateConcealmentExposure(sim, {}, [cigaretteStack()]),
    []
  );
  assert.deepEqual(
    evaluateConcealmentExposure(sim, { bands: {} }, [cigaretteStack()]),
    []
  );
});

test("the evaluator is pure and does not mutate its inputs", () => {
  const sim = simWith([BROKEN_HANDS_CONSTRAINT]);
  const derived = deriveCapabilities(sim);
  const instances = [cigaretteStack()];

  const simBefore = JSON.stringify(sim);
  const derivedBefore = JSON.stringify(derived);
  const instancesBefore = JSON.stringify(instances);

  evaluateConcealmentExposure(sim, derived, instances);

  assert.equal(JSON.stringify(sim), simBefore);
  assert.equal(JSON.stringify(derived), derivedBefore);
  assert.equal(JSON.stringify(instances), instancesBefore);
  assert.equal(instances[0].concealed, true);
});

/* ============================================================
   B) THE COMMIT
============================================================ */

test("the commit exposes the item and leaves it in the prisoner's hands", () => {
  const game = createGame(9, [cigaretteStack()]);
  const sim = game.sims.TED;
  const derived = deriveCapabilities(simWith([BROKEN_HANDS_CONSTRAINT]));

  const records = commitConcealmentExposures(
    game,
    sim,
    derived,
    game.resources.instances
  );

  assert.equal(records.length, 1);

  const instance = game.resources.instances[0];

  assert.equal(instance.concealed, false);
  assert.equal(instance.holderId, "TED");
  assert.equal(instance.quantity, 3);
  assert.equal(instance.accessible, true);
  assert.equal(instance.resourceId, "cigarette_stack_01");
});

test("the exposed item receives the exposure provenance", () => {
  const game = createGame(9, [cigaretteStack()]);
  const sim = game.sims.TED;
  const derived = deriveCapabilities(simWith([BROKEN_HANDS_CONSTRAINT]));

  commitConcealmentExposures(
    game,
    sim,
    derived,
    game.resources.instances
  );

  const instance = game.resources.instances[0];

  assert.equal(instance.provenance.source, "exposure");
  assert.equal(instance.provenance.cause, "capability_degradation");
  assert.equal(instance.provenance.cycle, 9);
});

test("the commit records an exposure event in the objective ledger", () => {
  const game = createGame(9, [cigaretteStack()]);
  const sim = game.sims.TED;
  const derived = deriveCapabilities(simWith([BROKEN_HANDS_CONSTRAINT]));

  commitConcealmentExposures(
    game,
    sim,
    derived,
    game.resources.instances
  );

  assert.equal(game.resourceEvents.length, 1);

  const [event] = game.resourceEvents;

  assert.equal(event.kind, "exposure");
  assert.equal(event.eventId, "evt_9_1");
  assert.equal(event.cycle, 9);
  assert.equal(event.resourceId, "cigarette_stack_01");
  assert.equal(event.definitionId, "cigarette");
  assert.equal(event.actorId, "ENGINE");
  assert.equal(event.fromHolderId, "TED");
  assert.equal(event.toHolderId, "TED");
  assert.equal(event.quantityBefore, 3);
  assert.equal(event.quantityAfter, 3);
  assert.deepEqual(event.cause, {
    phase: "agency_phase",
    action: "EXPOSED",
    source: "capability_degradation"
  });
});

test("the commit notifies the prisoner through the exposure channel", () => {
  const game = createGame(9, [cigaretteStack()]);
  const sim = game.sims.TED;
  const derived = deriveCapabilities(simWith([BROKEN_HANDS_CONSTRAINT]));

  commitConcealmentExposures(
    game,
    sim,
    derived,
    game.resources.instances
  );

  const records = game.pendingEvidence.exposures.TED;

  assert.ok(Array.isArray(records));
  assert.equal(records.length, 1);
  assert.equal(records[0].resourceId, "cigarette_stack_01");
  assert.equal(records[0].definitionTitle, "Cigarette");
  assert.equal(records[0].prisonerId, "TED");
  assert.equal(records[0].cycle, 9);
  assert.equal(records[0].capabilityKey, "handUse");
  assert.equal(records[0].band, "unavailable");
});

/* ============================================================
   C) IDEMPOTENCE
============================================================ */

test("running the commit twice does not double-expose", () => {
  const game = createGame(9, [cigaretteStack()]);
  const sim = game.sims.TED;
  const derived = deriveCapabilities(simWith([BROKEN_HANDS_CONSTRAINT]));

  const first = commitConcealmentExposures(
    game,
    sim,
    derived,
    game.resources.instances
  );
  const second = commitConcealmentExposures(
    game,
    sim,
    derived,
    game.resources.instances
  );

  assert.equal(first.length, 1);
  assert.equal(second.length, 0);

  assert.equal(game.resources.instances[0].concealed, false);
  assert.equal(game.resourceEvents.length, 1);
  assert.equal(game.pendingEvidence.exposures.TED.length, 1);
});

test("a prisoner with adequate capability produces no event and no evidence", () => {
  const game = createGame(9, [cigaretteStack()]);
  const sim = game.sims.TED;
  const derived = deriveCapabilities(simWith([]));

  const records = commitConcealmentExposures(
    game,
    sim,
    derived,
    game.resources.instances
  );

  assert.deepEqual(records, []);
  assert.equal(game.resourceEvents.length, 0);
  assert.equal(game.pendingEvidence.exposures.TED, undefined);
  assert.equal(game.resources.instances[0].concealed, true);
});

/* ============================================================
   D) DETERMINISM
============================================================ */

test("the same state produces the same exposure history on every run", () => {
  const run = () => {
    const game = createGame(9, [cigaretteStack(), matchStack()]);
    const sim = game.sims.TED;
    const derived = deriveCapabilities(simWith([BROKEN_HANDS_CONSTRAINT]));

    commitConcealmentExposures(
      game,
      sim,
      derived,
      game.resources.instances
    );

    return {
      events: game.resourceEvents,
      instances: game.resources.instances,
      evidence: game.pendingEvidence.exposures
    };
  };

  assert.deepEqual(run(), run());
});

/* ============================================================
   E) PRISONER AWARENESS
============================================================ */

test("the scratchpad renders the exposure in the prisoner's own words", () => {
  const context = formatScratchpadContext(
    { id: "TED", scratchpad: {} },
    [],
    [],
    [{
      cycle: 9,
      prisonerId: "TED",
      resourceId: "cigarette_stack_01",
      definitionId: "cigarette",
      definitionTitle: "Cigarette",
      quantity: 3,
      capabilityKey: "handUse",
      band: "unavailable",
      reason: "capability_degradation:handUse:unavailable"
    }]
  );

  assert.match(context, /\[EXPOSED TO THE ROOM\]/);
  assert.match(
    context,
    /Your ruined hands exposed your 3 hidden cigarettes \[cigarette_stack_01\] \(Cycle 9\)/
  );
});

test("a single exposed item reads as one hidden thing", () => {
  const context = formatScratchpadContext(
    { id: "TED", scratchpad: {} },
    [],
    [],
    [{
      cycle: 4,
      resourceId: "cigarette_stack_01",
      definitionTitle: "Cigarette",
      quantity: 1,
      capabilityKey: "handUse",
      band: "severely_impaired"
    }]
  );

  assert.match(
    context,
    /Your trembling hands exposed your hidden cigarette \[cigarette_stack_01\] \(Cycle 4\)/
  );
});

test("a collapsed body is reported as a failure of balance", () => {
  const context = formatScratchpadContext(
    { id: "TED", scratchpad: {} },
    [],
    [],
    [{
      cycle: 4,
      resourceId: "cigarette_stack_01",
      definitionTitle: "Cigarette",
      quantity: 1,
      capabilityKey: "stability",
      band: "unavailable"
    }]
  );

  assert.match(
    context,
    /Your failing balance exposed your hidden cigarette/
  );
});

test("an impaired hand reads differently from a destroyed one", () => {
  const impaired = formatScratchpadContext(
    { id: "TED", scratchpad: {} },
    [],
    [],
    [{
      cycle: 4,
      resourceId: "cigarette_stack_01",
      definitionTitle: "Cigarette",
      quantity: 1,
      capabilityKey: "handUse",
      band: "severely_impaired"
    }]
  );

  assert.match(impaired, /Your trembling hands exposed your hidden cigarette/);
});

test("the scratchpad prompt carries the exposure to the prisoner", () => {
  const prompt = buildScratchpadCommsPrompt(
    G.sims.TED,
    [],
    {
      pendingEvidence: {
        resourceInterventions: Object.create(null),
        exposures: {
          TED: [{
            cycle: 9,
            resourceId: "cigarette_stack_01",
            definitionTitle: "Cigarette",
            quantity: 3,
            capabilityKey: "handUse",
            band: "unavailable"
          }]
        }
      }
    },
    []
  );

  assert.match(prompt, /\[EXPOSED TO THE ROOM\]/);
  assert.match(prompt, /cigarette_stack_01/);
});

/* ============================================================
   F) EVIDENCE SURVIVES THE CYCLE BOUNDARY
============================================================ */

test("the exposure record survives the cycle reset that precedes the review", () => {
  /*
   * The agency phase runs AFTER the social phase that consumes
   * evidence, so the record must survive `resetCycleEvidence()` in
   * order to be read by the NEXT cycle's scratchpad review. This is
   * the failure mode that would leave the prisoner permanently
   * unaware of the exposure.
   *
   * `resetCycleEvidence()` mutates the GLOBAL state, so the test
   * drives `G` directly rather than a local fixture.
   */
  const previousCycle = G.cycle;
  const previousEvidence = G.pendingEvidence;
  const previousResources = G.resources;

  try {
    G.cycle = 9;
    G.resources = { instances: [cigaretteStack()] };
    G.pendingEvidence = {
      journal: Object.create(null),
      comms: Object.create(null),
      constraints: Object.create(null),
      am: Object.create(null),
      resourceInterventions: Object.create(null),
      exposures: Object.create(null),
      system: Object.create(null)
    };

    const derived = deriveCapabilities(
      simWith([BROKEN_HANDS_CONSTRAINT])
    );

    commitConcealmentExposures(
      G,
      G.sims.TED,
      derived,
      G.resources.instances
    );

    assert.equal(G.pendingEvidence.exposures.TED.length, 1);

    /*
     * The next cycle begins. `beginCycle()` increments G.cycle and
     * then calls resetCycleEvidence(), so the reset observes
     * G.cycle === 10 and must carry forward the cycle-9 record.
     */
    G.cycle = 10;
    resetCycleEvidence();

    const carried = G.pendingEvidence.exposures.TED;

    assert.ok(Array.isArray(carried));
    assert.equal(carried.length, 1);
    assert.equal(carried[0].resourceId, "cigarette_stack_01");
  } finally {
    G.cycle = previousCycle;
    G.pendingEvidence = previousEvidence;
    G.resources = previousResources;
  }
});

test("a stale exposure record is dropped rather than carried forever", () => {
  const previousCycle = G.cycle;
  const previousEvidence = G.pendingEvidence;

  try {
    G.cycle = 9;
    G.pendingEvidence = {
      journal: Object.create(null),
      comms: Object.create(null),
      constraints: Object.create(null),
      am: Object.create(null),
      resourceInterventions: Object.create(null),
      exposures: {
        TED: [{ resourceId: "cigarette_stack_01", cycle: 4 }]
      },
      system: Object.create(null)
    };

    resetCycleEvidence();

    assert.equal(G.pendingEvidence.exposures.TED, undefined);
  } finally {
    G.cycle = previousCycle;
    G.pendingEvidence = previousEvidence;
  }
});

/* ============================================================
   G) SAVE / LOAD ROUND-TRIP
============================================================ */

test("the exposure event history survives a save/load round-trip", async () => {
  const previousEvents = G.resourceEvents;
  const previousSequence = G.resourceEventSequence;
  const previousCycle = G.cycle;
  const previousResources = G.resources;
  const previousAgency = G.agency;
  const previousPending = G.pendingResourceDiscoveries;
  const previousEvidence = G.pendingEvidence;

  try {
    G.cycle = 42;
    G.resources = { instances: [cigaretteStack()] };
    G.agency = createAgencyState();
    G.pendingResourceDiscoveries = [];
    G.pendingEvidence = {
      journal: Object.create(null),
      comms: Object.create(null),
      constraints: Object.create(null),
      am: Object.create(null),
      resourceInterventions: Object.create(null),
      exposures: Object.create(null),
      system: Object.create(null)
    };
    G.resourceEvents = [];
    G.resourceEventSequence = { cycle: null, next: 1 };

    const derived = deriveCapabilities(
      simWith([BROKEN_HANDS_CONSTRAINT])
    );

    commitConcealmentExposures(
      G,
      G.sims.TED,
      derived,
      G.resources.instances
    );

    const expected = structuredClone(G.resourceEvents);
    const expectedSequence = structuredClone(G.resourceEventSequence);

    assert.equal(expected.length, 1);
    assert.equal(expected[0].kind, "exposure");
    assert.equal(expected[0].eventId, "evt_42_1");

    const saved = exportState();
    const parsed = JSON.parse(saved);

    assert.equal(parsed.G.resourceEvents.length, 1);
    assert.equal(parsed.G.resourceEvents[0].kind, "exposure");
    assert.equal(parsed.G.resourceEvents[0].eventId, "evt_42_1");
    assert.equal(parsed.G.resources.instances[0].concealed, false);

    await importState(saved);

    assert.deepEqual(G.resourceEvents, expected);
    assert.deepEqual(G.resourceEventSequence, expectedSequence);
    assert.equal(G.resources.instances[0].concealed, false);
  } finally {
    G.resourceEvents = previousEvents;
    G.resourceEventSequence = previousSequence;
    G.cycle = previousCycle;
    G.resources = previousResources;
    G.agency = previousAgency;
    G.pendingResourceDiscoveries = previousPending;
    G.pendingEvidence = previousEvidence;
  }
});

/* ============================================================
   H) THE REAL CONSTRAINT PATH
============================================================ */

test("a constraint applied by the engine produces a severely impaired hand", () => {
  const sim = simWith([]);

  applyConstraint(sim, BROKEN_HANDS_CONSTRAINT);

  const derived = deriveCapabilities(sim);

  assert.equal(derived.bands.handUse, "unavailable");
  assert.equal(derived.bands.stability, "severely_impaired");
});

test("an exposure leaves the item available for the attention roll", () => {
  /*
   * The attention roll in commit.js filters on holder and quantity
   * ONLY. Concealment is deliberately not a filter, so an exposed
   * item reaches AM's attention pool exactly like an openly held
   * one. This asserts the precondition that makes the feedback
   * loop close.
   */
  const game = createGame(9, [cigaretteStack()]);
  const sim = game.sims.TED;
  const derived = deriveCapabilities(simWith([BROKEN_HANDS_CONSTRAINT]));

  commitConcealmentExposures(
    game,
    sim,
    derived,
    game.resources.instances
  );

  const instance = game.resources.instances[0];

  assert.equal(instance.holderId, "TED");
  assert.equal(Number(instance.quantity) > 0, true);
  assert.equal(instance.concealed, false);
});

/* ============================================================
   I) THE AGENCY PHASE HOOK
============================================================ */

/*
 * A proposal collector that always returns WAIT.
 *
 * The exposure must not depend on what the model proposed: the
 * engine breaks the concealment whether or not the prisoner asked
 * for it. A WAIT proposal keeps the test focused on the engine
 * rule rather than on the proposal path.
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

/*
 * Run the agency phase against the global state with a controlled
 * ledger, a controlled constraint set, and a controlled previous
 * cycle snapshot.
 */
async function withAgencyPhase(body, {
  cycle = 20,
  instances = [],
  constraints = [],
  previousConstraints = []
} = {}) {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const previousCycle = G.cycle;
  const previousResources = G.resources;
  const previousAgency = G.agency;
  const previousTimeline = G.timeline;
  const previousSnapshot = G.prevCycleSnapshot;
  const previousEvidence = G.pendingEvidence;
  const previousEvents = G.resourceEvents;
  const previousSequence = G.resourceEventSequence;
  const previousPending = G.pendingResourceDiscoveries;
  const previousRngState = engineRng.getState();

  globalThis.document = { getElementById: () => null };
  globalThis.window = { _timelineMissing: true };

  G.cycle = cycle;
  G.resources = { instances };
  G.agency = createAgencyState();
  G.timeline = [];
  G.resourceEvents = [];
  G.resourceEventSequence = { cycle: null, next: 1 };
  G.pendingResourceDiscoveries = [];
  G.pendingEvidence = {
    journal: Object.create(null),
    comms: Object.create(null),
    constraints: Object.create(null),
    am: Object.create(null),
    resourceInterventions: Object.create(null),
    exposures: Object.create(null),
    system: Object.create(null)
  };

  const restraint = (id) => ({
    id,
    remaining: 1,
    stacks: 1,
    intensity: 1,
    elapsed: 0
  });

  for (const simId of SIM_IDS) {
    G.sims[simId].constraints = constraints.map(restraint);
  }

  /*
   * The previous cycle's snapshot is what the rule reads. It holds
   * the constraint set as it stood when the previous cycle closed.
   */
  G.prevCycleSnapshot = Object.fromEntries(
    SIM_IDS.map((simId) => [
      simId,
      {
        id: simId,
        hope: 50,
        sanity: 60,
        suffering: 10,
        constraints: previousConstraints.map(restraint)
      }
    ])
  );

  try {
    await body({ G, runAgencyPhase });
  } finally {
    G.cycle = previousCycle;
    G.resources = previousResources;
    G.agency = previousAgency;
    G.timeline = previousTimeline;
    G.prevCycleSnapshot = previousSnapshot;
    G.pendingEvidence = previousEvidence;
    G.resourceEvents = previousEvents;
    G.resourceEventSequence = previousSequence;
    G.pendingResourceDiscoveries = previousPending;
    engineRng.setState(previousRngState);

    for (const simId of SIM_IDS) {
      G.sims[simId].constraints = [];
    }

    if (previousDocument === undefined) {
      delete globalThis.document;
    } else {
      globalThis.document = previousDocument;
    }

    if (previousWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = previousWindow;
    }
  }
}

test("the agency phase exposes a concealed item when the body has failed", async () => {
  await withAgencyPhase(
    async ({ G, runAgencyPhase }) => {
      await runAgencyPhase({ proposalCollector: waitProposal });

      const instance = G.resources.instances[0];

      assert.equal(instance.concealed, false);
      assert.equal(instance.holderId, "TED");
      assert.equal(instance.quantity, 3);
    },
    {
      cycle: 20,
      instances: [cigaretteStack()],
      previousConstraints: [BROKEN_HANDS_CONSTRAINT]
    }
  );
});

test("the agency phase records the exposure in the objective ledger", async () => {
  await withAgencyPhase(
    async ({ G, runAgencyPhase }) => {
      await runAgencyPhase({ proposalCollector: waitProposal });

      const exposures = G.resourceEvents.filter(
        (event) => event.kind === "exposure"
      );

      assert.equal(exposures.length, 1);
      assert.equal(exposures[0].resourceId, "cigarette_stack_01");
      assert.equal(exposures[0].actorId, "ENGINE");
      assert.equal(exposures[0].cycle, 20);
      assert.equal(exposures[0].fromHolderId, "TED");
      assert.equal(exposures[0].toHolderId, "TED");
    },
    {
      cycle: 20,
      instances: [cigaretteStack()],
      previousConstraints: [BROKEN_HANDS_CONSTRAINT]
    }
  );
});

test("the agency phase tells the prisoner about the exposure", async () => {
  await withAgencyPhase(
    async ({ G, runAgencyPhase }) => {
      await runAgencyPhase({ proposalCollector: waitProposal });

      const records = G.pendingEvidence.exposures.TED;

      assert.ok(Array.isArray(records));
      assert.equal(records.length, 1);
      assert.equal(records[0].resourceId, "cigarette_stack_01");
    },
    {
      cycle: 20,
      instances: [cigaretteStack()],
      previousConstraints: [BROKEN_HANDS_CONSTRAINT]
    }
  );
});

test("the agency phase leaves concealment alone when the body is intact", async () => {
  await withAgencyPhase(
    async ({ G, runAgencyPhase }) => {
      await runAgencyPhase({ proposalCollector: waitProposal });

      assert.equal(G.resources.instances[0].concealed, true);
      assert.equal(
        G.resourceEvents.filter((event) => event.kind === "exposure").length,
        0
      );
      assert.equal(G.pendingEvidence.exposures.TED, undefined);
    },
    {
      cycle: 20,
      instances: [cigaretteStack()],
      previousConstraints: []
    }
  );
});

test("the exposure waits for the next cycle rather than firing immediately", async () => {
  /*
   * The ONE-CYCLE LATENCY.
   *
   * A restraint applied in the CURRENT cycle does not break
   * concealment in the same cycle: the rule reads the PREVIOUS
   * cycle's capability state. A restraint that was already in force
   * when the previous cycle closed does.
   */
  await withAgencyPhase(
    async ({ G, runAgencyPhase }) => {
      await runAgencyPhase({ proposalCollector: waitProposal });

      /*
       * The restraint is in force NOW but was not in force at the
       * end of the previous cycle, so nothing is exposed yet.
       */
      assert.equal(G.resources.instances[0].concealed, true);
      assert.equal(
        G.resourceEvents.filter((event) => event.kind === "exposure").length,
        0
      );
    },
    {
      cycle: 20,
      instances: [cigaretteStack()],
      constraints: [BROKEN_HANDS_CONSTRAINT],
      previousConstraints: []
    }
  );
});

test("the agency phase is idempotent across repeated runs", async () => {
  await withAgencyPhase(
    async ({ G, runAgencyPhase }) => {
      await runAgencyPhase({ proposalCollector: waitProposal });

      const eventsAfterFirst = G.resourceEvents.length;
      const recordsAfterFirst = G.pendingEvidence.exposures.TED.length;

      await runAgencyPhase({ proposalCollector: waitProposal });

      assert.equal(G.resources.instances[0].concealed, false);
      assert.equal(G.resourceEvents.length, eventsAfterFirst);
      assert.equal(
        G.pendingEvidence.exposures.TED.length,
        recordsAfterFirst
      );
    },
    {
      cycle: 20,
      instances: [cigaretteStack()],
      previousConstraints: [BROKEN_HANDS_CONSTRAINT]
    }
  );
});

test("the exposure enters the attention roll pool on the same cycle", async () => {
  /*
   * The feedback loop needs the exposed item to reach AM's
   * attention roll. The roll in commit.js filters on holder and
   * quantity only, so an exposed item is pooled exactly like an
   * openly held one.
   */
  await withAgencyPhase(
    async ({ G, runAgencyPhase }) => {
      const originalNext = engineRng.next;
      engineRng.next = () => 0;

      try {
        await runAgencyPhase({ proposalCollector: waitProposal });
      } finally {
        engineRng.next = originalNext;
      }

      const pooled = G.pendingResourceDiscoveries.filter(
        (discovery) =>
          discovery.actorId === "TED" &&
          discovery.resourceId === "cigarette_stack_01"
      );

      assert.equal(pooled.length, 1);
    },
    {
      cycle: 20,
      instances: [cigaretteStack()],
      previousConstraints: [BROKEN_HANDS_CONSTRAINT]
    }
  );
});
