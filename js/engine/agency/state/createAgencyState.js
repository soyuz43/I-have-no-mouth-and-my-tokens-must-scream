// js/engine/agency/state/createAgencyState.js
//
// Factory for the agency state envelope.
//
// WHAT THIS IS
// -------------
// The per-cycle store the agency phase writes its derivation into.
// It is a sibling of `G.comms` and `G.overhearing` in
// js/core/state.js, and follows the same convention: a factory rather
// than an inline object literal, so a reset can never be a partial
// field-by-field copy that silently drops a field added later.
//
// WHAT THIS ENVELOPE IS NOT
// -------------------------
// It is not a result store and not a history. There is no `history`
// array here, because the phase in this slice derives and logs; it
// keeps only the CURRENT cycle's picture plus a sequence counter for
// the action ids a later slice will mint. Adding a history array now
// would be an unused extension point.
//
// FIELD SEMANTICS
// ---------------
//   cycle                — G.cycle at the moment of derivation.
//   capabilities         — simId -> deriveCapabilities(sim).
//   legalActions         — simId -> legal[] from enumerateLegalActions.
//   blockedActions       — simId -> blocked[] from enumerateLegalActions.
//   lastDerivedCycle     — the last cycle the phase completed for.
//   nextActionSequence   — id counter for future proposed actions.
//
// `capabilities`, `legalActions`, and `blockedActions` hold the FULL
// deriveCapabilities() return value, not just its `capabilities`
// field, because the bands and provenance are what make a refusal
// explainable after the fact. A consumer that needs only the five
// floats reads `entry.capabilities`.

/*
 * A fresh envelope every call.
 *
 * The three maps are fresh objects, not shared references, so a reset
 * cannot write through to a previously captured envelope. `cycle` and
 * `lastDerivedCycle` are `null` rather than `0` so "not yet derived
 * this run" is distinguishable from "derived at cycle 0".
 */
export function createAgencyState() {
  return {
    cycle: null,
    capabilities: {},
    legalActions: {},
    blockedActions: {},
    lastDerivedCycle: null,
    nextActionSequence: 1
  };
}
