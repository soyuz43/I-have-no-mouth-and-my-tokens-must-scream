// js/engine/state/utils/safeExtract.js

import { repairJSON } from "../../../core/utils.js";

/**
 * Extract first valid JSON object block from text
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

  return null;
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
 * Remove // comments
 */
function stripComments(text) {
  return text.replace(/\/\/.*$/gm, "");
}

/**
 * Attempt safe JSON extraction with layered fallback
 */
export function safeExtractJSON(text) {
  // ✅ MUST be first
  if (typeof text !== "string") return null;

  let extracted = extractJSONObject(text);

  if (!extracted) {
    extracted = text;
  }

  let cleaned = extracted;

  cleaned = stripMarkdown(cleaned);
  cleaned = stripComments(cleaned);

  try {
    return JSON.parse(cleaned);
  } catch (_) {}

  try {
    const repaired = repairJSON(cleaned);
    return JSON.parse(repaired);
  } catch (_) {}

  return null;
}