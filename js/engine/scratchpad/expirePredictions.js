// js/engine/scratchpad/expirePredictions.js
//
// Engine-owned prediction-lifecycle maintenance.
//
// This module is intentionally separate from the scratchpad COMMS
// commit protocol (js/engine/scratchpad/comms/commit.js). The commit
// layer owns model-driven, evidence-grounded updates. Expiry is
// deterministic engine maintenance evaluated at cycle boundaries,
// independent of any model output. This mirrors the roadmap's planned
// separation between comms-committed state and engine-owned lifecycle
// bookkeeping (e.g. consolidation).
//
// This implements the "expire" half of the question/prediction
// lifecycle (roadmap Priority 2). The RESOLVE operation is deferred
// until evaluation semantics are settled; expiry only marks due,
// unresolved predictions as expired.

/**
 * Determine whether a single prediction has passed its evaluation
 * deadline.
 *
 * A prediction is expired when:
 * - it is not already resolved;
 * - it carries a finite numeric `evaluateByCycle`;
 * - the current cycle is strictly past that deadline.
 *
 * Pure: depends only on the prediction object and the cycle value.
 *
 * @param {object} prediction
 * @param {number} cycle
 * @returns {boolean}
 */
export function isPredictionExpired(prediction, cycle) {
  if (
    !prediction ||
    typeof prediction !== "object"
  ) {
    return false;
  }

  if (prediction.resolved === true) {
    return false;
  }

  const deadline = prediction.evaluateByCycle;

  if (
    typeof deadline !== "number" ||
    !Number.isFinite(deadline)
  ) {
    return false;
  }

  if (
    typeof cycle !== "number" ||
    !Number.isFinite(cycle)
  ) {
    return false;
  }

  return cycle > deadline;
}

/**
 * Mark due, unresolved predictions in a scratchpad as expired.
 *
 * Mutates `scratchpad.predictions` in place (engine-owned, like belief
 * contagion) and returns the ids of predictions newly marked expired
 * during this call. Idempotent: an already-expired entry is not
 * re-reported.
 *
 * Additive: introduces `expired` and `expiredCycle` on entries; it
 * does not remove or reorder existing fields.
 *
 * @param {object} scratchpad
 * @param {number} cycle
 * @returns {Array<number|undefined>}
 */
export function expirePredictions(scratchpad, cycle) {
  if (
    !scratchpad ||
    typeof scratchpad !== "object" ||
    !Array.isArray(
      scratchpad.predictions
    )
  ) {
    return [];
  }

  const expiredIds = [];

  for (const prediction of scratchpad.predictions) {
    if (
      !prediction ||
      typeof prediction !== "object"
    ) {
      continue;
    }

    if (
      isPredictionExpired(
        prediction,
        cycle
      ) &&
      prediction.expired !== true
    ) {
      prediction.expired = true;
      prediction.expiredCycle = cycle;

      expiredIds.push(
        prediction.id
      );
    }
  }

  return expiredIds;
}
