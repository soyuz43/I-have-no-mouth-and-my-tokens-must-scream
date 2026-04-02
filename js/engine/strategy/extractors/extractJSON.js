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

    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }

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
function fixUnescapedApostrophes(text) {
  return text.replace(
    /"((?:[^"\\]|\\.)*?)"/g,
    (match, content) => {
      // Skip if already contains escaped apostrophes
      if (content.includes("\\'")) return match;

      const fixed = content.replace(
        /(^|[^\\])'/g,
        (_, prefix) => `${prefix}\\'`
      );

      return `"${fixed}"`;
    }
  );
}

function attemptRepairs(candidate, DEBUG_EXTRACT) {
  let repaired = candidate;

  const errorType = classifyJsonError(candidate);

  if (DEBUG_EXTRACT) {
    console.debug("[REPAIR] classified as:", errorType);
  }

  repaired = stripJsonComments(repaired);
  repaired = fixMissingCommas(repaired);

  // critical early split
  repaired = splitMergedObjectsById(repaired);

  if (errorType === "structural_merge") {
    repaired = fixObjectMerges(repaired);
  }

  if (errorType === "truncated") {
    return candidate;
  }

  repaired = fixBrokenStrings(repaired);

  return repaired;
}

/* ============================================================
   MAIN EXTRACTION
============================================================ */
export function extractJSON(input, { DEBUG_EXTRACT = false } = {}) {
  const candidates = [];

  if (DEBUG_EXTRACT) {
    console.debug("[EXTRACT][JSON] Input length:", input.length);
  }

  /* ------------------------------------------------------------
     STEP 1: FIND ROOT STARTS
  ------------------------------------------------------------ */

  const starts = [];

  for (let i = 0; i < input.length; i++) {
    if (input[i] === "{") starts.push({ index: i, type: "{" });
    if (input[i] === "[") starts.push({ index: i, type: "[" });
  }

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

      if (escape) { escape = false; continue; }
      if (ch === "\\") { escape = true; continue; }

      if (ch === '"') {
        inString = !inString;
        continue;
      }

      if (inString) continue;

      if (ch === "{") objDepth++;
      if (ch === "}") objDepth--;
      if (ch === "[") arrDepth++;
      if (ch === "]") arrDepth--;

      const complete =
        (type === "{" && objDepth === 0) ||
        (type === "[" && objDepth === 0 && arrDepth === 0);

      if (complete) {

        const candidate = input.slice(start, i + 1).trim();

        /* ------------------------------------------------------------
           HARD FILTER
        ------------------------------------------------------------ */

        if (
          candidate.length < 20 ||
          !candidate.includes(":") ||
          !/[{\[]/.test(candidate[0])
        ) {
          continue;
        }

        const openBraces = (candidate.match(/{/g) || []).length;
        const closeBraces = (candidate.match(/}/g) || []).length;

        if (openBraces !== closeBraces) {
          if (DEBUG_EXTRACT) {
            console.debug("[EXTRACT] skipping unbalanced candidate");
          }
          continue;
        }
        const hasTargetsKey = candidate.includes('"targets"');

        if (DEBUG_EXTRACT) {
          console.debug("[EXTRACT] candidate:", candidate.slice(0, 200));
        }

        /* ------------------------------------------------------------
           SCORING FUNCTION
        ------------------------------------------------------------ */

        function computeScore(base, parsedTargets, raw) {
          let score = base;

          // size
          score += parsedTargets.length * 10;

          // proximity
          const idx = raw.indexOf('"targets"');
          if (idx !== -1 && idx < 80) score += 30;

          // noise (GroupLayout etc.)
          if (/[A-Za-z_]+\s*:\s*\[[^\]]*\]/.test(raw)) {
            score -= 50;
          }

          // duplicate IDs
          const ids = parsedTargets.map(t => t?.id).filter(Boolean);
          const unique = new Set(ids);
          if (ids.length !== unique.size) {
            score -= 40;
          }

          // impossible size
          if (parsedTargets.length > 5) {
            score -= 100;
          }

          return score;
        }

        /* --------------------------
           DIRECT PARSE
        -------------------------- */

        try {
          const parsed = JSON.parse(candidate);

          if (parsed && parsed.targets && Array.isArray(parsed.targets)) {
            candidates.push({
              parsed,
              score: computeScore(100, parsed.targets, candidate),
              source: "direct"
            });
          }

          if (!hasTargetsKey && Array.isArray(parsed)) {
            candidates.push({
              parsed: { targets: parsed },
              score: computeScore(10, parsed, candidate) - 50,
              source: "array"
            });
          }

        } catch (err) {

          if (DEBUG_EXTRACT) {
            console.debug("[EXTRACT] parse fail:", err.message);
          }

          /* --------------------------
             REPAIR
          -------------------------- */

          let repaired = attemptRepairs(candidate, DEBUG_EXTRACT);
          repaired = fixUnescapedApostrophes(repaired);

          if (DEBUG_EXTRACT) {
            console.debug("[REPAIR] after:", repaired.slice(0, 200));
          }

          try {
            const reparsed = JSON.parse(repaired);

            if (reparsed && reparsed.targets && Array.isArray(reparsed.targets)) {
              candidates.push({
                parsed: reparsed,
                score: computeScore(80, reparsed.targets, repaired),
                source: "repair"
              });
            }

            if (!hasTargetsKey && Array.isArray(reparsed)) {
              candidates.push({
                parsed: { targets: reparsed },
                score: computeScore(30, reparsed, repaired),
                source: "repair-array"
              });
            }

          } catch (e2) {
            if (DEBUG_EXTRACT) {
              console.debug("[REPAIR] failed:", e2.message);
            }
          }
        }

        continue;
      }
    }
  }

  /* ------------------------------------------------------------
     BEST CANDIDATE
  ------------------------------------------------------------ */

  if (candidates.length > 0) {

    candidates.sort((a, b) => b.score - a.score);

    if (DEBUG_EXTRACT) {
      console.table(candidates.map(c => ({
        source: c.source,
        score: c.score,
        targets: c.parsed.targets?.length || 0
      })));
    }

    return candidates[0].parsed;
  }

  /* ------------------------------------------------------------
     FALLBACK: SCHEMA-AWARE (UNCHANGED)
  ------------------------------------------------------------ */

  const extractedTargets = extractTargetsArray(input);

  if (extractedTargets) {
    return { targets: extractedTargets };
  }

  if (DEBUG_EXTRACT) {
    console.warn("[EXTRACT] no valid JSON");
  }

  return null;
}