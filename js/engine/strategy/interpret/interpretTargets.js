// js/engine/strategy/interpret/interpretTargets.js

import { normalizeStrategyIds } from "./normalizeIds.js";
import { inferPlaceholderTarget } from "./inferPlaceholderTarget.js";
import { fuzzyMatchTarget } from "./fuzzyMatchTarget.js";
import { SIM_IDS } from "../../../core/constants.js";

/* ============================================================
   INTERPRET TARGETS

   PURPOSE:
   - Resolve raw extracted targets into normalized, usable targets
   - Apply ID normalization, placeholder inference, fuzzy matching
   - Expand group targets into individual targets

   DESIGN PRINCIPLES:
   - No mutation of global state
   - No validation or rejection
   - Maximum salvage of usable targets
   - Preserve parser behavior from legacy system

   RETURNS:
   [
     {
       id,
       objective,
       hypothesis,
       why_now,
       evidence,
       _inferenceConfidence?,
       _derivedFromGroup?
     }
   ]
============================================================ */

export function interpretTargets(rawTargets, { DEBUG = false } = {}) {

  if (!Array.isArray(rawTargets)) {
    if (DEBUG) console.warn("[INTERPRET] invalid input (not array)");
    return [];
  }

  const results = [];

  rawTargets.forEach((target, index) => {

    if (!target || typeof target !== "object") {
      if (DEBUG) console.warn(`[INTERPRET] skipping invalid target at ${index}`);
      return;
    }

    let {
      id,
      objective,
      hypothesis,
      why_now,
      evidence
    } = target;

    if (!id || typeof id !== "string") {
      if (DEBUG) console.warn(`[INTERPRET] missing id at ${index}`);
      return;
    }

    /* ------------------------------------------------------------
       NORMALIZE IDS (handles A & B, A,B etc.)
    ------------------------------------------------------------ */

    let ids = normalizeStrategyIds(id);

    if (ids.length === 0) {
      if (DEBUG) console.warn(`[INTERPRET] no valid ids after normalization`);
      return;
    }

    /* ------------------------------------------------------------
       GROUP TARGET EXPANSION
    ------------------------------------------------------------ */

    ids.forEach((candidateId) => {

      let resolvedId = candidateId;
      let inferenceConfidence = target._inferenceConfidence ?? 0.5;
      let derivedFromGroup = ids.length > 1;

      /* ------------------------------------------------------------
         PLACEHOLDER INFERENCE
      ------------------------------------------------------------ */

      const inferred = inferPlaceholderTarget({
        id: candidateId,
        objective,
        hypothesis,
        why_now,
        evidence
      }, { DEBUG });

      if (inferred?.id) {
        resolvedId = inferred.id;
        inferenceConfidence = inferred.confidence ?? inferenceConfidence;
      }

      /* ------------------------------------------------------------
         FUZZY MATCH FALLBACK
      ------------------------------------------------------------ */

      if (!SIM_IDS.includes(resolvedId)) {
        const fuzzy = fuzzyMatchTarget(resolvedId, SIM_IDS, { DEBUG });

        if (fuzzy) {
          resolvedId = fuzzy;
        } else {
          if (DEBUG) {
            console.warn(`[INTERPRET] unable to resolve id: ${resolvedId}`);
          }
          return;
        }
      }

      /* ------------------------------------------------------------
         PUSH RESULT
      ------------------------------------------------------------ */

      results.push({
        id: resolvedId,
        objective,
        hypothesis,
        why_now,
        evidence,
        _inferenceConfidence: inferenceConfidence,
        _derivedFromGroup: derivedFromGroup
      });

    });

  });

  if (DEBUG) {
    console.debug(`[INTERPRET] produced ${results.length} targets`);
  }

  return results;
}