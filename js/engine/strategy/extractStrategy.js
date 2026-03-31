// js/engine/strategy/extractStrategy.js

import { G } from "../../core/state.js";
import { extractJSON } from "./extractors/extractJSON.js";
import { extractTargetsArray } from "./extractors/targetsExtractor.js";
import { repairTargetsExtractor } from "./extractors/repairTargetsExtractor.js";
import { classifyJsonError } from "./extractors/classifyJsonError.js";

/* ============================================================
   STRATEGY EXTRACTION PIPELINE

   PURPOSE:
   Extract structured JSON from LLM output using a multi-stage,
   self-repairing, schema-aware pipeline.

   RETURNS:
   {
     status: "success" | "failure",
     targets?: [],
     meta?: { extractor },
     errorType?: string,
     extractorAttempts: [{ name, success }]
   }
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
  }

  if (repairLevel >= 2) {
    extractors.push({ name: "repair-targets", fn: repairTargetsExtractor });
  }

  const extractorAttempts = [];

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
     EXTRACTION LOOP
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
      success = !!result;
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

      metrics.success++;
      G.parserMetrics.totals.success++;

      if (name === "repair-targets") {
        metrics.repairs++;
        G.parserMetrics.totals.repairs++;
      }

      autoTuneRepairLevel();

      return {
        status: "success",
        targets: result.targets,
        meta: { extractor: name },
        extractorAttempts
      };
    }

    if (!classifiedError) {
      classifiedError = classifyJsonError(input);
    }

    if (DEBUG) {
      console.debug(`[EXTRACTOR] failed: ${name} (${duration}ms)`);
    }
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