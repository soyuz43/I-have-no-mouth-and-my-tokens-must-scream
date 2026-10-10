import assert from "node:assert/strict";
import { test } from "node:test";

import { G } from "../core/state.js";
import { exportState, importState } from "../core/saveLoad.js";

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
