// js/engine/scratchpad/comms/overhearingEvidence.js
//
// Bridge between the canonical Overhearing Ledger and the scratchpad
// evidence-validation layer.
//
// WHAT THIS MODULE IS
// -------------------
// A pure projector that turns G.overhearing.history into a Map of the
// overhearing events a specific prisoner is permitted to cite as
// scratchpad evidence, keyed by their canonical eventId (e.g.
// "C1-O000001").
//
// This does NOT weaken reference validation. An event is only
// admissible for a sim when that sim is the recorded `listener` of the
// event. Observed-but-unheard events (outcome "observed_only") are
// admissible for referencing that "a conversation happened" but carry
// no canonical text; the validator and commit layer enforce that
// distinction downstream.
//
// WHAT THIS MODULE IS NOT
// ----------------------
// It does not read G directly in the projector; the caller passes the
// ledger. It does not mutate the ledger. It does not resolve message
// visibility (that remains buildVisibleMessageMap's job for messageId
// references).

import { SIM_IDS } from "../../../core/constants.js";

function normalizeSimId(simId) {
  return String(simId ?? "").trim().toUpperCase();
}

function isOverhearingLedger(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    Array.isArray(value.history)
  );
}

/*
 * Build the admissible overhearing-event map for one listener.
 *
 * @param {object} overhearing
 *   G.overhearing (or a shape-compatible object with a `history`
 *   array). Missing or malformed ledgers yield an empty map rather
 *   than throwing, because "no overhearing" is a valid, common state.
 * @param {string} simId
 *   The prisoner whose admissible events are requested.
 * @returns {Map<string, object>}
 *   eventId -> projected event record (a stable, non-circular view).
 */
export function buildVisibleOverhearingEventMap(
  overhearing,
  simId
) {
  const map = new Map();

  if (!isOverhearingLedger(overhearing)) {
    return map;
  }

  const listenerId = normalizeSimId(simId);

  if (!SIM_IDS.includes(listenerId)) {
    return map;
  }

  for (const event of overhearing.history) {
    if (!event || typeof event !== "object") {
      continue;
    }

    const eventListener = normalizeSimId(event.listener);

    if (eventListener !== listenerId) {
      continue;
    }

    const eventId = String(event.eventId ?? "").trim();

    if (!eventId) {
      continue;
    }

    map.set(eventId, projectOverhearingEvent(event));
  }

  return map;
}

/*
 * Project a stable, serializable view of an overhearing event for the
 * scratchpad layer. Only fields the validator and commit path need
 * are copied; live references are not shared.
 */
function projectOverhearingEvent(event) {
  const observations = Array.isArray(event.observations)
    ? event.observations
    : [];

  const primaryObservation =
    observations.length > 0 ? observations[0] : null;

  return {
    eventId: String(event.eventId ?? ""),
    sequence: Number(event.sequence) || 0,
    cycle: Number(event.cycle) || 0,
    listener: normalizeSimId(event.listener),
    participants: {
      from: normalizeSimId(event.participants?.from),
      to: normalizeSimId(event.participants?.to),
    },
    outcome: String(event.outcome ?? ""),
    sourceMessageIds: Array.isArray(event.sourceMessageIds)
      ? event.sourceMessageIds.map((id) => String(id))
      : [],
    sourceKind: String(event.sourceKind ?? ""),
    perceivedText:
      primaryObservation?.text != null
        ? String(primaryObservation.text)
        : null,
  };
}

/*
 * Whether an admissible event permits the sim to reference its
 * perceived text. "observed_only" means the sim saw a conversation but
 * heard no words, so the event is citable as an observation but yields
 * no transcript content.
 */
export function eventPermitsTextReference(event) {
  if (!event || typeof event !== "object") {
    return false;
  }

  return event.outcome !== "observed_only";
}
