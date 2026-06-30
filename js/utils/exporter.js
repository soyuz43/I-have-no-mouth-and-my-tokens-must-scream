// js/utils/exporter.js
//
// Structured measurement/export layer for the AM Torment Engine.
// Records intent, execution, observation, journaling, state changes,
// constraints, relationships, communication, and assessment provenance.

import { downloadTextFile } from "./downloadTextFile.js";

/* ============================================================
   EXPORTER STATE
============================================================ */

const Exporter = {
    runId: null,

    buffers: {
        state: [],
        dynamics: [],
        constraints: [],
        relationships: [],
        messages: [],
        global: [],
        decisions: [],
        phases: [],
        tactics: [],
        strategies: [],
        executions: [],
        observations: [],
        journal_events: [],
        belief_evidence: [],
        assessments: [],
        observability_unknowns: [],
    },

    // State captured at the beginning of the current cycle.
    prevState: null,

    /*
     * Full telemetry from the most recently completed cycle.
     * This is cloned before temporary buffers are cleared.
     */
    lastCompletedCycle: null,

    /*
     * Bounded analytical history for live UI projections.
     * This intentionally excludes large journal and evidence text.
     */
    overviewHistory: [],
    overviewHistoryMax: 100,
};

/* ============================================================
   INITIALIZATION
============================================================ */


export function initExporter(runId = null) {
    Exporter.runId = runId || `am_run_${Date.now()}`;
    Exporter.prevState = null;

    Exporter.lastCompletedCycle = null;
    Exporter.overviewHistory = [];

    clearAllBuffers();

    console.log(`[EXPORTER] Initialized run ${Exporter.runId}`);
}

/* ============================================================
   READ-ONLY LIVE TELEMETRY ACCESS
   ------------------------------------------------------------
   Returns detached copies so UI code cannot mutate exporter
   buffers or retained history.
============================================================ */

export function getExporterOverviewData() {
    return cloneValue({
        runId:
            Exporter.runId,

        latestCycle:
            Exporter.lastCompletedCycle,

        history:
            Exporter.overviewHistory,

        historyLimit:
            Exporter.overviewHistoryMax,
    });
}

/* ============================================================
   STATE STREAM
   Core psychological trajectory
============================================================ */

export function recordState(G, cycle) {
    for (const [id, sim] of Object.entries(G.sims || {})) {
        if (!sim) continue;

        Exporter.buffers.state.push({
            run_id: Exporter.runId,
            cycle,
            agent: id,
            sanity: finiteOrNull(sim.sanity),
            hope: finiteOrNull(sim.hope),
            suffering: finiteOrNull(sim.suffering),
            physical_stress: finiteOrDefault(sim.physical_stress, 0),
            timestamp: Date.now(),
        });
    }
}

/* ============================================================
   DYNAMICS STREAM
   Attribution-aware deltas
============================================================ */

export function recordDynamics(G, cycle) {
    if (!Exporter.prevState || !G.beliefSnapshots) return;

    for (const [id, sim] of Object.entries(G.sims || {})) {
        if (!sim) continue;

        const previous = Exporter.prevState[id];
        if (!previous) continue;

        const prePsych = G.beliefSnapshots.prePsychology?.[id] || {};
        const postPsych = G.beliefSnapshots.postPsychology?.[id] || {};
        const final = G.beliefSnapshots.final?.[id] || {};

        const amEffect = {
            dSanity:
                (postPsych.sanity ?? sim.sanity) -
                (prePsych.sanity ?? previous.sanity),

            dHope:
                (postPsych.hope ?? sim.hope) -
                (prePsych.hope ?? previous.hope),

            dSuffering:
                (postPsych.suffering ?? sim.suffering) -
                (prePsych.suffering ?? previous.suffering),
        };

        const contagionEffect = {
            dSanity:
                (final.sanity ?? sim.sanity) -
                (postPsych.sanity ?? sim.sanity),

            dHope:
                (final.hope ?? sim.hope) -
                (postPsych.hope ?? sim.hope),

            dSuffering:
                (final.suffering ?? sim.suffering) -
                (postPsych.suffering ?? sim.suffering),
        };

        Exporter.buffers.dynamics.push({
            run_id: Exporter.runId,
            cycle,
            agent: id,

            dSanity_total: finiteDifference(
                sim.sanity,
                previous.sanity
            ),

            dHope_total: finiteDifference(
                sim.hope,
                previous.hope
            ),

            dSuffering_total: finiteDifference(
                sim.suffering,
                previous.suffering
            ),

            dPhysicalStress_total: finiteDifference(
                sim.physical_stress,
                previous.physical_stress
            ),

            dSanity_am: finiteOrDefault(
                amEffect.dSanity,
                0
            ),

            dHope_am: finiteOrDefault(
                amEffect.dHope,
                0
            ),

            dSuffering_am: finiteOrDefault(
                amEffect.dSuffering,
                0
            ),

            dSanity_contagion: finiteOrDefault(
                contagionEffect.dSanity,
                0
            ),

            dHope_contagion: finiteOrDefault(
                contagionEffect.dHope,
                0
            ),

            dSuffering_contagion: finiteOrDefault(
                contagionEffect.dSuffering,
                0
            ),
        });
    }
}

/* ============================================================
   CONSTRAINTS STREAM
   Active constraint snapshots with effect metadata
============================================================ */

export function recordConstraints(G, cycle) {
    for (const [id, sim] of Object.entries(G.sims || {})) {
        if (!sim) continue;

        const constraints = Array.isArray(sim.constraints)
            ? sim.constraints
            : [];

        for (const constraint of constraints) {
            if (!constraint) continue;

            Exporter.buffers.constraints.push({
                run_id: Exporter.runId,
                cycle,
                agent: id,

                constraint_type:
                    constraint.id ||
                    constraint.type ||
                    null,

                constraint_title:
                    constraint.title ||
                    null,

                constraint_subcategory:
                    constraint.subcategory ||
                    null,

                source:
                    constraint.source ||
                    null,

                applied_cycle:
                    constraint.appliedAt ??
                    constraint.applied_cycle ??
                    null,

                intensity:
                    finiteOrNull(
                        constraint.intensity
                    ),

                duration_remaining:
                    finiteOrNull(
                        constraint.remaining
                    ),

                duration_total:
                    finiteOrNull(
                        constraint.duration
                    ),

                stacks:
                    finiteOrDefault(
                        constraint.stacks,
                        1
                    ),

                fatigue_multiplier:
                    finiteOrDefault(
                        constraint.fatigueMult,
                        1
                    ),

                stat_multiplier:
                    finiteOrDefault(
                        constraint.totalMult ??
                        constraint.intensity,
                        1
                    ),

                physical_stress_added:
                    finiteOrDefault(
                        constraint.physicalStressAdded,
                        0
                    ),

                effective_suffering_range_min:
                    finiteOrDefault(
                        constraint.effectiveRange?.min,
                        0
                    ),

                effective_suffering_range_max:
                    finiteOrDefault(
                        constraint.effectiveRange?.max,
                        0
                    ),
            });
        }
    }
}

/* ============================================================
   RELATIONSHIPS STREAM
   Pairwise trust-matrix snapshots
============================================================ */

export function recordRelationships(G, cycle) {
    const sims = Object.values(
        G.sims || {}
    ).filter(Boolean);

    for (const source of sims) {
        for (const target of sims) {
            if (source.id === target.id) {
                continue;
            }

            const trust =
                G.relationships?.[source.id]?.[target.id] ??
                source.relationships?.[target.id] ??
                0;

            const trustBefore =
                G.prevRelationships?.[source.id]?.[target.id] ??
                0;

            Exporter.buffers.relationships.push({
                run_id: Exporter.runId,
                cycle,
                source: source.id,
                target: target.id,

                trust_before:
                    finiteOrDefault(
                        trustBefore,
                        0
                    ),

                trust_after:
                    finiteOrDefault(
                        trust,
                        0
                    ),

                trust_delta:
                    finiteDifference(
                        trust,
                        trustBefore
                    ),
            });
        }
    }
}

/* ============================================================
   MESSAGES STREAM
   Communication events
============================================================ */

export function recordMessages(G, cycle) {
    const communications = Array.isArray(
        G.interSimLog
    )
        ? G.interSimLog
        : [];

    const cycleMessages = communications.filter(
        (entry) => entry?.cycle === cycle
    );

    for (const message of cycleMessages) {
        if (!message) continue;

        const receiver = Array.isArray(message.to)
            ? message.to.join(";")
            : message.to;

        Exporter.buffers.messages.push({
            run_id: Exporter.runId,
            cycle,

            message_id:
                message.id ||
                `${cycle}_${message.from}_${receiver}_${Date.now()}`,

            sender:
                message.from ||
                null,

            receiver:
                receiver ||
                null,

            message_type:
                message.type ||
                "private",

            intent:
                message.intent ||
                null,

            is_overheard:
                Boolean(
                    message.overheard
                ),

            overheard_by:
                joinList(
                    message.overheardBy ||
                    message.observers ||
                    []
                ),

            is_rumor:
                Boolean(
                    message.isRumor ??
                    message.rumor
                ),

            rumor_payload:
                message.rumorPayload ||
                null,

            fragment_length:
                typeof message.content === "string"
                    ? message.content.length
                    : 0,

            emotional_intensity:
                finiteOrDefault(
                    message.emotionalIntensity,
                    0
                ),

            topic:
                message.topic ||
                null,

            manipulation_type:
                message.manipulationType ||
                null,

            timestamp:
                message.timestamp ||
                Date.now(),
        });
    }
}

/* ============================================================
   GLOBAL STREAM
   System-level metrics and execution coverage
============================================================ */

export function recordGlobal(
    G,
    metrics,
    cycle
) {
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

    Exporter.buffers.global.push({
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
    });
}

/* ============================================================
   DECISIONS STREAM
   Strategy-to-outcome linkage
============================================================ */

export function recordDecisions(
    decisions,
    G,
    cycle
) {
    if (!Array.isArray(decisions)) {
        return;
    }

    const execution =
        getExecutionForCycle(
            G,
            cycle
        );

    for (const decision of decisions) {
        if (!decision) continue;

        const agent =
            decision.agent ||
            decision.target ||
            null;

        const sim = agent
            ? G.sims?.[agent]
            : null;

        const previous = agent
            ? Exporter.prevState?.[agent]
            : null;

        const action = agent
            ? normalizeActionForExport(
                execution?.actions?.[agent]
            )
            : null;

        Exporter.buffers.decisions.push({
            run_id: Exporter.runId,
            cycle,
            agent,

            decision:
                decision.value ||
                decision.decision ||
                null,

            evaluation_score:
                decision.score ??
                null,

            auto_success:
                decision.autoSuccess ??
                null,

            hypothesis_belief:
                decision.hypothesis?.belief ??
                null,

            hypothesis_direction:
                decision.hypothesis?.direction ??
                null,

            dSanity:
                sim && previous
                    ? finiteDifference(
                        sim.sanity,
                        previous.sanity
                    )
                    : null,

            dHope:
                sim && previous
                    ? finiteDifference(
                        sim.hope,
                        previous.hope
                    )
                    : null,

            dSuffering:
                sim && previous
                    ? finiteDifference(
                        sim.suffering,
                        previous.suffering
                    )
                    : null,

            journal_sanity_delta:
                decision.journalTrend?.sanity ??
                null,

            journal_hope_delta:
                decision.journalTrend?.hope ??
                null,

            journal_suffering_delta:
                decision.journalTrend?.suffering ??
                null,

            was_constrained:
                Boolean(
                    sim?.constraints?.length
                ),

            constraint_intensity:
                finiteOrDefault(
                    sim?.constraints?.[0]?.intensity,
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
        });
    }
}

/* ============================================================
   PHASES STREAM
   Agent state classification
============================================================ */

export function recordPhases(G, cycle) {
    for (const [id, sim] of Object.entries(G.sims || {})) {
        if (!sim) continue;

        let phase = "stable";
        let confidence = 0.5;
        let triggerBelief = null;
        let triggerBeliefDelta = 0;

        if (
            sim.sanity < 55 &&
            sim.suffering > 45
        ) {
            phase =
                "psychological_collapse";

            confidence = 0.9;

            triggerBelief =
                "reality_reliable";

            triggerBeliefDelta =
                sim.beliefs?.reality_reliable ??
                0;
        } else if (
            sim.sanity < 70 &&
            sim.suffering > 35 &&
            sim.hope < 60
        ) {
            phase =
                "despair_spiral";

            confidence = 0.75;

            triggerBelief =
                "others_trustworthy";

            triggerBeliefDelta =
                sim.beliefs?.others_trustworthy ??
                0;
        } else if (
            sim.sanity < 80 &&
            sim.suffering > 25
        ) {
            phase =
                "resistance_oscillation";

            confidence = 0.6;
        }

        Exporter.buffers.phases.push({
            run_id: Exporter.runId,
            cycle,
            agent: id,
            phase,
            confidence,

            trigger_belief:
                triggerBelief,

            trigger_belief_delta:
                finiteOrDefault(
                    triggerBeliefDelta,
                    0
                ),

            sanity:
                finiteOrNull(
                    sim.sanity
                ),

            hope:
                finiteOrNull(
                    sim.hope
                ),

            suffering:
                finiteOrNull(
                    sim.suffering
                ),
        });
    }
}

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

            Exporter.buffers.tactics.push({
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
            });
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

        Exporter.buffers.strategies.push({
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
        });
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

        Exporter.buffers.executions.push({
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
        });
    }
}

/* ============================================================
   OBSERVATIONS STREAM
   Every stochastic bystander roll, including failures
============================================================ */

export function recordObservations(G, cycle) {
    const execution =
        getExecutionForCycle(
            G,
            cycle
        );

    if (!execution) {
        return;
    }

    const rolls =
        execution.observationRolls &&
            typeof execution.observationRolls === "object"
            ? execution.observationRolls
            : {};

    for (
        const [observerId, rawRoll]
        of Object.entries(rolls)
    ) {
        if (
            !rawRoll ||
            typeof rawRoll !== "object"
        ) {
            continue;
        }

        const perception =
            normalizePerceptionForExport(
                execution.perceptions?.[observerId]
            );

        Exporter.buffers.observations.push({
            run_id: Exporter.runId,
            cycle,
            observer: observerId,

            probability:
                finiteOrNull(
                    rawRoll.probability
                ),

            roll:
                finiteOrNull(
                    rawRoll.roll
                ),

            observed:
                rawRoll.observed === true,

            basis:
                rawRoll.basis ??
                null,

            candidate_targets:
                joinList(
                    rawRoll.candidateTargetIds
                ),

            observed_targets:
                joinList(
                    rawRoll.observedTargetIds ||
                    perception?.observedTargetIds
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

            observer_was_expected_target:
                asArray(
                    execution.targetIds
                ).includes(observerId),

            observer_had_direct_action:
                asArray(
                    execution.actionTargetIds
                ).includes(observerId),

            observer_had_direct_constraint:
                asArray(
                    execution.constraintTargetIds
                ).includes(observerId),

            journal_scheduled:
                asArray(
                    execution.journalTargetIds
                ).includes(observerId),
        });
    }
}

/* ============================================================
   JOURNAL EVENTS STREAM
   Subjective event and journal-generation provenance
============================================================ */

export function recordJournalEvents(G, cycle) {
    const journals =
        G.journals &&
            typeof G.journals === "object"
            ? G.journals
            : {};

    const execution =
        getExecutionForCycle(
            G,
            cycle
        );

    for (
        const [agentId, entries]
        of Object.entries(journals)
    ) {
        if (!Array.isArray(entries)) {
            continue;
        }

        entries.forEach(
            (entry, index) => {
                if (
                    !entry ||
                    entry.cycle !== cycle
                ) {
                    return;
                }

                const reasons =
                    asArray(
                        entry.journalReasons
                    );

                const deltas =
                    entry.deltas &&
                        typeof entry.deltas === "object"
                        ? entry.deltas
                        : {};

                const action =
                    normalizeActionForExport(
                        execution?.actions?.[agentId]
                    );

                const perception =
                    normalizePerceptionForExport(
                        execution?.perceptions?.[agentId]
                    );

                Exporter.buffers.journal_events.push({
                    run_id:
                        Exporter.runId,

                    cycle,

                    agent:
                        agentId,

                    journal_number:
                        index + 1,

                    journal_text:
                        entry.text ??
                        null,

                    journal_length:
                        typeof entry.text === "string"
                            ? entry.text.length
                            : 0,

                    tactic_label:
                        entry.tactic ??
                        null,

                    journal_reasons:
                        joinList(
                            reasons
                        ),

                    action_present:
                        Boolean(
                            entry.amActionPresent ??
                            action?.text
                        ),

                    action_origin:
                        entry.amActionOrigin ??
                        action?.origin ??
                        null,

                    action_tactic:
                        action?.tactic ??
                        null,

                    perception_present:
                        Boolean(
                            entry.amPerceptionPresent ??
                            perception?.text
                        ),

                    perception_origin:
                        entry.amPerceptionOrigin ??
                        perception?.origin ??
                        null,

                    constraint_present:
                        Boolean(
                            entry.amConstraintPresent
                        ),

                    constraint_origin:
                        entry.amConstraintOrigin ??
                        null,

                    constraint_ids:
                        joinList(
                            entry.amConstraintIds
                        ),

                    observed_target_ids:
                        joinList(
                            entry.observedTargetIds ||
                            perception?.observedTargetIds
                        ),

                    observation_probability:
                        finiteOrNull(
                            entry.observationProbability
                        ),

                    observation_roll:
                        finiteOrNull(
                            entry.observationRoll
                        ),

                    expected_target:
                        entry.amExpectedTarget ??
                        (
                            execution
                                ? asArray(
                                    execution.targetIds
                                ).includes(agentId)
                                : null
                        ),

                    missing_expected_action:
                        entry.amMissingExpectedAction ??
                        (
                            execution
                                ? asArray(
                                    execution.missingTargetIds
                                ).includes(agentId)
                                : null
                        ),

                    reported_hope_delta:
                        finiteOrNull(
                            deltas.hope
                        ),

                    reported_sanity_delta:
                        finiteOrNull(
                            deltas.sanity
                        ),

                    reported_suffering_delta:
                        finiteOrNull(
                            deltas.suffering
                        ),
                });
            }
        );
    }
}

/* ============================================================
   BELIEF EVIDENCE STREAM
   Why belief deltas moved
============================================================ */

export function recordBeliefEvidence(G, cycle) {
    for (const [agentId, sim] of Object.entries(G.sims || {})) {
        if (!sim) continue;

        const evidence = Array.isArray(sim.beliefEvidence)
            ? sim.beliefEvidence
            : [];

        const cycleEvidence = evidence.filter(
            (entry) => entry?.cycle === cycle
        );

        for (const entry of cycleEvidence) {
            Exporter.buffers.belief_evidence.push({
                run_id: Exporter.runId,
                cycle,
                agent: agentId,

                parse_method:
                    entry.parseMethod ?? null,

                belief_deltas:
                    entry.beliefDeltas ?? {},

                reason:
                    entry.reason ?? null,

                forensic_observations:
                    entry.forensicObservations ?? [],

                raw_preview:
                    entry.rawPreview ?? null,

                timestamp:
                    entry.timestamp ?? Date.now(),
            });
        }
    }
}

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

        Exporter.buffers.assessments.push({
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
        });
    }
}

/* ============================================================
   OBSERVABILITY UNKNOWN STREAM
   Novel verbs flagged for lexicon expansion
============================================================ */

export function recordObservabilityUnknowns(
    G,
    cycle
) {
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
        Exporter.buffers.observability_unknowns.push({
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
        });
    }
}

/* ============================================================
   CSV UTILITIES
============================================================ */

export function toCSV(rows) {
    if (
        !Array.isArray(rows) ||
        !rows.length
    ) {
        return "";
    }

    /*
     * Use the union of all keys so optional columns are not lost.
     */
    const headers = Array.from(
        rows.reduce(
            (set, row) => {
                for (
                    const key
                    of Object.keys(
                        row || {}
                    )
                ) {
                    set.add(key);
                }

                return set;
            },
            new Set()
        )
    );

    return [
        headers
            .map(escapeCSVValue)
            .join(","),

        ...rows.map((row) =>
            headers
                .map((header) =>
                    escapeCSVValue(
                        row?.[header]
                    )
                )
                .join(",")
        ),
    ].join("\n");
}

function escapeCSVValue(value) {
    if (
        value === null ||
        value === undefined
    ) {
        return "";
    }

    let normalized = value;

    if (Array.isArray(value)) {
        normalized =
            value.join(";");
    } else if (
        typeof value === "object"
    ) {
        normalized =
            JSON.stringify(value);
    }

    const text =
        String(normalized);

    if (
        text.includes(",") ||
        text.includes('"') ||
        text.includes("\n") ||
        text.includes("\r")
    ) {
        return `"${text.replace(
            /"/g,
            '""'
        )}"`;
    }

    return text;
}


/* ============================================================
   RETAINED OVERVIEW TELEMETRY
   ------------------------------------------------------------
   The latest completed cycle retains the complete export payload.

   Historical entries retain only bounded analytical streams,
   avoiding an unbounded accumulation of journal text, message
   contents, evidence previews, and observation narratives.
============================================================ */

function buildOverviewHistoryEntry(
    exportData
) {
    const streams =
        exportData?.streams &&
            typeof exportData.streams === "object"
            ? exportData.streams
            : {};

    return cloneValue({
        run_id:
            exportData?.run_id ??
            null,

        cycle:
            exportData?.cycle ??
            null,

        export_timestamp:
            exportData?.export_timestamp ??
            Date.now(),

        streams: {
            state:
                asArray(
                    streams.state
                ),

            dynamics:
                asArray(
                    streams.dynamics
                ),

            constraints:
                asArray(
                    streams.constraints
                ),

            relationships:
                asArray(
                    streams.relationships
                ),

            global:
                asArray(
                    streams.global
                ),

            decisions:
                asArray(
                    streams.decisions
                ),

            phases:
                asArray(
                    streams.phases
                ),

            tactics:
                asArray(
                    streams.tactics
                ),

            assessments:
                asArray(
                    streams.assessments
                ),
        },
    });
}

function retainCompletedCycle(
    exportData
) {
    if (
        !exportData ||
        typeof exportData !== "object"
    ) {
        console.warn(
            "[EXPORTER] Cannot retain malformed cycle export",
            exportData
        );

        return;
    }

    /*
     * Keep one complete cycle for detailed provenance inspection.
     * cloneValue() prevents clearAllBuffers() from erasing it.
     */
    Exporter.lastCompletedCycle =
        cloneValue(
            exportData
        );

    const historyEntry =
        buildOverviewHistoryEntry(
            exportData
        );

    /*
     * Replace rather than duplicate when finalization is
     * accidentally invoked twice for the same cycle.
     */
    const existingIndex =
        Exporter.overviewHistory.findIndex(
            (entry) =>
                entry?.cycle ===
                historyEntry.cycle
        );

    if (existingIndex >= 0) {
        Exporter.overviewHistory[
            existingIndex
        ] = historyEntry;
    } else {
        Exporter.overviewHistory.push(
            historyEntry
        );
    }

    const historyLimit =
        Math.max(
            1,
            Number(
                Exporter.overviewHistoryMax
            ) || 100
        );

    const overflow =
        Exporter.overviewHistory.length -
        historyLimit;

    if (overflow > 0) {
        Exporter.overviewHistory.splice(
            0,
            overflow
        );
    }
}



/* ============================================================
   EXPORT ALL STREAMS
============================================================ */

/**
 * Combine every buffered stream into one JSON object and download it.
 *
 * @param {number} cycle Current simulation cycle, used in the filename.
 * @param {boolean} clearAfter Clear all buffers after export when true.
 */
export function exportAllAsJSON(
    cycle,
    clearAfter = false
) {
    const exportData = {
        run_id:
            Exporter.runId,

        export_timestamp:
            Date.now(),

        cycle,

        streams: {
            state:
                Exporter.buffers.state,

            dynamics:
                Exporter.buffers.dynamics,

            constraints:
                Exporter.buffers.constraints,

            relationships:
                Exporter.buffers.relationships,

            messages:
                Exporter.buffers.messages,

            global:
                Exporter.buffers.global,

            decisions:
                Exporter.buffers.decisions,

            phases:
                Exporter.buffers.phases,

            tactics:
                Exporter.buffers.tactics,

            strategies:
                Exporter.buffers.strategies,

            executions:
                Exporter.buffers.executions,

            observations:
                Exporter.buffers.observations,

            journal_events:
                Exporter.buffers.journal_events,

            belief_evidence:
                Exporter.buffers.belief_evidence,

            assessments:
                Exporter.buffers.assessments,

            observability_unknowns:
                Exporter.buffers.observability_unknowns,
        },
    };

    if (clearAfter) {
        /*
         * The current cycle-finalization path exports with
         * clearAfter=true after every telemetry stream is recorded.
         */
        retainCompletedCycle(
            exportData
        );
    }

    const jsonString =
        JSON.stringify(
            exportData,
            null,
            2
        );

    const filename =
        `${Exporter.runId}_cycle${cycle}_${Date.now()}.json`;

    downloadTextFile(
        filename,
        jsonString
    );

    if (clearAfter) {
        clearAllBuffers();
    }

    console.log(
        `[EXPORTER] Exported combined JSON: ${filename}`
    );
}

/* ============================================================
   BUFFER MANAGEMENT
============================================================ */

function clearAllBuffers() {
    for (
        const key
        of Object.keys(
            Exporter.buffers
        )
    ) {
        Exporter.buffers[key] = [];
    }
}

/* ============================================================
   CYCLE HOOKS
============================================================ */

/**
 * Call at the beginning of a cycle, after beginCycle().
 */
export function snapshotPrevState(G) {
    Exporter.prevState = {};

    for (
        const [id, sim]
        of Object.entries(G.sims || {})
    ) {
        if (!sim) continue;

        Exporter.prevState[id] = {
            sanity:
                finiteOrDefault(
                    sim.sanity,
                    0
                ),

            hope:
                finiteOrDefault(
                    sim.hope,
                    0
                ),

            suffering:
                finiteOrDefault(
                    sim.suffering,
                    0
                ),

            physical_stress:
                finiteOrDefault(
                    sim.physical_stress,
                    0
                ),

            beliefs:
                cloneValue(
                    sim.beliefs || {}
                ),
        };
    }
}

/**
 * Call at the end of a cycle, before endCycle().
 */
export function finalizeCycle(
    G,
    metrics,
    decisions
) {
    const cycle =
        G.cycle;

    recordState(
        G,
        cycle
    );

    recordDynamics(
        G,
        cycle
    );

    recordConstraints(
        G,
        cycle
    );

    recordRelationships(
        G,
        cycle
    );

    recordMessages(
        G,
        cycle
    );

    recordGlobal(
        G,
        metrics,
        cycle
    );

    recordDecisions(
        decisions,
        G,
        cycle
    );

    recordPhases(
        G,
        cycle
    );

    recordTactics(
        G,
        cycle
    );

    /*
     * Intent -> execution -> observation -> subjective response.
     */
    recordStrategies(
        G,
        cycle
    );

    recordExecutions(
        G,
        cycle
    );

    recordObservations(
        G,
        cycle
    );

    recordJournalEvents(
        G,
        cycle
    );

    recordBeliefEvidence(
        G,
        cycle
    );

    recordAssessments(
        G,
        cycle
    );

    recordObservabilityUnknowns(
        G,
        cycle
    );

    /*
     * Preserve the existing one-file-per-cycle behavior.
     */
    exportAllAsJSON(
        cycle,
        true
    );
}

/**
 * Convenience alias for finalizing and exporting one cycle.
 */
export function recordCycle(
    G,
    metrics,
    decisions
) {
    finalizeCycle(
        G,
        metrics,
        decisions
    );
}

/* ============================================================
   INTERNAL HELPERS
============================================================ */

function getExecutionForCycle(
    G,
    cycle
) {
    const execution =
        G.amExecution;

    if (
        !execution ||
        typeof execution !== "object"
    ) {
        return null;
    }

    /*
     * Reject stale state when an execution explicitly names a cycle.
     * Missing cycle fields are accepted for backward compatibility.
     */
    if (
        execution.cycle !== null &&
        execution.cycle !== undefined
    ) {
        const executionCycle =
            Number(
                execution.cycle
            );

        const requestedCycle =
            Number(cycle);

        if (
            Number.isFinite(
                executionCycle
            ) &&
            Number.isFinite(
                requestedCycle
            ) &&
            executionCycle !== requestedCycle
        ) {
            console.warn(
                "[EXPORTER] Ignoring stale AM execution record",
                {
                    requestedCycle,
                    executionCycle,
                }
            );

            return null;
        }
    }

    return execution;
}

function collectExecutionAgentIds(
    G,
    execution
) {
    const ids = new Set(
        Object.keys(
            G.sims || {}
        )
    );

    const collections = [
        execution.targetIds,
        execution.actionTargetIds,
        execution.constraintTargetIds,
        execution.activeConstraintTargetIds,
        execution.observerIds,
        execution.journalTargetIds,
        execution.missingTargetIds,
        execution.nonJournalExpectedTargetIds,

        Object.keys(
            execution.actions || {}
        ),

        Object.keys(
            execution.perceptions || {}
        ),

        Object.keys(
            execution.observationRolls || {}
        ),
    ];

    for (const collection of collections) {
        for (
            const id
            of asArray(collection)
        ) {
            if (id) {
                ids.add(id);
            }
        }
    }

    return Array.from(ids);
}

function normalizeActionForExport(
    rawAction
) {
    if (typeof rawAction === "string") {
        const text =
            rawAction.trim();

        return text
            ? {
                text,
                tactic: null,
                origin: "model",
            }
            : null;
    }

    if (
        !rawAction ||
        typeof rawAction !== "object"
    ) {
        return null;
    }

    const text =
        typeof rawAction.text === "string"
            ? rawAction.text.trim()
            : "";

    if (!text) {
        return null;
    }

    return {
        text,

        tactic:
            typeof rawAction.tactic === "string"
                ? rawAction.tactic.trim() ||
                null
                : null,

        origin:
            typeof rawAction.origin === "string"
                ? rawAction.origin.trim() ||
                "model"
                : "model",
    };
}

function normalizePerceptionForExport(
    rawPerception
) {
    if (
        typeof rawPerception === "string"
    ) {
        const text =
            rawPerception.trim();

        return text
            ? {
                text,
                origin:
                    "parser_fallback",
                observedTargetIds:
                    [],
            }
            : null;
    }

    if (
        !rawPerception ||
        typeof rawPerception !== "object"
    ) {
        return null;
    }

    const text =
        typeof rawPerception.text === "string"
            ? rawPerception.text.trim()
            : "";

    if (!text) {
        return null;
    }

    return {
        text,

        origin:
            typeof rawPerception.origin === "string"
                ? rawPerception.origin.trim() ||
                null
                : null,

        observedTargetIds:
            asArray(
                rawPerception.observedTargetIds
            ),
    };
}

function safeRatio(
    effective,
    reported
) {
    const effectiveNumber =
        Number(effective);

    const reportedNumber =
        Number(reported);

    if (
        !Number.isFinite(
            effectiveNumber
        ) ||
        !Number.isFinite(
            reportedNumber
        ) ||
        reportedNumber === 0
    ) {
        return null;
    }

    return +(
        effectiveNumber /
        reportedNumber
    ).toFixed(2);
}

function finiteDifference(
    after,
    before
) {
    const afterNumber =
        Number(after);

    const beforeNumber =
        Number(before);

    if (
        !Number.isFinite(
            afterNumber
        ) ||
        !Number.isFinite(
            beforeNumber
        )
    ) {
        return 0;
    }

    return (
        afterNumber -
        beforeNumber
    );
}

function finiteOrDefault(
    value,
    fallback = 0
) {
    const number =
        Number(value);

    return Number.isFinite(number)
        ? number
        : fallback;
}

function finiteOrNull(value) {
    if (
        value === null ||
        value === undefined ||
        value === ""
    ) {
        return null;
    }

    const number =
        Number(value);

    return Number.isFinite(number)
        ? number
        : null;
}

function asArray(value) {
    return Array.isArray(value)
        ? value
        : [];
}

function joinList(value) {
    return asArray(value)
        .filter(
            (entry) =>
                entry !== null &&
                entry !== undefined &&
                entry !== ""
        )
        .map(String)
        .join(";");
}

function slugify(value) {
    if (
        typeof value !== "string"
    ) {
        return "";
    }

    return value
        .trim()
        .toLowerCase()
        .replace(
            /[^a-z0-9]+/g,
            "_"
        )
        .replace(
            /^_+|_+$/g,
            ""
        );
}

function cloneValue(value) {
    if (
        typeof structuredClone === "function"
    ) {
        try {
            return structuredClone(
                value
            );
        } catch (error) {
            console.warn(
                "[EXPORTER] structuredClone failed; using JSON clone",
                error
            );
        }
    }

    try {
        return JSON.parse(
            JSON.stringify(value)
        );
    } catch (error) {
        console.warn(
            "[EXPORTER] Could not clone value",
            error
        );

        return {};
    }
}