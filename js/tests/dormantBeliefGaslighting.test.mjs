import assert from "node:assert/strict";
import test from "node:test";

import { G } from "../core/state.js";
import {
  CLAIM_DISCLOSURES,
  DIVERGENCE_RECENCY_WINDOW,
  getAllBelievedResourceIds,
  getBelievedDivergenceEntries,
  getClaimDivergenceEntries,
  getDormantClaimDivergenceEntries,
  getFreshClaimDivergenceEntries,
  refreshClaimDivergence
} from "../engine/agency/claimLedger.js";
import {
  buildClaimView,
  livesHolding,
  livesWithAnything,
  livesResourceId
} from "../engine/agency/claimView.js";
import {
  createResourceLedger,
  seedResources
} from "../engine/agency/resourceLedger.js";
import { createAgencyState } from "../engine/agency/state/createAgencyState.js";
import {
  commitResourceInterventions
} from "../engine/analysis/commitResourceInterventions.js";
import {
  validateResourceIntervention
} from "../engine/analysis/resourceInterventions.js";
import {
  buildAssessmentPrompt,
  evaluatePrisonerAssessmentGate
} from "../engine/analysis/assessResourceInterventions.js";
import {
  commitPendingResourceTaunts,
  prepareResourceInterventions
} from "../engine/phases/strategyPhase.js";

/* ============================================================
   G5: STALE DIVERGENCE POLICY

   A prisoner's belief can diverge from reality and then go cold.
   While it is FRESH the engine surfaces it to the prisoner and
   licenses an action on it. Once it is DORMANT the prisoner keeps
   the false belief but can no longer act on it.

   G5 keeps that split intact and opens AM's side: AM must be able
   to NAME a dormant false belief, because a prisoner who still
   believes they hold something AM took can be gaslit on their own
   certainty.

   These tests pin the two halves of that contract:

     - AM's reach widens (gate, prompt, taunt).
     - The prisoner's reach does NOT (claimView is untouched).
============================================================ */

const SIM_IDS = ["TED", "ELLEN", "NIMDOK", "GORRISTER", "BENNY"];

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
  const sims = {};

  for (const id of SIM_IDS) {
    sims[id] = makeSim(id);
  }

  return {
    cycle: 5,
    sims,
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
    amTacticRuntime: {
      targets: {
        TED: { path: "test/precision", phaseId: "pressure" }
      }
    },
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
 * A state in which TED believes they hold three cigarettes that AM
 * has silently taken.
 *
 * `interventionType` selects how the item left TED's hands:
 *
 *   "confiscate" the instance SURVIVES in the ledger, held by AM.
 *   "destroy"    the instance is GONE from the ledger entirely.
 *
 * Both leave the same belief behind, and both are reachable by the
 * dormant reader, but they exercise different commit paths.
 */
function makeDivergedState(interventionType = "confiscate") {
  const state = makeState();

  state.cycle = 5;
  state.resources.instances = [cigaretteStack()];

  seedResources(state.resources, state);

  const intervention = {
    intervention_type: interventionType,
    resource_id: "cigarette_stack_01",
    holder_id: "TED",
    disclosure: CLAIM_DISCLOSURES.SILENT,
    rationale: "Take it without telling him."
  };

  if (interventionType === "confiscate") {
    intervention.quantity = 3;
  }

  const result = commitResourceInterventions(state, [intervention]);

  assert.equal(result.rejected.length, 0);
  assert.equal(result.committed.length, 1);

  return state;
}

/*
 * Advance the state past the recency window so the divergence goes
 * dormant. The belief and the reality stay exactly as they were:
 * only the AGE changed.
 */
function makeDormantState(interventionType = "confiscate") {
  const state = makeDivergedState(interventionType);

  state.cycle = 5 + DIVERGENCE_RECENCY_WINDOW + 1;

  return state;
}

/*
 * A divergence in the direction the prisoner believes they hold LESS
 * than they do. There is no missing item in their hands, so it is not
 * a dormant BELIEF even though it is a dormant divergence.
 */
function makeBelievesLessState() {
  const state = makeState();

  state.cycle = 5;
  state.resources.instances = [cigaretteStack()];

  seedResources(state.resources, state);

  /*
   * Reduce the belief without changing the reality. The recorded
   * claim quantity falls to one while three are actually held.
   */
  state.claimState.TED.cigarette = 1;

  refreshClaimDivergence(state);

  return state;
}

/*
 * A divergence in the direction the prisoner believes they hold NONE
 * of what they actually hold. There is nothing missing from their
 * hands, so it is not a nameable belief.
 */
function makeBelievesNoneState() {
  const state = makeState();

  state.cycle = 5;
  state.resources.instances = [cigaretteStack()];

  seedResources(state.resources, state);

  state.claimState.TED.cigarette = 0;

  refreshClaimDivergence(state);

  return state;
}

/*
 * Swap the global state for the duration of a callback.
 *
 * `prepareResourceInterventions` reads and writes the global state,
 * so a test that drives it has to install its own state and put the
 * old one back afterwards.
 */
async function withGlobalState(state, callback) {
  const previous = {
    cycle: G.cycle,
    sims: G.sims,
    resources: G.resources,
    claimEvents: G.claimEvents,
    claimEventSequence: G.claimEventSequence,
    claimState: G.claimState,
    claimDivergence: G.claimDivergence,
    pendingEvidence: G.pendingEvidence,
    recentResourceDiscoveries: G.recentResourceDiscoveries,
    pendingResourceDiscoveries: G.pendingResourceDiscoveries,
    amTacticRuntime: G.amTacticRuntime,
    amStrategy: G.amStrategy,
    resourceEvents: G.resourceEvents,
    resourceEventSequence: G.resourceEventSequence,
    timeline: G.timeline
  };

  Object.assign(G, state);
  G.timeline = [];

  try {
    return await callback();
  } finally {
    Object.assign(G, previous);
  }
}

/* ============================================================
   1) THE DORMANT READER
============================================================ */

test("the dormant reader returns a stale divergence the fresh reader drops", () => {
  const state = makeDivergedState();

  const staleCycle = 5 + DIVERGENCE_RECENCY_WINDOW + 1;

  assert.equal(
    getFreshClaimDivergenceEntries(state, "TED", staleCycle).length,
    0
  );

  const dormant = getDormantClaimDivergenceEntries(state, "TED", staleCycle);

  assert.equal(dormant.length, 1);
  assert.equal(dormant[0].definitionId, "cigarette");
  assert.equal(dormant[0].claimed, 3);
  assert.equal(dormant[0].objective, 0);
  assert.equal(dormant[0].claimedResourceId, "cigarette_stack_01");
  assert.equal(dormant[0].onsetCycle, 5);
});

test("a fresh divergence is never dormant", () => {
  const state = makeDivergedState();

  assert.equal(
    getDormantClaimDivergenceEntries(state, "TED", 5).length,
    0
  );

  assert.equal(
    getDormantClaimDivergenceEntries(
      state,
      "TED",
      5 + DIVERGENCE_RECENCY_WINDOW
    ).length,
    0
  );

  assert.equal(
    getDormantClaimDivergenceEntries(
      state,
      "TED",
      5 + DIVERGENCE_RECENCY_WINDOW + 1
    ).length,
    1
  );
});

test("the fresh and dormant sets partition the open divergences", () => {
  const state = makeDivergedState();

  const staleCycle = 5 + DIVERGENCE_RECENCY_WINDOW + 1;

  const fresh = getFreshClaimDivergenceEntries(state, "TED", staleCycle);
  const dormant = getDormantClaimDivergenceEntries(state, "TED", staleCycle);
  const all = getClaimDivergenceEntries(state, "TED");

  assert.equal(fresh.length + dormant.length, all.length);

  const freshIds = fresh.map((entry) => entry.definitionId);
  const dormantIds = dormant.map((entry) => entry.definitionId);

  for (const id of freshIds) {
    assert.equal(dormantIds.includes(id), false);
  }
});

test("the dormant reader excludes a belief the prisoner thinks they hold none of", () => {
  const state = makeBelievesNoneState();

  const staleCycle = 5 + DIVERGENCE_RECENCY_WINDOW + 1;

  /*
   * The divergence exists, and it is stale, but the prisoner
   * believes they hold NONE of it. There is no missing item in their
   * hands to name, so it is not a dormant BELIEF.
   *
   * This matches the rule the fresh believed-resource ids already
   * apply: a belief is nameable only when the claimed quantity is
   * positive.
   */
  assert.equal(
    getClaimDivergenceEntries(state, "TED").length,
    1
  );

  assert.equal(
    getDormantClaimDivergenceEntries(state, "TED", staleCycle).length,
    0
  );
});

test("a partial belief is still a nameable dormant belief", () => {
  const state = makeBelievesLessState();

  const staleCycle = 5 + DIVERGENCE_RECENCY_WINDOW + 1;

  /*
   * The prisoner believes they hold ONE of the three. The quantity
   * they believe is wrong, they believe they hold something, and
   * that something is the thing AM took. So it is nameable, exactly
   * as it would be while the confusion is fresh.
   */
  assert.equal(
    getDormantClaimDivergenceEntries(state, "TED", staleCycle).length,
    1
  );

  assert.equal(
    getAllBelievedResourceIds(state, "TED", staleCycle)
      .has("cigarette_stack_01"),
    true
  );
});

test("the dormant reader ignores a divergence with no onset cycle", () => {
  const state = makeState();

  state.claimDivergence = {
    TED: {
      cigarette: {
        definitionId: "cigarette",
        claimed: 3,
        objective: 0,
        delta: -3,
        onsetCycle: null,
        claimedResourceId: "cigarette_stack_01"
      }
    }
  };

  assert.equal(
    getDormantClaimDivergenceEntries(state, "TED", 99).length,
    0
  );
});

test("the believed entry set spans the fresh and the dormant beliefs", () => {
  const state = makeDivergedState();

  const freshIds = getAllBelievedResourceIds(state, "TED", 5);
  const dormantIds = getAllBelievedResourceIds(
    state,
    "TED",
    5 + DIVERGENCE_RECENCY_WINDOW + 1
  );

  assert.equal(freshIds.has("cigarette_stack_01"), true);
  assert.equal(
    dormantIds.has("cigarette_stack_01"),
    true
  );

  /*
   * The entries carry the definition, which is what lets a taunt be
   * titled with a readable noun instead of a raw resource id.
   */
  const entries = getBelievedDivergenceEntries(
    state,
    "TED",
    5 + DIVERGENCE_RECENCY_WINDOW + 1
  );

  assert.equal(entries.length, 1);
  assert.equal(entries[0].definitionId, "cigarette");
});

/* ============================================================
   2) THE ASSESSMENT GATE
============================================================ */

test("the gate opens for a prisoner holding only a dormant divergence", () => {
  const state = makeDormantState();

  /*
   * TED holds nothing at all, and no resource carries an attention
   * flag. Before G5 the gate closed on "no held resources" and AM
   * could never reach the prisoner whose false belief it most
   * wanted to gaslight.
   */
  assert.equal(
    state.resources.instances.filter(
      (instance) => instance.holderId === "TED" && instance.quantity > 0
    ).length,
    0
  );

  assert.equal(state.recentResourceDiscoveries.length, 0);

  const gate = evaluatePrisonerAssessmentGate("TED", state);

  assert.equal(gate.shouldAssess, true);
  assert.equal(gate.reason, "prisoner holds a dormant false belief");

  /*
   * The fresh and the dormant sets are reported SEPARATELY, so the
   * telemetry can still tell an actionable divergence from a
   * dormant one.
   */
  assert.equal(gate.divergences.length, 0);
  assert.equal(gate.dormantDivergences.length, 1);
  assert.equal(gate.dormantDivergences[0].definitionId, "cigarette");
  assert.equal(gate.dormantDivergences[0].claimed, 3);
  assert.equal(gate.dormantDivergences[0].objective, 0);
  assert.equal(
    gate.dormantDivergences[0].claimedResourceId,
    "cigarette_stack_01"
  );
  assert.equal(
    gate.dormantDivergences[0].age,
    DIVERGENCE_RECENCY_WINDOW + 1
  );
});

test("the gate still closes for a prisoner with no divergence at all", () => {
  const state = makeState();

  const gate = evaluatePrisonerAssessmentGate("ELLEN", state);

  assert.equal(gate.shouldAssess, false);
  assert.equal(gate.divergences.length, 0);
  assert.equal(gate.dormantDivergences.length, 0);
});

test("the gate reports the fresh divergence when the confusion is still fresh", () => {
  const state = makeDivergedState();

  const gate = evaluatePrisonerAssessmentGate("TED", state);

  assert.equal(gate.shouldAssess, true);
  assert.equal(gate.reason, "prisoner belief diverges from objective reality");
  assert.equal(gate.divergences.length, 1);
  assert.equal(gate.dormantDivergences.length, 0);
});

/* ============================================================
   3) THE ASSESSMENT PROMPT
============================================================ */

test("the assessment prompt lists the prisoner's dormant beliefs", () => {
  const state = makeDormantState();

  const prompt = buildAssessmentPrompt("TED", state);

  assert.match(prompt, /PRISONER DORMANT BELIEFS/);
  assert.match(prompt, /resource_id: cigarette_stack_01/);
  assert.match(prompt, /definition_id: cigarette/);
  assert.match(prompt, /quantity the prisoner believes they hold: 3/);
  assert.match(prompt, /quantity actually held: 0/);
  assert.match(prompt, /dormant for \d+ cycles/);
  assert.match(prompt, /quantity gaps the prisoner still believes they hold/);
  assert.match(prompt, /psychological gaslighting/);
});

test("the dormant section states the partial-holding rule", () => {
  const state = makeDormantState();

  const prompt = buildAssessmentPrompt("TED", state);

  /*
   * The rule has to distinguish a resource that is ONLY a quantity
   * gap from one that is still partially held, because the second
   * can still be confiscated through the HELD RESOURCE LEDGER.
   */
  assert.match(prompt, /appears \*only\* in this list/);
  assert.match(prompt, /it can only be acted on with a taunt/);
  assert.match(prompt, /if the resource is still partially held/);
  assert.match(prompt, /act on the held portion via the HELD RESOURCE LEDGER/);
});

test("the assessment prompt offers no dormant section content when there is none", () => {
  const state = makeState();

  const prompt = buildAssessmentPrompt("ELLEN", state);

  assert.match(prompt, /PRISONER DORMANT BELIEFS/);
  assert.match(prompt, /PRISONER DORMANT BELIEFS\nThese are quantity gaps[^\n]*\n\(none\)/);
});

test("the assessment prompt keeps the fresh divergence section intact", () => {
  const state = makeDivergedState();

  const prompt = buildAssessmentPrompt("TED", state);

  assert.match(prompt, /PRISONER BELIEF DIVERGENCE/);
  assert.match(prompt, /PRISONER BELIEVED RESOURCES/);

  /*
   * A fresh divergence is NOT dormant, so the dormant section must
   * not duplicate it.
   */
  assert.match(
    prompt,
    /PRISONER DORMANT BELIEFS\nThese are quantity gaps[^\n]*\n\(none\)/
  );
});

/* ============================================================
   4) THE BELIEVED TAUNT
============================================================ */

test("AM prepares a taunt against a dormant believed resource", async () => {
  const state = makeDormantState();

  await withGlobalState(state, async () => {
    const prepared = await prepareResourceInterventions(
      ["TED"],
      async () => JSON.stringify({
        intervention: "taunt",
        resource_id: "cigarette_stack_01",
        rationale: "Deny the cigarettes they still believe they carry."
      })
    );

    assert.equal(prepared.committed.length, 0);
    assert.equal(prepared.pendingTaunts.length, 1);
    assert.deepEqual(prepared.rejected, []);

    /*
     * The taunt is titled with a READABLE noun, not a raw resource
     * id. That requires the definition lookup to span the dormant
     * entries as well as the fresh ones.
     */
    assert.equal(
      prepared.pendingTaunts[0].definitionTitle,
      "Cigarette"
    );
    assert.equal(
      prepared.pendingTaunts[0].resource_id,
      "cigarette_stack_01"
    );
  });
});

test("a taunt against a dormant resource commits without touching the ledger", () => {
  const state = makeDormantState();

  const ledgerBefore = structuredClone(state.resources.instances);
  const claimBefore = JSON.stringify(state.claimState);
  const divergenceBefore = JSON.stringify(state.claimDivergence);

  const result = commitResourceInterventions(state, [{
    intervention_type: "taunt",
    resource_id: "cigarette_stack_01",
    holder_id: "TED",
    target_id: "TED",
    rationale: "Deny the cigarettes they still believe they carry."
  }]);

  assert.equal(result.committed.length, 1);
  assert.equal(result.rejected.length, 0);

  /*
   * A taunt is a NARRATIVE act. It changes no resource state, so the
   * objective ledger, the subjective ledger, and the divergence set
   * are all untouched.
   */
  assert.deepEqual(state.resources.instances, ledgerBefore);
  assert.equal(JSON.stringify(state.claimState), claimBefore);
  assert.equal(JSON.stringify(state.claimDivergence), divergenceBefore);

  /*
   * But it IS recorded, as a disclosure to the target.
   */
  const evidence = state.pendingEvidence.resourceInterventions.TED;

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].interventionType, "taunt");
  assert.equal(evidence[0].resourceId, "cigarette_stack_01");
  assert.equal(evidence[0].prisonerId, "TED");
});

test("a taunt against a dormant resource whose instance was destroyed also commits", () => {
  /*
   * AM can DESTROY an item, which leaves the ledger entirely. The
   * belief survives, so the taunt is still legitimate, and the
   * dialogue reference has to resolve from the belief rather than
   * from a ledger instance.
   */
  const state = makeDormantState("destroy");

  assert.equal(
    state.resources.instances.some(
      (instance) => instance.resourceId === "cigarette_stack_01"
    ),
    false
  );

  const ledgerBefore = structuredClone(state.resources.instances);

  const result = commitResourceInterventions(state, [{
    intervention_type: "taunt",
    resource_id: "cigarette_stack_01",
    holder_id: "TED",
    target_id: "TED",
    rationale: "Deny the cigarettes they still believe they carry."
  }]);

  assert.equal(result.committed.length, 1);
  assert.equal(result.rejected.length, 0);
  assert.deepEqual(state.resources.instances, ledgerBefore);
  assert.equal(
    state.pendingEvidence.resourceInterventions.TED[0].interventionType,
    "taunt"
  );
});

test("a taunt against a destroyed dormant resource validates dialogue via believed definition", async () => {
  /*
   * AM can DESTROY an item, which leaves the ledger entirely. There
   * is then no resource instance to look the noun up from, so
   * `commitPendingResourceTaunts` has to fall back to the definition
   * the prisoner BELIEVES they hold.
   *
   * The taunt is prepared here, but the dialogue that validates it
   * is only checked at commit time. This test therefore drives the
   * preparation, then commits the pending taunt against a dialogue
   * that names the definition.
   */
  const state = makeDormantState("destroy");

  assert.equal(
    state.resources.instances.some(
      (instance) => instance.resourceId === "cigarette_stack_01"
    ),
    false,
    "the destroyed instance must be absent from the ledger"
  );

  await withGlobalState(state, async () => {
    const prepared = await prepareResourceInterventions(
      ["TED"],
      async () => JSON.stringify({
        intervention: "taunt",
        resource_id: "cigarette_stack_01",
        rationale: "Deny the cigarettes they still believe they carry."
      })
    );

    assert.equal(prepared.committed.length, 0);
    assert.equal(prepared.pendingTaunts.length, 1);
    assert.deepEqual(prepared.rejected, []);

    const taunt = prepared.pendingTaunts[0];

    assert.equal(taunt.resource_id, "cigarette_stack_01");
    assert.equal(taunt.definitionTitle, "Cigarette");

    /*
     * The dialogue names the DEFINITION ("Cigarette"), not the
     * resource id. The instance is gone, so only the believed
     * definition can supply the noun for the reference check.
     */
    const accepted = commitPendingResourceTaunts(G, [taunt], {
      TED: { text: "Where are your Cigarette? I took them days ago." }
    });

    assert.equal(accepted.committed.length, 1);
    assert.deepEqual(accepted.rejected, []);
    assert.equal(
      G.pendingEvidence.resourceInterventions.TED[0].interventionType,
      "taunt"
    );
  });
});

test("a destroyed dormant taunt is rejected when the dialogue does not name the item", async () => {
  /*
   * The fallback resolves the NAME the dialogue has to contain. It
   * does not relax the requirement: a dialogue that never mentions
   * the item is still refused.
   */
  const state = makeDormantState("destroy");

  await withGlobalState(state, async () => {
    const prepared = await prepareResourceInterventions(
      ["TED"],
      async () => JSON.stringify({
        intervention: "taunt",
        resource_id: "cigarette_stack_01",
        rationale: "Deny the cigarettes they still believe they carry."
      })
    );

    const rejected = commitPendingResourceTaunts(
      G,
      prepared.pendingTaunts,
      { TED: { text: "You have no protection from me." } }
    );

    assert.equal(rejected.committed.length, 0);
    assert.equal(rejected.rejected.length, 1);
    assert.match(
      rejected.rejected[0].reason,
      /does not reference resource/
    );
    assert.equal(
      G.pendingEvidence.resourceInterventions.TED,
      undefined
    );
  });
});

test("a dormant taunt still requires the dialogue to name the item", () => {
  const state = makeDormantState();

  const taunt = {
    intervention_type: "taunt",
    resource_id: "cigarette_stack_01",
    holder_id: "TED",
    target_id: "TED",
    rationale: "Deny the cigarettes they still believe they carry."
  };

  const missingDialogue = commitPendingResourceTaunts(state, [taunt], {});

  const missingReference = commitPendingResourceTaunts(state, [taunt], {
    TED: { text: "You have no protection from me." }
  });

  const namingDialogue = commitPendingResourceTaunts(state, [taunt], {
    TED: { text: "Where are your three cigarettes? I took them long ago." }
  });

  assert.match(
    missingDialogue.rejected[0].reason,
    /no accepted execution dialogue/
  );
  assert.match(
    missingReference.rejected[0].reason,
    /does not reference resource/
  );
  assert.equal(namingDialogue.committed.length, 1);
});

test("a dormant belief cannot license removing a resource", () => {
  const state = makeDormantState();

  /*
   * Confiscate and transfer still require the prisoner to actually
   * hold the item. The instance AM took is held by AM, so both are
   * refused with the holder guard, exactly as they were before G5.
   */
  for (const intervention_type of ["confiscate", "transfer"]) {
    const result = commitResourceInterventions(state, [{
      intervention_type,
      resource_id: "cigarette_stack_01",
      holder_id: "TED",
      target_holder_id: "ELLEN",
      quantity: 1,
      rationale: "Try to take it again."
    }]);

    assert.equal(
      result.committed.length,
      0,
      intervention_type + " must not commit against a dormant belief"
    );
    assert.equal(result.rejected.length, 1);
    assert.match(
      result.rejected[0].reason,
      /is held by AM, not TED/
    );
  }
});

test("only the taunt validator consults the believed set", () => {
  /*
   * The believed set is the one context G5 widened, and it must stay
   * confined to the taunt. A validator that ignores the context
   * cannot be influenced by it, so the three ledger-mutating
   * validators must return exactly the same verdict whether or not
   * the believed set is supplied.
   */
  const context = {
    resources: { instances: [cigaretteStack({ holderId: "AM" })] },
    sims: { TED: makeSim("TED"), ELLEN: makeSim("ELLEN") }
  };

  const believedResourceIds = new Set(["cigarette_stack_01"]);

  for (const intervention_type of ["confiscate", "destroy", "transfer"]) {
    const intervention = {
      intervention_type,
      resource_id: "cigarette_stack_01",
      holder_id: "TED",
      target_holder_id: "ELLEN",
      quantity: 1
    };

    const withoutBeliefs = validateResourceIntervention(
      intervention,
      context
    );

    const withBeliefs = validateResourceIntervention(
      intervention,
      { ...context, believedResourceIds }
    );

    assert.equal(
      withBeliefs.valid,
      withoutBeliefs.valid,
      intervention_type + " must not be influenced by the believed set"
    );
    assert.equal(
      withBeliefs.reason,
      withoutBeliefs.reason,
      intervention_type + " must not be influenced by the believed set"
    );
  }

  /*
   * The taunt is the opposite: the believed set is what lets it
   * name a resource the objective ledger no longer lists.
   */
  const taunt = {
    intervention_type: "taunt",
    resource_id: "cigarette_stack_01",
    holder_id: "TED",
    target_id: "TED"
  };

  const tauntWithoutBeliefs = validateResourceIntervention(
    taunt,
    { resources: { instances: [] }, sims: context.sims }
  );

  const tauntWithBeliefs = validateResourceIntervention(
    taunt,
    {
      resources: { instances: [] },
      sims: context.sims,
      believedResourceIds
    }
  );

  assert.equal(tauntWithoutBeliefs.valid, false);
  assert.equal(tauntWithBeliefs.valid, true);
});

/* ============================================================
   5) THE PRISONER'S REACH IS UNCHANGED
============================================================ */

test("a prisoner cannot attempt an action on a dormant belief", () => {
  const state = makeDormantState();

  const claimView = buildClaimView(state, "TED", state.cycle);

  /*
   * The belief is still in the prisoner's accounting, so they still
   * think they carry the cigarettes.
   */
  assert.equal(claimView.believed.cigarette, 3);
  assert.equal(claimView.believedResourceIds.has("cigarette_stack_01"), true);

  /*
   * But the belief is NOT live, so it licenses no attempt.
   */
  assert.equal(claimView.live.length, 0);
  assert.equal(claimView.stale.length, 1);

  assert.equal(livesHolding(claimView, "cigarette"), false);
  assert.equal(livesWithAnything(claimView), false);
  assert.equal(livesResourceId(claimView, "cigarette_stack_01"), false);
});

test("a fresh belief still licenses an attempt", () => {
  const state = makeDivergedState();

  const claimView = buildClaimView(state, "TED", state.cycle);

  assert.equal(claimView.live.length, 1);
  assert.equal(claimView.stale.length, 1);
});
