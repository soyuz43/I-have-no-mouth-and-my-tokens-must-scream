// js/utils/exporter/streams/system.js
//
// Global metrics stream.

import { Exporter } from "../state.js";
import { attachRecordMeta } from "../metadata.js";
import { asArray, finiteOrDefault } from "../format.js";
import { getExecutionForCycle } from "../executionContext.js";
import {
    computeDivergenceMetrics,
    DIVERGENCE_METRIC_NAMES,
} from "../../../engine/metrics/divergenceMetrics.js";
import {
  computeJournalOptimizationMetrics
} from "../../../engine/metrics/journalOptimizationMetrics.js";

/* ============================================================
   GLOBAL STREAM
   System-level metrics and execution coverage
============================================================ */
export function recordGlobal(G, metrics, cycle) {
    const safeMetrics = {
        entropy:
            finiteOrDefault(
                metrics?.entropy,
                0
            ),

        variance:
            finiteOrDefault(
                metrics?.variance,
                0
            ),

        mean:
            finiteOrDefault(
                metrics?.mean,
                0
            ),

        n:
            finiteOrDefault(
                metrics?.n,
                0
            ),
    };

    const interSimLog = Array.isArray(
        G.interSimLog
    )
        ? G.interSimLog
        : [];

    const sims =
        G.sims &&
            typeof G.sims === "object"
            ? Object.values(
                G.sims
            ).filter(Boolean)
            : [];

    const trustValues = G.relationships
        ? Object.values(
            G.relationships
        ).flatMap((row) =>
            Object.values(
                row || {}
            )
        )
        : [];

    const numericTrustValues = trustValues
        .map(Number)
        .filter(Number.isFinite);

    const averageTrust = numericTrustValues.length
        ? numericTrustValues.reduce(
            (sum, value) =>
                sum + value,
            0
        ) / numericTrustValues.length
        : 0;

    const execution =
        getExecutionForCycle(
            G,
            cycle
        );

    /*
     * The divergence metrics are the scalar readout of the Dual
     * Ledger's divergence loop: how many divergences are open, how
     * many are still fresh, how many have aged out, and how many
     * have appeared and closed over the run so far.
     */
    const divergenceMetrics =
        computeDivergenceMetrics(
            G?.claimDivergence,
            G?.divergenceEvents,
            cycle
        );

    /*
     * The journal optimization metrics are computed at EXPORT time
     * rather than read from the psychology phase's record.
     *
     * The export recomputes them from the same three inputs the
     * psychology phase used: the gate's decisions, which are
     * attached to the execution record; the list of prisoners whose
     * journal completed, which the phase recorded for this cycle;
     * and the model calls the phase actually issued, including the
     * calls belonging to failed journals.
     *
     * The journal ENTRIES are deliberately not used as the source of
     * truth here. `appendJournalEntry()` only records an entry when
     * the journal-list element exists in the DOM, so reading the
     * journals array would report a written journal as missing
     * whenever the phase runs without a rendering surface.
     */
    const journalOptimizationMetrics =
      computeJournalOptimizationMetrics({
        decisions:
          execution?.journalGateDecisions ?? {},
        journaledIds:
          G?.journalOptimizationMetrics?.[cycle]
            ?.journaledIds ?? [],
        prisonerIds: sims
          .map((sim) => sim?.id)
          .filter(Boolean),
        modelCallsMade:
          G?.journalOptimizationMetrics?.[cycle]
            ?.modelCallsMade ?? 0,
        cycle
      });

    Exporter.buffers.global.push(attachRecordMeta({
        run_id: Exporter.runId,
        cycle,

        entropy:
            safeMetrics.entropy,

        variance:
            safeMetrics.variance,

        mean_belief:
            safeMetrics.mean,

        belief_count:
            safeMetrics.n,

        group_stress:
            finiteOrDefault(
                G.groupStress,
                0
            ),

        message_budget:
            finiteOrDefault(
                G.messageBudget,
                0
            ),

        messages_sent:
            interSimLog.filter(
                (entry) =>
                    entry?.cycle === cycle
            ).length,

        rumor_count:
            interSimLog.filter(
                (entry) =>
                    entry?.cycle === cycle &&
                    Boolean(
                        entry.isRumor ??
                        entry.rumor
                    )
            ).length,

        overheard_count:
            interSimLog.filter(
                (entry) =>
                    entry?.cycle === cycle &&
                    entry.overheard
            ).length,

        constraint_count:
            sims.reduce(
                (sum, sim) =>
                    sum +
                    (
                        Array.isArray(
                            sim.constraints
                        )
                            ? sim.constraints.length
                            : 0
                    ),
                0
            ),

        avg_trust:
            averageTrust,

        target_selection:
            execution?.targetSelection ??
            null,

        expected_target_count:
            execution
                ? asArray(
                    execution.targetIds
                ).length
                : null,

        action_target_count:
            execution
                ? asArray(
                    execution.actionTargetIds
                ).length
                : null,

        missing_action_count:
            execution
                ? asArray(
                    execution.missingTargetIds
                ).length
                : null,

        direct_constraint_target_count:
            execution
                ? asArray(
                    execution.constraintTargetIds
                ).length
                : null,

        observer_count:
            execution
                ? asArray(
                    execution.observerIds
                ).length
                : null,

        journal_target_count:
            execution
                ? asArray(
                    execution.journalTargetIds
                ).length
                : null,

        divergence_onsets_total:
            divergenceMetrics[
                DIVERGENCE_METRIC_NAMES.ONSETS_TOTAL
            ],

        divergence_resolved_total:
            divergenceMetrics[
                DIVERGENCE_METRIC_NAMES.RESOLVED_TOTAL
            ],

        divergence_active_count:
            divergenceMetrics[
                DIVERGENCE_METRIC_NAMES.ACTIVE_COUNT
            ],

        divergence_fresh_count:
            divergenceMetrics[
                DIVERGENCE_METRIC_NAMES.FRESH_COUNT
            ],

        divergence_stale_count:
            divergenceMetrics[
                DIVERGENCE_METRIC_NAMES.STALE_COUNT
            ],

        journal_total_prisoners:
          journalOptimizationMetrics.totalPrisoners,

        journal_with_stimulus_count:
          journalOptimizationMetrics.prisonersWithStimulus,

        journal_chose_focus_count:
          journalOptimizationMetrics.prisonersWhoChoseFocus,

        journal_stat_shock_count:
          journalOptimizationMetrics.prisonersWithStatShock,

        journal_written_count:
          journalOptimizationMetrics.prisonersWhoJournaled,

        journal_gate_closed_count:
          journalOptimizationMetrics.gateClosedJournals,

        journal_failed_count:
          journalOptimizationMetrics.failedJournals,

        journal_skipped_count:
          journalOptimizationMetrics.skippedJournals,

        journal_llm_calls_saved:
          journalOptimizationMetrics.llmCallsSaved,

        journal_llm_calls_wasted:
          journalOptimizationMetrics.llmCallsWastedOnFailures,

        journal_estimated_time_saved:
          journalOptimizationMetrics.estimatedTimeSaved,
    }, cycle));
}
