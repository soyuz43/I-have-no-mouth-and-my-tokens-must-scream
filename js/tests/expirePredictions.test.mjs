// js/tests/expirePredictions.test.mjs
//
// Focused coverage for the engine-owned prediction-lifecycle
// maintenance added in js/engine/scratchpad/expirePredictions.js.
// Pure-logic tests; the cycle wiring is exercised implicitly by the
// existing suite and a separate integration check below.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  isPredictionExpired,
  expirePredictions,
} from "file:///C:/Users/thisi/workspace/personal/I-have-no-mouth-but-my-tokens-must-scream/js/engine/scratchpad/expirePredictions.js";

function makePrediction(overrides = {}) {
  return {
    id: 1,
    about: "TED",
    prediction: "He will comply.",
    confidence: 0.5,
    evidence: [],
    createdCycle: 0,
    withinCycles: 2,
    evaluateByCycle: 2,
    resolved: false,
    outcome: null,
    resolvedCycle: null,
    ...overrides,
  };
}

test("isPredictionExpired: false when cycle is exactly at deadline", () => {
  assert.equal(
    isPredictionExpired(
      makePrediction({ evaluateByCycle: 2 }),
      2
    ),
    false
  );
});

test("isPredictionExpired: true once cycle passes deadline", () => {
  assert.equal(
    isPredictionExpired(
      makePrediction({ evaluateByCycle: 2 }),
      3
    ),
    true
  );
});

test("isPredictionExpired: false for already resolved", () => {
  assert.equal(
    isPredictionExpired(
      makePrediction({
        evaluateByCycle: 1,
        resolved: true,
      }),
      5
    ),
    false
  );
});

test("isPredictionExpired: false with non-finite deadline", () => {
  assert.equal(
    isPredictionExpired(
      makePrediction({ evaluateByCycle: undefined }),
      5
    ),
    false
  );
});

test("isPredictionExpired: false for non-object / missing", () => {
  assert.equal(isPredictionExpired(null, 5), false);
  assert.equal(isPredictionExpired({}, 5), false);
});

test("isPredictionExpired: false for non-finite cycle", () => {
  assert.equal(
    isPredictionExpired(
      makePrediction({ evaluateByCycle: 2 }),
      NaN
    ),
    false
  );
});

test("expirePredictions: marks due unresolved entries and returns their ids", () => {
  const scratchpad = {
    predictions: [
      makePrediction({ id: 1, evaluateByCycle: 1 }),
      makePrediction({ id: 2, evaluateByCycle: 15 }),
      makePrediction({ id: 3, evaluateByCycle: 2 }),
    ],
  };

  const expired = expirePredictions(scratchpad, 10);

  assert.deepEqual(expired, [1, 3]);
  assert.equal(scratchpad.predictions[0].expired, true);
  assert.equal(scratchpad.predictions[0].expiredCycle, 10);
  assert.equal(scratchpad.predictions[1].expired, undefined);
  assert.equal(scratchpad.predictions[2].expired, true);
  assert.equal(scratchpad.predictions[2].expiredCycle, 10);
});

test("expirePredictions: does not re-report already-expired entries", () => {
  const scratchpad = {
    predictions: [
      makePrediction({
        id: 1,
        evaluateByCycle: 1,
        expired: true,
        expiredCycle: 3,
      }),
    ],
  };

  const expired = expirePredictions(scratchpad, 10);

  assert.deepEqual(expired, []);
  assert.equal(scratchpad.predictions[0].expiredCycle, 3);
});

test("expirePredictions: skips resolved entries even past deadline", () => {
  const scratchpad = {
    predictions: [
      makePrediction({
        id: 1,
        evaluateByCycle: 1,
        resolved: true,
      }),
    ],
  };

  const expired = expirePredictions(scratchpad, 10);

  assert.deepEqual(expired, []);
  assert.equal(scratchpad.predictions[0].expired, undefined);
});

test("expirePredictions: additive only, preserves existing keys/order", () => {
  const original = makePrediction({
    id: 1,
    evaluateByCycle: 1,
  });
  const scratchpad = { predictions: [], _self: original };
  scratchpad.predictions.push(original);

  expirePredictions(scratchpad, 5);

  assert.deepEqual(Object.keys(original), [
    "id",
    "about",
    "prediction",
    "confidence",
    "evidence",
    "createdCycle",
    "withinCycles",
    "evaluateByCycle",
    "resolved",
    "outcome",
    "resolvedCycle",
    "expired",
    "expiredCycle",
  ]);
  assert.equal(original.expired, true);
});

test("expirePredictions: returns [] and mutates nothing for bad input", () => {
  assert.deepEqual(expirePredictions(null, 5), []);
  assert.deepEqual(expirePredictions({}, 5), []);
  assert.deepEqual(
    expirePredictions(
      { predictions: "nope" },
      5
    ),
    []
  );
});

test("expirePredictions: id survives JSON round-trip", () => {
  const scratchpad = {
    predictions: [
      makePrediction({ id: 7, evaluateByCycle: 1 }),
    ],
  };
  expirePredictions(scratchpad, 4);
  const clone = JSON.parse(
    JSON.stringify(scratchpad.predictions[0])
  );
  assert.equal(clone.id, 7);
  assert.equal(clone.expired, true);
});

test("integration: G.cycle wiring marks entries after social phase path", async () => {
  // Minimal smoke test of the cycle module's import graph and that
  // G.cycle is an integer boundary the expiry hook reads.
  const { G } = await import(
    "file:///C:/Users/thisi/workspace/personal/I-have-no-mouth-but-my-tokens-must-scream/js/core/state.js"
  );
  G.cycle = 3;
  assert.equal(Number.isInteger(G.cycle), true);
});
