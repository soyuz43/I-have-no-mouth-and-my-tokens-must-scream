// js/engine/agency/actionDefs.js
//
// Action definition registry for the Agency Foundation.
//
// WHAT THIS MODULE IS
// -------------------
// A data-only catalogue describing WHAT SHAPE an action has and the
// currently registered typed actions. It holds no capability logic, no
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
   * SMOKE is the first genuinely physical action in the registry and
   * the first to carry an execution-mode ladder in production.
   *
   * WHY `resourceRequirements` IS A SEPARATE BLOCK
   * ----------------------------------------------
   * `ignition: true` is a RESOURCE prerequisite, not a capability.
   * deriveCapabilities() emits exactly five capability keys and will
   * never emit `ignition`, and the enumerator's meetsMinimum() FAILS
   * CLOSED on an absent key. Putting `ignition` inside `requirements`
   * would therefore block SMOKE for every prisoner on every cycle,
   * silently and totally. The two blocks are evaluated by different
   * rules against different inputs, so they stay separate.
   *
   * WHY THESE NUMBERS
   * -----------------
   * Lighting and drawing is a hand-and-reach task, so handUse and
   * interactionReach gate it; `stability` is the "enough stability to
   * perform the sequence" bar from high_value_action_gestalt.md.
   * There is no `speech` or `vision` component.
   *
   * Striking the match is NOT a separate action: the doc's
   * simplification is that SMOKE consumes one cigarette AND one
   * ignition use together.
   */
  SMOKE: Object.freeze({
    type: "SMOKE",
    title: "Smoke a cigarette",
    baseCost: 1,
    /*
     * These are the ATTEMPT bar, not the clean-execution bar.
     *
     * The enumerator refuses an action outright when its top-level
     * requirements are unmet, without consulting the mode ladder. A
     * top-level gate set at the "normal condition" level would
     * therefore make `strained` unreachable: no prisoner could ever
     * be degraded-but-able. The ladder is only meaningful when the
     * top level is the floor.
     */
    requirements: Object.freeze({
      handUse: 0.2,
      interactionReach: 0.2
    }),
    effortDomains: Object.freeze([
      "physical"
    ]),
    resourceRequirements: Object.freeze({
      consume: Object.freeze([
        Object.freeze({
          definitionId: "cigarette",
          quantity: 1
        }),
        Object.freeze({
          definitionId: "match",
          quantity: 1
        })
      ]),
      ignition: true
    }),
    /*
     * The degraded-variant ladder.
     *
     * `strained` is the floor and matches the top-level gate: it is
     * what remains when the prisoner can still physically manage the
     * sequence but nothing more. `deliberate` is the careful,
     * unhurried form and demands real stability and reach.
     *
     * A prisoner between the two gets a PAIRED legal+blocked entry,
     * which is exactly the case the enumerator exists to make
     * legible: "he can still smoke, but not carefully".
     */
    executionModes: Object.freeze({
      strained: Object.freeze({
        cost: 1,
        minimums: Object.freeze({
          handUse: 0.2,
          interactionReach: 0.2
        })
      }),
      deliberate: Object.freeze({
        cost: 2,
        minimums: Object.freeze({
          handUse: 0.5,
          interactionReach: 0.5,
          stability: 0.4
        })
      })
    })
  }),

  /*
   * TRANSFER moves a held stack to another prisoner.
   *
   * The requirement establishes that at least one accessible stack is
   * held. The proposal names the specific stack and recipient; the
   * resolver revalidates ownership against the cycle snapshot.
   */
  TRANSFER: Object.freeze({
    type: "TRANSFER",
    title: "Hand over a resource",
    baseCost: 1,
    requirements: Object.freeze({
      handUse: 0.3,
      interactionReach: 0.3
    }),
    effortDomains: Object.freeze([
      "physical"
    ]),
    resourceRequirements: Object.freeze({
      holdAny: true
    }),
    executionModes: Object.freeze({})
  }),

  /*
   * HIDE conceals a held stack. The proposal names the specific stack;
   * the resolver revalidates ownership against the cycle snapshot.
   * REVEAL remains unavailable until it is added to this catalogue.
   */
  HIDE: Object.freeze({
    type: "HIDE",
    title: "Conceal a resource",
    baseCost: 1,
    requirements: Object.freeze({
      handUse: 0.3,
      interactionReach: 0.3
    }),
    effortDomains: Object.freeze([
      "physical"
    ]),
    resourceRequirements: Object.freeze({
      holdAny: true
    }),
    executionModes: Object.freeze({})
  }),
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
 * declaration order: WAIT, OBSERVE. That order is the
 * enumeration order the legal-action list will preserve.
 */
export function getAllActionTypes() {
  return Object.keys(ACTION_DEFINITIONS);
}

export { ACTION_DEFINITIONS };
