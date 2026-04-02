// js/engine/state/utils/fieldExtract.js

/**
 * FIELD-LEVEL RECOVERY
 *
 * Extract critical state fields independently from corrupted JSON.
 * This is a fallback layer AFTER safeExtractJSON fails.
 */

function extractObjectField(text, key) {
  const start = text.indexOf(`"${key}"`);
  if (start === -1) return null;

  const braceStart = text.indexOf("{", start);
  if (braceStart === -1) return null;

  let depth = 0;

  for (let i = braceStart; i < text.length; i++) {
    if (text[i] === "{") depth++;
    if (text[i] === "}") depth--;

    if (depth === 0) {
      return text.slice(braceStart, i + 1);
    }
  }

  return null;
}

function extractArrayField(text, key) {
  const start = text.indexOf(`"${key}"`);
  if (start === -1) return null;

  const bracketStart = text.indexOf("[", start);
  if (bracketStart === -1) return null;

  let depth = 0;

  for (let i = bracketStart; i < text.length; i++) {
    if (text[i] === "[") depth++;
    if (text[i] === "]") depth--;

    if (depth === 0) {
      return text.slice(bracketStart, i + 1);
    }
  }

  // partial (corrupted) array fallback
  return text.slice(bracketStart);
}

function safeParse(fragment) {
  try {
    return JSON.parse(fragment);
  } catch {
    return null;
  }
}

function extractStringsFromArray(text) {
  const matches = text.match(/"([^"]+)"/g);
  if (!matches) return [];

  return matches.map(s => s.slice(1, -1));
}

/**
 * MAIN ENTRY POINT
 */
export function safeExtractFields(text) {
  if (!text || typeof text !== "string") return null;

  const result = {};

  // --- belief_deltas (critical) ---
  const beliefBlock = extractObjectField(text, "belief_deltas");
  if (beliefBlock) {
    const parsed = safeParse(beliefBlock);
    if (parsed) result.belief_deltas = parsed;
  }

  // --- drives ---
  const drivesBlock = extractObjectField(text, "drives");
  if (drivesBlock) {
    const parsed = safeParse(drivesBlock);
    if (parsed) result.drives = parsed;
  }

  // --- anchors (tolerant) ---
  const anchorsBlock = extractArrayField(text, "anchors");
  if (anchorsBlock) {
    const anchors = extractStringsFromArray(anchorsBlock);
    if (anchors.length) result.anchors = anchors;
  }

  return Object.keys(result).length ? result : null;
}