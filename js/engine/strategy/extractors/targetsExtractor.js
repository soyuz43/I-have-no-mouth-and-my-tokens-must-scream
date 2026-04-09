// filepath: js/engine/strategy/extractors/targetsExtractor.js

import {
  stripJsonComments,
  fixMissingCommas,
  splitMergedObjectsById
} from "./utils.js";

import { normalizeTargetKeys } from "./normalizeKeys.js";

/* ============================================================
   STRING REPAIR (SHARED LOGIC — KEEP IN SYNC WITH extractJSON)
============================================================ */

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
   TARGETS ARRAY EXTRACTOR (SCHEMA-AWARE)
============================================================ */

export function extractTargetsArray(input, { DEBUG_EXTRACT = false } = {}) {

  if (typeof input !== "string") {
    if (DEBUG_EXTRACT) {
      console.warn("[EXTRACT][TARGETS] invalid input type");
    }
    return null;
  }

  if (DEBUG_EXTRACT) {
    console.debug("[EXTRACT][TARGETS] scanning for targets array");
  }

  let inString = false;
  let escape = false;

  for (let i = 0; i < input.length; i++) {

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

    // detect "targets"
    if (input.slice(i, i + 9) === '"targets"') {

      let j = i + 9;

      // skip whitespace
      while (/\s/.test(input[j])) j++;

      if (input[j] !== ":") continue;
      j++;

      while (/\s/.test(input[j])) j++;

      if (input[j] !== "[") continue;

      const start = j;
      let depth = 0;

      let localInString = false;
      let localEscape = false;

      for (; j < input.length; j++) {

        const c = input[j];

        if (localEscape) {
          localEscape = false;
          continue;
        }

        if (c === "\\") {
          localEscape = true;
          continue;
        }

        if (c === '"') {
          localInString = !localInString;
          continue;
        }

        if (localInString) continue;

        if (c === "[") depth++;
        if (c === "]") depth--;

        if (depth === 0) {

          let arrayStr = input.slice(start, j + 1);

          if (DEBUG_EXTRACT) {
            console.debug("[EXTRACT][TARGETS] candidate found");
            console.debug(arrayStr.slice(0, 200));
          }

          /* --------------------------
             REPAIR PIPELINE (ALIGNED)
          -------------------------- */

          let repaired = arrayStr;

          // 1. strip comments
          repaired = stripJsonComments(repaired);

          // 2. fix commas between fields
          repaired = fixMissingCommas(repaired);

          // 3. split merged objects (critical for multi-id collapse)
          repaired = splitMergedObjectsById(repaired);

          // 4. normalize object boundaries
          repaired = repaired.replace(/},\s*,\s*{/g, "},{");

          // 5. strip trailing commas
          repaired = repaired.trim().replace(/,\s*$/, "");

          // 6. final string repair
          repaired = fixBrokenStrings(repaired);

          try {
            const parsedArray = JSON.parse(repaired);

            if (!Array.isArray(parsedArray)) continue;

            if (DEBUG_EXTRACT) {
              console.warn("[EXTRACT][TARGETS] SUCCESS");
            }

            const normalizedArray = parsedArray.map(t => normalizeTargetKeys(t));

            return { targets: normalizedArray };

          } catch (err) {

            if (DEBUG_EXTRACT) {
              console.debug("[EXTRACT][TARGETS] parse fail:", err.message);
              console.debug("[EXTRACT][TARGETS] repaired preview:", repaired.slice(0, 200));
            }
          }

          break;
        }
      }
    }
  }

  if (DEBUG_EXTRACT) {
    console.warn("[EXTRACT][TARGETS] no valid array found");
  }

  return null;
}