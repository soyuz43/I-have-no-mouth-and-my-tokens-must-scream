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
  signedDeltaFromDirectionMagnitude,
  coerceLegacyDelta
} from "../../core/utils.js";

import { safeExtractJSON } from "./utils/safeExtract.js";
import { fallbackExtractBeliefDeltas } from "./utils/fallbackBeliefs.js";
import { safeExtractFields } from "./utils/fieldExtract.js";
import {
  sanitizeBeliefDeltas,
  sanitizeDrives,
  sanitizeAnchors
} from "./sanitize.js";

/* ============================================================
   STAT DELTA PARSER
   ============================================================ */

export function parseStatDeltas(text, sim) {

  const obj = safeExtractJSON(text);

  let suffering = null;
  let hope = null;
  let sanity = null;

  if (obj) {

    // Normalize magnitude: take absolute value (positive) and default to 0 if missing/invalid
    const sufferingMag = obj.suffering_magnitude != null ? Math.abs(obj.suffering_magnitude) : null;
    const hopeMag = obj.hope_magnitude != null ? Math.abs(obj.hope_magnitude) : null;
    const sanityMag = obj.sanity_magnitude != null ? Math.abs(obj.sanity_magnitude) : null;

    suffering = signedDeltaFromDirectionMagnitude(
      obj.suffering_direction,
      sufferingMag
    );

    hope = signedDeltaFromDirectionMagnitude(
      obj.hope_direction,
      hopeMag
    );

    sanity = signedDeltaFromDirectionMagnitude(
      obj.sanity_direction,
      sanityMag
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
  // Log the input for debugging
  console.debug(`[parseBeliefUpdates] Full input for ${sim.id}:`, text);

  const obj = safeExtractJSON(text);

  if (!obj) {
    console.warn(`[parseBeliefUpdates] JSON extraction failed for ${sim.id}, attempting fallback`);

    // --- NEW: field-level recovery ---
    const partial = safeExtractFields(text);

    if (partial?.belief_deltas) {
      console.warn(`[parseBeliefUpdates] recovered belief_deltas via field extraction for ${sim.id}`);

      const scaled = {};
      Object.entries(partial.belief_deltas).forEach(([key, delta]) => {
        if (!Number.isFinite(delta)) return;
        scaled[key] = delta / 30;
      });

      if (Object.keys(scaled).length) {
        return scaled;
      }
    }

    // --- EXISTING fallback ---
    const fallback = fallbackExtractBeliefDeltas(text);

    if (fallback && Object.keys(fallback).length) {
      console.debug(`[parseBeliefUpdates] Fallback succeeded for ${sim.id}:`, fallback);

      const scaled = {};
      Object.entries(fallback).forEach(([key, delta]) => {
        if (!Number.isFinite(delta)) return;
        scaled[key] = delta / 30;
      });

      if (Object.keys(scaled).length) {
        return scaled;
      }

      console.warn(`[parseBeliefUpdates] Fallback produced no valid deltas for ${sim.id}`);
      return {};
    }

    console.warn(`[parseBeliefUpdates] Fallback failed for ${sim.id}. Full raw text:`, text);
    console.warn(`[parseBeliefUpdates] USING EMPTY DELTAS for ${sim.id}`);
    return {};
  }

  console.debug(`[parseBeliefUpdates] Extracted JSON for ${sim.id}:`, obj);

  // Try primary path: belief_deltas
  const rawUpdates = sanitizeBeliefDeltas(obj.belief_deltas);
  if (rawUpdates) {
    const scaled = {};
    Object.entries(rawUpdates).forEach(([key, delta]) => {
      if (!Number.isFinite(delta)) return;
      scaled[key] = delta / 30;
    });
    if (Object.keys(scaled).length) {
      console.debug(`[parseBeliefUpdates] Success: got ${Object.keys(scaled).length} belief deltas for ${sim.id}`);
      return scaled;
    } else {
      console.warn(`[parseBeliefUpdates] belief_deltas present but all values invalid for ${sim.id}. Raw updates:`, rawUpdates);
      // fall through to try absolute beliefs
    }
  } else {
    console.debug(`[parseBeliefUpdates] No belief_deltas or sanitization returned null for ${sim.id}`);
  }

  // Fallback: absolute beliefs (old format)
  if (obj.beliefs && typeof obj.beliefs === "object") {
    console.debug(`[parseBeliefUpdates] Trying absolute beliefs for ${sim.id}`);
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
      console.debug(`[parseBeliefUpdates] Success from absolute beliefs for ${sim.id}:`, updatesFromAbsolute);
      return updatesFromAbsolute;
    } else {
      console.warn(`[parseBeliefUpdates] beliefs object present but no valid updates for ${sim.id}. Sim beliefs keys:`, Object.keys(sim.beliefs), "Object beliefs keys:", Object.keys(obj.beliefs));
    }
  } else {
    console.debug(`[parseBeliefUpdates] No beliefs object in JSON for ${sim.id}`);
  }

  // Nothing usable found
  console.warn(
    `[parseBeliefUpdates] No belief data at all for ${sim.id}. Using safe fallback.`,
    Object.keys(obj)
  );

  return {};
}

/* ============================================================
   DRIVE PARSER
   ============================================================ */

export function parseDriveUpdate(text, simId) {

  const obj = safeExtractJSON(text);

  if (obj?.drives) {
    // Convert numeric values to strings if they appear (model sometimes outputs 0)
    let primary = obj.drives.primary;
    let secondary = obj.drives.secondary;

    if (typeof primary === 'number') {
      primary = String(primary);
    }
    if (typeof secondary === 'number') {
      secondary = String(secondary);
    }

    return sanitizeDrives({ primary, secondary }, simId);
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

  const obj = safeExtractJSON(text);

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