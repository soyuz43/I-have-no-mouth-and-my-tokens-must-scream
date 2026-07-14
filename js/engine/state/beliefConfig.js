// js/engine/state/beliefConfig.js
//
// Resolved belief-dynamics policy.
//
// This module makes the implicit commit-damping policy explicit, validated,
// immutable, and directly consumable by live runtime code. It does NOT execute
// any belief-dynamics equation. Execution of contagion resistance stays in
// beliefContagion.js (out of scope). Execution of commit-layer damping lives in
// evaluateCommitDamping.js. This module is a pure data/validation layer.
//
// Design notes (source facts, not recommendations):
//   - The historical baseline "current-production-v1" is the commit-damping hybrid
//     formula currently hard-coded in dampBeliefDelta.js via G.dampingParams ?? fallbacks.
//   - contagionResistance records the floor/slope already executed in
//     beliefContagion.js (resistanceFactor: max(0.2, 1 - dist*1.6)); it is captured
//     here for completeness but is NOT executed by this module.
//   - clamp.mode "boundary-hard" records the unconditional boundary clamp + final
//     [0,1] clamp that always runs in applyBeliefUpdates.

export const CURRENT_PRODUCTION_V1 = "current-production-v1";

// Canonical frozen baseline used when no complete policy object is supplied.
const CURRENT_PRODUCTION_V1_RAW = Object.freeze({
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
  contagionResistance: {
    enabled: true,
    floor: 0.2,
    slope: 1.6
  },
  clamp: {
    mode: "boundary-hard"
  }
});

// Allowed top-level keys in a complete policy object.
const TOP_LEVEL_KEYS = ["version", "baseline", "commitDamping", "contagionResistance", "clamp"];

const COMMIT_DAMPING_MODES = ["hybrid", "constant", "none"];

const CLAMP_MODES = ["boundary-hard"];

// Parameter keys required for each commit-damping mode.
// "none" requires a minimal, unambiguous object: no meaningless parameters.
const COMMIT_DAMPING_REQUIRED_PARAMS = Object.freeze({
  hybrid: ["logisticK", "logisticMid", "hybridBlend", "coefficientFloor"],
  constant: ["constantCoefficient", "coefficientFloor"],
  none: []
});

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function deepFreeze(obj) {
  if (obj === null || typeof obj !== "object" || Object.isFrozen(obj)) return obj;
  Object.freeze(obj);
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (val !== null && typeof val === "object" && !Object.isFrozen(val)) {
      deepFreeze(val);
    }
  }
  return obj;
}

function cloneAndFreeze(obj) {
  // structuredClone reliably deep-clones plain data (primitives, nested objects/arrays).
  return deepFreeze(structuredClone(obj));
}

function fail(message) {
  throw new Error("BeliefPolicy: " + message);
}

function assertFiniteNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(`${label} must be a finite number (got ${typeof value}: ${value})`);
  }
}

function assertInRange(value, label, min, max) {
  assertFiniteNumber(value, label);
  if (value < min || value > max) {
    fail(`${label} must be in [${min}, ${max}] (got ${value})`);
  }
}

function assertNoUnknownKeys(obj, allowed, label) {
  const allowedSet = new Set(allowed);
  const extra = Object.keys(obj).filter((k) => !allowedSet.has(k));
  if (extra.length > 0) {
    fail(`unknown key(s) in ${label}: ${extra.join(", ")}`);
  }
}

function validateCommitDamping(commitDamping) {
  if (!isPlainObject(commitDamping)) {
    fail("commitDamping must be an object");
  }
  if (typeof commitDamping.mode !== "string") {
    fail("commitDamping.mode must be a string");
  }
  if (!COMMIT_DAMPING_MODES.includes(commitDamping.mode)) {
    fail(`unsupported commit-damping mode "${commitDamping.mode}"`);
  }

  const required = COMMIT_DAMPING_REQUIRED_PARAMS[commitDamping.mode];
  const params = commitDamping.params;

  assertNoUnknownKeys(commitDamping, ["mode", "params"], "commitDamping");

  if (!isPlainObject(params)) {
    fail("commitDamping.params must be an object");
  }

  const paramKeys = Object.keys(params);
  const requiredSet = new Set(required);
  const extra = paramKeys.filter((k) => !requiredSet.has(k));
  if (extra.length > 0) {
    fail(`unknown commit-damping params for mode "${commitDamping.mode}": ${extra.join(", ")}`);
  }
  for (const k of required) {
    if (!Object.prototype.hasOwnProperty.call(params, k)) {
      fail(`missing required commit-damping param "${k}" for mode "${commitDamping.mode}"`);
    }
  }

  if (commitDamping.mode === "hybrid") {
    assertInRange(params.logisticK, "logisticK", 1, 20);
    assertInRange(params.logisticMid, "logisticMid", 0.05, 0.95);
    assertInRange(params.hybridBlend, "hybridBlend", 0, 1);
    assertInRange(params.coefficientFloor, "coefficientFloor", 0, 1);
  } else if (commitDamping.mode === "constant") {
    assertInRange(params.constantCoefficient, "constantCoefficient", 0, 1);
    assertInRange(params.coefficientFloor, "coefficientFloor", 0, 1);
  }
  // mode "none": no params validated beyond presence of the (possibly empty) object.
}

function validateContagionResistance(contagionResistance) {
  if (!isPlainObject(contagionResistance)) {
    fail("contagionResistance must be an object");
  }
  assertNoUnknownKeys(contagionResistance, ["enabled", "floor", "slope"], "contagionResistance");
  if (typeof contagionResistance.enabled !== "boolean") {
    fail("contagionResistance.enabled must be a boolean");
  }
  assertInRange(contagionResistance.floor, "contagionResistance.floor", 0, 1);
  // slope: finite, greater than 0, at most 5.
  const slope = contagionResistance.slope;
  assertFiniteNumber(slope, "contagionResistance.slope");
  if (slope <= 0 || slope > 5) {
    fail(`contagionResistance.slope must be > 0 and <= 5 (got ${slope})`);
  }
}

function validateClamp(clamp) {
  if (!isPlainObject(clamp)) {
    fail("clamp must be an object");
  }
  assertNoUnknownKeys(clamp, ["mode"], "clamp");
  if (typeof clamp.mode !== "string") {
    fail("clamp.mode must be a string");
  }
  if (!CLAMP_MODES.includes(clamp.mode)) {
    fail(`unsupported clamp mode "${clamp.mode}"`);
  }
}

function validatePolicy(policy) {
  if (!isPlainObject(policy)) {
    fail("policy must be an object");
  }

  const keys = Object.keys(policy);
  const allowed = new Set(TOP_LEVEL_KEYS);
  const unknown = keys.filter((k) => !allowed.has(k));
  if (unknown.length > 0) {
    fail(`unknown top-level policy key(s): ${unknown.join(", ")}`);
  }

  const missing = TOP_LEVEL_KEYS.filter((k) => !Object.prototype.hasOwnProperty.call(policy, k));
  if (missing.length > 0) {
    fail(`missing required top-level policy key(s): ${missing.join(", ")}`);
  }

  if (policy.version !== 1) {
    fail(`unsupported policy version (got ${policy.version})`);
  }
  if (typeof policy.baseline !== "string") {
    fail("baseline must be a string");
  }

  validateCommitDamping(policy.commitDamping);
  validateContagionResistance(policy.contagionResistance);
  validateClamp(policy.clamp);
}

// Resolve a literal preset name to a complete raw policy object (not yet validated/frozen).
function presetToRaw(preset) {
  if (preset === CURRENT_PRODUCTION_V1) {
    // Return a structuredClone so the canonical frozen constant is never mutated.
    return structuredClone(CURRENT_PRODUCTION_V1_RAW);
  }
  fail(`unknown belief-dynamics preset "${preset}"`);
}

// Resolve a complete policy object (validated, deep-cloned, frozen) or a literal preset name.
export function resolveBeliefDynamicsPolicy(input) {
  let raw;
  if (isPlainObject(input)) {
    raw = input;
  } else if (typeof input === "string") {
    raw = presetToRaw(input);
  } else {
    fail("input must be a complete policy object or a preset name (string)");
  }

  // Validates the input in place (does not mutate), then deep-clones + freezes a copy.
  validatePolicy(raw);
  return cloneAndFreeze(raw);
}

// Frozen, resolved current-production-v1 baseline. Public, immutable.
export const DEFAULT_BELIEF_POLICY = resolveBeliefDynamicsPolicy(CURRENT_PRODUCTION_V1);