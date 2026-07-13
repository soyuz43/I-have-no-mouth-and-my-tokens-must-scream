// js/utils/exporter/state.js
//
// Exporter singleton: buffers, retained telemetry, and lifecycle control.
// This module owns the shared mutable state that every stream writes into.

import { cloneValue } from "./format.js";

export const Exporter = {
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
