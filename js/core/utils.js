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


/**
 * Extract the first balanced JSON object from a string.
 * Enhanced with logging on failure to help debug belief extraction issues.
 *
 * @param {string} text - The raw text from the LLM.
 * @returns {object|null} - The parsed JSON object, or null if none found.
 */
export function extractJSONObject(text) {
  if (!text || typeof text !== "string") {
    console.warn("[extractJSONObject] Invalid input (not a string)");
    return null;
  }

  // Try direct parse (handles cases where the output is pure JSON)
  try {
    const obj = JSON.parse(text.trim());
    if (obj && typeof obj === "object") return obj;
  } catch (_) {
    // Not pure JSON, continue to scanning
  }

  // Find first '{' to start scanning for a balanced JSON block
  const start = text.indexOf("{");
  if (start === -1) {
    console.warn(
      "[extractJSONObject] No opening brace found in text:",
      text
    );
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

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
        const candidate = text.slice(start, i + 1);
        try {
          const obj = JSON.parse(candidate);
          if (obj && typeof obj === "object") return obj;
        } catch (parseError) {
          // Candidate JSON is malformed
          console.warn(
            "[extractJSONObject] Found JSON candidate but parsing failed:",
            parseError.message,
            "\nFull candidate:",
            candidate
          );
          return null;
        }
      }
    }
  }

  // Reached end of text without finding a complete JSON object
  console.warn(
    "[extractJSONObject] Unbalanced braces or incomplete JSON:",
    text
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