// js/engine/state/validate.js
//
// State Validation Layer
//
// Responsibilities:
// 1. Detect psychological inconsistencies
// 2. Validate belief constraints and shifts
// 3. Ensure narrative coherence with reported deltas
//
// This layer performs NO mutation.
// It only logs warnings and returns validation results.

import { addLog } from "../../ui/logs.js";

/* ============================================================
   BELIEF VALIDATION RULES
============================================================ */

const BELIEF_RULES = {
  MIN: 0,
  MAX: 1,
  MAX_SHIFT: 0.5
};

/* ============================================================
   STAT CONSISTENCY VALIDATOR
============================================================ */

/**
 * Correct obvious psychological contradictions.
 * Example: suffering decreasing while hope and sanity collapse.
 */
export function correctStatInconsistencies(sim, parsed) {

  if (!parsed) return false;

  console.debug("[VALIDATOR][INPUT]", {
    sim: sim.id,
    parsed
  });

  let corrected = false;

  const s = parsed.suffering ?? parsed.suffering_delta ?? 0;
  const h = parsed.hope ?? parsed.hope_delta ?? 0;
  const sa = parsed.sanity ?? parsed.sanity_delta ?? 0;

  console.debug("[VALIDATOR][VALUES]", {
    suffering: s,
    hope: h,
    sanity: sa
  });

  // Rule 1:
  // suffering decreases while hope or sanity collapse
  // This is unusual but allowed (numbness / detachment)

  if (s < 0 && (h < 0 || sa < 0)) {

    const msg =
      `Unusual psychological transition: suffering decreased (${s}) while hope/sanity declined (${h}, ${sa})`;

    console.warn(`[${sim.id}] ${msg}`);

    addLog(
      `VALIDATOR // ${sim.id}`,
      `⚠ ${msg}`,
      "sys"
    );

  }

  // Rule 2:
  // large suffering spike while hope rises is suspicious

  if (s > 12 && h > 4) {

    const msg =
      `Unusual state transition: suffering ↑${s} while hope ↑${h}`;

    console.warn(`[${sim.id}] ${msg}`);

    addLog(
      `VALIDATOR // ${sim.id}`,
      `⚠ ${msg}`,
      "sys"
    );
  }

  return corrected;
}

/* ============================================================
   BELIEF VALIDATION
============================================================ */

/**
 * Validate belief states and belief shifts.
 * Returns warning list.
 */
export function validateBeliefs(agent, before = {}, shifts = {}) {

  /* ------------------------------------------------------------
     INPUT GUARD 
     Prevent crashes when LLM returns null / malformed JSON
  ------------------------------------------------------------ */

  if (!before || typeof before !== "object") {
    console.warn("[VALIDATOR] invalid belief state", before);
    before = {};
  }

  if (!shifts || typeof shifts !== "object") {
    console.warn("[VALIDATOR] invalid beliefUpdates", shifts);
    return [];
  }

  const warnings = [];

  const { MIN, MAX, MAX_SHIFT } = BELIEF_RULES;

  // Validate existing belief values

  for (const [k, v] of Object.entries(before)) {

    if (!Number.isFinite(v)) {
      warnings.push(`⚠ ${agent}.${k} invalid value: ${v}`);
      continue;
    }

    if (v < MIN || v > MAX) {
      warnings.push(`⚠ ${agent}.${k} out of bounds: ${v}`);
    }

  }

  // Validate belief shifts

  for (const [k, dv] of Object.entries(shifts)) {

    if (!Number.isFinite(dv)) {
      warnings.push(`⚠ ${agent}.${k} shift invalid: ${dv}`);
      continue;
    }

    if (Math.abs(dv) > MAX_SHIFT) {
      warnings.push(`⚠ ${agent}.${k} unusually large shift: ${dv}`);
    }

    // NOTE:
    // We do NOT validate post-shift bounds here,
    // because commit.js applies damping + bounding + clamping.
    // Raw shifts may exceed limits but will be corrected downstream.
  }

  return warnings;
}

/* ============================================================
   STATE BLOCK VALIDATOR
============================================================ */

/**
 * Entry point used by engine cycle.
 * Logs validator warnings to console and system log.
 *
 * @param {string} agent - Sim ID.
 * @param {object} before - Beliefs before update.
 * @param {object|null} shifts - Belief deltas (may be null).
 * @param {string} [raw] - Optional raw LLM output for debugging.
 * @returns {array} Warnings array.
 */
export function parseAndValidateStateBlock(agent, before, shifts, raw = null) {
  if (shifts === null) {
    console.warn(`[VALIDATOR] beliefUpdates is null for ${agent}. This usually means parseBeliefUpdates failed.`);
    console.debug(`[VALIDATOR] Before state for ${agent}:`, before);
    if (raw === null) {
      console.warn(`[VALIDATOR] Raw LLM output is NULL for ${agent}`);
    } else if (raw === undefined) {
      console.warn(`[VALIDATOR] Raw LLM output is UNDEFINED for ${agent}`);
    } else if (typeof raw === "string") {
      console.debug(`[RAW STRING for ${agent}]`, raw);
    } else if (typeof raw === "object") {
      console.debug(`[RAW OBJECT for ${agent}]`, raw);
    } else {
      console.debug(`[RAW UNKNOWN TYPE (${typeof raw}) for ${agent}]`, raw);
    }
  }

  const warnings = validateBeliefs(agent, before, shifts);

  if (!warnings.length) return [];

  for (const w of warnings) {
    console.warn(`[BELIEF VALIDATOR] ${w}`);
    addLog(`VALIDATOR // ${agent}`, w, "sys");
  }

  return warnings;
}
/* ============================================================
   NARRATIVE CONSISTENCY VALIDATOR
============================================================ */

export function validateNarrativeConsistency(sim, journalText, deltas) {

  const warnings = [];

  const text = journalText.toLowerCase();

  const NEGATIVE_CUES = [
    "despair",
    "hopeless",
    "broken",
    "pain",
    "suffering",
    "torture",
    "screaming",
    "agony",
    "nothing matters",
    "no escape"
  ];

  const POSITIVE_CUES = [
    "hope",
    "escape",
    "plan",
    "maybe",
    "together",
    "trust",
    "resist"
  ];

  const negativeHits = NEGATIVE_CUES.filter(w => text.includes(w)).length;
  const positiveHits = POSITIVE_CUES.filter(w => text.includes(w)).length;

  const { suffering = 0, hope = 0, sanity = 0 } = deltas;

  // negative journal but hope increases

  if (negativeHits >= 2 && hope > 2) {

    warnings.push(
      `Narrative mismatch: despair cues present but hope increased (+${hope})`
    );

  }

  // positive language but suffering spikes

  if (positiveHits >= 2 && suffering > 6) {

    warnings.push(
      `Narrative mismatch: hopeful language but suffering spiked (+${suffering})`
    );

  }

  // sanity crash without distress language

  if (sanity < -8 && negativeHits === 0) {

    warnings.push(
      `Large sanity drop (${sanity}) without distress cues`
    );

  }

  if (warnings.length) {

    warnings.forEach(w => {

      console.warn(`[NARRATIVE VALIDATOR] ${sim.id} ${w}`);

      addLog(
        `VALIDATOR // ${sim.id}`,
        `⚠ ${w}`,
        "sys"
      );

    });

  }

  return warnings;
}