// js/tests/psychologyParallelInference.test.mjs
//
// Regression coverage for the journal phase's PREPARE / INFER /
// COMMIT split.
//
// The journal phase fans model inference out across prisoners, but
// commits the resulting state serially. Two properties must hold:
//
//   1. Running with model concurrency above 1 must produce the same
//      engine state as running with concurrency 1. Inference order
//      must not leak into results.
//
//   2. The exported timeline and transmission log must keep a
//      deterministic order. These are written from the inference
//      stage, so they are buffered and flushed during commit;
//      otherwise their order would depend on which provider
//      response arrived first.
//
// The second property is the one that would silently break
// byte-reproducible exports, so it is asserted explicitly.

import assert from "node:assert/strict";
import test from "node:test";

import { G } from "../core/state.js";
import { SIM_IDS } from "../core/constants.js";
import { setModelConcurrency } from "../models/modelQueue.js";
import { runPsychologyPhase } from "../engine/phases/psychologyPhase.js";

const JOURNAL_TEXT =
  "I keep counting the cracks in the ceiling because the number " +
  "is the only thing that has not changed.";

const STATS_JSON = JSON.stringify({
  suffering_direction: "increased",
  suffering_magnitude: 4,
  hope_direction: "decreased",
  hope_magnitude: 3,
  sanity_direction: "unchanged",
  sanity_magnitude: 0,
  belief_deltas: {
    escape_possible: -1,
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
      SIM_IDS
        .filter((other) => other !== id)
        .map((other) => [other, 0])
    ),
    constraints: [],
    scratchpad: { goalHistory: [] },
    tacticHistory: [],
    beliefEvidence: []
  };
}

function buildExecution() {
  const actions = {};

  for (const id of SIM_IDS) {
    actions[id] = {
      text: `AM addresses ${id} directly.`,
      tactic: "isolation",
      origin: "model"
    };
  }

  return {
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
  };
}

function createMockFetch({ delayForSim } = {}) {
  const calls = [];

  const fetchImpl = async (_url, options) => {
    const request = JSON.parse(options.body ?? "{}");
    const system = String(request.system ?? "");

    const isStats =
      system.includes(
        "psychological state measurement system"
      );

    calls.push({ isStats, system });

    if (delayForSim) {
      const match =
        system.match(
          new RegExp(
            `You are \\*\\*(${SIM_IDS.join("|")})\\*\\*`
          )
        ) ??
        system.match(
          new RegExp(
            `Journal Author: (${SIM_IDS.join("|")})`
          )
        );

      if (match) {
        await delayForSim(match[1], isStats);
      }
    }

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

function delay(ms) {
  return new Promise((resolve) =>
    setTimeout(resolve, ms)
  );
}

async function runPsychologyWith({
  concurrency,
  delayForSim
}) {
  const savedState = {
    sims: G.sims,
    cycle: G.cycle,
    timeline: G.timeline,
    timelineMax: G.timelineMax,
    transmissionLog: G.transmissionLog,
    logCount: G.logCount,
    journals: G.journals,
    extractionStats: G.extractionStats,
    debugTrace: G.debugTrace,
    evidenceArchive: G.evidenceArchive,
    pendingPsychEvidence: G.pendingPsychEvidence,
    backend: G.backend,
    anthropicKey: G.anthropicKey,
    DEBUG_PROMPTS: G.DEBUG_PROMPTS,
    DEBUG_PSYCHOLOGY_LOGS: G.DEBUG_PSYCHOLOGY_LOGS
  };

  const savedFetchDescriptor =
    Object.getOwnPropertyDescriptor(globalThis, "fetch");

  const savedDocumentDescriptor =
    Object.getOwnPropertyDescriptor(globalThis, "document");

  const savedWindowDescriptor =
    Object.getOwnPropertyDescriptor(globalThis, "window");

  const savedConsole = Object.fromEntries(
    [
      "debug",
      "error",
      "group",
      "groupEnd",
      "log",
      "table",
      "warn"
    ].map((key) => [key, console[key]])
  );

  try {
    G.sims = Object.fromEntries(
      SIM_IDS.map((id) => [id, makeSim(id)])
    );

    G.cycle = 4;
    G.timeline = [];
    G.timelineMax = 100;
    G.transmissionLog = [];
    G.logCount = 0;
    G.journals = Object.fromEntries(
      SIM_IDS.map((id) => [id, []])
    );
    G.extractionStats = { cycles: {} };
    G.debugTrace = [];
    G.evidenceArchive = {};
    G.pendingPsychEvidence = Object.create(null);
    G.backend = "anthropic";
    G.anthropicKey = "test-key";
    G.DEBUG_PROMPTS = false;
    G.DEBUG_PSYCHOLOGY_LOGS = false;

    globalThis.document = { getElementById: () => null };
    globalThis.window = {};

    for (const key of Object.keys(savedConsole)) {
      console[key] = () => {};
    }

    const mockFetch = createMockFetch({ delayForSim });

    globalThis.fetch = mockFetch;

    setModelConcurrency(concurrency);

    await runPsychologyPhase(buildExecution());

    return {
      sims: structuredClone(G.sims),
      timeline:
        structuredClone(G.timeline).map(
          (event) => event.label
        ),
      transmissionLog:
        structuredClone(G.transmissionLog).map(
          (entry) => ({
            speaker: entry.speaker,
            body: entry.body,
            type: entry.type,
            tactic: entry.tactic
          })
        ),
      calls: mockFetch.calls.length
    };
  } finally {
    setModelConcurrency(1);

    for (const [key, value] of Object.entries(savedState)) {
      G[key] = value;
    }

    if (savedFetchDescriptor) {
      Object.defineProperty(globalThis, "fetch", savedFetchDescriptor);
    } else {
      delete globalThis.fetch;
    }

    if (savedDocumentDescriptor) {
      Object.defineProperty(globalThis, "document", savedDocumentDescriptor);
    } else {
      delete globalThis.document;
    }

    if (savedWindowDescriptor) {
      Object.defineProperty(globalThis, "window", savedWindowDescriptor);
    } else {
      delete globalThis.window;
    }

    for (const [key, method] of Object.entries(savedConsole)) {
      console[key] = method;
    }
  }
}

test("concurrent journal inference produces the same state as serial inference", async () => {
  const serial = await runPsychologyWith({ concurrency: 1 });

  const parallel = await runPsychologyWith({ concurrency: 5 });

  assert.equal(
    parallel.calls,
    serial.calls,
    "both runs should issue one journal and one stats call per prisoner"
  );

  assert.deepEqual(
    parallel.sims,
    serial.sims,
    "prisoner state must not depend on inference concurrency"
  );

  assert.deepEqual(
    parallel.timeline,
    serial.timeline,
    "timeline ordering must not depend on provider response order"
  );

  assert.deepEqual(
    parallel.transmissionLog,
    serial.transmissionLog,
    "transmission log ordering must not depend on provider response order"
  );
});

test("out-of-order provider responses do not change committed results", async () => {
  const delayForSim = async (simId) => {
    const index = SIM_IDS.indexOf(simId);

    await delay(20 - index * 4);
  };

  const serial = await runPsychologyWith({
    concurrency: 1,
    delayForSim
  });

  const parallel = await runPsychologyWith({
    concurrency: 5,
    delayForSim
  });

  assert.deepEqual(
    parallel.sims,
    serial.sims,
    "a prisoner finishing last must not change any committed result"
  );

  assert.deepEqual(parallel.timeline, serial.timeline);

  assert.deepEqual(
    parallel.transmissionLog,
    serial.transmissionLog
  );
});

test("journal phase commits in target order regardless of response order", async () => {
  const delayForSim = async (simId) => {
    const index = SIM_IDS.indexOf(simId);

    await delay(20 - index * 4);
  };

  const result = await runPsychologyWith({
    concurrency: 5,
    delayForSim
  });

  const committedOrder =
    result.timeline
      .filter((label) =>
        label.endsWith("journal written")
      )
      .map((label) => label.split(" ")[0]);

  assert.deepEqual(
    committedOrder,
    SIM_IDS,
    "journal events must be emitted in prisoner order, not response order"
  );
});
