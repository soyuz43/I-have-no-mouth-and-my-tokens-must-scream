// js/engine/strategy/extractStrategy.js

import { G } from "../../core/state.js";
import { extractJSON } from "./extractors/extractJSON.js";
import { extractTargetsArray } from "./extractors/targetsExtractor.js";
import { repairTargetsExtractor } from "./extractors/repairTargetsExtractor.js";
import { classifyJsonError } from "./extractors/classifyJsonError.js";
import { extractLabeledTargets } from "./extractors/extractLabeledTargets.js";
import { extractLooseTargets } from "./extractors/extractLooseTargets.js";

// ========== GLOBAL LOGGING CONTROL ==========
const LOG_EXTRACT_FLOW = true;           // High-level: start, success/failure, merged count
const LOG_EXTRACT_ACTION_ONLY = true;    // Show each successful extractor name (no details)
const LOG_EXTRACT_DETAILS = false;       // Show per-extractor debug, merge decisions, auto-tune
const LOG_EXTRACT_MERGE = true;          // Show merge results (count, field sources summary)
const LOG_EXTRACT_ERRORS = true;         // Show warnings, retries, degraded mode
// ============================================

function logFlow(message) {
  if (LOG_EXTRACT_FLOW) {
    console.log(`[EXTRACT] ${message}`);
  }
}

function logAction(extractorName, success, durationMs) {
  if (LOG_EXTRACT_ACTION_ONLY && success) {
    console.log(`[EXTRACT ACTION] ${extractorName} ✓ (${durationMs}ms)`);
  } else if (LOG_EXTRACT_DETAILS) {
    const status = success ? "✓" : "✗";
    console.debug(`[EXTRACT] ${extractorName} ${status} (${durationMs}ms)`);
  }
}

function logDetail(message, data = null) {
  if (LOG_EXTRACT_DETAILS) {
    console.debug(`[EXTRACT DETAIL] ${message}`, data || "");
  }
}

function logMerge(summary) {
  if (LOG_EXTRACT_MERGE) {
    console.log(`[EXTRACT MERGE] ${summary}`);
  }
}

function logError(message, data = null) {
  if (LOG_EXTRACT_ERRORS) {
    console.warn(`[EXTRACT ERROR] ${message}`, data || "");
  }
}

/* ============================================================
   STRATEGY EXTRACTION PIPELINE (MERGE-AWARE)

   PURPOSE:
   Extract structured JSON from LLM output using a multi-stage,
   self-repairing, schema-aware pipeline.

   NEW BEHAVIOR:
   - Collect ALL successful extractor outputs
   - Merge targets instead of picking first success
   - Prevent silent loss of valid targets

============================================================ */

export function extractStrategy(input, { DEBUG = true, DEBUG_EXTRACT = false } = {}) {

  logFlow("starting extraction pipeline");

  console.trace("=== STRATEGY EXTRACTION START ===");

  if (!input || typeof input !== "string") {
    logError("invalid input (not a string)");
    return {
      status: "failure",
      errorType: "invalid_input",
      extractorAttempts: []
    };
  }

  const cycle = G.cycle;

  /* ------------------------------------------------------------
     METRICS INIT
  ------------------------------------------------------------ */

  if (!G.parserMetrics) {
    G.parserMetrics = {
      cycles: {},
      totals: {
        attempts: 0,
        success: 0,
        failures: 0,
        repairs: 0,
        errorTypes: {}
      }
    };
  }

  if (!G.parserConfig) {
    G.parserConfig = { repairLevel: 1 };
  }

  if (!G.parserMetrics.cycles[cycle]) {
    G.parserMetrics.cycles[cycle] = {
      attempts: 0,
      success: 0,
      failures: 0,
      repairs: 0,
      errorTypes: {},
      extractorUsage: {}
    };
  }

  const metrics = G.parserMetrics.cycles[cycle];

  metrics.attempts++;
  G.parserMetrics.totals.attempts++;

  const repairLevel = G.parserConfig.repairLevel ?? 1;

  logDetail(`repairLevel: ${repairLevel}`);

  /* ------------------------------------------------------------
     EXTRACTOR SETUP
  ------------------------------------------------------------ */

  const extractors = [];

  if (repairLevel >= 0) {
    extractors.push({ name: "json-unified", fn: extractJSON });
  }

  if (repairLevel >= 1) {
    extractors.push({ name: "targets-array", fn: extractTargetsArray });

    // Handles "Target TED: {...}" style output
    extractors.push({ name: "labeled-targets", fn: extractLabeledTargets });
  }

  if (repairLevel >= 2) {
    extractors.push({ name: "repair-targets", fn: repairTargetsExtractor });

    extractors.push({ name: "loose-targets", fn: extractLooseTargets });
  }

  const extractorAttempts = [];
  const successfulResults = [];

  /* ------------------------------------------------------------
     AUTO-TUNE
  ------------------------------------------------------------ */

  function autoTuneRepairLevel() {

    const totals = G.parserMetrics.totals;

    const attempts = totals.attempts || 1;
    const failures = totals.failures || 0;

    const failureRate = failures / attempts;
    const errors = totals.errorTypes || {};

    const commaRate = (errors.missing_comma || 0) / attempts;
    const structuralRate = (errors.structural_merge || 0) / attempts;
    const truncationRate = (errors.truncated || 0) / attempts;

    if (attempts < 5) return;

    let currentLevel = G.parserConfig.repairLevel ?? 1;
    let nextLevel = currentLevel;

    if (
      failureRate > 0.25 ||
      structuralRate > 0.1 ||
      truncationRate > 0.05
    ) {
      nextLevel = Math.min(currentLevel + 1, 2);
    }

    if (
      failureRate < 0.05 &&
      commaRate < 0.05 &&
      structuralRate < 0.02
    ) {
      nextLevel = Math.max(currentLevel - 1, 1);
    }

    if (nextLevel !== currentLevel) {
      logError(`auto-tune: repairLevel ${currentLevel} → ${nextLevel}`);
      G.parserConfig.repairLevel = nextLevel;
    }
  }

  /* ------------------------------------------------------------
     EXTRACTION LOOP (NO EARLY RETURN)
  ------------------------------------------------------------ */

  let classifiedError = null;

  for (const { name, fn } of extractors) {

    logDetail(`trying extractor: ${name}`);

    metrics.extractorUsage[name] =
      (metrics.extractorUsage[name] || 0) + 1;

    const start = performance.now();

    let result = null;
    let success = false;

    try {
      result = fn(input, { DEBUG_EXTRACT });
      success = !!result && Array.isArray(result.targets) && result.targets.length > 0;
    } catch (err) {
      if (DEBUG) {
        logError(`error in ${name}: ${err.message}`);
      }
    }

    const duration = (performance.now() - start).toFixed(2);

    extractorAttempts.push({
      name,
      success,
      duration: Number(duration)
    });

    logAction(name, success, duration);

    if (success) {

      if (LOG_EXTRACT_DETAILS) {
        console.debug(`[EXTRACT] SUCCESS: ${name} (${duration}ms) - targets: ${result.targets.length}`);
      }

      successfulResults.push({
        name,
        targets: result.targets
      });

      metrics.success++;
      G.parserMetrics.totals.success++;

      if (name === "repair-targets") {
        metrics.repairs++;
        G.parserMetrics.totals.repairs++;
      }

    } else {

      if (!classifiedError) {
        classifiedError = classifyJsonError(input);
      }

      logDetail(`failed: ${name} (${duration}ms)`);
    }
  }

  /* ------------------------------------------------------------
     MERGE RESULTS
  ------------------------------------------------------------ */
  const EXTRACTOR_CONFIDENCE = {
    "strict-json": 1.0,
    "tolerant-json": 0.8,
    "labeled-targets": 0.7,
    "repair-targets": 0.6,
    "heuristic": 0.4,
    "loose-targets": 0.2
  };

  if (successfulResults.length > 0) {

    const mergedById = new Map();
    const mergeLog = [];

    for (const { name, targets } of successfulResults) {

      const confidence = EXTRACTOR_CONFIDENCE[name] ?? 0.5;

      for (const t of targets) {

        if (!t || typeof t !== "object") continue;

        const idRaw = t.id;

        if (typeof idRaw !== "string") continue;

        const id = idRaw.trim().toUpperCase();

        if (!id) continue;

        const existing = mergedById.get(id);

        if (!existing || confidence > existing.confidence) {
          mergedById.set(id, {
            data: t,
            confidence
          });
          if (LOG_EXTRACT_MERGE) mergeLog.push(`${id} ← ${name} (conf=${confidence.toFixed(2)})`);
          continue;
        }

        const mergedData = { ...existing.data };
        const fieldConfidence = existing.fieldConfidence || {};
        const fieldSources = existing.fieldSources || {};

        for (const key of Object.keys(t)) {

          if (key === "id") continue;

          const incomingValue = t[key];
          if (incomingValue == null) continue;

          const prevConfidence = fieldConfidence[key] ?? existing.confidence;

          // ------------------------------------------------------------
          // 1. If field is missing → always take it
          // ------------------------------------------------------------
          if (!(key in mergedData)) {
            mergedData[key] = incomingValue;
            fieldConfidence[key] = confidence;
            fieldSources[key] = name;
            if (LOG_EXTRACT_MERGE) mergeLog.push(`  ${id}.${key} ← ${name} (new field)`);
            continue;
          }

          // ------------------------------------------------------------
          // 2. Prefer higher-confidence extractor
          // ------------------------------------------------------------
          if (confidence > prevConfidence + 0.1) {
            mergedData[key] = incomingValue;
            fieldConfidence[key] = confidence;
            fieldSources[key] = name;
            if (LOG_EXTRACT_MERGE) mergeLog.push(`  ${id}.${key} ← ${name} (higher conf: ${confidence.toFixed(2)} > ${prevConfidence.toFixed(2)})`);
            continue;
          }

          // ------------------------------------------------------------
          // 3. Prefer longer / richer content if similar confidence
          // ------------------------------------------------------------
          if (
            typeof incomingValue === "string" &&
            typeof mergedData[key] === "string" &&
            confidence >= prevConfidence - 0.05 &&
            incomingValue.length > mergedData[key].length * 1.2
          ) {
            mergedData[key] = incomingValue;
            fieldConfidence[key] = confidence;
            fieldSources[key] = name;
            if (LOG_EXTRACT_MERGE) mergeLog.push(`  ${id}.${key} ← ${name} (longer text)`);
          }
        }

        mergedById.set(id, {
          data: mergedData,
          confidence: Math.max(existing.confidence, confidence),
          fieldConfidence,
          fieldSources
        });
      }
    }

    const merged = Array.from(mergedById.values()).map(v => ({
      ...v.data,
      _fieldSources: v.fieldSources || {}
    }));

    logFlow(`merged ${merged.length} targets from ${successfulResults.length} extractors`);
    if (LOG_EXTRACT_MERGE && mergeLog.length) {
      console.groupCollapsed(`[EXTRACT MERGE DETAIL] (${mergeLog.length} decisions)`);
      mergeLog.forEach(line => console.debug(line));
      console.groupEnd();
    }

    // ------------------------------------------------------------
    // TARGET COMPLETENESS POLICY (RETRY → THEN DEGRADE)
    // ------------------------------------------------------------

    const expectedCount = Object.keys(G.sims || {}).length;
    const isAllMode = G.executionMode === "ALL" || expectedCount > 1;

    // fallback if executionMode not wired yet
    const mustHaveAll = isAllMode;

    if (mustHaveAll && merged.length < expectedCount) {

      const recoveredIds = merged.map(t => t.id);
      const recoveredSet = new Set(recoveredIds);
      const allIds = Object.keys(G.sims || {});
      const missing = allIds.filter(id => !recoveredSet.has(id));

      logError("incomplete target recovery", {
        expected: expectedCount,
        actual: merged.length,
        recoveredIds,
        missing
      });

      // ------------------------------------------------------------
      // RETRY ONCE WITH HIGHER REPAIR LEVEL
      // ------------------------------------------------------------
      if ((G.parserConfig?.repairLevel ?? 0) < 2) {
        logError("escalating repairLevel → 2 and retrying");
        G.parserConfig = {
          ...(G.parserConfig || {}),
          repairLevel: 2
        };
        return extractStrategy(input, { DEBUG, DEBUG_EXTRACT });
      }
      // ------------------------------------------------------------
      // DEGRADED MODE (ALLOW PARTIAL EXECUTION)
      // ------------------------------------------------------------
      logError("proceeding with PARTIAL strategy (degraded mode)");

      G.executionMeta = {
        ...(G.executionMeta || {}),
        degraded: true,
        expectedTargets: expectedCount,
        actualTargets: merged.length,
        missingTargets: missing
      };

      //  DO NOT return failure
      //  DO NOT abort
    }

    autoTuneRepairLevel();
    metrics.pipelineSuccess = (metrics.pipelineSuccess || 0) + 1;
    G.parserMetrics.totals.pipelineSuccess =
      (G.parserMetrics.totals.pipelineSuccess || 0) + 1;

    logFlow("extraction successful");

    return {
      status: "success",
      targets: merged,
      meta: {
        extractorsUsed: successfulResults.map(r => r.name),
        merged: true
      },
      extractorAttempts
    };
  }

  /* ------------------------------------------------------------
     FINAL FAILURE
  ------------------------------------------------------------ */

  metrics.failures = (metrics.failures || 0) + 1;
  metrics.pipelineFailures = (metrics.pipelineFailures || 0) + 1;

  G.parserMetrics.totals.failures =
    (G.parserMetrics.totals.failures || 0) + 1;
  G.parserMetrics.totals.pipelineFailures =
    (G.parserMetrics.totals.pipelineFailures || 0) + 1;

  if (classifiedError) {

    metrics.errorTypes[classifiedError] =
      (metrics.errorTypes[classifiedError] || 0) + 1;

    G.parserMetrics.totals.errorTypes[classifiedError] =
      (G.parserMetrics.totals.errorTypes[classifiedError] || 0) + 1;
  }

  autoTuneRepairLevel();

  logFlow(`extraction FAILED (${classifiedError || "unknown error"})`);

  console.trace("=== STRATEGY EXTRACTION FAILED ===");

  return {
    status: "failure",
    errorType: classifiedError || "unknown",
    extractorAttempts
  };
}