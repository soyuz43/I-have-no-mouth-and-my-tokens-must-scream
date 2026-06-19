// js/engine/state/utils/beliefDistance.js

/**
 * Euclidean distance between two belief vectors.
 * Includes keys present in either object.
 */
export function beliefEuclideanDistance(before = {}, after = {}) {
  let sumSq = 0;

  const keys = new Set([
    ...Object.keys(before || {}),
    ...Object.keys(after || {}),
  ]);

  for (const key of keys) {
    const b = Number(before?.[key]) || 0;
    const a = Number(after?.[key]) || 0;

    sumSq += (a - b) ** 2;
  }

  return Math.sqrt(sumSq);
}

/**
 * Log belief update distance for observability only.
 * Does not block, revert, mutate, or decide anything.
 */
export function logBeliefDistance(simId, before, after, rawInput = null) {
  const distance = beliefEuclideanDistance(before, after);

  console.debug(
    `[BELIEF DISTANCE][${simId}] distance=${distance.toFixed(4)}`,
    {
      distance,
      before,
      after,
    }
  );

  return distance;
}