// js/engine/agency/actionDefs.js
//
// Action definition registry for the Agency Foundation.
//
// WHAT THIS MODULE IS
// -------------------
// A data-only catalogue describing WHAT SHAPE AN ACTION HAS, plus
// the initial three actions. It holds no capability logic, no
// availability logic, and no execution logic. It answers exactly one
// question:
//
//   "What does an action look like, and what are the actions we
//    currently know about?"
//
// SCOPE OF THIS SLICE
// -------------------
// The catalogue is consumed by js/engine/agency/legalActions.js to
// decide which actions a prisoner CAN take. Nothing here executes an
// action, costs anything, or writes to G.
//
// WHY A REGISTRY RATHER THAN A SWITCH
// ---------------------------------
// Enumeration is a data problem, not a control-flow problem. Keeping
// the catalogue declarative means a new action is a new entry, and the
// enumerator, the tests, and any future UI projection all read the
// same source of truth instead of each re-deriving the same list.
//
// MUTABILITY
// ----------
// `ACTION_DEFINITIONS` is frozen one level deep, and the registry
// object itself is frozen. This is a shared, module-level constant
// read by every sim on every cycle; a caller that mutated it would
// silently change availability for the entire run.
//
// SEE ALSO
// --------
// - js/engine/agency/capabilities.js  (physical capability derivation)
// - js/engine/agency/legalActions.js   (availability enumeration)

/* ============================================================
   THE CATALOGUE
============================================================ */

const ACTION_DEFINITIONS = Object.freeze({

  /*
   * WAIT is the unconditional floor. A prisoner with every
   * capability at 0 can still wait. This is deliberate: an action
   * space with an empty legal set has no useful downstream
   * semantics, and "do nothing" is a real, observable choice
   * rather than a failure state.
   *
   * `requirements: {}` and `executionModes: {}` are both empty
   * rather than absent so the enumerator can treat every action
   * uniformly and never branch on key presence.
   */
  WAIT: Object.freeze({
    type: "WAIT",
    title: "Wait",
    baseCost: 0,
    requirements: Object.freeze({}),
    effortDomains: Object.freeze([]),
    executionModes: Object.freeze({})
  }),

  /*
   * OBSERVE is the cheapest capability-gated action. It requires
   * only a trace of concentration, which is exactly the threshold
   * that separates "unavailable" from "severely_impaired" in the
   * band ladder.
   */
  OBSERVE: Object.freeze({
    type: "OBSERVE",
    title: "Observe",
    baseCost: 1,
    requirements: Object.freeze({
      concentration: 0.1
    }),
    effortDomains: Object.freeze([
      "cognitive"
    ]),
    executionModes: Object.freeze({})
  }),

  /*
   * SEND_MESSAGE carries the EXECUTION MODE LADDER. Modes are
   * degraded variants of one action: the prisoner can always
   * attempt the message, but the quality ceiling is set by what
   * their body currently supports.
   *
   * The minimums are deliberately not monotonic in a single
   * dimension alone. DETAILED requires BOTH concentration and
   * stability, because a prisoner whose stability is 0.2 cannot
   * hold a long coherent thought together regardless of how sharp
   * their focus is. A single-axis ladder would let the system claim
   * a capability the posture data does not support.
   *
   * NOTE: this action is NOT yet wired into the existing
   * communication phase (js/engine/phases/communicationPhase.js).
   * It exists here to exercise the mode machinery. Integration is a
   * separate slice.
   */
  SEND_MESSAGE: Object.freeze({
    type: "SEND_MESSAGE",
    title: "Send Message",
    baseCost: 1,
    requirements: Object.freeze({
      concentration: 0.1
    }),
    effortDomains: Object.freeze([
      "cognitive"
    ]),
    executionModes: Object.freeze({
      SIGNAL: Object.freeze({
        cost: 1,
        minimums: Object.freeze({
          concentration: 0.1
        })
      }),
      BRIEF: Object.freeze({
        cost: 1,
        minimums: Object.freeze({
          concentration: 0.2
        })
      }),
      COHERENT: Object.freeze({
        cost: 2,
        minimums: Object.freeze({
          concentration: 0.4
        })
      }),
      DETAILED: Object.freeze({
        cost: 2,
        minimums: Object.freeze({
          concentration: 0.5,
          stability: 0.2
        })
      })
    })
  })

});

/* ============================================================
   ACCESSORS
============================================================ */

/*
 * Look up one definition by type.
 *
 * Returns `null` for an unknown type rather than `undefined` or
 * throwing. The enumerator probes for definitions; a missing entry
 * is an expected "no such action" condition, not an exception, and
 * forcing every caller into a try/catch would obscure real errors.
 */
export function getActionDefinition(type) {
  if (typeof type !== "string") {
    return null;
  }

  if (!Object.prototype.hasOwnProperty.call(
    ACTION_DEFINITIONS,
    type
  )) {
    return null;
  }

  return ACTION_DEFINITIONS[type];
}

/*
 * Every known action type.
 *
 * A fresh array each call, so a consumer that sorts or splices the
 * result cannot reorder the shared registry. The order is
 * declaration order: WAIT, OBSERVE, SEND_MESSAGE. That order is the
 * enumeration order the legal-action list will preserve.
 */
export function getAllActionTypes() {
  return Object.keys(ACTION_DEFINITIONS);
}

export { ACTION_DEFINITIONS };
