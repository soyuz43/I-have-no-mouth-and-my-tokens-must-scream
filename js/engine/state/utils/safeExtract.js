// js/engine/state/utils/safeExtract.js

import { repairJSON } from "../../../core/utils.js";

/**
 * Extract first valid JSON object block from text
 * Uses brace matching (robust against prefix noise)
 */
function extractJSONObject(text) {
  if (typeof text !== "string") return null;

  const firstBrace = text.indexOf("{");
  if (firstBrace === -1) return null;

  let depth = 0;

  for (let i = firstBrace; i < text.length; i++) {
    const char = text[i];

    if (char === "{") depth++;
    if (char === "}") depth--;

    if (depth === 0) {
      return text.slice(firstBrace, i + 1);
    }
  }

  // Unbalanced → likely truncated
  return null;
}

function truncateAfterLastBrace(text) {
  const last = text.lastIndexOf("}");
  if (last === -1) return text;
  return text.slice(0, last + 1);
}

/**
 * Remove markdown fences like ```json ... ```
 */
function stripMarkdown(text) {
  return text.replace(/```[\s\S]*?```/g, (block) => {
    return block.replace(/```json|```/g, "");
  });
}

/**
 * Remove // comments (invalid JSON)
 */
function stripComments(text) {
  return text.replace(/\/\/.*$/gm, "");
}

/**
 * Remove invalid / non-standard unicode characters
 */
function stripWeirdUnicode(text) {
  return text.replace(/[\u0000-\u001F\u007F\u2028\u2029]/g, "");
}

/**
 * Fix missing commas between adjacent strings in arrays
 * Example:
 *   "a"
 *   "b"
 * → "a", "b"
 */
function fixArrayCommas(text) {
  return text.replace(
    /"\s*\n\s*"/g,
    '",\n"'
  );
}

/**
 * Fix missing commas between object fields
 */
function fixMissingCommas(text) {
  return text.replace(
    /(":\s*(?:-?\d+(?:\.\d+)?|true|false|null|"[^"]*"))\s*\n(?=\s*")/g,
    (match) => {
      if (match.trim().endsWith(",")) return match;
      return match.replace(/\s*\n/, ",\n");
    }
  );
}

/**
 * Strip leading non-JSON text before first {
 */
function stripPrefix(text) {
  const idx = text.indexOf("{");
  return idx === -1 ? text : text.slice(idx);
}

/**
 * Detect obvious truncation (unbalanced braces)
 */
function isLikelyTruncated(text) {
  const open = (text.match(/{/g) || []).length;
  const close = (text.match(/}/g) || []).length;
  return close < open;
}

/**
 * Attempt safe JSON extraction with layered repair
 */
export function safeExtractJSON(text) {
  if (typeof text !== "string") return null;

  // --- Phase 1: Normalize raw text ---
  let cleaned = text;

  cleaned = stripMarkdown(cleaned);
  cleaned = stripPrefix(cleaned);
  cleaned = stripComments(cleaned);
  cleaned = stripWeirdUnicode(cleaned);

  // --- NEW: Fix array comma issues caused by comment stripping ---
  cleaned = fixArrayCommas(cleaned);

  // Extract first, then repair
  let extracted = extractJSONObject(cleaned);

  if (!extracted) {
    extracted = cleaned;
  }

  // --- LOGGING: detect truncation ---
  const beforeTruncate = extracted;

  extracted = truncateAfterLastBrace(extracted);

  if (beforeTruncate.length !== extracted.length) {
    console.warn("[safeExtractJSON] truncated trailing garbage", {
      removedChars: beforeTruncate.length - extracted.length
    });
  }

  // --- Apply comma fixes ---
  extracted = fixMissingCommas(extracted);


  // --- DEBUG: detect mid-array corruption ---
  if (
    extracted.includes("\n") &&
    extracted.includes('"]') &&
    /"\s*\n\s*[A-Za-z]/.test(extracted)
  ) {
    console.warn("[safeExtractJSON] likely mid-array corruption");
  }

  // --- NEW: reject obviously corrupted JSON early ---
  const looksCorrupted =
    extracted &&
    !extracted.trim().endsWith("}") &&
    /[A-Za-z0-9_]+\s*:\s*[^"{\[\d\-]/.test(extracted);

  if (looksCorrupted) {
    console.warn("[safeExtractJSON] corrupted candidate — attempting repair but not short-circuiting");
    try {
      const repaired = repairJSON(extracted);
      const parsed = JSON.parse(repaired);
      if (parsed && typeof parsed === "object") {
        return parsed;
      }
    } catch (err) {
      console.warn("[safeExtractJSON] forced repair failed");
    }
  }

  // --- Phase 3: Truncation awareness ---
  const truncated = isLikelyTruncated(extracted);

  // --- Phase 4: Direct parse attempt ---
  try {
    return JSON.parse(extracted);
  } catch (err) {
    console.debug("[safeExtractJSON] direct parse failed");
  }

  // --- Phase 5: Repair + parse ---
  try {
    const repaired = repairJSON(extracted);
    return JSON.parse(repaired);
  } catch (err) {
    console.warn("[safeExtractJSON] repair parse failed");
  }

  // --- Phase 6: Final failure ---
  if (truncated) {
    console.warn("[safeExtractJSON] unrecoverable truncated JSON");
  } else {
    console.warn("[safeExtractJSON] parse failed (non-truncated)");
  }

  return null;
}