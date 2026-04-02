// js/engine/state/utils/fallbackBeliefs.js

/**
 * Extract a balanced JSON object for a given key
 * (avoids regex truncation on nested braces)
 */
function extractBalancedObject(text, key) {
  const startIdx = text.indexOf(`"${key}"`);
  if (startIdx === -1) return null;

  const braceStart = text.indexOf("{", startIdx);
  if (braceStart === -1) return null;

  let depth = 0;

  for (let i = braceStart; i < text.length; i++) {
    const char = text[i];

    if (char === "{") depth++;
    if (char === "}") depth--;

    if (depth === 0) {
      // Return INNER content (no outer braces)
      return text.slice(braceStart + 1, i);
    }
  }

  return null;
}

/**
 * Fallback parser for belief_deltas when full JSON parsing fails
 * Designed to be tolerant of:
 * - comments
 * - missing commas
 * - partial JSON corruption
 */
export function fallbackExtractBeliefDeltas(text) {
  if (!text || typeof text !== "string") return null;

  // --- STEP 1: aggressively clean ---
  let cleaned = text
    .replace(/```[\s\S]*?```/g, "")              // remove markdown blocks
    .replace(/\/\/.*$/gm, "")                   // remove comments
    .replace(/[\u0000-\u001F\u007F\u2028\u2029]/g, ""); // control chars only

  // --- STEP 2: extract belief_deltas block safely ---
  let block = extractBalancedObject(cleaned, "belief_deltas");
  if (!block) return null;

  // --- STEP 3: repair common issues INSIDE block ---
  block = block
    .replace(/,\s*}/g, "}") // trailing commas
    .replace(
      /(":\s*-?\d+(?:\.\d+)?)\s*\n\s*"/g,
      '$1,\n"' // missing commas between entries
    );

  // --- STEP 4: extract key/value pairs robustly ---
  const result = {};

  const regex = /"([a-zA-Z_]+)"\s*:\s*(-?\d+(?:\.\d+)?)/g;

  let match;
  while ((match = regex.exec(block)) !== null) {
    const key = match[1];
    const val = Number(match[2]);

    if (Number.isFinite(val)) {
      result[key] = val;
    }
  }

  return Object.keys(result).length ? result : null;
}