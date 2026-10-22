import assert from "node:assert/strict";
import test from "node:test";

import {
  CLAIM_DISCLOSURES,
  CLAIM_EVENT_KINDS,
  DIVERGENCE_RECENCY_WINDOW,
  getClaimQuantity,
  recordClaimEvent
} from "../engine/agency/claimLedger.js";
import {
  buildClaimView,
  livesResourceId
} from "../engine/agency/claimView.js";
import {
  createResourceLedger,
  seedResources
} from "../engine/agency/resourceLedger.js";
import {
  commitResourceInterventions
} from "../engine/analysis/commitResourceInterventions.js";
import { enumerateLegalActions } from "../engine/agency/legalActions.js";
import { ACTION_DEFINITIONS } from "../engine/agency/actionDefs.js";
import { validateAgencyProposal } from "../engine/agency/proposal.js";
import {
  createAgencySnapshot,
  resolveAgencyActions
} from "../engine/agency/resolve.js";
import { commitAgencyResolution } from "../engine/agency/commit.js";
import { createAgencyState } from "../engine/agency/state/createAgencyState.js";
import { getAgencyEventsForReview } from "../engine/agency/events.js";
import { buildAgencyProposalPrompt } from "../prompts/agencyProposal.js";
import { buildScratchpadCommsPrompt } from "../prompts/scratchpadComms.js";
import { buildResourceView } from "../engine/agency/resourceLedger.js";

/* ============================================================
   HELPERS
   ============================================================ */

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
 * A state in which TED's cigarettes were confiscated SILENTLY.
 *
 * This is the divergence the whole phase exists for: TED believes he
 * holds three cigarettes, and objectively holds none. He has never
 * been told.
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
 * A state in which TED's cigarettes AND TED's matches were both
 * confiscated silently.
 *
 * SMOKE needs the same actor to hold a cigarette and a match, so a
 * diverged cigarette alone is not enough to make SMOKE legal: the
 * match requirement still fails against reality.
 */
function makeDivergedWithMatchesState({ cycle = 5 } = {}) {
  const state = makeState({ cycle });
  state.resources.instances = [cigaretteStack()];

  /*
   * `seedResources()` REPLACES the instance list with the catalogue
   * seed, so TED's own match is added afterwards.
   */
  seedResources(state.resources, state);

  state.resources.instances.push({
    resourceId: "ted_match_stack_01",
    definitionId: "match",
    quantity: 2,
    holderId: "TED",
    locationId: null,
    accessible: true,
    concealed: false,
    provenance: { source: "test" }
  });

  recordClaimEvent(state, {
    subjectId: "TED",
    definitionId: "match",
    delta: 2,
    cycle,
    cause: { kind: CLAIM_EVENT_KINDS.SEED }
  });

  commitResourceInterventions(state, [{
    intervention_type: "confiscate",
    resource_id: "cigarette_stack_01",
    holder_id: "TED",
    disclosure: CLAIM_DISCLOSURES.SILENT,
    rationale: "Take it without telling him."
  }]);

  commitResourceInterventions(state, [{
    intervention_type: "confiscate",
    resource_id: "ted_match_stack_01",
    holder_id: "TED",
    disclosure: CLAIM_DISCLOSURES.SILENT,
    rationale: "Take it without telling him."
  }]);

  return state;
}

/*
 * A prisoner with no capabilities at all, so every resource-bearing
 * action is decided by the RESOURCE gate rather than the capability
 * gate. This keeps the tests about the claim-aware gate rather than
 * about postures.
 */
const FULL_CAPABILITIES = Object.freeze({
  mobility: 1,
  stability: 1,
  handUse: 1,
  concentration: 1,
  interactionReach: 1
});

/* ============================================================
   A) THE CLAIM VIEW
   ============================================================ */

test("the claim view reports what the prisoner believes they hold", () => {
  const state = makeDivergedState();
  const claimView = buildClaimView(state, "TED", state.cycle);

  assert.equal(claimView.simId, "TED");
  assert.equal(claimView.believed.cigarette, 3);
  assert.equal(getClaimQuantity(state, "TED", "cigarette"), 3);
});

test("the claim view carries the live divergence and the believed resource id", () => {
  const state = makeDivergedState();
  const claimView = buildClaimView(state, "TED", state.cycle);

  assert.equal(claimView.live.length, 1);
  assert.equal(claimView.live[0].definitionId, "cigarette");
  assert.equal(claimView.live[0].claimed, 3);
  assert.equal(claimView.live[0].objective, 0);
  assert.equal(claimView.live[0].claimedResourceId, "cigarette_stack_01");
  assert.equal(livesResourceId(claimView, "cigarette_stack_01"), true);
});

test("a prisoner with no divergence has no live claim", () => {
  const state = makeState();
  state.resources.instances = [cigaretteStack()];

  seedResources(state.resources, state);

  const claimView = buildClaimView(state, "TED", state.cycle);

  assert.deepEqual(claimView.live, []);
  assert.deepEqual(claimView.stale, []);
  assert.equal(livesResourceId(claimView, "cigarette_stack_01"), false);
});

/* ============================================================
   B) THE CLAIM-AWARE LEGAL ACTION ENUMERATION
   ============================================================ */

test("an action resting on a claimed-but-absent resource is offered with the flag", () => {
  const state = makeDivergedWithMatchesState();
  const claimView = buildClaimView(state, "TED", state.cycle);

  const resourceView = buildResourceView(state.resources, "TED");

  const result = enumerateLegalActions(
    state.sims.TED,
    FULL_CAPABILITIES,
    ACTION_DEFINITIONS,
    resourceView,
    state.cycle,
    claimView
  );

  const smoke = result.legal.find((entry) => entry.type === "SMOKE");

  assert.ok(smoke, "SMOKE should be offered to a prisoner who believes they hold a cigarette");
  assert.equal(smoke.claimedButAbsent, true);
  assert.ok(smoke.claimedDefinitions.includes("cigarette"));
});

test("without the divergence the same action is blocked and carries no flag", () => {
  const state = makeState();
  state.resources.instances = [cigaretteStack()];

  seedResources(state.resources, state);

  const claimView = buildClaimView(state, "TED", state.cycle);
  const resourceView = buildResourceView(state.resources, "TED");

  const result = enumerateLegalActions(
    state.sims.TED,
    FULL_CAPABILITIES,
    ACTION_DEFINITIONS,
    resourceView,
    state.cycle,
    claimView
  );

  const smoke = result.legal.find((entry) => entry.type === "SMOKE");

  assert.equal(smoke, undefined);

  const blocked = result.blocked.find((entry) => entry.type === "SMOKE");

  assert.ok(blocked, "SMOKE should be blocked for a prisoner holding nothing");
  assert.equal(blocked.reason, "resource_requirement_unmet");
});

test("a STALE divergence does not offer the claimed-but-absent action", () => {
  const state = makeDivergedState({ cycle: 5 });

  /*
   * Move the world past the recency window. The belief is still
   * wrong, but the confusion is no longer news, so the engine must
   * not keep offering the prisoner an attempt that will be refused.
   */
  const laterCycle = 5 + DIVERGENCE_RECENCY_WINDOW + 1;

  const claimView = buildClaimView(state, "TED", laterCycle);

  assert.deepEqual(claimView.live, [], "the divergence should be stale by now");
  assert.equal(claimView.stale.length, 1, "but the belief is still recorded");

  const resourceView = buildResourceView(state.resources, "TED");

  const result = enumerateLegalActions(
    state.sims.TED,
    FULL_CAPABILITIES,
    ACTION_DEFINITIONS,
    resourceView,
    laterCycle,
    claimView
  );

  const smoke = result.legal.find((entry) => entry.type === "SMOKE");

  assert.equal(smoke, undefined);
  assert.equal(
    result.blocked.find((entry) => entry.type === "SMOKE")?.reason,
    "resource_requirement_unmet"
  );
});

test("a prisoner with NO claim cannot be offered the action", () => {
  const state = makeState();
  state.resources.instances = [cigaretteStack()];

  seedResources(state.resources, state);

  const claimView = buildClaimView(state, "ELLEN", state.cycle);
  const resourceView = buildResourceView(state.resources, "ELLEN");

  const result = enumerateLegalActions(
    state.sims.ELLEN,
    FULL_CAPABILITIES,
    ACTION_DEFINITIONS,
    resourceView,
    state.cycle,
    claimView
  );

  assert.equal(
    result.legal.find((entry) => entry.type === "SMOKE"),
    undefined
  );
});

/* ============================================================
   C) THE CLAIM-AWARE PROPOSAL VALIDATION
   ============================================================ */

test("a prisoner with a claimed-but-absent resource can propose an action on it", () => {
  const state = makeDivergedState();
  const claimView = buildClaimView(state, "TED", state.cycle);
  const resourceView = buildResourceView(state.resources, "TED");

  const legalActions = enumerateLegalActions(
    state.sims.TED,
    FULL_CAPABILITIES,
    ACTION_DEFINITIONS,
    resourceView,
    state.cycle,
    claimView
  ).legal;

  const proposal = validateAgencyProposal({
    proposal: {
      type: "HIDE",
      resourceId: "cigarette_stack_01",
      selected_objective: "endure"
    },
    actorId: "TED",
    legalActions,
    budget: 3,
    resourceView,
    claimView
  });

  assert.equal(proposal.accepted, true);
  assert.equal(proposal.reason, null);
  assert.equal(proposal.action.resourceId, "cigarette_stack_01");
});

test("a prisoner with NO claim on a resource cannot propose an action on it", () => {
  const state = makeDivergedState();
  const claimView = buildClaimView(state, "ELLEN", state.cycle);
  const resourceView = buildResourceView(state.resources, "ELLEN");

  const legalActions = enumerateLegalActions(
    state.sims.ELLEN,
    FULL_CAPABILITIES,
    ACTION_DEFINITIONS,
    resourceView,
    state.cycle,
    claimView
  ).legal;

  const proposal = validateAgencyProposal({
    proposal: {
      type: "HIDE",
      resourceId: "cigarette_stack_01",
      selected_objective: "endure"
    },
    actorId: "ELLEN",
    legalActions,
    budget: 3,
    resourceView,
    claimView
  });

  assert.equal(proposal.accepted, false);
  assert.equal(proposal.reason, "resource_unavailable");
});

test("a STALE divergence cannot license a proposal on the believed resource", () => {
  /*
   * TED really holds a match, so HIDE stays legal on its own
   * account. What the staleness removes is the permission to NAME
   * the cigarette they used to hold.
   */
  const state = makeDivergedState({ cycle: 5 });

  state.resources.instances.push({
    resourceId: "ted_match_stack_01",
    definitionId: "match",
    quantity: 2,
    holderId: "TED",
    locationId: null,
    accessible: true,
    concealed: false,
    provenance: { source: "test" }
  });

  const laterCycle = 5 + DIVERGENCE_RECENCY_WINDOW + 1;

  const claimView = buildClaimView(state, "TED", laterCycle);
  const resourceView = buildResourceView(state.resources, "TED");

  const legalActions = enumerateLegalActions(
    state.sims.TED,
    FULL_CAPABILITIES,
    ACTION_DEFINITIONS,
    resourceView,
    laterCycle,
    claimView
  ).legal;

  /*
   * HIDE is still offered as an action TYPE, because TED really
   * holds a match. But it is no longer flagged as resting on a
   * belief: the cigarette belief has gone stale.
   */
  assert.ok(
    legalActions.some((entry) => entry.type === "HIDE"),
    "HIDE should still be offered as an action type"
  );

  assert.equal(
    legalActions.find((entry) => entry.type === "HIDE")?.claimedButAbsent,
    undefined,
    "the stale belief should not flag the action"
  );

  const proposal = validateAgencyProposal({
    proposal: {
      type: "HIDE",
      resourceId: "cigarette_stack_01",
      selected_objective: "endure"
    },
    actorId: "TED",
    legalActions,
    budget: 3,
    resourceView,
    claimView
  });

  assert.equal(proposal.accepted, false);
  assert.equal(proposal.reason, "resource_unavailable");
});

/* ============================================================
   D) THE RESOLVER REMAINS THE AUTHORITY
   ============================================================ */

test("the resolver blocks the claimed-but-absent action with resource_unavailable", () => {
  const state = makeDivergedState();
  const claimView = buildClaimView(state, "TED", state.cycle);
  const resourceView = buildResourceView(state.resources, "TED");

  const legalActions = enumerateLegalActions(
    state.sims.TED,
    FULL_CAPABILITIES,
    ACTION_DEFINITIONS,
    resourceView,
    state.cycle,
    claimView
  ).legal;

  const proposal = validateAgencyProposal({
    proposal: {
      type: "HIDE",
      resourceId: "cigarette_stack_01",
      selected_objective: "endure"
    },
    actorId: "TED",
    legalActions,
    budget: 3,
    resourceView,
    claimView
  });

  const resolutions = resolveAgencyActions({
    proposals: [proposal],
    snapshot: createAgencySnapshot(state),
    cycle: state.cycle
  });

  const [resolution] = resolutions;

  assert.equal(resolution.status, "blocked");
  assert.equal(resolution.reason, "resource_unavailable");

  /*
   * The resolver's authority is unchanged: it validated against the
   * OBJECTIVE snapshot and refused. Nothing in the claim path wrote
   * to the objective ledger.
   */
  assert.equal(
    state.resources.instances.find(
      (instance) => instance.holderId === "TED"
    ),
    undefined
  );
});

test("the resolver blocks a SMOKE whose cigarette is only believed", () => {
  const state = makeDivergedWithMatchesState();
  const claimView = buildClaimView(state, "TED", state.cycle);
  const resourceView = buildResourceView(state.resources, "TED");

  const legalActions = enumerateLegalActions(
    state.sims.TED,
    FULL_CAPABILITIES,
    ACTION_DEFINITIONS,
    resourceView,
    state.cycle,
    claimView
  ).legal;

  const proposal = validateAgencyProposal({
    proposal: { type: "SMOKE", selected_objective: "endure" },
    actorId: "TED",
    legalActions,
    budget: 3,
    resourceView,
    claimView
  });

  assert.equal(proposal.accepted, true);

  const resolutions = resolveAgencyActions({
    proposals: [proposal],
    snapshot: createAgencySnapshot(state),
    cycle: state.cycle
  });

  assert.equal(resolutions[0].status, "blocked");
  assert.equal(resolutions[0].reason, "resource_unavailable");
});

/* ============================================================
   E) THE BLOCK REASON REACHES THE PRISONER
   ============================================================ */

test("the block reason reaches the prisoner's next scratchpad review", () => {
  const state = makeDivergedState();
  const claimView = buildClaimView(state, "TED", state.cycle);
  const resourceView = buildResourceView(state.resources, "TED");

  const legalActions = enumerateLegalActions(
    state.sims.TED,
    FULL_CAPABILITIES,
    ACTION_DEFINITIONS,
    resourceView,
    state.cycle,
    claimView
  ).legal;

  const proposal = validateAgencyProposal({
    proposal: {
      type: "HIDE",
      resourceId: "cigarette_stack_01",
      selected_objective: "endure"
    },
    actorId: "TED",
    legalActions,
    budget: 3,
    resourceView,
    claimView
  });

  const resolutions = resolveAgencyActions({
    proposals: [proposal],
    snapshot: createAgencySnapshot(state),
    cycle: state.cycle
  });

  commitAgencyResolution(state, resolutions);

  const [event] = state.agency.events;

  assert.equal(event.status, "blocked");
  assert.equal(event.provenance.resolutionReason, "resource_unavailable");

  /*
   * The review happens on the NEXT cycle, and it selects the events
   * of the cycle before it.
   */
  const reviewCycle = state.cycle + 1;
  const reviewEvents = getAgencyEventsForReview(
    state.agency.events,
    "TED",
    reviewCycle
  );

  assert.equal(reviewEvents.length, 1);
  assert.equal(reviewEvents[0], event);

  const prompt = buildScratchpadCommsPrompt(
    state.sims.TED,
    [],
    state,
    reviewEvents
  );

  assert.match(prompt, /resource_unavailable/);
});

test("the block reason is rendered as a sentence the prisoner can narrate", () => {
  const state = makeDivergedState();
  const claimView = buildClaimView(state, "TED", state.cycle);
  const resourceView = buildResourceView(state.resources, "TED");

  const legalActions = enumerateLegalActions(
    state.sims.TED,
    FULL_CAPABILITIES,
    ACTION_DEFINITIONS,
    resourceView,
    state.cycle,
    claimView
  ).legal;

  const proposal = validateAgencyProposal({
    proposal: {
      type: "HIDE",
      resourceId: "cigarette_stack_01",
      selected_objective: "endure"
    },
    actorId: "TED",
    legalActions,
    budget: 3,
    resourceView,
    claimView
  });

  const resolutions = resolveAgencyActions({
    proposals: [proposal],
    snapshot: createAgencySnapshot(state),
    cycle: state.cycle
  });

  commitAgencyResolution(state, resolutions);

  const reviewEvents = getAgencyEventsForReview(
    state.agency.events,
    "TED",
    state.cycle + 1
  );

  const prompt = buildScratchpadCommsPrompt(
    state.sims.TED,
    [],
    state,
    reviewEvents
  );

  /*
   * The sentence has to name the action AND say the thing was not
   * there, because that is what the prisoner has to understand.
   */
  assert.match(prompt, /WHAT YOU EXPERIENCED/);
  assert.match(prompt, /You tried to conceal cigarette_stack_01/);
  assert.match(prompt, /there was nothing there/);
});

test("the narrative never tells the prisoner WHO took the thing", () => {
  const state = makeDivergedState();
  const claimView = buildClaimView(state, "TED", state.cycle);
  const resourceView = buildResourceView(state.resources, "TED");

  const legalActions = enumerateLegalActions(
    state.sims.TED,
    FULL_CAPABILITIES,
    ACTION_DEFINITIONS,
    resourceView,
    state.cycle,
    claimView
  ).legal;

  const proposal = validateAgencyProposal({
    proposal: {
      type: "HIDE",
      resourceId: "cigarette_stack_01",
      selected_objective: "endure"
    },
    actorId: "TED",
    legalActions,
    budget: 3,
    resourceView,
    claimView
  });

  const resolutions = resolveAgencyActions({
    proposals: [proposal],
    snapshot: createAgencySnapshot(state),
    cycle: state.cycle
  });

  commitAgencyResolution(state, resolutions);

  const reviewEvents = getAgencyEventsForReview(
    state.agency.events,
    "TED",
    state.cycle + 1
  );

  const prompt = buildScratchpadCommsPrompt(
    state.sims.TED,
    [],
    state,
    reviewEvents
  );

  /*
   * Telling the prisoner that AM took it would collapse the
   * divergence the engine is keeping open.
   */
  assert.doesNotMatch(prompt, /AM (took|confiscated)/i);
});

/* ============================================================
   F) THE PROPOSAL PROMPT
   ============================================================ */

test("the proposal prompt includes both the believed and the actual holdings", () => {
  const state = makeDivergedState();
  const claimView = buildClaimView(state, "TED", state.cycle);
  const resourceView = buildResourceView(state.resources, "TED");

  const legalActions = enumerateLegalActions(
    state.sims.TED,
    FULL_CAPABILITIES,
    ACTION_DEFINITIONS,
    resourceView,
    state.cycle,
    claimView
  ).legal;

  const prompt = buildAgencyProposalPrompt(
    state.sims.TED,
    legalActions,
    3,
    resourceView,
    claimView
  );

  assert.match(prompt, /\[YOUR RESOURCES - BELIEVED\]/);
  assert.match(prompt, /\[YOUR RESOURCES - ACTUAL\]/);

  /*
   * The prisoner believes they hold three cigarettes and objectively
   * hold none. Both numbers have to be in the prompt, or one of the
   * two ledgers is being silently hidden from them.
   */
  const believedIndex = prompt.indexOf("[YOUR RESOURCES - BELIEVED]");
  const actualIndex = prompt.indexOf("[YOUR RESOURCES - ACTUAL]");

  const believedBlock = prompt.slice(believedIndex, actualIndex);
  const actualBlock = prompt.slice(actualIndex);

  assert.match(believedBlock, /cigarette: 3/);
  assert.match(actualBlock, /cigarette: 0|\(none\)/);
});

test("the proposal prompt annotates the claimed-but-absent action", () => {
  const state = makeDivergedState();
  const claimView = buildClaimView(state, "TED", state.cycle);
  const resourceView = buildResourceView(state.resources, "TED");

  const legalActions = enumerateLegalActions(
    state.sims.TED,
    FULL_CAPABILITIES,
    ACTION_DEFINITIONS,
    resourceView,
    state.cycle,
    claimView
  ).legal;

  const prompt = buildAgencyProposalPrompt(
    state.sims.TED,
    legalActions,
    3,
    resourceView,
    claimView
  );

  assert.match(prompt, /claimedButAbsent/);
  assert.match(prompt, /you believe you still hold/i);

  /*
   * The annotation has to name the actual resource id. The prisoner
   * has to put that id in the proposal, and an internal requirement
   * key such as "holdAny" would mean nothing to them.
   */
  assert.match(prompt, /cigarette_stack_01/);
  assert.doesNotMatch(prompt, /holdAny/);
});

test("the proposal prompt is unchanged in substance when there is no divergence", () => {
  const state = makeState();
  state.resources.instances = [cigaretteStack()];

  seedResources(state.resources, state);

  const claimView = buildClaimView(state, "TED", state.cycle);
  const resourceView = buildResourceView(state.resources, "TED");

  const legalActions = enumerateLegalActions(
    state.sims.TED,
    FULL_CAPABILITIES,
    ACTION_DEFINITIONS,
    resourceView,
    state.cycle,
    claimView
  ).legal;

  const prompt = buildAgencyProposalPrompt(
    state.sims.TED,
    legalActions,
    3,
    resourceView,
    claimView
  );

  assert.match(prompt, /\[YOUR RESOURCES - BELIEVED\]/);
  assert.match(prompt, /\[YOUR RESOURCES - ACTUAL\]/);

  /*
   * With no divergence the two inventories agree, so no action is
   * flagged as claimed-but-absent.
   */
  assert.doesNotMatch(prompt, /"claimedButAbsent": true/);
});

/* ============================================================
   G) THE RESOLVER'S AUTHORITY IS UNCHANGED
   ============================================================ */

test("the claim path never writes to the objective ledger", () => {
  const state = makeDivergedState();

  const instancesBefore = JSON.stringify(state.resources.instances);

  const claimView = buildClaimView(state, "TED", state.cycle);
  const resourceView = buildResourceView(state.resources, "TED");

  const legalActions = enumerateLegalActions(
    state.sims.TED,
    FULL_CAPABILITIES,
    ACTION_DEFINITIONS,
    resourceView,
    state.cycle,
    claimView
  ).legal;

  validateAgencyProposal({
    proposal: {
      type: "HIDE",
      resourceId: "cigarette_stack_01",
      selected_objective: "endure"
    },
    actorId: "TED",
    legalActions,
    budget: 3,
    resourceView,
    claimView
  });

  assert.equal(JSON.stringify(state.resources.instances), instancesBefore);
  assert.equal(getClaimQuantity(state, "TED", "cigarette"), 3);
});
