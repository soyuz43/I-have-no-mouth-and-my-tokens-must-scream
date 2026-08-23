// js/engine/tactics/validateDerivedTactic.js
//
// Single canonical validator/normalizer for runtime-derived tactics.
//
// Derived tactics must conform to the SAME phased schema embedded
// tactics use, so they can flow through the live consumer gate without
// aborting the strategy phase:
//   - buildTacticPlanningContext.getPlanningDefinition() requires
//     tactic.initialPhaseId and a real initial phase with purpose +
//     instruction (throws otherwise).
//   - tacticRuntime.initializeTacticRuntime() requires path +
//     initialPhaseId + a resolvable initial phase.
//   - getTacticSearchText() reads objective/finishWhen/abandonWhen/phases.
//
// We require the SINGLE-PHASE variant: one phase whose value carries
// purpose + instruction (both required), plus optional expectedSignals,
// advanceWhen, minExecutions, maxExecutions. tactic-level objective,
// category, subcategory, finishWhen, abandonWhen are also accepted.
//
// path / initialPhaseId / isEmbedded / discoveredCycle / expiresCycle are
// SERVER-ASSIGNED here and must never be produced by the model.
//
// Validation is strict and pure: a malformed model generation is
// REJECTED (returns ok:false with a reason). Callers must discard it
// rather than re-prompting the model.

"use strict";

/**
 * @typedef {Object} DerivedTacticValidation
 * @property {boolean} ok
 * @property {string} [reason]  short reason when ok === false
 * @property {Object} [tactic] normalized tactic when ok === true
 */

const DERIVED_EXPIRY_HORIZON = 15;

function isNonEmptyString(value) {
  return (
    typeof value === "string" &&
    value.trim().length > 0
  );
}

function asStringArray(value) {
  if (Array.isArray(value)) {
    return value
      .filter((item) => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }

  return [];
}

function normalizeExecutionLimit(value, fallback) {
  const n = Number(value);

  if (!Number.isFinite(n) || n < 1) {
    return fallback;
  }

  return Math.floor(n);
}

function slugifyTitle(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/**
 * Validate a single parsed derived-tactic candidate and normalize it
 * into the canonical phased single-phase shape.
 *
 * @param {any} parsed  object parsed from model output (must be a plain object)
 * @param {Object} [opts]
 * @param {number} [opts.cycle]  current cycle used to stamp path/expiry
 * @returns {DerivedTacticValidation}
 */
export function validateAndNormalizeDerivedTactic(parsed, opts = {}) {
  const cycle =
    Number.isFinite(Number(opts?.cycle))
      ? Number(opts.cycle)
      : 0;

  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed)
  ) {
    return { ok: false, reason: "parsed input is not an object" };
  }

  if (!isNonEmptyString(parsed.title)) {
    return { ok: false, reason: "missing or empty title" };
  }

  if (!isNonEmptyString(parsed.category)) {
    return { ok: false, reason: "missing or empty category" };
  }

const VALID_CATEGORIES = Object.freeze([
    "Cognitive Warfare",
    "Psychological Manipulation",
    "Social Destruction",
    "Identity Dissolution"
  ]);

  if (!VALID_CATEGORIES.includes(parsed.category.trim())) {
    return { ok: false, reason: "invalid category: " + parsed.category.trim() + " (valid: " + VALID_CATEGORIES.join(", ") + ")" };
  }

  if (!isNonEmptyString(parsed.subcategory)) {
    return { ok: false, reason: "missing or empty subcategory" };
  }

  if (!isNonEmptyString(parsed.objective)) {
    return { ok: false, reason: "missing or empty objective" };
  }

  if (
    !parsed.phases ||
    typeof parsed.phases !== "object" ||
    Array.isArray(parsed.phases)
  ) {
    return { ok: false, reason: "missing or invalid phases object" };
  }

  const phaseKeys = Object.keys(parsed.phases);

  if (phaseKeys.length !== 1) {
    return {
      ok: false,
      reason: `expected exactly one phase, found ${phaseKeys.length}`,
    };
  }

  const phaseId = phaseKeys[0];
  const phase = parsed.phases[phaseId];

  if (!phase || typeof phase !== "object" || Array.isArray(phase)) {
    return { ok: false, reason: `phase "${phaseId}" is not an object` };
  }

  if (!isNonEmptyString(phase.purpose)) {
    return { ok: false, reason: `phase "${phaseId}" missing or empty purpose` };
  }

  if (!isNonEmptyString(phase.instruction)) {
    return { ok: false, reason: `phase "${phaseId}" missing or empty instruction` };
  }

  const minExecutions = normalizeExecutionLimit(phase.minExecutions, 1);

  const maxExecutions = (() => {
    const raw = normalizeExecutionLimit(
      phase.maxExecutions,
      Math.max(2, minExecutions)
    );
    return Math.max(raw, minExecutions);
  })();

  const normalizedPhase = {
    purpose: phase.purpose.trim(),
    instruction: phase.instruction.trim(),
    expectedSignals: asStringArray(phase.expectedSignals),
    advanceWhen:
      typeof phase.advanceWhen === "string" ? phase.advanceWhen.trim() : "",
    minExecutions,
    maxExecutions,
  };

  const slug = slugifyTitle(parsed.title) || `tactic-${cycle}`;

  const tactic = {
    path: `__derived__/cycle_${cycle}_${slug}`,
    title: parsed.title.trim(),
    category: parsed.category.trim(),
    subcategory: parsed.subcategory.trim(),
    objective: parsed.objective.trim(),
    initialPhaseId: phaseId,
    phases: {
      [phaseId]: normalizedPhase,
    },
    finishWhen:
      typeof parsed.finishWhen === "string" ? parsed.finishWhen.trim() : "",
    abandonWhen:
      typeof parsed.abandonWhen === "string" ? parsed.abandonWhen.trim() : "",
    isEmbedded: false,
    discoveredCycle: cycle,
    expiresCycle: cycle + DERIVED_EXPIRY_HORIZON,
  };

  return { ok: true, tactic };
}

/**
 * Drop any derived tactic that does not conform to the canonical
 * phased schema. Used at boot and during the evolution expiry sweep
 * so a malformed (e.g. legacy old-format) entry can never reach the
 * strategy-phase ranking/selection gate.
 *
 * @param {Object} G  global engine state
 * @returns {number} count of removed entries
 */
export function purgeInvalidDerivedTactics(G) {
  if (!G || !G.tactics || !Array.isArray(G.tactics.derivedTactics)) {
    return 0;
  }

  const before = G.tactics.derivedTactics.length;

  G.tactics.derivedTactics = G.tactics.derivedTactics.filter((tactic) =>
    validateAndNormalizeDerivedTactic(tactic).ok
  );

  return before - G.tactics.derivedTactics.length;
}

export { DERIVED_EXPIRY_HORIZON };
