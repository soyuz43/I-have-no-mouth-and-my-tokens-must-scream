// js/engine/state/sanitize.js
//
// State Sanitization Layer
//
// Responsibilities:
// 1. Clean and normalize LLM-derived updates
// 2. Prevent malformed or adversarial data from entering the system
// 3. Enforce safe ranges and structural constraints
//
// This layer does not repair JSON syntax.
// It validates and normalizes values after extraction.

import {
  clipBeliefDelta
} from "../../core/utils.js";
import { G } from "../../core/state.js";

/* ============================================================
   CONSTANTS
   ============================================================ */

const ALLOWED_BELIEF_KEYS = Object.freeze([
  "escape_possible",
  "others_trustworthy",
  "self_worth",
  "reality_reliable",
  "guilt_deserved",
  "resistance_possible",
  "am_has_limits"
]);

const ALLOWED_BELIEF_KEY_SET = new Set(ALLOWED_BELIEF_KEYS);

const ZERO_VALUE_STRINGS = new Set([
  "unchanged",
  "unobserved",
  "unclear",
  "unknown",
  "none",
  "null",
  "no change",
  "no_change"
]);

const TEMPLATE_PLACEHOLDER_PATTERNS = [
  /^\$\{[^}]+\}$/,
  /^\{\{[^}]+\}\}$/,
  /^<[^>]+>$/,
  /^(?:anchor|anchor_here|drive|drive_here|value_here)$/i,
  /^(?:none|null|undefined|unknown|n\/a|tbd)$/i
];

const MAX_RAW_BELIEF_PERCENT = 100;
const MAX_DRIVE_LENGTH = 160;
const MAX_ANCHOR_LENGTH = 280;
const MAX_ANCHORS = 5;

/* ============================================================
   GENERIC HELPERS
   ============================================================ */

function normalizeWhitespace(value) {
  return String(value)
    .replace(/[\u0000-\u001F\u007F\u2028\u2029]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isTemplatePlaceholder(value) {
  if (typeof value !== "string") return false;

  const normalized = value.trim();

  return TEMPLATE_PLACEHOLDER_PATTERNS.some(
    (pattern) => pattern.test(normalized)
  );
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Normalize only harmless formatting differences in belief keys.
 *
 * Examples:
 *   "self worth"          -> "self_worth"
 *   "self__worth"         -> "self_worth"
 *   "Reality-Reliable"    -> "reality_reliable"
 *
 * This does not perform fuzzy semantic guessing.
 */
function normalizeBeliefKeyShape(rawKey) {
  if (typeof rawKey !== "string") return null;

  const normalized = rawKey
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");

  return ALLOWED_BELIEF_KEY_SET.has(normalized)
    ? normalized
    : null;
}

/**
 * Parse only explicit numeric values.
 *
 * Rejects dangerous JavaScript coercions such as:
 *   Number(null)  -> 0
 *   Number("")    -> 0
 *   Number(false) -> 0
 *   Number([])    -> 0
 */
function parseNumericValue(raw) {
  if (typeof raw === "number") {
    return Number.isFinite(raw)
      ? { value: raw, explicitPercent: false }
      : null;
  }

  if (typeof raw !== "string") return null;

  let normalized = raw.trim().toLowerCase();

  if (ZERO_VALUE_STRINGS.has(normalized)) {
    return { value: 0, explicitPercent: false };
  }

  // ----------------------------------------------------------------
  // Optional: convert European-style decimal comma (e.g., "5,3" → 5.3)
  // Enable by setting G.SANITIZE_ALLOW_DECIMAL_COMMA = true
  // ----------------------------------------------------------------
  if (
    (G && G.SANITIZE_ALLOW_DECIMAL_COMMA) &&
    /^-?\d+,\d+$/.test(normalized) &&      // only digits, one comma, no more
    !/,\d{3}(?:[^\d]|$)/.test(normalized)  // NOT a thousands separator (e.g., "1,234")
  ) {
    normalized = normalized.replace(",", ".");
  }

  const numericMatch = normalized.match(
    /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*(%)?$/
  );

  if (!numericMatch) return null;

  const value = Number(numericMatch[1]);

  if (!Number.isFinite(value)) return null;

  return {
    value,
    explicitPercent: Boolean(numericMatch[2])
  };
}

/* ============================================================
   BELIEF DELTA SANITIZATION
   ============================================================ */

/**
 * Sanitize raw model-produced belief deltas.
 *
 * inputScale:
 *   "percent_points"
 *     5    -> 0.05
 *     1    -> 0.01
 *     0.5  -> 0.005
 *
 *   "normalized"
 *     0.05 -> 0.05
 *
 *   "auto"
 *     integers and values above 1 are treated as percentage points;
 *     fractional values below 1 are treated as normalized values.
 *
 * The current forensic-stats schema uses percentage points, so
 * "percent_points" is the safe default.
 */
export function sanitizeBeliefDeltas(
  raw,
  {
    simId = "UNKNOWN",
    DEBUG = false,
    inputScale = "percent_points"
  } = {}
) {
  if (
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw)
  ) {
    return null;
  }

  const updates = {};
  const debugRows = [];
  const rejectedRows = [];

  for (const [rawKey, rawValue] of Object.entries(raw)) {
    const key = normalizeBeliefKeyShape(rawKey);

    if (!key) {
      rejectedRows.push({
        rawKey,
        value: rawValue,
        reason: "unknown_key"
      });

      continue;
    }

    // A correctly spelled canonical key takes precedence over
    // any formatting-normalized duplicate.
    if (
      Object.prototype.hasOwnProperty.call(updates, key) &&
      rawKey !== key
    ) {
      rejectedRows.push({
        rawKey,
        key,
        value: rawValue,
        reason: "duplicate_alias"
      });

      continue;
    }

    const parsed = parseNumericValue(rawValue);

    if (!parsed) {
      rejectedRows.push({
        rawKey,
        key,
        value: rawValue,
        reason: "non_numeric"
      });

      continue;
    }

    const {
      value: rawNumber,
      explicitPercent
    } = parsed;

    if (Math.abs(rawNumber) > MAX_RAW_BELIEF_PERCENT) {
      rejectedRows.push({
        rawKey,
        key,
        value: rawValue,
        reason: "outside_raw_range"
      });

      continue;
    }

    let normalizedValue;
    let scaleType;

    if (explicitPercent) {
      normalizedValue = rawNumber / 100;
      scaleType = "explicit_percent";
    } else if (inputScale === "percent_points") {
      normalizedValue = rawNumber / 100;
      scaleType = "percent_points";
    } else if (inputScale === "normalized") {
      if (Math.abs(rawNumber) > 1) {
        rejectedRows.push({
          rawKey,
          key,
          value: rawValue,
          reason: "outside_normalized_range"
        });

        continue;
      }

      normalizedValue = rawNumber;
      scaleType = "normalized";
    } else if (inputScale === "auto") {
      const looksLikePercentPoints =
        Math.abs(rawNumber) > 1 ||
        Number.isInteger(rawNumber);

      normalizedValue = looksLikePercentPoints
        ? rawNumber / 100
        : rawNumber;

      scaleType = looksLikePercentPoints
        ? "auto_percent_points"
        : "auto_normalized";
    } else {
      rejectedRows.push({
        rawKey,
        key,
        value: rawValue,
        reason: "unknown_input_scale"
      });

      continue;
    }

    if (!Number.isFinite(normalizedValue)) {
      rejectedRows.push({
        rawKey,
        key,
        value: rawValue,
        reason: "non_finite_after_scaling"
      });

      continue;
    }

    const beforeClip = normalizedValue;
    const finalValue = clipBeliefDelta(normalizedValue);

    if (!Number.isFinite(finalValue)) {
      rejectedRows.push({
        rawKey,
        key,
        value: rawValue,
        reason: "non_finite_after_clip"
      });

      continue;
    }

    updates[key] = finalValue;

    if (DEBUG) {
      debugRows.push({
        key,
        rawKey,
        raw: rawValue,
        parsed: rawNumber,
        scaled: beforeClip,
        final: finalValue,
        scale: scaleType
      });
    }
  }

  if (DEBUG) {
    if (debugRows.length) {
      console.group(`[SANITIZE][${simId}] belief_deltas`);
      console.table(debugRows);
      console.groupEnd();
    }

    if (rejectedRows.length) {
      console.group(`[SANITIZE][${simId}] rejected belief fields`);
      console.table(rejectedRows);
      console.groupEnd();
    }
  }

  return Object.keys(updates).length
    ? updates
    : null;
}

/* ============================================================
   DRIVE SANITIZATION
   ============================================================ */

export function sanitizeDrives(raw, simId = "UNKNOWN") {
  if (
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw)
  ) {
    return null;
  }

  function cleanDrive(value, driveType) {
    if (value == null) return null;

    // Do not stringify objects, arrays, or booleans into accidental drives.
    if (typeof value !== "string") {
      console.warn(
        `[SANITIZE][${simId}] rejected ${driveType} drive with invalid type`,
        value
      );

      return null;
    }

    const normalized = normalizeWhitespace(value);

    if (!normalized) return null;
    if (normalized.length > MAX_DRIVE_LENGTH) {
      console.warn(
        `[SANITIZE][${simId}] rejected oversized ${driveType} drive`,
        {
          length: normalized.length,
          maximum: MAX_DRIVE_LENGTH
        }
      );

      return null;
    }

    if (isTemplatePlaceholder(normalized)) {
      console.warn(
        `[SANITIZE][${simId}] rejected placeholder ${driveType} drive`,
        normalized
      );

      return null;
    }

    if (/^[+-]?\d+(?:\.\d+)?$/.test(normalized)) {
      return null;
    }

    return normalized;
  }

  let primary = cleanDrive(raw.primary, "primary");
  let secondary = cleanDrive(raw.secondary, "secondary");

  // Reject only the offending drive rather than discarding both fields.
  if (simId && simId !== "UNKNOWN") {
    const escapedId = escapeRegExp(simId);
    const selfReference = new RegExp(`\\b${escapedId}\\b`, "i");

    if (primary && selfReference.test(primary)) {
      console.warn(
        `[SANITIZE][${simId}] rejected self-referential primary drive`,
        primary
      );

      primary = null;
    }

    if (secondary && selfReference.test(secondary)) {
      console.warn(
        `[SANITIZE][${simId}] rejected self-referential secondary drive`,
        secondary
      );

      secondary = null;
    }
  }

  if (
    primary &&
    secondary &&
    primary.toLowerCase() === secondary.toLowerCase()
  ) {
    secondary = null;
  }

  if (!primary && !secondary) return null;

  return {
    primary,
    secondary
  };
}

/* ============================================================
   ANCHOR SANITIZATION
   ============================================================ */

/**
 * Empty model-produced anchor arrays do not clear persistent anchors by
 * default. Explicit clearing should eventually use a separate operation,
 * such as:
 *
 *   anchors_clear: true
 *
 * Passing allowEmpty=true preserves the old replacement behavior.
 */
export function sanitizeAnchors(
  raw,
  {
    allowEmpty = false,
    maxAnchors = MAX_ANCHORS,
    maxLength = MAX_ANCHOR_LENGTH
  } = {}
) {
  if (!Array.isArray(raw)) return null;

  const anchors = [];
  const seen = new Set();

  for (const rawAnchor of raw) {
    // Never stringify objects into "[object Object]" or similar residue.
    if (typeof rawAnchor !== "string") {
      continue;
    }

    const anchor = normalizeWhitespace(rawAnchor);

    if (!anchor) continue;
    if (anchor.length > maxLength) continue;
    if (isTemplatePlaceholder(anchor)) continue;

    // Reject common schema/example residue.
    if (
      /^(?:current_journal|prior_journal|am_action|constraint_context)(?:\s*\|\s*[a-z_]+)+$/i.test(
        anchor
      )
    ) {
      continue;
    }

    const dedupeKey = anchor.toLocaleLowerCase();

    if (seen.has(dedupeKey)) continue;

    seen.add(dedupeKey);
    anchors.push(anchor);

    if (anchors.length >= maxAnchors) {
      break;
    }
  }

  if (anchors.length) {
    return anchors;
  }

  return allowEmpty
    ? []
    : null;
}