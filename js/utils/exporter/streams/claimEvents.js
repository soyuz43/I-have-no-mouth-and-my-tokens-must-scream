// js/utils/exporter/streams/claimEvents.js
//
// The Subjective Ledger export stream.
//
// WHAT THIS STREAM IS
// -------------------
// The resource_events stream records what the world LOOKED like at the
// end of a cycle and what HAPPENED to it. This stream records what
// each prisoner BELIEVED about their own holdings, and how that
// belief moved.
//
// A run analysed with only the objective ledger cannot distinguish a
// prisoner who knew they were robbed from one who still believes they
// are holding the item. The claim event history is what makes that
// distinction visible in the export.
//
// WHY IT IS FILTERED BY CYCLE
// ---------------------------
// The claim event history is run-scoped and grows without bound. Every
// other stream in this exporter is per-cycle and cleared after each
// export, so this stream follows the same rule: only the events
// belonging to the cycle being exported are written.

import { Exporter } from "../state.js";
import { attachRecordMeta } from "../metadata.js";
import { cloneValue } from "../format.js";

/*
 * The claim event history for one cycle, in belief-change order.
 */
export function recordClaimEvents(G, cycle) {
  const events = Array.isArray(G?.claimEvents)
    ? G.claimEvents
    : [];

  for (const event of events) {
    if (!event || event.cycle !== cycle) continue;

    Exporter.buffers.claim_events.push(attachRecordMeta({
      event_id: event.eventId ?? null,
      cycle: event.cycle ?? null,
      subject_id: event.subjectId ?? null,
      definition_id: event.definitionId ?? null,
      quantity_before: event.quantityBefore ?? null,
      quantity_after: event.quantityAfter ?? null,
      delta: event.delta ?? null,
      cause: cloneValue(event.cause ?? {})
    }, cycle));
  }
}
