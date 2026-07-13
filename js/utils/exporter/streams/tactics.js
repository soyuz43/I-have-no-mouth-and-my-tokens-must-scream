// js/utils/exporter/streams/tactics.js
//
// Tactic efficacy, AM strategy fulfillment, and per-agent execution provenance streams.

import { Exporter } from "../state.js";
import { attachRecordMeta } from "../metadata.js";
import { asArray, finiteOrNull, joinList, safeRatio, slugify } from "../format.js";
import { getExecutionForCycle, collectExecutionAgentIds, normalizeActionForExport, normalizePerceptionForExport } from "../executionContext.js";

/* ============================================================
   TACTICS STREAM
   Deployed-tactic efficacy tracking
============================================================ */
export function recordTactics(G, cycle) {
    for (
        const [agentId, sim]
        of Object.entries(G.sims || {})
    ) {
        if (!sim) continue;

        const history = Array.isArray(
            sim.tacticHistory
        )
            ? sim.tacticHistory
            : [];

        const cycleTactics = history.filter(
            (entry) =>
                entry?.cycle === cycle
        );

        for (const tactic of cycleTactics) {
            if (!tactic) continue;

            const reported =
                tactic.deltas?.reported ||
                {};

            const effective =
                tactic.deltas?.effective ||
                {};

            Exporter.buffers.tactics.push(attachRecordMeta({
                run_id: Exporter.runId,
                cycle,

                tactic_id:
                    tactic.id ||
                    tactic.path ||
                    slugify(
                        tactic.title
                    ) ||
                    null,

                tactic_title:
                    tactic.title ||
                    null,

                tactic_path:
                    tactic.path ||
                    null,

                category:
                    tactic.category ||
                    null,

                subcategory:
                    tactic.subcategory ||
                    null,

                agent:
                    agentId,

                execution_origin:
                    tactic.executionOrigin ??
                    null,

                trigger_condition:
                    tactic.trigger ||
                    null,

                execution_summary:
                    typeof tactic.execution === "string"
                        ? tactic.execution.slice(
                            0,
                            200
                        )
                        : null,

                expected_outcome:
                    tactic.outcome ||
                    null,

                expires_cycle:
                    tactic.expiresCycle ??
                    null,

                discovered_cycle:
                    tactic.discoveredCycle ??
                    tactic.cycle ??
                    cycle,

                reported_hope_delta:
                    finiteOrNull(
                        reported.hope
                    ),

                reported_sanity_delta:
                    finiteOrNull(
                        reported.sanity
                    ),

                reported_suffering_delta:
                    finiteOrNull(
                        reported.suffering
                    ),

                effective_hope_delta:
                    finiteOrNull(
                        effective.hope
                    ),

                effective_sanity_delta:
                    finiteOrNull(
                        effective.sanity
                    ),

                effective_suffering_delta:
                    finiteOrNull(
                        effective.suffering
                    ),

                effectiveness_ratio_hope:
                    safeRatio(
                        effective.hope,
                        reported.hope
                    ),

                effectiveness_ratio_sanity:
                    safeRatio(
                        effective.sanity,
                        reported.sanity
                    ),

                effectiveness_ratio_suffering:
                    safeRatio(
                        effective.suffering,
                        reported.suffering
                    ),
            }, cycle));
        }
    }
}

/* ============================================================
   STRATEGIES STREAM
   AM intent and execution fulfillment
============================================================ */
export function recordStrategies(G, cycle) {
    const targets =
        G.amStrategy?.targets ||
        {};

    const execution =
        getExecutionForCycle(
            G,
            cycle
        );

    for (
        const [agentId, rawStrategy]
        of Object.entries(targets)
    ) {
        if (!rawStrategy) continue;

        const strategy =
            typeof rawStrategy === "object"
                ? rawStrategy
                : {
                    objective:
                        String(
                            rawStrategy
                        ),
                };

        const action =
            normalizeActionForExport(
                execution?.actions?.[agentId]
            );

        const perception =
            normalizePerceptionForExport(
                execution?.perceptions?.[agentId]
            );

        Exporter.buffers.strategies.push(attachRecordMeta({
            run_id: Exporter.runId,
            cycle,
            agent: agentId,

            objective:
                strategy.objective ||
                null,

            hypothesis:
                strategy.hypothesis ||
                null,

            evidence:
                strategy.reasoning?.evidence ||
                strategy.evidence ||
                null,

            why_now:
                strategy.reasoning?.why_now ||
                strategy.why_now ||
                null,

            confidence:
                finiteOrNull(
                    strategy.confidence
                ),

            hypothesis_belief:
                strategy.lastPrediction?.belief ||
                strategy.prediction?.belief ||
                null,

            hypothesis_direction:
                strategy.lastPrediction?.direction ||
                strategy.prediction?.direction ||
                null,

            observability_tier:
                strategy.observability?.tier ||
                strategy._observability?.tier ||
                null,

            derived_from_group:
                Boolean(
                    strategy._derivedFromGroup
                ),

            execution_available:
                Boolean(execution),

            action_generated:
                execution
                    ? Boolean(
                        action?.text
                    )
                    : null,

            action_origin:
                action?.origin ??
                null,

            action_tactic:
                action?.tactic ??
                null,

            action_length:
                action?.text?.length ??
                0,

            missing_from_execution:
                execution
                    ? asArray(
                        execution.missingTargetIds
                    ).includes(agentId)
                    : null,

            direct_constraint_target:
                execution
                    ? asArray(
                        execution.constraintTargetIds
                    ).includes(agentId)
                    : null,

            successful_observer:
                execution
                    ? asArray(
                        execution.observerIds
                    ).includes(agentId)
                    : null,

            perception_origin:
                perception?.origin ??
                null,

            journal_scheduled:
                execution
                    ? asArray(
                        execution.journalTargetIds
                    ).includes(agentId)
                    : null,
        }, cycle));
    }
}

/* ============================================================
   EXECUTIONS STREAM
   Per-agent planned-versus-actual execution provenance
============================================================ */
export function recordExecutions(G, cycle) {
    const execution =
        getExecutionForCycle(
            G,
            cycle
        );

    if (!execution) {
        return;
    }

    const expectedTargetIds =
        asArray(
            execution.targetIds
        );

    const actionTargetIds =
        asArray(
            execution.actionTargetIds
        );

    const constraintTargetIds =
        asArray(
            execution.constraintTargetIds
        );

    const activeConstraintTargetIds =
        asArray(
            execution.activeConstraintTargetIds
        );

    const observerIds =
        asArray(
            execution.observerIds
        );

    const journalTargetIds =
        asArray(
            execution.journalTargetIds
        );

    const missingTargetIds =
        asArray(
            execution.missingTargetIds
        );

    const nonJournalExpectedTargetIds =
        asArray(
            execution.nonJournalExpectedTargetIds
        );

    const agentIds =
        collectExecutionAgentIds(
            G,
            execution
        );

    for (const agentId of agentIds) {
        const action =
            normalizeActionForExport(
                execution.actions?.[agentId]
            );

        const perception =
            normalizePerceptionForExport(
                execution.perceptions?.[agentId]
            );

        const sim =
            G.sims?.[agentId];

        const activeConstraints =
            Array.isArray(
                sim?.constraints
            )
                ? sim.constraints
                : [];

        Exporter.buffers.executions.push(attachRecordMeta({
            run_id: Exporter.runId,
            cycle,
            agent: agentId,

            target_selection:
                execution.targetSelection ??
                null,

            was_expected_target:
                expectedTargetIds.includes(
                    agentId
                ),

            action_generated:
                Boolean(
                    action?.text
                ),

            action_origin:
                action?.origin ??
                null,

            action_tactic:
                action?.tactic ??
                null,

            action_text:
                action?.text ??
                null,

            action_length:
                action?.text?.length ??
                0,

            was_action_target:
                actionTargetIds.includes(
                    agentId
                ),

            direct_constraint_target:
                constraintTargetIds.includes(
                    agentId
                ),

            active_constraint_target:
                activeConstraintTargetIds.includes(
                    agentId
                ) ||
                activeConstraints.length > 0,

            active_constraint_count:
                activeConstraints.length,

            active_constraint_ids:
                joinList(
                    activeConstraints.map(
                        (constraint) =>
                            constraint?.id
                    )
                ),

            successful_observer:
                observerIds.includes(
                    agentId
                ),

            perception_present:
                Boolean(
                    perception?.text
                ),

            perception_origin:
                perception?.origin ??
                null,

            perception_text:
                perception?.text ??
                null,

            perception_length:
                perception?.text?.length ??
                0,

            observed_target_ids:
                joinList(
                    perception?.observedTargetIds
                ),

            journal_scheduled:
                journalTargetIds.includes(
                    agentId
                ),

            expected_but_not_journaled:
                nonJournalExpectedTargetIds.includes(
                    agentId
                ),

            missing_expected_action:
                missingTargetIds.includes(
                    agentId
                ),

            parser_recovered_action:
                action?.origin ===
                "parser_recovery",
        }, cycle));
    }
}
