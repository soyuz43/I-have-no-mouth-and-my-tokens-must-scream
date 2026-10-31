// js/utils/exporter/aggregate.js
//
// Cross-stream aggregation: CSV export, retained overview telemetry,
// combined JSON export, and per-cycle orchestration hooks.

import { downloadTextFile } from "../downloadTextFile.js";
import {
    Exporter,
    EXPORT_SCHEMA_VERSION,
    clearAllBuffers,
    ensureExportBuffers,
} from "./state.js";
import { nowIso, asArray, cloneValue, finiteOrDefault } from "./format.js";
import {
  recordState,
  recordDynamics,
  recordPhases,
} from "./streams/psychology.js";
import {
  recordConstraints,
  recordRelationships,
  recordMessages,
} from "./streams/social.js";
import {
  recordAgency,
} from "./streams/agency.js";
import { recordAgencyEvents } from "./streams/agencyEvents.js";
import {
  recordGlobal,
} from "./streams/system.js";
import {
  recordTactics,
  recordStrategies,
  recordExecutions,
} from "./streams/tactics.js";
import {
  recordObservations,
  recordJournalEvents,
  recordBeliefEvidence,
} from "./streams/subjective.js";
import {
  recordAssessments,
  recordObservabilityUnknowns,
} from "./streams/assessment.js";
import {
    recordResourceEvents,
} from "./streams/resourceEvents.js";
import {
    recordClaimEvents,
} from "./streams/claimEvents.js";
import {
    recordClaimDivergence,
} from "./streams/claimDivergence.js";
import {
    recordScratchpadReviews,
} from "./streams/scratchpad.js";
import {
    recordGoalEvents,
} from "./streams/goalEvents.js";

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
function buildOverviewHistoryEntry(exportData) {
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

function retainCompletedCycle(exportData) {
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

/**
 * Combine every buffered stream into one JSON object and download it.
 *
 * @param {number} cycle Current simulation cycle, used in the filename.
 * @param {boolean} clearAfter Clear all buffers after export when true.
 */
/**
 * Combine every buffered stream into one JSON object and download it.
 *
 * @param {number} cycle Current simulation cycle, used in the filename.
 * @param {boolean} clearAfter Clear all buffers after export when true.
 */
export function exportAllAsJSON(cycle, clearAfter = false) {
    /*
     * A restored pre-stream save can leave a canonical stream without
     * a buffer. Normalize before the recorders run so the export
     * payload always carries every stream key.
     */
    Exporter.buffers = ensureExportBuffers(Exporter.buffers);

    const exportData = {
        schema_version: EXPORT_SCHEMA_VERSION,
        run_id: Exporter.runId,
        export_timestamp: Date.now(),
        export_timestamp_iso: nowIso(),

        metadata: {
            run: Exporter.runMetadata,
            cycles: Exporter.cycleMetadata ?? {},
        },

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

            agency:
                Exporter.buffers.agency,

            agency_events:
                Exporter.buffers.agency_events,

            global:
                Exporter.buffers.global,

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

            resource_events:
                Exporter.buffers.resource_events,

            claim_events:
                Exporter.buffers.claim_events,

            claim_divergence:
                Exporter.buffers.claim_divergence,

            scratchpad:
                Exporter.buffers.scratchpad,

            goal_events:
                Exporter.buffers.goal_events,
        },
    };

    if (clearAfter) {
        /*
         * The current cycle-finalization path exports with
         * clearAfter=true after every telemetry stream is recorded.
         */
        retainCompletedCycle(exportData);
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

/**
 * Call at the beginning of a cycle, after beginCycle().
 */
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
export function finalizeCycle(G, metrics) {
    const cycle = G.cycle;

    /*
     * A restored pre-stream save can leave a canonical stream without
     * a buffer. Normalize before any recorder runs, because the
     * recorders push into these arrays directly.
     */
    Exporter.buffers = ensureExportBuffers(Exporter.buffers);

    recordState(G, cycle);
    recordDynamics(G, cycle);
    recordConstraints(G, cycle);
    recordRelationships(G, cycle);
    recordMessages(G, cycle);
    recordAgency(G, cycle);
    recordAgencyEvents(G, cycle);
    recordGlobal(G, metrics, cycle);
    recordPhases(G, cycle);
    recordTactics(G, cycle);

    /*
     * Intent -> execution -> observation -> subjective response.
     */
    recordStrategies(G, cycle);
    recordExecutions(G, cycle);
    recordObservations(G, cycle);
    recordJournalEvents(G, cycle);
    recordBeliefEvidence(G, cycle);
    recordAssessments(G, cycle);
    recordObservabilityUnknowns(G, cycle);
    recordResourceEvents(G, cycle);
    recordClaimEvents(G, cycle);
    recordClaimDivergence(G, cycle);
    recordScratchpadReviews(G, cycle);
    recordGoalEvents(G, cycle);

    /*
     * The review records have now been written to the export file.
     * Clearing them keeps the carrier meaning "reviews produced but
     * not yet exported" and stops a stale cycle from being written
     * into a later cycle's file.
     */
    if (G?.pendingEvidence) {
        G.pendingEvidence.scratchpadReviewLog = [];
    }

    /*
     * Preserve the existing one-file-per-cycle behavior.
     */
    exportAllAsJSON(cycle, true);
}

/* ============================================================
   BOOT-CYCLE EXPORT
   ------------------------------------------------------------
   The boot path runs the communication phase at cycle zero and is
   never finalized by the cycle pipeline, so its scratchpad review
   records would be cleared by the next cycle reset without ever
   reaching an export file.
   ------------------------------------------------------------
   Only cycle zero is ever left unexported. Every other cycle
   passes through finalizeCycle(), which writes that cycle's file.
   A save written before this export existed can still carry the
   orphaned cycle-zero records, so the same helper recovers them
   after a full-state import.
============================================================ */
export function exportBootCycleReviews(G, exporter = Exporter) {
    /*
     * This recovery is a singleton-scoped side effect. It downloads a
     * file, rewrites the exporter's retained telemetry, and clears its
     * buffers. A restore into a caller-supplied exporter must not
     * touch the live singleton run, so the recovery is skipped there.
     * The supplied exporter has already received the restored state,
     * and the pending records stay in G for the caller to inspect.
     */
    if (exporter !== Exporter) return false;

    /*
     * Cycle zero is the only cycle that is never finalized by the
     * cycle pipeline. Records for any other cycle were already
     * written by finalizeCycle() and must not be exported twice.
     */
    if (Number(G?.cycle) !== 0) return false;

    const reviews =
        Array.isArray(G?.pendingEvidence?.scratchpadReviewLog)
            ? G.pendingEvidence.scratchpadReviewLog
            : [];

    if (reviews.length === 0) return false;

    /*
     * A restored legacy save can carry no run id. The export file
     * would then have no run identity, so one is assigned here rather
     * than calling initExporter(), which would clear the restored
     * buffers.
     *
     * Assigning the run id is what makes this exporter a real run, so
     * the caller must not re-initialize it afterwards. initExporter()
     * would assign a DIFFERENT run id and clear the overview history
     * this recovery just produced.
     */
    if (!exporter.runId) {
        exporter.runId = `am_run_${Date.now()}`;
    }

    try {
        finalizeCycle(G, {
            entropy: G?.lastEntropy,
            variance: G?.lastVariance,
            mean: G?.lastMean,
        });
    } catch (err) {
        console.error("[EXPORTER] boot cycle export failed:", err);
    }

    return true;
}

/**
 * Convenience alias for finalizing and exporting one cycle.
 */
export function recordCycle(G, metrics) {
    finalizeCycle(G, metrics);
}
