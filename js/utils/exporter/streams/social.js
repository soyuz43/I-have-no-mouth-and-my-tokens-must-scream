// js/utils/exporter/streams/social.js
//
// Constraint, relationship, and message streams (environmental + communication events).

import { Exporter } from "../state.js";
import { attachRecordMeta } from "../metadata.js";
import { finiteDifference, finiteOrDefault, finiteOrNull, joinList } from "../format.js";

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

            Exporter.buffers.constraints.push(attachRecordMeta({
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
            }, cycle));
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

            Exporter.buffers.relationships.push(attachRecordMeta({
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
            }, cycle));
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

        Exporter.buffers.messages.push(attachRecordMeta({
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
        }, cycle));
    }
}
