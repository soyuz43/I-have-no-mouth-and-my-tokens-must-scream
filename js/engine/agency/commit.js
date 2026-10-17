import { createAgencyEvent } from "./events.js";
import { engineRng } from "../../core/prng.js";
import {
  getTier1Goal,
  selectTier1Goal
} from "../scratchpad/goals/registry.js";
import { evaluateGoalTransitions } from "../scratchpad/goals/evaluator.js";

const MAX_GOAL_HISTORY = 5;
const RESOURCE_DISCOVERY_CHANCE = 0.3;

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

export function commitAgencyResolution(
  G,
  resolutions,
  { goalSelections = [] } = {}
) {
  if (!G.resources || !Array.isArray(G.resources.instances)) {
    G.resources = { instances: [] };
  }
  if (!G.agency || !Array.isArray(G.agency.events)) {
    throw new TypeError("Agency state must contain an events array.");
  }
  if (!Array.isArray(G.pendingResourceDiscoveries)) {
    G.pendingResourceDiscoveries = [];
  }

  const nextSequence = Number(G.agency.nextActionSequence) || 1;
  const stagedInstances = G.resources.instances.map(cloneInstance);
  const stagedStats = new Map();
  const stagedWaitStreaks = new Map();
  const stagedEvents = [];
  let sequence = nextSequence;

  for (const resolution of resolutions) {
    const event = createAgencyEvent(
      resolution,
      resolution.cycle ?? G.cycle,
      sequence
    );
    const committedResourceIds = [];
    const actor = G.sims?.[resolution.actorId];
    const actionType = resolution.action?.type ?? "WAIT";

    if (actor) {
      const currentWaitStreak = stagedWaitStreaks.get(resolution.actorId) ??
        Math.max(0, Math.floor(Number(actor.waitStreak) || 0));

      if (
        actionType === "WAIT" &&
        event.provenance.source !== "agency_resolver"
      ) {
        const waitStreak = currentWaitStreak + 1;
        stagedWaitStreaks.set(resolution.actorId, waitStreak);
        event.provenance.waitStreak = waitStreak;

        if (waitStreak >= 2) {
          const penalty = {
            suffering: waitStreak,
            hope: -waitStreak * 0.5
          };
          const pending = stagedStats.get(resolution.actorId) ?? {};
          pending.suffering = (pending.suffering ?? 0) + penalty.suffering;
          pending.hope = (pending.hope ?? 0) + penalty.hope;
          stagedStats.set(resolution.actorId, pending);
          event.provenance.waitPenalty = penalty;
        }
      } else if (actionType !== "WAIT") {
        stagedWaitStreaks.set(resolution.actorId, 0);
      }
    }

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

  const resolvedGoalSelections = [];
  for (const { actorId, selectedObjective } of goalSelections) {
    const actor = G.sims?.[actorId];
    if (!actor?.scratchpad || typeof actor.scratchpad !== "object") continue;

    const selectedGoal = getTier1Goal(selectedObjective, G.cycle);
    const assignedGoal = selectedGoal ?? selectTier1Goal(engineRng, G.cycle);
    resolvedGoalSelections.push({
      actorId,
      selectedObjective: assignedGoal.id
    });
    console.debug(
      `[AGENCY][${actorId}] objective ${selectedGoal ? "LLM-selected" : "Engine-fallback"}: ${assignedGoal.id}`
    );
  }

  const goalTransitions = evaluateGoalTransitions({
    sims: G.sims,
    events: stagedEvents,
    goalSelections: resolvedGoalSelections,
    cycle: G.cycle
  });

  for (const transition of goalTransitions) {
    const scratchpad = G.sims?.[transition.actorId]?.scratchpad;
    if (!scratchpad || typeof scratchpad !== "object") continue;
    if (!Array.isArray(scratchpad.goalHistory)) scratchpad.goalHistory = [];

    if (transition.terminalGoal) {
      scratchpad.goalHistory.push(transition.terminalGoal);
      scratchpad.goalHistory = scratchpad.goalHistory.slice(-MAX_GOAL_HISTORY);
    }

    scratchpad.activeGoal = transition.nextActiveGoal;
  }

  const actorIds = [...new Set(resolutions.map(({ actorId }) => actorId))]
    .filter((actorId) => G.sims?.[actorId])
    .sort();

  for (const actorId of actorIds) {
    const heldResources = stagedInstances
      .filter((instance) =>
        instance.holderId === actorId &&
        instance.concealed === false &&
        Number(instance.quantity) > 0
      )
      .sort((left, right) =>
        String(left.resourceId).localeCompare(String(right.resourceId))
      );

    for (const instance of heldResources) {
      if (engineRng.next() >= RESOURCE_DISCOVERY_CHANCE) continue;

      G.pendingResourceDiscoveries.push({
        cycle: G.cycle,
        actorId,
        resourceId: instance.resourceId,
        definitionId: instance.definitionId
      });
      console.debug(
        `[AGENCY] AM discovered ${instance.definitionId} held by ${actorId}`
      );
    }
  }

  G.resources.instances = stagedInstances;
  for (const [actorId, effects] of stagedStats) {
    const actor = G.sims?.[actorId];
    if (!actor) continue;
    for (const [stat, delta] of Object.entries(effects)) {
      actor[stat] = clampStat(Number(actor[stat] ?? 0) + delta);
    }
  }
  for (const [actorId, waitStreak] of stagedWaitStreaks) {
    const actor = G.sims?.[actorId];
    if (actor) actor.waitStreak = waitStreak;
  }
  G.agency.events.push(...stagedEvents);
  G.agency.nextActionSequence = sequence;

  return stagedEvents;
}
