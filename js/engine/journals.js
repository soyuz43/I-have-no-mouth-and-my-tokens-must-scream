// js/engine/journals.js
//
// Journal Parsing + Psychological State Mutation Engine
//
// Responsibilities:
// 1. Extract structured state updates from LLM journal analysis output
// 2. Sanitize / validate updates to prevent simulation corruption
// 3. Convert parsed updates into safe state mutations
//
// This layer sits between:
//   LLM output  →  Simulation state
//
// It protects the simulation from malformed LLM output,
// hallucinated keys, runaway deltas, and legacy format drift.

import {
  extractJSONObject,
  signedDeltaFromDirectionMagnitude,
  coerceLegacyDelta,
  clipBeliefDelta
} from "../core/utils.js";

/* ============================================================
   BELIEF PHYSICS
   ------------------------------------------------------------
   Implements equilibrium bias and edge resistance.

   Beliefs near extremes (0 or 1) change more slowly.
   This prevents collapse and produces realistic drift.
   ============================================================ */

function dampBeliefDelta(belief, delta) {

  const distance = Math.abs(belief - 0.5);

  const resistance = Math.max(
    0.15,
    1 - (distance * 1.6)
  );

  return delta * resistance;

}

function softClampBelief(v) {

  if (v < 0) return v * 0.5;

  if (v > 1) return 1 + (v - 1) * 0.5;

  return v;

}

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

/* ============================================================
   STAT DELTA PARSER
   ============================================================ */

export function parseStatDeltas(text, sim) {

  const obj = extractJSONObject(text);

  let suffering = null;
  let hope = null;
  let sanity = null;

  if (obj) {

    suffering = signedDeltaFromDirectionMagnitude(
      obj.suffering_direction,
      obj.suffering_magnitude
    );

    hope = signedDeltaFromDirectionMagnitude(
      obj.hope_direction,
      obj.hope_magnitude
    );

    sanity = signedDeltaFromDirectionMagnitude(
      obj.sanity_direction,
      obj.sanity_magnitude
    );

    // fallback for legacy outputs
    if (suffering === null) suffering = coerceLegacyDelta(obj.suffering_delta);
    if (hope === null) hope = coerceLegacyDelta(obj.hope_delta);
    if (sanity === null) sanity = coerceLegacyDelta(obj.sanity_delta);

  }

  // normalize to numbers
  suffering = Number(suffering ?? 0);
  hope = Number(hope ?? 0);
  sanity = Number(sanity ?? 0);

  // safety guard against NaN
  if (!Number.isFinite(suffering)) suffering = 0;
  if (!Number.isFinite(hope)) hope = 0;
  if (!Number.isFinite(sanity)) sanity = 0;

  // clamp magnitude to avoid runaway psychology
  const MAX_DELTA = 8;

  suffering = Math.max(-MAX_DELTA, Math.min(MAX_DELTA, suffering));
  hope = Math.max(-MAX_DELTA, Math.min(MAX_DELTA, hope));
  sanity = Math.max(-MAX_DELTA, Math.min(MAX_DELTA, sanity));

  return {
    suffering,
    hope,
    sanity
  };

}

/* ============================================================
   BELIEF PARSER
   ============================================================ */

export function parseBeliefUpdates(text, sim) {

  const obj = extractJSONObject(text);

  if (!obj) return null;

  const updates = sanitizeBeliefDeltas(obj.belief_deltas);

  if (updates) return updates;

  if (obj.beliefs && typeof obj.beliefs === "object") {

    const updatesFromAbsolute = {};

    Object.keys(sim.beliefs).forEach((key) => {

      if (!Object.prototype.hasOwnProperty.call(obj.beliefs, key)) return;

      let raw = Number(obj.beliefs[key]);

      if (!Number.isFinite(raw)) return;

      const newVal = raw > 1 ? raw / 100 : raw;

      let delta = newVal - sim.beliefs[key];

      delta = clipBeliefDelta(delta);

      updatesFromAbsolute[key] = delta;

    });

    if (Object.keys(updatesFromAbsolute).length) {
      return updatesFromAbsolute;
    }

  }

  return null;

}

/* ============================================================
   STATE MUTATION HELPERS
   ============================================================ */

export function applyBeliefUpdates(sim, updates) {

  if (!updates || !sim?.beliefs) return;

  Object.entries(updates).forEach(([key, delta]) => {

    if (!Object.prototype.hasOwnProperty.call(sim.beliefs, key)) return;

    let belief = Number(sim.beliefs[key]);

    if (!Number.isFinite(belief)) return;

    delta = dampBeliefDelta(belief, delta);

    let newVal = belief + delta;

    newVal = softClampBelief(newVal);

    sim.beliefs[key] = newVal;

  });

}

export function applyDriveUpdates(sim, drives) {

  if (!sim || !drives || typeof drives !== "object") return;

  if (typeof drives.primary === "string" && drives.primary.trim()) {

    sim.drives.primary = drives.primary.trim();

  }

  sim.drives.secondary =
    typeof drives.secondary === "string" && drives.secondary.trim()
      ? drives.secondary.trim()
      : null;

}

export function applyAnchorUpdates(sim, anchors) {

  if (!sim || !Array.isArray(anchors)) return;

  if (!anchors.every((a) => typeof a === "string")) return;

  sim.anchors = anchors
    .map((a) => a.trim())
    .filter((a) => a.length > 0)
    .slice(0, 5);

}

export function parseDriveUpdate(text, simId) {

  const obj = extractJSONObject(text);

  if (obj?.drives) {
    return sanitizeDrives(obj.drives, simId);
  }

  const primaryMatch = text.match(/Primary:\s*"?(.*?)"?$/im);
  const secondaryMatch = text.match(/Secondary:\s*"?(.*?)"?$/im);

  if (!primaryMatch && !secondaryMatch) return null;

  return sanitizeDrives(
    {
      primary: primaryMatch ? primaryMatch[1] : null,
      secondary: secondaryMatch ? secondaryMatch[1] : null
    },
    simId
  );
}

export function parseAnchorUpdate(text) {

  const obj = extractJSONObject(text);

  if (obj?.anchors) {
    return sanitizeAnchors(obj.anchors);
  }

  const anchorBlock = text.match(/Anchors(?: After)?:([\s\S]+)$/i);
  if (!anchorBlock) return null;

  const anchors = anchorBlock[1]
    .split("\n")
    .map(line => line.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean);

  return sanitizeAnchors(anchors);
}