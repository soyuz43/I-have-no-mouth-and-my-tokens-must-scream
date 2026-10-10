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
// WHAT THIS ENVELOPE STORES
// -------------------------
// Per-cycle derivations and budgets live beside the persistent
// canonical action-event history. Resource ownership remains in the
// run-scoped G.resources ledger.
//
// FIELD SEMANTICS
// ---------------
//   cycle                — G.cycle at the moment of derivation.
//   capabilities         — simId -> deriveCapabilities(sim).
//   legalActions         — simId -> legal[] from enumerateLegalActions.
//   blockedActions       — simId -> blocked[] from enumerateLegalActions.
//   resources            — simId -> DERIVED, read-only resource view.
//   budgets              — simId -> action credits for this cycle.
//   events               — persistent canonical action outcomes.
//   lastDerivedCycle     — the last cycle the phase completed for.
//   nextActionSequence   — monotonic id counter for canonical events.
//
// `resources` is a VIEW, not the ledger. The authoritative ledger
// lives at G.resources and survives cycles; this map is rebuilt from
// it every cycle and is discarded on reset. Holding the ledger here
// would make per-cycle reset semantics ambiguous: resetting it would
// silently restore consumed cigarettes, and not resetting it would
// leak a snapshot of last cycle's inventory.
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
    resources: {},
    budgets: {},
    events: [],
    lastDerivedCycle: null,
    nextActionSequence: 1
  };
}
