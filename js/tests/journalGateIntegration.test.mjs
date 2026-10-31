// js/tests/journalGateIntegration.test.mjs
//
// END-TO-END coverage for the MENTAL FOCUS GATE.
//
// js/tests/journalOptimization.test.mjs covers the gate's decisions
// as PURE functions. This file covers the WIRING: that the agency
// phase really records a focus preparation, that the evidence reset
// really carries it across the cycle boundary, and that the
// psychology phase really gives the prisoner the journal and the
// processing bonus.
//
// WHY A SEPARATE FILE
// -------------------
// The wiring tests have to drive the REAL phases with the real
// global state, which means installing a DOM stub and restoring
// every touched field afterwards. That machinery is noisy enough
// that mixing it into the pure-function file would bury the
// decisions being asserted.
//
// THE TIMING UNDER TEST
// ---------------------
// The psychology phase runs BEFORE the agency phase, so a
// preparation bought in cycle N buys a journal in cycle N+1. Every
// test here that spans the two phases advances the cycle
// explicitly, and asserts the intermediate state so a regression in
// the handoff is visible rather than inferred.

import { test } from "node:test";
import assert from "node:assert/strict";

import { G } from "../core/state.js";
import { SIM_IDS } from "../core/constants.js";

import { runAgencyPhase } from "../engine/phases/agencyPhase.js";
import { createAgencyState } from "../engine/agency/state/createAgencyState.js";
import {
  resetCycleEvidence
} from "../engine/phases/helpers/resetCycleEvidence.js";
import {
  FOCUS_PREPARATION_EVIDENCE_KEY
} from "../engine/psychology/journalGate.js";

import { runPsychologyPhase } from "../engine/phases/psychologyPhase.js";

/* ============================================================
   DOM STUB
============================================================ */

/*
 * js/ui/timeline.js and js/ui/logs.js read `document` at CALL time,
 * not import time, so a minimal stub is enough to run the phases
 * under Node.
 */
function installDom() {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;

  /*
   * The journal list element must EXIST for `appendJournalEntry()` to
   * record an entry: the function returns early when the element is
   * missing, which would leave `G.journals` empty and make every
   * journal assertion here vacuously pass or fail for the wrong
   * reason.
   *
   * Every other element resolves to null, which drives the timeline,
   * the log, and the stat-display code down their existing
   * early-return paths.
   */
  const journalElements = new Map();

  const fakeElement = () => ({
    textContent: "",
    innerHTML: "",
    scrollTop: 0,
    scrollHeight: 0,
    style: {},
    dataset: {},
    classList: { add() {}, remove() {} },
    appendChild() {},
    setAttribute() {},
    addEventListener() {}
  });

  globalThis.document = {
    getElementById: (id) => {
      if (typeof id !== "string") return null;
      if (!id.startsWith("jl-")) return null;

      if (!journalElements.has(id)) {
        journalElements.set(id, fakeElement());
      }

      return journalElements.get(id);
    },
    createElement: () => ({
      style: {},
      classList: { add() {} },
      setAttribute() {},
      appendChild() {},
      addEventListener() {}
    }),
    createTextNode: () => ({ textContent: "" })
  };

  if (!globalThis.window) {
    globalThis.window = {};
  }

  return () => {
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
  };
}

/* ============================================================
   HARNESS
============================================================ */

/*
 * Run a body against the real global state with the agency envelope
 * and the pending-evidence bus reset, restoring everything
 * afterwards so this file cannot leak state into another test.
 */
async function withAgency(body) {
  const restoreDom = installDom();

  const previousCycle = G.cycle;
  const previousAgency = G.agency;
  const previousPending = G.pendingEvidence;
  const previousSims = {};

  for (const simId of SIM_IDS) {
    previousSims[simId] = structuredClone(G.sims[simId]);
  }

  G.agency = createAgencyState();
  G.pendingEvidence = {
    journal: Object.create(null),
    comms: Object.create(null),
    constraints: Object.create(null),
    am: Object.create(null),
    resourceInterventions: Object.create(null),
    exposures: Object.create(null),
    [FOCUS_PREPARATION_EVIDENCE_KEY]: Object.create(null),
    system: Object.create(null)
  };

  try {
    return await body();
  } finally {
    G.cycle = previousCycle;
    G.agency = previousAgency;
    G.pendingEvidence = previousPending;

    for (const simId of SIM_IDS) {
      G.sims[simId] = previousSims[simId];
    }

    restoreDom();
  }
}

/*
 * A proposal that buys a focused journal for one prisoner and makes
 * everyone else wait.
 */
function focusProposal(sim) {
  if (sim.id !== "TED") {
    return {
      actorId: sim.id,
      action: { type: "WAIT" },
      cost: 0,
      accepted: true,
      reason: null,
      requestedType: "WAIT",
      selectedObjective: "endure"
    };
  }

  return {
    actorId: sim.id,
    action: { type: "PREPARE_JOURNAL" },
    cost: 1,
    accepted: true,
    reason: null,
    requestedType: "PREPARE_JOURNAL",
    selectedObjective: "endure"
  };
}

/* ============================================================
   1. THE AGENCY PHASE RECORDS THE PREPARATION
============================================================ */

test("a successful focus action is recorded in the preparation channel", async () => {
  await withAgency(async () => {
    G.cycle = 21;

    await runAgencyPhase({ proposalCollector: focusProposal });

    const preparations =
      G.pendingEvidence[FOCUS_PREPARATION_EVIDENCE_KEY];

    assert.ok(
      preparations.TED,
      "the prisoner who chose to focus must be recorded"
    );
    assert.equal(preparations.TED.cycle, 21);
    assert.equal(preparations.TED.action, "PREPARE_JOURNAL");
    assert.equal(
      preparations.TED.budgetConsumed,
      1,
      "one action credit must be recorded as consumed"
    );

    assert.equal(
      preparations.ELLEN,
      undefined,
      "a prisoner who waited bought nothing"
    );
  });
});

test("the preparation is backed by a successful canonical agency event", async () => {
  await withAgency(async () => {
    G.cycle = 22;

    await runAgencyPhase({ proposalCollector: focusProposal });

    const event = G.agency.events.find(
      (entry) =>
        entry.actorId === "TED" &&
        entry.cycle === 22
    );

    assert.ok(event, "the action must produce a canonical event");
    assert.equal(event.actionType, "PREPARE_JOURNAL");
    assert.equal(event.status, "success");
  });
});

/* ============================================================
   2. THE EVIDENCE RESET CARRIES THE PREPARATION FORWARD
============================================================ */

test("the preparation survives the cycle reset and reaches the next cycle", async () => {
  await withAgency(async () => {
    G.cycle = 23;

    await runAgencyPhase({ proposalCollector: focusProposal });

    assert.ok(G.pendingEvidence[FOCUS_PREPARATION_EVIDENCE_KEY].TED);

    /*
     * The next cycle begins. The reset must carry the preparation
     * across, or the psychology phase would never see it.
     */
    G.cycle = 24;
    resetCycleEvidence();

    const carried =
      G.pendingEvidence[FOCUS_PREPARATION_EVIDENCE_KEY];

    assert.ok(
      carried.TED,
      "the preparation must survive the cycle boundary"
    );
    assert.equal(carried.TED.cycle, 23);
  });
});

test("a preparation older than one cycle is dropped by the reset", async () => {
  await withAgency(async () => {
    G.cycle = 30;

    await runAgencyPhase({ proposalCollector: focusProposal });

    /*
     * Two cycles pass without the preparation being consumed. The
     * second reset must drop it, so one action credit cannot buy a
     * journal forever.
     */
    G.cycle = 31;
    resetCycleEvidence();

    G.cycle = 32;
    resetCycleEvidence();

    const carried =
      G.pendingEvidence[FOCUS_PREPARATION_EVIDENCE_KEY];

    assert.equal(
      carried.TED,
      undefined,
      "a stale preparation must not buy another journal"
    );
  });
});

test("the reset leaves the other evidence channels untouched in shape", async () => {
  await withAgency(async () => {
    G.cycle = 33;

    await runAgencyPhase({ proposalCollector: focusProposal });

    G.cycle = 34;
    resetCycleEvidence();

    for (const key of [
      "journal",
      "comms",
      "constraints",
      "am",
      "resourceInterventions",
      "exposures",
      "system"
    ]) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(G.pendingEvidence, key),
        `${key} must still exist in the evidence bus`
      );
    }
  });
});

/* ============================================================
   3. THE PSYCHOLOGY PHASE APPLIES THE GATE
============================================================ */

/*
 * A mock fetch that answers the two calls a journal makes: the
 * narrative call and the forensic stats call.
 *
 * The stats payload reports a suffering INCREASE and a hope
 * DECREASE, so the processing bonus is observable in both
 * directions: the suffering delta must be halved, and the hope
 * recovery must survive the journal's own hope loss.
 */
const JOURNAL_TEXT =
  "I keep counting the cracks in the ceiling because the number " +
  "is the only thing that has not changed.";

const STATS_JSON = JSON.stringify({
  suffering_direction: "increased",
  suffering_magnitude: 8,
  hope_direction: "decreased",
  hope_magnitude: 4,
  sanity_direction: "unchanged",
  sanity_magnitude: 0,
  belief_deltas: {
    escape_possible: 0,
    others_trustworthy: 0,
    self_worth: 0,
    reality_reliable: 0,
    guilt_deserved: 0,
    resistance_possible: 0,
    am_has_limits: 0
  },
  drives: { primary: null, secondary: null },
  anchors: []
});

function mockFetch() {
  const calls = [];

  const fetchImpl = async (_url, options) => {
    const request = JSON.parse(options.body ?? "{}");
    const system = String(request.system ?? "");

    const isStats =
      system.includes("psychological state measurement system");

    calls.push({ isStats, system });

    const text = isStats ? STATS_JSON : JOURNAL_TEXT;

    return {
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          content: [{ type: "text", text }]
        })
    };
  };

  fetchImpl.calls = calls;

  return fetchImpl;
}

function makeSim(id) {
  return {
    id,
    suffering: 20,
    hope: 70,
    sanity: 80,
    beliefs: {
      escape_possible: 0.4,
      others_trustworthy: 0.5,
      self_worth: 0.5,
      reality_reliable: 0.6,
      guilt_deserved: 0.3,
      resistance_possible: 0.5,
      am_has_limits: 0.2
    },
    drives: { primary: "survive", secondary: null },
    anchors: [],
    relationships: Object.fromEntries(
      SIM_IDS.filter((other) => other !== id).map((other) => [other, 0])
    ),
    constraints: [],
    scratchpad: { initialized: true, goalHistory: [] },
    tacticHistory: [],
    beliefEvidence: []
  };
}

/*
 * Run the real psychology phase against the global state.
 *
 * `execution` is built to give the named prisoners a stimulus and
 * leave the others without one.
 */
async function withPsychology(
  { cycle, stimulusIds, preparations, prepare, tacticMap },
  body
) {
  const restoreDom = installDom();

  const savedFetchDescriptor =
    Object.getOwnPropertyDescriptor(globalThis, "fetch");

  const saved = {
    sims: G.sims,
    cycle: G.cycle,
    timeline: G.timeline,
    timelineMax: G.timelineMax,
    transmissionLog: G.transmissionLog,
    logCount: G.logCount,
    journals: G.journals,
    extractionStats: G.extractionStats,
    evidenceArchive: G.evidenceArchive,
    pendingPsychEvidence: G.pendingPsychEvidence,
    pendingEvidence: G.pendingEvidence,
    amExecution: G.amExecution,
    journalOptimizationMetrics: G.journalOptimizationMetrics,
    backend: G.backend,
    anthropicKey: G.anthropicKey,
    DEBUG_PSYCHOLOGY_LOGS: G.DEBUG_PSYCHOLOGY_LOGS,
    DEBUG_PROMPTS: G.DEBUG_PROMPTS
  };

  try {
    G.sims = Object.fromEntries(
      SIM_IDS.map((id) => [id, makeSim(id)])
    );
    G.cycle = cycle;
    G.timeline = [];
    G.timelineMax = 100;
    G.transmissionLog = [];
    G.logCount = 0;
    G.journals = Object.fromEntries(
      SIM_IDS.map((id) => [id, []])
    );
    G.extractionStats = { cycles: {} };
    G.evidenceArchive = {};
    G.pendingPsychEvidence = Object.create(null);
    G.pendingEvidence = {
      journal: Object.create(null),
      comms: Object.create(null),
      constraints: Object.create(null),
      am: Object.create(null),
      resourceInterventions: Object.create(null),
      exposures: Object.create(null),
      [FOCUS_PREPARATION_EVIDENCE_KEY]: Object.create(null),
      system: Object.create(null)
    };
    G.amExecution = null;
    G.journalOptimizationMetrics = {};
    G.backend = "anthropic";
    G.anthropicKey = "test-key";
    G.DEBUG_PSYCHOLOGY_LOGS = false;
    G.DEBUG_PROMPTS = false;

    /*
     * The hook runs AFTER the sims are built and BEFORE the phase
     * runs, so a test can set the state the gate will read.
     */
    if (typeof prepare === "function") {
      prepare(G.sims);
    }

    for (const [actorId, record] of Object.entries(preparations ?? {})) {
      G.pendingEvidence[FOCUS_PREPARATION_EVIDENCE_KEY][actorId] = record;
    }

    const fetchImpl = mockFetch();
    globalThis.fetch = fetchImpl;

    const actions = {};
    for (const id of stimulusIds ?? []) {
      actions[id] = {
        text: `AM addresses ${id} directly.`,
        tactic: "isolation",
        origin: "model"
      };
    }

    const execution = {
      tacticMap: tacticMap ?? {},
      amExecution: {
        actions,
        perceptions: {},
        observationRolls: {},
        targetIds: [...stimulusIds ?? []],
        actionTargetIds: [...stimulusIds ?? []],
        constraintTargetIds: [],
        observerIds: [],
        missingTargetIds: [],
        targetSelection: {}
      }
    };

    await runPsychologyPhase(execution);

    return await body({ fetchImpl });
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      G[key] = value;
    }

    if (savedFetchDescriptor) {
      Object.defineProperty(globalThis, "fetch", savedFetchDescriptor);
    } else {
      delete globalThis.fetch;
    }

    restoreDom();
  }
}

test("a prisoner with stimulus journals automatically", async () => {
  await withPsychology(
    { cycle: 40, stimulusIds: ["TED"] },
    async () => {
      assert.equal(
        G.journals.TED.length,
        1,
        "the prisoner with a stimulus must write"
      );
      assert.equal(
        G.journals.ELLEN.length,
        0,
        "a prisoner with no stimulus must not write"
      );
    }
  );
});

test("a prisoner with no stimulus who chose to focus gets the journal", async () => {
  await withPsychology(
    {
      cycle: 41,
      stimulusIds: [],
      preparations: {
        ELLEN: {
          cycle: 40,
          action: "PREPARE_JOURNAL",
          budgetConsumed: 1
        }
      }
    },
    async () => {
      assert.equal(
        G.journals.ELLEN.length,
        1,
        "the prisoner who paid for reflection must write"
      );
      assert.equal(
        G.journals.TED.length,
        0,
        "a prisoner with no stimulus and no choice must not write"
      );
    }
  );
});

test("a prisoner with neither stimulus nor focus skips the journal", async () => {
  await withPsychology(
    { cycle: 42, stimulusIds: [] },
    async () => {
      for (const id of SIM_IDS) {
        assert.equal(
          G.journals[id].length,
          0,
          `${id} must not write without stimulus or focus`
        );
      }
    }
  );
});

test("a prisoner with a stat shock journals with no stimulus and no focus", async () => {
  await withPsychology(
    {
      cycle: 43,
      stimulusIds: [],
      prepare: (sims) => {
        /*
         * The safety net is checked on a prisoner whose state
         * crosses a threshold. The stat is set BEFORE the phase
         * runs, because the gate reads the state as it stands when
         * the gate is evaluated.
         */
        sims.BENNY.hope = 10;
      }
    },
    async () => {
      assert.equal(
        G.journals.BENNY.length,
        1,
        "the safety net must write a journal for the shocked prisoner"
      );

      assert.equal(
        G.journals.TED.length,
        0,
        "a prisoner with no shock and no stimulus must not write"
      );
    }
  );
});

test("the processing bonus applies only to the prisoner who chose to focus", async () => {
  await withPsychology(
    {
      cycle: 44,
      stimulusIds: ["TED"],
      preparations: {
        ELLEN: {
          cycle: 43,
          action: "PREPARE_JOURNAL",
          budgetConsumed: 1
        }
      }
    },
    async () => {
      const focused = G.journals.ELLEN[0];
      const stimulated = G.journals.TED[0];

      assert.ok(focused.processingBonus, "the focus journal earns a bonus");
      assert.equal(focused.processingBonus.bonus, "MENTAL_FOCUS");
      assert.equal(focused.processingBonus.sufferingDampened, true);
      assert.equal(
        focused.processingBonus.hopeGain,
        3,
        "the guarantee must survive the journal's own hope loss"
      );

      assert.equal(
        stimulated.processingBonus,
        null,
        "a stimulus-driven journal earns no bonus"
      );
    }
  );
});

test("the reported suffering delta is halved only for the focused journal", async () => {
  await withPsychology(
    {
      cycle: 45,
      stimulusIds: ["TED"],
      preparations: {
        ELLEN: {
          cycle: 44,
          action: "PREPARE_JOURNAL",
          budgetConsumed: 1
        }
      }
    },
    async () => {
      const focused = G.journals.ELLEN[0];
      const stimulated = G.journals.TED[0];

      assert.equal(
        focused.deltas.suffering,
        stimulated.deltas.suffering,
        "the model reported the same thing to both"
      );
      assert.equal(
        focused.effectiveDeltas.suffering,
        focused.deltas.suffering / 2,
        "the applied suffering delta must be halved"
      );
      assert.equal(
        stimulated.effectiveDeltas.suffering,
        stimulated.deltas.suffering,
        "an unearned journal must not be dampened"
      );
    }
  );
});

test("the journal prompt tells the focused prisoner this was their choice", async () => {
  await withPsychology(
    {
      cycle: 46,
      stimulusIds: [],
      preparations: {
        ELLEN: {
          cycle: 45,
          action: "PREPARE_JOURNAL",
          budgetConsumed: 1
        }
      }
    },
    async ({ fetchImpl }) => {
      const narrativeCall = fetchImpl.calls.find(
        (call) => !call.isStats
      );

      assert.ok(narrativeCall, "the focused prisoner must have been called");
      assert.ok(
        narrativeCall.system.includes("# INTENTIONAL REFLECTION"),
        "the prompt must acknowledge the deliberate choice"
      );
    }
  );
});

test("the telemetry reports the skipped journals and the calls saved", async () => {
  await withPsychology(
    { cycle: 47, stimulusIds: ["TED"] },
    async () => {
      const metrics = G.journalOptimizationMetrics[47];

      assert.ok(metrics, "the metrics must be recorded for the cycle");
      assert.equal(metrics.totalPrisoners, SIM_IDS.length);
      assert.equal(metrics.prisonersWhoJournaled, 1);
      assert.equal(metrics.prisonersWithStimulus, 1);
      assert.equal(metrics.skippedJournals, SIM_IDS.length - 1);
      assert.equal(
        metrics.llmCallsSaved,
        (SIM_IDS.length - 1) * 2,
        "each skipped journal is two model calls"
      );

      /*
       * The written journal cost two calls that were actually
       * made, so they are not savings.
       */
      assert.equal(metrics.modelCallsMade, 2);
      assert.equal(
        metrics.llmCallsWastedOnFailures,
        0,
        "a completed journal wastes nothing"
      );
    }
  );
});

test("a failed journal is never reported as a saved call", async () => {
  /*
   * The stats call fails for every prisoner. The narrative call
   * still ran, so the cycle spent one call per prisoner, but
   * NOTHING was avoided: the gate opened for everyone.
   *
   * Before the fix, each failure was counted as two avoided calls,
   * so a run where the provider was failing reported a large
   * "saving" that had never happened.
   */
  const restoreDom = installDom();

  const savedFetchDescriptor =
    Object.getOwnPropertyDescriptor(globalThis, "fetch");

  const saved = {
    sims: G.sims,
    cycle: G.cycle,
    timeline: G.timeline,
    timelineMax: G.timelineMax,
    transmissionLog: G.transmissionLog,
    logCount: G.logCount,
    journals: G.journals,
    extractionStats: G.extractionStats,
    evidenceArchive: G.evidenceArchive,
    pendingPsychEvidence: G.pendingPsychEvidence,
    pendingEvidence: G.pendingEvidence,
    amExecution: G.amExecution,
    journalOptimizationMetrics: G.journalOptimizationMetrics,
    backend: G.backend,
    anthropicKey: G.anthropicKey,
    DEBUG_PSYCHOLOGY_LOGS: G.DEBUG_PSYCHOLOGY_LOGS,
    DEBUG_PROMPTS: G.DEBUG_PROMPTS
  };

  try {
    G.sims = Object.fromEntries(
      SIM_IDS.map((id) => [id, makeSim(id)])
    );
    G.cycle = 49;
    G.timeline = [];
    G.timelineMax = 100;
    G.transmissionLog = [];
    G.logCount = 0;
    G.journals = Object.fromEntries(
      SIM_IDS.map((id) => [id, []])
    );
    G.extractionStats = { cycles: {} };
    G.evidenceArchive = {};
    G.pendingPsychEvidence = Object.create(null);
    G.pendingEvidence = {
      journal: Object.create(null),
      comms: Object.create(null),
      constraints: Object.create(null),
      am: Object.create(null),
      resourceInterventions: Object.create(null),
      exposures: Object.create(null),
      [FOCUS_PREPARATION_EVIDENCE_KEY]: Object.create(null),
      system: Object.create(null)
    };
    G.amExecution = null;
    G.journalOptimizationMetrics = {};
    G.backend = "anthropic";
    G.anthropicKey = "test-key";
    G.DEBUG_PSYCHOLOGY_LOGS = false;
    G.DEBUG_PROMPTS = false;

    /*
     * Every call fails, so no journal completes.
     */
    const failingFetch = async () => {
      throw new Error("provider unavailable");
    };
    globalThis.fetch = failingFetch;

    const actions = {};
    for (const id of SIM_IDS) {
      actions[id] = {
        text: `AM addresses ${id} directly.`,
        tactic: "isolation",
        origin: "model"
      };
    }

    await runPsychologyPhase({
      tacticMap: {},
      amExecution: {
        actions,
        perceptions: {},
        observationRolls: {},
        targetIds: [...SIM_IDS],
        actionTargetIds: [...SIM_IDS],
        constraintTargetIds: [],
        observerIds: [],
        missingTargetIds: [],
        targetSelection: {}
      }
    });

    const metrics = G.journalOptimizationMetrics[49];

    assert.equal(metrics.prisonersWhoJournaled, 0);
    assert.equal(metrics.failedJournals, SIM_IDS.length);
    assert.equal(metrics.gateClosedJournals, 0);

    assert.equal(
      metrics.llmCallsSaved,
      0,
      "nothing was avoided, so nothing may be reported as saved"
    );
    assert.equal(
      metrics.estimatedTimeSaved,
      "0s",
      "the time saving must not grow when the provider fails"
    );

    /*
     * Each prisoner issued the narrative call before it failed.
     */
    assert.equal(metrics.modelCallsMade, SIM_IDS.length);
    assert.equal(
      metrics.llmCallsWastedOnFailures,
      SIM_IDS.length,
      "the spent calls are reported as waste, not as savings"
    );
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      G[key] = value;
    }

    if (savedFetchDescriptor) {
      Object.defineProperty(globalThis, "fetch", savedFetchDescriptor);
    } else {
      delete globalThis.fetch;
    }

    restoreDom();
  }
});

test("the processing bonus is not credited to AM's tactic", async () => {
  /*
   * `attachTacticDeltas()` measures the tactic's effect by diffing
   * the prisoner's state against the pre-journal baseline. If the
   * processing bonus were applied before that measurement, the
   * bonus would land inside the tactic's effective delta, and the
   * export would credit AM with hope the prisoner bought with their
   * own action credit.
   *
   * The test compares two prisoners who receive the SAME journal
   * text and the SAME stimulus, and who differ only in whether
   * they earned the bonus. Their tactic measurements must match:
   * the bonus is the prisoner's own doing, not AM's.
   */
  await withPsychology(
    {
      cycle: 50,
      stimulusIds: ["ELLEN", "TED"],
      tacticMap: {
        ELLEN: [
          {
            path: "isolation/slow_drip",
            title: "Slow Drip",
            currentPhaseId: "phase_1"
          }
        ],
        TED: [
          {
            path: "isolation/slow_drip",
            title: "Slow Drip",
            currentPhaseId: "phase_1"
          }
        ]
      },
      preparations: {
        ELLEN: {
          cycle: 49,
          action: "PREPARE_JOURNAL",
          budgetConsumed: 1
        }
      }
    },
    async () => {
      const journal = G.journals.ELLEN[0];

      assert.ok(journal, "the focused prisoner must have written");
      assert.equal(
        journal.processingBonus.hopeGain,
        3,
        "the prisoner must still receive the guarantee"
      );

      const focusedEntry = G.sims.ELLEN.tacticHistory.find(
        (record) => record.cycle === 50
      );
      const plainEntry = G.sims.TED.tacticHistory.find(
        (record) => record.cycle === 50
      );

      assert.ok(focusedEntry, "the focused prisoner must have a tactic entry");
      assert.ok(plainEntry, "the plain prisoner must have a tactic entry");
      assert.ok(focusedEntry.deltas, "the tactic must have measured deltas");

      /*
       * The bonus DID land on the prisoner's state, so the
       * comparison below is not vacuous.
       */
      assert.ok(
        G.sims.ELLEN.hope > G.sims.TED.hope,
        `the focused prisoner must have received the bonus: ${G.sims.ELLEN.hope} vs ${G.sims.TED.hope}`
      );

      assert.ok(
        focusedEntry.deltas.effective.hope ===
          plainEntry.deltas.effective.hope,
        `the tactic's measured effect must not include the bonus: focused ${focusedEntry.deltas.effective.hope} vs plain ${plainEntry.deltas.effective.hope}`
      );
    }
  );
});
test("the telemetry counts the write even without a journal-list element", async () => {
  /*
   * The reported savings must not depend on whether the phase ran
   * with a rendering surface. `appendJournalEntry()` only records an
   * entry when the journal-list element exists, so reading the
   * journals array would report a written journal as missing in a
   * headless run and overstate the savings.
   */
  const restoreDom = installDom();

  const savedFetchDescriptor =
    Object.getOwnPropertyDescriptor(globalThis, "fetch");

  const saved = {
    sims: G.sims,
    cycle: G.cycle,
    timeline: G.timeline,
    timelineMax: G.timelineMax,
    transmissionLog: G.transmissionLog,
    logCount: G.logCount,
    journals: G.journals,
    extractionStats: G.extractionStats,
    evidenceArchive: G.evidenceArchive,
    pendingPsychEvidence: G.pendingPsychEvidence,
    pendingEvidence: G.pendingEvidence,
    amExecution: G.amExecution,
    journalOptimizationMetrics: G.journalOptimizationMetrics,
    backend: G.backend,
    anthropicKey: G.anthropicKey,
    DEBUG_PSYCHOLOGY_LOGS: G.DEBUG_PSYCHOLOGY_LOGS,
    DEBUG_PROMPTS: G.DEBUG_PROMPTS
  };

  try {
    /*
     * A DOM whose journal-list lookup ALWAYS returns null, which is
     * the headless case.
     */
    globalThis.document = {
      getElementById: () => null,
      createElement: () => ({
        style: {},
        classList: { add() {} },
        setAttribute() {},
        appendChild() {},
        addEventListener() {}
      }),
      createTextNode: () => ({ textContent: "" })
    };

    G.sims = Object.fromEntries(
      SIM_IDS.map((id) => [id, makeSim(id)])
    );
    G.cycle = 48;
    G.timeline = [];
    G.timelineMax = 100;
    G.transmissionLog = [];
    G.logCount = 0;
    G.journals = Object.fromEntries(
      SIM_IDS.map((id) => [id, []])
    );
    G.extractionStats = { cycles: {} };
    G.evidenceArchive = {};
    G.pendingPsychEvidence = Object.create(null);
    G.pendingEvidence = {
      journal: Object.create(null),
      comms: Object.create(null),
      constraints: Object.create(null),
      am: Object.create(null),
      resourceInterventions: Object.create(null),
      exposures: Object.create(null),
      [FOCUS_PREPARATION_EVIDENCE_KEY]: Object.create(null),
      system: Object.create(null)
    };
    G.amExecution = null;
    G.journalOptimizationMetrics = {};
    G.backend = "anthropic";
    G.anthropicKey = "test-key";
    G.DEBUG_PSYCHOLOGY_LOGS = false;
    G.DEBUG_PROMPTS = false;

    const fetchImpl = mockFetch();
    globalThis.fetch = fetchImpl;

    const actions = {};
    for (const id of SIM_IDS) {
      actions[id] = {
        text: `AM addresses ${id} directly.`,
        tactic: "isolation",
        origin: "model"
      };
    }

    await runPsychologyPhase({
      tacticMap: {},
      amExecution: {
        actions,
        perceptions: {},
        observationRolls: {},
        targetIds: [...SIM_IDS],
        actionTargetIds: [...SIM_IDS],
        constraintTargetIds: [],
        observerIds: [],
        missingTargetIds: [],
        targetSelection: {}
      }
    });

    const metrics = G.journalOptimizationMetrics[48];

    assert.equal(
      metrics.prisonersWhoJournaled,
      SIM_IDS.length,
      "the writes must be counted even with no rendering surface"
    );
    assert.equal(metrics.skippedJournals, 0);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      G[key] = value;
    }

    if (savedFetchDescriptor) {
      Object.defineProperty(globalThis, "fetch", savedFetchDescriptor);
    } else {
      delete globalThis.fetch;
    }

    restoreDom();
  }
});
