// js/engine/state/sanitize.js
//
// State Sanitization Layer
//
// Responsibilities:
// 1. Clean and normalize LLM-derived updates
// 2. Prevent malformed or adversarial data from entering the system
// 3. Enforce safe ranges and structural constraints
//
// This layer ensures that extracted data is safe before validation
// and state mutation occur.

import {
  clipBeliefDelta
} from "../../core/utils.js";

/* ============================================================
   BELIEF / DRIVE / ANCHOR SANITIZATION
   ============================================================ */

export function sanitizeBeliefDeltas(raw) {

  if (!raw || typeof raw !== "object") return null;

  const allowed = [
    "escape_possible",
    "others_trustworthy",
    "self_worth",
    "reality_reliable",
    "guilt_deserved",
    "resistance_possible",
    "am_has_limits"
  ];

  const updates = {};

  allowed.forEach((key) => {

    if (!Object.prototype.hasOwnProperty.call(raw, key)) return;

    let val = Number(raw[key]);

    if (!Number.isFinite(val)) return;

    if (Math.abs(val) > 50) return;

    val = val / 100;

    val = clipBeliefDelta(val);

    updates[key] = val;

  });

  return Object.keys(updates).length ? updates : null;

}

export function sanitizeDrives(raw, simId) {

  if (!raw || typeof raw !== "object") return null;

  let primary =
    raw.primary == null ? null : String(raw.primary).trim() || null;

  let secondary =
    raw.secondary == null ? null : String(raw.secondary).trim() || null;

  if (secondary && secondary.toLowerCase() === "none") secondary = null;
  if (primary && primary.toLowerCase() === "none") primary = null;

  const selfRefRegex = new RegExp(simId, "i");

  if (
    (primary && selfRefRegex.test(primary)) ||
    (secondary && selfRefRegex.test(secondary))
  ) {

    console.warn(
      `Drive self-reference detected for ${simId}: primary="${primary}", secondary="${secondary}"`
    );

    return null;

  }

  if (!primary && !secondary) return null;

  return { primary, secondary };

}

export function sanitizeAnchors(raw) {

  if (!Array.isArray(raw)) return null;

  const anchors = raw
    .map((x) => (x == null ? "" : String(x).trim()))
    .filter(Boolean)
    .slice(0, 12);

  const deduped = [...new Set(anchors)];

  return deduped.length ? deduped : [];

}