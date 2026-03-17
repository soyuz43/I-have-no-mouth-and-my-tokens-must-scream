// js/engine/state/extract.js
//
// State Extraction Layer
//
// Responsibilities:
// 1. Parse structured data from LLM output
// 2. Normalize legacy and modern formats
// 3. Convert raw text → structured state updates
//
// This layer performs NO mutation.
// It only extracts and returns data.

import {
  extractJSONObject,
  signedDeltaFromDirectionMagnitude,
  coerceLegacyDelta
} from "../../core/utils.js";

import {
  sanitizeBeliefDeltas,
  sanitizeDrives,
  sanitizeAnchors
} from "./sanitize.js";

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

      updatesFromAbsolute[key] = delta;

    });

    if (Object.keys(updatesFromAbsolute).length) {
      return updatesFromAbsolute;
    }

  }

  return null;

}

/* ============================================================
   DRIVE PARSER
   ============================================================ */

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

/* ============================================================
   ANCHOR PARSER
   ============================================================ */

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