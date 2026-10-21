// js/engine/agency/resourceEventLog.js
//
// The Objective Ledger: an append-only, deterministic event log for
// every mutation of the authoritative resource ledger.
//
// WHAT THIS MODULE IS
// -------------------
// G.resources.instances is MUTABLE STATE. It says what exists right
// now, but not what happened, who moved it, or in what order. This
// module supplies the missing half: a monotonic history of every
// ledger mutation, owned by the engine.
//
// CONTRACT
// --------
//   - The engine writes these events. The LLM never generates them.
//   - An event is emitted as a SIDE EFFECT of a successful mutation,
//     never as a precondition for it. Observing a mutation must not
//     change whether the mutation happens.
//   - Events are append-only. Nothing rewrites or removes an event.
//   - Every field is deterministic: no Date.now(), no random ids.
//
// EVENT ID
// --------
// evt_<cycle>_<sequence>, where sequence is a monotonic counter
// that restarts at 1 for each cycle. The counter lives in
// G.resourceEventSequence so it survives save/load. It is also
// self-healing: writing an event for a new cycle restarts it, which
// keeps ids correct even for a caller that never announced a cycle
// boundary.
//
// SEMANTICS OF THE QUANTITY FIELDS
// --------------------------------
// quantityBefore/quantityAfter count the AFFECTED QUANTITY, not the
// whole stack:
//
//   SEED / SEARCH  0 -> N units appeared.
//   CONSUME        q -> 0 units (the affected units are gone).
//   TRANSFER       q -> q units (the same units, new holder).
//   CONFISCATE     q -> q units (the same units, new holder: AM).
//   DESTROY        q -> 0 units (the affected units are gone).
//   HIDE / REVEAL  q -> q units (the stack is unchanged; concealment
//                   is what moved, and it is named in cause.action).
//
// fromHolderId / toHolderId are the holders of that affected quantity
// before and after the mutation. toHolderId is null when the affected
// quantity ceased to exist.
//
// SCOPE
// -----
// This module writes the log and nothing else. It never mutates the
// ledger, never gates an action, and never reads a belief.

/* ============================================================
   EVENT KINDS
   ============================================================ */

/*
 * The closed set of ledger event kinds.
 *
 * exposure is part of the schema but no write site emits it yet:
 * the current resource subsystem has no notion of an item becoming
 * exposed to a prisoner. It is declared here so the schema is
 * complete and stable, not as a hook for future work.
 */
export const RESOURCE_EVENT_KINDS = Object.freeze({
  SEED: "seed",
  PRISONER_ACTION: "prisoner_action",
  AM_INTERVENTION: "am_intervention",
  DRYING: "drying",
  EXPOSURE: "exposure"
});

const VALID_KINDS = new Set(Object.values(RESOURCE_EVENT_KINDS));

/* ============================================================
   NORMALIZATION
   ============================================================ */

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

/*
 * Holder and actor ids are nullable strings.
 *
 * A holder id may be a prisoner id, "AM" (which holds confiscated
 * items), or null when the affected quantity is not held by anyone.
 */
function normalizeId(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeQuantity(value) {
  const quantity = Number(value);
  return Number.isFinite(quantity) ? quantity : 0;
}

function normalizeCause(cause) {
  return {
    phase: normalizeText(cause?.phase),
    action: normalizeText(cause?.action),
    source: normalizeText(cause?.source)
  };
}

/* ============================================================
   SEQUENCE
   ============================================================ */

/*
 * The per-cycle sequence counter.
 *
 * Stored on the game state rather than in module scope so that a
 * save/load round-trip cannot reissue an event id.
 */
function ensureResourceEventSequence(state) {
  const current = state?.resourceEventSequence;

  if (
    !current ||
    typeof current !== "object" ||
    Array.isArray(current)
  ) {
    state.resourceEventSequence = {
      cycle: null,
      next: 1
    };

    return state.resourceEventSequence;
  }

  return current;
}

function nextSequence(state, cycle) {
  const sequence = ensureResourceEventSequence(state);

  const storedCycle =
    Number.isFinite(Number(sequence.cycle))
      ? Number(sequence.cycle)
      : null;

  /*
   * A cycle ADVANCE restarts the counter. This is the normal case:
   * the first event of a cycle is sequence 1.
   *
   * A retroactive write to an EARLIER cycle keeps advancing the
   * counter instead of resetting it. Resetting there would reissue
   * ids that the later cycle already handed out. Advancing keeps
   * every id unique for the whole run, at the cost of that one
   * event's sequence number not starting at 1.
   */
  if (storedCycle === null || cycle > storedCycle) {
    sequence.cycle = cycle;
    sequence.next = 1;
  }

  const value =
    Number.isSafeInteger(sequence.next) &&
    sequence.next > 0
      ? sequence.next
      : 1;

  sequence.next = value + 1;

  return value;
}

/* ============================================================
   WRITING
   ============================================================ */

/*
 * Append one event to the ledger history.
 *
 * The event id is assigned here, from the per-cycle counter, so no
 * caller can invent a non-monotonic id. The event is pushed onto
 * esourceEvents in call order, which is mutation order.
 *
 * Returns the stored event, or null when there is no state to write
 * to. A missing esourceEvents array is created rather than
 * treated as an error, so a state object assembled by a test or a
 * caller predating this module still records its history.
 */
export function recordResourceEvent(state, spec) {
  if (!state || typeof state !== "object") return null;

  const kind = normalizeText(spec?.kind);

  if (!VALID_KINDS.has(kind)) {
    throw new TypeError(
      `Cannot record a resource event: unknown kind "${kind}".`
    );
  }

  if (!Array.isArray(state.resourceEvents)) {
    state.resourceEvents = [];
  }

  const cycle = Number.isFinite(Number(spec?.cycle))
    ? Number(spec.cycle)
    : Number.isFinite(Number(state.cycle))
      ? Number(state.cycle)
      : 0;

  const sequence = nextSequence(state, cycle);

  const event = {
    eventId: `evt_${cycle}_${sequence}`,
    cycle,
    kind,
    resourceId: normalizeText(spec?.resourceId),
    definitionId: normalizeText(spec?.definitionId),
    quantityBefore: normalizeQuantity(spec?.quantityBefore),
    quantityAfter: normalizeQuantity(spec?.quantityAfter),
    fromHolderId: normalizeId(spec?.fromHolderId),
    toHolderId: normalizeId(spec?.toHolderId),
    actorId: normalizeId(spec?.actorId),
    cause: normalizeCause(spec?.cause)
  };

  state.resourceEvents.push(event);

  return event;
}
