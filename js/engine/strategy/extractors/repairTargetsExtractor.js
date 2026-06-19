// js/engine/strategy/extractors/repairTargetsExtractor.js

import {
  stripJsonComments,
  fixSingleQuotedSchemaValues,
  fixMissingCommas,
  fixObjectMerges,
  fixBrokenStrings,
  fixStrayQuoteAfterComma,
  repairObjectBoundaries,
  splitRepeatedObjectBlocks,
  splitMultiIdCascade
} from "./utils.js";

import {
  normalizeUnicode,
} from "./normalizeUnicode.js";

import { normalizeTargetKeys } from "./normalizeKeys.js";

export function repairTargetsExtractor(
  input,
  { DEBUG_EXTRACT = false } = {}
) {
  if (typeof input !== "string") {
    return null;
  }

  if (DEBUG_EXTRACT) {
    console.debug(
      "[EXTRACT][REPAIR] attempting structural repair"
    );
  }

  /*
   * Normalize recoverable schema strings before locating the
   * array, avoiding a second incompatible apostrophe parser.
   */
  const source =
    fixSingleQuotedSchemaValues(
      normalizeUnicode(input)
    );
  const targetsIndex = source.indexOf('"targets"');

  if (targetsIndex === -1) {
    if (DEBUG_EXTRACT) {
      console.warn("[REPAIR] targets key not found");
    }

    return null;
  }

  let cursor = targetsIndex + '"targets"'.length;

  while (cursor < source.length && /\s/.test(source[cursor])) {
    cursor++;
  }

  if (source[cursor] !== ":") {
    return null;
  }

  cursor++;

  while (cursor < source.length && /\s/.test(source[cursor])) {
    cursor++;
  }

  if (source[cursor] !== "[") {
    return null;
  }

  const start = cursor;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (; cursor < source.length; cursor++) {
    const ch = source[cursor];

    if (escape) {
      escape = false;
      continue;
    }

    if (inString && ch === "\\") {
      escape = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (ch === "[") {
      depth++;
    } else if (ch === "]") {
      depth--;
    }

    if (depth !== 0) {
      continue;
    }

    let repaired = source.slice(start, cursor + 1);

    if (DEBUG_EXTRACT) {
      console.debug("[REPAIR] original array:");
      console.debug(repaired.slice(0, 200));
    }

    repaired = stripJsonComments(repaired);
    repaired = fixSingleQuotedSchemaValues(repaired);
    repaired = fixMissingCommas(repaired);

    repaired = splitMultiIdCascade(repaired);
    repaired = splitRepeatedObjectBlocks(repaired);
    repaired = repairObjectBoundaries(repaired);
    repaired = fixObjectMerges(repaired);

    repaired = fixStrayQuoteAfterComma(repaired);
    repaired = fixBrokenStrings(repaired);

    if (DEBUG_EXTRACT) {
      console.debug("[REPAIR] repaired array:");
      console.debug(repaired.slice(0, 200));
    }

    try {
      const parsedArray = JSON.parse(repaired);

      if (!Array.isArray(parsedArray)) {
        return null;
      }

      if (DEBUG_EXTRACT) {
        console.warn("[REPAIR] SUCCESS (structural)");
      }

      return {
        targets: parsedArray.map(target =>
          normalizeTargetKeys(target)
        )
      };
    } catch (err) {
      if (DEBUG_EXTRACT) {
        console.debug(
          "[REPAIR] parse failed:",
          err.message
        );
      }

      return null;
    }
  }

  if (DEBUG_EXTRACT) {
    console.warn("[REPAIR] no recoverable targets array");
  }

  return null;
}