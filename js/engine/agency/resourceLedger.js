// js/engine/agency/resourceLedger.js
//
// Authoritative resource ledger and the derived per-prisoner view.
//
// WHAT THIS MODULE IS
// -------------------
// Two things, deliberately separated:
//
//   1. The authoritative ledger: run-scoped, mutable by design, held
//      at G.resources. It says what exists and who holds it.
//   2. A derived, READ-ONLY view of that ledger for one prisoner,
//      rebuilt every cycle for the enumerator to gate against.
//
// The second exists so the enumerator never reads authoritative state
// directly. Inventory is a DERIVED VIEW over one resource table, not
// a field copied onto every sim - see
// Documentation/roadmaps&features/agency_phase_same_convo/
// best_action_roadmap_for_agecy_phase.md section 14.
//
// SCOPE OF THIS SLICE: DERIVE AND OBSERVE ONLY
// --------------------------------------------
// Mutation ownership lives in agency/commit.js. `buildResourceView()`
// remains a pure projection; `seedResources()` remains one-time
// initialization rather than a per-cycle reset.
//
// PURITY
// ------
// `buildResourceView()` is pure: no G read, no mutation of the
// ledger, no I/O, no nondeterministic random source. Same arguments in, structurally
// equal result out, every time.

import { getResourceDefinition } from "./resourceDefs.js";
import {
  recordResourceEvent,
  RESOURCE_EVENT_KINDS
} from "./resourceEventLog.js";

/* ============================================================
   LEDGER SHAPE
============================================================ */

/**
 * @typedef {Object} ResourceInstance
 * @property {string} resourceId      - Stable id, e.g. "cigarette_stack_01".
 * @property {string} definitionId    - Key into RESOURCE_DEFINITIONS.
 * @property {number} quantity        - Units in this stack.
 * @property {string|null} holderId   - SIM_ID, or null when unheld.
 * @property {string|null} locationId - Null in this slice: no location model yet.
 * @property {boolean} accessible     - False when out of reach or confiscated.
 * @property {boolean} concealed      - Hidden from others, not from the holder.
 * @property {Object} provenance      - { source: "scenario_seed" }.
 */

/* ============================================================
   INITIALIZATION
============================================================ */

/*
 * The first-slice inventory.
 *
 * Deliberately minimal and deliberately ASYMMETRIC: TED holds
 * cigarettes, ELLEN holds matches, and neither can smoke alone. That
 * is the complementary-resource dependency this slice exists to
 * prove. A symmetric seed would let every prisoner smoke and the
 * interesting gating path would never fire.
 */
const INITIAL_RESOURCES = Object.freeze([
  Object.freeze({
    resourceId: "cigarette_stack_01",
    definitionId: "cigarette",
    quantity: 3,
    holderId: "TED",
    locationId: null,
    accessible: true,
    concealed: false,
    provenance: Object.freeze({ source: "scenario_seed" })
  }),
  Object.freeze({
    resourceId: "match_stack_01",
    definitionId: "match",
    quantity: 2,
    holderId: "ELLEN",
    locationId: null,
    accessible: true,
    concealed: false,
    provenance: Object.freeze({ source: "scenario_seed" })
  })
]);

/*
 * A fresh ledger object.
 *
 * A factory rather than an inline literal so a reset can never be a
 * partial copy that silently drops a field added later.
 */
export function createResourceLedger() {
  return {
    instances: []
  };
}

/*
 * Populate a ledger with the first-slice inventory.
 *
 * ONE-TIME INITIALIZATION, called once at boot. It REPLACES the
 * instances array rather than appending, so a caller that invokes it
 * twice cannot silently double the world's cigarette supply - which
 * would quietly invalidate every scarcity measurement the slice is
 * meant to enable.
 *
 * Frozen seed entries are copied into fresh mutable objects: the
 * catalogue must stay immutable, but a future resolver has to be
 * able to decrement `quantity`.
 */
export function seedResources(ledger, state = null) {
  const target =
    ledger && typeof ledger === "object"
      ? ledger
      : createResourceLedger();

  if (!Array.isArray(target.instances)) {
    target.instances = [];
  }

  target.instances = INITIAL_RESOURCES.map((entry) => ({
    ...entry,
    provenance: { ...entry.provenance }
  }));

  /*
   * The Objective Ledger records the seed as an event, so the
   * history of the world starts with the world's own inventory
   * rather than with the first thing that happens to it.
   *
   * The state argument is optional: a caller that only holds a
   * bare ledger still gets a working ledger, it just gets no
   * history. Recording is strictly an observation of a mutation
   * that already happened.
   */
  if (state && typeof state === "object") {
    for (const instance of target.instances) {
      recordResourceEvent(state, {
        kind: RESOURCE_EVENT_KINDS.SEED,
        cycle: state.cycle,
        resourceId: instance.resourceId,
        definitionId: instance.definitionId,
        quantityBefore: 0,
        quantityAfter: instance.quantity,
        fromHolderId: null,
        toHolderId: instance.holderId,
        actorId: "ENGINE",
        cause: {
          phase: "boot",
          action: "SEED",
          source: "scenario_seed"
        }
      });
    }
  }

  return target;
}

/* ============================================================
   DERIVED VIEW
============================================================ */

/*
 * An empty view.
 *
 * Returned for a missing sim id or a malformed ledger so a caller
 * never has to null-check. `hasIgnition` is false and every
 * collection is empty, which is the fail-closed shape: a prisoner
 * with no readable ledger possesses nothing.
 */
function emptyResourceView() {
  return {
    simId: null,
    byDefinition: {},
    affordances: {},
    hasIgnition: false,
    stacks: []
  };
}

/*
 * Build the per-prisoner view the enumerator gates against.
 *
 * An instance counts toward `simId` only when:
 *
 *   holderId === simId  AND  accessible  AND  quantity > 0
 *
 * `concealed` is deliberately NOT a filter. A prisoner can use what
 * they have hidden; concealment restricts what OTHERS can observe,
 * which is a later slice's concern. Filtering on it here would make
 * HIDE self-defeating: the action would close itself the moment it
 * succeeded.
 *
 * An instance whose definitionId is unknown is SKIPPED. The engine
 * has no affordances or requirements for it, so admitting it would
 * let an unmodelled object satisfy a prerequisite it never declared.
 */
export function buildResourceView(ledger, simId) {
  if (typeof simId !== "string" || simId.length === 0) {
    return emptyResourceView();
  }

  const instances =
    ledger && Array.isArray(ledger.instances)
      ? ledger.instances
      : [];

  const stacks = [];
  const byDefinition = {};
  const affordances = {};
  let hasIgnition = false;

  for (const instance of instances) {
    if (!instance || typeof instance !== "object") {
      continue;
    }

    if (instance.holderId !== simId) {
      continue;
    }

    if (instance.accessible !== true) {
      continue;
    }

    const quantity = Number(instance.quantity);

    if (!Number.isFinite(quantity) || quantity <= 0) {
      continue;
    }

    const definition = getResourceDefinition(
      instance.definitionId
    );

    if (!definition) {
      continue;
    }

    stacks.push(instance);

    if (!Array.isArray(byDefinition[definition.definitionId])) {
      byDefinition[definition.definitionId] = [];
      affordances[definition.definitionId] = [
        ...definition.affordances
      ];
    }

    byDefinition[definition.definitionId].push(instance);

    if (definition.ignitionSource === true) {
      hasIgnition = true;
    }
  }

  return {
    simId,
    byDefinition,
    affordances,
    hasIgnition,
    stacks
  };
}

/*
 * Total accessible quantity of one definition held by a prisoner.
 *
 * Zero when they hold none, rather than null, because every caller
 * compares this against a numeric requirement.
 */
export function heldQuantity(view, definitionId) {
  const stacks =
    view &&
    view.byDefinition &&
    Array.isArray(view.byDefinition[definitionId])
      ? view.byDefinition[definitionId]
      : [];

  let total = 0;

  for (const stack of stacks) {
    const quantity = Number(stack?.quantity);

    if (Number.isFinite(quantity)) {
      total += quantity;
    }
  }

  return total;
}

export function maintainResourceDrying(G) {
  const instances = G?.resources?.instances;
  if (!Array.isArray(instances)) return;

  for (const instance of instances) {
    const dryingTurns = Number(instance?.dryingTurns);
    if (!Number.isFinite(dryingTurns) || dryingTurns <= 0) continue;

    instance.dryingTurns = Math.max(0, dryingTurns - 1);
    if (instance.dryingTurns !== 0) continue;

    const definitionIdBefore = instance.definitionId;
    instance.definitionId = "cigarette";
    delete instance.dryingTurns;

    /*
     * A dried cigarette is a DIFFERENT affordance set, not a smaller
     * stack: wet_cigarette cannot be consumed, cigarette can. That
     * transition is a ledger event, so the trajectory shows an item
     * becoming usable rather than silently changing identity.
     */
    recordResourceEvent(G, {
      kind: RESOURCE_EVENT_KINDS.DRYING,
      cycle: G?.cycle,
      resourceId: instance.resourceId,
      definitionId: instance.definitionId,
      quantityBefore: Number(instance.quantity),
      quantityAfter: Number(instance.quantity),
      fromHolderId: instance.holderId ?? null,
      toHolderId: instance.holderId ?? null,
      actorId: "ENGINE",
      cause: {
        phase: "ledger_maintenance",
        action: "DRIED",
        source: definitionIdBefore
      }
    });
  }
}
