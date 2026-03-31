// js/engine/strategy/interpret/fuzzyMatchTarget.js

import { levenshtein } from "../extractors/levenshtein.js";

/* ============================================================
   FUZZY TARGET RESOLUTION

   PURPOSE:
   Resolves malformed or slightly corrupted target IDs
   using Levenshtein distance.

   DESIGN PRINCIPLES:
   - Deterministic (no randomness)
   - Conservative (strict threshold)
   - No inference (pure string similarity)
   - No coupling to global state
   - Last-resort fallback after normalization + inference

   RETURNS:
   - valid ID string (e.g. "TED")
   - null if no safe match found
============================================================ */

export function fuzzyMatchTarget(rawId, validIds, { DEBUG = false } = {}) {
  /* ------------------------------------------------------------
     INPUT VALIDATION
  ------------------------------------------------------------ */

  if (!rawId || typeof rawId !== "string") {
    if (DEBUG) {
      console.warn("[FUZZY] invalid input:", rawId);
    }
    return null;
  }

  if (!Array.isArray(validIds) || validIds.length === 0) {
    if (DEBUG) {
      console.warn("[FUZZY] invalid validIds:", validIds);
    }
    return null;
  }

  /* ------------------------------------------------------------
     NORMALIZATION
  ------------------------------------------------------------ */

  const normalize = (s) =>
    (s || "")
      .toUpperCase()
      .replace(/[^A-Z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const input = normalize(rawId);

  if (!input) {
    if (DEBUG) {
      console.warn("[FUZZY] empty after normalization:", rawId);
    }
    return null;
  }

  /* ------------------------------------------------------------
     EARLY EXIT (already valid)
  ------------------------------------------------------------ */

  if (validIds.includes(input)) {
    if (DEBUG) {
      console.debug(`[FUZZY] exact match: "${rawId}" → "${input}"`);
    }
    return input;
  }

  /* ------------------------------------------------------------
     LEVENSHTEIN MATCHING
  ------------------------------------------------------------ */

  let bestDist = Infinity;
  let bestMatch = null;

  for (const candidate of validIds) {
    const dist = levenshtein(input, candidate);

    if (dist < bestDist) {
      bestDist = dist;
      bestMatch = candidate;
    }
  }

  /* ------------------------------------------------------------
     THRESHOLD CHECK
  ------------------------------------------------------------ */

  const MAX_DISTANCE = 2;

  if (bestMatch && bestDist <= MAX_DISTANCE) {
    if (DEBUG) {
      console.warn(
        `[FUZZY] resolved: "${rawId}" → "${bestMatch}" (dist=${bestDist})`
      );
    }
    return bestMatch;
  }

  /* ------------------------------------------------------------
     NO SAFE MATCH
  ------------------------------------------------------------ */

  if (DEBUG) {
    console.warn(
      `[FUZZY] no match: "${rawId}" (best="${bestMatch}", dist=${bestDist})`
    );
  }

  return null;
}