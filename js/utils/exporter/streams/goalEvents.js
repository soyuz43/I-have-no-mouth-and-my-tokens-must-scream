// js/utils/exporter/streams/goalEvents.js
//
// The Goal Lifecycle export stream.
//
// WHAT THIS STREAM IS
// -------------------
// One event per canonical Agency goal transition. Unlike the bounded
// scratchpad `goalHistory`, this run-scoped ledger records initialize
// and continue transitions as they happen, so lifecycle timing is not
// reconstructed from a rolling five-record window.
//
// WHY IT IS FILTERED BY CYCLE
// ---------------------------
// Goal events follow the claimEvents pattern: the engine log is
// run-scoped and grows with the run, while each export file records
// only the events belonging to that cycle.

import { Exporter } from "../state.js";
import { attachRecordMeta } from "../metadata.js";
import { cloneValue } from "../format.js";

/*
 * The goal event history for one cycle, in commit order.
 */
export function recordGoalEvents(G, cycle) {
  const events = Array.isArray(G?.goalEvents)
    ? G.goalEvents
    : [];

  for (const event of events) {
    if (!event || event.cycle !== cycle) continue;

    Exporter.buffers.goal_events.push(attachRecordMeta({
      event_id: event.eventId ?? null,
      kind: event.kind ?? null,
      actor_id: event.actorId ?? null,
      goal_id: event.goalId ?? null,
      progress: event.progress ?? null,
      started_cycle: event.startedCycle ?? null,
      terminal_cycle: event.terminalCycle ?? null,
      terminal_reason: event.terminalReason ?? null,
      evidence_event_ids: cloneValue(event.evidenceEventIds ?? [])
    }, cycle));
  }
}
