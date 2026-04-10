// js/engine/strategy/extractStrategy.js

import { G } from "../../core/state.js";
import { extractJSON } from "./extractors/extractJSON.js";
import { extractTargetsArray } from "./extractors/targetsExtractor.js";
import { repairTargetsExtractor } from "./extractors/repairTargetsExtractor.js";
import { classifyJsonError } from "./extractors/classifyJsonError.js";
import { extractLabeledTargets } from "./extractors/extractLabeledTargets.js";
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

export function extractStrategy(input, { DEBUG = true, DEBUG_EXTRACT = true } = {}) {

  console.trace("=== STRATEGY EXTRACTION START ===");

  if (!input || typeof input !== "string") {
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

  if (DEBUG) {
    console.debug("[EXTRACT][CONFIG] repairLevel:", repairLevel);
  }

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
      console.warn(`[AUTO-TUNE] repairLevel ${currentLevel} → ${nextLevel}`);
      G.parserConfig.repairLevel = nextLevel;
    }
  }

  /* ------------------------------------------------------------
     EXTRACTION LOOP (NO EARLY RETURN)
  ------------------------------------------------------------ */

  let classifiedError = null;

  for (const { name, fn } of extractors) {

    if (DEBUG) console.debug(`[EXTRACTOR] trying ${name}`);

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
        console.warn(`[EXTRACTOR] error in ${name}:`, err.message);
      }
    }

    const duration = (performance.now() - start).toFixed(2);

    extractorAttempts.push({
      name,
      success,
      duration: Number(duration)
    });

    if (success) {

      if (DEBUG) {
        console.debug(`[EXTRACTOR] SUCCESS: ${name} (${duration}ms)`);
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

      if (DEBUG) {
        console.debug(`[EXTRACTOR] failed: ${name} (${duration}ms)`);
      }
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
    "heuristic": 0.4
  };

  if (successfulResults.length > 0) {

    const mergedById = new Map();

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
          continue;
        }

        const mergedData = { ...existing.data };
        const fieldConfidence = existing.fieldConfidence || {};

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
            continue;
          }

          // ------------------------------------------------------------
          // 2. Prefer higher-confidence extractor
          // ------------------------------------------------------------
          if (confidence > prevConfidence + 0.1) {
            mergedData[key] = incomingValue;
            fieldConfidence[key] = confidence;
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
          }
        }

        mergedById.set(id, {
          data: mergedData,
          confidence: Math.max(existing.confidence, confidence),
          fieldConfidence
        });
      }
    }

    const merged = Array.from(mergedById.values()).map(v => v.data);

    if (DEBUG) {
      console.debug("[EXTRACT] merged targets:", merged.length);
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

      console.warn("[EXTRACT] incomplete target recovery", {
        expected: expectedCount,
        actual: merged.length,
        recoveredIds,
        missing
      });

      // ------------------------------------------------------------
      // RETRY ONCE WITH HIGHER REPAIR LEVEL
      // ------------------------------------------------------------
      if ((G.parserConfig?.repairLevel ?? 0) < 2) {
        console.warn("[EXTRACT] escalating repairLevel → 2 and retrying");

        G.parserConfig = {
          ...(G.parserConfig || {}),
          repairLevel: 2
        };

        return extractStrategy(input, { DEBUG, DEBUG_EXTRACT });
      }
      // ------------------------------------------------------------
      // DEGRADED MODE (ALLOW PARTIAL EXECUTION)
      // ------------------------------------------------------------
      console.warn("[EXTRACT] proceeding with PARTIAL strategy (degraded mode)");

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

  metrics.failures++;
  G.parserMetrics.totals.failures++;

  if (classifiedError) {

    metrics.errorTypes[classifiedError] =
      (metrics.errorTypes[classifiedError] || 0) + 1;

    G.parserMetrics.totals.errorTypes[classifiedError] =
      (G.parserMetrics.totals.errorTypes[classifiedError] || 0) + 1;
  }

  autoTuneRepairLevel();

  console.trace("=== STRATEGY EXTRACTION FAILED ===");

  return {
    status: "failure",
    errorType: classifiedError || "unknown",
    extractorAttempts
  };
}