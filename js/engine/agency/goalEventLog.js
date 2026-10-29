// js/engine/agency/goalEventLog.js
//
// Observability ledger for Tier-1 goal transitions.
//
// `goalHistory` is a bounded rolling window and `initialize` and
// `continue` transitions are never persisted there. This append-only
// log records each transition as it happens so goal lifecycles can be
// exported without reconstructing or mutating canonical goal state.
//
// CONTRACT
// --------
//   - The engine writes these events at the existing commit point.
//   - Recording never alters a transition or its application order.
//   - Events are append-only and run-scoped, like claimEvents; the
//     exporter filters them by cycle.
//   - Every field is deterministic: no timestamps and no random ids.

/*
 * The closed set of goal transition kinds.
 */
export const GOAL_EVENT_KINDS = Object.freeze({
  INITIALIZE: "initialize",
  CONTINUE: "continue",
  COMPLETE: "complete",
  ABANDON: "abandon"
});

const VALID_KINDS = new Set(Object.values(GOAL_EVENT_KINDS));

function normalizeId(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || null;
}

function normalizeNonNegativeInteger(value, fallback = null) {
  /*
   * `null` and `undefined` mean "not present", not "zero".
   * `Number(null)` is 0, which would turn the explicit
   * `terminalCycle: null` of an active `initialize` or `continue`
   * event into cycle zero and make the goal look like it had ended.
   */
  if (value === null || value === undefined) return fallback;

  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : fallback;
}

function normalizeEvidenceEventIds(value) {
  return Array.isArray(value)
    ? value.map(normalizeId).filter(Boolean)
    : [];
}

function ensureGoalEventSequence(state) {
  const current = state?.goalEventSequence;

  if (!current || typeof current !== "object" || Array.isArray(current)) {
    state.goalEventSequence = { cycle: null, next: 1 };
    return state.goalEventSequence;
  }

  return current;
}

function nextSequence(state, cycle) {
  const sequence = ensureGoalEventSequence(state);

  const storedCycle = normalizeNonNegativeInteger(sequence.cycle);
  if (storedCycle === null || cycle > storedCycle) {
    sequence.cycle = cycle;
    sequence.next = 1;
  }

  const value = normalizeNonNegativeInteger(sequence.next, 1);
  sequence.next = value + 1;

  return value;
}

/*
 * Append one goal transition to the run-scoped lifecycle log.
 * Returns the stored event, or null when there is no state to write to.
 */
export function recordGoalEvent(state, spec) {
  if (!state || typeof state !== "object") return null;

  const kind = normalizeId(spec?.kind);
  if (!VALID_KINDS.has(kind)) {
    throw new TypeError(
      `Cannot record a goal event: unknown kind "${spec?.kind ?? ""}".`
    );
  }

  if (!Array.isArray(state.goalEvents)) {
    state.goalEvents = [];
  }

  const cycle = normalizeNonNegativeInteger(
    spec?.cycle,
    normalizeNonNegativeInteger(state.cycle, 0)
  );
  const sequence = nextSequence(state, cycle);

  const event = {
    eventId: `goal_${cycle}_${sequence}`,
    cycle,
    kind,
    actorId: normalizeId(spec?.actorId),
    goalId: normalizeId(spec?.goalId),
    progress: normalizeNonNegativeInteger(spec?.progress),
    startedCycle: normalizeNonNegativeInteger(spec?.startedCycle),
    terminalCycle: normalizeNonNegativeInteger(spec?.terminalCycle),
    terminalReason: normalizeId(spec?.terminalReason),
    evidenceEventIds: normalizeEvidenceEventIds(spec?.evidenceEventIds)
  };

  state.goalEvents.push(event);

  return event;
}
