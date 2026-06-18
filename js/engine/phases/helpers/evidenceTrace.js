// js/engine/phases/helpers/evidenceTrace.js

import { G } from "../../../core/state.js";

import {
    EVIDENCE_SOURCES,
    EVIDENCE_ATTRIBUTIONS,
} from "../../../core/constants.js";

export function pushDebugTrace(entry) {
    G.debugTrace ??= [];

    G.debugTrace.push({
        cycle: G.cycle,
        timestamp: Date.now(),
        ...entry
    });

    const max = G.debugTraceMax ?? 5000;

    if (G.debugTrace.length > max) {
        G.debugTrace.splice(0, G.debugTrace.length - max);
    }
}

export function archiveEvidence(simId, evidence) {
    if (!simId || !evidence) return;

    G.evidenceArchive ??= {};
    G.evidenceArchive[simId] ??= [];

    const items = Array.isArray(evidence) ? evidence : [evidence];

    G.evidenceArchive[simId].push(...items);

    const max = G.evidenceArchiveMaxPerSim ?? 5000;

    if (G.evidenceArchive[simId].length > max) {
        G.evidenceArchive[simId].splice(
            0,
            G.evidenceArchive[simId].length - max
        );
    }
}

export function recordJournalStatsEvidence({
    sim,
    statDeltas,
    beliefUpdates,
    cleanJournal,
    cleanAM,
    appliedTactics,
    rawStatsJson,
    sanitizedStatsJson
}) {
    if (!sim?.id) return null;

    const evidence = {
        id: `journal_${G.cycle}_${sim.id}_${Date.now()}`,
        cycle: G.cycle,
        simId: sim.id,
        source: EVIDENCE_SOURCES.JOURNAL,
        attribution: EVIDENCE_ATTRIBUTIONS.JOURNAL_INFERENCE,
        stage: "journal_stats_extraction",

        stats: {
            deltas: { ...(statDeltas || {}) }
        },

        beliefs: {
            deltas: { ...(beliefUpdates || {}) }
        },

        context: {
            journalLength: String(cleanJournal || "").length,
            amActionPresent: Boolean(cleanAM),
            constraints: (sim.constraints || []).map(c => ({
                id: c.id,
                title: c.title || c.id,
                intensity: c.intensity ?? null,
                remaining: c.remaining ?? null
            })),
            tactics: (appliedTactics || []).map(t => ({
                path: t.path || null,
                title: t.title || null
            }))
        },

        provenance: {
            prompt: "buildSimJournalStatsPrompt",

            role: "FORENSIC_STATS",

            subject: sim.id,

            model:
                G.models?.FORENSIC_STATS ??
                G.models?.am ??
                null,

            rawStatsLength:
                String(rawStatsJson ?? "").length,

            sanitizedChanged:
                sanitizedStatsJson !== rawStatsJson,

            createdAt: Date.now()
        }
    };

    G.pendingPsychEvidence ??= Object.create(null);
    G.pendingPsychEvidence[sim.id] ??= [];
    G.pendingPsychEvidence[sim.id].push(evidence);


    console.log(
        "[PSYCH EVIDENCE STORED]",
        sim.id,
        evidence
    );

    archiveEvidence(sim.id, evidence);

    pushDebugTrace({
        simId: sim.id,
        stage: "stats_extraction",
        source: EVIDENCE_SOURCES.JOURNAL,
        attribution: EVIDENCE_ATTRIBUTIONS.JOURNAL_INFERENCE,
        input: {
            journalLength: String(cleanJournal || "").length,
            hadAMAction: Boolean(cleanAM),
            activeConstraints: (sim.constraints || []).map(c => c.id),
            appliedTactics: (appliedTactics || [])
                .map(t => t.path || t.title)
                .filter(Boolean)
        },
        output: {
            statDeltas,
            beliefDeltaCount: Object.keys(beliefUpdates || {}).length,
            rawStatsLength: String(rawStatsJson ?? "").length,
            sanitizedChanged: sanitizedStatsJson !== rawStatsJson
        }
    });

    return evidence;
}