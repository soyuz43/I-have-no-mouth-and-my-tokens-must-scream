// js/engine/scratchpad/consolidate.js
//
// Engine-owned cognition consolidation.
//
// This is deterministic, model-independent lifecycle maintenance
// for the per-prisoner scratchpad, evaluated at cycle boundaries. It
// is intentionally separate from the scratchpad COMMS commit layer
// (js/engine/scratchpad/comms/commit.js), which owns model-driven,
// evidence-grounded updates. Per the roadmap, the engine owns the
// final mutation of consolidation bookkeeping; a model may *propose*
// merges later, but the engine applies them.
//
// This implements the "consolidation" half of the question/prediction
// lifecycle (roadmap Priority 3). It activates the dormant
// `lastConsolidatedCycle` field and performs bounded-memory
// maintenance:
//   - deduplicate message notes (by messageId);
//   - archive resolved questions (preserving provenance);
//   - expire predictions (delegated to expirePredictions);
//   - flag contradictions (reserved: no contradiction source yet).
//
// All steps are additive: existing fields and their order are
// preserved; `archivedQuestions` is added only to the schema by the
// caller (makeScratchpad), never inferred here.

import {
  expirePredictions,
} from "./expirePredictions.js";

export const DEFAULT_CONSOLIDATION_CADENCE = 5;

/**
 * Determine whether consolidation should run this cycle.
 *
 * Pure. Runs only on a fixed modulo cadence once a baseline cycle is
 * reached. `lastConsolidatedCycle === null` means never consolidated
 * yet, so the first eligible cycle (the cadence offset) triggers it.
 *
 * @param {number} cycle
 * @param {number|null} lastConsolidatedCycle
 * @param {number} cadence
 * @returns {boolean}
 */
export function shouldConsolidate(
  cycle,
  lastConsolidatedCycle,
  cadence = DEFAULT_CONSOLIDATION_CADENCE
) {
  if (
    typeof cycle !== "number" ||
    !Number.isFinite(cycle) ||
    cycle < 0
  ) {
    return false;
  }

  if (
    typeof cadence !== "number" ||
    !Number.isFinite(cadence) ||
    cadence < 1
  ) {
    return false;
  }

  // Cycle 0 is the pre-torment initialization seal and must not
  // run ordinary maintenance; consolidation begins on the first
  // real cycle.
  if (cycle === 0) {
    return false;
  }

  // Already consolidated at this exact cycle: do not double-run.
  if (lastConsolidatedCycle === cycle) {
    return false;
  }

  return cycle % cadence === 0;
}

/**
 * Deduplicate message notes by `messageId`, preserving the first
 * occurrence. Returns a new array (does not mutate input).
 *
 * @param {Array<object>} notes
 * @returns {Array<object>}
 */
export function dedupMessageNotes(notes) {
  if (!Array.isArray(notes)) {
    return [];
  }

  const seen = new Set();
  const result = [];

  for (const note of notes) {
    if (!note || typeof note !== "object") {
      continue;
    }

    const key = note.messageId;

    const seenKey =
      key === undefined || key === null
        ? Symbol.for("no-message-id")
        : String(key);

    if (seen.has(seenKey)) {
      continue;
    }

    seen.add(seenKey);
    result.push(note);
  }

  return result;
}

/**
 * Partition unresolved questions: keep active ones, archive resolved
 * ones (preserving provenance). Returns a new { active, archived }
 * pair; does not mutate inputs.
 *
 * @param {Array<object>} questions
 * @returns {{ active: Array<object>, archived: Array<object> }}
 */
export function archiveResolvedQuestions(questions) {
  const active = [];
  const archived = [];

  if (!Array.isArray(questions)) {
    return { active, archived };
  }

  for (const question of questions) {
    if (
      question &&
      typeof question === "object" &&
      question.resolved === true
    ) {
      archived.push(question);
    } else {
      active.push(question);
    }
  }

  return { active, archived };
}

/**
 * Perform deterministic consolidation on a scratchpad in place.
 *
 * Mutates `scratchpad` (engine-owned, like belief contagion). Sets
 * `lastConsolidatedCycle` and returns a summary of what changed.
 *
 * Additive: does not remove or reorder existing fields. If
 * `archivedQuestions` is absent from the schema, it is created as an
 * array so resolution provenance is never lost.
 *
 * @param {object} scratchpad
 * @param {number} cycle
 * @param {number} cadence
 * @returns {object}
 */
export function consolidateScratchpad(
  scratchpad,
  cycle,
  cadence = DEFAULT_CONSOLIDATION_CADENCE
) {
  const summary = {
    consolidatedCycle: cycle,
    dedupedMessageNotes: 0,
    archivedQuestions: 0,
    expiredPredictions: 0,
  };

  if (
    !scratchpad ||
    typeof scratchpad !== "object"
  ) {
    return summary;
  }

  const beforeNotes =
    Array.isArray(
      scratchpad.messageNotes
    )
      ? scratchpad.messageNotes.length
      : 0;

  // 1. Deduplicate message notes.
  if (Array.isArray(scratchpad.messageNotes)) {
    scratchpad.messageNotes =
      dedupMessageNotes(
        scratchpad.messageNotes
      );
    summary.dedupedMessageNotes =
      beforeNotes -
      scratchpad.messageNotes.length;
  }

  // 2. Archive resolved questions, preserving provenance.
  if (
    Array.isArray(
      scratchpad.unresolvedQuestions
    )
  ) {
    const { active, archived } =
      archiveResolvedQuestions(
        scratchpad.unresolvedQuestions
      );
    scratchpad.unresolvedQuestions = active;

    if (
      !Array.isArray(
        scratchpad.archivedQuestions
      )
    ) {
      scratchpad.archivedQuestions = [];
    }
    scratchpad.archivedQuestions.push(
      ...archived
    );
    summary.archivedQuestions =
      archived.length;
  }

  // 3. Expire predictions (delegated pure helper).
  if (
    Array.isArray(
      scratchpad.predictions
    )
  ) {
    const expiredIds = expirePredictions(
      scratchpad,
      cycle
    );
    summary.expiredPredictions =
      expiredIds.length;
  }

  scratchpad.lastConsolidatedCycle = cycle;

  return summary;
}

/**
 * Cycle-boundary entry point. Decides whether to consolidate and, if
 * so, runs consolidateScratchpad and returns the summary. Guarded by
 * the caller so a single prisoner's failure cannot abort the sim.
 *
 * @param {object} scratchpad
 * @param {number} cycle
 * @param {number} cadence
 * @returns {object|null} summary or null if skipped
 */
export function runScratchpadConsolidation(
  scratchpad,
  cycle,
  cadence = DEFAULT_CONSOLIDATION_CADENCE
) {
  if (
    !shouldConsolidate(
      cycle,
      scratchpad?.lastConsolidatedCycle ?? null,
      cadence
    )
  ) {
    return null;
  }

  return consolidateScratchpad(
    scratchpad,
    cycle,
    cadence
  );
}
