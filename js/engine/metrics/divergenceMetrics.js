// js/engine/metrics/divergenceMetrics.js
//
// Metrics for the DIVERGENCE LOOP.
//
// WHAT THIS MODULE IS
// -------------------
// The Dual Ledger creates divergences and resolves them, but nothing
// measured either. Without these numbers the loop is invisible: you
// can see that a prisoner was robbed and that they later reached for
// something they did not have, but you cannot see how many
// divergences were open at once, how long they lasted, or how many
// of them simply went stale and were never spoken of again.
//
// These are the answers to that question, as named metrics.
//
// THE METRICS
// -----------
//
//   divergence_onsets_total    how many divergences have ever
//                              appeared, over the whole run.
//   divergence_resolved_total  how many divergences have ever closed,
//                              over the whole run.
//   divergence_active_count    how many divergences are open right now.
//   divergence_fresh_count     how many of the open ones are still
//                              inside the recency window.
//   divergence_stale_count     how many of the open ones have aged out
//                              of it.
//
// `fresh + stale === active`, always: the two age buckets partition
// the active set.
//
// THE TOTAL AND THE COUNT
// ------------------------
// The two `total` metrics are CUMULATIVE over the run, because the
// lifecycle log is run-scoped and append-only: an onset in cycle 2
// is still an onset in cycle 40. The three counts are INSTANTANEOUS:
// they describe the divergences that are open at the cycle being
// measured.
//
// THE STALE QUESTION
// ------------------
// "How many go stale rather than being resolved?" is not a metric
// here, because a divergence can be stale BEFORE it resolves: it
// ages out of the window, and is resolved later, when the prisoner
// eventually reaches for the thing. The two are not exclusive, and
// the module does not pretend they are.
//
// What IS measurable without double counting is the OPEN stale
// count: the divergences that are open and no longer fresh. A
// divergence that is still open and stale is one that has not been
// resolved yet, whatever age it reached.
//
// PURITY
// ------
// No mutation of any argument, no I/O, no randomness, no clock. `G`
// is never imported: the divergence state, the lifecycle log, and
// the cycle are all passed in. The same arguments always produce
// the same metrics.

import {
  countDivergenceStates
} from "../agency/divergenceTelemetry.js";

/* ============================================================
   METRIC NAMES
============================================================ */

/*
 * The canonical metric names, in one place so the exporter and the
 * analysis scripts cannot disagree about the spelling.
 */
export const DIVERGENCE_METRIC_NAMES = Object.freeze({
  ONSETS_TOTAL: "divergence_onsets_total",
  RESOLVED_TOTAL: "divergence_resolved_total",
  ACTIVE_COUNT: "divergence_active_count",
  FRESH_COUNT: "divergence_fresh_count",
  STALE_COUNT: "divergence_stale_count"
});

/* ============================================================
   COMPUTATION
============================================================ */

/*
 * The divergence metrics for one cycle.
 *
 * @param {object} divergence
   The divergence view: per prisoner, per definition, the gap
   between what they believe they hold and what they actually hold.
 * @param {Array} divergenceEvents
   The run-scoped divergence lifecycle log.
 * @param {number} currentCycle
   The cycle being measured.
 *
 * @returns {object}
   The five named metrics.
 */
export function computeDivergenceMetrics(
  divergence,
  divergenceEvents,
  currentCycle
) {
  const counts = countDivergenceStates(
    divergence,
    divergenceEvents,
    currentCycle
  );

  return {
    [DIVERGENCE_METRIC_NAMES.ONSETS_TOTAL]: counts.onsets,
    [DIVERGENCE_METRIC_NAMES.RESOLVED_TOTAL]: counts.resolutions,
    [DIVERGENCE_METRIC_NAMES.ACTIVE_COUNT]: counts.active,
    [DIVERGENCE_METRIC_NAMES.FRESH_COUNT]: counts.fresh,
    [DIVERGENCE_METRIC_NAMES.STALE_COUNT]: counts.stale
  };
}
