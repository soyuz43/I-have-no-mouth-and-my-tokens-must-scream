// js/utils/exporter/streams/subjective.js
//
// Observation rolls, journal-generation provenance, and belief-evidence streams.

import { Exporter } from "../state.js";
import { attachRecordMeta } from "../metadata.js";
import { asArray, finiteOrNull, joinList } from "../format.js";
import { getExecutionForCycle, normalizeActionForExport, normalizePerceptionForExport } from "../executionContext.js";

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

        Exporter.buffers.observations.push(attachRecordMeta({
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
        }, cycle));
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

                Exporter.buffers.journal_events.push(attachRecordMeta({
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
                }, cycle));
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
            Exporter.buffers.belief_evidence.push(attachRecordMeta({
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
            }, cycle));
        }
    }
}
