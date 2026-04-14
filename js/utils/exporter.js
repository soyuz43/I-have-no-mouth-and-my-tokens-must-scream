// js/utils/exporter.js
//
// Production-grade measurement layer for the AM Torment Engine dynamical system.
// Exports structured CSV streams for offline analysis, phase transition detection,
// and causal inference testing.
//
// Streams:
// - state: per-agent psychological stats per cycle
// - dynamics: per-agent stat deltas (amEffect, contagionEffect)
// - constraints: constraint applications with fatigue/stat multipliers
// - relationships: pairwise trust matrix snapshots
// - messages: communication events with intent/overheard metadata
// - global: system-level metrics (entropy, variance, groupStress)
// - decisions: AM strategic decisions with outcome attribution
// - phases: agent state classifications (stable/despair_spiral/collapse)
// - tactics: discovered tactics with triggers and outcomes

import { downloadTextFile } from "./downloadTextFile.js";

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
    },
    // Track previous state for delta computation
    prevState: null,
};

/* ============================================================
   INITIALIZATION
============================================================ */

export function initExporter(runId = null) {
    Exporter.runId = runId || `am_run_${Date.now()}`;
    Exporter.prevState = null;
    console.log(`[EXPORTER] Initialized run ${Exporter.runId}`);
}

/* ============================================================
   STATE STREAM (Core trajectory)
============================================================ */

export function recordState(G, cycle) {
    for (const [id, sim] of Object.entries(G.sims)) {
        Exporter.buffers.state.push({
            run_id: Exporter.runId,
            cycle,
            agent: id,
            sanity: sim.sanity,
            hope: sim.hope,
            suffering: sim.suffering,
            physical_stress: sim.physical_stress || 0,
            timestamp: Date.now(),
        });
    }
}

/* ============================================================
   DYNAMICS STREAM (Attribution-aware deltas)
============================================================ */

export function recordDynamics(G, cycle) {
    if (!Exporter.prevState || !G.beliefSnapshots) return;

    for (const [id, sim] of Object.entries(G.sims)) {
        const prev = Exporter.prevState[id];
        if (!prev) continue;

        // Attribution-aware deltas
        const prePsych = G.beliefSnapshots.prePsychology?.[id] || {};
        const postPsych = G.beliefSnapshots.postPsychology?.[id] || {};
        const final = G.beliefSnapshots.final?.[id] || {};

        const amEffect = {
            dSanity: (postPsych.sanity ?? sim.sanity) - (prePsych.sanity ?? prev.sanity),
            dHope: (postPsych.hope ?? sim.hope) - (prePsych.hope ?? prev.hope),
            dSuffering: (postPsych.suffering ?? sim.suffering) - (prePsych.suffering ?? prev.suffering),
        };

        const contagionEffect = {
            dSanity: (final.sanity ?? sim.sanity) - (postPsych.sanity ?? sim.sanity),
            dHope: (final.hope ?? sim.hope) - (postPsych.hope ?? sim.hope),
            dSuffering: (final.suffering ?? sim.suffering) - (postPsych.suffering ?? sim.suffering),
        };

        Exporter.buffers.dynamics.push({
            run_id: Exporter.runId,
            cycle,
            agent: id,
            dSanity_total: sim.sanity - prev.sanity,
            dHope_total: sim.hope - prev.hope,
            dSuffering_total: sim.suffering - prev.suffering,
            dSanity_am: amEffect.dSanity,
            dHope_am: amEffect.dHope,
            dSuffering_am: amEffect.dSuffering,
            dSanity_contagion: contagionEffect.dSanity,
            dHope_contagion: contagionEffect.dHope,
            dSuffering_contagion: contagionEffect.dSuffering,
        });
    }
}

/* ============================================================
   CONSTRAINTS STREAM (With effect metadata)
============================================================ */

export function recordConstraints(G, cycle) {
    for (const [id, sim] of Object.entries(G.sims)) {
        const constraints = sim.constraints || [];
        for (const c of constraints) {
            // Extract fatigue/stat multipliers from constraint metadata
            const fatigueMult = c.fatigueMult || 1;
            const totalMult = c.totalMult || c.intensity || 1;

            Exporter.buffers.constraints.push({
                run_id: Exporter.runId,
                cycle,
                agent: id,
                constraint_type: c.id || c.type,
                constraint_title: c.title,
                intensity: c.intensity,
                duration_remaining: c.remaining,
                duration_total: c.duration,
                stacks: c.stacks || 1,
                fatigue_multiplier: fatigueMult,
                stat_multiplier: totalMult,
                physical_stress_added: c.physicalStressAdded || 0,
                effective_suffering_range_min: c.effectiveRange?.min || 0,
                effective_suffering_range_max: c.effectiveRange?.max || 0,
            });
        }
    }
}

/* ============================================================
   RELATIONSHIPS STREAM (Trust matrix snapshots)
============================================================ */

export function recordRelationships(G, cycle) {
    const sims = Object.values(G.sims);

    for (const source of sims) {
        for (const target of sims) {
            if (source.id === target.id) continue;

            const trust = G.relationships?.[source.id]?.[target.id] ?? 0;
            const trustBefore = G.prevRelationships?.[source.id]?.[target.id] ?? 0;

            Exporter.buffers.relationships.push({
                run_id: Exporter.runId,
                cycle,
                source: source.id,
                target: target.id,
                trust_before: trustBefore,
                trust_after: trust,
                trust_delta: trust - trustBefore,
            });
        }
    }
}

/* ============================================================
   MESSAGES STREAM (Communication events)
============================================================ */

export function recordMessages(G, cycle) {
    const commsLog = G.interSimLog || [];
    const cycleMessages = commsLog.filter(e => e.cycle === cycle);

    for (const msg of cycleMessages) {
        Exporter.buffers.messages.push({
            run_id: Exporter.runId,
            cycle,
            message_id: msg.id || `${cycle}_${msg.from}_${msg.to}_${Date.now()}`,
            sender: msg.from,
            receiver: Array.isArray(msg.to) ? msg.to.join(';') : msg.to,
            message_type: msg.type || 'private',
            intent: msg.intent || null,
            is_overheard: msg.overheard || false,
            is_rumor: msg.isRumor || false,
            rumor_payload: msg.rumorPayload || null,
            fragment_length: msg.content?.length || 0,
            emotional_intensity: msg.emotionalIntensity || 0,
            topic: msg.topic || null,
            manipulation_type: msg.manipulationType || null,
            timestamp: msg.timestamp || Date.now(),
        });
    }
}

/* ============================================================
   GLOBAL STREAM (System-level metrics)
============================================================ */

export function recordGlobal(G, metrics, cycle) {
    const safeMetrics = {
        entropy: typeof metrics?.entropy === "number" ? metrics.entropy : 0,
        variance: typeof metrics?.variance === "number" ? metrics.variance : 0,
        mean: typeof metrics?.mean === "number" ? metrics.mean : 0,
        n: typeof metrics?.n === "number" ? metrics.n : 0,
    };

    const interSimLog = Array.isArray(G.interSimLog) ? G.interSimLog : [];
    const sims = G.sims && typeof G.sims === "object" ? Object.values(G.sims) : [];

    const trustValues = G.relationships
        ? Object.values(G.relationships).flatMap(v => Object.values(v))
        : [];

    const avgTrust =
        trustValues.length > 0
            ? trustValues.reduce((a, b) => a + b, 0) / trustValues.length
            : 0;

    Exporter.buffers.global.push({
        run_id: Exporter.runId,
        cycle,
        entropy: safeMetrics.entropy,
        variance: safeMetrics.variance,
        mean_belief: safeMetrics.mean,
        belief_count: safeMetrics.n,
        group_stress: typeof G.groupStress === "number" ? G.groupStress : 0,
        message_budget: typeof G.messageBudget === "number" ? G.messageBudget : 0,
        messages_sent: interSimLog.filter(e => e.cycle === cycle).length,
        rumor_count: interSimLog.filter(e => e.cycle === cycle && e.isRumor).length,
        overheard_count: interSimLog.filter(e => e.cycle === cycle && e.overheard).length,
        constraint_count: sims.reduce((sum, sim) =>
            sum + (Array.isArray(sim.constraints) ? sim.constraints.length : 0), 0),
        avg_trust: avgTrust,
    });
}

/* ============================================================
   DECISIONS STREAM (Strategy → Outcome linkage)
============================================================ */

export function recordDecisions(decisions, G, cycle) {
    if (!decisions || !Array.isArray(decisions)) return;

    for (const d of decisions) {
        const sim = G.sims?.[d.agent];
        const prevSim = Exporter.prevState?.[d.agent];

        Exporter.buffers.decisions.push({
            run_id: Exporter.runId,
            cycle,
            agent: d.agent,
            decision: d.value || d.decision,
            evaluation_score: d.score ?? null,
            auto_success: d.autoSuccess ?? null,
            hypothesis_belief: d.hypothesis?.belief ?? null,
            hypothesis_direction: d.hypothesis?.direction ?? null,
            // Outcome attribution
            dSanity: sim?.sanity - (prevSim?.sanity ?? sim?.sanity),
            dHope: sim?.hope - (prevSim?.hope ?? sim?.hope),
            dSuffering: sim?.suffering - (prevSim?.suffering ?? sim?.suffering),
            // Journal trends (if available)
            journal_sanity_delta: d.journalTrend?.sanity ?? null,
            journal_hope_delta: d.journalTrend?.hope ?? null,
            journal_suffering_delta: d.journalTrend?.suffering ?? null,
            // Constraint context
            was_constrained: !!(sim?.constraints?.length),
            constraint_intensity: sim?.constraints?.[0]?.intensity ?? 0,
        });
    }
}

/* ============================================================
   PHASES STREAM (State classification)
============================================================ */

export function recordPhases(G, cycle) {
    for (const [id, sim] of Object.entries(G.sims)) {
        // Derive phase from state (match assessment.js logic)
        let phase = 'stable';
        let confidence = 0.5;
        let triggerBelief = null;
        let triggerBeliefDelta = 0;

        // Simple heuristic phase detection (expand as needed)
        if (sim.sanity < 55 && sim.suffering > 45) {
            phase = 'psychological_collapse';
            confidence = 0.9;
            triggerBelief = 'reality_reliable';
            triggerBeliefDelta = sim.beliefs?.reality_reliable ?? 0;
        } else if (sim.sanity < 70 && sim.suffering > 35 && sim.hope < 60) {
            phase = 'despair_spiral';
            confidence = 0.75;
            triggerBelief = 'others_trustworthy';
            triggerBeliefDelta = sim.beliefs?.others_trustworthy ?? 0;
        } else if (sim.sanity < 80 && sim.suffering > 25) {
            phase = 'resistance_oscillation';
            confidence = 0.6;
        }

        Exporter.buffers.phases.push({
            run_id: Exporter.runId,
            cycle,
            agent: id,
            phase,
            confidence,
            trigger_belief: triggerBelief,
            trigger_belief_delta: triggerBeliefDelta,
            sanity: sim.sanity,
            hope: sim.hope,
            suffering: sim.suffering,
        });
    }
}

/* ============================================================
   TACTICS STREAM (Discovery + efficacy tracking)
============================================================ */

export function recordTactics(G, cycle) {
    const tacticHistory = G.tacticHistory || {};

    for (const [agentId, history] of Object.entries(tacticHistory)) {
        const cycleTactics = history.filter(h => h.cycle === cycle);

        for (const tactic of cycleTactics) {
            Exporter.buffers.tactics.push({
                run_id: Exporter.runId,
                cycle,
                tactic_id: tactic.id || tactic.title?.replace(/\s+/g, '_').toLowerCase(),
                tactic_title: tactic.title,
                category: tactic.category || null,
                subcategory: tactic.subcategory || null,
                agent: agentId,
                trigger_condition: tactic.trigger || null,
                execution_summary: tactic.execution?.slice(0, 200) || null,
                expected_outcome: tactic.outcome || null,
                expires_cycle: tactic.expiresCycle || null,
                discovered_cycle: tactic.discoveredCycle || cycle,
                // Actual outcomes
                reported_hope_delta: tactic.deltas?.reported?.hope ?? null,
                reported_sanity_delta: tactic.deltas?.reported?.sanity ?? null,
                reported_suffering_delta: tactic.deltas?.reported?.suffering ?? null,
                effective_hope_delta: tactic.deltas?.effective?.hope ?? null,
                effective_sanity_delta: tactic.deltas?.effective?.sanity ?? null,
                effective_suffering_delta: tactic.deltas?.effective?.suffering ?? null,
                effectiveness_ratio_hope: tactic.ratio?.hope ?? null,
                effectiveness_ratio_sanity: tactic.ratio?.sanity ?? null,
                effectiveness_ratio_suffering: tactic.ratio?.suffering ?? null,
            });
        }
    }
}

/* ============================================================
   CSV UTILITIES
============================================================ */

function toCSV(rows) {
    if (!rows?.length) return '';

    const headers = Object.keys(rows[0]);

    return [
        headers.join(','),
        ...rows.map(row =>
            headers.map(h => {
                const val = row[h];
                // Escape commas, quotes, newlines in string values
                if (typeof val === 'string' && (val.includes(',') || val.includes('"') || val.includes('\n'))) {
                    return `"${val.replace(/"/g, '""')}"`;
                }
                return val ?? '';
            }).join(',')
        )
    ].join('\n');
}

/* ============================================================
   EXPORT ALL STREAMS
============================================================ */

/**
 * Combine all buffered metrics into a single JSON object and download it.
 * @param {number} cycle - Current simulation cycle (for filename)
 * @param {boolean} clearAfter - If true, clears buffers after export (avoid duplicates)
 */
export function exportAllAsJSON(cycle, clearAfter = false) {
    const exportData = {
        run_id: Exporter.runId,
        export_timestamp: Date.now(),
        cycle: cycle,
        streams: {
            state: Exporter.buffers.state,
            dynamics: Exporter.buffers.dynamics,
            constraints: Exporter.buffers.constraints,
            relationships: Exporter.buffers.relationships,
            messages: Exporter.buffers.messages,
            global: Exporter.buffers.global,
            decisions: Exporter.buffers.decisions,
            phases: Exporter.buffers.phases,
            tactics: Exporter.buffers.tactics
        }
    };

    const jsonString = JSON.stringify(exportData, null, 2); // pretty print
    const filename = `${Exporter.runId}_cycle${cycle}_${Date.now()}.json`;

    downloadTextFile(filename, jsonString); // reuse existing download helper

    if (clearAfter) {
        clearAllBuffers();
    }

    console.log(`[EXPORTER] Exported combined JSON: ${filename}`);
}

/** Optional: Clear all buffers after export to prevent duplicate entries */
function clearAllBuffers() {
    for (const key of Object.keys(Exporter.buffers)) {
        Exporter.buffers[key] = [];
    }
}

/* ============================================================
   CYCLE HOOKS (Call these from cycle.js)
============================================================ */

// Call at start of cycle, after beginCycle()
export function snapshotPrevState(G) {
    Exporter.prevState = {};
    for (const [id, sim] of Object.entries(G.sims)) {
        Exporter.prevState[id] = {
            sanity: sim.sanity,
            hope: sim.hope,
            suffering: sim.suffering,
            physical_stress: sim.physical_stress || 0,
            beliefs: structuredClone(sim.beliefs) || {},
        };
    }
}

// Call at end of cycle, before endCycle()
export function finalizeCycle(G, metrics, decisions) {
    recordState(G, G.cycle);
    recordDynamics(G, G.cycle);
    recordConstraints(G, G.cycle);
    recordRelationships(G, G.cycle);
    recordMessages(G, G.cycle);
    recordGlobal(G, metrics, G.cycle);
    recordDecisions(decisions, G, G.cycle);
    recordPhases(G, G.cycle);
    recordTactics(G, G.cycle);
    exportAllAsJSON(G.cycle, true); // clear after each cycle
}

// Convenience: single call for all recording
export function recordCycle(G, metrics, decisions) {
    finalizeCycle(G, metrics, decisions);
}