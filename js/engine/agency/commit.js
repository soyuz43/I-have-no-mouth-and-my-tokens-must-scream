import { createAgencyEvent } from "./events.js";
import { engineRng } from "../../core/prng.js";
import {
  getTier1Goal,
  selectTier1Goal
} from "../scratchpad/goals/registry.js";
import { evaluateGoalTransitions } from "../scratchpad/goals/evaluator.js";
import { getResourceDefinition } from "./resourceDefs.js";
import {
  recordResourceEvent,
  RESOURCE_EVENT_KINDS
} from "./resourceEventLog.js";
import {
  recordClaimEventsForResourceEvent,
  recordBeliefCorrection,
  refreshClaimDivergence
} from "./claimLedger.js";
import {
  recordGoalEvent
} from "./goalEventLog.js";

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

function applyOperation(
  instances,
  operation,
  eventId,
  actorId,
  cycle,
  searchSequence,
  sequenceIndex,
  actionType,
  stagedEvents
) {
  if (operation.type === "find") {
    const definition = getResourceDefinition(operation.definitionId);
    const quantity = Number(operation.quantity);
    if (!definition || !Number.isFinite(quantity) || quantity <= 0) return null;

    const resourceId = `${operation.definitionId}_found_${searchSequence}_${sequenceIndex}`;
    instances.push({
      resourceId,
      definitionId: operation.definitionId,
      quantity,
      holderId: actorId,
      locationId: null,
      accessible: true,
      concealed: false,
      provenance: {
        source: "environment_search",
        cycle
      },
      dryingTurns: operation.definitionId === "wet_cigarette" ? 2 : 0
    });
    console.debug(
      `[AGENCY] ${actorId} found ${quantity} ${operation.definitionId} via SEARCH`
    );

    /*
     * A SEARCH is a CREATION, not a transfer: the units did not
     * exist before the search. quantityBefore is therefore 0, and
     * there is no prior holder.
     */
    stagedEvents.push({
      kind: RESOURCE_EVENT_KINDS.PRISONER_ACTION,
      cycle,
      resourceId,
      definitionId: operation.definitionId,
      quantityBefore: 0,
      quantityAfter: quantity,
      fromHolderId: null,
      toHolderId: actorId,
      actorId,
      cause: {
        phase: "agency_phase",
        action: "SEARCH",
        source: "agency_resolver"
      }
    });

    return resourceId;
  }

  const instance = instances.find(
    (candidate) => candidate?.resourceId === operation.resourceId
  );
  if (!instance) return null;

  if (operation.kind === "consume") {
    const quantityBefore = Number(instance.quantity);
    const holderId = instance.holderId ?? null;

    instance.quantity = Math.max(
      0,
      Number(instance.quantity) - Number(operation.quantity)
    );

    /*
     * The consumed units cease to exist. quantityAfter is 0 and
     * there is no holder afterwards, which is what distinguishes a
     * consumption from a transfer in the trajectory.
     */
    stagedEvents.push({
      kind: RESOURCE_EVENT_KINDS.PRISONER_ACTION,
      cycle,
      resourceId: instance.resourceId,
      definitionId: instance.definitionId,
      quantityBefore: Math.min(
        quantityBefore,
        Number(operation.quantity) || 0
      ),
      quantityAfter: 0,
      fromHolderId: holderId,
      toHolderId: null,
      actorId,
      cause: {
        phase: "agency_phase",
        action: actionType || "CONSUME",
        source: "agency_resolver"
      }
    });

    return instance.resourceId;
  }

  if (operation.kind === "transfer") {
    const amount = Number(operation.quantity);
    const holderIdBefore = instance.holderId ?? null;

    if (Number(instance.quantity) === amount) {
      instance.holderId = operation.targetId;

      stagedEvents.push({
        kind: RESOURCE_EVENT_KINDS.PRISONER_ACTION,
        cycle,
        resourceId: instance.resourceId,
        definitionId: instance.definitionId,
        quantityBefore: amount,
        quantityAfter: amount,
        fromHolderId: holderIdBefore,
        toHolderId: operation.targetId,
        actorId,
        cause: {
          phase: "agency_phase",
          action: actionType || "TRANSFER",
          source: "agency_resolver"
        }
      });

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

    /*
     * A partial transfer splits the stack. The affected units now
     * live in the derived stack, so that stack's id is the one
     * recorded: the event names the container that holds the
     * quantity that moved.
     */
    stagedEvents.push({
      kind: RESOURCE_EVENT_KINDS.PRISONER_ACTION,
      cycle,
      resourceId: transferredResourceId,
      definitionId: instance.definitionId,
      quantityBefore: amount,
      quantityAfter: amount,
      fromHolderId: holderIdBefore,
      toHolderId: operation.targetId,
      actorId,
      cause: {
        phase: "agency_phase",
        action: actionType || "TRANSFER",
        source: "agency_resolver"
      }
    });

    return transferredResourceId;
  }

  if (operation.kind === "conceal") {
    const holderId = instance.holderId ?? null;

    instance.concealed = operation.concealed;

    /*
     * HIDE and REVEAL do not move any quantity. The stack is
     * unchanged and still held by the same prisoner; what changed
     * is who can SEE it, which the cause.action names.
     */
    stagedEvents.push({
      kind: RESOURCE_EVENT_KINDS.PRISONER_ACTION,
      cycle,
      resourceId: instance.resourceId,
      definitionId: instance.definitionId,
      quantityBefore: Number(instance.quantity),
      quantityAfter: Number(instance.quantity),
      fromHolderId: holderId,
      toHolderId: holderId,
      actorId,
      cause: {
        phase: "agency_phase",
        action: operation.concealed === true ? "HIDE" : "REVEAL",
        source: "agency_resolver"
      }
    });

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
  const stagedSearchCycles = new Map();
  const stagedEvents = [];
  const stagedResourceEvents = [];
  let sequence = nextSequence;
  let operationSequenceIndex = 0;

  for (const resolution of resolutions) {
    const event = createAgencyEvent(
      resolution,
      resolution.cycle ?? G.cycle,
      sequence
    );
    const committedResourceIds = [];
    const actor = G.sims?.[resolution.actorId];
    const actionType = resolution.action?.type ?? "WAIT";

    if (actor && resolution.provenance?.searchAttempted === true) {
      stagedSearchCycles.set(resolution.actorId, G.cycle);
    }

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
          event.eventId,
          resolution.actorId,
          G.cycle,
          Number(G.agency.nextActionSequence) || G.cycle,
          operationSequenceIndex,
          actionType,
          stagedResourceEvents
        );
        operationSequenceIndex += 1;
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

    recordGoalEvent(G, {
      kind: transition.type,
      cycle: G.cycle,
      actorId: transition.actorId,
      goalId: transition.nextActiveGoal?.id ?? transition.terminalGoal?.id ?? null,
      progress: transition.nextActiveGoal?.progress ?? transition.terminalGoal?.progress ?? null,
      startedCycle: transition.nextActiveGoal?.startedCycle ?? transition.terminalGoal?.startedCycle ?? null,
      terminalCycle: transition.terminalGoal?.terminalCycle ?? null,
      terminalReason: transition.terminalGoal?.terminalReason ?? null,
      evidenceEventIds: transition.nextActiveGoal?.evidenceEventIds ?? transition.terminalGoal?.evidenceEventIds ?? []
    });
  }

  const actorIds = [...new Set(resolutions.map(({ actorId }) => actorId))]
    .filter((actorId) => G.sims?.[actorId])
    .sort();

  for (const actorId of actorIds) {
    const heldResources = stagedInstances
      .filter((instance) =>
        instance.holderId === actorId &&
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
        `[AGENCY] AM attention drawn to ${instance.definitionId} held by ${actorId}`
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
  for (const [actorId, lastSearchCycle] of stagedSearchCycles) {
    const actor = G.sims?.[actorId];
    if (actor) actor.lastSearchCycle = lastSearchCycle;
  }
  G.agency.events.push(...stagedEvents);
  G.agency.nextActionSequence = sequence;

  /*
   * The Objective Ledger is written AFTER the mutation is committed
   * to G.resources, not before. Recording is strictly an
   * observation: it must never be able to fail, block, or alter the
   * commit it is describing.
   */
  for (const resourceEvent of stagedResourceEvents) {
    recordResourceEvent(G, resourceEvent);

    /*
     * The Subjective Ledger is written immediately after the
     * objective event it derives from, so the claim event can point
     * back at it through cause.sourceEventId.
     *
     * A prisoner always knows about their own actions, so these
     * events never carry a silent disclosure.
     */
    recordClaimEventsForResourceEvent(G, resourceEvent);
  }

  /*
   * BELIEF RESOLUTION
   * -----------------
   * A refused attempt on a resource the prisoner BELIEVED they held
   * is the learning event. The prisoner's hand has just confirmed
   * what the engine already knew, so the belief moves to match the
   * reality and the divergence closes.
   *
   * Without this, the belief never moves. AM's silent theft is a
   * one-way ratchet: the prisoner is robbed in cycle 5 and still
   * believes they are carrying the item in cycle 50, because nothing
   * in the system ever tells them otherwise. The divergence goes
   * stale, the engine stops surfacing it, and the prisoner is left
   * permanently and silently wrong.
   *
   * WHY IT RUNS HERE
   * ----------------
   * After the resource events are written, so the objective quantity
   * the correction converges onto is FINAL. A correction that ran
   * before the ledger settled would compute the wrong target.
   *
   * WHY IT IS SAFE TO WRITE
   * -----------------------
   * The correction is derived from a RECORDED agency event — the
   * blocked attempt, with its stable `eventId`. The claim event
   * points back at it through `cause.sourceEventId`, exactly as a
   * projected claim event points back at its resource event. Nothing
   * here is derived from prose or from a model judgement, so the
   * determinism invariant holds.
   *
   * The agency event carries the correction in its provenance, so the
   * refusal and the belief update are recorded together and a
   * researcher can trace one from the other in the export.
   */
  for (const event of stagedEvents) {
    const correction = event?.provenance?.beliefCorrection;

    if (!correction || typeof correction !== "object") continue;

    const recorded = recordBeliefCorrection(G, {
      subjectId: event.actorId,
      definitionId: correction.definitionId,
      cycle: event.cycle ?? G.cycle,
      sourceEventId: event.eventId,
      actorId: event.actorId,
      resourceId: correction.resourceId
    });

    if (recorded) {
      console.debug(
        `[AGENCY][${event.actorId}] belief corrected for ${correction.definitionId} (${correction.claimed} believed) by refused attempt ${event.eventId}`
      );
    }
  }

  refreshClaimDivergence(G);

  return stagedEvents;
}
