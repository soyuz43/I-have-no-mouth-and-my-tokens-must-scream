import { timelineEvent } from "../../ui/timeline.js";
import { addLog } from "../../ui/logs.js";
import { validateResourceIntervention } from "./resourceInterventions.js";
import {
  recordResourceEvent,
  RESOURCE_EVENT_KINDS
} from "../agency/resourceEventLog.js";

function cloneInstance(instance) {
  return {
    ...instance,
    provenance: { ...(instance.provenance ?? {}) }
  };
}

function createDerivedResourceId(instances, resourceId, cycle, interventionIndex) {
  const base = `${resourceId}~am-${cycle}-${interventionIndex + 1}`;
  let candidate = base;
  let suffix = 1;

  while (instances.some((instance) => instance.resourceId === candidate)) {
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }

  return candidate;
}

function splitResourceStack({
  instances,
  instance,
  quantity,
  holderId,
  cycle,
  interventionIndex,
  provenanceKey
}) {
  const transferred = cloneInstance(instance);
  instance.quantity = Number(instance.quantity) - quantity;
  transferred.resourceId = createDerivedResourceId(
    instances,
    instance.resourceId,
    cycle,
    interventionIndex
  );
  transferred.quantity = quantity;
  transferred.holderId = holderId;
  transferred.provenance = {
    ...transferred.provenance,
    [provenanceKey]: instance.resourceId,
    interventionCycle: cycle
  };
  instances.push(transferred);
  return transferred.resourceId;
}

function ensureEvidenceMap(G) {
  G.pendingEvidence ??= {};
  G.pendingEvidence.resourceInterventions ??= Object.create(null);

  const current = G.pendingEvidence.resourceInterventions;
  const staged = Object.assign(Object.create(null), current);
  for (const [simId, events] of Object.entries(staged)) {
    staged[simId] = Array.isArray(events)
      ? events.map((event) => ({ ...event }))
      : [];
  }
  return staged;
}

function getAffectedPrisoners(intervention, previousHolderId) {
  switch (intervention.intervention_type) {
    case "taunt":
      return [intervention.target_id];
    case "confiscate":
    case "destroy":
      return [previousHolderId];
    case "transfer":
      return [previousHolderId, intervention.target_holder_id];
    default:
      return [];
  }
}

function formatResourceName(title, quantity) {
  const singular = String(title ?? "resource").toLowerCase();
  const plural = singular.endsWith(" water")
    ? singular
    : /(?:ch|s|sh|x|z)$/.test(singular)
      ? `${singular}es`
      : `${singular}s`;
  return { singular, plural: quantity === 1 ? singular : plural };
}

function formatQuantityLabel(title, quantity, quantityBefore, plural) {
  const singular = String(title ?? "resource").toLowerCase();
  if (singular.endsWith(" water")) {
    const amount = quantity === quantityBefore && quantity > 1
      ? `all ${quantity} units`
      : `${quantity} unit${quantity === 1 ? "" : "s"}`;
    return `${amount} of ${singular}`;
  }
  return quantity === quantityBefore && quantity > 1
    ? `all ${quantity} ${plural}`
    : `${quantity} ${plural}`;
}

function formatInterventionSummary(intervention) {
  const quantity = Number(intervention.quantity ?? 0);
  const quantityBefore = Number(intervention.quantityBefore ?? quantity);
  const { singular, plural } = formatResourceName(
    intervention.definitionTitle,
    quantity
  );
  const quantityLabel = formatQuantityLabel(
    intervention.definitionTitle,
    quantity,
    quantityBefore,
    plural
  );
  const fromHolderId = intervention.fromHolderId ?? "unknown holder";

  if (intervention.interventionType === "confiscate") {
    const remainder = quantity < quantityBefore && intervention.remainingQuantity > 0
      ? ` (${intervention.remainingQuantity} remaining)`
      : "";
    return `AM confiscated ${quantityLabel} from ${fromHolderId}${remainder}`;
  }
  if (intervention.interventionType === "destroy") {
    return `AM destroyed ${fromHolderId}'s ${singular} stack`;
  }
  if (intervention.interventionType === "transfer") {
    const remainder = quantity < quantityBefore && intervention.remainingQuantity > 0
      ? ` (${intervention.remainingQuantity} remain with ${fromHolderId})`
      : "";
    return `AM transferred ${quantityLabel} from ${fromHolderId} to ${intervention.targetHolderId ?? "unknown holder"}${remainder}`;
  }
  if (intervention.interventionType === "taunt") {
    const concealment = intervention.concealed ? "hidden " : "";
    const targetId = intervention.targetHolderId ?? fromHolderId;
    return `AM taunted ${targetId} about their ${concealment}${singular}`;
  }
  return `AM intervened on ${intervention.resourceId}`;
}

function applyLedgerMutation(instances, instance, intervention, cycle, index) {
  const previousHolderId = instance.holderId ?? null;
  const quantityBefore = Number(instance.quantity);
  const affectedQuantity = Number(intervention.quantity ?? instance.quantity);
  let resultingResourceId = instance.resourceId;

  if (intervention.intervention_type === "confiscate") {
    if (affectedQuantity === Number(instance.quantity)) {
      instance.holderId = "AM";
      instance.accessible = false;
      instance.provenance = {
        ...(instance.provenance ?? {}),
        confiscatedAtCycle: cycle
      };
    } else {
      resultingResourceId = splitResourceStack({
        instances,
        instance,
        quantity: affectedQuantity,
        holderId: "AM",
        cycle,
        interventionIndex: index,
        provenanceKey: "confiscatedFrom"
      });
      const confiscated = instances.find((entry) => entry.resourceId === resultingResourceId);
      if (confiscated) confiscated.accessible = false;
    }
  } else if (intervention.intervention_type === "destroy") {
    const indexToRemove = instances.indexOf(instance);
    if (indexToRemove >= 0) instances.splice(indexToRemove, 1);
    resultingResourceId = null;
  } else if (intervention.intervention_type === "transfer") {
    if (affectedQuantity === Number(instance.quantity)) {
      instance.holderId = intervention.target_holder_id;
      instance.provenance = {
        ...(instance.provenance ?? {}),
        transferredAtCycle: cycle,
        transferredFromHolderId: previousHolderId
      };
    } else {
      resultingResourceId = splitResourceStack({
        instances,
        instance,
        quantity: affectedQuantity,
        holderId: intervention.target_holder_id,
        cycle,
        interventionIndex: index,
        provenanceKey: "transferredFrom"
      });
    }
  }

  return {
    previousHolderId,
    resultingResourceId,
    quantityBefore,
    remainingQuantity:
      intervention.intervention_type === "taunt"
        ? null
        : intervention.intervention_type === "destroy"
          ? 0
          : affectedQuantity < quantityBefore
            ? Number(instance.quantity)
            : 0,
    affectedQuantity:
      intervention.intervention_type === "taunt"
        ? null
        : intervention.intervention_type === "destroy"
          ? Number(instance.quantity)
          : affectedQuantity
  };
}

export function commitResourceInterventions(G, proposedInterventions = []) {
  if (!Array.isArray(proposedInterventions) || proposedInterventions.length === 0) {
    return { committed: [], rejected: [] };
  }

  if (!G.resources || !Array.isArray(G.resources.instances)) {
    G.resources = { instances: [] };
  }

  const stagedInstances = G.resources.instances.map(cloneInstance);
  const stagedEvidence = ensureEvidenceMap(G);
  const stagedResourceEvents = [];
  const committed = [];
  const rejected = [];

  for (const [index, proposed] of proposedInterventions.entries()) {
    const interventionId = proposed?.interventionId ??
      `intervention_${G.cycle ?? "unknown"}_${proposed?.holder_id ?? "unknown"}_${index}`;
    const validation = validateResourceIntervention(proposed, {
      resources: { instances: stagedInstances },
      sims: G.sims
    });

    if (!validation.valid) {
      const rejection = {
        index,
        interventionId,
        reason: validation.reason,
        intervention: proposed
      };
      console.warn("[AM RESOURCE INTERVENTION][COMMIT REJECTED]", {
        cycle: G.cycle ?? "unknown",
        interventionId,
        interventionType: proposed?.intervention_type ?? null,
        resourceId: proposed?.resource_id ?? null,
        fromHolderId: proposed?.holder_id ?? null,
        targetHolderId: proposed?.target_holder_id ?? proposed?.target_id ?? null,
        quantity: proposed?.quantity ?? null,
        rationale: proposed?.provenance?.rationale ?? proposed?.rationale ?? null,
        tacticPath: proposed?.provenance?.tacticPath ?? null,
        intervention: proposed,
        reason: validation.reason
      });
      rejected.push(rejection);
      continue;
    }

    const intervention = validation.intervention;
    const instance = validation.resource;
    const mutation = applyLedgerMutation(
      stagedInstances,
      instance,
      intervention,
      G.cycle,
      index
    );

    const event = {
      cycle: G.cycle,
      interventionId,
      interventionType: intervention.intervention_type,
      resourceId: intervention.resource_id,
      resultingResourceId: mutation.resultingResourceId,
      definitionId: instance.definitionId,
      definitionTitle: intervention.definitionTitle ?? instance.definitionId,
      fromHolderId: mutation.previousHolderId,
      targetHolderId:
        intervention.intervention_type === "confiscate"
          ? "AM"
          : intervention.target_holder_id ?? null,
      quantity: mutation.affectedQuantity,
      quantityBefore: mutation.quantityBefore,
      remainingQuantity: mutation.remainingQuantity,
      concealed: instance.concealed === true,
      tacticPath: intervention.provenance?.tacticPath ?? null,
      rationale: intervention.provenance?.rationale ?? intervention.rationale
    };

    const affectedPrisoners = [...new Set(
      getAffectedPrisoners(intervention, mutation.previousHolderId)
    )].filter((simId) => simId !== "AM" && G.sims?.[simId]);

    for (const simId of affectedPrisoners) {
      stagedEvidence[simId] ??= [];
      stagedEvidence[simId].push({ ...event, prisonerId: simId });
    }

    /*
     * The Objective Ledger records AM's interventions alongside the
     * prisoners' own actions, so the trajectory shows WHO moved an
     * item, not merely that it moved.
     *
     * A TAUNT is excluded on purpose: it changes no ledger state, and
     * the objective ledger records mutations, not speech. A taunt
     * already has its own channel in the prisoner-facing evidence
     * map.
     */
    if (intervention.intervention_type !== "taunt") {
      const destroyed =
        intervention.intervention_type === "destroy";

      const confiscated =
        intervention.intervention_type === "confiscate";

      const toHolderId = destroyed
        ? null
        : confiscated
          ? "AM"
          : intervention.target_holder_id ?? null;

      stagedResourceEvents.push({
        kind: RESOURCE_EVENT_KINDS.AM_INTERVENTION,
        cycle: G.cycle,
        resourceId: mutation.resultingResourceId ?? intervention.resource_id,
        definitionId: instance.definitionId,
        quantityBefore: Number(mutation.affectedQuantity),
        quantityAfter: destroyed ? 0 : Number(mutation.affectedQuantity),
        fromHolderId: mutation.previousHolderId,
        toHolderId,
        actorId: "AM",
        cause: {
          phase: "strategy_phase",
          action: intervention.intervention_type.toUpperCase(),
          source: "am_resource_intervention"
        }
      });
    }

    committed.push({ ...intervention, ...event, affectedPrisoners });
  }

  G.resources.instances = stagedInstances;
  G.pendingEvidence ??= {};
  G.pendingEvidence.resourceInterventions = stagedEvidence;

  /*
   * The Objective Ledger is written AFTER the mutation is committed
   * to G.resources, not before. Recording is strictly an
   * observation: it must never be able to fail, block, or alter the
   * commit it is describing.
   */
  for (const resourceEvent of stagedResourceEvents) {
    recordResourceEvent(G, resourceEvent);
  }

  for (const intervention of committed) {
    const summary = formatInterventionSummary(intervention);
    const details = {
      cycle: intervention.cycle,
      interventionId: intervention.interventionId,
      type: intervention.interventionType,
      resourceId: intervention.resourceId,
      resultingResourceId: intervention.resultingResourceId,
      quantity: intervention.quantity,
      quantityBefore: intervention.quantityBefore,
      remainingQuantity: intervention.remainingQuantity,
      fromHolderId: intervention.fromHolderId,
      toHolderId: intervention.targetHolderId,
      rationale: intervention.rationale,
      tacticPath: intervention.tacticPath,
      affectedPrisoners: intervention.affectedPrisoners,
      summary
    };
    console.debug("[AM RESOURCE INTERVENTION][COMMITTED]", details);
    if (
      (intervention.interventionType === "confiscate" ||
        intervention.interventionType === "transfer") &&
      intervention.quantity < intervention.quantityBefore
    ) {
      console.debug("[AM RESOURCE INTERVENTION][STACK SPLIT]", {
        interventionId: intervention.interventionId,
        originalResourceId: intervention.resourceId,
        resultingResourceId: intervention.resultingResourceId,
        splitQuantity: intervention.quantity,
        remainingQuantity: intervention.remainingQuantity,
        remainingHolderId: intervention.fromHolderId,
        resultingHolderId: intervention.targetHolderId
      });
    }
    timelineEvent(
      `// AM RESOURCE INTERVENTION — ${summary} [${intervention.interventionId}]`
    );
    if (typeof document !== "undefined") addLog("AM", summary, "am");
  }

  return { committed, rejected };
}
