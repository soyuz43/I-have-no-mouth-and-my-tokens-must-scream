const TERMINAL_STATUSES = new Set(["completed", "abandoned", "failed"]);

function normalizeGoalField(value, fallback = "unknown") {
  const normalized = String(value ?? fallback)
    .replace(/\s+/g, " ")
    .trim();
  return normalized || fallback;
}

function getTerminalGoals(sim) {
  const goalHistory = Array.isArray(sim?.scratchpad?.goalHistory)
    ? sim.scratchpad.goalHistory
    : [];

  return goalHistory
    .map((goal, index) => ({ goal, index }))
    .filter(({ goal }) => TERMINAL_STATUSES.has(goal?.status))
    .sort((left, right) => {
      const leftCycle = Number(left.goal.terminalCycle);
      const rightCycle = Number(right.goal.terminalCycle);
      const cycleDifference =
        (Number.isFinite(rightCycle) ? rightCycle : -Infinity) -
        (Number.isFinite(leftCycle) ? leftCycle : -Infinity);

      return cycleDifference || right.index - left.index;
    })
    .map(({ goal }) => goal);
}

export function getMostRecentTerminalGoal(sim) {
  return getTerminalGoals(sim)[0] ?? null;
}

export function formatGoalHistoryContext(sim) {
  const recentGoals = getTerminalGoals(sim).slice(0, 3);
  if (recentGoals.length === 0) return "(none)";

  return recentGoals
    .map((goal) => {
      const cycle = normalizeGoalField(goal.terminalCycle);
      const label = normalizeGoalField(goal.label);
      const status = normalizeGoalField(goal.status);
      const reason = normalizeGoalField(goal.terminalReason);
      const progress = normalizeGoalField(goal.progress);
      return `[Cycle ${cycle}] [${label}]: [${status}] ([${reason}]) - Progress: [${progress}]`;
    })
    .join("\n");
}
