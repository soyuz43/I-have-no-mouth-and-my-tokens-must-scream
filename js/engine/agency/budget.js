// js/engine/agency/budget.js
//
// Deterministic action budget derived from a prisoner's PHYSICAL
// capability bands.
//
// WHAT THIS IS
// ------------
// A pure mapping from the `bands` block of the deriveCapabilities()
// envelope to an integer action budget. The budget is a COST CEILING
// for the single action a prisoner may propose in the agency phase
// (WAIT = 0, most actions = 1, SMOKE deliberate = 2). It is NOT a
// count of actions: the pipeline still proposes exactly one action
// per actor per cycle.
//
// WHY BANDS AND NOT FLOATS
// ------------------------
// The band ladder in capabilities.js is the single source of truth
// for the boundaries between "normal", "impaired", and worse. Reading
// bands here keeps those boundaries in one place; a numeric threshold
// would duplicate them and the two could drift. This mirrors the two
// existing band consumers: capabilityConcealmentRule.js and
// scratchpad/physicalState.js.
//
// PURITY CONTRACT
// ---------------
// Reads only its argument. No `G`, no globals, no `Date`, no random
// source, no I/O, no mutation of the envelope. Same input, same
// integer out, every time.
//
// FAIL OPEN
// ---------
// A missing or malformed `bands` block is a "no posture data"
// condition, not evidence of incapacity, so it returns the full
// budget of 3 rather than punishing the prisoner for a broken input.
// This matches capabilityConcealmentRule.js.

export function deriveActionBudget(capabilityEnvelope) {
  const bands = capabilityEnvelope?.bands;

  if (!bands || typeof bands !== "object") {
    return 3;
  }

  let budget = 3;

  if (bands.handUse === "severely_impaired" || bands.handUse === "unavailable") {
    budget -= 1;
  }

  if (bands.concentration === "impaired" ||
      bands.concentration === "severely_impaired" ||
      bands.concentration === "unavailable") {
    budget -= 1;
  }

  if (bands.stability === "severely_impaired" || bands.stability === "unavailable") {
    budget -= 1;
  }

  return Math.max(1, budget);
}
