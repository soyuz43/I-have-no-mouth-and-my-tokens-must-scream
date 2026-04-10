// js/engine/strategy/extractors/normalizeJsonShape.js

/**
 * Detects multiple top-level JSON objects and wraps them in an array.
 *
 * Converts:
 *   {...},{...},{...}
 *
 * Into:
 *   [ {...}, {...}, {...} ]
 *
 * SAFE:
 * - respects strings
 * - ignores commas inside strings
 * - only triggers if multiple root objects detected
 */

export function normalizeJsonShape(input) {
  if (typeof input !== "string") return input;

  let inString = false;
  let escape = false;

  let depth = 0;
  let rootObjectCount = 0;

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

    if (ch === "{") {
      if (depth === 0) {
        rootObjectCount++;
      }
      depth++;
    }

    if (ch === "}") {
      depth--;
    }
  }

  // If more than one root object → wrap in array
  if (rootObjectCount > 1) {
    return `[${input.trim().replace(/,\s*$/, "")}]`;
  }

  return input;
}