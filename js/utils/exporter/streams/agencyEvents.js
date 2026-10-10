import { Exporter } from "../state.js";
import { attachRecordMeta } from "../metadata.js";
import { cloneValue } from "../format.js";

export function recordAgencyEvents(G, cycle) {
  const events = Array.isArray(G?.agency?.events)
    ? G.agency.events
    : [];

  for (const event of events) {
    if (!event || event.cycle !== cycle) continue;

    Exporter.buffers.agency_events.push(attachRecordMeta({
      event_id: event.eventId ?? null,
      actor_id: event.actorId ?? null,
      action_type: event.actionType ?? null,
      status: event.status ?? null,
      provenance: cloneValue(event.provenance ?? {})
    }, cycle));
  }
}
