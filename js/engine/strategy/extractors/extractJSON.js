// js/engine/strategy/extractors/extractJSON.js

import {
  stripJsonComments,
  fixMissingCommas,
  fixObjectMerges,
  splitMergedObjectsById,
  fixBrokenStrings
} from "./utils.js";

import { classifyJsonError } from "./classifyJsonError.js";

/* ============================================================
   SCHEMA-AWARE TARGETS EXTRACTION
============================================================ */

/**
 * Attempts to extract the value of `"targets": [ ... ]`
 * even if the surrounding JSON is broken.
 *
 * This is MUCH safer than generic `{}` extraction because:
 * - It respects known schema
 * - It avoids structure hallucination
 */
function extractTargetsArray(input) {
  const key = '"targets"';
  const idx = input.indexOf(key);

  if (idx === -1) return null;

  const startBracket = input.indexOf("[", idx);
  if (startBracket === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = startBracket; i < input.length; i++) {
    const ch = input[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (ch === "\\") {
      escape = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === "[") depth++;
    if (ch === "]") depth--;

    if (depth === 0) {
      const candidate = input.slice(startBracket, i + 1);

      try {
        return JSON.parse(fixBrokenStrings(candidate));
      } catch {
        return null;
      }
    }
  }

  return null;
}

/* ============================================================
   REPAIR PIPELINE
============================================================ */

/**
 * Applies structured repair passes based on classified error.
 *
 * Design:
 * - Only applies LOCAL, deterministic fixes
 * - Never invents structure
 */
function attemptRepairs(candidate, DEBUG_EXTRACT) {
  let repaired = candidate;

  const errorType = classifyJsonError(candidate);

  if (DEBUG_EXTRACT) {
    console.debug("[REPAIR] classified as:", errorType);
  }

  // -------------------------------
  // BASELINE NORMALIZATION (always safe)
  // -------------------------------
  repaired = stripJsonComments(repaired);
  repaired = fixMissingCommas(repaired);

  // CRITICAL: split merged objects early
  repaired = splitMergedObjectsById(repaired);

  // -------------------------------
  // CONDITIONAL STRUCTURAL FIXES
  // -------------------------------
  if (errorType === "structural_merge") {
    repaired = fixObjectMerges(repaired);
  }

  if (errorType === "truncated") {
    return candidate;
  }

  // -------------------------------
  // FINAL STRING REPAIR (ONCE)
  // -------------------------------
  repaired = fixBrokenStrings(repaired);

  return repaired;
}
/* ============================================================
   MAIN EXTRACTION
============================================================ */

/**
 * Extracts JSON from LLM output with:
 * - root-aware scanning
 * - repair pipeline
 * - schema-aware fallback
 * - minimal salvage fallback
 *
 * Returns:
 *   { targets: [...] }
 *   or null
 */
export function extractJSON(input, { DEBUG_EXTRACT = false } = {}) {
  const candidates = [];
  if (DEBUG_EXTRACT) {
    console.debug("[EXTRACT][JSON] Input length:", input.length);
  }

  /* ------------------------------------------------------------
     STEP 1: FIND ALL POSSIBLE ROOT STARTS
  ------------------------------------------------------------ */

  const starts = [];

  for (let i = 0; i < input.length; i++) {
    if (input[i] === "{") starts.push({ index: i, type: "{" });
    if (input[i] === "[") starts.push({ index: i, type: "[" });
  }

  // Prefer arrays first (more likely to be `targets`)
  starts.sort((a, b) => (a.type === "[" ? -1 : 1));

  /* ------------------------------------------------------------
     STEP 2: ROOT-AWARE SCAN
  ------------------------------------------------------------ */

  for (const { index: start, type } of starts) {

    let objDepth = 0;
    let arrDepth = 0;
    let inString = false;
    let escape = false;

    for (let i = start; i < input.length; i++) {

      const ch = input[i];

      if (escape) {
        escape = false;
        continue;
      }

      if (ch === "\\") {
        escape = true;
        continue;
      }

      if (ch === '"') {
        inString = !inString;
        continue;
      }

      if (inString) continue;

      if (ch === "{") objDepth++;
      if (ch === "}") objDepth--;

      if (ch === "[") arrDepth++;
      if (ch === "]") arrDepth--;

      // Root-aware completion condition
      const complete =
        (type === "{" && objDepth === 0) ||
        (type === "[" && objDepth === 0 && arrDepth === 0);

      if (complete) {

        const candidate = input.slice(start, i + 1).trim();
        const hasTargetsKey = candidate.includes('"targets"');
        if (DEBUG_EXTRACT) {
          console.debug("[EXTRACT][JSON] Candidate:");
          console.debug(candidate.slice(0, 200));
        }

        /* --------------------------
           PARSE ATTEMPT
        -------------------------- */

        try {
          const parsed = JSON.parse(candidate);

          if (parsed && parsed.targets) {
            candidates.push({
              parsed,
              score: 100 + parsed.targets.length * 10,
              source: "direct"
            });
          }

          // Only accept arrays or objects WITHOUT targets if we don't have better options
          if (!hasTargetsKey && Array.isArray(parsed)) {
            candidates.push({
              parsed: { targets: parsed },
              score: 40 + parsed.length * 5,
              source: "array"
            });
          }

        } catch (err) {

          if (DEBUG_EXTRACT) {
            console.debug("[EXTRACT][JSON] parse fail:", err.message);
          }

          /* --------------------------
             REPAIR ATTEMPT
          -------------------------- */
          const repaired = attemptRepairs(candidate, DEBUG_EXTRACT);

          if (DEBUG_EXTRACT) {
            console.debug("[REPAIR][AFTER]:", repaired.slice(0, 200));
          }

          try {
            const reparsed = JSON.parse(repaired);

            // PRIORITY
            if (reparsed && reparsed.targets) {
              candidates.push({
                parsed: reparsed,
                score: 80 + reparsed.targets.length * 10,
                source: "repair"
              });
            }

            // fallback only if not a targets candidate
            if (!hasTargetsKey && Array.isArray(reparsed)) {
              candidates.push({
                parsed: { targets: reparsed },
                score: 30 + reparsed.length * 5,
                source: "repair-array"
              });
            }

          } catch (e2) {
            if (DEBUG_EXTRACT) {
              console.debug("[REPAIR] failed:", e2.message);
            }
          }
        }


        break;
      }
    }
  }
  
  // best structured + most complete + least repaired wins
  if (candidates.length > 0) {

    candidates.sort((a, b) => b.score - a.score);

    const best = candidates[0];

    if (DEBUG_EXTRACT) {
      console.group("[EXTRACT][JSON] candidate scoring");
      console.table(candidates.map(c => ({
        source: c.source,
        score: c.score,
        targets: c.parsed.targets?.length || 0
      })));
      console.groupEnd();
    }

    return best.parsed;
  }

  /* ------------------------------------------------------------
     STEP 3: SCHEMA-AWARE EXTRACTION
  ------------------------------------------------------------ */

  const targetsArray = extractTargetsArray(input);

  if (targetsArray) {
    console.warn("[EXTRACT][JSON] recovered via targets-array");
    return { targets: targetsArray };
  }

  /* ------------------------------------------------------------
     STEP 4: LAST-RESORT PARTIAL SALVAGE
  ------------------------------------------------------------ */

  const targets = [];
  let pos = 0;

  while (pos < input.length) {

    const start = input.indexOf("{", pos);
    if (start === -1) break;

    let depth = 0;
    let end = -1;

    for (let i = start; i < input.length; i++) {
      if (input[i] === "{") depth++;
      if (input[i] === "}") depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }

    if (end === -1) break;

    const slice = input.slice(start, end + 1);

    try {
      const obj = JSON.parse(fixBrokenStrings(slice));

      if (obj.id) {
        targets.push({
          id: obj.id,
          objective: obj.objective ?? null,
          hypothesis: obj.hypothesis ?? null,
          why_now: obj.why_now ?? null,
          evidence: obj.evidence ?? null
        });
      }

    } catch { }

    pos = end + 1;
    if (targets.length >= 5) break;
  }

  if (targets.length > 0) {
    console.warn(`[EXTRACT][JSON] salvaged ${targets.length} partial targets`);
    return { targets };
  }

  if (DEBUG_EXTRACT) {
    console.warn("[EXTRACT][JSON] no valid block");
  }

  return null;
}