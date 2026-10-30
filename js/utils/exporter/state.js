// js/utils/exporter/state.js
//
// Exporter singleton: buffers, retained telemetry, and lifecycle control.
// This module owns the shared mutable state that every stream writes into.

import { cloneValue } from "./format.js";

/*
 * The canonical list of export streams.
 *
 * A save file written before a stream existed carries no buffer for
 * it. `importState()` restores the saved buffers verbatim, so a
 * pre-stream save would leave `Exporter.buffers.<stream>` undefined
 * and the next recorder would throw on `.push()`. The stream list is
 * the single source of truth for which buffers must exist.
 */
export const EXPORT_STREAM_KEYS = Object.freeze([
    "state",
    "dynamics",
    "constraints",
    "relationships",
    "messages",
    "agency",
    "agency_events",
    "global",
    "phases",
    "tactics",
    "strategies",
    "executions",
    "observations",
    "journal_events",
    "belief_evidence",
    "assessments",
    "observability_unknowns",
    "resource_events",
    "claim_events",
    "scratchpad",
    "goal_events",
]);

/*
 * Build a complete buffer map from the canonical stream list.
 */
function createEmptyBuffers() {
    return Object.fromEntries(
        EXPORT_STREAM_KEYS.map(
            (key) => [key, []]
        )
    );
}

export const Exporter = {
    runId: null,

    buffers: createEmptyBuffers(),

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


export const EXPORT_SCHEMA_VERSION = "am-export-v2-metadata";

/* ============================================================
   INITIALIZATION
============================================================ */
export function initExporter(runId = null) {
    Exporter.runId = runId || `am_run_${Date.now()}`;
    Exporter.prevState = null;
    Exporter.runMetadata = null;
    Exporter.cycleMetadata = {};
    Exporter.schemaVersion = EXPORT_SCHEMA_VERSION;
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
   BUFFER MANAGEMENT
============================================================ */
export function clearAllBuffers() {
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
   BUFFER NORMALIZATION
   ------------------------------------------------------------
   Ensures every canonical stream has a buffer array.
   ------------------------------------------------------------
   A save file written before a stream existed carries no buffer
   for it. Restoring such a save verbatim would leave the missing
   buffer undefined, and the next recorder for that stream would
   throw on `.push()` and abort the whole cycle export.
============================================================ */
export function ensureExportBuffers(buffers) {
    if (
        !buffers ||
        typeof buffers !== "object"
    ) {
        return createEmptyBuffers();
    }

    for (const key of EXPORT_STREAM_KEYS) {
        if (!Array.isArray(buffers[key])) {
            buffers[key] = [];
        }
    }

    return buffers;
}

/* ============================================================
   EXPORTER STATE NORMALIZATION
   ------------------------------------------------------------
   Ensures the retained-telemetry fields of a restored exporter
   exist with their expected shape.
   ------------------------------------------------------------
   A save written before a field existed carries no value for it.
   The export path reads these fields unconditionally, so a missing
   one would throw while finalizing a cycle.
============================================================ */
export function ensureExporterState(exporter) {
    if (
        !exporter ||
        typeof exporter !== "object"
    ) {
        return exporter;
    }

    if (!Array.isArray(exporter.overviewHistory)) {
        exporter.overviewHistory = [];
    }

    if (!Number.isSafeInteger(exporter.overviewHistoryMax) ||
        exporter.overviewHistoryMax < 1) {
        exporter.overviewHistoryMax = 100;
    }

    if (!exporter.cycleMetadata ||
        typeof exporter.cycleMetadata !== "object") {
        exporter.cycleMetadata = {};
    }

    /*
     * The export payload embeds runMetadata directly, and exportState()
     * refuses to serialize an undefined value. A restored exporter that
     * never ran initExporter() has no runMetadata at all, so the
     * recovered export would otherwise produce a payload that cannot
     * be saved again.
     */
    if (exporter.runMetadata === undefined) {
        exporter.runMetadata = null;
    }

    if (exporter.schemaVersion === undefined) {
        exporter.schemaVersion = EXPORT_SCHEMA_VERSION;
    }

    exporter.buffers = ensureExportBuffers(exporter.buffers);

    return exporter;
}
