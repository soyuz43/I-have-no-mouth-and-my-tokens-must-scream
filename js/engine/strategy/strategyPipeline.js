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
import { extractLooseTargets } from "./extractors/extractLooseTargets.js";
import {
  startStrategyRun,
  setCleanedInput,
  logStrategyStage,
  finalizeStrategyRun
} from "./logging/logStrategyRun.js";

// ========== GLOBAL LOGGING CONTROL ==========
const LOG_PIPELINE_ONLY = true;      // Log just the stage transitions (no details)
const LOG_SANITIZE_DETAILS = true;  // Log sanitize input/output
const LOG_EXTRACT_DETAILS = true;   // Log extracted targets structure
const LOG_INTERPRET_DETAILS = true; // Log interpreted target IDs
const LOG_VALIDATE_DETAILS = true;  // Log validation results
const LOG_ENFORCE_DETAILS = true;   // Log enforcement details
const LOG_COMMIT_DETAILS = true;    // Log commit actions
const LOG_FALLBACK_DETAILS = true;   // Log when fallbacks are used (important)
const LOG_ERROR_DETAILS = true;      // Log all errors
// ============================================

// Helper logging functions
function logPipelineStage(stage, status, meta = {}) {
  if (LOG_PIPELINE_ONLY) {
    const details = Object.keys(meta).length ? ` (${Object.entries(meta).map(([k,v]) => `${k}:${v}`).join(', ')})` : '';
    console.log(`[PIPELINE] ${stage} → ${status}${details}`);
  }
}

function logSanitize(data) {
  if (LOG_SANITIZE_DETAILS) {
    console.debug("[SANITIZE]", data);
  }
}

function logExtract(data) {
  if (LOG_EXTRACT_DETAILS) {
    console.debug("[EXTRACT]", data);
  }
}

function logInterpret(data) {
  if (LOG_INTERPRET_DETAILS) {
    console.debug("[INTERPRET]", data);
  }
}

function logValidate(data) {
  if (LOG_VALIDATE_DETAILS) {
    console.debug("[VALIDATE]", data);
  }
}

function logEnforce(data) {
  if (LOG_ENFORCE_DETAILS) {
    console.debug("[ENFORCE]", data);
  }
}

function logCommit(data) {
  if (LOG_COMMIT_DETAILS) {
    console.debug("[COMMIT]", data);
  }
}

function logFallback(message, data = null) {
  if (LOG_FALLBACK_DETAILS) {
    console.warn(`[FALLBACK] ${message}`, data || "");
  }
}

function logError(stage, error) {
  if (LOG_ERROR_DETAILS) {
    console.error(`[PIPELINE ERROR] ${stage}:`, error?.message || error);
  }
}

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

  if (LOG_PIPELINE_ONLY) console.log(`\n[PIPELINE] STARTING STRATEGY CYCLE`);
  console.trace("=== STRATEGY PIPELINE START ===");

  startStrategyRun(rawText, { DEBUG });

  try {

    /* ------------------------------------------------------------
       SANITIZE
    ------------------------------------------------------------ */

    logPipelineStage("sanitize", "start");
    
    const cleaned = sanitizeStrategyInput(rawText, { DEBUG });
    logSanitize({ inputLength: rawText?.length || 0, outputLength: cleaned?.length || 0 });

    setCleanedInput(cleaned);

    logStrategyStage("sanitize", {
      output: { length: cleaned?.length || 0 }
    });

    logPipelineStage("sanitize", "complete", { length: cleaned?.length || 0 });

    /* ------------------------------------------------------------
       EXTRACT
    ------------------------------------------------------------ */

    logPipelineStage("extract", "start");

    let extracted = extractStrategy(cleaned, { DEBUG });

    if (!extracted || !extracted.targets) {

      logFallback("extract failed, attempting loose target extraction");
      logPipelineStage("extract", "fallback_attempt");

      const fallback = extractLooseTargets(cleaned, { DEBUG_EXTRACT: DEBUG });

      if (!fallback || !fallback.targets || fallback.targets.length === 0) {

        const errorType = classifyJsonError(cleaned);
        logError("extract", { errorType, reason: "loose extraction also failed" });
        logPipelineStage("extract", "failure", { errorType });

        G.lastExtractedTargets = extracted?.targets || [];

        logStrategyStage("extract", {
          error: true,
          errorType,
          output: { targetsFound: G.lastExtractedTargets.length }
        });

        finalizeStrategyRun({
          status: "failure",
          stage: "extract",
          errorType
        });

        G.lastStrategyFailure = {
          type: "extract_failure",
          stage: "extract",
          recovered: G.lastExtractedTargets?.length || 0
        };

        return {
          status: "failure",
          stage: "extract",
          errorType
        };
      }

      extracted = fallback;
      logFallback("loose extraction succeeded", { targetCount: fallback.targets.length });

      G.lastStrategyFailure = {
        type: "degraded_execution",
        stage: "extract",
        recovered: fallback.targets.length
      };

      G.executionMeta = {
        ...(G.executionMeta || {}),
        degraded: true,
        fallback: "loose-extractor"
      };
    }

    logExtract({ targetsFound: extracted.targets.length });
    logPipelineStage("extract", "complete", { targets: extracted.targets.length });

    logStrategyStage("extract", {
      output: { targetsFound: extracted.targets.length }
    });

    G.lastExtractedTargets = extracted.targets || [];

    /* ------------------------------------------------------------
       INTERPRET
    ------------------------------------------------------------ */

    logPipelineStage("interpret", "start");

    const interpreted = interpretTargets(extracted.targets, { DEBUG });

    if (!interpreted || interpreted.length === 0) {
      logError("interpret", "no valid targets after interpretation");
      logPipelineStage("interpret", "failure", { count: 0 });

      finalizeStrategyRun({
        status: "failure",
        stage: "interpret"
      });

      return {
        status: "failure",
        stage: "interpret"
      };
    }

    logInterpret({ ids: interpreted.map(t => t.id) });
    logPipelineStage("interpret", "complete", { count: interpreted.length });

    logStrategyStage("interpret", {
      output: {
        ids: interpreted.map(t => t.id),
        count: interpreted.length
      }
    });

    /* ------------------------------------------------------------
       VALIDATE
    ------------------------------------------------------------ */

    logPipelineStage("validate", "start");

    let validated;

    try {
      validated = validateTargetsArray(interpreted, { DEBUG: true });
    } catch (err) {
      logError("validate", err);
      logPipelineStage("validate", "exception", { error: err.message });

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
      logFallback("validation empty, using interpreted targets as fallback");
      logPipelineStage("validate", "fallback", { original: interpreted.length, validated: 0 });

      validated = interpreted;

      G.executionMeta = {
        ...(G.executionMeta || {}),
        degraded: true,
        fallback: "validation-salvage"
      };

      G.lastStrategyFailure = {
        type: "degraded_execution",
        stage: "validate",
        recovered: validated.length
      };
    }

    logValidate({ validatedCount: validated.length });
    logPipelineStage("validate", "complete", { passed: validated.length });

    logStrategyStage("validate", {
      output: { count: validated.length }
    });

    /* ------------------------------------------------------------
       ENFORCE
    ------------------------------------------------------------ */

    logPipelineStage("enforce", "start");

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
      logError("enforce", "no targets survived enforcement");
      logPipelineStage("enforce", "failure", { dropped: enforced.meta?.droppedDetails?.length || 0 });

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

    logEnforce({ 
      kept: enforced.targets.length, 
      dropped: enforced.meta?.droppedDetails?.length || 0,
      ids: enforced.targets.map(t => t.id)
    });
    logPipelineStage("enforce", "complete", { kept: enforced.targets.length, dropped: enforced.meta?.droppedDetails?.length || 0 });

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

    logPipelineStage("commit", "start");

    commitStrategy(enforced.targets, { DEBUG });
    logCommit({ committed: enforced.targets.length });

    visualizeParserCycle(G.cycle, G);

    G.lastStrategyFailure = null;

    finalizeStrategyRun({
      status: "success",
      targetCount: enforced.targets.length,
      droppedDetails: enforced.meta?.droppedDetails || []
    });

    logPipelineStage("complete", "success", { targets: enforced.targets.length });

    console.log("=== STRATEGY PIPELINE SUCCESS ===");

    return {
      status: "success",
      targets: enforced.targets,
      meta: enforced.meta
    };

  } catch (err) {

    logError("fatal", err);
    logPipelineStage("fatal", "failure", { error: err.message });

    console.error("[PIPELINE] fatal error:", err.message);
    console.error(err.stack);

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