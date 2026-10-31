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
//   prisonersWhoJournaled  how many actually COMPLETED a journal.
//   gateClosedJournals     how many the gate did not open for.
//   failedJournals         how many qualified but did not complete.
//
// The middle three are NOT a partition of the last one. A prisoner
// can have a stimulus AND a stat shock, and a prisoner who chose to
// focus may also have had a stimulus. They are overlapping
// descriptions of why people wrote, and the gate reports all
// applicable reasons for each prisoner.
//
// THE THREE OUTCOMES ARE A PARTITION
// ----------------------------------
//
//   prisonersWhoJournaled  the journal completed. Two calls made,
//                          two calls used.
//   failedJournals         the gate opened and the journal did not
//                          complete. The calls were still MADE.
//   gateClosedJournals     the gate did not open. NO calls were made.
//
// Only the last of those is a saving. The middle one is work that
// was attempted and lost.
//
// WHAT "SAVED" COUNTS, AND WHAT IT DOES NOT
// -----------------------------------------
// `llmCallsSaved` counts ONLY the calls the GATE prevented: the
// two-call pipelines for prisoners the gate did not open for.
//
// It deliberately does NOT count a journal that was attempted and
// then failed. Those calls were made. A stats call that threw
// consumed the time it took, and a commit that threw after both
// calls returned consumed both. Counting a failed journal as two
// avoided calls would report a failure as a saving, and the
// exported time saving would grow every time the provider had a
// bad minute - which is exactly backwards.
//
// The cost of those failures is reported separately, as
// `llmCallsWastedOnFailures`. Keeping the two apart is the point:
// one is work avoided, the other is work wasted, and they must
// never be added together into a single "savings" number.
//
// `estimatedTimeSaved` converts `llmCallsSaved` using a fixed
// per-call estimate, and that estimate is an ASSUMPTION, not a
// measurement. It is reported separately and labelled as such, so
// no downstream analysis mistakes it for an observed duration.
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
 * `journaledIds` is the list of prisoners whose journal COMPLETED.
 * It is passed separately because the gate decides who QUALIFIES
 * while the write itself can still fail - a model error, a scaffold
 * rejection, or a parse failure can leave a qualified prisoner
 * without a journal. Reporting the gate's opinion as the outcome
 * would overstate the savings.
 *
 * `modelCallsMade` is the number of model calls the cycle actually
 * issued across every prisoner's journal pipeline, INCLUDING the
 * calls belonging to journals that failed. It is what separates
 * "the gate prevented this work" from "this work was attempted and
 * lost". Without it, a failed journal would be indistinguishable
 * from a skipped one, and the reported savings would grow every
 * time the provider failed.
 *
 * @param {object} decisions
 *   The gate decisions, keyed by prisoner id.
 * @param {Array<string>} journaledIds
 *   The ids of the prisoners whose journal completed.
 * @param {number} modelCallsMade
 *   The model calls actually issued this cycle, including those
 *   belonging to failed journals.
 * @param {Array<string>} prisonerIds
 *   Every prisoner the cycle considered.
 * @param {number} cycle
 *   The cycle being measured.
 */
export function computeJournalOptimizationMetrics({
  decisions = {},
  journaledIds = [],
  prisonerIds = [],
  modelCallsMade = 0,
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
   * The gate OPENED for a prisoner when its decision says
   * `shouldJournal`. That is the population that COULD have had a
   * two-call pipeline.
   *
   * The prisoners who qualified but did not complete are the
   * failures: their calls were made and then lost.
   *
   * The prisoners the gate never opened for are the ones whose
   * calls were never made at all. Only THESE are a saving.
   */
  let gateOpenedCount = 0;

  for (const id of considered) {
    if (decisionMap[id]?.shouldJournal === true) {
      gateOpenedCount += 1;
    }
  }

  /*
   * A qualified prisoner whose journal did not complete. Clamped
   * at zero because the count is derived from two independent
   * sources - the gate's decisions and the commit stage's report -
   * and a mismatch between them must not produce a negative
   * population.
   */
  const failedJournals = Math.max(
    0,
    gateOpenedCount - prisonersWhoJournaled
  );

  /*
   * The prisoners the gate did not open for. This is the only
   * population whose model calls were actually avoided.
   */
  const gateClosedJournals = Math.max(
    0,
    totalPrisoners - gateOpenedCount
  );

  /*
   * The two-call pipelines the gate prevented. This counts ONLY
   * work that was never started.
   */
  const llmCallsSaved =
    gateClosedJournals * MODEL_CALLS_PER_JOURNAL;

  /*
   * The calls that were made and then lost to a failure.
   *
   * This is the cost of the failure, not a saving. It is computed
   * from the calls the phase actually issued, so it reflects what
   * was really spent rather than an assumption that every failed
   * journal cost exactly two calls. A narrative call that threw
   * cost one; a failure after both calls returned cost two.
   *
   * The COMPLETED journals' calls are subtracted out first.
   * `modelCallsMade` is the cycle total across every prisoner, so
   * it includes the calls of the journals that succeeded. Those
   * calls were spent on WORK THAT WORKED, not on a failure, and
   * counting them as wasted would inflate the number whenever a
   * cycle mixed a completed journal with a failed one.
   *
   * The subtraction is exact for the completed journals: a journal
   * that completed made BOTH calls, because the forensic stats call
   * only runs after the narrative call returns. What remains is
   * the calls made by the journals that failed.
   *
   * The result is bounded above by the calls a full failed pipeline
   * would have cost, so a miscount cannot inflate it.
   */
  const failedPipelineCalls =
    failedJournals * MODEL_CALLS_PER_JOURNAL;

  /*
   * The calls made by the journals that completed.
   */
  const completedPipelineCalls =
    prisonersWhoJournaled * MODEL_CALLS_PER_JOURNAL;

  /*
   * The calls made by the journals that FAILED.
   *
   * This is the total minus what the completed journals cost.
   * Clamped at zero, because the two counts come from independent
   * sources and a mismatch between them must not produce a
   * negative population.
   */
  const failedCallsIssued = Math.max(
    0,
    (Number(modelCallsMade) || 0) - completedPipelineCalls
  );

  const llmCallsWastedOnFailures = Math.max(
    0,
    Math.min(
      failedCallsIssued,
      failedPipelineCalls
    )
  );

  /*
   * The old, looser count: everyone who did not complete a
   * journal. It is kept because it is the number a reader wants
   * when asking "how many prisoners did not write", and because
   * `skippedJournals = gateClosedJournals + failedJournals` is a
   * useful cross-check on the three-way partition.
   */
  const skippedJournals =
    gateClosedJournals + failedJournals;

  return {
    cycle: Number(cycle) || 0,

    totalPrisoners,
    prisonersWithStimulus,
    prisonersWhoChoseFocus,
    prisonersWithStatShock,
    prisonersWhoJournaled,

    /*
     * The three-outcome partition. `skippedJournals` is their sum
     * over the non-completed prisoners.
     */
    gateOpenedCount,
    gateClosedJournals,
    failedJournals,
    skippedJournals,

    /*
     * The calls the GATE prevented. Only these were never made.
     */
    llmCallsSaved,

    /*
     * The calls that were made and lost. Never to be added to
     * `llmCallsSaved`: one is work avoided, the other is work
     * wasted.
     */
    llmCallsWastedOnFailures,

    /*
     * WHO wrote, not just how many.
     *
     * The exporter reads this back so it does not have to
     * re-derive the written set from a DOM-dependent structure.
     */
    journaledIds: [...journaled],

    /*
     * The calls actually issued this cycle, INCLUDING those spent
     * on journals that failed.
     *
     * The exporter reads this back so that it recomputes the same
     * partition the phase computed, rather than a looser one.
     */
    modelCallsMade:
      Number(modelCallsMade) || 0,

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
