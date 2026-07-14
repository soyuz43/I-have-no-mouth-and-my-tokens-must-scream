// js/models/sampling.js
//
// State-conditioned sampling resolver (v1, narrowly scoped).
//
// Scope: only prisoner journal calls may override the backend temperature.
// All other call types, missing state, and malformed state preserve the
// existing backend behavior exactly (including Anthropic's omission of the
// temperature field). This module is an import-free leaf: it must not import
// application state, backends, or any other module.

const BASELINE_TEMPERATURE = 0.85;
const MIN_TEMPERATURE = 0.85;
const MAX_TEMPERATURE = 1.0;

const MIN_STATE = 0;
const MAX_STATE = 100;

const SANITY_WEIGHT = 0.10;
const SUFFERING_WEIGHT = 0.05;

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, value));
}

function normalizeState(value) {
  return clampNumber(value, MIN_STATE, MAX_STATE);
}

/**
 * Resolve sampling settings for a single model call.
 *
 * @param {Object} [context]
 *   Optional context, expected v1 shape:
 *   {
 *     callType: "journal",
 *     sanity: number,
 *     suffering: number
 *   }
 *
 * @returns {Object}
 *   - { policy: "not-applicable" } when no override should be sent.
 *     Existing backend behavior is preserved (no `temperature` field).
 *   - {
 *       policy: "fallback",
 *       callType: string | undefined,
 *       reason: string
 *     } when an override was requested but state was unusable. Existing
 *     backend behavior is preserved (no `temperature` field).
 *   - {
 *       policy: "state-conditioned",
 *       callType: "journal",
 *       temperature: number,
 *       sanity: number,
 *       suffering: number
 *     } when an explicit override should be sent.
 */
export function resolveSampling(context) {
  if (
    !context ||
    typeof context !== "object" ||
    context.callType !== "journal"
  ) {
    return {
      policy: "not-applicable",
      callType:
        context && typeof context === "object"
          ? context.callType
          : undefined
    };
  }

  const sanity = context.sanity;
  const suffering = context.suffering;

  if (
    !Number.isFinite(sanity) ||
    !Number.isFinite(suffering)
  ) {
    return {
      policy: "fallback",
      callType: "journal",
      reason: "missing_or_invalid_state"
    };
  }

  const normalizedSanity =
    normalizeState(sanity);
  const normalizedSuffering =
    normalizeState(suffering);

  const sanityContribution =
    (1 - normalizedSanity / 100) * SANITY_WEIGHT;

  const sufferingContribution =
    (normalizedSuffering / 100) * SUFFERING_WEIGHT;

  const temperature = clampNumber(
    BASELINE_TEMPERATURE +
      sanityContribution +
      sufferingContribution,
    MIN_TEMPERATURE,
    MAX_TEMPERATURE
  );

  return {
    policy: "state-conditioned",
    callType: "journal",
    temperature,
    sanity: normalizedSanity,
    suffering: normalizedSuffering
  };
}

export const SAMPLING_CONSTANTS = Object.freeze({
  BASELINE_TEMPERATURE,
  MIN_TEMPERATURE,
  MAX_TEMPERATURE,
  MIN_STATE,
  MAX_STATE,
  SANITY_WEIGHT,
  SUFFERING_WEIGHT
});
