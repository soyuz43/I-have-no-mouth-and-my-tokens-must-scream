import { SIM_IDS } from "../../core/constants.js";
import { engineRng } from "../../core/prng.js";
import {
  ACTION_DEFINITIONS,
  SEARCH_COOLDOWN_CYCLES
} from "./actionDefs.js";
import { getResourceDefinition } from "./resourceDefs.js";
import { deriveCapabilities } from "./capabilities.js";

const SEARCH_SUCCESS_CHANCE = 0.35;

const MUTABLE_STATS = new Set([
  "hope",
  "sanity",
  "suffering"
]);

/*
 * The refusal reasons that mean "the thing you reached for is not
 * there".
 *
 * These are the ONLY refusals that can correct a belief. A refusal
 * for any other reason says something about the prisoner's BODY, their
 * budget, or the state of the world, and tells them nothing about
 * whether their memory of their own holdings was wrong.
 *
 * `transfer_resource_unavailable` is NOT in this set. It is produced
 * by the PROPOSAL VALIDATOR, not the resolver, and it means the
 * proposal was rejected before it was ever attempted — no reach
 * happened, so nothing was learned. The same is true of
 * `invalid_proposal`, `action_not_legal`, and `budget_exceeded`.
 *
 * `ignition_unavailable` is not in this set either. It means the
 * prisoner HAS the cigarette but lacks the match. That is a
 * possession fact about a different resource, not a correction of
 * the cigarette belief.
 */
const BELIEF_CORRECTING_REASONS = new Set([
  "resource_unavailable"
]);

function cloneValue(value) {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function findAvailableResource(instances, actorId, definitionId) {
  return instances
    .filter((instance) =>
      instance?.holderId === actorId &&
      instance.accessible === true &&
      instance.definitionId === definitionId &&
      Number(instance.quantity) > 0
    )
    .sort((left, right) =>
      compareText(left.resourceId, right.resourceId)
    )[0] ?? null;
}

function findActorResource(instances, actorId, resourceId) {
  return instances.find((instance) =>
    instance?.resourceId === resourceId &&
    instance.holderId === actorId &&
    instance.accessible === true &&
    Number(instance.quantity) > 0
  ) ?? null;
}

function collectEffects(actionType, operations) {
  const effects = {};
  const actionEffects = ACTION_DEFINITIONS[actionType]?.effects;

  for (const [stat, delta] of Object.entries(actionEffects ?? {})) {
    if (MUTABLE_STATS.has(stat) && Number.isFinite(Number(delta))) {
      effects[stat] = (effects[stat] ?? 0) + Number(delta);
    }
  }

  for (const operation of operations) {
    if (operation.kind !== "consume") continue;
    const definition = getResourceDefinition(operation.definitionId);
    const resourceEffects = definition?.effects?.consume ?? {};

    for (const [stat, delta] of Object.entries(resourceEffects)) {
      if (MUTABLE_STATS.has(stat) && Number.isFinite(Number(delta))) {
        effects[stat] = (effects[stat] ?? 0) + Number(delta);
      }
    }
  }

  return effects;
}

function meetsActionRequirements(actionType, sim) {
  const requirements = ACTION_DEFINITIONS[actionType]?.requirements ?? {};
  const capabilities = deriveCapabilities(sim).capabilities;
  return Object.entries(requirements).every(([key, minimum]) =>
    Number(capabilities[key]) >= Number(minimum)
  );
}

function normalizeProposals(proposals) {
  return (Array.isArray(proposals) ? proposals : [])
    .filter((proposal) => SIM_IDS.includes(proposal?.actorId))
    .map((proposal) => ({
      ...proposal,
      action: proposal?.action && typeof proposal.action === "object"
        ? { ...proposal.action }
        : { type: "WAIT" }
    }))
    .sort((left, right) => {
      const actorOrder = compareText(left.actorId, right.actorId);
      if (actorOrder !== 0) return actorOrder;
      return compareText(
        JSON.stringify(left.action),
        JSON.stringify(right.action)
      );
    });
}

/*
 * Mark a refusal as a BELIEF CORRECTION.
 *
 * A belief correction is a refusal with BOTH of these properties:
 *
 *   1. The reason says the thing was not there. Only
 *      `resource_unavailable` qualifies; a capability refusal, a
 *      budget refusal, or a conflict says nothing about whether the
 *      prisoner's memory of their holdings was wrong.
 *
 *   2. The prisoner was reaching for something they BELIEVED they
 *      held. The objective snapshot cannot tell the resolver this,
 *      so the proposal carries it.
 *
 * When both hold, the refusal is the prisoner learning their memory
 * was wrong, and the commit path writes the correction.
 *
 * The marker is placed on `provenance` rather than at the top level
 * of the resolution because `provenance` is the part of the
 * resolution that is RECORDED on the agency event and exported. The
 * correction is a fact about the event, so it belongs there.
 */
function markBeliefCorrection(resolution, proposal) {
  const reason = resolution.reason;

  if (!BELIEF_CORRECTING_REASONS.has(reason)) return false;

  const believed = Array.isArray(proposal?.believedResources)
    ? proposal.believedResources
    : [];

  if (believed.length === 0) return false;

  /*
   * A proposal that NAMES a resource reached for that specific
   * stack, so only the belief about THAT stack can be corrected by
   * the refusal. A proposal that names no resource (SMOKE) draws on
   * a set of definitions, so any of the believed stacks can be the
   * one that was missing.
   */
  const namedResourceId = resolution.action?.resourceId ?? null;

  const candidates = namedResourceId
    ? believed.filter((entry) => entry?.resourceId === namedResourceId)
    : believed;

  if (candidates.length === 0) return false;

  /*
   * A refusal can name a definition the resolver knows was missing
   * (`missingDefinitionIds`). When it does, that definition WINS.
   *
   * The proposal's believed definition is the definition the
   * prisoner THINKS the stack holds. The resolver's is the
   * definition the resource MUST hold for the action to work. When
   * they disagree, the prisoner reached for the wrong sort of thing
   * entirely, and correcting their belief about it would be a lie:
   * they were not wrong that they held a cigarette, they were
   * wrong that it was drinkable.
   *
   * So a mismatch is not a belief correction and writes nothing.
   */
  const missing = Array.isArray(resolution.provenance?.missingDefinitionIds)
    ? resolution.provenance.missingDefinitionIds
    : [];

  if (
    missing.length > 0 &&
    !candidates.some((entry) => missing.includes(entry.definitionId))
  ) {
    return false;
  }

  /*
   * Several beliefs can be wrong at once, and one refusal only
   * proves ONE of them wrong. When the resolver named the missing
   * definition, that is the one to correct. When it did not, the
   * refusal was against a specific stack, so that stack's belief is
   * the one to correct.
   */
  const target = missing.length > 0
    ? candidates.find((entry) => missing.includes(entry.definitionId))
    : candidates[0];

  if (!target?.definitionId) return false;

  resolution.provenance.beliefCorrection = {
    resourceId: target.resourceId ?? null,
    definitionId: target.definitionId,
    claimed: Number(target.claimed) || 0
  };

  return true;
}

function resolveOne(proposal, snapshot, claims, cycle) {
  const { actorId, accepted, action } = proposal;
  const actionType = typeof action.type === "string" ? action.type : "WAIT";
  const base = {
    actorId,
    action,
    cost: Number(proposal.cost) || 0,
    status: "success",
    reason: null,
    operations: [],
    effects: {},
    provenance: {
      source: actionType === "WAIT" && accepted === true
        ? "agency_proposal"
        : "agency_resolver",
      proposalAccepted: accepted === true,
      requestedType: proposal.requestedType ?? actionType,
      validationReason: proposal.reason ?? null
    }
  };

  if (accepted === false && actionType !== "WAIT") {
    base.action = { type: "WAIT" };
    base.reason = proposal.reason ?? "invalid_proposal";
    base.provenance.requestedType = proposal.requestedType ?? null;
    base.provenance.source = "agency_resolver";
    return base;
  }

  if (actionType === "WAIT" || actionType === "OBSERVE") {
    return base;
  }

  if (actionType === "SEARCH") {
    const sim = snapshot.sims?.[actorId];
    if (!meetsActionRequirements(actionType, sim)) {
      base.status = "blocked";
      base.reason = "capability_below_minimum";
      return base;
    }

    const lastSearch = sim.lastSearchCycle ?? -999;
    if (
      Number(cycle ?? snapshot.cycle) - Number(lastSearch) <
      SEARCH_COOLDOWN_CYCLES
    ) {
      base.status = "blocked";
      base.reason = "search_cooldown";
      return base;
    }

    base.provenance.searchAttempted = true;
    const roll = engineRng.next();
    if (roll >= SEARCH_SUCCESS_CHANCE) {
      base.reason = "environment_unyielding";
      return base;
    }

    const resourceRoll = engineRng.next();
    let definitionId;
    let quantity = 1;
    if (resourceRoll < 0.55) {
      definitionId = "cigarette";
    } else if (resourceRoll <= 0.85) {
      definitionId = "wet_cigarette";
    } else {
      definitionId = "match";
      if (engineRng.next() > 0.7) quantity = 2;
    }

    base.operations = [{ type: "find", definitionId, quantity }];
    return base;
  }

  if (actionType === "CONSUME") {
    const sim = snapshot.sims?.[actorId];
    if (!meetsActionRequirements(actionType, sim)) {
      base.status = "blocked";
      base.reason = "capability_below_minimum";
      return base;
    }

    const requirement = ACTION_DEFINITIONS.CONSUME.resourceRequirements
      ?.consume?.[0];
    const instance = findActorResource(
      snapshot.resources.instances,
      actorId,
      action.resourceId
    );
    const definition = getResourceDefinition(instance?.definitionId);
    if (
      !requirement ||
      instance?.definitionId !== requirement.definitionId ||
      Number(instance.quantity) < Number(requirement.quantity) ||
      definition?.consumable !== true ||
      !definition.affordances.includes("CONSUME")
    ) {
      base.status = "blocked";
      base.reason = "resource_unavailable";

      /*
       * The definition the prisoner was MISSING is recorded when the
       * resource is absent altogether. That is the definition the
       * refusal is evidence about, so it is the definition a belief
       * correction would have to converge.
       *
       * A resource that EXISTS but is the wrong kind of thing is a
       * different situation: nothing is missing, so nothing is
       * learned about the prisoner's memory of their holdings.
       */
      if (!instance && requirement?.definitionId) {
        base.provenance.missingDefinitionIds = [requirement.definitionId];
      }

      return base;
    }

    const operations = [{
      kind: "consume",
      resourceId: instance.resourceId,
      definitionId: instance.definitionId,
      quantity: Number(requirement.quantity)
    }];
    if (hasResourceConflict(operations, snapshot, claims)) {
      base.status = "blocked";
      base.reason = "conflict";
      return base;
    }
    reserveResources(operations, claims);
    base.operations = operations;
    base.effects = collectEffects(actionType, operations);
    return base;
  }

  if (actionType === "SMOKE") {
    const requirements =
      ACTION_DEFINITIONS.SMOKE?.resourceRequirements?.consume ?? [];
    const operations = [];

    for (const requirement of requirements) {
      const instance = findAvailableResource(
        snapshot.resources.instances,
        actorId,
        requirement.definitionId
      );
      const quantity = Number(requirement.quantity) || 0;
      if (!instance || quantity <= 0) {
        base.status = "blocked";
        base.reason = "resource_unavailable";

        /*
         * SMOKE draws on a LIST of definitions, so the refusal has
         * to say WHICH one was missing. The requirement that failed
         * is the one the prisoner's memory was wrong about.
         */
        const missingDefinitionIds = Array.isArray(
          base.provenance.missingDefinitionIds
        )
          ? base.provenance.missingDefinitionIds
          : [];

        if (requirement.definitionId) {
          missingDefinitionIds.push(requirement.definitionId);
        }

        base.provenance.missingDefinitionIds = missingDefinitionIds;

        return base;
      }
      operations.push({
        kind: "consume",
        resourceId: instance.resourceId,
        definitionId: instance.definitionId,
        quantity
      });
    }

    if (ACTION_DEFINITIONS.SMOKE?.resourceRequirements?.ignition === true) {
      const hasIgnition = snapshot.resources.instances.some((instance) =>
        instance?.holderId === actorId &&
        instance.accessible === true &&
        getResourceDefinition(instance.definitionId)?.ignitionSource === true &&
        Number(instance.quantity) > 0
      );
      if (!hasIgnition) {
        base.status = "blocked";
        base.reason = "ignition_unavailable";
        return base;
      }
    }

    if (hasResourceConflict(operations, snapshot, claims)) {
      base.status = "blocked";
      base.reason = "conflict";
      return base;
    }

    reserveResources(operations, claims);
    base.operations = operations;
    base.effects = collectEffects(actionType, operations);
    return base;
  }

  if (actionType === "TRANSFER") {
    const instance = findActorResource(
      snapshot.resources.instances,
      actorId,
      action.resourceId
    );
    if (
      !instance ||
      !SIM_IDS.includes(action.targetId) ||
      action.targetId === actorId
    ) {
      base.status = "blocked";
      base.reason = "transfer_unavailable";
      return base;
    }

    const operations = [{
      kind: "transfer",
      resourceId: instance.resourceId,
      definitionId: instance.definitionId,
      quantity: 1,
      targetId: action.targetId
    }];
    if (hasResourceConflict(operations, snapshot, claims)) {
      base.status = "blocked";
      base.reason = "conflict";
      return base;
    }
    reserveResources(operations, claims);
    base.operations = operations;
    base.provenance.targetId = action.targetId;
    return base;
  }

  if (actionType === "HIDE" || actionType === "REVEAL") {
    const instance = findActorResource(
      snapshot.resources.instances,
      actorId,
      action.resourceId
    );
    const desiredConcealment = actionType === "HIDE";
    if (!instance || instance.concealed === desiredConcealment) {
      base.status = "blocked";
      base.reason = instance ? "resource_already_in_state" : "resource_unavailable";
      return base;
    }

    const operations = [{
      kind: "conceal",
      resourceId: instance.resourceId,
      definitionId: instance.definitionId,
      quantity: Number(instance.quantity),
      concealed: desiredConcealment
    }];
    if (hasResourceConflict(operations, snapshot, claims)) {
      base.status = "blocked";
      base.reason = "conflict";
      return base;
    }
    reserveResources(operations, claims);
    base.operations = operations;
    return base;
  }

  base.status = "blocked";
  base.reason = "action_not_implemented";
  return base;
}

function hasResourceConflict(operations, snapshot, claims) {
  for (const operation of operations) {
    const instance = snapshot.resources.instances.find(
      (candidate) => candidate?.resourceId === operation.resourceId
    );
    const available = Number(instance?.quantity) || 0;
    const claimed = claims.get(operation.resourceId) ?? 0;
    const requested = operation.kind === "conceal"
      ? available
      : operation.quantity;
    if (claimed + requested > available) return true;
  }
  return false;
}

function reserveResources(operations, claims) {
  for (const operation of operations) {
    const requested = operation.kind === "conceal"
      ? Number(operation.quantity)
      : Number(operation.quantity);
    claims.set(
      operation.resourceId,
      (claims.get(operation.resourceId) ?? 0) + requested
    );
  }
}

export function createAgencySnapshot(G) {
  const sims = {};
  for (const simId of SIM_IDS) {
    const sim = G?.sims?.[simId];
    if (!sim) continue;
    try {
      sims[simId] = cloneValue(sim);
    } catch {
      sims[simId] = null;
    }
  }

  let resources;
  try {
    resources = cloneValue(G?.resources ?? { instances: [] });
  } catch {
    resources = { instances: [] };
  }

  return {
    sims,
    resources,
    cycle: G?.cycle
  };
}

export function resolveAgencyActions({
  proposals,
  snapshot,
  cycle
}) {
  const safeSnapshot = snapshot ?? {
    sims: {},
    resources: { instances: [] }
  };
  const normalized = normalizeProposals(proposals);
  const claims = new Map();
  const resolved = [];

  for (const proposal of normalized) {
    if (!safeSnapshot.sims?.[proposal.actorId]) {
      resolved.push({
        actorId: proposal.actorId,
        action: { type: "WAIT" },
        cost: 0,
        status: "blocked",
        reason: "actor_unavailable",
        operations: [],
        effects: {},
        provenance: {
          source: "agency_resolver",
          proposalAccepted: false,
          requestedType: proposal.action?.type ?? null
        },
        cycle
      });
      continue;
    }
    resolved.push({
      ...resolveOne(proposal, safeSnapshot, claims, cycle),
      cycle
    });
  }

  /*
   * Mark every belief-correcting refusal.
   *
   * This runs AFTER resolution, over the whole batch, rather than at
   * each refusal site. The refusal sites know only why they refused;
   * they do not know whether the thing was something the prisoner
   * BELIEVED they held. Deciding it in one place means every
   * `resource_unavailable` refusal is treated identically, and a
   * future refusal site cannot forget to opt in.
   */
  for (let index = 0; index < resolved.length; index += 1) {
    const resolution = resolved[index];

    if (resolution?.status !== "blocked") continue;

    markBeliefCorrection(resolution, normalized[index]);
  }

  return resolved;
}
