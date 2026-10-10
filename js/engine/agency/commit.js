import { createAgencyEvent } from "./events.js";

const MUTABLE_STATS = new Set([
  "hope",
  "sanity",
  "suffering"
]);

function cloneInstance(instance) {
  return {
    ...instance,
    provenance: instance?.provenance && typeof instance.provenance === "object"
      ? { ...instance.provenance }
      : instance?.provenance
  };
}

function clampStat(value) {
  return Math.max(0, Math.min(100, value));
}

function applyOperation(instances, operation, eventId) {
  const instance = instances.find(
    (candidate) => candidate?.resourceId === operation.resourceId
  );
  if (!instance) return null;

  if (operation.kind === "consume") {
    instance.quantity = Math.max(
      0,
      Number(instance.quantity) - Number(operation.quantity)
    );
    return instance.resourceId;
  }

  if (operation.kind === "transfer") {
    const amount = Number(operation.quantity);
    if (Number(instance.quantity) === amount) {
      instance.holderId = operation.targetId;
      return instance.resourceId;
    }

    instance.quantity = Number(instance.quantity) - amount;
    const transferredResourceId = `${instance.resourceId}~${eventId}`;
    instances.push({
      ...cloneInstance(instance),
      resourceId: transferredResourceId,
      quantity: amount,
      holderId: operation.targetId,
      provenance: {
        ...(instance.provenance ?? {}),
        transferredFrom: instance.resourceId,
        eventId
      }
    });
    return transferredResourceId;
  }

  if (operation.kind === "conceal") {
    instance.concealed = operation.concealed;
    return instance.resourceId;
  }

  return null;
}

export function commitAgencyResolution(G, resolutions) {
  if (!G.resources || !Array.isArray(G.resources.instances)) {
    G.resources = { instances: [] };
  }
  if (!G.agency || !Array.isArray(G.agency.events)) {
    throw new TypeError("Agency state must contain an events array.");
  }

  const nextSequence = Number(G.agency.nextActionSequence) || 1;
  const stagedInstances = G.resources.instances.map(cloneInstance);
  const stagedStats = new Map();
  const stagedEvents = [];
  let sequence = nextSequence;

  for (const resolution of resolutions) {
    const event = createAgencyEvent(
      resolution,
      resolution.cycle ?? G.cycle,
      sequence
    );
    const committedResourceIds = [];

    if (resolution.status === "success") {
      for (const operation of resolution.operations ?? []) {
        const resourceId = applyOperation(
          stagedInstances,
          operation,
          event.eventId
        );
        if (resourceId) committedResourceIds.push(resourceId);
      }

      const actor = G.sims?.[resolution.actorId];
      if (actor) {
        const pending = stagedStats.get(resolution.actorId) ?? {};
        for (const [stat, delta] of Object.entries(resolution.effects ?? {})) {
          if (!MUTABLE_STATS.has(stat) || !Number.isFinite(Number(delta))) continue;
          pending[stat] = (pending[stat] ?? 0) + Number(delta);
        }
        stagedStats.set(resolution.actorId, pending);
      }
    }

    event.provenance.resourceIds = committedResourceIds;
    if (committedResourceIds.length === 1) {
      event.provenance.resourceId = committedResourceIds[0];
    }
    stagedEvents.push(event);
    sequence += 1;
  }

  G.resources.instances = stagedInstances;
  for (const [actorId, effects] of stagedStats) {
    const actor = G.sims?.[actorId];
    if (!actor) continue;
    for (const [stat, delta] of Object.entries(effects)) {
      actor[stat] = clampStat(Number(actor[stat] ?? 0) + delta);
    }
  }
  G.agency.events.push(...stagedEvents);
  G.agency.nextActionSequence = sequence;

  return stagedEvents;
}
