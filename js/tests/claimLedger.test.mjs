import assert from "node:assert/strict";
import test from "node:test";

import { G } from "../core/state.js";
import {
  CLAIM_DISCLOSURES,
  CLAIM_EVENT_KINDS,
  DIVERGENCE_RECENCY_WINDOW,
  deriveClaimEventSpecs,
  getBelievedResourceIds,
  getClaimDivergenceEntries,
  getClaimQuantity,
  getFreshClaimDivergenceEntries,
  hasFreshClaimDivergence,
  rebuildClaimState,
  recordClaimEvent,
  refreshClaimDivergence
} from "../engine/agency/claimLedger.js";
import {
  createResourceLedger,
  maintainResourceDrying,
  seedResources
} from "../engine/agency/resourceLedger.js";
import {
  commitResourceInterventions
} from "../engine/analysis/commitResourceInterventions.js";
import {
  commitAgencyResolution
} from "../engine/agency/commit.js";
import { createAgencyState } from "../engine/agency/state/createAgencyState.js";
import {
  evaluatePrisonerAssessmentGate,
  shouldAssessPrisoner
} from "../engine/analysis/assessResourceInterventions.js";
import { formatClaimDissonance } from "../prompts/utils/formatClaimDissonance.js";
import { formatClaimDivergence } from "../prompts/utils/formatClaimDivergence.js";
import { formatScratchpadContext } from "../prompts/utils/formatScratchpadContext.js";
import { buildTacticPlanningContext } from "../prompts/amPlan/buildTacticPlanningContext.js";

/* ============================================================
   HELPERS
============================================================ */

function makeSim(id) {
  return {
    id,
    name: id,
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

function makeState(overrides = {}) {
  return {
    cycle: 5,
    sims: {
      TED: makeSim("TED"),
      ELLEN: makeSim("ELLEN"),
      NIMDOK: makeSim("NIMDOK"),
      GORRISTER: makeSim("GORRISTER"),
      BENNY: makeSim("BENNY")
    },
    resources: createResourceLedger(),
    resourceEvents: [],
    resourceEventSequence: { cycle: null, next: 1 },
    claimEvents: [],
    claimEventSequence: { cycle: null, next: 1 },
    claimState: {},
    claimDivergence: {},
    pendingEvidence: {
      resourceInterventions: Object.create(null),
      exposures: Object.create(null)
    },
    recentResourceDiscoveries: [],
    pendingResourceDiscoveries: [],
    agency: createAgencyState(),
    ...overrides
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
 * A minimal but COMPLETE tactic, as the AM planning context
 * requires. An empty candidate list is rejected by the context
 * builder, so the divergence assertions need a real tactic to
 * travel with.
 */
function testTactic() {
  return {
    path: "__test__/tactic-a",
    title: "Tactic A",
    category: "Test Category",
    subcategory: "Test Subcategory",
    objective: "Apply the opening pressure.",
    initialPhaseId: "start",
    phases: {
      start: {
        purpose: "Establish the opening condition.",
        instruction: "Apply the opening intervention.",
        nextPhaseId: "current"
      },
      current: {
        purpose: "Exploit the established condition.",
        instruction: "Apply the current intervention.",
        nextPhaseId: null
      }
    },
    finishWhen: "The whole tactic succeeds.",
    abandonWhen: "The whole tactic should stop."
  };
}

/* ============================================================
   A) SEEDING AND PROJECTION
============================================================ */

test("seeding the ledger gives each holder a claim matching reality", () => {
  const state = makeState();

  seedResources(state.resources, state);

  assert.equal(state.claimEvents.length, 2);
  assert.deepEqual(
    state.claimEvents.map((event) => event.cause.kind),
    [CLAIM_EVENT_KINDS.SEED, CLAIM_EVENT_KINDS.SEED]
  );
  assert.equal(getClaimQuantity(state, "TED", "cigarette"), 3);
  assert.equal(getClaimQuantity(state, "ELLEN", "match"), 2);

  /*
   * A claim that matches reality is not a divergence. The seed must
   * not leave the prisoners permanently wrong about their own
   * inventory.
   */
  assert.deepEqual(state.claimDivergence, {});
  assert.equal(hasFreshClaimDivergence(state, "TED", state.cycle), false);
});

test("claim event ids are monotonic within a cycle and restart across cycles", () => {
  const state = makeState();

  const first = recordClaimEvent(state, {
    subjectId: "TED",
    definitionId: "cigarette",
    delta: 2,
    cycle: 5,
    cause: { kind: CLAIM_EVENT_KINDS.OWN_ACTION }
  });
  const second = recordClaimEvent(state, {
    subjectId: "TED",
    definitionId: "cigarette",
    delta: 1,
    cycle: 5,
    cause: { kind: CLAIM_EVENT_KINDS.OWN_ACTION }
  });
  const nextCycle = recordClaimEvent(state, {
    subjectId: "TED",
    definitionId: "cigarette",
    delta: 1,
    cycle: 6,
    cause: { kind: CLAIM_EVENT_KINDS.OWN_ACTION }
  });

  assert.equal(first.eventId, "clm_5_1");
  assert.equal(second.eventId, "clm_5_2");
  assert.equal(nextCycle.eventId, "clm_6_1");
});

test("a claim event records the belief before and after it moved", () => {
  const state = makeState();

  const event = recordClaimEvent(state, {
    subjectId: "TED",
    definitionId: "cigarette",
    delta: 2,
    cycle: 5,
    cause: { kind: CLAIM_EVENT_KINDS.OWN_ACTION }
  });

  assert.equal(event.quantityBefore, 0);
  assert.equal(event.quantityAfter, 2);
  assert.equal(event.delta, 2);
  assert.equal(getClaimQuantity(state, "TED", "cigarette"), 2);
});

test("a claim can never go negative", () => {
  const state = makeState();

  recordClaimEvent(state, {
    subjectId: "TED",
    definitionId: "cigarette",
    delta: 1,
    cycle: 5,
    cause: { kind: CLAIM_EVENT_KINDS.OWN_ACTION }
  });

  const event = recordClaimEvent(state, {
    subjectId: "TED",
    definitionId: "cigarette",
    delta: -5,
    cycle: 5,
    cause: { kind: CLAIM_EVENT_KINDS.OWN_ACTION }
  });

  assert.equal(event.quantityBefore, 1);
  assert.equal(event.quantityAfter, 0);
  assert.equal(getClaimQuantity(state, "TED", "cigarette"), 0);
});

test("an unknown claim event kind is rejected", () => {
  const state = makeState();

  assert.throws(
    () => recordClaimEvent(state, {
      subjectId: "TED",
      definitionId: "cigarette",
      delta: 1,
      cause: { kind: "not_a_kind" }
    }),
    /unknown kind/
  );
});

/* ============================================================
   B) PROJECTION FROM OBJECTIVE EVENTS
============================================================ */

test("a prisoner knows about their own search", () => {
  const state = makeState();
  state.cycle = 3;
  state.resources.instances = [cigaretteStack({ quantity: 0 })];

  commitAgencyResolution(state, [{
    actorId: "TED",
    action: { type: "SEARCH" },
    status: "success",
    operations: [{ type: "find", definitionId: "cigarette", quantity: 2 }],
    provenance: { searchAttempted: true }
  }]);

  assert.equal(getClaimQuantity(state, "TED", "cigarette"), 2);
  assert.deepEqual(state.claimDivergence, {});
});

test("a prisoner knows about their own consumption", () => {
  const state = makeState();
  state.cycle = 3;
  state.resources.instances = [cigaretteStack()];

  seedResources(state.resources, state);

  commitAgencyResolution(state, [{
    actorId: "TED",
    action: { type: "CONSUME", resourceId: "cigarette_stack_01" },
    status: "success",
    operations: [{
      kind: "consume",
      resourceId: "cigarette_stack_01",
      definitionId: "cigarette",
      quantity: 1
    }]
  }]);

  const consumeEvents = state.claimEvents.filter(
    (event) => event.cause.kind === CLAIM_EVENT_KINDS.OWN_ACTION
  );

  assert.equal(consumeEvents.length, 1);
  assert.equal(consumeEvents[0].definitionId, "cigarette");
  assert.equal(consumeEvents[0].delta, -1);

  /*
   * The prisoner consumed one of their own three, so their belief
   * moved with the reality and no divergence arises.
   */
  assert.equal(getClaimQuantity(state, "TED", "cigarette"), 2);
  assert.deepEqual(state.claimDivergence, {});
});

test("a transfer updates both the giver and the receiver", () => {
  const state = makeState();
  state.cycle = 3;
  state.resources.instances = [cigaretteStack({ quantity: 1 })];

  seedResources(state.resources, state);

  commitAgencyResolution(state, [{
    actorId: "TED",
    action: { type: "TRANSFER", resourceId: "cigarette_stack_01", targetId: "ELLEN" },
    status: "success",
    operations: [{
      kind: "transfer",
      resourceId: "cigarette_stack_01",
      definitionId: "cigarette",
      quantity: 1,
      targetId: "ELLEN"
    }]
  }]);

  assert.equal(getClaimQuantity(state, "TED", "cigarette"), 2);
  assert.equal(getClaimQuantity(state, "ELLEN", "cigarette"), 1);
  assert.deepEqual(state.claimDivergence, {});
});

test("drying moves the belief across both definitions", () => {
  const state = makeState();
  state.cycle = 3;
  state.resources.instances = [{
    resourceId: "wet_cigarette_found_3_0",
    definitionId: "wet_cigarette",
    quantity: 1,
    holderId: "TED",
    locationId: null,
    accessible: true,
    concealed: false,
    dryingTurns: 1,
    provenance: { source: "test" }
  }];

  /*
   * Establish the belief in the WET definition, as a search would.
   */
  recordClaimEvent(state, {
    subjectId: "TED",
    definitionId: "wet_cigarette",
    delta: 1,
    cycle: 3,
    cause: { kind: CLAIM_EVENT_KINDS.OWN_ACTION }
  });

  maintainResourceDrying(state);

  assert.equal(getClaimQuantity(state, "TED", "wet_cigarette"), 0);
  assert.equal(getClaimQuantity(state, "TED", "cigarette"), 1);

  /*
   * A belief that did not move across the definitions would show up
   * as a divergence on BOTH the wet and the dry definition at once.
   */
  assert.deepEqual(state.claimDivergence, {});
});

test("hiding an item moves no quantity and creates no divergence", () => {
  const state = makeState();
  state.cycle = 3;
  state.resources.instances = [cigaretteStack()];

  seedResources(state.resources, state);

  commitAgencyResolution(state, [{
    actorId: "TED",
    action: { type: "HIDE", resourceId: "cigarette_stack_01" },
    status: "success",
    operations: [{
      kind: "conceal",
      resourceId: "cigarette_stack_01",
      definitionId: "cigarette",
      quantity: 3,
      concealed: true
    }]
  }]);

  assert.equal(getClaimQuantity(state, "TED", "cigarette"), 3);
  assert.deepEqual(state.claimDivergence, {});
});

/* ============================================================
   C) THE DISCLOSURE CONTROL
============================================================ */

test("a REVEALED confiscation tells the victim and creates no divergence", () => {
  const state = makeState();
  state.cycle = 5;
  state.resources.instances = [cigaretteStack()];

  seedResources(state.resources, state);

  const result = commitResourceInterventions(state, [{
    intervention_type: "confiscate",
    resource_id: "cigarette_stack_01",
    holder_id: "TED",
    quantity: 1,
    disclosure: CLAIM_DISCLOSURES.REVEALED,
    rationale: "Take it in the open."
  }]);

  assert.equal(result.committed.length, 1);

  /*
   * The victim is told, so their belief moves with the reality.
   */
  assert.equal(getClaimQuantity(state, "TED", "cigarette"), 2);
  assert.deepEqual(state.claimDivergence, {});
  assert.equal(
    state.pendingEvidence.resourceInterventions.TED?.length,
    1
  );
});

test("a SILENT confiscation leaves the victim believing they still hold it", () => {
  const state = makeState();
  state.cycle = 5;
  state.resources.instances = [cigaretteStack()];

  seedResources(state.resources, state);

  const result = commitResourceInterventions(state, [{
    intervention_type: "confiscate",
    resource_id: "cigarette_stack_01",
    holder_id: "TED",
    quantity: 1,
    disclosure: CLAIM_DISCLOSURES.SILENT,
    rationale: "Take it without telling him."
  }]);

  assert.equal(result.committed.length, 1);

  /*
   * The belief did not move. That is the divergence.
   */
  assert.equal(getClaimQuantity(state, "TED", "cigarette"), 3);

  const entries = getClaimDivergenceEntries(state, "TED");

  assert.equal(entries.length, 1);
  assert.equal(entries[0].definitionId, "cigarette");
  assert.equal(entries[0].claimed, 3);
  assert.equal(entries[0].objective, 2);
  assert.equal(entries[0].delta, -1);

  /*
   * And the victim is NOT told.
   */
  assert.equal(
    state.pendingEvidence.resourceInterventions.TED,
    undefined
  );
});

test("a silent confiscation of the WHOLE stack leaves the victim believing they hold it", () => {
  const state = makeState();
  state.cycle = 5;
  state.resources.instances = [cigaretteStack()];

  seedResources(state.resources, state);

  commitResourceInterventions(state, [{
    intervention_type: "confiscate",
    resource_id: "cigarette_stack_01",
    holder_id: "TED",
    disclosure: CLAIM_DISCLOSURES.SILENT,
    rationale: "Take everything."
  }]);

  /*
   * The prisoner now holds nothing at all but still believes they
   * hold three cigarettes. This is the state AM most wants to reach,
   * and it is the state the original assessment gate could never
   * act on.
   */
  assert.equal(getClaimQuantity(state, "TED", "cigarette"), 3);
  assert.equal(
    state.resources.instances.find(
      (instance) => instance.holderId === "TED"
    ),
    undefined
  );

  const entries = getClaimDivergenceEntries(state, "TED");

  assert.equal(entries.length, 1);
  assert.equal(entries[0].claimed, 3);
  assert.equal(entries[0].objective, 0);
  assert.equal(entries[0].delta, -3);
  assert.equal(entries[0].claimedResourceId, "cigarette_stack_01");
});

test("the disclosure defaults to revealed when it is omitted", () => {
  const state = makeState();
  state.cycle = 5;
  state.resources.instances = [cigaretteStack()];

  seedResources(state.resources, state);

  commitResourceInterventions(state, [{
    intervention_type: "confiscate",
    resource_id: "cigarette_stack_01",
    holder_id: "TED",
    quantity: 1,
    rationale: "Take it in the open."
  }]);

  assert.deepEqual(state.claimDivergence, {});
  assert.equal(
    state.pendingEvidence.resourceInterventions.TED?.length,
    1
  );
});

test("a silent transfer still tells the recipient they received it", () => {
  const state = makeState();
  state.cycle = 5;
  state.resources.instances = [cigaretteStack()];

  seedResources(state.resources, state);

  commitResourceInterventions(state, [{
    intervention_type: "transfer",
    resource_id: "cigarette_stack_01",
    holder_id: "TED",
    target_holder_id: "ELLEN",
    quantity: 1,
    disclosure: CLAIM_DISCLOSURES.SILENT,
    rationale: "Move it quietly."
  }]);

  /*
   * The victim is left in the dark. The recipient was handed an
   * item, and not knowing about it would credit them with a phantom
   * holding rather than expose a lie.
   */
  assert.equal(getClaimQuantity(state, "TED", "cigarette"), 3);
  assert.equal(getClaimQuantity(state, "ELLEN", "cigarette"), 1);

  const tedEntries = getClaimDivergenceEntries(state, "TED");

  assert.equal(tedEntries.length, 1);
  assert.equal(tedEntries[0].claimed, 3);
  assert.equal(tedEntries[0].objective, 2);

  assert.deepEqual(getClaimDivergenceEntries(state, "ELLEN"), []);
});

/* ============================================================
   D) DIVERGENCE DERIVATION
============================================================ */

test("divergence is measured against what the prisoner can actually reach", () => {
  const state = makeState();
  state.cycle = 5;

  seedResources(state.resources, state);

  /*
   * The stack is in TED's name but out of reach. For every purpose
   * the engine cares about, a prisoner who cannot reach an item does
   * not hold it.
   */
  state.resources.instances[0].accessible = false;
  refreshClaimDivergence(state);

  /*
   * The prisoner believes they hold 3 cigarettes, but the stack is
   * inaccessible, so the objective reality is that they hold none.
   */
  const entries = getClaimDivergenceEntries(state, "TED");

  assert.equal(entries.length, 1);
  assert.equal(entries[0].claimed, 3);
  assert.equal(entries[0].objective, 0);
});

test("a fresh divergence goes stale after the recency window", () => {
  const state = makeState();
  state.cycle = 5;
  state.resources.instances = [cigaretteStack()];

  seedResources(state.resources, state);

  commitResourceInterventions(state, [{
    intervention_type: "confiscate",
    resource_id: "cigarette_stack_01",
    holder_id: "TED",
    quantity: 1,
    disclosure: CLAIM_DISCLOSURES.SILENT,
    rationale: "Take it without telling him."
  }]);

  assert.equal(hasFreshClaimDivergence(state, "TED", 5), true);
  assert.equal(
    hasFreshClaimDivergence(state, "TED", 5 + DIVERGENCE_RECENCY_WINDOW),
    true
  );
  assert.equal(
    hasFreshClaimDivergence(state, "TED", 5 + DIVERGENCE_RECENCY_WINDOW + 1),
    false
  );

  /*
   * A stale divergence is still a real divergence and is still
   * recorded, it simply stops being news.
   */
  assert.equal(getClaimDivergenceEntries(state, "TED").length, 1);
  assert.equal(
    getFreshClaimDivergenceEntries(state, "TED", 99).length,
    0
  );
});

test("the divergence onset cycle is the cycle the belief and reality parted", () => {
  const state = makeState();
  state.cycle = 5;
  state.resources.instances = [cigaretteStack()];

  seedResources(state.resources, state);

  commitResourceInterventions(state, [{
    intervention_type: "confiscate",
    resource_id: "cigarette_stack_01",
    holder_id: "TED",
    quantity: 1,
    disclosure: CLAIM_DISCLOSURES.SILENT,
    rationale: "Take it without telling him."
  }]);

  const entries = getClaimDivergenceEntries(state, "TED");

  assert.equal(entries[0].onsetCycle, 5);
});

test("the derived state is rebuilt identically from the ledger", () => {
  const state = makeState();
  state.cycle = 5;
  state.resources.instances = [cigaretteStack()];

  seedResources(state.resources, state);

  commitResourceInterventions(state, [{
    intervention_type: "confiscate",
    resource_id: "cigarette_stack_01",
    holder_id: "TED",
    quantity: 1,
    disclosure: CLAIM_DISCLOSURES.SILENT,
    rationale: "Take it without telling him."
  }]);

  const before = structuredClone(state.claimDivergence);

  /*
   * Wipe the derived views and rebuild them from the ledger. The
   * result must be identical, which is what makes the ledger the
   * single source of truth.
   */
  state.claimState = {};
  state.claimDivergence = {};

  rebuildClaimState(state);

  assert.deepEqual(state.claimDivergence, before);
});

test("a save from before the subjective ledger is replayed into one", () => {
  const state = makeState();
  state.cycle = 5;
  state.resources.instances = [cigaretteStack()];

  seedResources(state.resources, state);

  /*
   * Simulate a save written before this module existed: the
   * objective history is present, the subjective history is not.
   */
  delete state.claimEvents;
  delete state.claimState;
  delete state.claimDivergence;

  rebuildClaimState(state);

  assert.equal(state.claimEvents.length, 2);
  assert.equal(getClaimQuantity(state, "TED", "cigarette"), 3);
  assert.deepEqual(state.claimDivergence, {});
});

test("an empty claim ledger is respected rather than replayed", () => {
  const state = makeState();
  state.cycle = 5;
  state.resources.instances = [cigaretteStack()];

  seedResources(state.resources, state);

  state.claimEvents = [];

  rebuildClaimState(state);

  /*
   * An empty array is an authoritative statement that no belief has
   * been recorded, so it is respected and NOT back-filled from the
   * objective history.
   */
  assert.equal(state.claimEvents.length, 0);
  assert.equal(getClaimQuantity(state, "TED", "cigarette"), 0);
});

/* ============================================================
   E) THE WIDENED ASSESSMENT GATE
============================================================ */

test("a prisoner with a divergence is assessed even holding nothing", () => {
  const state = makeState();
  state.cycle = 5;
  state.resources.instances = [cigaretteStack()];

  seedResources(state.resources, state);

  /*
   * Before anything is taken, the gate closes: no attention flag.
   */
  assert.equal(shouldAssessPrisoner("TED", state), false);

  commitResourceInterventions(state, [{
    intervention_type: "confiscate",
    resource_id: "cigarette_stack_01",
    holder_id: "TED",
    disclosure: CLAIM_DISCLOSURES.SILENT,
    rationale: "Take everything."
  }]);

  /*
   * TED now holds nothing, so the ORIGINAL gate would have closed
   * with "no held resources" and AM could never have reached the
   * prisoner it most wanted to gaslight.
   */
  const gate = evaluatePrisonerAssessmentGate("TED", state);

  assert.equal(gate.shouldAssess, true);
  assert.equal(gate.reason, "prisoner belief diverges from objective reality");
  assert.equal(gate.divergences.length, 1);
  assert.equal(gate.divergences[0].definitionId, "cigarette");
  assert.equal(gate.divergences[0].claimed, 3);
  assert.equal(gate.divergences[0].objective, 0);
});

test("the gate still opens for a prisoner holding a flagged resource", () => {
  const state = makeState();
  state.cycle = 5;
  state.resources.instances = [cigaretteStack()];

  state.recentResourceDiscoveries = [{
    cycle: 5,
    actorId: "ELLEN",
    resourceId: "cigarette_stack_01",
    definitionId: "cigarette"
  }];

  const gate = evaluatePrisonerAssessmentGate("TED", state);

  assert.equal(gate.shouldAssess, true);
  assert.equal(gate.reason, "held resources have recent attention flags");
});

test("a prisoner with neither a flag nor a divergence is not assessed", () => {
  const state = makeState();
  state.cycle = 5;
  state.resources.instances = [cigaretteStack()];

  assert.equal(shouldAssessPrisoner("TED", state), false);
  assert.equal(shouldAssessPrisoner("ELLEN", state), false);
});

test("a stale divergence does not open the assessment gate", () => {
  const state = makeState();
  state.cycle = 5;
  state.resources.instances = [cigaretteStack()];

  seedResources(state.resources, state);

  commitResourceInterventions(state, [{
    intervention_type: "confiscate",
    resource_id: "cigarette_stack_01",
    holder_id: "TED",
    disclosure: CLAIM_DISCLOSURES.SILENT,
    rationale: "Take everything."
  }]);

  state.cycle = 5 + DIVERGENCE_RECENCY_WINDOW + 1;

  assert.equal(shouldAssessPrisoner("TED", state), false);
});

test("the believed resources are the ones the prisoner still expects to hold", () => {
  const state = makeState();
  state.cycle = 5;
  state.resources.instances = [cigaretteStack()];

  seedResources(state.resources, state);

  commitResourceInterventions(state, [{
    intervention_type: "confiscate",
    resource_id: "cigarette_stack_01",
    holder_id: "TED",
    disclosure: CLAIM_DISCLOSURES.SILENT,
    rationale: "Take everything."
  }]);

  const believed = getBelievedResourceIds(state, "TED", state.cycle);

  assert.equal(believed.has("cigarette_stack_01"), true);
});

/* ============================================================
   F) THE PROJECTOR IN ISOLATION
============================================================ */

test("the projector derives nothing from a missing objective event", () => {
  const state = makeState();

  assert.deepEqual(deriveClaimEventSpecs(state, null), []);
  assert.deepEqual(
    deriveClaimEventSpecs(state, { kind: "prisoner_action" }),
    []
  );
});

test("the projector ignores a claim about a holder who is not a prisoner", () => {
  const state = makeState();

  const specs = deriveClaimEventSpecs(state, {
    eventId: "evt_1_1",
    cycle: 1,
    kind: "am_intervention",
    definitionId: "cigarette",
    quantityBefore: 1,
    quantityAfter: 1,
    fromHolderId: "AM",
    toHolderId: "AM",
    actorId: "AM",
    cause: { action: "CONFISCATE" }
  });

  assert.deepEqual(specs, []);
});

test("the projector moves a silent belief event with a zero delta", () => {
  const state = makeState();

  const specs = deriveClaimEventSpecs(state, {
    eventId: "evt_5_1",
    cycle: 5,
    kind: "am_intervention",
    definitionId: "cigarette",
    quantityBefore: 1,
    quantityAfter: 1,
    fromHolderId: "TED",
    toHolderId: "AM",
    actorId: "AM",
    cause: { action: "CONFISCATE" }
  }, { disclosure: CLAIM_DISCLOSURES.SILENT });

  assert.equal(specs.length, 1);
  assert.equal(specs[0].subjectId, "TED");
  assert.equal(specs[0].delta, 0);
  assert.equal(specs[0].cause.kind, CLAIM_EVENT_KINDS.SILENT);
  assert.equal(specs[0].cause.disclosure, CLAIM_DISCLOSURES.SILENT);
});

test("a revealed intervention moves the belief by the affected quantity", () => {
  const state = makeState();

  const specs = deriveClaimEventSpecs(state, {
    eventId: "evt_5_1",
    cycle: 5,
    kind: "am_intervention",
    definitionId: "cigarette",
    quantityBefore: 2,
    quantityAfter: 2,
    fromHolderId: "TED",
    toHolderId: "AM",
    actorId: "AM",
    cause: { action: "CONFISCATE" }
  });

  assert.equal(specs.length, 1);
  assert.equal(specs[0].delta, -2);
  assert.equal(specs[0].cause.kind, CLAIM_EVENT_KINDS.INFORMED);
});

test("the objective ledger event schema is unchanged by the claim work", () => {
  const state = makeState();
  state.cycle = 5;
  state.resources.instances = [cigaretteStack()];

  seedResources(state.resources, state);

  commitResourceInterventions(state, [{
    intervention_type: "confiscate",
    resource_id: "cigarette_stack_01",
    holder_id: "TED",
    quantity: 1,
    disclosure: CLAIM_DISCLOSURES.SILENT,
    rationale: "Take it without telling him."
  }]);

  const objectiveEvent = state.resourceEvents.at(-1);

  assert.deepEqual(Object.keys(objectiveEvent.cause).sort(), [
    "action",
    "phase",
    "source"
  ]);
});

/* ============================================================
   G) PROMPT INJECTION
============================================================ */

test("the prisoner dissonance block describes the missing thing, not the truth", () => {
  const block = formatClaimDissonance([{
    definitionId: "cigarette",
    claimed: 1,
    objective: 0,
    delta: -1,
    onsetCycle: 5,
    claimedResourceId: "cigarette_stack_01"
  }]);

  assert.match(block, /\[COGNITIVE DISSONANCE\]/);
  assert.match(block, /You remember having 1 cigarette, but you cannot find it/);
  assert.match(block, /cigarette_stack_01/);

  /*
   * The prisoner must NOT be told what actually happened. Telling
   * them would collapse the divergence the engine is keeping open.
   */
  assert.doesNotMatch(block, /confiscat/i);
  assert.doesNotMatch(block, /AM took/i);
});

test("the dissonance block pluralizes and omits an empty section", () => {
  const block = formatClaimDissonance([{
    definitionId: "cigarette",
    claimed: 2,
    objective: 0,
    delta: -2
  }]);

  assert.match(block, /You remember having 2 cigarettes/);
  assert.equal(formatClaimDissonance([]), "");
  assert.equal(formatClaimDissonance(null), "");
});

test("the scratchpad context carries the dissonance block", () => {
  const sim = makeSim("TED");

  const context = formatScratchpadContext(
    sim,
    [],
    [],
    [],
    [{
      definitionId: "cigarette",
      claimed: 1,
      objective: 0,
      delta: -1,
      onsetCycle: 5,
      claimedResourceId: "cigarette_stack_01"
    }]
  );

  assert.match(context, /\[COGNITIVE DISSONANCE\]/);
  assert.match(context, /You remember having 1 cigarette, but you cannot find it/);
});

test("the scratchpad context omits the dissonance block when there is none", () => {
  const sim = makeSim("TED");

  const context = formatScratchpadContext(sim, [], [], [], []);

  assert.doesNotMatch(context, /\[COGNITIVE DISSONANCE\]/);
});

test("the AM divergence section states the gap in both directions", () => {
  const section = formatClaimDivergence({
    TED: {
      cigarette: {
        definitionId: "cigarette",
        claimed: 1,
        objective: 0,
        delta: -1,
        onsetCycle: 5,
        claimedResourceId: "cigarette_stack_01"
      }
    }
  });

  assert.match(section, /\[PRISONER BELIEF DIVERGENCE\]/);
  assert.match(section, /TED:/);
  assert.match(section, /believes 1, reality is 0/);
  assert.match(section, /the prisoner believes they have more than they do/);
  assert.match(section, /cigarette_stack_01/);
});

test("the AM divergence section is omitted when there is no divergence", () => {
  assert.equal(formatClaimDivergence({}), "");
  assert.equal(formatClaimDivergence(null), "");
  assert.equal(formatClaimDivergence({ TED: {} }), "");
});

test("the AM planning context injects the divergence section", () => {
  const result = buildTacticPlanningContext({
    requiredTargetIds: ["TED"],
    tacticCandidatesByTarget: { TED: [testTactic()] },
    tacticRuntimeByTarget: {},
    claimDivergence: {
      TED: {
        cigarette: {
          definitionId: "cigarette",
          claimed: 1,
          objective: 0,
          delta: -1,
          onsetCycle: 5
        }
      }
    },
    cycle: 6,
    simIds: ["TED"]
  });

  assert.match(result.claimDivergenceSection, /\[PRISONER BELIEF DIVERGENCE\]/);
  assert.match(result.claimDivergenceSection, /believes 1, reality is 0/);
});

test("the AM planning context omits the divergence section when there is none", () => {
  const result = buildTacticPlanningContext({
    requiredTargetIds: ["TED"],
    tacticCandidatesByTarget: { TED: [testTactic()] },
    tacticRuntimeByTarget: {},
    claimDivergence: {},
    cycle: 6,
    simIds: ["TED"]
  });

  assert.equal(result.claimDivergenceSection, "");
});

/* ============================================================
   H) DETERMINISM
============================================================ */

test("the same action history produces the same claim history", () => {
  function runScenario() {
    const state = makeState();
    state.cycle = 7;
    state.resources.instances = [cigaretteStack()];

    seedResources(state.resources, state);

    commitResourceInterventions(state, [{
      intervention_type: "confiscate",
      resource_id: "cigarette_stack_01",
      holder_id: "TED",
      quantity: 1,
      disclosure: CLAIM_DISCLOSURES.SILENT,
      rationale: "Take it without telling him."
    }]);

    return {
      claimEvents: state.claimEvents,
      claimState: state.claimState,
      claimDivergence: state.claimDivergence
    };
  }

  assert.deepEqual(runScenario(), runScenario());
});

test("the claim ledger carries no timestamp or random identifier", () => {
  const state = makeState();

  const event = recordClaimEvent(state, {
    subjectId: "TED",
    definitionId: "cigarette",
    delta: 1,
    cycle: 5,
    cause: { kind: CLAIM_EVENT_KINDS.OWN_ACTION }
  });

  assert.equal(event.eventId, "clm_5_1");
  assert.equal(Object.hasOwn(event, "timestamp"), false);
  assert.equal(Object.hasOwn(event, "createdAt"), false);
});

/* ============================================================
   I) THE GLOBAL STATE
============================================================ */

test("the global state carries the subjective ledger fields", () => {
  assert.deepEqual(G.claimEvents, []);
  assert.deepEqual(G.claimEventSequence, { cycle: null, next: 1 });
  assert.deepEqual(G.claimState, {});
  assert.deepEqual(G.claimDivergence, {});
});

test("the divergence refresh is a no-op on a malformed state", () => {
  assert.equal(refreshClaimDivergence(null), null);
  assert.equal(refreshClaimDivergence(undefined), null);
});
