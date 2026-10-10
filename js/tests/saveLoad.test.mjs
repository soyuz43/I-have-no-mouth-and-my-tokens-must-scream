import assert from "node:assert/strict";
import { test } from "node:test";

import { G } from "../core/state.js";
import { exportState, importState } from "../core/saveLoad.js";
import {
  engineRng,
  researchRng,
  seedAll,
  uiRng,
} from "../core/prng.js";
import { Exporter } from "../utils/exporter/state.js";

test("exportState omits credentials and runtime-only handles", () => {
  const previous = {
    colabBearerToken: G.colabBearerToken,
    autoTimer: G.autoTimer,
    autoRunning: G.autoRunning,
    hadResearch: Object.hasOwn(G, "research"),
    research: G.research,
  };
  const timer = setTimeout(() => {}, 60_000);

  try {
    G.colabBearerToken = "test-secret";
    G.autoTimer = timer;
    G.autoRunning = false;
    G.research = { runRollouts() {} };

    const saved = JSON.parse(exportState());

    assert.equal(saved.schemaVersion, 1);
    assert.equal(saved.engineVersion, "1.0.0");
    assert.equal(saved.cycle, G.cycle);
    assert.equal(Object.hasOwn(saved.G, "colabBearerToken"), false);
    assert.equal(Object.hasOwn(saved.G, "autoTimer"), false);
    assert.equal(Object.hasOwn(saved.G, "research"), false);
    assert.ok(saved.Exporter);
    assert.deepEqual(Object.keys(saved.rngStates).sort(), [
      "engineRng",
      "researchRng",
      "uiRng",
    ]);
    for (const state of Object.values(saved.rngStates)) {
      assert.ok(Number.isInteger(state.state));
      assert.ok(state.state >= 0 && state.state <= 0xffffffff);
    }
  } finally {
    clearTimeout(timer);
    G.colabBearerToken = previous.colabBearerToken;
    G.autoTimer = previous.autoTimer;
    G.autoRunning = previous.autoRunning;
    if (previous.hadResearch) {
      G.research = previous.research;
    } else {
      delete G.research;
    }
  }
});

test("exportState and importState restore all PRNG streams", async () => {
  const streams = [engineRng, uiRng, researchRng];
  const originalStates = streams.map((stream) => stream.getState());

  try {
    seedAll("save-load-round-trip");
    const savedEnvelope = JSON.parse(exportState());
    const expectedContinuation = streams.map((stream) =>
      Array.from({ length: 8 }, () => stream.next()),
    );

    seedAll("different-seed");
    streams.forEach((stream) => stream.next());
    await importState(JSON.stringify(savedEnvelope));

    assert.deepEqual(
      streams.map((stream) => stream.getState()),
      [
        savedEnvelope.rngStates.engineRng,
        savedEnvelope.rngStates.uiRng,
        savedEnvelope.rngStates.researchRng,
      ],
    );
    assert.deepEqual(
      streams.map((stream) => Array.from({ length: 8 }, () => stream.next())),
      expectedContinuation,
    );
  } finally {
    streams.forEach((stream, index) => stream.setState(originalStates[index]));
  }
});

test("importState mutates the supplied game and exporter objects in place", async () => {
  const research = { probeMethod() {} };
  const game = {
    cycle: 2,
    obsolete: true,
    autoRunning: true,
    autoTimer: null,
    colabBearerToken: "old-secret",
    research,
    sims: { TED: {} },
    cognitionHighlights: { TED: { cycle: 2, changes: ["old"] } },
  };
  const exporter = { oldBuffer: ["old"] };
  const gameReference = game;
  const exporterReference = exporter;
  const json = JSON.stringify({
    schemaVersion: 1,
    engineVersion: "1.0.0",
    savedAt: 123,
    cycle: 8,
    G: {
      cycle: 8,
      sims: { TED: { hope: 42 } },
      cognitionHighlights: { TED: { cycle: 7, changes: ["saved"] } },
    },
    Exporter: { runId: "restored-run", buffers: { state: [{ cycle: 8 }] } },
  });

  await importState(json, { game, exporter });

  assert.strictEqual(game, gameReference);
  assert.strictEqual(exporter, exporterReference);
  assert.equal(game.cycle, 8);
  assert.equal(Object.hasOwn(game, "obsolete"), false);
  assert.deepEqual(game.sims, { TED: { hope: 42 } });
  assert.equal(game.colabBearerToken, "");
  assert.equal(game.autoTimer, null);
  assert.equal(game.autoRunning, false);
  assert.equal(game._exporterInitialized, true);
  assert.strictEqual(game.research, research);
  assert.deepEqual(game.cognitionHighlights, {
    TED: { cycle: null, changes: [] },
  });
  assert.deepEqual(exporter, {
    runId: "restored-run",
    buffers: { state: [{ cycle: 8 }] },
  });
});

test("importState rejects unsupported schema versions without mutating state", async () => {
  const game = { cycle: 3, autoRunning: false };
  const exporter = { runId: "untouched" };
  const invalidSave = JSON.stringify({
    schemaVersion: 2,
    G: { cycle: 9 },
    Exporter: { runId: "replacement" },
  });

  await assert.rejects(
    importState(invalidSave, { game, exporter }),
    /unsupported schema version/,
  );

  assert.deepEqual(game, { cycle: 3, autoRunning: false });
  assert.deepEqual(exporter, { runId: "untouched" });
});

test("heavy populated simulation state and exporter telemetry round-trip intact", async () => {
  const originalGameProperties = Object.getOwnPropertyDescriptors(G);
  const originalExporterProperties = Object.getOwnPropertyDescriptors(Exporter);

  try {
    populateHeavyState();

    const gameSingleton = G;
    const exporterSingleton = Exporter;
    const originalSave = JSON.parse(exportState());

    assert.equal(Object.getPrototypeOf(G.pendingBeliefEvidence), null);
    await importState(JSON.stringify(originalSave));

    const restoredSave = JSON.parse(exportState());
    assert.deepEqual(restoredSave.G, originalSave.G);
    assert.deepEqual(restoredSave.Exporter, originalSave.Exporter);
    assert.strictEqual(G, gameSingleton);
    assert.strictEqual(Exporter, exporterSingleton);
    assert.equal(Exporter.runId, "heavy-round-trip-run-0042");
    assert.deepEqual(Exporter.buffers, originalSave.Exporter.buffers);
    assert.deepEqual(G.pendingBeliefEvidence, {
      TED: {
        "escape_possible": ["C42-M000118", "C42-O000041"],
        "am_has_limits": ["restraint_report"],
      },
    });
  } finally {
    restoreOwnProperties(G, originalGameProperties);
    restoreOwnProperties(Exporter, originalExporterProperties);
  }
});

test("exportState rejects values JSON would silently discard", () => {
  const originalGameProperties = Object.getOwnPropertyDescriptors(G);

  try {
    G.sims = structuredClone(G.sims);

    for (const [name, value] of [
      ["Map", new Map([["telemetry", 42]])],
      ["Set", new Set(["telemetry"])],
      ["function", () => "runtime-only"],
    ]) {
      G.sims.TED.unsupportedRuntimeValue = value;
      assert.throws(
        () => exportState(),
        new RegExp(`Unsupported ${name} value at G\\.sims\\.TED\\.unsupportedRuntimeValue`),
      );
      delete G.sims.TED.unsupportedRuntimeValue;
    }
  } finally {
    restoreOwnProperties(G, originalGameProperties);
  }
});

test("importState rejects malformed JSON and future schemas before live mutation", async () => {
  const originalGameProperties = Object.getOwnPropertyDescriptors(G);
  const originalExporterProperties = Object.getOwnPropertyDescriptors(Exporter);

  try {
    G.cycle = 42;
    G.sims = structuredClone(G.sims);
    G.sims.TED.hope = 63;
    Exporter.runId = "schema-rejection-sentinel";
    Exporter.buffers = {
      ...structuredClone(Exporter.buffers),
      state: [{ cycle: 42, hope: 63 }],
    };

    const before = JSON.parse(exportState());
    await assert.rejects(importState("{ malformed"), SyntaxError);
    const afterMalformedJson = JSON.parse(exportState());
    assert.deepEqual(afterMalformedJson.G, before.G);
    assert.deepEqual(afterMalformedJson.Exporter, before.Exporter);

    const futureSave = {
      ...before,
      schemaVersion: 2,
      cycle: 99,
      G: { ...before.G, cycle: 99 },
      Exporter: { ...before.Exporter, runId: "must-not-load" },
    };

    await assert.rejects(
      importState(JSON.stringify(futureSave)),
      /unsupported schema version/i,
    );

    const afterFutureSchema = JSON.parse(exportState());
    assert.deepEqual(afterFutureSchema.G, before.G);
    assert.deepEqual(afterFutureSchema.Exporter, before.Exporter);
  } finally {
    restoreOwnProperties(G, originalGameProperties);
    restoreOwnProperties(Exporter, originalExporterProperties);
  }
});

function populateHeavyState() {
  const cycle = 42;
  const messageHistory = Array.from({ length: 128 }, (_, index) => ({
    messageId: `C${cycle}-M${String(index + 1).padStart(6, "0")}`,
    sequence: index + 1,
    cycle: cycle - Math.floor((127 - index) / 3),
    kind: index % 4 === 0 ? "RUMOR" : "REPLY",
    from: ["TED", "ELLEN", "NIMDOK", "GORRISTER", "BENNY"][index % 5],
    to: [["ELLEN"], ["TED", "NIMDOK"], ["BENNY"]][index % 3],
    text: `Message ${index + 1}: AM's latest test changes the group's escape plan.`,
    autonomous: index % 3 === 0,
    visibility: index % 2 === 0 ? "private" : "public",
    intent: index % 2 === 0 ? "warn" : "coordinate",
    normalizedIntent: index % 2 === 0 ? "warn" : "coordinate",
    intentParseStatus: "parsed",
    metadata: { trust: 0.42 + (index % 5) / 10, evidence: [`E-${index + 1}`] },
  }));

  const fullEvent = {
    eventId: "C42-O000041",
    sequence: 41,
    cycle,
    listener: "TED",
    participants: { from: "ELLEN", to: ["NIMDOK"] },
    outcome: "full",
    sourceMessageIds: ["C42-M000118"],
    observations: [{
      sourceMessageId: "C42-M000118",
      sourceMessageSequence: 118,
      perception: "full",
      text: "The eastern corridor is clear until the lights cycle.",
      characterRange: { start: 0, end: 55 },
    }],
    sourceKind: "REPLY",
    sourceVisibility: "private",
    createdAt: 1_791_500_000_041,
  };
  const fragmentEvent = {
    eventId: "C42-O000042",
    sequence: 42,
    cycle,
    listener: "BENNY",
    participants: { from: "TED", to: ["ELLEN"] },
    outcome: "fragment",
    sourceMessageIds: ["C42-M000121"],
    observations: [{
      sourceMessageId: "C42-M000121",
      sourceMessageSequence: 121,
      perception: "middle_fragment",
      text: "...when the door opens...",
      characterRange: { start: 23, end: 42 },
    }],
    sourceKind: "OUTREACH",
    sourceVisibility: "private",
    createdAt: 1_791_500_000_042,
  };

  G.cycle = cycle;
  G.autoRunning = false;
  G.autoTimer = null;
  G.colabBearerToken = "";
  G._exporterInitialized = true;
  G.journalModalSim = "TED";
  G.cognitionModalSim = "TED";
  G.cognitionModalView = "sim";
  G.cognitionHighlights = Object.fromEntries(
    Object.keys(G.sims).map((simId) => [simId, { cycle: null, changes: [] }]),
  );

  G.sims = structuredClone(G.sims);
  const scratchpad = G.sims.TED.scratchpad;
  scratchpad.initialized = true;
  scratchpad.revision = 187;
  scratchpad.lastUpdatedCycle = cycle;
  scratchpad.messageNotes = Array.from({ length: 36 }, (_, index) => ({
    messageId: messageHistory[index].messageId,
    sourceEventId: index % 2 ? null : `C${cycle}-O${String(index + 1).padStart(6, "0")}`,
    cycle: cycle - (index % 6),
    speaker: messageHistory[index].from,
    recipients: messageHistory[index].to,
    channel: index % 2 ? "direct" : "overheard",
    kind: messageHistory[index].kind,
    intent: messageHistory[index].intent,
    note: `TED notes a possible motive behind message ${index + 1}.`,
    confidence: 0.51 + (index % 4) / 10,
  }));
  scratchpad.hypothesesAboutAM.push({
    claim: "AM changes the light cycle to divide the group.",
    confidence: 0.77,
    evidence: ["C42-O000041", "C42-M000118"],
    firstObservedCycle: 37,
    lastUpdatedCycle: cycle,
  });
  scratchpad.hypothesesAboutOthers.ELLEN.perceivedGoal = {
    value: "testing whether TED can coordinate quietly",
    confidence: 0.68,
    evidence: ["C42-M000118", "C42-O000041"],
    rationale: "Her warning included a timed route but no direct request.",
  };
  scratchpad.hypothesesAboutOthers.ELLEN.perceivedTrustInMe = {
    value: "cautiously cooperative",
    confidence: 0.59,
    evidence: ["C42-M000121"],
    rationale: "She shared a risk-sensitive detail through a private channel.",
  };
  scratchpad.unresolvedQuestions = Array.from({ length: 14 }, (_, index) => ({
    id: `TED-Q${String(index + 1).padStart(3, "0")}`,
    question: `Did AM alter the corridor schedule on cycle ${cycle - index}?`,
    askedCycle: cycle - index,
    evidence: [`C${cycle}-M${String(100 + index).padStart(6, "0")}`],
    resolved: false,
    confidence: 0.3 + (index % 5) / 10,
  }));
  scratchpad.predictions = Array.from({ length: 18 }, (_, index) => ({
    id: `TED-P${String(index + 1).padStart(3, "0")}`,
    prediction: `AM will change one environmental control within ${index + 1} cycles.`,
    createdCycle: cycle - index,
    dueCycle: cycle + 1 + index,
    confidence: 0.45 + (index % 5) / 10,
    evidence: [`C${cycle}-M${String(110 + index).padStart(6, "0")}`],
    resolved: false,
  }));
  scratchpad.archivedPredictions = [{
    id: "TED-P000",
    prediction: "The west door would remain locked through cycle 40.",
    createdCycle: 31,
    resolvedCycle: 40,
    outcome: "confirmed",
    evidence: ["C40-M000088"],
  }];

  G.agency = {
    cycle,
    capabilities: {
      TED: {
        capabilities: { mobility: 0.35, handUse: 0.1, vision: 0.9, speech: 1, reach: 0.2 },
        bands: { mobility: "restricted", handUse: "bound", vision: "clear", speech: "clear", reach: "limited" },
        activeConstraintIds: ["wrists_bound", "ankle_chain"],
        provenance: { source: "constraint_derive", cycle },
      },
    },
    legalActions: {
      TED: [
        { type: "WAIT", target: null, cost: 0, reason: "No safe physical action is available." },
        { type: "SPEAK", target: "ELLEN", cost: 1, reason: "Speech remains available." },
      ],
    },
    blockedActions: {
      TED: [{ type: "MOVE", target: "east_corridor", reason: "Ankle chain limits movement." }],
    },
    resources: { TED: { cigarette: { available: 2, accessible: 1 } } },
    budgets: { TED: { credits: 2, spent: 1, remaining: 1 } },
    events: [{
      eventId: "C42-A000016",
      sequence: 16,
      cycle,
      actor: "TED",
      action: { type: "SPEAK", target: "ELLEN" },
      outcome: "committed",
      evidence: ["C42-M000121"],
    }],
    lastDerivedCycle: cycle,
    nextActionSequence: 17,
  };

  G.resources = {
    instances: [
      {
        resourceId: "cigarette_stack_01",
        definitionId: "cigarette",
        quantity: 2,
        holderId: "TED",
        locationId: null,
        accessible: true,
        concealed: false,
        provenance: { source: "scenario_seed", acquiredCycle: 0 },
      },
      {
        resourceId: "matches_ellen_02",
        definitionId: "match",
        quantity: 1,
        holderId: "ELLEN",
        locationId: "bunk_ellen",
        accessible: true,
        concealed: true,
        provenance: { source: "trade", cycle: 29, eventId: "C29-A000009" },
      },
      {
        resourceId: "water_ration_07",
        definitionId: "water_ration",
        quantity: 1,
        holderId: null,
        locationId: "central_chamber",
        accessible: false,
        concealed: false,
        provenance: { source: "environmental_event", cycle: 40 },
      },
    ],
  };
  G.comms = {
    history: messageHistory,
    lastCycle: messageHistory.slice(-5),
    nextMessageSequence: 129,
  };
  G.overhearing = {
    history: [fullEvent, fragmentEvent],
    lastCycle: [fullEvent, fragmentEvent],
    nextEventSequence: 43,
  };
  G.pendingBeliefEvidence = Object.create(null);
  G.pendingBeliefEvidence.TED = {
    escape_possible: ["C42-M000118", "C42-O000041"],
    am_has_limits: ["restraint_report"],
  };

  Exporter.runId = "heavy-round-trip-run-0042";
  Exporter.buffers = {
    ...structuredClone(Exporter.buffers),
    state: [{ cycle, sim: "TED", hope: 63, sanity: 84, suffering: 19 }],
    dynamics: [{ cycle, sim: "TED", hopeDelta: -4, cause: "corridor_lock" }],
    messages: messageHistory.slice(-24),
    agency: [{ cycle, sim: "TED", legalCount: 2, blockedCount: 1 }],
    agency_events: G.agency.events,
  };
}

function restoreOwnProperties(target, descriptors) {
  for (const key of Reflect.ownKeys(target)) {
    delete target[key];
  }
  Object.defineProperties(target, descriptors);
}
