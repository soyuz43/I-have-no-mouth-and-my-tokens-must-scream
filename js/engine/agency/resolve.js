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

  return resolved;
}
