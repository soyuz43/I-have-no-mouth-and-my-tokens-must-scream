// js/engine/metrics/journalOptimizationMetrics.js
//
// Metrics for the MENTAL FOCUS GATE.
//
// WHAT THIS MODULE MEASURES
// -------------------------
// The gate decides who writes the deep, belief-updating journal.
// Each journal costs TWO model calls: the narrative call and the
// forensic stats call. So the number of prisoners who DID NOT write
// is the number of two-call pipelines that did not run, and that is
// the cycle time this feature is meant to reclaim.
//
// WHY THIS IS A SEPARATE MODULE
// -----------------------------
// It is NOT part of `agency/divergenceTelemetry.js`, even though the
// feature request named that file. That module's contract is
// explicit: it measures the DIVERGENCE LOOP, it reads no globals,
// and it is the single definition of what a divergence snapshot
// means. Journal scheduling is a different subsystem with a
// different vocabulary, and folding it in would blur two unrelated
// measurement domains and break a stated purity boundary.
//
// The convention this module follows instead is the one the rest of
// the metrics layer follows: the cycle is PASSED IN, `G` is never
// imported, and the same inputs always produce the same output.
//
// WHAT THE COUNTS MEAN
// --------------------
//
//   totalPrisoners        how many prisoners the cycle considered.
//   prisonersWithStimulus  how many had something happen to them.
//   prisonersWhoChoseFocus how many PAID for a focused journal.
//   prisonersWithStatShock how many crossed a severe stat threshold.
//   prisonersWhoJournaled  how many actually wrote.
//
// The middle three are NOT a partition of the last one. A prisoner
// can have a stimulus AND a stat shock, and a prisoner who chose to
// focus may also have had a stimulus. They are overlapping
// descriptions of why people wrote, and the gate reports all
// applicable reasons for each prisoner. The one count that IS a
// partition is `skippedJournals`, which is exactly
// `totalPrisoners - prisonersWhoJournaled`.
//
// THE SKIP COUNT IS A MEASUREMENT, NOT A GUARANTEE
// -------------------------------------------------
// `llmCallsSaved` is the number of calls that were NOT made
// because those prisoners did not write. It is a count of what the
// gate avoided, not a measurement of wall-clock time. The
// `estimatedTimeSaved` field converts it using a fixed per-call
// estimate, and that estimate is an ASSUMPTION, not a measurement.
// It is reported separately and labelled as such, so no downstream
// analysis mistakes it for an observed duration.
//
// PURITY
// ------
// No mutation of any argument, no I/O, no randomness, no clock. `G`
// is never imported: the decisions and the cycle are passed in.

/* ============================================================
   ASSUMPTIONS
============================================================ */

/*
 * The assumed wall-clock cost of one model call.
 *
 * This is a ROUNDING ASSUMPTION used to express the call savings in
 * a unit a human can read. It is deliberately a single named
 * constant rather than a literal repeated at each use site, so
 * that changing the assumption is a single edit and so that its
 * status as an assumption is visible at the point of use.
 */
export const ASSUMED_SECONDS_PER_MODEL_CALL = 40;

/*
 * The number of model calls one journal costs.
 *
 * A journal is TWO calls: the narrative call and the forensic
 * stats call. Both are skipped together when the gate closes.
 */
export const MODEL_CALLS_PER_JOURNAL = 2;

/* ============================================================
   COMPUTATION
============================================================ */

/*
 * The journal optimization metrics for one cycle.
 *
 * `decisions` is the gate's per-prisoner decision map, as produced
 * by the psychology phase: prisoner id -> { shouldJournal,
 * hasStimulus, chosePrepareJournal, hasStatShock, reasons }.
 *
 * `journaledIds` is the list of prisoners who ACTUALLY wrote. It is
 * passed separately because the gate decides who QUALIFIES while
 * the write itself can still fail - a model error, a scaffold
 * rejection, or a parse failure can leave a qualified prisoner
 * without a journal. Reporting the gate's opinion as the outcome
 * would overstate the savings.
 *
 * @param {object} decisions
 *   The gate decisions, keyed by prisoner id.
 * @param {Array<string>} journaledIds
 *   The ids of the prisoners who actually wrote a journal.
 * @param {Array<string>} prisonerIds
 *   Every prisoner the cycle considered.
 * @param {number} cycle
 *   The cycle being measured.
 */
export function computeJournalOptimizationMetrics({
  decisions = {},
  journaledIds = [],
  prisonerIds = [],
  cycle = 0
} = {}) {
  const decisionMap =
    decisions &&
    typeof decisions === "object"
      ? decisions
      : {};

  const journaled = new Set(
    (Array.isArray(journaledIds) ? journaledIds : [])
      .filter(Boolean)
  );

  const considered = (Array.isArray(prisonerIds)
    ? prisonerIds
    : Object.keys(decisionMap)).filter(Boolean);

  const totalPrisoners = considered.length;

  let prisonersWithStimulus = 0;
  let prisonersWhoChoseFocus = 0;
  let prisonersWithStatShock = 0;

  for (const id of considered) {
    const decision = decisionMap[id];

    if (!decision) continue;

    if (decision.hasStimulus === true) prisonersWithStimulus += 1;
    if (decision.chosePrepareJournal === true) prisonersWhoChoseFocus += 1;
    if (decision.hasStatShock === true) prisonersWithStatShock += 1;
  }

  const prisonersWhoJournaled = journaled.size;

  /*
   * A prisoner who did not write is a skipped journal, whether they
   * were skipped because the gate closed or because their journal
   * failed after the gate opened. Both are two-call pipelines that
   * did not complete.
   */
  const skippedJournals = Math.max(
    0,
    totalPrisoners - prisonersWhoJournaled
  );

  const llmCallsSaved =
    skippedJournals * MODEL_CALLS_PER_JOURNAL;

  return {
    cycle: Number(cycle) || 0,

    totalPrisoners,
    prisonersWithStimulus,
    prisonersWhoChoseFocus,
    prisonersWithStatShock,
    prisonersWhoJournaled,
    skippedJournals,
    llmCallsSaved,

    /*
     * WHO wrote, not just how many.
     *
     * The exporter reads this back so it does not have to
     * re-derive the written set from a DOM-dependent structure.
     */
    journaledIds: [...journaled],

    /*
     * The ASSUMED saving, in seconds. See the module header: this
     * is a per-call estimate, not an observed duration.
     */
    estimatedTimeSavedSeconds:
      llmCallsSaved * ASSUMED_SECONDS_PER_MODEL_CALL,

    estimatedTimeSaved:
      `${Math.round(
        llmCallsSaved * ASSUMED_SECONDS_PER_MODEL_CALL
      )}s`
  };
}
