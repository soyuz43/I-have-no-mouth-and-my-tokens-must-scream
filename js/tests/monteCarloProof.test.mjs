import assert from "node:assert/strict";
import test from "node:test";

import { G } from "../core/state.js";
import { exportState, importState } from "../core/saveLoad.js";
import {
  engineRng,
  researchRng,
  seedAll,
  uiRng,
} from "../core/prng.js";
import {
  clearTape,
  exportTape,
  importTape,
  setMode,
  TAPE_MODES,
} from "../core/replayTape.js";
import { computeAttribution } from "../engine/analysis/assessment.js";
import { runCycle } from "../engine/cycle.js";
import { initExporter } from "../utils/exporter.js";
import { createMockModelFetch } from "./utils/mockModelCaller.js";

const FIXED_TIME = Date.UTC(2025, 0, 1, 12, 0, 0);
const TEST_SEED = 0x5eed1234;
const NativeDate = globalThis.Date;

test("assessment attribution deltas handle nested and missing numeric leaves", () => {
  const priorSnapshots = G.beliefSnapshots;
  const priorDebugSetting = G.DEBUG_ATTRIBUTION;
  G.DEBUG_ATTRIBUTION = false;
  G.beliefSnapshots = {
    prePsychology: {
      TED: {
        hope: 10,
        sanity: undefined,
        suffering: 0,
        beliefs: {
          trust: 0.2,
          nested: { belief: 0.4 },
          missing: 0.3,
        },
      },
    },
    postPsychology: {
      TED: {
        hope: 12,
        sanity: 11,
        suffering: 0,
        beliefs: {
          trust: undefined,
          nested: { belief: 0.7, added: 0.5 },
          added: 0.4,
        },
      },
    },
    final: {
      TED: {
        hope: 13,
        sanity: 11,
        suffering: 0,
        beliefs: {
          trust: 0.1,
          nested: { belief: 0.9 },
          added: 0.2,
        },
      },
    },
  };

  try {
    const attribution = computeAttribution("TED");
    assert.deepStrictEqual(attribution.beliefs.am, {
      trust: -0.2,
      nested: { belief: 0.7 - 0.4, added: 0.5 },
      missing: -0.3,
      added: 0.4,
    });
    assert.deepStrictEqual(attribution.beliefs.contagion, {
      trust: 0.1,
      nested: { belief: 0.9 - 0.7, added: -0.5 },
      added: -0.2,
    });
    assert.ok(Number.isFinite(attribution.stats.am.sanity));
  } finally {
    if (priorSnapshots === undefined) delete G.beliefSnapshots;
    else G.beliefSnapshots = priorSnapshots;
    G.DEBUG_ATTRIBUTION = priorDebugSetting;
  }
});

test("a Cycle 2 checkpoint forks into byte-identical Cycle 3 replay", async () => {
  const originalGlobals = new Map(
    ["Date", "performance", "fetch", "document", "window"].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  const originalConsole = Object.fromEntries(
    ["debug", "error", "group", "groupCollapsed", "groupEnd", "info", "log", "table", "trace", "warn"]
      .map((key) => [key, console[key]]),
  );
  const mockFetch = createMockModelFetch();

  function FixedDate(...args) {
    if (!new.target) return new NativeDate(FIXED_TIME).toString();
    return Reflect.construct(NativeDate, args.length ? args : [FIXED_TIME], new.target);
  }
  Object.setPrototypeOf(FixedDate, NativeDate);
  FixedDate.prototype = NativeDate.prototype;
  FixedDate.now = () => FIXED_TIME;

  try {
    Object.defineProperty(globalThis, "Date", {
      configurable: true,
      writable: true,
      value: FixedDate,
    });
    Object.defineProperty(globalThis, "performance", {
      configurable: true,
      writable: true,
      value: { now: () => 0 },
    });
    globalThis.fetch = mockFetch.fetch;
    globalThis.document = { getElementById: () => null };
    globalThis.window = { _timelineMissing: true };
    for (const key of Object.keys(originalConsole)) console[key] = () => {};

    assert.equal(G.cycle, 0, "test process starts with a fresh game state");
    G.backend = "anthropic";
    G.anthropicKey = "offline-test-key";
    G.DEBUG_PROMPTS = false;
    seedAll(TEST_SEED);
    initExporter("monte-carlo-proof");
    G._exporterInitialized = true;
    clearTape();
    setMode(TAPE_MODES.RECORD);

    await runCycle();
    await runCycle();
    const cycle2Checkpoint = exportState();
    await runCycle();

    const baselineState = structuredClone(G);
    const baselineRngStates = captureRngStates();
    const fullTimelineTape = exportTape();
    const recordedModelCalls = mockFetch.getCallCount();

    assert.equal(G.cycle, 3);
    assert.equal(recordedModelCalls > 0, true, "RECORD invokes the offline mock");
    assert.equal(fullTimelineTape.entries.length > 0, true);
    assert.doesNotThrow(() => exportState(), "Cycle 3 must remain serializable");
    assert.equal(
      Object.values(baselineState.attributionMetrics[3]).every((metrics) =>
        hasOnlyFiniteNumbers(metrics),
      ),
      true,
      "Cycle 3 attribution metrics contain only finite numeric deltas",
    );

    await importState(cycle2Checkpoint);
    importTape(fullTimelineTape);
    setMode(TAPE_MODES.REPLAY);
    const callsBeforeReplay = mockFetch.getCallCount();
    await runCycle();

    const replayState = structuredClone(G);
    const replayRngStates = captureRngStates();

    assert.equal(G.cycle, 3);
    assert.equal(
      mockFetch.getCallCount(),
      callsBeforeReplay,
      "REPLAY serves tape responses without executing the mock caller",
    );
    assert.deepStrictEqual(replayRngStates, baselineRngStates);
    assert.deepStrictEqual(replayState, baselineState);
    assert.equal(stableStringify(replayState), stableStringify(baselineState));
    assert.deepStrictEqual(
      Object.fromEntries(Object.entries(replayState.sims).map(([id, sim]) => [id, sim.scratchpad])),
      Object.fromEntries(Object.entries(baselineState.sims).map(([id, sim]) => [id, sim.scratchpad])),
    );
    assert.deepStrictEqual(replayState.agency.events, baselineState.agency.events);
    assert.deepStrictEqual(replayState.comms.history, baselineState.comms.history);
  } finally {
    setMode(TAPE_MODES.OFF);
    clearTape();
    for (const [key, descriptor] of originalGlobals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    for (const [key, method] of Object.entries(originalConsole)) console[key] = method;
  }
});

function captureRngStates() {
  return {
    engineRng: engineRng.getState(),
    uiRng: uiRng.getState(),
    researchRng: researchRng.getState(),
  };
}

function hasOnlyFiniteNumbers(value) {
  if (typeof value === "number") return Number.isFinite(value);
  if (value && typeof value === "object") {
    return Object.values(value).every(hasOnlyFiniteNumbers);
  }
  return true;
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}
