// js/utils/exporter/streams/system.js
//
// Global metrics stream.

import { Exporter } from "../state.js";
import { attachRecordMeta } from "../metadata.js";
import { asArray, finiteOrDefault } from "../format.js";
import { getExecutionForCycle } from "../executionContext.js";

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
    }, cycle));
}
