// js/tests/journalOptimization.test.mjs
//
// Coverage for the MENTAL FOCUS GATE.
//
// THE FEATURE
// -----------
// A prisoner can now spend an action credit on PREPARE_JOURNAL to
// buy the deep, belief-updating journal that the psychology phase
// used to write only in reaction to a stimulus. Paying buys a
// mechanical PROCESSING BONUS: a guaranteed hope recovery and a
// halved suffering delta.
//
// THE FIVE SCENARIOS THAT MATTER
// ------------------------------
//
//   1. A prisoner with stimulus still journals automatically.
//      The historical behaviour must survive unchanged.
//   2. A prisoner with NO stimulus who chose PREPARE_JOURNAL gets
//      the journal. This is the new feature.
//   3. A prisoner with no stimulus and no choice skips the journal.
//      This is the optimization.
//   4. A prisoner with a stat shock journals even with no stimulus
//      and no choice. This is the safety net.
//   5. The processing bonus is applied exactly when the choice was
//      made, and not otherwise.
//
// Plus the two budget cases: the action costs one credit, and it
// cannot be taken with no budget.
//
// THE TIMING, STATED ONCE
// -----------------------
// The psychology phase runs BEFORE the agency phase in the cycle
// pipeline, so a prisoner who buys PREPARE_JOURNAL in cycle N is
// given their journal in cycle N+1. Every test below that spans
// the two phases therefore advances the cycle explicitly, and the
// tests say so where the timing is load-bearing.

import { test } from "node:test";
import assert from "node:assert/strict";

import { G } from "../core/state.js";
import { SIM_IDS } from "../core/constants.js";

import {
  ACTION_DEFINITIONS,
  getActionDefinition,
  getAllActionTypes
} from "../engine/agency/actionDefs.js";

import {
  evaluateJournalGate,
  findFocusPreparations,
  hasStatShock,
  selectJournalTargetIds,
  hasProcessingBonus,
  buildProcessingBonusRecord,
  applyFocusHopeRecovery,
  dampenSufferingDelta,
  JOURNAL_GATE_REASONS,
  STAT_SHOCK_THRESHOLDS,
  PROCESSING_BONUS,
  FOCUS_PREPARATION_EVIDENCE_KEY
} from "../engine/psychology/journalGate.js";

import {
  computeJournalOptimizationMetrics
} from "../engine/metrics/journalOptimizationMetrics.js";

import {
  validateAgencyProposal
} from "../engine/agency/proposal.js";

import {
  createAgencySnapshot,
  resolveAgencyActions
} from "../engine/agency/resolve.js";

import {
  createAgencyState
} from "../engine/agency/state/createAgencyState.js";

import { buildSimJournalPrompt } from "../prompts/journal.js";

import {
  buildAgencyProposalPrompt
} from "../prompts/agencyProposal.js";

import {
  formatAgencyOutcome
} from "../prompts/utils/formatAgencyOutcome.js";

/* ============================================================
   HELPERS
============================================================ */

function sim(overrides = {}) {
  return {
    id: "TED",
    hope: 50,
    sanity: 80,
    suffering: 20,
    beliefs: {
      escape_possible: 0.5,
      others_trustworthy: 0.5,
      self_worth: 0.5,
      reality_reliable: 0.6,
      guilt_deserved: 0.3,
      resistance_possible: 0.5,
      am_has_limits: 0.2
    },
    drives: { primary: "survive", secondary: null },
    anchors: [],
    relationships: {},
    constraints: [],
    scratchpad: { initialized: true, goalHistory: [] },
    tacticHistory: [],
    beliefEvidence: [],
    ...overrides
  };
}

// A prisoner who is in NO danger: no shock, no stimulus.
function calmSim(overrides = {}) {
  return sim({
    hope: 70,
    sanity: 85,
    suffering: 15,
    ...overrides
  });
}

function legalEntry(type) {
  const definition = ACTION_DEFINITIONS[type];
  return {
    type,
    title: definition.title,
    cost: definition.baseCost,
    availableModes: []
  };
}

// Validate a PREPARE_JOURNAL proposal against a given budget.
function proposeFocus(budget) {
  return validateAgencyProposal({
    proposal: { type: "PREPARE_JOURNAL" },
    actorId: "TED",
    legalActions: [
      legalEntry("WAIT"),
      legalEntry("PREPARE_JOURNAL")
    ],
    budget,
    resourceView: { stacks: [] }
  });
}

// A preparation record as the agency phase writes it.
function preparation(cycle, actorId = "TED") {
  return {
    [actorId]: {
      cycle,
      action: "PREPARE_JOURNAL",
      budgetConsumed: 1
    }
  };
}

/* ============================================================
   1. THE ACTION DEFINITION
============================================================ */

test("PREPARE_JOURNAL is a registered action costing one credit", () => {
  const definition = getActionDefinition("PREPARE_JOURNAL");

  assert.ok(definition, "PREPARE_JOURNAL must be in the registry");
  assert.equal(definition.type, "PREPARE_JOURNAL");
  assert.equal(definition.baseCost, 1);
  assert.ok(getAllActionTypes().includes("PREPARE_JOURNAL"));
});

test("PREPARE_JOURNAL declares no capability or resource requirements", () => {
  const definition = getActionDefinition("PREPARE_JOURNAL");

  assert.deepEqual(definition.requirements, {});
  assert.deepEqual(definition.resourceRequirements, {});

  // The absence of requirements is a DESIGN DECISION, not an
  // oversight: reflection must remain available to a prisoner whose
  // body is failing. The budget, not the body, is the limit.
  assert.equal(
    Object.keys(definition.requirements).length,
    0,
    "a capability gate would remove reflection from the prisoners " +
      "most likely to want it"
  );
});

/* ============================================================
   2. BUDGET ENFORCEMENT
============================================================ */

test("PREPARE_JOURNAL consumes one action credit", () => {
  const accepted = proposeFocus(3);

  assert.equal(accepted.accepted, true);
  assert.equal(accepted.action.type, "PREPARE_JOURNAL");
  assert.equal(accepted.cost, 1);
});

test("PREPARE_JOURNAL cannot be chosen with a budget of zero", () => {
  const refused = proposeFocus(0);

  assert.equal(refused.accepted, false);
  assert.equal(refused.reason, "budget_exceeded");
  assert.equal(refused.action.type, "WAIT");
  assert.equal(refused.cost, 0);
});

test("PREPARE_JOURNAL is affordable at a budget of exactly one", () => {
  const accepted = proposeFocus(1);

  assert.equal(accepted.accepted, true);
  assert.equal(accepted.cost, 1);
});

test("the resolver accepts a focused journal and produces no stat effects", () => {
  const proposal = proposeFocus(3);

  const game = {
    cycle: 5,
    sims: { TED: sim() },
    resources: { instances: [] }
  };

  const [resolution] = resolveAgencyActions({
    proposals: [proposal],
    snapshot: createAgencySnapshot(game),
    cycle: 5
  });

  assert.equal(resolution.status, "success");
  assert.equal(resolution.action.type, "PREPARE_JOURNAL");
  assert.equal(resolution.cost, 1);

  // The action buys a journal; it does not move the prisoner's stats
  // by itself. The hope recovery belongs to the psychology phase, and
  // crediting it here as well would double-count it.
  assert.deepEqual(resolution.effects, {});
  assert.deepEqual(resolution.operations, []);
});

/* ============================================================
   3. THE GATE
============================================================ */

test("a prisoner with stimulus qualifies for the journal", () => {
  const gate = evaluateJournalGate({ hasStimulus: true });

  assert.equal(gate.shouldJournal, true);
  assert.deepEqual(gate.reasons, [JOURNAL_GATE_REASONS.STIMULUS]);
});

test("a prisoner with no stimulus but a chosen focus qualifies", () => {
  const gate = evaluateJournalGate({
    hasStimulus: false,
    chosePrepareJournal: true
  });

  assert.equal(gate.shouldJournal, true);
  assert.deepEqual(gate.reasons, [JOURNAL_GATE_REASONS.PREPARE_JOURNAL]);
});

test("a prisoner with no stimulus and no choice skips the journal", () => {
  const gate = evaluateJournalGate({
    hasStimulus: false,
    chosePrepareJournal: false
  });

  assert.equal(gate.shouldJournal, false);
  assert.deepEqual(gate.reasons, []);
});

test("a prisoner with a stat shock qualifies with no stimulus and no choice", () => {
  const gate = evaluateJournalGate({
    hasStimulus: false,
    chosePrepareJournal: false,
    hasStatShock: true
  });

  assert.equal(gate.shouldJournal, true);
  assert.deepEqual(gate.reasons, [JOURNAL_GATE_REASONS.STAT_SHOCK]);
});

test("the gate reports every applicable reason, not just the first", () => {
  const gate = evaluateJournalGate({
    hasStimulus: true,
    chosePrepareJournal: true,
    hasStatShock: true
  });

  assert.equal(gate.shouldJournal, true);
  assert.deepEqual(gate.reasons, [
    JOURNAL_GATE_REASONS.STIMULUS,
    JOURNAL_GATE_REASONS.PREPARE_JOURNAL,
    JOURNAL_GATE_REASONS.STAT_SHOCK
  ]);
});

/* ============================================================
   4. THE STAT-SHOCK SAFETY NET
============================================================ */

test("the stat shock thresholds fire exactly at their boundaries", () => {
  assert.equal(
    hasStatShock(calmSim({ sanity: STAT_SHOCK_THRESHOLDS.sanityBelow })),
    false,
    "sanity AT the threshold is not yet a shock"
  );
  assert.equal(
    hasStatShock(calmSim({ sanity: STAT_SHOCK_THRESHOLDS.sanityBelow - 0.01 })),
    true
  );

  assert.equal(
    hasStatShock(calmSim({ hope: STAT_SHOCK_THRESHOLDS.hopeBelow })),
    false
  );
  assert.equal(
    hasStatShock(calmSim({ hope: STAT_SHOCK_THRESHOLDS.hopeBelow - 0.01 })),
    true
  );

  assert.equal(
    hasStatShock(calmSim({ suffering: STAT_SHOCK_THRESHOLDS.sufferingAbove })),
    false
  );
  assert.equal(
    hasStatShock(calmSim({ suffering: STAT_SHOCK_THRESHOLDS.sufferingAbove + 0.01 })),
    true
  );
});

test("a malformed stat block is not a stat shock", () => {
  assert.equal(hasStatShock(null), false);
  assert.equal(hasStatShock({}), false);
  assert.equal(
    hasStatShock({ sanity: Number.NaN, hope: 70, suffering: 15 }),
    false,
    "a broken input must not pull every prisoner into the journal"
  );
});

/* ============================================================
   5. THE FOCUS PREPARATION BRIDGE
============================================================ */

test("a preparation from the previous cycle qualifies the prisoner", () => {
  const found = findFocusPreparations(preparation(6), 7);

  assert.ok(found.TED);
  assert.equal(found.TED.action, "PREPARE_JOURNAL");
  assert.equal(found.TED.cycle, 6);
  assert.equal(found.TED.budgetConsumed, 1);
});

test("a preparation from the current cycle does not qualify yet", () => {
  // The psychology phase runs before the agency phase, so a
  // preparation bought THIS cycle cannot affect THIS cycle's
  // journal. It qualifies in the next one.
  const found = findFocusPreparations(preparation(7), 7);

  assert.deepEqual(Object.keys(found), []);
});

test("a preparation from an older cycle does not qualify", () => {
  const found = findFocusPreparations(preparation(4), 7);

  assert.deepEqual(
    Object.keys(found),
    [],
    "one action credit must not buy more than one journal"
  );
});

test("a preparation for another action does not qualify", () => {
  const found = findFocusPreparations(
    {
      TED: { cycle: 6, action: "OBSERVE", budgetConsumed: 1 }
    },
    7
  );

  assert.deepEqual(Object.keys(found), []);
});

test("a malformed preparation channel is handled without throwing", () => {
  assert.deepEqual(Object.keys(findFocusPreparations(null, 7)), []);
  assert.deepEqual(Object.keys(findFocusPreparations(undefined, 7)), []);
  assert.deepEqual(Object.keys(findFocusPreparations({}, 7)), []);
  assert.deepEqual(Object.keys(findFocusPreparations({ TED: null }, 7)), []);
});

/* ============================================================
   6. TARGET ORDER
============================================================ */

test("journal targets are returned in canonical prison order", () => {
  const selected = selectJournalTargetIds({
    ELLEN: { shouldJournal: true },
    TED: { shouldJournal: true },
    BENNY: { shouldJournal: false },
    NIMDOK: { shouldJournal: true }
  });

  assert.deepEqual(selected, ["TED", "ELLEN", "NIMDOK"]);
});

/* ============================================================
   7. THE PROCESSING BONUS
============================================================ */

test("the processing bonus is earned only by choosing to focus", () => {
  assert.equal(
    hasProcessingBonus({ chosePrepareJournal: true }),
    true
  );
  assert.equal(
    hasProcessingBonus({ chosePrepareJournal: false }),
    false
  );
  assert.equal(
    hasProcessingBonus({ hasStimulus: true }),
    false,
    "a stimulus-driven journal must earn no bonus"
  );
  assert.equal(hasProcessingBonus(undefined), false);
});

test("the processing bonus guarantees a hope recovery of three", () => {
  const target = sim({ hope: 50 });

  const gain = applyFocusHopeRecovery(target);

  assert.equal(gain, PROCESSING_BONUS.hopeGain);
  assert.equal(target.hope, 53);
});

test("the hope recovery is capped and reports the ACTUAL gain", () => {
  const target = sim({ hope: 98 });

  const gain = applyFocusHopeRecovery(target);

  assert.equal(target.hope, PROCESSING_BONUS.hopeCap);
  assert.equal(
    gain,
    1,
    "a prisoner at 98 hope received one point, not three"
  );
});

test("a prisoner at the hope ceiling receives no recovery", () => {
  const target = sim({ hope: 99 });

  const gain = applyFocusHopeRecovery(target);

  assert.equal(target.hope, 99);
  assert.equal(gain, 0);
});

test("the suffering delta is halved by the processing bonus", () => {
  const dampened = dampenSufferingDelta({
    suffering: 8,
    hope: -2,
    sanity: 1
  });

  assert.equal(dampened.suffering, 4);
  assert.equal(dampened.hope, -2);
  assert.equal(dampened.sanity, 1);
});

test("the reported suffering delta is not mutated by the dampening", () => {
  // The reported deltas describe what the FORENSIC MODEL said, and
  // they are recorded verbatim on the journal entry and in the
  // evidence trace. Rewriting them would mislabel the model's output
  // as an engine decision.
  const reported = { suffering: 8, hope: 0, sanity: 0 };

  const dampened = dampenSufferingDelta(reported);

  assert.equal(reported.suffering, 8);
  assert.equal(dampened.suffering, 4);
  assert.notEqual(reported, dampened);
});

test("a zero or absent suffering delta is left alone", () => {
  assert.equal(dampenSufferingDelta({ suffering: 0 }).suffering, 0);
  assert.equal(dampenSufferingDelta(null), null);
  assert.equal(dampenSufferingDelta(undefined), undefined);
});

test("the processing bonus record names the bonus and its parts", () => {
  const record = buildProcessingBonusRecord({ hopeGain: 3 });

  assert.equal(record.bonus, "MENTAL_FOCUS");
  assert.equal(record.hopeGain, 3);
  assert.equal(record.nominalHopeGain, PROCESSING_BONUS.hopeGain);
  assert.equal(record.sufferingDampened, true);
});

/* ============================================================
   8. THE JOURNAL PROMPT
============================================================ */

test("the journal prompt carries no reflection section by default", () => {
  const previousJournals = G.journals.TED;
  G.journals.TED = [];

  try {
    const prompt = buildSimJournalPrompt(calmSim(), null);

    assert.ok(
      !prompt.includes("# INTENTIONAL REFLECTION"),
      "a stimulus-driven journal must not claim the prisoner chose to reflect"
    );
  } finally {
    G.journals.TED = previousJournals;
  }
});

test("the journal prompt acknowledges an intentional reflection", () => {
  const previousJournals = G.journals.TED;
  G.journals.TED = [];

  try {
    const prompt = buildSimJournalPrompt(
      calmSim(),
      null,
      { intentionalReflection: true }
    );

    assert.ok(prompt.includes("# INTENTIONAL REFLECTION"));
    assert.ok(prompt.includes("deliberate"));
    assert.ok(prompt.includes("psychological self-care"));
  } finally {
    G.journals.TED = previousJournals;
  }
});

test("the reflection section does not change the rest of the prompt", () => {
  // The prompt is part of the reproducible run record. The
  // reflection section is the ONLY thing that may differ between a
  // focused journal and a stimulus-driven one.
  const previousJournals = G.journals.TED;
  G.journals.TED = [];

  try {
    const plain = buildSimJournalPrompt(calmSim(), null);
    const focused = buildSimJournalPrompt(
      calmSim(),
      null,
      { intentionalReflection: true }
    );

    /*
     * The section is stripped by its exact boundaries: the
     * separator it introduces, and the trailing newline it leaves
     * behind. The stripped prompt must equal the plain prompt
     * byte for byte, which is the property that matters for the
     * reproducible run record.
     */
    const marker = "---\n\n# INTENTIONAL REFLECTION";
    const start = focused.indexOf(marker);
    const endMarker = "psychological self-care.\n";
    const end = focused.indexOf(endMarker, start);

    assert.ok(start >= 0, "expected the reflection section");
    assert.ok(end > start, "expected the reflection section to close");

    const withoutSection =
      focused.slice(0, start) +
      focused.slice(end + endMarker.length);

    assert.equal(
      withoutSection,
      plain,
      "the reflection section must be additive and nothing else"
    );
  } finally {
    G.journals.TED = previousJournals;
  }
});

/* ============================================================
   9. THE TELEMETRY
============================================================ */

test("the telemetry counts who wrote and who did not", () => {
  const metrics = computeJournalOptimizationMetrics({
    decisions: {
      TED: {
        shouldJournal: true,
        hasStimulus: true,
        chosePrepareJournal: false,
        hasStatShock: false
      },
      ELLEN: {
        shouldJournal: true,
        hasStimulus: false,
        chosePrepareJournal: true,
        hasStatShock: false
      },
      NIMDOK: {
        shouldJournal: false,
        hasStimulus: false,
        chosePrepareJournal: false,
        hasStatShock: false
      }
    },
    journaledIds: ["TED", "ELLEN"],
    prisonerIds: ["TED", "ELLEN", "NIMDOK"],
    cycle: 12
  });

  assert.equal(metrics.cycle, 12);
  assert.equal(metrics.totalPrisoners, 3);
  assert.equal(metrics.prisonersWithStimulus, 1);
  assert.equal(metrics.prisonersWhoChoseFocus, 1);
  assert.equal(metrics.prisonersWithStatShock, 0);
  assert.equal(metrics.prisonersWhoJournaled, 2);
  assert.equal(metrics.skippedJournals, 1);
  assert.equal(
    metrics.llmCallsSaved,
    2,
    "one skipped journal is two model calls"
  );
});

test("the telemetry counts an actual write, not merely a qualification", () => {
  // A qualified prisoner can still fail to produce a journal. The
  // skipped count must reflect what actually happened, or the
  // reported savings would be overstated.
  const metrics = computeJournalOptimizationMetrics({
    decisions: {
      TED: { shouldJournal: true, hasStimulus: true },
      ELLEN: { shouldJournal: true, hasStimulus: true }
    },
    journaledIds: ["TED"],
    prisonerIds: ["TED", "ELLEN"],
    cycle: 3
  });

  assert.equal(metrics.prisonersWhoJournaled, 1);
  assert.equal(metrics.skippedJournals, 1);
});

test("the telemetry is pure and tolerates empty input", () => {
  const metrics = computeJournalOptimizationMetrics({});

  assert.equal(metrics.totalPrisoners, 0);
  assert.equal(metrics.prisonersWhoJournaled, 0);
  assert.equal(metrics.skippedJournals, 0);
  assert.equal(metrics.llmCallsSaved, 0);
});

test("the telemetry names WHO wrote, not just how many", () => {
  const metrics = computeJournalOptimizationMetrics({
    decisions: {},
    journaledIds: ["TED", "ELLEN"],
    prisonerIds: ["TED", "ELLEN", "NIMDOK"],
    cycle: 9
  });

  assert.deepEqual(metrics.journaledIds, ["TED", "ELLEN"]);
});

test("the telemetry reports the assumed time saving separately", () => {
  const metrics = computeJournalOptimizationMetrics({
    decisions: {},
    journaledIds: [],
    prisonerIds: ["TED", "ELLEN"],
    cycle: 1
  });

  assert.equal(metrics.skippedJournals, 2);
  assert.equal(metrics.llmCallsSaved, 4);
  assert.equal(metrics.estimatedTimeSaved, "160s");
  assert.equal(metrics.estimatedTimeSavedSeconds, 160);
});

/* ============================================================
   10. THE EVIDENCE CHANNEL
============================================================ */

test("the focus preparation channel is named once", () => {
  assert.equal(
    FOCUS_PREPARATION_EVIDENCE_KEY,
    "journalPreparations"
  );
  assert.ok(
    Object.prototype.hasOwnProperty.call(
      G.pendingEvidence,
      FOCUS_PREPARATION_EVIDENCE_KEY
    ),
    "the channel must exist in the state schema"
  );
});

test("the agency state envelope is unchanged by this feature", () => {
  // The preparation lives in the pending-evidence bus, not in the
  // agency envelope, so the envelope's shape must not have moved.
  const state = createAgencyState();

  assert.deepEqual(Object.keys(state).sort(), [
    "blockedActions",
    "budgets",
    "capabilities",
    "cycle",
    "events",
    "lastDerivedCycle",
    "legalActions",
    "nextActionSequence",
    "resources"
  ]);
});

/* ============================================================
   11. THE ACTION IS REACHABLE BY THE MODEL
============================================================ */

test("the agency proposal prompt offers and explains PREPARE_JOURNAL", () => {
  // The action is only usable if the model can see it and knows what
  // it does. An entry in the legal-action list without a description
  // would be offered to the model as a bare type name.
  const prompt = buildAgencyProposalPrompt(
    calmSim(),
    [legalEntry("WAIT"), legalEntry("PREPARE_JOURNAL")],
    3,
    { stacks: [] },
    null
  );

  assert.ok(
    prompt.includes("PREPARE_JOURNAL"),
    "the action must appear in the legal-action list"
  );
  assert.ok(
    prompt.includes("focused reflection"),
    "the prompt must explain what the action does"
  );
  assert.ok(
    prompt.includes("Costs 1 action credit"),
    "the prompt must state the cost"
  );
});

/* ============================================================
   12. A REFUSED FOCUS ATTEMPT READS AS AN ACTION
============================================================ */

test("a refused focus attempt renders as a readable refusal", () => {
  /*
   * Without a verb in the ACTION_VERBS table, the refusal would read
   * as "your attempt to prepare_journal", which is a catalogue
   * identifier rather than something the prisoner did.
   */
  const rendered = formatAgencyOutcome({
    actionType: "PREPARE_JOURNAL",
    status: "blocked",
    provenance: { resolutionReason: "budget_exceeded" }
  });

  assert.ok(rendered, "a refused attempt must render");
  assert.ok(
    rendered.includes("reflect"),
    "the attempt must read as reflection"
  );
  assert.ok(
    !rendered.includes("prepare_journal"),
    "the raw action type must not leak into the prisoner's prose"
  );
});
