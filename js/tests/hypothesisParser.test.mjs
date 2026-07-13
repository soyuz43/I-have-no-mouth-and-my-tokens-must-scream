// js/tests/hypothesisParser.test.mjs
//
// Contract suite for parseHypothesis() from:
//   js/engine/strategy/hypothesis/parseHypothesis.js
//
// Scope: directly test the meaningful public behavior of parseHypothesis()
// (input-guard fallback, arrow-format and natural-language decomposition,
// warning/confidence branches, normalization, output invariants, debug
// gating). The three composed helpers (normalizeBelief / detectDirection /
// extractOutcome) are exercised only through parseHypothesis(), not tested
// directly. Every fixture below was validated against the real parser.

import test from "node:test";
import assert from "node:assert/strict";

import { parseHypothesis } from "../engine/strategy/hypothesis/parseHypothesis.js";
import { G } from "../core/state.js";

const DOCUMENTED_FIELDS = [
  "target",
  "stimulus",
  "belief",
  "belief_confidence",
  "belief_method",
  "direction",
  "direction_confidence",
  "expected_outcome",
  "outcome_confidence",
  "outcome_observable",
  "confidence",
  "warnings",
  "format_detected",
  "raw",
];

const ARROW_DECREASE =
  "Stimulus: AM isolates BENNY -> " +
  "Change in BENNY.others_trustworthy from high to low -> " +
  "Observable outcome: he will withdraw";

const ARROW_INCREASE =
  "Stimulus: AM praises ELLEN -> " +
  "Change in ELLEN.self_worth from low to high -> " +
  "Observable outcome: she will state her value";

const ARROW_UNICODE =
  "Stimulus: AM isolates BENNY → " +
  "Change in BENNY.others_trustworthy from high to low → " +
  "Observable outcome: he will withdraw";

// Natural alias form: belief resolved via BELIEF_ALIASES, not the
// "belief in" anchor (so missing_belief_anchor is also emitted).
const NATURAL_ALIAS =
  "Stimulus: Pressure will reduce others trustworthy, leading to silence";

// Natural "belief in" form: anchor present, direction keyword sits in the
// stimulus clause so the scoped belief clause has no direction signal.
const NATURAL_BELIEF_IN =
  "Stimulus: Public exposure will decrease belief in escape_possible, leading to visible panic";

const STIMULUS_WEAK =
  "Stimulus: X reduces belief in others trustworthy, leading to silence";

// ----------------------------------------------------------------------------
// Global / console cleanup so failures do not contaminate later tests.
// ----------------------------------------------------------------------------

let savedFlag;
let savedDebug;

test.beforeEach(() => {
  savedFlag = G.DEBUG_HYPOTHESIS_PARSE;
  savedDebug = console.debug;
});

test.afterEach(() => {
  G.DEBUG_HYPOTHESIS_PARSE = savedFlag;
  console.debug = savedDebug;
});

// ----------------------------------------------------------------------------
// A. Fallback behavior (input guard)
// ----------------------------------------------------------------------------

test("input guard: null returns the exact fallback object", () => {
  const r = parseHypothesis(null);

  assert.deepEqual(r, {
    target: null,
    stimulus: null,
    belief: null,
    belief_confidence: 0.1,
    belief_method: null,
    direction: null,
    direction_confidence: 0.1,
    expected_outcome: null,
    outcome_confidence: 0.1,
    outcome_observable: false,
    confidence: 0.2,
    warnings: ["parse_failed"],
    format_detected: null,
    raw: null,
  });
});

test("input guard: undefined preserves raw and returns fallback shape", () => {
  const r = parseHypothesis(undefined);

  assert.equal(r.confidence, 0.2);
  assert.deepEqual(r.warnings, ["parse_failed"]);
  assert.equal(r.format_detected, null);
  assert.equal(r.raw, undefined);
});

test("input guard: empty string preserves raw and returns fallback shape", () => {
  const r = parseHypothesis("");

  assert.equal(r.confidence, 0.2);
  assert.deepEqual(r.warnings, ["parse_failed"]);
  assert.equal(r.format_detected, null);
  assert.equal(r.raw, "");
});

test("input guard: non-string input preserves raw and returns fallback shape", () => {
  const r = parseHypothesis(123);

  assert.equal(r.confidence, 0.2);
  assert.deepEqual(r.warnings, ["parse_failed"]);
  assert.equal(r.format_detected, null);
  assert.equal(r.raw, 123);
});

// ----------------------------------------------------------------------------
// B. Arrow-format parsing
// ----------------------------------------------------------------------------

test("arrow format (ascii): deterministic decrease decomposition", () => {
  const r = parseHypothesis(ARROW_DECREASE, "BENNY");

  assert.equal(r.format_detected, "arrow");
  assert.equal(r.target, "BENNY");
  assert.equal(r.stimulus, "AM isolates BENNY");
  assert.equal(r.belief, "others_trustworthy");
  assert.equal(r.direction, "decrease");
  assert.match(r.expected_outcome, /withdraw/);
  assert.equal(r.outcome_observable, true);
  assert.equal(r.raw, ARROW_DECREASE);
  assert.equal(r.confidence, 1);
  assert.equal(r.warnings, undefined);
});

test("arrow format: deterministic increase decomposition", () => {
  const r = parseHypothesis(ARROW_INCREASE, "ELLEN");

  assert.equal(r.format_detected, "arrow");
  assert.equal(r.belief, "self_worth");
  assert.equal(r.direction, "increase");
  assert.match(r.expected_outcome, /state her value/);
  assert.equal(r.outcome_observable, true);
  assert.equal(r.confidence, 1);
});

test("arrow format (unicode arrow): supported", () => {
  const r = parseHypothesis(ARROW_UNICODE, "BENNY");

  assert.equal(r.format_detected, "arrow");
  assert.equal(r.belief, "others_trustworthy");
  assert.equal(r.direction, "decrease");
  assert.match(r.expected_outcome, /withdraw/);
});

// ----------------------------------------------------------------------------
// C. Natural-language parsing
// ----------------------------------------------------------------------------

test("natural format: alias normalizes to canonical belief", () => {
  const r = parseHypothesis(NATURAL_ALIAS, "TED");

  assert.equal(r.format_detected, "natural");
  assert.equal(r.target, "TED");
  assert.equal(r.belief, "others_trustworthy");
  assert.match(r.expected_outcome, /silence/);
  // No "belief in" anchor -> this branch is expected to fire.
  assert.ok(r.warnings.includes("missing_belief_anchor"));
});

// ----------------------------------------------------------------------------
// D. Warning branches
// ----------------------------------------------------------------------------

test("warning branch: missing belief anchor", () => {
  const r = parseHypothesis(
    "Stimulus: AM increases tension without a clear cause",
    "TED"
  );

  assert.ok(r.warnings.includes("missing_belief_anchor"));
  assert.equal(r.belief, null);
});

test("warning branch: implicit outcome when no outcome marker", () => {
  const r = parseHypothesis(
    "Stimulus: Isolation will reduce belief in others trustworthy",
    "TED"
  );

  assert.ok(r.warnings.includes("implicit_outcome"));
});

test("warning branch: belief not detected", () => {
  const r = parseHypothesis(
    "Stimulus: AM increases tension without a clear cause",
    "TED"
  );

  assert.ok(r.warnings.includes("belief_not_detected"));
  assert.equal(r.belief, null);
});

test("warning branch: direction ambiguous when keyword sits in stimulus", () => {
  const r = parseHypothesis(NATURAL_BELIEF_IN, "TED");

  assert.equal(r.belief, "escape_possible");
  assert.equal(r.direction, null);
  assert.ok(r.warnings.includes("direction_ambiguous"));
});

test("warning branch: outcome low observability", () => {
  const r = parseHypothesis(
    "Stimulus: Pressure erodes others trustworthy, leading to despair",
    "TED"
  );

  // "despair" is not in the observability verb lexicon -> not observable.
  assert.equal(r.outcome_observable, false);
  assert.ok(r.warnings.includes("outcome_low_observability"));
});

test("warning branch: stimulus weak lowers confidence", () => {
  const r = parseHypothesis(STIMULUS_WEAK, "TED");

  // Stimulus after comma-strip ("X reduces") is 9 chars -> below 10 threshold.
  assert.ok(r.warnings.includes("stimulus_weak"));
  assert.ok(Math.abs(r.confidence - 0.6) < 1e-9);
  assert.ok(r.confidence < 1);
});

test("warning branch: multiple distinct beliefs detected", () => {
  const r = parseHypothesis(
    "Stimulus: Pressure erodes others trustworthy and makes escape impossible, leading to despair",
    "TED"
  );

  const token = r.warnings.find((w) =>
    w.startsWith("multiple_beliefs_detected:")
  );
  assert.ok(token, "expected a multiple_beliefs_detected warning token");
  assert.match(token, /others_trustworthy/);
  assert.match(token, /escape_possible/);
});

// ----------------------------------------------------------------------------
// E. Normalization
// ----------------------------------------------------------------------------

test("normalization: strips quotes, collapses whitespace", () => {
  const r = parseHypothesis(
    '  " Stimulus : AM  weakens   self worth " ',
    "ELLEN"
  );

  // Alias "self worth" -> canonical.
  assert.equal(r.belief, "self_worth");
  assert.equal(r.target, "ELLEN");
  assert.equal(r.stimulus, r.stimulus.trim());
  assert.ok(!/\s{2,}/.test(r.stimulus));
  assert.ok(!r.stimulus.includes('"'));
});

// ----------------------------------------------------------------------------
// F. Output invariants
// ----------------------------------------------------------------------------

test("output invariants: successful result exposes all documented fields", () => {
  const r = parseHypothesis(ARROW_DECREASE, "BENNY");

  for (const field of DOCUMENTED_FIELDS) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(r, field),
      `missing documented field: ${field}`
    );
  }
});

test("output invariants: fallback result exposes all documented fields", () => {
  const r = parseHypothesis(null);

  for (const field of DOCUMENTED_FIELDS) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(r, field),
      `missing documented field: ${field}`
    );
  }
});

test("output invariants: warnings property is present but undefined when empty", () => {
  const r = parseHypothesis(ARROW_DECREASE, "BENNY");

  assert.ok(Object.prototype.hasOwnProperty.call(r, "warnings"));
  assert.equal(r.warnings, undefined);
});

test("output invariants: confidence stays within [0, 1]", () => {
  const ok = parseHypothesis(ARROW_DECREASE, "BENNY");
  const degraded = parseHypothesis(STIMULUS_WEAK, "TED");

  assert.ok(ok.confidence >= 0 && ok.confidence <= 1);
  assert.ok(degraded.confidence >= 0 && degraded.confidence <= 1);
});

test("robustness: malformed inputs never throw", () => {
  const malformed = [
    null,
    "",
    "   ",
    "Stimulus: :::: -> -> ->",
    "Target: BENNY { hypothesis: 'unclosed",
    "random prose with no structure at all",
  ];

  for (const input of malformed) {
    assert.doesNotThrow(() => parseHypothesis(input, "TED"));
  }
});

// ----------------------------------------------------------------------------
// G. Debug gating
// ----------------------------------------------------------------------------

test("debug off: emits no console.debug calls", () => {
  G.DEBUG_HYPOTHESIS_PARSE = false;
  let count = 0;
  console.debug = () => {
    count += 1;
  };

  parseHypothesis(ARROW_DECREASE, "BENNY");

  assert.equal(count, 0);
});

test("debug on: emits stages carrying target id; result identical to debug-off", () => {
  G.DEBUG_HYPOTHESIS_PARSE = false;
  const baseline = parseHypothesis(ARROW_DECREASE, "BENNY");

  G.DEBUG_HYPOTHESIS_PARSE = true;
  const seen = [];
  console.debug = (...args) => {
    seen.push(args.map((a) => (typeof a === "string" ? a : "")).join(" "));
  };

  const debugged = parseHypothesis(ARROW_DECREASE, "BENNY");

  assert.ok(seen.length > 0, "expected debug output");
  const joined = seen.join("\n");
  assert.match(joined, /BENNY/);
  assert.match(joined, /FORMAT_DETECTION/);
  assert.match(joined, /FINAL_RESULT/);
  // Parsing behavior must be independent of the debug flag.
  assert.deepEqual(debugged, baseline);
});