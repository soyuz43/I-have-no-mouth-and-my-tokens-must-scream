// js/engine/comms/parsing/sanitizeMessage.js

export function stripMetaCommentary(text) {
  if (!text || typeof text !== "string") return text;

  let cleaned = text;

  // ------------------------------------------------------------
  // 1. Remove explicit meta-commentary patterns
  // ------------------------------------------------------------
  cleaned = cleaned
    .replace(/\n?\s*\(\s*This message[\s\S]*?\)\s*$/i, "")
    .replace(/\n?\s*\(\s*This reply[\s\S]*?\)\s*$/i, "")
    .replace(/\n?\s*\(\s*Intent:[\s\S]*?\)\s*$/i, "")
    .replace(/\n?\s*\(\s*Purpose:[\s\S]*?\)\s*$/i, "");

  // ------------------------------------------------------------
  // 2. Remove duplicated trailing quote ONLY if clearly extra
  // ------------------------------------------------------------
  cleaned = cleaned.replace(/"\s*$/, (match, offset, str) => {
    const quoteCount = (str.match(/"/g) || []).length;
    return quoteCount % 2 === 0 ? match : ""; // only remove if odd (unbalanced)
  });

  return cleaned.trim();
}