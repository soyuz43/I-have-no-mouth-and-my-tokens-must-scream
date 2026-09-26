// js/tests/agencyCapabilities.test.mjs
//
// Pure-logic coverage for the object-agnostic capability deriver added
// in js/engine/agency/capabilities.js. No browser, no model call, no
// state mutation. The three behaviors under test that are easiest to
// regress silently are:
//
//   1. The mobility_restriction polarity inversion.
//   2. Max-restriction-wins across simultaneous constraints.
//   3. Array-membership gating (a zero-remaining constraint still
//      physically restrains the prisoner).

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  deriveCapabilities,
} from "../engine/agency/capabilities.js";

import {
  CONSTRAINT_LIBRARY,
  CONSTRAINT_MAP,
} from "../engine/constraints.js";

function simWith(constraints) {
  return {
    id: "TED",
    suffering: 10,
    hope: 70,
    sanity: 80,
    constraints
  };
}

function restraint(constraintId, overrides = {}) {
  return {
    id: constraintId,
    remaining: 1,
    stacks: 1,
    intensity: 1,
    elapsed: 0,
    ...overrides
  };
}

/*
 * The mobility_restriction inversion is a floating-point subtraction
 * (1 - 0.95 === 0.050000000000000044), so inverted capabilities are
 * compared with a tolerance rather than strict equality. Values that
 * involve no subtraction (stability, hand_use, concentration,
 * interaction_reach) are still asserted exactly.
 */
function assertNear(actual, expected, epsilon = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    "expected " + actual + " to be within " + epsilon + " of " + expected
  );
}

/* ============================================================
   A) NO CONSTRAINTS
============================================================ */

test("an unrestrained sim has full capabilities and the normal band", () => {
  const result = deriveCapabilities(simWith([]));

  assert.deepEqual(result.capabilities, {
    mobility: 1,
    stability: 1,
    handUse: 1,
    concentration: 1,
    interactionReach: 1
  });

  for (const band of Object.values(result.bands)) {
    assert.equal(band, "normal");
  }

  assert.deepEqual(result.activeConstraintIds, []);
  assert.deepEqual(result.provenance, []);
});

test("a sim with a missing constraints array is treated as unrestrained", () => {
  const result = deriveCapabilities({
    id: "ELLEN"
  });

  assert.equal(result.capabilities.handUse, 1);
  assert.deepEqual(result.activeConstraintIds, []);
});

/* ============================================================
   B) PALESTINIAN_CHAIR
============================================================ */

test("palestinian_chair renders hands and object interaction unavailable", () => {
  const result = deriveCapabilities(
    simWith([restraint("palestinian_chair")])
  );

  assert.equal(result.capabilities.handUse, 0);
  assert.equal(result.capabilities.interactionReach, 0);
  assert.equal(result.bands.handUse, "unavailable");
  assert.equal(result.bands.interactionReach, "unavailable");
});

/* ============================================================
   C) OVERHEAD_RESTRAINT
============================================================ */

test("overhead_restraint removes hand use entirely but leaves minimal reach", () => {
  const result = deriveCapabilities(
    simWith([restraint("overhead_restraint")])
  );

  assert.equal(result.capabilities.handUse, 0);
  assert.equal(result.capabilities.interactionReach, 0.1);
});

/* ============================================================
   D) LEAST-RESTRICTIVE POSITION
============================================================ */

test("static_stand is the least restrictive defined position", () => {
  const result = deriveCapabilities(
    simWith([restraint("static_stand")])
  );

  assert.equal(result.capabilities.handUse, 0.6);
  assert.equal(result.capabilities.concentration, 0.5);
  assert.equal(result.capabilities.interactionReach, 0.4);
  assertNear(result.capabilities.mobility, 0.05);
  assert.equal(result.bands.handUse, "impaired");
  assert.equal(result.bands.concentration, "impaired");

  /*
   * static_stand is least restrictive in the aggregate: no other
   * defined position scores at least as high on EVERY capability at
   * once. It is deliberately NOT the maximum on each individual field
   * -- kneeling_grate keeps more hand use (0.8) and wall_sit keeps
   * more reach (0.5), because those constraints do not bind the arms.
   */
  const otherPositions = [
    "kneeling_grate",
    "arms_extended",
    "wall_sit",
    "squat_hold",
    "overhead_restraint",
    "forward_bend",
    "tiptoe_balance",
    "palestinian_chair"
  ];

  const keys = Object.keys(result.capabilities);

  for (const id of otherPositions) {
    const other = deriveCapabilities(simWith([restraint(id)]));

    const dominatesOnEveryCapability = keys.every(
      (key) => other.capabilities[key] >= result.capabilities[key]
    );

    assert.ok(
      !dominatesOnEveryCapability,
      id + " should not match or exceed static_stand on every capability"
    );
  }
});

test("kneeling_grate keeps more hand use than static_stand", () => {
  /*
   * Guards the documented design decision: a lower-body position does
   * not bind the arms, so hand use is judged per-constraint rather
   * than by overall position severity.
   */
  const kneeling = deriveCapabilities(
    simWith([restraint("kneeling_grate")])
  );

  const standing = deriveCapabilities(
    simWith([restraint("static_stand")])
  );

  assert.equal(kneeling.capabilities.handUse, 0.8);
  assert.equal(standing.capabilities.handUse, 0.6);
  assert.ok(kneeling.capabilities.handUse > standing.capabilities.handUse);
});

/* ============================================================
   E) POLARITY INVERSION
============================================================ */

test("mobility_restriction is inverted and stability is not", () => {
  // overhead_restraint: mobility_restriction 1.0, stability 0.1
  const result = deriveCapabilities(
    simWith([restraint("overhead_restraint")])
  );

  // Inverted: 1.0 restriction => 0.0 capability
  assert.equal(result.capabilities.mobility, 0);

  // NOT inverted: stability 0.1 stays 0.1, and must NOT become 0.9
  assert.equal(result.capabilities.stability, 0.1);
  assert.notEqual(result.capabilities.stability, 0.9);
  assert.equal(result.bands.stability, "severely_impaired");
});

/* ============================================================
   F) MAX-RESTRICTION-WINS
============================================================ */

test("simultaneous constraints resolve to the most restrictive value per capability", () => {
  const result = deriveCapabilities(
    simWith([
      restraint("kneeling_grate"),
      restraint("overhead_restraint")
    ])
  );

  // kneeling_grate hand_use 0.8, overhead_restraint hand_use 0.0
  assert.equal(result.capabilities.handUse, 0);

  // kneeling_grate concentration 0.5, overhead_restraint 0.3
  assert.equal(result.capabilities.concentration, 0.3);

  // kneeling_grate interaction_reach 0.4, overhead_restraint 0.1
  assert.equal(result.capabilities.interactionReach, 0.1);

  assert.equal(result.activeConstraintIds.length, 2);
});

/* ============================================================
   G) remaining === 0 STILL GATES
============================================================ */

test("a zero-remaining constraint still physically restrains the prisoner", () => {
  const withZero = deriveCapabilities(
    simWith([restraint("overhead_restraint", { remaining: 0 })])
  );

  const withPositive = deriveCapabilities(
    simWith([restraint("overhead_restraint", { remaining: 5 })])
  );

  // Gating is array membership, not `remaining`.
  assert.equal(
    withZero.capabilities.handUse,
    withPositive.capabilities.handUse
  );

  assert.equal(withZero.capabilities.handUse, 0);
  assert.equal(withZero.activeConstraintIds.length, 1);
});

test("a constraint released by assessment but not yet swept still gates", () => {
  /*
   * cleanupExpiredConstraints() runs later in runEvaluationPhase()
   * and requires a current-cycle RELEASE decision. Until it sweeps the
   * entry, the prisoner is still in the position.
   */
  const result = deriveCapabilities(
    simWith([
      restraint("palestinian_chair", {
        remaining: 0,
        lastAssessment: {
          cycle: 7,
          constraintDecision: "RELEASE"
        }
      })
    ])
  );

  assert.equal(result.capabilities.handUse, 0);
  assert.equal(result.capabilities.interactionReach, 0);
});

/* ============================================================
   H) PURITY
============================================================ */

test("deriveCapabilities is pure and does not mutate its input", () => {
  const sim = simWith([
    restraint("palestinian_chair"),
    restraint("overhead_restraint")
  ]);

  const before = JSON.stringify(sim);

  const first = deriveCapabilities(sim);
  const second = deriveCapabilities(sim);

  assert.equal(JSON.stringify(sim), before);
  assert.deepEqual(first, second);
  assert.deepEqual(first.capabilities, second.capabilities);
});

test("returned provenance cannot mutate the constraint definitions", () => {
  const result = deriveCapabilities(
    simWith([restraint("palestinian_chair")])
  );

  const entry = result.provenance[0];

  entry.posture.hand_use = 99;
  entry.posture.pain_type.push("tampered");
  entry.contributedCapabilities.handUse = 99;

  const fresh = deriveCapabilities(
    simWith([restraint("palestinian_chair")])
  );

  assert.equal(
    fresh.capabilities.handUse,
    0,
    "definition must be unaffected by caller mutation"
  );

  assert.equal(
    CONSTRAINT_MAP.palestinian_chair.posture.hand_use,
    0
  );

  assert.equal(
    CONSTRAINT_MAP.palestinian_chair.posture.pain_type.length,
    3
  );
});

/* ============================================================
   I) PROVENANCE
============================================================ */

test("provenance lists every contributing constraint with its posture", () => {
  const result = deriveCapabilities(
    simWith([
      restraint("kneeling_grate"),
      restraint("overhead_restraint")
    ])
  );

  assert.equal(result.provenance.length, 2);

  const [first, second] = result.provenance;

  assert.equal(first.constraintId, "kneeling_grate");
  assert.equal(first.title, "Stress Position: Kneeling on Grate");
  assert.equal(first.posture.mobility_restriction, 0.8);
  assert.equal(first.posture.hand_use, 0.8);
  assert.equal(first.contributedCapabilities.handUse, 0.8);
  // Inverted conversion is applied per-constraint too.
  assertNear(first.contributedCapabilities.mobility, 0.2);

  assert.equal(second.constraintId, "overhead_restraint");
  assert.equal(second.contributedCapabilities.handUse, 0);
  assert.equal(second.contributedCapabilities.mobility, 0);

  assert.deepEqual(result.activeConstraintIds, [
    "kneeling_grate",
    "overhead_restraint"
  ]);
});

test("an unknown constraint id is surfaced but contributes no restriction", () => {
  const result = deriveCapabilities(
    simWith([restraint("not_a_real_constraint")])
  );

  assert.deepEqual(result.activeConstraintIds, ["not_a_real_constraint"]);
  assert.equal(result.provenance.length, 0);
  assert.equal(result.capabilities.handUse, 1);
  assert.equal(result.capabilities.mobility, 1);
});

/* ============================================================
   POSTURE DATA INTEGRITY
============================================================ */

test("every defined constraint declares the three added posture fields", () => {
  for (const definition of CONSTRAINT_LIBRARY) {
    const posture = definition.posture;

    assert.ok(posture, `${definition.id} has no posture block`);

    for (const field of [
      "mobility_restriction",
      "stability",
      "hand_use",
      "concentration",
      "interaction_reach"
    ]) {
      assert.equal(
        typeof posture[field],
        "number",
        `${definition.id}.posture.${field} must be a number`
      );

      assert.ok(
        posture[field] >= 0 && posture[field] <= 1,
        `${definition.id}.posture.${field} must be within [0, 1]`
      );
    }
  }
});

test("capability keys are always derived values within [0, 1]", () => {
  for (const definition of CONSTRAINT_LIBRARY) {
    const result = deriveCapabilities(
      simWith([restraint(definition.id)])
    );

    for (const value of Object.values(result.capabilities)) {
      assert.ok(
        value >= 0 && value <= 1,
        `${definition.id} produced out-of-range capability ${value}`
      );
    }
  }
});

test("an unrestrained capability dominates every defined position", () => {
  const free = deriveCapabilities(simWith([]));

  for (const definition of CONSTRAINT_LIBRARY) {
    const restrained = deriveCapabilities(
      simWith([restraint(definition.id)])
    );

    for (const key of Object.keys(free.capabilities)) {
      assert.ok(
        restrained.capabilities[key] <= free.capabilities[key],
        `${definition.id} improved ${key} beyond the unrestrained baseline`
      );
    }
  }
});
