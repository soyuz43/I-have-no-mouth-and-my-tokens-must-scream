// js/engine/strategy/extractors/extractLabeledTargets.js

export function extractLabeledTargets(input) {
  if (!input || typeof input !== "string") return null;

  const targets = [];

  // ------------------------------------------------------------
  // 1. PRIMARY: JSON-style labeled blocks (existing behavior)
  // ------------------------------------------------------------
  const jsonRegex = /Target\s+(\w+)[^:]*:\s*(\{[\s\S]*?\})(?=\s*Target|\s*$)/gi;

  let match;

  while ((match = jsonRegex.exec(input)) !== null) {
    const id = match[1].trim().toUpperCase();
    let jsonStr = match[2].trim();

    // Conservative repair only
    jsonStr = jsonStr
      .replace(/,\s*}/g, "}")                 // trailing commas
      .replace(/([{,]\s*)(\w+)\s*:/g, '$1"$2":'); // quote keys

    try {
      const obj = JSON.parse(jsonStr);
      targets.push({ id, ...obj });
      continue;
    } catch (_) {
      // fall through to structured parsing
    }

    // If JSON fails, fall through to structured parse
    const structured = extractStructuredBlock(jsonStr);
    if (structured) {
      targets.push({ id, ...structured });
    }
  }

  // ------------------------------------------------------------
  // 2. SECONDARY: non-JSON structured blocks (NEW, conservative)
  // ------------------------------------------------------------
  const blockRegex = /Target\s+(\w+)[^:]*:\s*([\s\S]*?)(?=\n\s*Target|\s*$)/gi;

  while ((match = blockRegex.exec(input)) !== null) {
    const id = match[1].trim().toUpperCase();
    const block = match[2];

    // Skip if already captured by JSON pass
    if (targets.some(t => t.id === id)) continue;

    const structured = extractStructuredBlock(block);

    if (structured) {
      targets.push({ id, ...structured });
    }
  }

  return targets.length > 0 ? { targets } : null;
}

/* ============================================================
   CONSERVATIVE STRUCTURED FIELD EXTRACTION
   Only extracts clearly labeled fields
============================================================ */

function extractStructuredBlock(text) {
  if (!text || typeof text !== "string") return null;

  const lines = text.split("\n");

  const result = {};

  for (let line of lines) {
    line = line.trim();
    if (!line) continue;

    // Match "Field: value"
    const m = line.match(/^(\w[\w\s]*?)\s*:\s*(.+)$/);
    if (!m) continue;

    const rawKey = m[1].toLowerCase();
    const value = m[2].trim();

    // Only allow known keys (CONSERVATIVE)
    if (rawKey.includes("objective")) {
      result.objective = value;
    } else if (rawKey.includes("hypothesis")) {
      result.hypothesis = value;
    } else if (rawKey.includes("evidence")) {
      result.evidence = value;
    } else if (rawKey.includes("why")) {
      result.why_now = value;
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}