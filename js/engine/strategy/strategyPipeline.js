// js/engine/strategy/strategyPipeline.js

import { G } from "../../core/state.js";

import { sanitizeStrategyInput } from "./sanitizeStrategy.js";
import { extractStrategy } from "./extractStrategy.js";
import { interpretTargets } from "./interpret/interpretTargets.js";
import { validateTargetsArray } from "./validate/validateTargetsArray.js";
import { enforceStrategy } from "./enforceStrategy.js";
import { commitStrategy } from "./commitStrategy.js";

import { visualizeParserCycle } from "./analysis/parserMetricsVisualizer.js";
import { classifyJsonError } from "./extractors/classifyJsonError.js";

import {
  startStrategyRun,
  setCleanedInput,
  logStrategyStage,
  finalizeStrategyRun
} from "./logging/logStrategyRun.js";

/* ============================================================
   STRATEGY PIPELINE (ORCHESTRATOR)

   PIPELINE:
   sanitize → extract → interpret → validate → enforce → commit

   GUARANTEES:
   - fail-soft
   - atomic commit
   - full logging
   - explicit return status
============================================================ */

export function runStrategyPipeline(rawText, { DEBUG = true } = {}) {

  console.trace("=== STRATEGY PIPELINE START ===");

  startStrategyRun(rawText, { DEBUG });

  try {

    /* ------------------------------------------------------------
       SANITIZE
    ------------------------------------------------------------ */

    const cleaned = sanitizeStrategyInput(rawText, { DEBUG });

    setCleanedInput(cleaned);

    logStrategyStage("sanitize", {
      output: { length: cleaned?.length || 0 }
    });

    /* ------------------------------------------------------------
       EXTRACT
    ------------------------------------------------------------ */

    const extracted = extractStrategy(cleaned, { DEBUG });

    if (!extracted || !extracted.targets) {

      const errorType = classifyJsonError(cleaned);

      logStrategyStage("extract", {
        error: true,
        errorType,
        output: { targetsFound: 0 }
      });

      finalizeStrategyRun({
        status: "failure",
        stage: "extract",
        errorType
      });

      return {
        status: "failure",
        stage: "extract",
        errorType
      };
    }

    logStrategyStage("extract", {
      output: { targetsFound: extracted.targets.length }
    });

    /* ------------------------------------------------------------
       INTERPRET
    ------------------------------------------------------------ */

    const interpreted = interpretTargets(extracted.targets, { DEBUG });

    if (!interpreted || interpreted.length === 0) {

      finalizeStrategyRun({
        status: "failure",
        stage: "interpret"
      });

      return {
        status: "failure",
        stage: "interpret"
      };
    }

    logStrategyStage("interpret", {
      output: {
        ids: interpreted.map(t => t.id),
        count: interpreted.length
      }
    });

    /* ------------------------------------------------------------
       VALIDATE
    ------------------------------------------------------------ */

    let validated;

    try {
      validated = validateTargetsArray(interpreted, { DEBUG });
    } catch (err) {

      finalizeStrategyRun({
        status: "failure",
        stage: "validate",
        message: err.message
      });

      return {
        status: "failure",
        stage: "validate",
        error: err.message
      };
    }

    if (!validated || validated.length === 0) {

      finalizeStrategyRun({
        status: "failure",
        stage: "validate"
      });

      return {
        status: "failure",
        stage: "validate"
      };
    }

    logStrategyStage("validate", {
      output: { count: validated.length }
    });

    /* ------------------------------------------------------------
       ENFORCE
    ------------------------------------------------------------ */

    const enforced = enforceStrategy(
      validated.map(t => ({
        id: t.id,
        target: {
          ...t,
          reasoning: {
            evidence: t.evidence,
            why_now: t.why_now
          },
          confidence: t._inferenceConfidence ?? 0.5
        },
        valid: true
      })),
      { DEBUG }
    );

    if (!enforced.targets || enforced.targets.length === 0) {

      finalizeStrategyRun({
        status: "failure",
        stage: "enforce",
        droppedDetails: enforced.meta?.droppedDetails || []
      });

      return {
        status: "failure",
        stage: "enforce",
        droppedDetails: enforced.meta?.droppedDetails || []
      };
    }

    logStrategyStage("enforce", {
      output: {
        ids: enforced.targets.map(t => t.id),
        count: enforced.targets.length
      },
      meta: enforced.meta
    });

    /* ------------------------------------------------------------
       COMMIT (ATOMIC)
    ------------------------------------------------------------ */

    commitStrategy(enforced.targets, { DEBUG });

    visualizeParserCycle(G.cycle, G);

    finalizeStrategyRun({
      status: "success",
      targetCount: enforced.targets.length,
      droppedDetails: enforced.meta?.droppedDetails || []
    });

    console.trace("=== STRATEGY PIPELINE SUCCESS ===");

    return {
      status: "success",
      targets: enforced.targets,
      meta: enforced.meta
    };

  } catch (err) {

    console.error("[PIPELINE] fatal error:", err.message);

    finalizeStrategyRun({
      status: "failure",
      stage: "fatal",
      message: err.message
    });

    return {
      status: "failure",
      stage: "fatal",
      error: err.message
    };
  }
}