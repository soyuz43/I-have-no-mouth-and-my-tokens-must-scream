import { getTier1Goal } from "./registry.js";

const COMPLETION_PROGRESS = 3;

export function evaluateGoalTransitions({
  sims,
  events,
  goalSelections,
  cycle
}) {
  const transitions = [];

  for (const selection of Array.isArray(goalSelections) ? goalSelections : []) {
    const actorId = selection?.actorId;
    const scratchpad = sims?.[actorId]?.scratchpad;
    if (!actorId || !scratchpad || typeof scratchpad !== "object") continue;

    const selectedGoal = getTier1Goal(selection.selectedObjective, cycle);
    if (!selectedGoal) continue;

    const activeGoal = scratchpad.activeGoal;
    if (!activeGoal) {
      transitions.push({
        actorId,
        type: "initialize",
        nextActiveGoal: selectedGoal,
        terminalGoal: null
      });
      continue;
    }

    if (activeGoal.id !== selectedGoal.id) {
      transitions.push({
        actorId,
        type: "abandon",
        nextActiveGoal: selectedGoal,
        terminalGoal: {
          ...activeGoal,
          status: "abandoned",
          progress: Number.isSafeInteger(activeGoal.progress)
            ? activeGoal.progress
            : 0,
          startedCycle: Number.isSafeInteger(activeGoal.startedCycle)
            ? activeGoal.startedCycle
            : cycle,
          terminalCycle: cycle,
          terminalReason: "reassigned",
          evidenceEventIds: Array.isArray(activeGoal.evidenceEventIds)
            ? [...activeGoal.evidenceEventIds]
            : []
        }
      });
      continue;
    }

    const successfulEvent = (Array.isArray(events) ? events : []).find(
      (event) =>
        event?.actorId === actorId &&
        event?.cycle === cycle &&
        event?.status === "success"
    );
    if (!successfulEvent) continue;

    const progress = Number.isSafeInteger(activeGoal.progress)
      ? activeGoal.progress
      : 0;
    const progressedGoal = {
      ...activeGoal,
      status: "active",
      progress: progress + 1,
      startedCycle: Number.isSafeInteger(activeGoal.startedCycle)
        ? activeGoal.startedCycle
        : cycle,
      evidenceEventIds: Array.isArray(activeGoal.evidenceEventIds)
        ? [...activeGoal.evidenceEventIds, successfulEvent.eventId]
        : [successfulEvent.eventId]
    };

    if (progressedGoal.progress >= COMPLETION_PROGRESS) {
      transitions.push({
        actorId,
        type: "complete",
        nextActiveGoal: null,
        terminalGoal: {
          ...progressedGoal,
          status: "completed",
          terminalCycle: cycle,
          terminalReason: "progress_threshold_reached"
        }
      });
      continue;
    }

    transitions.push({
      actorId,
      type: "continue",
      nextActiveGoal: progressedGoal,
      terminalGoal: null
    });
  }

  return transitions;
}
