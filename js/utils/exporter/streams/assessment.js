// js/utils/exporter/streams/assessment.js
//
// Strategy outcome assessments and novel-verb observability streams.

import { Exporter } from "../state.js";
import { attachRecordMeta } from "../metadata.js";
import { asArray, finiteOrDefault, finiteOrNull } from "../format.js";
import { getExecutionForCycle, normalizeActionForExport } from "../executionContext.js";

/* ============================================================
   ASSESSMENTS STREAM
   Strategy outcome evaluation
============================================================ */
export function recordAssessments(G, cycle) {
    const assessments =
        Array.isArray(
            G.amAssessments
        )
            ? G.amAssessments.filter(
                (assessment) =>
                    assessment?.cycle === cycle
            )
            : [];

    const execution =
        getExecutionForCycle(
            G,
            cycle
        );

    /*
     * Runtime decisions are authoritative only when they were
     * published for the cycle currently being exported.
     */
    const assessmentState =
        G.amAssessmentState?.cycle === cycle
            ? G.amAssessmentState
            : null;

    for (const assessment of assessments) {
        if (!assessment) continue;

        const agent =
            assessment.targetId ||
            assessment.target ||
            assessment.agent ||
            null;

        const action = agent
            ? normalizeActionForExport(
                execution?.actions?.[agent]
            )
            : null;

        const authoritativeTacticDecision =
            agent
                ? assessmentState
                    ?.targets?.[agent]
                    ?.tacticDecision ??
                null
                : null;

        Exporter.buffers.assessments.push(attachRecordMeta({
            run_id: Exporter.runId,
            cycle,
            agent,

            tactic_path:
                authoritativeTacticDecision
                    ?.tacticPath ??
                assessment.tacticPath ??
                null,

            assessed_phase_id:
                authoritativeTacticDecision
                    ?.assessedPhaseId ??
                assessment.phaseId ??
                null,

            derived_tactic_decision:
                authoritativeTacticDecision
                    ?.derivedTacticDecision ??
                null,

            tactic_decision:
                authoritativeTacticDecision
                    ?.tacticDecision ??
                null,

            /*
             * Retain the old generic column as an authoritative
             * decision alias for existing telemetry consumers.
             */
            decision:
                authoritativeTacticDecision
                    ?.tacticDecision ??
                null,

            transition_reason:
                authoritativeTacticDecision
                    ?.reason ??
                null,

            resulting_phase_id:
                authoritativeTacticDecision
                    ?.resultingPhaseId ??
                null,

            terminal:
                authoritativeTacticDecision
                    ? authoritativeTacticDecision
                        .terminal === true
                    : null,

            evaluation_score:
                assessment.evaluation_score ??
                null,

            auto_success:
                assessment.auto_success ??
                null,

            hypothesis_belief:
                assessment.hypothesis_belief ??
                null,

            hypothesis_direction:
                assessment.hypothesis_direction ??
                null,

            dHope:
                finiteOrNull(
                    assessment.dHope
                ),

            dSanity:
                finiteOrNull(
                    assessment.dSanity
                ),

            dSuffering:
                finiteOrNull(
                    assessment.dSuffering
                ),

            journal_hope_delta:
                finiteOrNull(
                    assessment.journal_hope_delta
                ),

            journal_sanity_delta:
                finiteOrNull(
                    assessment.journal_sanity_delta
                ),

            journal_suffering_delta:
                finiteOrNull(
                    assessment.journal_suffering_delta
                ),

            confidence_before:
                finiteOrNull(
                    assessment.confidence_before
                ),

            confidence_after:
                finiteOrNull(
                    assessment.confidence_after ??
                    assessment.confidence
                ),

            was_constrained:
                Boolean(
                    assessment.was_constrained
                ),

            constraint_intensity:
                finiteOrDefault(
                    assessment.constraint_intensity,
                    0
                ),

            action_generated:
                execution
                    ? Boolean(
                        action?.text
                    )
                    : null,

            action_origin:
                action?.origin ??
                null,

            missing_from_execution:
                execution && agent
                    ? asArray(
                        execution.missingTargetIds
                    ).includes(agent)
                    : null,

            journal_scheduled:
                execution && agent
                    ? asArray(
                        execution.journalTargetIds
                    ).includes(agent)
                    : null,

            timestamp:
                assessment.timestamp ??
                Date.now(),
        }, cycle));
    }
}

/* ============================================================
   OBSERVABILITY UNKNOWN STREAM
   Novel verbs flagged for lexicon expansion
============================================================ */
export function recordObservabilityUnknowns(G, cycle) {
    const unknowns =
        Array.isArray(
            G.observabilityUnknowns
        )
            ? G.observabilityUnknowns
            : [];

    const cycleUnknowns =
        unknowns.filter(
            (unknown) =>
                unknown?.cycle === cycle
        );

    for (const unknown of cycleUnknowns) {
        Exporter.buffers.observability_unknowns.push(attachRecordMeta({
            run_id:
                Exporter.runId,

            cycle:
                unknown.cycle,

            verb:
                unknown.verb ||
                null,

            outcome:
                typeof unknown.outcome === "string"
                    ? unknown.outcome.slice(
                        0,
                        200
                    )
                    : null,

            timestamp:
                unknown.timestamp ||
                Date.now(),

            agent:
                unknown.agent ||
                null,

            observability_tier:
                unknown.tier ??
                "unknown",

            observability_method:
                unknown.method ??
                "fallback",
        }, cycle));
    }
}
