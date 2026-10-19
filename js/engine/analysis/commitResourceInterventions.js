import { timelineEvent } from "../../ui/timeline.js";
import { validateResourceIntervention } from "./resourceInterventions.js";

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

function applyLedgerMutation(instances, instance, intervention, cycle, index) {
  const previousHolderId = instance.holderId ?? null;
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
  const committed = [];
  const rejected = [];

  for (const [index, proposed] of proposedInterventions.entries()) {
    const validation = validateResourceIntervention(proposed, {
      resources: { instances: stagedInstances },
      sims: G.sims
    });

    if (!validation.valid) {
      rejected.push({ index, reason: validation.reason, intervention: proposed });
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

    committed.push({ ...intervention, ...event, affectedPrisoners });
  }

  G.resources.instances = stagedInstances;
  G.pendingEvidence ??= {};
  G.pendingEvidence.resourceInterventions = stagedEvidence;

  for (const intervention of committed) {
    const summary =
      `${intervention.interventionType} ${intervention.resourceId}` +
      ` cycle=${intervention.cycle}` +
      ` affected=${intervention.affectedPrisoners.join(",") || "none"}`;
    console.debug(`[AM RESOURCE INTERVENTION] ${summary}`);
    timelineEvent(`// AM RESOURCE INTERVENTION — ${summary}`);
  }

  return { committed, rejected };
}
