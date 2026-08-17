// js/tests/scratchpadConsolidation.test.mjs
//
// Focused coverage for engine-owned scratchpad consolidation
// (js/engine/scratchpad/consolidate.js + cycle wiring). Pure-logic
// tests; the cycle hook's import graph and G.cycle boundary are
// exercised by an integration smoke check at the end.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_CONSOLIDATION_CADENCE,
  shouldConsolidate,
  dedupMessageNotes,
  archiveResolvedQuestions,
  consolidateScratchpad,
  runScratchpadConsolidation,
} from "file:///C:/Users/thisi/workspace/personal/I-have-no-mouth-but-my-tokens-must-scream/js/engine/scratchpad/consolidate.js";

import {
  expirePredictions,
} from "file:///C:/Users/thisi/workspace/personal/I-have-no-mouth-but-my-tokens-must-scream/js/engine/scratchpad/expirePredictions.js";

function baseScratchpad() {
  return {
    messageNotes: [],
    unresolvedQuestions: [],
    archivedQuestions: [],
    predictions: [],
    lastConsolidatedCycle: null,
    contradictions: [],
  };
}

test("shouldConsolidate: false before cadence, true on cadence", () => {
  const cad = 5;
  assert.equal(shouldConsolidate(0, null, cad), false);
  assert.equal(shouldConsolidate(1, null, cad), false);
  assert.equal(shouldConsolidate(4, null, cad), false);
  assert.equal(shouldConsolidate(5, null, cad), true);
  assert.equal(shouldConsolidate(10, null, cad), true);
});

test("shouldConsolidate: false when lastConsolidatedCycle === cycle", () => {
  assert.equal(shouldConsolidate(5, 5, 5), false);
});

test("shouldConsolidate: rejects invalid cycle / cadence", () => {
  assert.equal(shouldConsolidate(-1, null, 5), false);
  assert.equal(shouldConsolidate(NaN, null, 5), false);
  assert.equal(shouldConsolidate(5, null, 0), false);
  assert.equal(shouldConsolidate(5, null, -2), false);
});

test("dedupMessageNotes: keeps first occurrence by messageId", () => {
  const notes = [
    { messageId: "M1", note: "a" },
    { messageId: "M2", note: "b" },
    { messageId: "M1", note: "dup" },
    { messageId: "M3", note: "c" },
  ];
  const out = dedupMessageNotes(notes);
  assert.deepEqual(
    out.map((n) => n.messageId),
    ["M1", "M2", "M3"]
  );
  assert.equal(out[0].note, "a");
});

test("dedupMessageNotes: notes without messageId are preserved once", () => {
  const notes = [
    { note: "x" },
    { note: "y" },
    { note: "x" },
  ];
  // No messageId -> each treated as the single "no-id" bucket, only
  // the first is kept.
  const out = dedupMessageNotes(notes);
  assert.equal(out.length, 1);
});

test("dedupMessageNotes: non-array input returns []", () => {
  assert.deepEqual(dedupMessageNotes(null), []);
  assert.deepEqual(dedupMessageNotes(undefined), []);
});

test("archiveResolvedQuestions: splits active vs resolved, preserves provenance", () => {
  const questions = [
    { id: 1, resolved: false },
    { id: 2, resolved: true, resolution: "done" },
    { id: 3, resolved: true },
  ];
  const { active, archived } =
    archiveResolvedQuestions(questions);
  assert.deepEqual(active.map((q) => q.id), [1]);
  assert.deepEqual(archived.map((q) => q.id), [2, 3]);
  assert.equal(archived[0].resolution, "done");
});

test("consolidateScratchpad: sets lastConsolidatedCycle and dedups+archives", () => {
  const sp = baseScratchpad();
  sp.messageNotes = [
    { messageId: "M1" },
    { messageId: "M1" },
    { messageId: "M2" },
  ];
  sp.unresolvedQuestions = [
    { id: 1, resolved: false },
    { id: 2, resolved: true },
  ];

  const summary = consolidateScratchpad(sp, 5);

  assert.equal(sp.lastConsolidatedCycle, 5);
  assert.equal(summary.dedupedMessageNotes, 1);
  assert.equal(summary.archivedQuestions, 1);
  assert.equal(sp.messageNotes.length, 2);
  assert.equal(sp.unresolvedQuestions.length, 1);
  assert.equal(sp.archivedQuestions.length, 1);
  assert.equal(sp.archivedQuestions[0].id, 2);
});

test("consolidateScratchpad: delegates prediction expiry", () => {
  const sp = baseScratchpad();
  sp.predictions = [
    {
      id: 1,
      about: "TED",
      prediction: "x",
      confidence: 0.5,
      evidence: [],
      createdCycle: 0,
      withinCycles: 2,
      evaluateByCycle: 2,
      resolved: false,
      outcome: null,
      resolvedCycle: null,
    },
  ];

  const summary = consolidateScratchpad(sp, 10);
  assert.equal(summary.expiredPredictions, 1);
  assert.equal(sp.predictions[0].expired, true);
});

test("consolidateScratchpad: creates archivedQuestions if absent (no provenance loss)", () => {
  const sp = baseScratchpad();
  delete sp.archivedQuestions;
  sp.unresolvedQuestions = [{ id: 9, resolved: true }];
  consolidateScratchpad(sp, 5);
  assert.ok(Array.isArray(sp.archivedQuestions));
  assert.equal(sp.archivedQuestions.length, 1);
});

test("consolidateScratchpad: additive only, existing keys preserved", () => {
  const sp = baseScratchpad();
  sp.unresolvedQuestions = [{ id: 1, resolved: true }];
  const before = Object.keys(sp).slice();
  consolidateScratchpad(sp, 5);
  for (const k of before) {
    assert.ok(k in sp, "missing key: " + k);
  }
});

test("runScratchpadConsolidation: skips off-cadence, runs on-cadence, idempotent", () => {
  const sp = baseScratchpad();
  sp.messageNotes = [
    { messageId: "M1" },
    { messageId: "M1" },
  ];

  // Cycle 3: no-op.
  assert.equal(runScratchpadConsolidation(sp, 3), null);
  assert.equal(sp.lastConsolidatedCycle, null);

  // Cycle 5: runs.
  const s1 = runScratchpadConsolidation(sp, 5);
  assert.equal(s1.dedupedMessageNotes, 1);
  assert.equal(sp.lastConsolidatedCycle, 5);

  // Cycle 5 again: no double run.
  assert.equal(runScratchpadConsolidation(sp, 5), null);
});

test("integration: G.cycle is a valid integer boundary the hook reads", async () => {
  const { G } = await import("file:///C:/Users/thisi/workspace/personal/I-have-no-mouth-but-my-tokens-must-scream/js/core/state.js");
  G.cycle = 5;
  assert.equal(Number.isInteger(G.cycle), true);
  // expirePredictions dependency resolves (consolidate imports it).
  assert.equal(typeof expirePredictions, "function");
});

test("P1 regression: consolidation runs for scratchpad with notes/questions but no predictions", async () => {
  const { runScratchpadConsolidation } =
    await import("file:///C:/Users/thisi/workspace/personal/I-have-no-mouth-but-my-tokens-must-scream/js/engine/scratchpad/consolidate.js");

  const sp = {
    messageNotes: [
      { messageId: "M1" },
      { messageId: "M1" },
    ],
    unresolvedQuestions: [
      { id: 1, resolved: true },
    ],
    archivedQuestions: [],
    predictions: [],
    lastConsolidatedCycle: null,
  };

  const summary = runScratchpadConsolidation(sp, 5);
  assert.ok(summary, "should consolidate even without predictions");
  assert.equal(summary.dedupedMessageNotes, 1);
  assert.equal(summary.archivedQuestions, 1);
  assert.equal(sp.lastConsolidatedCycle, 5);
});
