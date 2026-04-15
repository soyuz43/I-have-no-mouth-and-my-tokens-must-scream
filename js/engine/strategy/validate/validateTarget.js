// js/engine/strategy/validate/validateTarget.js
//
// TARGET VALIDATION — DELEGATES ALL OBSERVABILITY TO DEDICATED MODULE
//
// DESIGN PRINCIPLES:
// - No mutation, no global state access
// - Returns structured result (no throwing)
// - Validates STRUCTURE only: required fields, basic format
// - Delegates SEMANTICS (belief refs, direction, observability) to observability.js
//

// Import ONLY what we actually use (clean up unused imports)
import { validateHypothesisStructure } from "../hypothesis/observability.js";

// ============================================================================
// MAIN EXPORT: validateTarget()
// ============================================================================

export function validateTarget(target, id, { DEBUG = false } = {}) {
  if (DEBUG) {
    console.log(`[VALIDATE TARGET] ENTER`, { id, DEBUG });
  }

  const errors = [];
  const warnings = [];

  try {
    // --------------------------------------------------
    // BASIC STRUCTURE VALIDATION
    // --------------------------------------------------
    if (!target || typeof target !== "object") {
      errors.push(`Target must be an object`);
      if (DEBUG) console.warn("[VALIDATE TARGET] [X] Invalid target object");
      return { valid: false, errors, warnings };
    }

    const { objective, hypothesis, why_now, evidence } = target;

    // --------------------------------------------------
    // REQUIRED FIELDS
    // --------------------------------------------------
    const requiredKeys = ["objective", "hypothesis", "why_now", "evidence"];
    const missing = requiredKeys.filter((k) => !(k in target));
    if (missing.length > 0) {
      errors.push(`Missing required keys: ${missing.join(", ")}`);
      if (DEBUG) console.warn("[VALIDATE TARGET] [X] Missing keys:", missing);
    }

    // --------------------------------------------------
    // FIELD VALIDATION
    // --------------------------------------------------
    if (typeof objective !== "string" || !objective.trim()) {
      console.warn("[VALIDATE] missing/invalid objective. Raw target:", target);
      errors.push(`Invalid objective`);
    }

    if (typeof hypothesis !== "string" || !hypothesis.trim()) {
      errors.push(`Invalid hypothesis`);
    }

    if (typeof why_now !== "string" || why_now.trim().length < 15) {
      errors.push(`Invalid or weak why_now`);
    }

    if (typeof evidence !== "string" || evidence.trim().length < 10) {
      errors.push(`Invalid or weak evidence`);
    }

    // --------------------------------------------------
    // HYPOTHESIS OBSERVABILITY CHECK (CLEAN STRUCTURE)
    // --------------------------------------------------

    let hasHypothesis = false;

    if (typeof hypothesis !== "string") {
      if (DEBUG) console.log(`[VALIDATE TARGET] ⚠️ Hypothesis not a string`);
    } else if (!hypothesis.trim()) {
      if (DEBUG) console.log(`[VALIDATE TARGET] ⚠️ Hypothesis empty`);
    } else {
      // ✅ THIS is the only "normal path"
      hasHypothesis = true;

      if (DEBUG) {
        console.log(`[VALIDATE TARGET] Checking hypothesis`, {
          id,
          preview: hypothesis.slice(0, 150)
        });
      }

      if (typeof validateHypothesisStructure === "function") {
        try {
          const result = validateHypothesisStructure(hypothesis);
          const { isValid, components: rawComponents, warnings: structureWarnings } = result || {};

          // Normalize components
          const components = {
            format: rawComponents?.format ?? null,

            beliefRef: {
              hasReference: Boolean(rawComponents?.beliefRef?.hasReference),
              canonical: rawComponents?.beliefRef?.matchedBelief ?? null
            },

            direction: {
              hasDirection: Boolean(rawComponents?.direction?.hasDirection),
              type: rawComponents?.direction?.direction ?? null
            },

            observability: {
              tier: rawComponents?.observability?.tier ?? null
            }
          };

          if (!isValid && Array.isArray(structureWarnings)) {
            warnings.push(...structureWarnings);
          }

          if (DEBUG) {
            console.log(`[VALIDATE TARGET] Observability result`, {
              isValid,
              format: components?.format,
              belief: components?.beliefRef?.canonical,
              hasBeliefRef: components?.beliefRef?.hasReference,
              direction: components?.direction?.type,
              hasDirection: components?.direction?.hasDirection,
              tier: components?.observability?.tier
            });
          }

        } catch (err) {
          console.warn(`[VALIDATE TARGET] Observability failed`, err);
        }
      } else {
        if (DEBUG) {
          console.warn(`[VALIDATE TARGET] ⚠️ validateHypothesisStructure missing`);
        }
      }
    }

    // --------------------------------------------------
    // ALIGNMENT CHECK
    // --------------------------------------------------
    if (id && typeof id === "string") {
      const combined = ((evidence || "") + " " + (why_now || "") + " " + (hypothesis || "")).toLowerCase();

      if (!combined.includes(id.toLowerCase())) {
        warnings.push(`Alignment issue: fields may not reference target consistently`);
        if (DEBUG) console.warn(`[VALIDATE TARGET] ⚠️ Alignment issue`, { id });
      }
    }

    // --------------------------------------------------
    // FINAL RESULT
    // --------------------------------------------------
    const valid = errors.length === 0;

    if (DEBUG) {
      console.log(`[VALIDATE TARGET] EXIT`, {
        id,
        valid,
        errorCount: errors.length,
        warningCount: warnings.length,
        hasHypothesis
      });

      if (errors.length) console.warn("[VALIDATE TARGET] errors:", errors);
      if (warnings.length) console.warn("[VALIDATE TARGET] warnings:", warnings);
    }

    return {
      valid,
      errors,
      warnings
    };

  } catch (err) {
    console.error(`[VALIDATE TARGET] [!!] UNEXPECTED ERROR`, { id, err });

    return {
      valid: false,
      errors: [`Unexpected validation error: ${err?.message || err}`],
      warnings
    };
  }
}