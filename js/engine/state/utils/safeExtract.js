// js/engine/state/utils/safeExtract.js

import { repairJSON } from "../../../core/utils.js";
import { G } from "../../../core/state.js";

/* ============================================================
   LOGGING CONFIGURATION
   ============================================================ */

/**
 * Read current log level from the simulation global state.
 *
 *  0 – silent
 *  1 – normal (warnings only) — default
 *  2 – verbose (warnings + debug)
 *
 * Allows an external override via `globalThis.__SAFE_EXTRACT_LOG_LEVEL__`
 * for temporary debugging without touching G.
 */
function getLogLevel() {
  // Primary source: the simulation config (G.SAFE_EXTRACT_LOG_LEVEL)
  if (G && G.SAFE_EXTRACT_LOG_LEVEL != null) {
    return G.SAFE_EXTRACT_LOG_LEVEL;
  }
  // Fallback for quick external override
  if (globalThis.__SAFE_EXTRACT_LOG_LEVEL__ != null) {
    return globalThis.__SAFE_EXTRACT_LOG_LEVEL__;
  }
  return 1; // default
}

/**
 * Centralised logger for this module.
 *
 * @param {number} level – 1 (warn) or 2 (debug/info)
 * @param {string} tag – short identifier (e.g., "TRUNCATE", "CORRUPTED")
 * @param {string} message – human‑readable description
 * @param {object} [data] – optional structured data
 */
function log(level, tag, message, data = undefined) {
  const currentLevel = getLogLevel();
  if (currentLevel < level) return;

  const prefix = `[safeExtractJSON][${tag}]`;
  const fullMessage = `${prefix} ${message}`;

  if (level === 2) {
    // debug / verbose
    if (data !== undefined) {
      console.debug(fullMessage, data);
    } else {
      console.debug(fullMessage);
    }
  } else {
    // warning level
    if (data !== undefined) {
      console.warn(fullMessage, data);
    } else {
      console.warn(fullMessage);
    }
  }
}

/* ============================================================
   INTERNAL HELPERS
   ============================================================ */

function extractJSONObject(text) {
  if (typeof text !== "string") return null;

  const firstBrace = text.indexOf("{");
  if (firstBrace === -1) return null;

  let depth = 0;
  for (let i = firstBrace; i < text.length; i++) {
    if (text[i] === "{") depth++;
    if (text[i] === "}") depth--;
    if (depth === 0) return text.slice(firstBrace, i + 1);
  }
  return null; // unbalanced
}

function truncateAfterLastBrace(text) {
  const last = text.lastIndexOf("}");
  return last === -1 ? text : text.slice(0, last + 1);
}

function stripMarkdown(text) {
  return text.replace(/```[\s\S]*?```/g, (block) => {
    return block.replace(/```json|```/g, "");
  });
}

function stripComments(text) {
  return text
    .replace(/\/\/.*(?=[\n\r])/g, "")   // single line
    .replace(/\/\*[\s\S]*?\*\//g, "")   // multi line
    .replace(/,\s*(\]|\})/g, "$1");    // trailing comma
}

function stripWeirdUnicode(text) {
  return text.replace(/[\u0000-\u001F\u007F\u2028\u2029]/g, "");
}

function replaceSmartQuotes(text) {
  return text
    .replace(/[\u201C\u201D]/g, '"')   // “ ” → "
    .replace(/[\u2018\u2019]/g, "'");  // ‘ ’ → '
}

function fixArrayCommas(text) {
  let prev, current = text;
  const pattern = /"\s*\n\s*"/g;
  do {
    prev = current;
    current = current.replace(pattern, '",\n"');
  } while (current !== prev);
  return current;
}

function fixMissingCommas(text) {
  // original: "key": "value"\n "key" → "key": "value",\n "key"
  let result = text.replace(
    /(":\s*(?:-?\d+(?:\.\d+)?|true|false|null|"[^"]*"))\s*\n(?=\s*")/g,
    (match) => {
      if (match.trim().endsWith(",")) return match;
      return match.replace(/\s*\n/, ",\n");
    }
  );
  // enhanced: "key": 3\n    "key2": → "key": 3,\n    "key2":
  result = result.replace(
    /(":\s*-?\d+(?:\.\d+)?)\s*\n(\s*"[A-Za-z_][A-Za-z0-9_]*"\s*:)/g,
    "$1,\n$2"
  );
  return result;
}

function stripPrefix(text) {
  const idx = text.indexOf("{");
  return idx === -1 ? text : text.slice(idx);
}

function isLikelyTruncated(text) {
  const open = (text.match(/{/g) || []).length;
  const close = (text.match(/}/g) || []).length;
  return close < open;
}

/* ============================================================
   MAIN EXTRACTION FUNCTION
   ============================================================ */

export function safeExtractJSON(text) {
  if (typeof text !== "string") return null;

  // --- Phase 1: Normalize raw text ---
  let cleaned = text;
  cleaned = stripMarkdown(cleaned);
  cleaned = replaceSmartQuotes(cleaned);   // ← now actually called
  cleaned = stripPrefix(cleaned);
  cleaned = stripComments(cleaned);
  cleaned = stripWeirdUnicode(cleaned);
  cleaned = fixArrayCommas(cleaned);

  // --- Phase 2: Extract first JSON object ---
  let extracted = extractJSONObject(cleaned);
  if (!extracted) {
    extracted = cleaned;
    log(2, "EXTRACT", "No JSON object found via brace matching, using full cleaned text");
  }

  // --- Truncation handling ---
  const beforeTruncate = extracted;
  extracted = truncateAfterLastBrace(extracted);
  if (beforeTruncate.length !== extracted.length) {
    log(1, "TRUNCATE", "Removed trailing characters after last closing brace", {
      removedChars: beforeTruncate.length - extracted.length
    });
  }

  // --- Apply missing comma fixes ---
  extracted = fixMissingCommas(extracted);

  // --- Detect mid-array corruption ---
  if (
    extracted.includes("\n") &&
    extracted.includes('"]') &&
    /"\s*\n\s*[A-Za-z]/.test(extracted)
  ) {
    log(1, "CORRUPTION", "Mid-array corruption detected (unclosed string / missing comma)");
  }

  // --- Quick corruption check ---
  const looksCorrupted =
    extracted &&
    !extracted.trim().endsWith("}") &&
    /[A-Za-z0-9_]+\s*:\s*[^"{\[\d\-]/.test(extracted);

  if (looksCorrupted) {
    log(1, "CORRUPTED", "Malformed JSON object structure, attempting repair");
    try {
      const repaired = repairJSON(extracted);
      const parsed = JSON.parse(repaired);
      if (parsed && typeof parsed === "object") {
        log(2, "REPAIR", "Corrupted JSON repaired successfully");
        return parsed;
      }
    } catch (err) {
      log(1, "REPAIR", "Repair failed on corrupted candidate");
    }
  }

  // --- Truncation awareness ---
  const truncated = isLikelyTruncated(extracted);

  // --- Phase 4: Direct parse attempt ---
  try {
    const result = JSON.parse(extracted);
    log(2, "PARSE", "Direct JSON.parse succeeded");
    return result;
  } catch (err) {
    log(2, "PARSE", "Direct parse failed");
  }

  // --- Phase 5: Repair + parse ---
  try {
    const repaired = repairJSON(extracted);
    const result = JSON.parse(repaired);
    log(2, "REPAIR", "JSON parsed after repair");
    return result;
  } catch (err) {
    log(1, "REPAIR", "Repair parse failed");
  }

  // --- Phase 6: Final failure ---
  if (truncated) {
    log(1, "FAIL", "Unrecoverable truncated JSON");
  } else {
    log(1, "FAIL", "Parse failed (non-truncated)");
  }

  return null;
}