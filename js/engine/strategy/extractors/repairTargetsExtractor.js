// js/engine/strategy/extractors/repairTargetsExtractor.js
import {
  stripJsonComments,
  fixMissingCommas,
  fixObjectMerges,
  fixBrokenStrings,
  repairObjectBoundaries,
  splitRepeatedObjectBlocks
} from "./utils.js";

import { normalizeTargetKeys } from "./normalizeKeys.js";



export function repairTargetsExtractor(input, { DEBUG_EXTRACT = false } = {}) {

  if (DEBUG_EXTRACT) {
    console.debug("[EXTRACT][REPAIR] attempting structural repair");
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

    // find "targets"
    if (input.slice(i, i + 9) === '"targets"') {

      let j = i + 9;

      while (/\s/.test(input[j])) j++;

      if (input[j] !== ":") continue;
      j++;

      while (/\s/.test(input[j])) j++;

      if (input[j] !== "[") continue;

      const start = j;
      let depth = 0;

      let innerInString = false;
      let innerEscape = false;

      for (; j < input.length; j++) {

        const c = input[j];

        if (innerEscape) {
          innerEscape = false;
          continue;
        }

        if (c === "\\") {
          innerEscape = true;
          continue;
        }

        if (c === '"') {
          innerInString = !innerInString;
          continue;
        }

        if (innerInString) continue;

        if (c === "[") depth++;
        if (c === "]") depth--;

        if (depth === 0) {

          let arrayStr = input.slice(start, j + 1);

          if (DEBUG_EXTRACT) {
            console.debug("[REPAIR] original array:");
            console.debug(arrayStr.slice(0, 200));
          }

          // -------------------------------
          // STRUCTURAL REPAIRS
          // -------------------------------
          let repaired = arrayStr;

          repaired = stripJsonComments(repaired);
          repaired = fixMissingCommas(repaired);

          // unified structural repair
          repaired = splitRepeatedObjectBlocks(repaired);
          repaired = repairObjectBoundaries(repaired);

          // structural normalization
          repaired = fixObjectMerges(repaired);

          // final string repair
          repaired = fixBrokenStrings(repaired);

          if (DEBUG_EXTRACT) {
            console.debug("[REPAIR] repaired array:");
            console.debug(repaired.slice(0, 200));
          }

          try {
            const parsedArray = JSON.parse(repaired);

            if (!Array.isArray(parsedArray)) return null;

            if (DEBUG_EXTRACT) {
              console.warn("[REPAIR] SUCCESS (structural)");
            }

            const normalizedArray = parsedArray.map(t => normalizeTargetKeys(t));

            return { targets: normalizedArray };

          } catch (err) {
            if (DEBUG_EXTRACT) {
              console.debug("[REPAIR] parse failed:", err.message);
            }
          }

          break;
        }
      }
    }
  }

  if (DEBUG_EXTRACT) {
    console.warn("[REPAIR] no recoverable targets array");
  }

  return null;
}