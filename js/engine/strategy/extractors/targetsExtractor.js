// filepath: js/engine/strategy/extractors/targetsExtractor.js

import {
  stripJsonComments,
  fixSingleQuotedSchemaValues,
  fixMissingCommas,
  fixBrokenStrings,
  fixStrayQuoteAfterComma,
  splitRepeatedObjectBlocks,
  repairObjectBoundaries
} from "./utils.js";

import { normalizeTargetKeys } from "./normalizeKeys.js";

import {
  normalizeUnicode,
} from "./normalizeUnicode.js";

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

  /*
   * Repair known single-quoted schema values before scanning.
   * The scanner can then rely on normal JSON double-quote rules
   * without guessing whether an apostrophe is possessive.
   */
  const source =
    fixSingleQuotedSchemaValues(
      normalizeUnicode(input)
    );
  const targetsIndex = source.indexOf('"targets"');

  if (targetsIndex === -1) {
    if (DEBUG_EXTRACT) {
      console.warn("[EXTRACT][TARGETS] targets key not found");
    }

    return null;
  }

  let cursor = targetsIndex + '"targets"'.length;

  while (cursor < source.length && /\s/.test(source[cursor])) {
    cursor++;
  }

  if (source[cursor] !== ":") {
    if (DEBUG_EXTRACT) {
      console.warn("[EXTRACT][TARGETS] targets key missing colon");
    }

    return null;
  }

  cursor++;

  while (cursor < source.length && /\s/.test(source[cursor])) {
    cursor++;
  }

  if (source[cursor] !== "[") {
    if (DEBUG_EXTRACT) {
      console.warn("[EXTRACT][TARGETS] targets value is not an array");
    }

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

    const arrayStr = source.slice(start, cursor + 1);

    if (DEBUG_EXTRACT) {
      console.debug("[EXTRACT][TARGETS] candidate found");
      console.debug(arrayStr.slice(0, 200));
    }

    let repaired = arrayStr;

    repaired = stripJsonComments(repaired);
    repaired = fixSingleQuotedSchemaValues(repaired);
    repaired = fixMissingCommas(repaired);

    repaired = splitRepeatedObjectBlocks(repaired);
    repaired = repairObjectBoundaries(repaired);

    repaired = repaired.replace(/},\s*,\s*{/g, "},{");
    repaired = repaired.trim().replace(/,\s*$/, "");

    repaired = fixStrayQuoteAfterComma(repaired);
    repaired = fixBrokenStrings(repaired);

    try {
      const parsedArray = JSON.parse(repaired);

      if (!Array.isArray(parsedArray)) {
        return null;
      }

      if (DEBUG_EXTRACT) {
        console.warn("[EXTRACT][TARGETS] SUCCESS");
      }

      return {
        targets: parsedArray.map(
          (target) =>
            normalizeTargetKeys(target)
        ),
      };

    } catch (err) {
      if (DEBUG_EXTRACT) {
        console.debug(
          "[EXTRACT][TARGETS] parse fail:",
          err.message
        );

        console.debug(
          "[EXTRACT][TARGETS] repaired preview:",
          repaired.slice(0, 200)
        );
      }

      return null;
    }
  }

  if (DEBUG_EXTRACT) {
    console.warn("[EXTRACT][TARGETS] unterminated targets array");
  }

  return null;
}