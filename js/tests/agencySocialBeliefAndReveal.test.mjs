// js/tests/agencySocialBeliefAndReveal.test.mjs
//
// Coverage for the two dual-ledger and action-catalogue defects:
//
//   BUG 1 — the social layer leaked objective truth.
//     The agency prompt correctly renders BOTH the believed and the
//     actual holdings, because the engine adjudicates the attempt
//     against reality. The SOCIAL prompt used to render the OBJECTIVE
//     holdings only, which silently corrected a prisoner's memory at
//     the exact moment they were about to state it to another human
//     being. A prisoner robbed of a cigarette would reach for it,
//     be refused, experience dissonance, and then tell their fellow
//     prisoner "I've got nothing" in the same cycle.
//
//   BUG 2 — REVEAL was instructed but not registered.
//     The agency proposal prompt told the model REVEAL was available,
//     but the action was not in ACTION_DEFINITIONS, so every attempt
//     was refused as `action_not_legal`.
//
// The behaviours most likely to regress silently:
//
//   1. The social prompt drifting back to the objective ledger. The
//      divergence would still be preserved in the agency phase and the
//      scratchpad, so the loss would be invisible except as a
//      collapsed gaslighting loop.
//   2. The agency prompt being "fixed" to show believed-only. That
//      would be a DIFFERENT bug: the agency prompt is a decision
//      surface where the engine adjudicates, and it needs both.
//   3. REVEAL silently re-registering without the resolver agreeing
//      on the concealment state transition.

import { test } from "node:test";
import assert from "node:assert/strict";

import { G } from "../core/state.js";
import { SIM_IDS } from "../core/constants.js";
import { engineRng } from "../core/prng.js";

import { buildSimReplyPrompt } from "../prompts/simReply.js";
import { buildSimOutreachPrompt } from "../prompts/simOutreach.js";
import {
  formatResourceSummary
} from "../prompts/utils/formatResourceSummary.js";
import { buildAgencyProposalPrompt } from "../prompts/agencyProposal.js";

import { ACTION_DEFINITIONS } from "../engine/agency/actionDefs.js";
import { enumerateLegalActions } from "../engine/agency/legalActions.js";
import {
  createResourceLedger,
  buildResourceView,
  seedResources
} from "../engine/agency/resourceLedger.js";
import { createAgencyState } from "../engine/agency/state/createAgencyState.js";
import { validateAgencyProposal } from "../engine/agency/proposal.js";
import {
  createAgencySnapshot,
  resolveAgencyActions
} from "../engine/agency/resolve.js";
import { commitAgencyResolution } from "../engine/agency/commit.js";

/* ============================================================
   HELPERS
============================================================ */

const FULL_CAPABILITIES = Object.freeze({
  mobility: 1,
  stability: 1,
  handUse: 1,
  concentration: 1,
  interactionReach: 1
});

function makeSim(id) {
  return {
    id,
    hope: 50,
    sanity: 70,
    suffering: 20,
    beliefs: {
      escape_possible: 0.5,
      others_trustworthy: 0.5,
      resistance_possible: 0.5,
      self_worth: 0.5,
      guilt_deserved: 0.5,
    },
    relationships: Object.fromEntries(
      SIM_IDS.filter((other) => other !== id).map((other) => [other, 0])
    ),
    drives: { primary: "find a way out", secondary: "" },
    anchors: [],
    overheard: [],
    intentProfile: {},
    scratchpad: {
      initialized: true,
      messageNotes: [],
      hypothesesAboutOthers: {},
      informationModel: { channels: { public: {}, private: {} } },
      predictions: [],
      questions: []
    }
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
    concealed: false,
    provenance: { source: "test" },
    ...overrides
  };
}

/*
 * A game in which TED's cigarettes were confiscated SILENTLY.
 *
 * The objective ledger says TED holds nothing. The subjective ledger
 * says TED still believes he holds three. This is the divergence the
 * whole dual-ledger design exists to preserve.
 */
function makeDivergedGame() {
  const sims = Object.fromEntries(
    SIM_IDS.map((id) => [id, makeSim(id)])
  );

  const resources = createResourceLedger();

  resources.instances = [cigaretteStack()];

  return {
    cycle: 5,
    sims,
    resources,
    resourceEvents: [],
    resourceEventSequence: { cycle: null, next: 1 },
    claimEvents: [],
    claimEventSequence: { cycle: null, next: 1 },
    claimState: {
      TED: { cigarette: 3 }
    },
    claimDivergence: {},
    agency: createAgencyState()
  };
}

/*
 * Save and restore the global state around a test that mutates it.
 */
function withGlobalState(saved, body) {
  try {
    return body();
  } finally {
    G.resources = saved.resources;
    G.claimState = saved.claimState;
    G.claimDivergence = saved.claimDivergence;
    G.sims = saved.sims;
    G.cycle = saved.cycle;
    engineRng.next = saved.nextRandom;
  }
}

/* ============================================================
   A) THE FORMATTER
============================================================ */

test("the formatter renders the believed inventory when one is supplied", () => {
  const instances = [cigaretteStack()];

  /*
   * The objective view: TED holds three cigarettes.
   */
  assert.equal(
    formatResourceSummary(instances, "TED"),
    "[YOUR RESOURCES] cigarette: 3"
  );

  /*
   * The believed view: TED believes he holds three.
   */
  assert.equal(
    formatResourceSummary(instances, "TED", { cigarette: 3 }),
    "[YOUR RESOURCES] cigarette: 3"
  );

  /*
   * The divergence case: the prisoner believes he holds three, and
   * the objective ledger says he holds none. The formatter must
   * render the BELIEF.
   */
  assert.equal(
    formatResourceSummary([], "TED", { cigarette: 3 }),
    "[YOUR RESOURCES] cigarette: 3"
  );
});

test("an empty believed map renders as holding nothing, not as the objective view", () => {
  /*
   * An EMPTY believed map is still a believed map: it says the
   * prisoner believes they hold nothing. That is a real belief and
   * must not be silently replaced by the objective holdings.
   */
  assert.equal(
    formatResourceSummary([cigaretteStack()], "TED", {}),
    "[YOUR RESOURCES] None"
  );
});

test("an absent believed map falls back to the objective inventory", () => {
  /*
   * A caller with no claim ledger at all still gets a usable summary
   * rather than an empty one. `null` and `undefined` mean "no belief
   * ledger available"; an object means "this is what they believe".
   */
  assert.equal(
    formatResourceSummary([cigaretteStack()], "TED", null),
    "[YOUR RESOURCES] cigarette: 3"
  );

  assert.equal(
    formatResourceSummary([cigaretteStack()], "TED", undefined),
    "[YOUR RESOURCES] cigarette: 3"
  );
});

test("the formatter drops non-positive believed quantities", () => {
  /*
   * A prisoner who believes they hold nothing of a definition does not
   * hold that definition, and "cigarette: 0" would invite the model to
   * discuss an absence the prisoner does not perceive.
   */
  assert.equal(
    formatResourceSummary([], "TED", { cigarette: 0, match: 2 }),
    "[YOUR RESOURCES] match: 2"
  );
});

/* ============================================================
   B) BUG 1 — THE SOCIAL PROMPT MUST NOT LEAK OBJECTIVE TRUTH
============================================================ */

test("a diverged prisoner's social prompt shows what they BELIEVE they hold", () => {
  const saved = {
    resources: G.resources,
    claimState: G.claimState,
    claimDivergence: G.claimDivergence,
    sims: G.sims,
    cycle: G.cycle,
    nextRandom: engineRng.next
  };

  withGlobalState(saved, () => {
    const game = makeDivergedGame();

    /*
     * The objective ledger: TED holds nothing.
     */
    G.resources = { instances: [] };

    /*
     * The subjective ledger: TED still believes he holds three
     * cigarettes.
     */
    G.claimState = { TED: { cigarette: 3 } };
    G.claimDivergence = {
      TED: {
        cigarette: {
          definitionId: "cigarette",
          claimed: 3,
          objective: 0,
          delta: -3,
          onsetCycle: 5,
          claimedResourceId: "cigarette_stack_01"
        }
      }
    };

    const sim = game.sims.TED;

    const replyPrompt = buildSimReplyPrompt(
      sim,
      "ELLEN",
      "Can you help?",
      "private",
      []
    );

    const outreachPrompt = buildSimOutreachPrompt(sim);

    for (const prompt of [replyPrompt, outreachPrompt]) {
      assert.ok(
        prompt.includes("[YOUR RESOURCES] cigarette: 3"),
        "the social prompt must show the BELIEVED holding"
      );

      assert.ok(
        !prompt.includes("[YOUR RESOURCES] None"),
        "the social prompt must not show the objective emptiness"
      );
    }
  });
});

test("the social prompt shows no objective inventory when the belief diverges", () => {
  const saved = {
    resources: G.resources,
    claimState: G.claimState,
    claimDivergence: G.claimDivergence,
    sims: G.sims,
    cycle: G.cycle,
    nextRandom: engineRng.next
  };

  withGlobalState(saved, () => {
    const game = makeDivergedGame();

    /*
     * The world still HAS a match in TED's hands, but TED believes he
     * has no matches. The social prompt must show the belief, so it
     * must not mention the match he is actually carrying.
     */
    G.resources = {
      instances: [
        cigaretteStack({ concealed: true }),
        {
          resourceId: "match_stack_01",
          definitionId: "match",
          quantity: 2,
          holderId: "TED",
          locationId: null,
          accessible: true,
          concealed: true,
          provenance: { source: "test" }
        }
      ]
    };

    G.claimState = { TED: { cigarette: 3 } };
    G.claimDivergence = {};

    const sim = game.sims.TED;

    const replyPrompt = buildSimReplyPrompt(
      sim,
      "ELLEN",
      "Can you help?",
      "private",
      []
    );

    const outreachPrompt = buildSimOutreachPrompt(sim);

    for (const prompt of [replyPrompt, outreachPrompt]) {
      assert.ok(
        !prompt.includes("match"),
        "the objective match holding must not reach the social prompt"
      );
    }
  });
});

test("the agency prompt still shows BOTH believed and actual holdings", () => {
  /*
   * The counterpart to the fix above.
   *
   * The agency prompt is a DECISION surface. The engine adjudicates
   * the prisoner's attempt against reality, so the prisoner needs to
   * know what they believe they have AND what is really in their
   * hands. Changing it to believed-only would be a DIFFERENT bug.
   */
  const resources = { instances: [cigaretteStack()] };
  const resourceView = buildResourceView(resources, "TED");

  const prompt = buildAgencyProposalPrompt(
    makeSim("TED"),
    [],
    3,
    resourceView,
    {
      simId: "TED",
      believed: { cigarette: 3 },
      stale: [],
      live: [],
      believedResourceIds: new Set()
    }
  );

  assert.ok(prompt.includes("[YOUR RESOURCES - BELIEVED]"));
  assert.ok(prompt.includes("[YOUR RESOURCES - ACTUAL]"));
  assert.ok(prompt.includes("[YOUR RESOURCES - BELIEVED] what you think you are carrying:"));
  assert.ok(prompt.includes("[YOUR RESOURCES - ACTUAL] what is really in your hands:"));
});

/* ============================================================
   C) BUG 2 — REVEAL
============================================================ */

test("REVEAL is legal for a prisoner holding a stack", () => {
  const resources = createResourceLedger();

  resources.instances = [cigaretteStack({ concealed: true })];

  const result = enumerateLegalActions(
    { id: "TED", constraints: [] },
    FULL_CAPABILITIES,
    ACTION_DEFINITIONS,
    buildResourceView(resources, "TED")
  );

  const legal = new Map(result.legal.map((entry) => [entry.type, entry]));

  assert.ok(legal.has("REVEAL"), "REVEAL should be legal for a holder");
  assert.equal(legal.get("REVEAL").cost, 1);
});

test("REVEAL is refused for a prisoner holding nothing", () => {
  const resources = createResourceLedger();

  const result = enumerateLegalActions(
    { id: "TED", constraints: [] },
    FULL_CAPABILITIES,
    ACTION_DEFINITIONS,
    buildResourceView(resources, "TED")
  );

  const blocked = new Map(result.blocked.map((entry) => [entry.type, entry]));

  assert.ok(blocked.has("REVEAL"));
  assert.equal(blocked.get("REVEAL").reason, "resource_requirement_unmet");
});

test("REVEAL on a hidden stack sets concealed to false", () => {
  const game = {
    cycle: 7,
    sims: Object.fromEntries(
      SIM_IDS.map((id) => [id, {
        id,
        hope: 50,
        sanity: 60,
        suffering: 10,
        drives: {},
        anchors: [],
        beliefs: {},
        scratchpad: { initialized: true }
      }])
    ),
    resources: {
      instances: [cigaretteStack({ concealed: true })]
    },
    agency: createAgencyState()
  };

  const proposal = validateAgencyProposal({
    proposal: {
      type: "REVEAL",
      resourceId: "cigarette_stack_01",
      selected_objective: "endure"
    },
    actorId: "TED",
    legalActions: [{
      type: "REVEAL",
      title: "Reveal a hidden resource",
      cost: 1,
      availableModes: []
    }],
    budget: 3,
    resourceView: buildResourceView(game.resources, "TED")
  });

  assert.equal(proposal.accepted, true, proposal.reason ?? "");

  const resolutions = resolveAgencyActions({
    proposals: [proposal],
    snapshot: createAgencySnapshot(game),
    cycle: game.cycle
  });

  assert.equal(resolutions.length, 1);
  assert.equal(resolutions[0].status, "success");
  assert.equal(resolutions[0].reason, null);

  commitAgencyResolution(game, resolutions);

  const instance = game.resources.instances.find(
    (candidate) => candidate.resourceId === "cigarette_stack_01"
  );

  assert.equal(instance.concealed, false, "REVEAL must expose the stack");
  assert.equal(instance.quantity, 3, "REVEAL moves no quantity");
  assert.equal(instance.holderId, "TED", "REVEAL does not move the stack");
});

test("REVEAL on an already-visible stack is blocked with resource_already_in_state", () => {
  const game = {
    cycle: 7,
    sims: Object.fromEntries(
      SIM_IDS.map((id) => [id, {
        id,
        hope: 50,
        sanity: 60,
        suffering: 10,
        drives: {},
        anchors: [],
        beliefs: {},
        scratchpad: { initialized: true }
      }])
    ),
    resources: {
      instances: [cigaretteStack({ concealed: false })]
    },
    agency: createAgencyState()
  };

  const proposal = validateAgencyProposal({
    proposal: {
      type: "REVEAL",
      resourceId: "cigarette_stack_01",
      selected_objective: "endure"
    },
    actorId: "TED",
    legalActions: [{
      type: "REVEAL",
      title: "Reveal a hidden resource",
      cost: 1,
      availableModes: []
    }],
    budget: 3,
    resourceView: buildResourceView(game.resources, "TED")
  });

  const resolutions = resolveAgencyActions({
    proposals: [proposal],
    snapshot: createAgencySnapshot(game),
    cycle: game.cycle
  });

  assert.equal(resolutions[0].status, "blocked");
  assert.equal(resolutions[0].reason, "resource_already_in_state");
});

test("HIDE then REVEAL round-trips the concealment state", () => {
  /*
   * The pair is the inverse of each other, and the round trip is what
   * makes REVEAL a usable counter-move against the concealment
   * failure the Capability-Ledger Entanglement milestone produces.
   */
  const game = {
    cycle: 7,
    sims: Object.fromEntries(
      SIM_IDS.map((id) => [id, {
        id,
        hope: 50,
        sanity: 60,
        suffering: 10,
        drives: {},
        anchors: [],
        beliefs: {},
        scratchpad: { initialized: true }
      }])
    ),
    resources: {
      instances: [cigaretteStack({ concealed: false })]
    },
    agency: createAgencyState()
  };

  const hideProposal = validateAgencyProposal({
    proposal: {
      type: "HIDE",
      resourceId: "cigarette_stack_01",
      selected_objective: "endure"
    },
    actorId: "TED",
    legalActions: [{
      type: "HIDE",
      title: "Conceal a resource",
      cost: 1,
      availableModes: []
    }],
    budget: 3,
    resourceView: buildResourceView(game.resources, "TED")
  });

  commitAgencyResolution(
    game,
    resolveAgencyActions({
      proposals: [hideProposal],
      snapshot: createAgencySnapshot(game),
      cycle: game.cycle
    })
  );

  assert.equal(
    game.resources.instances[0].concealed,
    true,
    "HIDE must conceal the stack"
  );

  const revealProposal = validateAgencyProposal({
    proposal: {
      type: "REVEAL",
      resourceId: "cigarette_stack_01",
      selected_objective: "endure"
    },
    actorId: "TED",
    legalActions: [{
      type: "REVEAL",
      title: "Reveal a hidden resource",
      cost: 1,
      availableModes: []
    }],
    budget: 3,
    resourceView: buildResourceView(game.resources, "TED")
  });

  commitAgencyResolution(
    game,
    resolveAgencyActions({
      proposals: [revealProposal],
      snapshot: createAgencySnapshot(game),
      cycle: game.cycle
    })
  );

  assert.equal(
    game.resources.instances[0].concealed,
    false,
    "REVEAL must expose the stack again"
  );
});

test("the agency prompt now names an action the catalogue actually offers", () => {
  /*
   * The prompt has always said "For HIDE or REVEAL, name one
   * resourceId from your inventory." Before REVEAL was registered,
   * every such attempt was refused as `action_not_legal`. The prompt
   * and the catalogue must agree.
   */
  const resources = createResourceLedger();

  resources.instances = [cigaretteStack({ concealed: true })];

  const result = enumerateLegalActions(
    { id: "TED", constraints: [] },
    FULL_CAPABILITIES,
    ACTION_DEFINITIONS,
    buildResourceView(resources, "TED")
  );

  const prompt = buildAgencyProposalPrompt(
    makeSim("TED"),
    result.legal,
    3,
    buildResourceView(resources, "TED"),
    null
  );

  assert.match(prompt, /For HIDE or REVEAL/);

  const legalTypes = result.legal.map((entry) => entry.type);

  assert.ok(legalTypes.includes("REVEAL"));
  assert.ok(legalTypes.includes("HIDE"));
});
