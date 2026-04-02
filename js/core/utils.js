// js/core/utils.js

export function makeBelief(overrides = {}) {
  return Object.assign(
    {
      escape_possible: 0.82,
      others_trustworthy: 0.75,
      self_worth: 0.6,
      reality_reliable: 0.88,
      guilt_deserved: 0.15,
      resistance_possible: 0.78,
      am_has_limits: 0.7,
    },
    overrides,
  );
}

export function makeDrives(primary, secondary = null) {
  return { primary, secondary };
}

export function downloadTextFile(filename, content, mimeType = "text/plain") {
  const blob = new Blob([content], { type: mimeType });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

export function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function fmtDelta(value, digits = null) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";

  const out =
    digits == null
      ? String(n)
      : n.toFixed(digits).replace(/\.?0+$/, "");

  return `${n > 0 ? "+" : ""}${out}`;
}

export function fmtDeltaPct(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0%";
  return `${n > 0 ? "+" : ""}${n}%`;
}

export function beliefBar(val) {
  const n = Number(val);
  const safe = Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
  const pct = Math.round(safe * 100);
  return `${"█".repeat(Math.round(safe * 8))}${"░".repeat(8 - Math.round(safe * 8))} ${pct}%`;
}

export function formatBeliefs(sim) {
  const b = sim?.beliefs || {};
  return Object.entries(b)
    .map(([k, v]) => `    ${k.padEnd(22)} ${beliefBar(v)}`)
    .join("\n");
}

export function formatWounds(sim) {
  if (!sim?.wounds || !sim.wounds.length) return "    (none yet)";
  const counts = {};
  sim.wounds.forEach((w) => {
    counts[w] = (counts[w] || 0) + 1;
  });
  return Object.entries(counts)
    .map(([k, v]) => `    ${k}×${v}`)
    .join("\n");
}

export function formatBeliefDetails(parsed) {
  const beliefMap = {
    escape_possible: "escape_possible",
    others_trustworthy: "others_trustworthy",
    self_worth: "self_worth",
    reality_reliable: "reality_reliable",
    guilt_deserved: "guilt_deserved",
    resistance_possible: "resistance_possible",
    am_has_limits: "am_has_limits",
  };

  const src = parsed?.belief_deltas || {};
  const orderedKeys = [
    "escape_possible",
    "others_trustworthy",
    "self_worth",
    "reality_reliable",
    "guilt_deserved",
    "resistance_possible",
    "am_has_limits",
  ];

  return orderedKeys
    .filter((k) => src[k] != null && Number(src[k]) !== 0)
    .map((k) => `${beliefMap[k]}: ${fmtDeltaPct(src[k])}`)
    .join("\n");
}

export function formatReason(reason) {
  if (!reason) return "no reason given";

  if (typeof reason === "string") return reason;

  if (typeof reason === "object") {
    const parts = [];
    if (reason.suffering) parts.push(`suffering ${reason.suffering}`);
    if (reason.hope) parts.push(`hope ${reason.hope}`);
    if (reason.sanity) parts.push(`sanity ${reason.sanity}`);
    return parts.join(", ");
  }

  return String(reason);
}

export function stripThinkTags(text) {
  const safe = String(text ?? "");

  const stripped = safe
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```think[\s\S]*?```/gi, "")
    .trim();

  if (stripped) return stripped;

  const thinkMatch = safe.match(/<think>([\s\S]*?)<\/think>/i);

  if (thinkMatch) {
    const inner = thinkMatch[1].trim();
    const paras = inner.split(/\n\n+/).filter((p) => p.trim().length > 20);
    return paras[paras.length - 1] || inner.slice(-400);
  }

  return safe.trim();
}

export function containsStem(text, stems) {
  const source = String(text ?? "").toLowerCase();
  return stems.some((stem) =>
    new RegExp(`(^|\\s|[.,;:!?])${stem}\\w*`, "i").test(source),
  );
}

export function preprocessJSONText(text) {
  return String(text ?? "")
    // remove code fences
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    // remove line comments
    .replace(/\/\/.*$/gm, "")
    .trim();
}

function fixMissingCommas(str) {
  return str.replace(
    /([}\]"0-9])\s*\n\s*([{\["a-zA-Z])/g,
    (m, a, b) => `${a},\n${b}`
  );
}

function detectInvalidArrayStructure(str) {
  // heuristic: key:value inside array
  // Only flag if colon appears at top level of array (not inside objects)
  return /\[\s*([^{}]*\w+\s*:\s*[^,\]]+)/m.test(str);
}

/**
 * Extract the first valid JSON object from raw LLM output.
 *
 * Strategy:
 * 1. Preprocess (strip fences, comments)
 * 2. Try direct parse
 * 3. Scan for balanced object
 * 4. Try parse → repair → parse
 * 5. Reject structurally invalid cases (array/object mixing)
 */
export function extractJSONObject(text) {
  if (!text || typeof text !== "string") return null;

  // ------------------------------------------------------------
  // 1. PREPROCESS (CRITICAL)
  // ------------------------------------------------------------
  const cleaned = preprocessJSONText(text);

  // ------------------------------------------------------------
  // 2. FAST PATH: direct parse
  // ------------------------------------------------------------
  try {
    const obj = JSON.parse(cleaned);
    if (obj && typeof obj === "object") return obj;
  } catch (_) { }

  // ------------------------------------------------------------
  // 3. FIND FIRST JSON OBJECT (balanced braces)
  // ------------------------------------------------------------
  const start = cleaned.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;

      if (depth === 0) {
        let candidate = cleaned.slice(start, i + 1);

        // ------------------------------------------------------------
        // 4. HARD GUARD: structural corruption (do NOT repair)
        // ------------------------------------------------------------
        if (detectInvalidArrayStructure(candidate)) {
          console.warn(
            "[extractJSONObject] Rejected due to invalid array structure"
          );
          return null;
        }

        // ------------------------------------------------------------
        // 5. ATTEMPT PARSE (RAW)
        // ------------------------------------------------------------
        try {
          const obj = JSON.parse(candidate);
          if (obj && typeof obj === "object") return obj;
        } catch (err1) {
          // continue to repair
        }

        // ------------------------------------------------------------
        // 6. REPAIR PIPELINE
        // ------------------------------------------------------------
        try {
          let repaired = candidate;

          // missing commas (your most common failure)
          repaired = fixMissingCommas(repaired);

          // existing repair layer
          repaired = repairJSON(repaired);

          const obj = JSON.parse(repaired);
          if (obj && typeof obj === "object") return obj;
        } catch (err2) {
          console.warn(
            "[extractJSONObject] Repair failed",
            {
              preview: candidate.slice(0, 200),
              error: err2?.message,
            }
          );
          return null;
        }
      }
    }
  }

  // ------------------------------------------------------------
  // 7. NO COMPLETE OBJECT FOUND
  // ------------------------------------------------------------
  console.warn(
    "[extractJSONObject] Unbalanced or incomplete JSON",
    cleaned.slice(0, 200)
  );

  return null;
}

export function normalizeDirection(value) {
  if (value == null) return null;

  const s = String(value).trim().toLowerCase();

  if (
    s === "increased" ||
    s === "increase" ||
    s === "inc" ||
    s === "up" ||
    s === "+"
  )
    return "increased";

  if (
    s === "decreased" ||
    s === "decrease" ||
    s === "dec" ||
    s === "down" ||
    s === "-"
  )
    return "decreased";

  if (
    s === "unchanged" ||
    s === "same" ||
    s === "flat" ||
    s === "none" ||
    s === "0" ||
    s === "zero"
  )
    return "unchanged";

  return null;
}

export function clampInt(n, min, max) {
  n = Number(n);
  if (!Number.isFinite(n)) return 0;

  n = Math.round(n);

  return Math.max(min, Math.min(max, n));
}

export function signedDeltaFromDirectionMagnitude(direction, magnitude) {
  const dir = normalizeDirection(direction);
  const mag = Math.abs(clampInt(magnitude ?? 0, 0, 100));

  if (dir === "unchanged") return 0;
  if (dir === "increased") return mag;
  if (dir === "decreased") return -mag;

  return null;
}

export function coerceLegacyDelta(value) {
  if (value == null) return null;

  const n = Number(value);

  if (!Number.isFinite(n)) return null;

  return Math.round(n);
}

export function clipBeliefDelta(value) {
  const n = Number(value);

  if (!Number.isFinite(n)) return 0;

  return Math.max(-0.25, Math.min(0.25, n));
}

/* ============================================================
   DEBUG: RAW LLM OUTPUT LOGGER
   ------------------------------------------------------------
   Purpose:
   - Safely log LLM outputs (string or parsed object)
   - Explicitly detect null / undefined failure modes
   - Preserve full output (no truncation)
============================================================ */

export function debugRawLLM(agent, raw, label = "RAW LLM OUTPUT") {
  const prefix = `[${label} for ${agent}]`;

  if (raw === null) {
    console.warn(`${prefix} → NULL`);
    return;
  }

  if (raw === undefined) {
    console.warn(`${prefix} → UNDEFINED`);
    return;
  }

  if (typeof raw === "string") {
    console.debug(`${prefix} (string):`, raw);
    return;
  }

  if (typeof raw === "object") {
    console.debug(`${prefix} (object):`, raw);
    return;
  }

  // fallback (number, boolean, etc.)
  console.debug(`${prefix} (type=${typeof raw}):`, raw);
}


/**
 * Attempt to repair common JSON syntax errors.
 * Conservative, layered approach:
 * - Never corrupt valid JSON
 * - Only fix clearly identifiable patterns
 */
export function repairJSON(text) {
  if (!text || typeof text !== "string") return text;

  let repaired = text;

  /* ------------------------------------------------------------
     1. SAFE FIXES (always low risk)
  ------------------------------------------------------------ */

  // Remove trailing commas before } or ]
  repaired = repaired.replace(/,(\s*[}\]])/g, "$1");

  // Add missing quotes around keys (safe subset only)
  repaired = repaired.replace(
    /([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g,
    '$1"$2":'
  );

  /* ------------------------------------------------------------
     2. TARGETED FIX: single-quoted VALUES
     Fixes cases like:
     "key": 'value with "quotes" inside'
  ------------------------------------------------------------ */

  repaired = repaired.replace(
    /:\s*'([^']*)'/g,
    (match, content) => {
      // Escape internal double quotes
      const safe = content.replace(/"/g, '\\"');
      return `: "${safe}"`;
    }
  );

  /* ------------------------------------------------------------
     3. OPTIONAL GUARD (very conservative)
     Fix: stray closing quotes at end of object strings
     (only if obviously mismatched)
  ------------------------------------------------------------ */

  // Example pattern:
  // "... 81%."}
  // → "... 81%."}
  // (this is mostly a no-op safety placeholder for future tuning)

  return repaired;
}