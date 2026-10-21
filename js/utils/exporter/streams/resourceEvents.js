// js/utils/exporter/streams/resourceEvents.js
//
// The Objective Ledger export stream.
//
// WHAT THIS STREAM IS
// -------------------
// The per-cycle export payload records what the world LOOKED like at
// the end of a cycle. The objective ledger records what HAPPENED to
// it. This stream puts the event history in the export so a run can
// be analyzed as a trajectory rather than as a series of snapshots.
//
// WHY IT IS FILTERED BY CYCLE
// ---------------------------
// The event history is run-scoped and grows without bound. Every
// other stream in this exporter is per-cycle and cleared after each
// export, so this stream follows the same rule: only the events
// belonging to the cycle being exported are written. An event from
// an earlier cycle was already exported in that cycle's file.

import { Exporter } from "../state.js";
import { attachRecordMeta } from "../metadata.js";
import { cloneValue } from "../format.js";

/*
 * The event history for one cycle, in mutation order.
 */
export function recordResourceEvents(G, cycle) {
  const events = Array.isArray(G?.resourceEvents)
    ? G.resourceEvents
    : [];

  for (const event of events) {
    if (!event || event.cycle !== cycle) continue;

    Exporter.buffers.resource_events.push(attachRecordMeta({
      event_id: event.eventId ?? null,
      kind: event.kind ?? null,
      resource_id: event.resourceId ?? null,
      definition_id: event.definitionId ?? null,
      quantity_before: event.quantityBefore ?? null,
      quantity_after: event.quantityAfter ?? null,
      from_holder_id: event.fromHolderId ?? null,
      to_holder_id: event.toHolderId ?? null,
      actor_id: event.actorId ?? null,
      cause: cloneValue(event.cause ?? {})
    }, cycle));
  }
}
