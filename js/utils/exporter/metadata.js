// js/utils/exporter/metadata.js
//
// Run-level and cycle-level metadata construction plus record envelope
// stamping. Builders are internal; recorders are part of the public API.

import { Exporter, EXPORT_SCHEMA_VERSION } from "./state.js";
import { nowIso, safeClone, hashObject, redactModelRoutes } from "./format.js";

function buildRunMetadata(G, extra = {}) {
    const initialSims = Object.fromEntries(
        Object.entries(G?.sims ?? {}).map(([id, sim]) => [
            id,
            {
                id,
                suffering: sim?.suffering ?? null,
                hope: sim?.hope ?? null,
                sanity: sim?.sanity ?? null,
                beliefs: safeClone(sim?.beliefs ?? {}),
                relationships: safeClone(sim?.relationships ?? {})
            }
        ])
    );

    return {
        schema_version: EXPORT_SCHEMA_VERSION,
        run_id: Exporter.runId ?? extra.run_id ?? null,
        started_at: extra.started_at ?? nowIso(),

        app: {
            name: "AM",
            export_schema_version: EXPORT_SCHEMA_VERSION,
            package_version: globalThis.__AM_PACKAGE_VERSION__ ?? null,
            git_commit: globalThis.__AM_GIT_COMMIT__ ?? null
        },

        experiment: {
            label: G?.experimentLabel ?? null,
            notes: G?.experimentNotes ?? null,
            mode: G?.mode ?? null,
            backend: G?.backend ?? null,
            multi_model: G?.multiModel ?? null
        },

        model_routing: redactModelRoutes(G?.models),

        parser: {
            config: safeClone(G?.parserConfig ?? {}),
            failure_stats_at_start: safeClone(G?.failureStats ?? {})
        },

        observability: {
            attribution_debug: G?.debugAttribution ?? null,
            hypothesis_debug: G?.debugHypothesis ?? null,
            prompt_preview_logging: G?.debugPromptPreview ?? null,
            extraction_telemetry_enabled: !!G?.extractionTelemetry
        },

        initial_state: {
            hash: hashObject(initialSims),
            sims: initialSims
        }
    };
}

function buildCycleMetadata(G, cycle, extra = {}) {
    const parserMetrics = G?.parserMetrics?.cycles?.[cycle] ?? {};
    const extractionTelemetry = G?.extractionTelemetry?.cycles?.[cycle] ?? {};

    return {
        schema_version: EXPORT_SCHEMA_VERSION,
        run_id: Exporter.runId ?? null,
        cycle,
        cycle_id: `${Exporter.runId ?? "run"}::cycle:${cycle}`,

        started_at: extra.started_at ?? null,
        ended_at: extra.ended_at ?? null,
        duration_ms: Number.isFinite(extra.duration_ms)
            ? Number(extra.duration_ms.toFixed(2))
            : null,

        mode: G?.mode ?? null,
        backend: G?.backend ?? null,
        model_routing: redactModelRoutes(G?.models),

        parser: {
            metrics: safeClone(parserMetrics),
            extraction_telemetry: safeClone(extractionTelemetry),
            failure_stats_snapshot: safeClone(G?.failureStats ?? {})
        },

        observability: {
            belief_metrics: safeClone(G?.beliefMetrics?.[cycle] ?? null),
            attribution_metrics: safeClone(G?.attributionMetrics?.[cycle] ?? null),
            evidence_stats: safeClone(G?.evidenceStats ?? null)
        },

        phase_status: safeClone(extra.phase_status ?? null)
    };
}

export function attachRecordMeta(record, cycle) {
    return {
        schema_version: EXPORT_SCHEMA_VERSION,
        run_id: Exporter.runId ?? null,
        cycle,
        cycle_id: `${Exporter.runId ?? "run"}::cycle:${cycle}`,
        recorded_at: nowIso(),
        ...record
    };
}

/**
 * Captures run-level metadata (experiment setup, initial state, routing).
 * Call exactly once, typically during the first cycle's beginCycle().
 */
/**
 * Captures run-level metadata (experiment setup, initial state, routing).
 * Call exactly once, typically during the first cycle's beginCycle().
 */
export function recordRunMetadata(G, extra = {}) {
    Exporter.runMetadata = buildRunMetadata(G, extra);
    return Exporter.runMetadata;
}

/**
 * Captures per-cycle metadata (timing, parser metrics, observability).
 * Call at the beginning and end of each cycle with appropriate extra data.
 */
export function recordCycleMetadata(G, cycle = G?.cycle, extra = {}) {
    if (!Exporter.cycleMetadata) {
        Exporter.cycleMetadata = {};
    }

    const metadata = buildCycleMetadata(G, cycle, extra);
    Exporter.cycleMetadata[cycle] = metadata;

    return metadata;
}
