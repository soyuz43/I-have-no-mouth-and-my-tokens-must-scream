// js/engine/scratchpad/physicalState.js
//
// Deterministic, engine-owned physical-limitation awareness for the
// scratchpad system.
//
// WHAT THIS MODULE IS
// -------------------
// A pure function that converts the Agency Phase's derived capability
// bands for a prisoner into an objective list of physical limitations,
// expressed as stable string tokens. It answers exactly one question:
//
//   "Given the prisoner's current constraint posture, which physical
//    capabilities are objectively impaired enough that the scratchpad
//    should record them as fact?"
//
// This is NOT a model judgement. The prisoner does not "decide" that
// their hands are bound; the engine derives it from the same posture
// metadata that gates the Agency Phase (see
// js/engine/agency/capabilities.js). Recording it deterministically
// closes the loop between physical state and subjective cognition
// without trusting the LLM to guess its own restraints.
//
// WHAT THIS MODULE IS NOT
// ----------------------
// It does not mutate any scratchpad or sim. It does not read G. It does
// not call a model. It returns a fresh array every call so a caller
// that sorts or splices the result cannot corrupt shared state.
//
// BAND THRESHOLDS
// ---------------
// The capability bands come from js/engine/agency/capabilities.js:
//
//   normal           min 0.7
//   impaired         min 0.4
//   severely_impaired min 0.1
//   unavailable      min -Infinity
//
// A capability is treated as a hard physical limitation only when it
// is UNAVAILABLE (capability exactly 0, e.g. handUse under
// overhead_restraint) or SEVERELY_IMPAIRED (capability < 0.1 but > 0,
// a band the posture table can produce for concentration). The
// "impaired" band is deliberately excluded: a merely impaired
// capability is a degraded variant, not an objective impossibility,
// and over-recording it would drown the list in noise the prisoner
// already reasons about subjectively.
//
// TOKEN CONTRACT
// -------------
// Tokens are stable, lowercase, snake_case, and grouped by capability
// so a downstream consumer (prompt injection, analysis, tests) can
// branch on capability without re-deriving bands. The mapping is
// explicit and exhaustive over the five Agency capability keys.

const LIMITATION_TOKENS = Object.freeze({
  handUse: {
    unavailable: "hands_bound",
    severely_impaired: "severe_hand_impairment",
  },
  concentration: {
    unavailable: "incapable_of_focus",
    severely_impaired: "severe_concentration_impairment",
  },
  mobility: {
    unavailable: "immobile",
    severely_impaired: "severe_mobility_impairment",
  },
  stability: {
    unavailable: "unstable",
    severely_impaired: "severe_stability_impairment",
  },
  interactionReach: {
    unavailable: "cannot_reach",
    severely_impaired: "severe_reach_impairment",
  },
});

/*
 * Capability keys, declaration order. Used to walk the bands map so
 * the emitted token list is stable and inspectable rather than
 * key-order dependent on object insertion.
 */
const BAND_CAPABILITY_KEYS = Object.freeze([
  "handUse",
  "concentration",
  "mobility",
  "stability",
  "interactionReach",
]);

/*
 * The two bands that count as an objective, engine-owned limitation
 * rather than a degraded-but-possible capability.
 */
const HARD_LIMITATION_BANDS = Object.freeze([
  "unavailable",
  "severely_impaired",
]);

function normalizeBand(value) {
  if (typeof value !== "string") {
    return null;
  }

  return value.trim().toLowerCase();
}

/*
 * Pure: derive the limitation token list from an Agency capability
 * envelope's bands block.
 *
 * @param {object} agencyCapabilities
 *   The per-sim envelope returned by deriveCapabilities(), or any
 *   object carrying a `bands` map keyed by the five capability keys.
 *   Absent or malformed bands yield an empty list rather than throwing,
 *   because a missing envelope is a "no posture" condition, not a
 *   hard limitation.
 * @returns {string[]} Stable, deduplicated limitation tokens.
 */
export function generatePhysicalStateUpdate(
  sim,
  agencyCapabilities
) {
  const bands =
    agencyCapabilities &&
    agencyCapabilities.bands &&
    typeof agencyCapabilities.bands === "object"
      ? agencyCapabilities.bands
      : null;

  if (!bands) {
    return [];
  }

  const limitations = [];

  for (const key of BAND_CAPABILITY_KEYS) {
    const band = normalizeBand(bands[key]);

    if (!band || !HARD_LIMITATION_BANDS.includes(band)) {
      continue;
    }

    const tokenMap = LIMITATION_TOKENS[key];
    const token = tokenMap && tokenMap[band];

    if (token) {
      limitations.push(token);
    }
  }

  return [...new Set(limitations)];
}

/*
 * Guard used by the orchestrator so it can skip the atomic write when
 * the determination is empty and the field is already empty. Keeping
 * this as a named helper makes the "is this a no-op?" check in the
 * commit path legible rather than an inline array compare.
 */
export function physicalLimitationsChanged(
  currentLimitations,
  nextLimitations
) {
  const current =
    Array.isArray(currentLimitations)
      ? currentLimitations
      : [];

  if (current.length !== nextLimitations.length) {
    return true;
  }

  const currentSet = new Set(current);

  return nextLimitations.some(
    (token) => !currentSet.has(token)
  );
}
