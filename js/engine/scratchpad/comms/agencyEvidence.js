// js/engine/scratchpad/comms/agencyEvidence.js
//
// Bridge between the canonical Agency Event Log and the scratchpad
// evidence-validation layer.
//
// WHAT THIS MODULE IS
// -------------------
// A pure projector that turns the agency events a specific prisoner
// may review into a Map of admissible scratchpad evidence, keyed by
// the canonical eventId (e.g. "agency:4:1").
//
// The review trigger already admits a prisoner who has agency events
// but no visible messages (see `getAgencyEventsForReview()` and the
// orchestrator's "is there anything to review" check). Before this
// module existed, such a review could only ever produce NO_UPDATE,
// because the evidence contract admitted message IDs and overheard
// event IDs and nothing else. This projector makes the agency events
// the prisoner was shown citable by the same route as messages.
//
// ADMISSIBILITY
// -------------
// An agency event is admissible for a sim only when that sim is the
// actor, or the sim was the recipient of a successful action. This
// is exactly the scoping `getAgencyEventsForReview()` already
// applies, so the set the model was shown and the set it may cite are
// the same set. The projector does not widen or narrow it.
//
// WHAT THIS MODULE IS NOT
// -----------------------
// It does not read G directly in the projector; the caller passes the
// event list. It does not mutate the ledger. It does not resolve
// message visibility (that remains buildVisibleMessageMap's job for
// messageId references) and it does not resolve overhearing
// visibility (that remains buildVisibleOverhearingEventMap's job).

import { SIM_IDS } from "../../../core/constants.js";

function normalizeSimId(simId) {
  return String(simId ?? "")
    .trim()
    .toUpperCase();
}

/*
 * Whether this event belongs to the given prisoner.
 *
 * Mirrors `getAgencyEventsForReview()`: the actor always owns their
 * own outcome, and a successful action's recipient experienced it
 * too. A BLOCKED action did not reach its target, so the target has
 * nothing to review.
 */
function isEventAdmissibleForSim(
  event,
  simId
) {
  if (!event || typeof event !== "object") {
    return false;
  }

  if (
    normalizeSimId(event.actorId) === simId
  ) {
    return true;
  }

  return (
    event.status === "success" &&
    normalizeSimId(
      event.provenance?.targetId
    ) === simId
  );
}

/*
 * Project a stable, serializable view of an agency event for the
 * scratchpad layer. Only fields the validator and commit path need
 * are copied; live references are not shared.
 */
function projectAgencyEvent(event) {
  const eventId =
    String(event.eventId ?? "");

  /*
   * The canonical event ID is "agency:<cycle>:<sequence>", where the
   * sequence is the monotonic agency action counter. It is the note
   * ordering key for an agency-sourced note, in the same way a
   * message sequence is the ordering key for a message-sourced note.
   */
  const actionSequence =
    Number(eventId.split(":")[2]) || 0;

  return {
    eventId,
    cycle: Number(event.cycle) || 0,
    actionSequence,
    actorId: normalizeSimId(event.actorId),
    actionType: String(event.actionType ?? ""),
    status: String(event.status ?? ""),
    targetId:
      normalizeSimId(
        event.provenance?.targetId
      ) || null,
    resolutionReason:
      event.provenance?.resolutionReason ?? null,
  };
}

/*
 * Build the admissible agency-event map for one prisoner.
 *
 * @param {Array<object>} events
   The agency event list (e.g. G.agency.events). Missing or
   malformed lists yield an empty map rather than throwing, because
   "no agency events" is a valid, common state.
 * @param {string} simId
   The prisoner whose admissible events are requested.
 * @returns {Map<string, object>}
   eventId -> projected event record.
 */
export function buildVisibleAgencyEventMap(
  events,
  simId
) {
  const map = new Map();

  if (!Array.isArray(events)) {
    return map;
  }

  const listenerId =
    normalizeSimId(simId);

  if (!SIM_IDS.includes(listenerId)) {
    return map;
  }

  for (const event of events) {
    if (
      !isEventAdmissibleForSim(
        event,
        listenerId
      )
    ) {
      continue;
    }

    const eventId =
      String(event.eventId ?? "")
        .trim();

    if (!eventId) {
      continue;
    }

    map.set(
      eventId,
      projectAgencyEvent(event)
    );
  }

  return map;
}

/*
 * Whether a reference has the canonical agency-event ID shape.
 *
 * "agency:<cycle>:<sequence>". This is a shape check only: it says
 * the reference LOOKS like an agency event ID, not that the event
 * exists or is admissible for this prisoner. Existence is decided by
 * the admissible map.
 */
export function isAgencyEventReference(
  reference
) {
  return /^agency:\d+:\d+$/.test(
    String(reference ?? "")
      .trim()
  );
}
