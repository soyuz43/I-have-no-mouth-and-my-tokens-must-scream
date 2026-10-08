// js/engine/agency/resourceDefs.js
//
// Resource definition catalogue for the Agency Phase.
//
// WHAT THIS MODULE IS
// -------------------
// A data-only catalogue describing WHAT KIND OF THING a resource is.
// It holds no possession logic, no availability logic, and no
// execution logic. It answers exactly one question:
//
//   "What does a resource look like, and which resources exist?"
//
// TWO-LAYER ARCHITECTURE
// ----------------------
// This is the DEFINITION layer. The INSTANCE layer lives in
// js/engine/agency/resourceLedger.js. Keeping them separate stops
// definitions, inventory, and world state from becoming one tangled
// object: a definition says "a cigarette can be consumed", while an
// instance says "TED currently holds three of them".
//
// WHY `ignitionSource` IS A DEFINITION FLAG
// -----------------------------------------
// `ignition` (inside a requirements block) is a RESOURCE
// prerequisite, not a capability. deriveCapabilities() emits exactly
// five capability keys and will never emit `ignition`, so the
// enumerator cannot resolve it by capability comparison. It resolves
// it by asking whether the prisoner holds a stack whose definition
// declares `ignitionSource: true`. That flag is what makes the
// cigarette-and-match dependency expressible without inventing a
// sixth capability key.
//
// WHY AFFORDANCES USE GENERAL VERBS
// ---------------------------------
// The catalogue does not carry LIGHT_CIGARETTE or OPEN_CAN. Objects
// declare which of a small general vocabulary they support, and the
// action definition declares what it needs. See
// Documentation/roadmaps&features/agency_phase_same_convo/
// action-credit_idea_exploration.md section 8.
//
// MUTABILITY
// ----------
// Every definition and every nested collection is frozen. This is a
// shared module-level constant read on every cycle; a caller that
// mutated it would silently change gating for the entire run.

/* ============================================================
   THE CATALOGUE
============================================================ */

const RESOURCE_DEFINITIONS = Object.freeze({

  /*
   * Cigarettes are the consumable half of the first dependency
   * pair. Consuming one requires ignition, which this object does
   * not supply.
   */
  cigarette: Object.freeze({
    definitionId: "cigarette",
    title: "Cigarette",
    stackable: true,
    consumable: true,
    ignitionSource: false,

    affordances: Object.freeze([
      "CONSUME",
      "TRANSFER",
      "HIDE",
      "REVEAL",
      "DESTROY"
    ]),

    requirements: Object.freeze({
      consume: Object.freeze({
        /*
         * `ignition` is a RESOURCE prerequisite. `handUse` and
         * `interactionReach` are CAPABILITY thresholds and are two
         * of the five keys produced by deriveCapabilities().
         */
        ignition: true,
        handUse: 0.5,
        interactionReach: 0.5
      })
    }),

    /*
     * Declared but NOT APPLIED in this slice. The slice is
     * derive-and-observe: it proves gating works and never mutates
     * the ledger. The resolver that reads these numbers is a later
     * slice. Recording them here documents the intended economy
     * without pretending it is live.
     */
    effects: Object.freeze({
      consume: Object.freeze({
        suffering: -2,
        stability: 1
      })
    })
  }),

  /*
   * Matches are the enabling half of the pair: a prisoner may hold
   * cigarettes and still be unable to smoke. Striking a match is
   * deliberately NOT a separate action - SMOKE consumes one
   * cigarette and one ignition use together.
   */
  match: Object.freeze({
    definitionId: "match",
    title: "Match",
    stackable: true,
    consumable: true,
    ignitionSource: true,

    affordances: Object.freeze([
      "IGNITE",
      "TRANSFER",
      "HIDE",
      "REVEAL",
      "DESTROY"
    ]),

    requirements: Object.freeze({
      ignite: Object.freeze({
        handUse: 0.5,
        interactionReach: 0.5
      })
    }),

    effects: Object.freeze({})
  })
});

/* ============================================================
   ACCESSORS
============================================================ */

/*
 * Look up one definition by id.
 *
 * Returns `null` for an unknown id rather than `undefined` or
 * throwing, so a caller probing for a definition gets an expected
 * "no such resource" condition instead of an exception.
 */
export function getResourceDefinition(definitionId) {
  if (typeof definitionId !== "string") {
    return null;
  }

  if (!Object.prototype.hasOwnProperty.call(
    RESOURCE_DEFINITIONS,
    definitionId
  )) {
    return null;
  }

  return RESOURCE_DEFINITIONS[definitionId];
}

/*
 * Every known resource definition id.
 *
 * A fresh array each call so a consumer that sorts or splices the
 * result cannot reorder the shared catalogue.
 */
export function getAllResourceDefinitionIds() {
  return Object.keys(RESOURCE_DEFINITIONS);
}

export { RESOURCE_DEFINITIONS };