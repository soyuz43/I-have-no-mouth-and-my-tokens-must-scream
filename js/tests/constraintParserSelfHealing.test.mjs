import assert from "node:assert/strict";
import test from "node:test";

import {
  extractConstraintsFromText
} from "../engine/constraints/parser.js";
import { parseAMTargets } from "../engine/phases/strategyPhase.js";

const parserContext = {
  cycle: 0,
  resolveTargetId: (raw) =>
    String(raw ?? "").trim().toUpperCase() === "TED" ? "TED" : null
};

function extractConstraints(input) {
  return extractConstraintsFromText(input, parserContext);
}

function parseConstraint(record) {
  const parsed = extractConstraints(
    `[TARGET: TED]\n${record}\n[/TARGET]`
  );

  return parsed.TED?.[0] ?? null;
}

function withMutedConsole(callback) {
  const original = {
    debug: console.debug,
    log: console.log,
    warn: console.warn
  };

  console.debug = () => {};
  console.log = () => {};
  console.warn = () => {};

  try {
    return callback();
  } finally {
    console.debug = original.debug;
    console.log = original.log;
    console.warn = original.warn;
  }
}

test("recognizes NONE sentinel variants", () => {
  const sentinels = [
    "CONSTRAINT: <CONSTRAINT_NONE>",
    "CONSTRAINT_ NONE",
    "CONSTRAINT: none",
    "CONSTRAINT: (none)",
    "CONSTRAINT: skip",
    "CONSTRAINT: no_constraint",
    "CONSTRAINT: null",
    "CONSTRAINT: empty",
    "CONSTRAINT: default"
  ];

  for (const sentinel of sentinels) {
    const parsed = withMutedConsole(() =>
      extractConstraints(
        `[TARGET: TED]\n${sentinel}\n[/TARGET]`
      )
    );

    assert.equal(parsed.TED, undefined, `${sentinel} should mean NONE`);
  }
});

test("does not leak malformed NONE metadata into action text", () => {
  const parsed = parseAMTargets(
    "[TARGET: TED]\nAction content.\nCONSTRAINT_ NONE\n[/TARGET]",
    ["TED"]
  );

  assert.equal(parsed.actions.TED.text, "Action content.");
});

test("matches exact and normalized constraint IDs", () => {
  for (const [input, expectedId] of [
    ["kneeling_grate", "kneeling_grate"],
    ["KNEELING GRATE", "kneeling_grate"],
    ["kneeling grate", "kneeling_grate"]
  ]) {
    const parsed = withMutedConsole(() =>
      parseConstraint(`CONSTRAINT: ${input} DURATION:2 INTENSITY:1`)
    );

    assert.equal(parsed?.id, expectedId);
    assert.equal(parsed?.duration, 2);
    assert.equal(parsed?.intensity, 1);
  }
});

test("recovers common fuzzy constraint ID drift", () => {
  for (const [input, expectedId] of [
    ["kneel_grate", "kneeling_grate"],
    ["arms_extend", "arms_extended"]
  ]) {
    const parsed = withMutedConsole(() =>
      parseConstraint(`CONSTRAINT: ${input} DURATION:2 INTENSITY:1`)
    );

    assert.equal(parsed?.id, expectedId);
  }
});

test("parses prefixed and relaxed constraint formats", () => {
  const formats = [
    "CONSTRAINT: kneeling_grate DURATION:2 INTENSITY:1",
    "CONSTRAINT:CONSTRAINT_APPLY:kneeling_grate DURATION:2 INTENSITY:1",
    "CONSTRAINT: kneeling grate DURATION 2 INTENSITY 1"
  ];

  for (const format of formats) {
    const parsed = withMutedConsole(() => parseConstraint(format));

    assert.deepEqual(
      {
        id: parsed?.id,
        duration: parsed?.duration,
        remaining: parsed?.remaining,
        intensity: parsed?.intensity
      },
      {
        id: "kneeling_grate",
        duration: 2,
        remaining: 2,
        intensity: 1
      }
    );
  }
});

test("defaults missing values and clamps unreasonable values", () => {
  const defaults = withMutedConsole(() =>
    parseConstraint("CONSTRAINT: kneeling_grate")
  );
  assert.equal(defaults?.duration, 1);
  assert.equal(defaults?.intensity, 1);

  const clamped = withMutedConsole(() =>
    parseConstraint("CONSTRAINT: kneeling_grate DURATION:9 INTENSITY:8")
  );
  assert.equal(clamped?.duration, 6);
  assert.equal(clamped?.intensity, 3);

  const invalidFractions = withMutedConsole(() =>
    parseConstraint("CONSTRAINT: kneeling_grate DURATION:2.5 INTENSITY:1.5")
  );
  assert.equal(invalidFractions?.duration, 1);
  assert.equal(invalidFractions?.intensity, 1);
});

test("warns and skips unknown constraint IDs", () => {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args);

  let parsed;
  try {
    parsed = extractConstraints(
      "[TARGET: TED]\nCONSTRAINT: xyz_constraint DURATION:2 INTENSITY:1\n[/TARGET]"
    );
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(parsed.TED, undefined);
  assert.ok(
    warnings.some((args) =>
      String(args[0]).includes("malformed constraint")
    ),
    "an unknown ID should produce a malformed-constraint warning"
  );
});
