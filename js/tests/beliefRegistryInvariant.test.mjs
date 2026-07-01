// js/tests/beliefRegistryInvariant.test.mjs

import test from "node:test";
import assert from "node:assert/strict";

import {
  BELIEF_KEYS,
  BELIEF_ALIASES,
  isBeliefKey
} from "../core/beliefs.js";

const EXPECTED_BELIEF_KEYS = [
  "escape_possible",
  "others_trustworthy",
  "self_worth",
  "reality_reliable",
  "guilt_deserved",
  "resistance_possible",
  "am_has_limits"
];

test("belief registry exports the expected canonical keys", () => {
  assert.deepEqual(
    [...BELIEF_KEYS],
    EXPECTED_BELIEF_KEYS
  );
});

test("canonical belief keys are unique", () => {
  const uniqueKeys = new Set(BELIEF_KEYS);

  assert.equal(
    uniqueKeys.size,
    BELIEF_KEYS.length,
    "BELIEF_KEYS contains duplicate canonical keys"
  );
});

test("canonical belief keys are unique case-insensitively", () => {
  const normalizedKeys = BELIEF_KEYS.map(
    (key) => key.toLowerCase()
  );

  const uniqueNormalizedKeys = new Set(
    normalizedKeys
  );

  assert.equal(
    uniqueNormalizedKeys.size,
    BELIEF_KEYS.length,
    "BELIEF_KEYS contains keys that differ only by letter case"
  );
});

test("canonical belief keys use lowercase snake_case", () => {
  for (const key of BELIEF_KEYS) {
    assert.match(
      key,
      /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/,
      `Invalid canonical belief-key format: ${key}`
    );
  }
});

test("canonical belief registry is frozen", () => {
  assert.equal(
    Object.isFrozen(BELIEF_KEYS),
    true,
    "BELIEF_KEYS must be frozen"
  );
});

test("belief alias registry is frozen", () => {
  assert.equal(
    Object.isFrozen(BELIEF_ALIASES),
    true,
    "BELIEF_ALIASES must be frozen"
  );
});

test("every alias maps to an existing canonical belief", () => {
  for (
    const [alias, canonical]
    of Object.entries(BELIEF_ALIASES)
  ) {
    assert.equal(
      isBeliefKey(canonical),
      true,
      `Alias "${alias}" maps to unknown belief "${canonical}"`
    );
  }
});

test("aliases are nonempty strings", () => {
  for (const alias of Object.keys(BELIEF_ALIASES)) {
    assert.equal(
      typeof alias,
      "string"
    );

    assert.notEqual(
      alias.trim(),
      "",
      "BELIEF_ALIASES contains an empty alias"
    );

    assert.equal(
      alias,
      alias.trim(),
      `Alias contains leading or trailing whitespace: "${alias}"`
    );
  }
});

test("aliases are unique case-insensitively", () => {
  const seen = new Map();

  for (
    const [alias, canonical]
    of Object.entries(BELIEF_ALIASES)
  ) {
    const normalizedAlias =
      alias.toLocaleLowerCase();

    if (seen.has(normalizedAlias)) {
      assert.fail(
        `Duplicate alias ignoring case: ` +
        `"${alias}" and "${seen.get(normalizedAlias).alias}"`
      );
    }

    seen.set(
      normalizedAlias,
      {
        alias,
        canonical
      }
    );
  }
});

test("canonical natural-language forms map back to their keys", () => {
  for (const key of BELIEF_KEYS) {
    const naturalForm =
      key.replace(/_/g, " ");

    const aliasEntry =
      Object.entries(BELIEF_ALIASES)
        .find(
          ([alias]) =>
            alias.toLocaleLowerCase() ===
            naturalForm.toLocaleLowerCase()
        );

    assert.ok(
      aliasEntry,
      `Missing canonical natural-language alias "${naturalForm}"`
    );

    assert.equal(
      aliasEntry[1],
      key,
      `"${naturalForm}" must map to "${key}"`
    );
  }
});

test("isBeliefKey accepts every canonical belief", () => {
  for (const key of BELIEF_KEYS) {
    assert.equal(
      isBeliefKey(key),
      true,
      `isBeliefKey rejected canonical key "${key}"`
    );
  }
});

test("isBeliefKey rejects unknown and malformed values", () => {
  const invalidValues = [
    null,
    undefined,
    false,
    true,
    0,
    1,
    {},
    [],
    "",
    "self worth",
    "SELF_WORTH",
    "self_ worth",
    "unknown_belief",
    "escape"
  ];

  for (const value of invalidValues) {
    assert.equal(
      isBeliefKey(value),
      false,
      `isBeliefKey incorrectly accepted ${JSON.stringify(value)}`
    );
  }
});

test("registry exports do not expose duplicate alias targets incorrectly", () => {
  const aliasesByBelief = new Map(
    BELIEF_KEYS.map(
      (key) => [key, []]
    )
  );

  for (
    const [alias, canonical]
    of Object.entries(BELIEF_ALIASES)
  ) {
    aliasesByBelief
      .get(canonical)
      .push(alias);
  }

  for (
    const [belief, aliases]
    of aliasesByBelief
  ) {
    assert.ok(
      aliases.length > 0,
      `Canonical belief "${belief}" has no aliases`
    );
  }
});

test("registry has exactly seven canonical beliefs", () => {
  assert.equal(
    BELIEF_KEYS.length,
    7,
    "Unexpected canonical belief count"
  );
});

console.log(
  "Belief registry invariant suite loaded."
);