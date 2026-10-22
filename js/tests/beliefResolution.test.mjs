// js/tests/beliefResolution.test.mjs
//
// Coverage for BELIEF RESOLUTION: the mechanism that closes a
// divergence.
//
// THE PROBLEM THIS SOLVES
// -----------------------
// AM can take an item SILENTLY. The objective ledger moves and the
// subjective ledger does not, so the prisoner keeps believing they are
// carrying something they are not. The divergence goes stale after
// DIVERGENCE_RECENCY_WINDOW cycles, but the BELIEF stays wrong
// forever: a prisoner robbed in cycle 5 still believes they hold the
// item in cycle 50.
//
// The natural resolution is the one the simulation already produces:
// the prisoner reaches for the thing, the resolver refuses with
// `resource_unavailable`, and that refusal IS the learning event. The
// prisoner's hand has just confirmed what the engine already knew.
//
// WHAT THIS FILE PINS DOWN
// -------------------------
//   1. A refused attempt on a believed-but-absent resource CORRECTS
//      the belief, and the divergence resolves.
//   2. The correction converges onto the REALITY, not onto zero. A
//      prisoner who holds a different stack of the same definition
//      must not be told they hold nothing.
//   3. Refusals for OTHER reasons do NOT correct beliefs.
//   4. The correction is recorded, not applied silently: it is a
//      claim event in the ledger, derived from a recorded agency
//      event.
//   5. The corrected belief no longer licenses the action, so the
//      loop does not repeat.
//
// The behaviours most likely to regress silently:
//
//   - A correction firing on a refusal the prisoner could not have
//     learned from (capability, budget, conflict). That would let a
//     prisoner "discover" their cigarette was gone merely by being
//     unable to move their hands.
//   - The correction zeroing a belief when the prisoner still holds
//     another stack of the same definition. That MANUFACTURES a new
//     divergence in the opposite direction.
//   - The correction firing twice for one refusal.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CLAIM_DISCLOSURES,
  CLAIM_EVENT_KINDS,
  DIVERGENCE_RECENCY_WINDOW,
  getClaimQuantity,
  getObjectiveQuantity,
  recordClaimEvent,
  refreshClaimDivergence,
  rebuildClaimState,
  recordBeliefCorrection
} from "../engine/agency/claimLedger.js";
import {
  buildClaimView,
  livesResourceId
} from "../engine/agency/claimView.js";
import {
  createResourceLedger,
  seedResources,
  buildResourceView
} from "../engine/agency/resourceLedger.js";
import {
  commitResourceInterventions
} from "../engine/analysis/commitResourceInterventions.js";
import { enumerateLegalActions } from "../engine/agency/legalActions.js";
import { ACTION_DEFINITIONS } from "../engine/agency/actionDefs.js";
import { deriveCapabilities } from "../engine/agency/capabilities.js";
import { validateAgencyProposal } from "../engine/agency/proposal.js";
import {
  createAgencySnapshot,
  resolveAgencyActions
} from "../engine/agency/resolve.js";
import { commitAgencyResolution } from "../engine/agency/commit.js";
import { createAgencyState } from "../engine/agency/state/createAgencyState.js";

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
    name: id,
    hope: 50,
    sanity: 50,
    suffering: 50,
    drives: { primary: "survival", secondary: "resistance" },
    anchors: [],
    beliefs: {},
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
 * TED's three cigarettes were confiscated SILENTLY.
 *
 * The objective ledger says he holds nothing. The subjective ledger
 * says he still believes he holds three. This is the divergence.
 */
function makeDivergedState({ cycle = 5 } = {}) {
  const state = makeState({ cycle });
  state.resources.instances = [cigaretteStack()];

  seedResources(state.resources, state);

  commitResourceInterventions(state, [{
    intervention_type: "confiscate",
    resource_id: "cigarette_stack_01",
    holder_id: "TED",
    disclosure: CLAIM_DISCLOSURES.SILENT,
    rationale: "Take it without telling him."
  }]);

  return state;
}

/*
 * A state in which TED holds a SECOND stack of cigarettes that he
 * still believes in, while one stack was taken silently.
 *
 * This is the case that separates a correct correction from a naive
 * zeroing. The belief is per DEFINITION, so TED believes 6 cigarettes
 * while reality holds 3. A refusal on the missing stack tells him
 * that stack is gone, NOT that he holds nothing.
 */
function makePartiallyDivergedState({ cycle = 5 } = {}) {
  const state = makeState({ cycle });
  /*
   * `seedResources()` REPLACES the instance list with the catalogue
   * seed, so both stacks are added afterwards and the belief is
   * seeded explicitly.
   *
   * The seed gives TED three cigarettes in one stack. The second
   * stack is added here, and the claim event records that the
   * prisoner believes they hold six cigarettes across the two.
   */
  seedResources(state.resources, state);

  state.resources.instances.push({
    resourceId: "cigarette_stack_02",
    definitionId: "cigarette",
    quantity: 3,
    holderId: "TED",
    locationId: null,
    accessible: true,
    concealed: false,
    provenance: { source: "test" }
  });

  recordClaimEvent(state, {
    subjectId: "TED",
    definitionId: "cigarette",
    delta: 3,
    cycle,
    cause: {
      kind: CLAIM_EVENT_KINDS.SEED,
      resourceId: "cigarette_stack_02"
    }
  });

  commitResourceInterventions(state, [{
    intervention_type: "confiscate",
    resource_id: "cigarette_stack_01",
    holder_id: "TED",
    disclosure: CLAIM_DISCLOSURES.SILENT,
    rationale: "Take one stack without telling him."
  }]);

  return state;
}

/*
 * Run one full attempt: validate, resolve, commit.
 *
 * Returns the proposal, the resolution, and the committed events.
 */
function attemptAction(state, actorId, proposalSpec, {
  capabilities = null,
  budget = 3
} = {}) {
  const claimView = buildClaimView(state, actorId, state.cycle);
  const resourceView = buildResourceView(state.resources, actorId);

  /*
   * The capabilities come from the sim's constraints, exactly as
   * the production phase derives them. A test that passed a
   * hand-written capability set would disagree with the resolver,
   * which reads the sim, and the two gates would be testing
   * different worlds.
   */
  const capabilitySet = capabilities ?? deriveCapabilities(
    state.sims[actorId]
  ).capabilities;

  const legalActions = enumerateLegalActions(
    state.sims[actorId],
    capabilitySet,
    ACTION_DEFINITIONS,
    resourceView,
    state.cycle,
    claimView
  ).legal;

  const proposal = validateAgencyProposal({
    proposal: proposalSpec,
    actorId,
    legalActions,
    budget,
    resourceView,
    claimView
  });

  const resolutions = resolveAgencyActions({
    proposals: [proposal],
    snapshot: createAgencySnapshot(state),
    cycle: state.cycle
  });

  const [resolution] = resolutions;

  /*
   * The commit runs for EVERY resolution, successful or blocked.
   *
   * A blocked resolution is not a no-op: it is a RECORDED agency
   * event, and the belief correction is written from that event. A
   * refusal that was never committed would be a refusal nobody
   * learned from, which is the bug this whole phase exists to fix.
   */
  commitAgencyResolution(state, resolutions);

  return { proposal, resolution, legalActions };
}

/* ============================================================
   A) THE CORRECTION HAPPENS
============================================================ */

test("a refused attempt on a believed-but-absent resource corrects the belief", () => {
  const state = makeDivergedState();

  assert.equal(getClaimQuantity(state, "TED", "cigarette"), 3);
  assert.equal(getObjectiveQuantity(state, "TED", "cigarette"), 0);

  const { resolution } = attemptAction(state, "TED", {
    type: "HIDE",
    resourceId: "cigarette_stack_01",
    selected_objective: "endure"
  });

  assert.equal(resolution.status, "blocked");
  assert.equal(resolution.reason, "resource_unavailable");

  /*
   * The belief is corrected: the prisoner no longer believes they
   * hold the cigarettes they reached for and did not find.
   */
  assert.equal(getClaimQuantity(state, "TED", "cigarette"), 0);
});

test("the correction is recorded as a claim event, not applied silently", () => {
  const state = makeDivergedState();

  const { resolution } = attemptAction(state, "TED", {
    type: "HIDE",
    resourceId: "cigarette_stack_01",
    selected_objective: "endure"
  });

  const corrections = state.claimEvents.filter(
    (event) => event.cause.kind === CLAIM_EVENT_KINDS.BELIEF_CORRECTED
  );

  assert.equal(corrections.length, 1);

  const [correction] = corrections;

  assert.equal(correction.subjectId, "TED");
  assert.equal(correction.definitionId, "cigarette");
  assert.equal(correction.quantityBefore, 3);
  assert.equal(correction.quantityAfter, 0);
  assert.equal(correction.delta, -3);
  assert.equal(correction.cycle, 5);

  /*
   * The claim event points back at the RECORDED agency event, so the
   * refusal and the belief update are traceable to one another. This
   * is what preserves the determinism invariant: the belief moved
   * because of a recorded event, not because of prose.
   */
  const [agencyEvent] = state.agency.events;

  assert.ok(agencyEvent, "the refusal must be recorded as an agency event");
  assert.equal(correction.cause.sourceEventId, agencyEvent.eventId);
});

test("the correction points at the agency event that recorded the refusal", () => {
  const state = makeDivergedState();

  attemptAction(state, "TED", {
    type: "HIDE",
    resourceId: "cigarette_stack_01",
    selected_objective: "endure"
  });

  const [event] = state.agency.events;

  assert.ok(event, "the refusal must be recorded as an agency event");
  assert.equal(event.status, "blocked");
  assert.equal(event.provenance.resolutionReason, "resource_unavailable");

  /*
   * The correction is recorded ON the event, so a researcher reading
   * the export can see the refusal and the belief update together.
   */
  assert.ok(event.provenance.beliefCorrection);
  assert.equal(event.provenance.beliefCorrection.definitionId, "cigarette");
  assert.equal(event.provenance.beliefCorrection.claimed, 3);

  const corrections = state.claimEvents.filter(
    (item) => item.cause.kind === CLAIM_EVENT_KINDS.BELIEF_CORRECTED
  );

  assert.equal(corrections[0].cause.sourceEventId, event.eventId);
});

/* ============================================================
   B) THE DIVERGENCE RESOLVES
============================================================ */

test("the divergence resolves after the correction", () => {
  const state = makeDivergedState();

  assert.ok(
    state.claimDivergence?.TED?.cigarette,
    "the divergence should exist before the attempt"
  );

  attemptAction(state, "TED", {
    type: "HIDE",
    resourceId: "cigarette_stack_01",
    selected_objective: "endure"
  });

  assert.equal(
    state.claimDivergence?.TED?.cigarette,
    undefined,
    "the divergence should be gone after the correction"
  );
});

test("the corrected belief no longer appears in the claimed inventory", () => {
  const state = makeDivergedState();

  const before = buildClaimView(state, "TED", state.cycle);

  assert.equal(before.believed.cigarette, 3);
  assert.equal(before.live.length, 1);
  assert.equal(livesResourceId(before, "cigarette_stack_01"), true);

  attemptAction(state, "TED", {
    type: "HIDE",
    resourceId: "cigarette_stack_01",
    selected_objective: "endure"
  });

  const after = buildClaimView(state, "TED", state.cycle);

  assert.equal(after.believed.cigarette, undefined);
  assert.equal(after.live.length, 0);
  assert.equal(after.stale.length, 0);
  assert.equal(livesResourceId(after, "cigarette_stack_01"), false);
});

test("subsequent cycles no longer offer the action", () => {
  const state = makeDivergedState();

  const first = attemptAction(state, "TED", {
    type: "HIDE",
    resourceId: "cigarette_stack_01",
    selected_objective: "endure"
  });

  assert.equal(first.resolution.status, "blocked");
  assert.equal(first.resolution.reason, "resource_unavailable");

  /*
   * The action was offered because the BELIEF satisfied `holdAny`.
   * With the belief corrected, the resource gate closes against
   * reality and the action is no longer legal. The refusal now
   * happens at the PROPOSAL, before any reach is attempted, so the
   * reason is `action_not_legal` rather than `resource_unavailable`.
   */
  const second = attemptAction(state, "TED", {
    type: "HIDE",
    resourceId: "cigarette_stack_01",
    selected_objective: "endure"
  });

  assert.equal(second.proposal.accepted, false);
  assert.equal(second.proposal.reason, "action_not_legal");

  const hide = second.legalActions.find((entry) => entry.type === "HIDE");

  assert.equal(hide, undefined, "HIDE should no longer be legal");
});

test("the belief stays corrected on later cycles", () => {
  const state = makeDivergedState();

  attemptAction(state, "TED", {
    type: "HIDE",
    resourceId: "cigarette_stack_01",
    selected_objective: "endure"
  });

  state.cycle += 5;

  assert.equal(getClaimQuantity(state, "TED", "cigarette"), 0);
  assert.equal(
    state.claimDivergence?.TED?.cigarette,
    undefined,
    "the divergence must not reappear once it has been resolved"
  );
});

/* ============================================================
   C) THE CORRECTION CONVERGES ONTO REALITY
============================================================ */

test("the correction converges onto the reality, not onto zero", () => {
  /*
   * TED believes he holds six cigarettes across two stacks. AM took
   * one stack silently, so reality holds three.
   *
   * A naive "set the belief to zero" correction would leave him
   * believing zero while reality holds three — a NEW divergence in
   * the opposite direction. The correction must converge the belief
   * onto the objective quantity instead.
   */
  const state = makePartiallyDivergedState();

  assert.equal(getClaimQuantity(state, "TED", "cigarette"), 6);
  assert.equal(getObjectiveQuantity(state, "TED", "cigarette"), 3);

  attemptAction(state, "TED", {
    type: "HIDE",
    resourceId: "cigarette_stack_01",
    selected_objective: "endure"
  });

  assert.equal(getClaimQuantity(state, "TED", "cigarette"), 3);
  assert.equal(getObjectiveQuantity(state, "TED", "cigarette"), 3);

  assert.equal(
    state.claimDivergence?.TED?.cigarette,
    undefined,
    "the belief and the reality should now agree"
  );
});

/* ============================================================
   D) OTHER REFUSALS DO NOT CORRECT BELIEFS
============================================================ */

test("a capability refusal does not correct a belief", () => {
  const state = makeDivergedState();

  /*
   * The prisoner reaches for the cigarette with hands that cannot
   * work. The refusal says nothing about whether their memory of
   * their holdings was wrong, so the belief must survive.
   *
   * The capability gate is the ENUMERATOR's: a prisoner whose hands
   * cannot work is not offered the action at all, so the proposal
   * never reaches the resolver and no reach ever happens. Nothing
   * can be learned from a refusal that was never attempted.
   */
  state.sims.TED.constraints = [
    { id: "overhead_restraint", remaining: 0, stacks: 1, intensity: 1, elapsed: 0 }
  ];

  const { proposal, legalActions } = attemptAction(state, "TED", {
    type: "HIDE",
    resourceId: "cigarette_stack_01",
    selected_objective: "endure"
  });

  assert.equal(proposal.accepted, false);
  assert.equal(proposal.reason, "action_not_legal");

  const hide = legalActions.find((entry) => entry.type === "HIDE");

  assert.equal(hide, undefined, "HIDE must not be offered to bound hands");

  assert.equal(
    getClaimQuantity(state, "TED", "cigarette"),
    3,
    "a capability refusal must not correct the belief"
  );

  assert.equal(
    state.claimEvents.filter(
      (event) => event.cause.kind === CLAIM_EVENT_KINDS.BELIEF_CORRECTED
    ).length,
    0
  );
});

test("a budget refusal does not correct a belief", () => {
  const state = makeDivergedState();

  const { proposal } = attemptAction(
    state,
    "TED",
    {
      type: "HIDE",
      resourceId: "cigarette_stack_01",
      selected_objective: "endure"
    },
    { budget: 0 }
  );

  assert.equal(proposal.accepted, false);
  assert.equal(proposal.reason, "budget_exceeded");

  assert.equal(
    getClaimQuantity(state, "TED", "cigarette"),
    3,
    "a budget refusal must not correct the belief"
  );
});

test("a proposal rejected before the attempt does not correct a belief", () => {
  const state = makeDivergedState();

  /*
   * A stale divergence cannot license a proposal at all, so no reach
   * ever happens and nothing can be learned.
   */
  state.cycle = 5 + DIVERGENCE_RECENCY_WINDOW + 1;

  const { proposal } = attemptAction(state, "TED", {
    type: "HIDE",
    resourceId: "cigarette_stack_01",
    selected_objective: "endure"
  });

  assert.equal(proposal.accepted, false);

  assert.equal(
    getClaimQuantity(state, "TED", "cigarette"),
    3,
    "a proposal rejected before the attempt must not correct the belief"
  );
});

test("a refusal on a resource the prisoner really holds does not correct a belief", () => {
  /*
   * The prisoner holds the stack for real. If the attempt is refused
   * for some other reason, the refusal is not evidence about their
   * memory, and correcting the belief would be a lie.
   */
  const state = makeState();
  state.resources.instances = [cigaretteStack({ concealed: true })];

  seedResources(state.resources, state);

  assert.equal(getClaimQuantity(state, "TED", "cigarette"), 3);

  const { proposal, resolution } = attemptAction(state, "TED", {
    type: "HIDE",
    resourceId: "cigarette_stack_01",
    selected_objective: "endure"
  });

  assert.equal(proposal.accepted, true);
  assert.equal(resolution.status, "success");

  assert.equal(getClaimQuantity(state, "TED", "cigarette"), 3);
});

/* ============================================================
   E) THE CORRECTION IS NARROWLY SCOPED
============================================================ */

test("a refusal about a DEFINED resource corrects that belief", () => {
  /*
   * The prisoner believes they hold a dirty water stack that AM
   * took silently. They reach for it with CONSUME, which requires
   * dirty water and which the resolver refuses with
   * `resource_unavailable`.
   *
   * The resolver knows the definition it was missing, and it
   * matches the belief, so the belief moves.
   */
  const state = makeState();

  /*
   * `seedResources()` REPLACES the instance list, so the water stack
   * is added afterwards and seeded into the claim ledger with it.
   */
  seedResources(state.resources, state);

  state.resources.instances.push({
    resourceId: "dirty_water_stack_01",
    definitionId: "dirty_water",
    quantity: 1,
    holderId: "TED",
    locationId: null,
    accessible: true,
    concealed: false,
    provenance: { source: "test" }
  });

  recordClaimEvent(state, {
    subjectId: "TED",
    definitionId: "dirty_water",
    delta: 1,
    cycle: state.cycle,
    cause: {
      kind: CLAIM_EVENT_KINDS.SEED,
      resourceId: "dirty_water_stack_01"
    }
  });

  commitResourceInterventions(state, [{
    intervention_type: "confiscate",
    resource_id: "dirty_water_stack_01",
    holder_id: "TED",
    disclosure: CLAIM_DISCLOSURES.SILENT,
    rationale: "Take it without telling him."
  }]);

  assert.equal(getClaimQuantity(state, "TED", "dirty_water"), 1);
  assert.equal(getObjectiveQuantity(state, "TED", "dirty_water"), 0);

  const { resolution } = attemptAction(state, "TED", {
    type: "CONSUME",
    resourceId: "dirty_water_stack_01",
    selected_objective: "endure"
  });

  assert.equal(resolution.status, "blocked");
  assert.equal(resolution.reason, "resource_unavailable");

  assert.equal(
    getClaimQuantity(state, "TED", "dirty_water"),
    0,
    "the belief about the missing definition must be corrected"
  );
});

test("a refusal about a different definition leaves the belief alone", () => {
  /*
   * The prisoner believes they hold a CIGARETTE that AM took. They
   * reach for it with CONSUME, but CONSUME only drinks dirty water
   * and is therefore not legal for a cigarette at all.
   *
   * The proposal is refused before the resolver ever sees it, so no
   * reach happens and nothing is learned. The refusal says nothing
   * about the prisoner's memory of the cigarette: they were right
   * that they held a cigarette, they were wrong that it was
   * drinkable.
   */
  const state = makeDivergedState();

  const { proposal } = attemptAction(state, "TED", {
    type: "CONSUME",
    resourceId: "cigarette_stack_01",
    selected_objective: "endure"
  });

  assert.equal(proposal.accepted, false);
  assert.equal(proposal.reason, "action_not_legal");

  assert.equal(
    getClaimQuantity(state, "TED", "cigarette"),
    3,
    "a refusal about another definition must not correct this belief"
  );
});

test("a smoke refusal corrects the belief about the definition that was missing", () => {
  /*
   * SMOKE draws on a LIST of definitions, so its refusal can be
   * about any one of them. TED really holds a cigarette and
   * believes they hold a match that AM took silently.
   *
   * The refusal is `resource_unavailable` and it is about the
   * MATCH, so the match belief is what moves. The cigarette belief
   * was never wrong and must not move.
   */
  const state = makeState();

  seedResources(state.resources, state);

  /*
   * The seed gives ELLEN the matches. TED believes they hold the
   * same match stack, which is the divergence.
   */
  recordClaimEvent(state, {
    subjectId: "TED",
    definitionId: "match",
    delta: 2,
    cycle: state.cycle,
    cause: {
      kind: CLAIM_EVENT_KINDS.SEED,
      resourceId: "match_stack_01"
    }
  });

  /*
   * `recordClaimEvent` writes the ledger; the divergence is a
   * derived view and has to be refreshed before anything can read
   * it. The production path does this at the end of every commit.
   */
  refreshClaimDivergence(state);

  assert.equal(getClaimQuantity(state, "TED", "match"), 2);
  assert.equal(getObjectiveQuantity(state, "TED", "match"), 0);

  const { resolution } = attemptAction(state, "TED", {
    type: "SMOKE",
    selected_objective: "endure"
  });

  assert.equal(resolution.status, "blocked");
  assert.equal(resolution.reason, "resource_unavailable");

  assert.equal(
    getClaimQuantity(state, "TED", "match"),
    0,
    "the belief about the missing match must be corrected"
  );

  assert.equal(
    getClaimQuantity(state, "TED", "cigarette"),
    3,
    "the cigarette belief was never wrong and must not move"
  );
});

test("a transfer refusal does not correct the belief", () => {
  /*
   * The resolver refuses a TRANSFER with `transfer_unavailable`, not
   * `resource_unavailable`, so the transfer refusal is currently
   * OUT OF SCOPE for belief resolution.
   *
   * This test pins the current behaviour rather than endorsing it.
   * The refusal narrative ("You reached to hand it over and there
   * was nothing there to give") says exactly the same thing about
   * the prisoner's memory as the HIDE refusal does, so treating
   * the two refusals differently is an inconsistency in the design
   * rather than a considered distinction.
   */
  const state = makeDivergedState();

  const { resolution } = attemptAction(state, "TED", {
    type: "TRANSFER",
    resourceId: "cigarette_stack_01",
    targetId: "ELLEN",
    selected_objective: "endure"
  });

  assert.equal(resolution.status, "blocked");
  assert.equal(resolution.reason, "transfer_unavailable");

  assert.equal(
    getClaimQuantity(state, "TED", "cigarette"),
    3,
    "the transfer refusal is out of scope for belief resolution"
  );
});

/* ============================================================
   F) THE CORRECTION IS EXACTLY ONCE
============================================================ */

test("the correction fires once and never drives the belief negative", () => {
  const state = makeDivergedState();

  attemptAction(state, "TED", {
    type: "HIDE",
    resourceId: "cigarette_stack_01",
    selected_objective: "endure"
  });

  const corrections = state.claimEvents.filter(
    (event) => event.cause.kind === CLAIM_EVENT_KINDS.BELIEF_CORRECTED
  );

  assert.equal(corrections.length, 1);
  assert.equal(getClaimQuantity(state, "TED", "cigarette"), 0);

  /*
   * A second correction finds nothing to correct, so it writes
   * nothing at all rather than a zero-delta event.
   */
  const second = recordBeliefCorrection(state, {
    subjectId: "TED",
    definitionId: "cigarette",
    cycle: state.cycle
  });

  assert.equal(second, null);
  assert.equal(
    state.claimEvents.filter(
      (event) => event.cause.kind === CLAIM_EVENT_KINDS.BELIEF_CORRECTED
    ).length,
    1
  );
});

test("a correction never raises a belief that is already below reality", () => {
  const state = makeState();

  /*
   * The prisoner really holds three cigarettes.
   */
  state.resources.instances = [cigaretteStack()];

  seedResources(state.resources, state);

  /*
   * The prisoner believes ONE cigarette and reality holds three. A
   * refusal proves something is missing; it never proves the
   * prisoner holds MORE than they thought, so the belief is left
   * alone.
   */
  state.claimState = { TED: { cigarette: 1 } };

  const recorded = recordBeliefCorrection(state, {
    subjectId: "TED",
    definitionId: "cigarette",
    cycle: state.cycle
  });

  assert.equal(recorded, null);
  assert.equal(getClaimQuantity(state, "TED", "cigarette"), 1);
});

/* ============================================================
   G) DETERMINISM AND PERSISTENCE
============================================================ */

test("the correction is deterministic across identical runs", () => {
  const run = () => {
    const state = makeDivergedState();

    attemptAction(state, "TED", {
      type: "HIDE",
      resourceId: "cigarette_stack_01",
      selected_objective: "endure"
    });

    return {
      claimState: JSON.stringify(state.claimState),
      divergence: JSON.stringify(state.claimDivergence),
      events: JSON.stringify(
        state.claimEvents.map((event) => ({
          eventId: event.eventId,
          subjectId: event.subjectId,
          definitionId: event.definitionId,
          quantityBefore: event.quantityBefore,
          quantityAfter: event.quantityAfter,
          delta: event.delta,
          kind: event.cause.kind,
          sourceEventId: event.cause.sourceEventId
        }))
      )
    };
  };

  assert.deepEqual(run(), run());
});

test("the correction survives a save and load round trip", () => {
  /*
   * The claim ledger is the authority for what a prisoner believes.
   * A save carries the claim EVENTS, and the projection is rebuilt
   * from them, so a corrected belief must still be corrected after a
   * round trip.
   */
  const state = makeDivergedState();

  attemptAction(state, "TED", {
    type: "HIDE",
    resourceId: "cigarette_stack_01",
    selected_objective: "endure"
  });

  const saved = JSON.parse(JSON.stringify({
    claimEvents: state.claimEvents,
    claimEventSequence: state.claimEventSequence,
    resources: state.resources,
    resourceEvents: state.resourceEvents
  }));

  const restored = makeState({
    claimEvents: saved.claimEvents,
    claimEventSequence: saved.claimEventSequence,
    resources: saved.resources,
    resourceEvents: saved.resourceEvents
  });

  /*
   * Rebuilding the derived views from the ledger is what the engine
   * does at the start of every cycle.
   */
  rebuildClaimState(restored);

  assert.equal(getClaimQuantity(restored, "TED", "cigarette"), 0);
  assert.equal(restored.claimDivergence?.TED?.cigarette, undefined);
});
