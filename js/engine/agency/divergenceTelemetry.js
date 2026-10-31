// js/engine/agency/divergenceTelemetry.js
//
// The measurement layer for the DIVERGENCE LOOP.
//
// WHAT THIS MODULE IS
// -------------------
// The Dual Ledger already knows how to CREATE a divergence (a silent
// AM confiscation moves the reality and leaves the belief alone) and
// how to RESOLVE one (a refused attempt corrects the belief). What
// it cannot do is say how the loop is BEHAVING: how many
// divergences are open right now, how long they last, how many are
// resolved, and how many simply go stale and are never spoken of
// again.
//
// This module turns the divergence state into those numbers and into
// one snapshot record per divergence. It is the single definition of
// what a divergence snapshot MEANS, so the export stream and the
// metrics layer cannot drift apart.
//
// WHY A SEPARATE MODULE
// ----------------------
// `claimLedger.js` OWNS the divergence: it derives it and it records
// the lifecycle transitions. This module only READS. Splitting
// ownership from measurement keeps the ledger free of reporting
// concerns, and keeps the measurement free of mutation concerns.
//
// THE THREE STATES OF A DIVERGENCE
// --------------------------------
//
//   fresh    the divergence is open and the engine is still
//            surfacing it: it opens AM's assessment gate and it
//            appears in the prisoner's scratchpad.
//   stale    the divergence is STILL open, but it is too old to be
//            worth interrupting anybody for. It ages out of the
//            recency window without ever being resolved.
//   resolved the divergence is closed: the belief caught up with
//            the reality.
//
// Freshness is NOT an event. A divergence does not "become stale";
// it simply gets old, and the age is measured against the recency
// window on demand. Only the appearance and the disappearance of a
// divergence are events, and those are recorded in the lifecycle log.
//
// WHY A RESOLVED DIVERGENCE APPEARS IN A SNAPSHOT
// ------------------------------------------------
// A per-cycle snapshot of the OPEN divergences alone cannot show
// that a divergence was closed: it would simply vanish. A researcher
// comparing two consecutive cycles could not tell a resolution apart
// from a divergence that was never recorded at all, nor from a
// divergence that was silently forgotten.
//
// So a snapshot includes the divergences that RESOLVED during the
// cycle being exported, with `status: "resolved"`. A divergence
// that is still open is reported as fresh or stale; one that closed
// in this cycle is reported as resolved. The two sets are disjoint,
// and every active divergence is always reported.
//
// PURITY
// ------
// No mutation of any argument, no I/O, no randomness, no clock. The
// cycle is passed in, never read from a global. `G` is never
// imported: every function takes what it needs as an argument.

import {
  DIVERGENCE_RECENCY_WINDOW,
  DIVERGENCE_LIFECYCLE_KINDS
} from "./claimLedger.js";

/* ============================================================
   STATUSES
============================================================ */

/*
 * The closed set of divergence statuses.
 *
 * These are the only three values a snapshot's `status` can take.
 * A divergence that is open is either fresh or stale; a divergence
 * that is closed during the exported cycle is resolved.
 */
export const DIVERGENCE_STATUSES = Object.freeze({
  FRESH: "fresh",
  STALE: "stale",
  RESOLVED: "resolved"
});

/* ============================================================
   NORMALIZATION
============================================================ */

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeId(value) {
  const text = normalizeText(value);

  return text.length > 0 ? text : null;
}

function normalizeQuantity(value) {
  const quantity = Number(value);

  return Number.isFinite(quantity) ? quantity : 0;
}

/* ============================================================
   FRESHNESS
============================================================ */

/*
 * Whether a divergence is still fresh at the given cycle.
 *
 * This is the SAME rule the engine uses to decide whether to surface
 * a divergence: the belief and the reality last parted company no
 * more than DIVERGENCE_RECENCY_WINDOW cycles ago. It is restated
 * here rather than imported from a reader so that the telemetry
 * module depends on no engine state, but the window it compares
 * against is the single exported constant, so the two cannot drift.
 *
 * A divergence with no onset cycle has no age, so it is never fresh.
 */
export function isDivergenceFresh(onsetCycle, currentCycle) {
  if (onsetCycle == null || !Number.isFinite(Number(onsetCycle))) return false;

  return (
    Number(currentCycle) - Number(onsetCycle) <=
    DIVERGENCE_RECENCY_WINDOW
  );
}

/*
 * How many cycles ago the divergence began.
 *
 * Null when the divergence has no onset cycle: there is no age to
 * report, and reporting zero would claim the divergence began this
 * cycle.
 */
export function divergenceAge(onsetCycle, currentCycle) {
  if (onsetCycle == null || !Number.isFinite(Number(onsetCycle))) return null;
  if (!Number.isFinite(Number(currentCycle))) return null;

  return Number(currentCycle) - Number(onsetCycle);
}

/* ============================================================
   ENUMERATION
============================================================ */

/*
 * Every open divergence, as `{ simId, definitionId, entry }`.
 *
 * The iteration order is fixed: prisoners by id, definitions by id.
 * A fixed order makes the output deterministic, so two runs of the
 * same simulation produce byte-identical exports.
 */
function enumerateOpenDivergences(divergence) {
  const open = [];

  if (
    !divergence ||
    typeof divergence !== "object" ||
    Array.isArray(divergence)
  ) {
    return open;
  }

  for (const simId of Object.keys(divergence).sort()) {
    const definitions = divergence[simId];

    if (
      !definitions ||
      typeof definitions !== "object" ||
      Array.isArray(definitions)
    ) {
      continue;
    }

    for (const definitionId of Object.keys(definitions).sort()) {
      const entry = definitions[definitionId];

      if (!entry || typeof entry !== "object") continue;

      open.push({
        simId: normalizeId(simId),
        definitionId: normalizeId(definitionId),
        entry
      });
    }
  }

  return open;
}

/*
 * The divergences that RESOLVED during the given cycle.
 *
 * Only the LAST resolution of a pair in that cycle is kept. A pair
 * can close and reopen inside one cycle, and the snapshot must
 * describe the END of the cycle, not every intermediate step.
 *
 * The map is keyed by `simId` and `definitionId` so the caller can
 * ask "did THIS pair close?" without re-deriving the key format.
 */
function collectResolutionsForCycle(divergenceEvents, cycle) {
  const resolved = new Map();

  const events = Array.isArray(divergenceEvents)
    ? divergenceEvents
    : [];

  for (const event of events) {
    if (!event || typeof event !== "object") continue;
    if (event.kind !== DIVERGENCE_LIFECYCLE_KINDS.RESOLVED) continue;
    if (event.cycle !== cycle) continue;

    const simId = normalizeId(event.subjectId);
    const definitionId = normalizeId(event.definitionId);

    if (!simId || !definitionId) continue;

    resolved.set(`${simId} ${definitionId}`, {
      simId,
      definitionId,
      entry: event
    });
  }

  return resolved;
}

/* ============================================================
   SNAPSHOTS
============================================================ */

/*
 * Build one snapshot record.
 *
 * The record is deliberately flat: it is written straight into the
 * export file and read by analysis scripts, so every field a
 * researcher needs is a scalar they can group by.
 */
function buildSnapshot({
  simId,
  definitionId,
  entry,
  currentCycle,
  status
}) {
  const onsetCycle =
    entry?.onsetCycle == null || !Number.isFinite(Number(entry?.onsetCycle))
      ? null
      : Number(entry.onsetCycle);
  const age = divergenceAge(onsetCycle, currentCycle);

  /*
   * A resolved divergence is never fresh: it is closed, and the
   * engine is not surfacing it to anybody. An open divergence is
   * fresh exactly when it is still inside the recency window.
   */
  const fresh =
    status !== DIVERGENCE_STATUSES.RESOLVED &&
    isDivergenceFresh(onsetCycle, currentCycle);

  return {
    cycle: currentCycle,
    simId,
    resourceId: normalizeId(entry?.claimedResourceId),
    definitionId,
    believedQuantity: normalizeQuantity(entry?.claimed),
    objectiveQuantity: normalizeQuantity(entry?.objective),
    onsetCycle,
    age,
    fresh,
    status
  };
}

/*
 * Every divergence snapshot for one cycle.
 *
 * The result contains one record per OPEN divergence, plus one
 * record per divergence that RESOLVED during the cycle.
 *
 * A divergence that is open wins over a resolution recorded for the
 * same pair in the same cycle: if the pair is diverging again at the
 * end of the cycle, then it IS diverging, and reporting it as
 * resolved would misdescribe the end state.
 */
export function collectDivergenceSnapshots(
  divergence,
  divergenceEvents,
  currentCycle
) {
  const cycle = Number.isFinite(Number(currentCycle))
    ? Number(currentCycle)
    : 0;

  const snapshots = [];
  const reported = new Set();

  for (const { simId, definitionId, entry } of enumerateOpenDivergences(
    divergence
  )) {
    const fresh = isDivergenceFresh(entry?.onsetCycle, cycle);

    reported.add(`${simId} ${definitionId}`);

    snapshots.push(buildSnapshot({
      simId,
      definitionId,
      entry,
      currentCycle: cycle,
      status: fresh
        ? DIVERGENCE_STATUSES.FRESH
        : DIVERGENCE_STATUSES.STALE
    }));
  }

  for (const [key, { simId, definitionId, entry }] of collectResolutionsForCycle(
    divergenceEvents,
    cycle
  )) {
    if (reported.has(key)) continue;

    snapshots.push(buildSnapshot({
      simId,
      definitionId,
      entry,
      currentCycle: cycle,
      status: DIVERGENCE_STATUSES.RESOLVED
    }));
  }

  return snapshots;
}

/* ============================================================
   COUNTS
============================================================ */

/*
 * The counts the divergence loop is measured by.
 *
 * `active` counts every open divergence, in either direction: the
 * prisoner believing they hold MORE than they do, and the prisoner
 * believing they hold LESS. Both are divergences. A researcher who
 * cares only about the harmful direction can filter the snapshots
 * on `believedQuantity > objectiveQuantity`.
 *
 * `fresh` and `stale` partition the active set: a divergence is
 * fresh while it is inside the recency window and stale once it is
 * not. `fresh + stale === active`, always.
 */
export function countDivergenceStates(
  divergence,
  divergenceEvents,
  currentCycle
) {
  const cycle = Number.isFinite(Number(currentCycle))
    ? Number(currentCycle)
    : 0;

  let active = 0;
  let fresh = 0;

  for (const { entry } of enumerateOpenDivergences(divergence)) {
    active += 1;

    if (isDivergenceFresh(entry?.onsetCycle, cycle)) fresh += 1;
  }

  const events = Array.isArray(divergenceEvents)
    ? divergenceEvents
    : [];

  let onsets = 0;
  let resolutions = 0;

  for (const event of events) {
    if (!event || typeof event !== "object") continue;

    if (event.kind === DIVERGENCE_LIFECYCLE_KINDS.ONSET) {
      onsets += 1;
      continue;
    }

    if (event.kind === DIVERGENCE_LIFECYCLE_KINDS.RESOLVED) {
      resolutions += 1;
    }
  }

  return {
    active,
    fresh,
    stale: active - fresh,
    onsets,
    resolutions
  };
}
