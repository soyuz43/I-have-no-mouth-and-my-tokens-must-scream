// js/utils/exporter/streams/psychology.js
//
// State, dynamics, and phase-classification streams (per-agent psychological trajectory).

import { Exporter } from "../state.js";
import { attachRecordMeta } from "../metadata.js";
import { finiteDifference, finiteOrDefault, finiteOrNull } from "../format.js";

/* ============================================================
   STATE STREAM
   Core psychological trajectory
============================================================ */
export function recordState(G, cycle) {
    for (const [id, sim] of Object.entries(G.sims || {})) {
        if (!sim) continue;

        Exporter.buffers.state.push(attachRecordMeta({
            run_id: Exporter.runId,
            cycle,
            agent: id,
            sanity: finiteOrNull(sim.sanity),
            hope: finiteOrNull(sim.hope),
            suffering: finiteOrNull(sim.suffering),
            physical_stress: finiteOrDefault(sim.physical_stress, 0),
            timestamp: Date.now(),
        }, cycle));
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

        Exporter.buffers.dynamics.push(attachRecordMeta({
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
        }, cycle));
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

        Exporter.buffers.phases.push(attachRecordMeta({
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
        }, cycle));
    }
}
