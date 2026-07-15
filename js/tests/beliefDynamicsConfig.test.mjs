// js/tests/beliefDynamicsConfig.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CURRENT_PRODUCTION_V1,
  resolveBeliefDynamicsPolicy,
  DEFAULT_BELIEF_POLICY
} from "../engine/state/beliefConfig.js";
import { evaluateCommitDamping } from "../engine/state/evaluateCommitDamping.js";
import {
  applyBeliefUpdates,
  applyBeliefUpdatesWithPolicy,
  BELIEF_DYNAMICS
} from "../engine/state/commit.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function completeHybridPolicy(overrides = {}) {
  return {
    version: 1,
    baseline: CURRENT_PRODUCTION_V1,
    commitDamping: {
      mode: "hybrid",
      params: {
        logisticK: 5,
        logisticMid: 0.5,
        hybridBlend: 0.68,
        coefficientFloor: 0.5
      }
    },
    contagionResistance: { enabled: true, floor: 0.2, slope: 1.6 },
    clamp: { mode: "boundary-hard" },
    ...overrides
  };
}

// Independent oracle (NOT importing the production evaluator's formula).
function oracleHybrid(p, v, inputDelta, sim) {
  const k = p.commitDamping.params.logisticK;
  const mid = p.commitDamping.params.logisticMid;
  const blend = p.commitDamping.params.hybridBlend;
  const floor = p.commitDamping.params.coefficientFloor;
  const stress = (sim.suffering ?? 0) / 100;
  const trust = sim.beliefs?.others_trustworthy ?? 0.5;
  const d = Math.abs(v - 0.5) / 0.5;
  const adjustedMid = mid - stress * 0.12 + trust * 0.1;
  const logistic = 1 / (1 + Math.exp(k * (d - adjustedMid)));
  const quadratic = (1 - d) * (1 - d);
  const coefficient = Math.max(floor, blend * logistic + (1 - blend) * quadratic);
  return { coefficient, outputDelta: inputDelta * coefficient };
}

function makeSim(overrides = {}) {
  return {
    id: "TEST",
    suffering: 20,
    beliefs: { escape_possible: 0.5, others_trustworthy: 0.5 },
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// Resolver tests
// ---------------------------------------------------------------------------

test("built-in baseline preset resolves", () => {
  const r = resolveBeliefDynamicsPolicy(CURRENT_PRODUCTION_V1);
  assert.equal(r.version, 1);
  assert.equal(r.baseline, CURRENT_PRODUCTION_V1);
});

test("complete equivalent object resolves", () => {
  const r = resolveBeliefDynamicsPolicy(completeHybridPolicy());
  assert.equal(r.commitDamping.mode, "hybrid");
});

test("resolved baseline has exact expected values", () => {
  const r = resolveBeliefDynamicsPolicy(CURRENT_PRODUCTION_V1);
  assert.deepEqual(r, {
    version: 1,
    baseline: "current-production-v1",
    commitDamping: {
      mode: "hybrid",
      params: {
        logisticK: 5,
        logisticMid: 0.5,
        hybridBlend: 0.68,
        coefficientFloor: 0.5
      }
    },
    contagionResistance: { enabled: true, floor: 0.2, slope: 1.6 },
    clamp: { mode: "boundary-hard" }
  });
});

test("resolved object is deeply frozen", () => {
  const r = resolveBeliefDynamicsPolicy(CURRENT_PRODUCTION_V1);
  assert.ok(Object.isFrozen(r));
  assert.ok(Object.isFrozen(r.commitDamping));
  assert.ok(Object.isFrozen(r.commitDamping.params));
  assert.ok(Object.isFrozen(r.contagionResistance));
  assert.ok(Object.isFrozen(r.clamp));
});

test("DEFAULT_BELIEF_POLICY is the frozen current-production-v1 policy", () => {
  assert.ok(Object.isFrozen(DEFAULT_BELIEF_POLICY));
  assert.deepEqual(DEFAULT_BELIEF_POLICY, resolveBeliefDynamicsPolicy(CURRENT_PRODUCTION_V1));
});

test("caller input is not mutated or frozen", () => {
  const input = completeHybridPolicy();
  const inputCopy = structuredClone(input);
  resolveBeliefDynamicsPolicy(input);
  assert.deepEqual(input, inputCopy);
  assert.ok(!Object.isFrozen(input));
  assert.ok(!Object.isFrozen(input.commitDamping.params));
});

test("unknown top-level key throws", () => {
  const p = completeHybridPolicy();
  p.unknownKey = 1;
  assert.throws(() => resolveBeliefDynamicsPolicy(p), /unknown top-level policy key/);
});

test("unknown nested key throws", () => {
  const p = completeHybridPolicy();
  p.commitDamping.params.extra = 1;
  assert.throws(() => resolveBeliefDynamicsPolicy(p), /unknown commit-damping params/);
});

test("missing required key throws", () => {
  const p = completeHybridPolicy();
  delete p.clamp;
  assert.throws(() => resolveBeliefDynamicsPolicy(p), /missing required top-level policy key/);
});

test("unsupported version throws", () => {
  const p = completeHybridPolicy({ version: 2 });
  assert.throws(() => resolveBeliefDynamicsPolicy(p), /unsupported policy version/);
});

test("unknown damping mode throws", () => {
  const p = completeHybridPolicy();
  p.commitDamping.mode = "logistic";
  assert.throws(() => resolveBeliefDynamicsPolicy(p), /unsupported commit-damping mode/);
});

test("unsupported clamp mode throws", () => {
  const p = completeHybridPolicy();
  p.clamp.mode = "soft";
  assert.throws(() => resolveBeliefDynamicsPolicy(p), /unsupported clamp mode/);
});

test("non-finite values throw", () => {
  const p = completeHybridPolicy();
  p.commitDamping.params.logisticK = NaN;
  assert.throws(() => resolveBeliefDynamicsPolicy(p), /must be a finite number/);
  const p2 = completeHybridPolicy();
  p2.commitDamping.params.logisticMid = Infinity;
  assert.throws(() => resolveBeliefDynamicsPolicy(p2), /must be a finite number/);
});

test("numeric boundaries are tested and accepted at the edge", () => {
  // hybrid boundaries accepted at exact edges.
  for (const [key, lo, hi] of [
    ["logisticK", 1, 20],
    ["logisticMid", 0.05, 0.95],
    ["hybridBlend", 0, 1],
    ["coefficientFloor", 0, 1]
  ]) {
    const loP = completeHybridPolicy();
    loP.commitDamping.params[key] = lo;
    assert.doesNotThrow(() => resolveBeliefDynamicsPolicy(loP), `low ${key}`);
    const hiP = completeHybridPolicy();
    hiP.commitDamping.params[key] = hi;
    assert.doesNotThrow(() => resolveBeliefDynamicsPolicy(hiP), `high ${key}`);
  }
});

test("numeric boundaries rejected just outside the range", () => {
  assert.throws(() => resolveBeliefDynamicsPolicy(completeHybridPolicy({ commitDamping: { mode: "hybrid", params: { logisticK: 0.999, logisticMid: 0.5, hybridBlend: 0.68, coefficientFloor: 0.5 } } })), /must be in \[1, 20\]/);
  assert.throws(() => resolveBeliefDynamicsPolicy(completeHybridPolicy({ commitDamping: { mode: "hybrid", params: { logisticK: 5, logisticMid: 0.0499, hybridBlend: 0.68, coefficientFloor: 0.5 } } })), /must be in \[0.05, 0.95\]/);
  assert.throws(() => resolveBeliefDynamicsPolicy(completeHybridPolicy({ commitDamping: { mode: "hybrid", params: { logisticK: 5, logisticMid: 0.5, hybridBlend: -0.0001, coefficientFloor: 0.5 } } })), /must be in \[0, 1\]/);
});

test("constant requires constantCoefficient", () => {
  const p = {
    version: 1,
    baseline: CURRENT_PRODUCTION_V1,
    commitDamping: { mode: "constant", params: { coefficientFloor: 0.5 } },
    contagionResistance: { enabled: true, floor: 0.2, slope: 1.6 },
    clamp: { mode: "boundary-hard" }
  };
  assert.throws(() => resolveBeliefDynamicsPolicy(p), /missing required commit-damping param "constantCoefficient"/);
});

test("constant resolves with constantCoefficient", () => {
  const p = {
    version: 1,
    baseline: CURRENT_PRODUCTION_V1,
    commitDamping: { mode: "constant", params: { constantCoefficient: 0.3, coefficientFloor: 0.5 } },
    contagionResistance: { enabled: true, floor: 0.2, slope: 1.6 },
    clamp: { mode: "boundary-hard" }
  };
  assert.doesNotThrow(() => resolveBeliefDynamicsPolicy(p));
});

test("none resolves unambiguously with empty params", () => {
  const p = {
    version: 1,
    baseline: CURRENT_PRODUCTION_V1,
    commitDamping: { mode: "none", params: {} },
    contagionResistance: { enabled: true, floor: 0.2, slope: 1.6 },
    clamp: { mode: "boundary-hard" }
  };
  const r = resolveBeliefDynamicsPolicy(p);
  assert.equal(r.commitDamping.mode, "none");
});

test("none with a meaningless required param throws", () => {
  const p = {
    version: 1,
    baseline: CURRENT_PRODUCTION_V1,
    commitDamping: { mode: "none", params: { logisticK: 5 } },
    contagionResistance: { enabled: true, floor: 0.2, slope: 1.6 },
    clamp: { mode: "boundary-hard" }
  };
  assert.throws(() => resolveBeliefDynamicsPolicy(p), /unknown commit-damping params/);
});

test("invalid mode/parameter combinations throw", () => {
  // hybrid missing a required param.
  const pHybrid = {
    version: 1,
    baseline: CURRENT_PRODUCTION_V1,
    commitDamping: { mode: "hybrid", params: { logisticK: 5, logisticMid: 0.5, hybridBlend: 0.68 } },
    contagionResistance: { enabled: true, floor: 0.2, slope: 1.6 },
    clamp: { mode: "boundary-hard" }
  };
  assert.throws(() => resolveBeliefDynamicsPolicy(pHybrid), /missing required commit-damping param "coefficientFloor"/);
  // contagion slope out of range.
  const pSlope = completeHybridPolicy();
  pSlope.contagionResistance.slope = 5.1;
  assert.throws(() => resolveBeliefDynamicsPolicy(pSlope), /contagionResistance.slope/);
});

// ---------------------------------------------------------------------------
// Evaluator tests
// ---------------------------------------------------------------------------

test("hybrid exact oracle at belief 0", () => {
  const p = resolveBeliefDynamicsPolicy(CURRENT_PRODUCTION_V1);
  const sim = makeSim({ suffering: 0, beliefs: { escape_possible: 0, others_trustworthy: 0 } });
  const inputDelta = 0.1;
  const out = evaluateCommitDamping(p, sim, "escape_possible", 0, inputDelta);
  const oracle = oracleHybrid(p, 0, inputDelta, sim);
  assert.equal(out.coefficient, oracle.coefficient);
  assert.equal(out.outputDelta, oracle.outputDelta);
  assert.equal(out.mode, "hybrid");
  assert.ok(out.calculation.logistic !== undefined);
  assert.ok(out.calculation.quadratic !== undefined);
});

test("hybrid exact oracle at belief 0.5", () => {
  const p = resolveBeliefDynamicsPolicy(CURRENT_PRODUCTION_V1);
  const sim = makeSim({ suffering: 50, beliefs: { escape_possible: 0.5, others_trustworthy: 1 } });
  const inputDelta = -0.2;
  const out = evaluateCommitDamping(p, sim, "escape_possible", 0.5, inputDelta);
  const oracle = oracleHybrid(p, 0.5, inputDelta, sim);
  assert.equal(out.coefficient, oracle.coefficient);
  assert.equal(out.outputDelta, oracle.outputDelta);
});

test("hybrid exact oracle at belief 1", () => {
  const p = resolveBeliefDynamicsPolicy(CURRENT_PRODUCTION_V1);
  const sim = makeSim({ suffering: 100, beliefs: { escape_possible: 1, others_trustworthy: 0.25 } });
  const inputDelta = 0.3;
  const out = evaluateCommitDamping(p, sim, "escape_possible", 1, inputDelta);
  const oracle = oracleHybrid(p, 1, inputDelta, sim);
  assert.equal(out.coefficient, oracle.coefficient);
  assert.equal(out.outputDelta, oracle.outputDelta);
});

test("hybrid handles missing/default context like production", () => {
  const p = resolveBeliefDynamicsPolicy(CURRENT_PRODUCTION_V1);
  // sim with no suffering and no others_trustworthy key.
  const sim = { id: "X", beliefs: { escape_possible: 0.5 } };
  const inputDelta = 0.1;
  const out = evaluateCommitDamping(p, sim, "escape_possible", 0.5, inputDelta);
  const oracle = oracleHybrid(p, 0.5, inputDelta, sim);
  assert.equal(out.coefficient, oracle.coefficient);
  assert.equal(out.outputDelta, oracle.outputDelta);
});

test("constant exact multiplier", () => {
  const p = resolveBeliefDynamicsPolicy({
    version: 1,
    baseline: CURRENT_PRODUCTION_V1,
    commitDamping: { mode: "constant", params: { constantCoefficient: 0.3, coefficientFloor: 0.5 } },
    contagionResistance: { enabled: true, floor: 0.2, slope: 1.6 },
    clamp: { mode: "boundary-hard" }
  });
  const sim = makeSim();
  const inputDelta = 0.4;
  const out = evaluateCommitDamping(p, sim, "escape_possible", 0.5, inputDelta);
  assert.equal(out.coefficient, 0.3);
  assert.equal(out.outputDelta, 0.12);
  assert.deepEqual(out.calculation, { coefficient: 0.3 });
});

test("none exact identity", () => {
  const p = resolveBeliefDynamicsPolicy({
    version: 1,
    baseline: CURRENT_PRODUCTION_V1,
    commitDamping: { mode: "none", params: {} },
    contagionResistance: { enabled: true, floor: 0.2, slope: 1.6 },
    clamp: { mode: "boundary-hard" }
  });
  const sim = makeSim();
  const inputDelta = 0.4;
  const out = evaluateCommitDamping(p, sim, "escape_possible", 0.5, inputDelta);
  assert.equal(out.coefficient, 1);
  assert.equal(out.outputDelta, 0.4);
  assert.deepEqual(out.calculation, {});
});

test("evaluator does not mutate policy or sim", () => {
  const p = resolveBeliefDynamicsPolicy(CURRENT_PRODUCTION_V1);
  const pCopy = structuredClone(p);
  const sim = makeSim({ beliefs: { escape_possible: 0.5, others_trustworthy: 0.5 } });
  const simCopy = structuredClone(sim);
  evaluateCommitDamping(p, sim, "escape_possible", 0.5, 0.1);
  assert.deepEqual(p, pCopy);
  assert.deepEqual(sim, simCopy);
});

test("evaluator output metadata matches executed math", () => {
  const p = resolveBeliefDynamicsPolicy(CURRENT_PRODUCTION_V1);
  const sim = makeSim({ suffering: 0, beliefs: { escape_possible: 0, others_trustworthy: 0 } });
  const inputDelta = 0.1;
  const out = evaluateCommitDamping(p, sim, "escape_possible", 0, inputDelta);
  const expected = Math.max(0.5, out.calculation.coefficientBeforeFloor);
  assert.equal(out.coefficient, expected);
  assert.equal(out.outputDelta, inputDelta * out.coefficient);
  assert.equal(out.coefficientFloor, 0.5);
});

// ---------------------------------------------------------------------------
// Commit integration tests
// ---------------------------------------------------------------------------

function appliedKeys(applied) {
  return applied.map((a) => a.key).sort();
}

test("default wrapper equals applyBeliefUpdatesWithPolicy(DEFAULT_BELIEF_POLICY, ...)", () => {
  const simA = makeSim({ beliefs: { escape_possible: 0.5, others_trustworthy: 0.5 } });
  const simB = structuredClone(simA);
  applyBeliefUpdates(simA, { escape_possible: 0.1 }, { DEBUG: false });
  applyBeliefUpdatesWithPolicy(DEFAULT_BELIEF_POLICY, simB, { escape_possible: 0.1 }, { DEBUG: false });
  assert.equal(simA.beliefs.escape_possible, simB.beliefs.escape_possible);
});

test("default path matches current committed behavior (hybrid)", async () => {
  // Compare against the legacy evaluator path for a representative scenario.
  const { dampBeliefDelta } = await import("../engine/state/utils/dampBeliefDelta.js");
  const sim = makeSim({ suffering: 20, beliefs: { escape_possible: 0.3, others_trustworthy: 0.6 } });
  const delta = 0.1;
  const legacy = dampBeliefDelta(sim, "escape_possible", sim.beliefs.escape_possible, delta);
  const out = evaluateCommitDamping(DEFAULT_BELIEF_POLICY, sim, "escape_possible", sim.beliefs.escape_possible, delta);
  assert.equal(out.outputDelta, legacy);
});

test("constant policy produces expected committed result", () => {
  const p = resolveBeliefDynamicsPolicy({
    version: 1,
    baseline: CURRENT_PRODUCTION_V1,
    commitDamping: { mode: "constant", params: { constantCoefficient: 0.25, coefficientFloor: 0.5 } },
    contagionResistance: { enabled: true, floor: 0.2, slope: 1.6 },
    clamp: { mode: "boundary-hard" }
  });
  const sim = makeSim({ beliefs: { escape_possible: 0.5, others_trustworthy: 0.5 } });
  const before = sim.beliefs.escape_possible;
  applyBeliefUpdatesWithPolicy(p, sim, { escape_possible: 0.4 }, { DEBUG: false });
  // damped delta = 0.4 * 0.25 = 0.1 => committed 0.6
  assert.equal(sim.beliefs.escape_possible, before + 0.1);
});

test("none bypasses commit damping but not hard clamps", () => {
  const p = resolveBeliefDynamicsPolicy({
    version: 1,
    baseline: CURRENT_PRODUCTION_V1,
    commitDamping: { mode: "none", params: {} },
    contagionResistance: { enabled: true, floor: 0.2, slope: 1.6 },
    clamp: { mode: "boundary-hard" }
  });
  const sim = makeSim({ beliefs: { escape_possible: 0.5, others_trustworthy: 0.5 } });
  const before = sim.beliefs.escape_possible;
  applyBeliefUpdatesWithPolicy(p, sim, { escape_possible: 0.4 }, { DEBUG: false });
  assert.equal(sim.beliefs.escape_possible, before + 0.4);
});

test("positive overshoot still commits to 1", () => {
  const sim = makeSim({ beliefs: { escape_possible: 0.95, others_trustworthy: 0.5 } });
  applyBeliefUpdates(sim, { escape_possible: 0.5 }, { DEBUG: false });
  assert.equal(sim.beliefs.escape_possible, 1);
});

test("negative overshoot still commits to 0", () => {
  const sim = makeSim({ beliefs: { escape_possible: 0.05, others_trustworthy: 0.5 } });
  applyBeliefUpdates(sim, { escape_possible: -0.5 }, { DEBUG: false });
  assert.equal(sim.beliefs.escape_possible, 0);
});

test("invalid/non-finite updates remain skipped", () => {
  const sim = makeSim({ beliefs: { escape_possible: 0.5, others_trustworthy: 0.5 } });
  applyBeliefUpdates(sim, { escape_possible: NaN }, { DEBUG: false });
  applyBeliefUpdates(sim, { escape_possible: Infinity }, { DEBUG: false });
  assert.equal(sim.beliefs.escape_possible, 0.5);
});

test("unknown belief keys remain handled as before", () => {
  const sim = makeSim({ beliefs: { escape_possible: 0.5, others_trustworthy: 0.5 } });
  const before = structuredClone(sim.beliefs);
  applyBeliefUpdates(sim, { nope: 0.1 }, { DEBUG: false });
  assert.deepEqual(sim.beliefs, before);
});

test("returned/applied metadata remains structurally compatible", () => {
  const sim = makeSim({ beliefs: { escape_possible: 0.5, others_trustworthy: 0.5 } });
  applyBeliefUpdates(sim, { escape_possible: 0.1, nope: 0.1 }, { DEBUG: false });
  // No throw; belief is mutated by the known key; unknown key ignored.
  assert.ok(sim.beliefs.escape_possible > 0.5);
});

test("legacy SKIP_DAMPING:true retains current semantics", () => {
  const simA = makeSim({ beliefs: { escape_possible: 0.5, others_trustworthy: 0.5 } });
  const simB = structuredClone(simA);
  applyBeliefUpdates(simA, { escape_possible: 0.4 }, { DEBUG: false, SKIP_DAMPING: true });
  applyBeliefUpdatesWithPolicy(
    resolveBeliefDynamicsPolicy({
      version: 1,
      baseline: CURRENT_PRODUCTION_V1,
      commitDamping: { mode: "none", params: {} },
      contagionResistance: { enabled: true, floor: 0.2, slope: 1.6 },
      clamp: { mode: "boundary-hard" }
    }),
    simB,
    { escape_possible: 0.4 },
    { DEBUG: false }
  );
  assert.equal(simA.beliefs.escape_possible, simB.beliefs.escape_possible);
  assert.equal(simA.beliefs.escape_possible, 0.9);
});

test("unknown commitDamping parent key throws", () => {
  const p = completeHybridPolicy();
  p.commitDamping.foo = 1;
  assert.throws(() => resolveBeliefDynamicsPolicy(p), /unknown key\(s\) in commitDamping/);
});

test("unknown contagionResistance parent key throws", () => {
  const p = completeHybridPolicy();
  p.contagionResistance.bar = 1;
  assert.throws(() => resolveBeliefDynamicsPolicy(p), /unknown key\(s\) in contagionResistance/);
});

test("unknown clamp parent key throws", () => {
  const p = completeHybridPolicy();
  p.clamp.extra = 1;
  assert.throws(() => resolveBeliefDynamicsPolicy(p), /unknown key\(s\) in clamp/);
});

test("non-object / array input throws", () => {
  assert.throws(() => resolveBeliefDynamicsPolicy(null), /complete policy object/);
  assert.throws(() => resolveBeliefDynamicsPolicy(42), /complete policy object/);
  assert.throws(() => resolveBeliefDynamicsPolicy("not-a-preset"), /unknown belief-dynamics preset/);
  assert.throws(() => resolveBeliefDynamicsPolicy([]), /complete policy object/);
  assert.throws(() => resolveBeliefDynamicsPolicy([completeHybridPolicy()]), /complete policy object/);
});

test("retained G.dampingParams override still dispatches legacy helper", async () => {
  const simA = makeSim({ beliefs: { escape_possible: 0.3, others_trustworthy: 0.6 } });
  const simB = structuredClone(simA);
  const { G } = await import("../core/state.js");
  const saved = G.dampingParams;
  G.dampingParams = { logisticK: 8, logisticMid: 0.4, hybridBlend: 0.5, minResistance: 0.3 };
  try {
    applyBeliefUpdates(simA, { escape_possible: 0.1 }, { DEBUG: false });
    const { dampBeliefDelta } = await import("../engine/state/utils/dampBeliefDelta.js");
    const legacy = dampBeliefDelta(simB, "escape_possible", simB.beliefs.escape_possible, 0.1);
    const before = simB.beliefs.escape_possible;
    simB.beliefs.escape_possible = before + legacy;
    assert.equal(simA.beliefs.escape_possible, simB.beliefs.escape_possible);
  } finally {
    G.dampingParams = saved;
  }
});

test("no global policy state leaks between tests", () => {
  // Each resolve produces an independent frozen object.
  const a = resolveBeliefDynamicsPolicy(CURRENT_PRODUCTION_V1);
  const b = resolveBeliefDynamicsPolicy(CURRENT_PRODUCTION_V1);
  assert.notEqual(a, b);
  assert.deepEqual(a, b);
});

test("compatibility surfaces remain exported", () => {
  assert.ok(typeof BELIEF_DYNAMICS === "object");
  assert.ok(typeof applyBeliefUpdates === "function");
  assert.ok(typeof applyBeliefUpdatesWithPolicy === "function");
});