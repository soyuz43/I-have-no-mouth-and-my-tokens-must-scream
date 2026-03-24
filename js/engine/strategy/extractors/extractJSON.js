// js/engine/strategy/extractors/extractJSON.js

import {
  stripJsonComments,
  fixMissingCommas,
  fixObjectMerges
} from "./utils.js";

import { classifyJsonError } from "./classifyJsonError.js";

/* ============================================================
   STRING REPAIR (SAFE, LOCAL)
============================================================ */

/**
 * Fixes unescaped quotes inside strings WITHOUT changing structure.
 *
 * Strategy:
 * - Track string state
 * - If a quote appears where it cannot legally terminate a string,
 *   escape it instead of closing the string.
 *
 * This prevents cases like:
 *   "I""  →  "I\""
 *
 * IMPORTANT:
 * This is intentionally conservative. It does NOT attempt to
 * "guess" missing structure.
 */
function fixBrokenStrings(input) {
  let out = "";
  let inString = false;
  let escape = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (escape) {
      out += ch;
      escape = false;
      continue;
    }

    if (ch === "\\") {
      out += ch;
      escape = true;
      continue;
    }

    if (ch === '"') {
      const next = input[i + 1];

      if (inString) {
        // If this quote is NOT followed by a valid terminator,
        // treat it as a broken quote and escape it.
        if (next && ![",", "}", "]", ":"].includes(next)) {
          out += '\\"';
          continue;
        }
      }

      inString = !inString;
      out += ch;
      continue;
    }

    out += ch;
  }

  return out;
}

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

  // Always safe
  repaired = stripJsonComments(repaired);

  switch (errorType) {
    case "missing_comma":
      repaired = fixMissingCommas(repaired);
      break;

    case "structural_merge":
      repaired = fixObjectMerges(repaired);
      break;

    case "truncated":
      // Do not attempt structural repair
      return candidate;
  }

  // Always apply string repair last
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

        if (DEBUG_EXTRACT) {
          console.debug("[EXTRACT][JSON] Candidate:");
          console.debug(candidate.slice(0, 200));
        }

        /* --------------------------
           PARSE ATTEMPT
        -------------------------- */
        try {
          const parsed = JSON.parse(candidate);

          if (Array.isArray(parsed)) return { targets: parsed };
          if (parsed && parsed.targets) return parsed;

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

            if (Array.isArray(reparsed)) return { targets: reparsed };
            if (reparsed && reparsed.targets) return reparsed;

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

    } catch {}

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