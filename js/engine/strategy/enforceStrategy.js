// js/engine/strategy/enforceStrategy.js

import { SIM_IDS } from "../../core/constants.js";

/* ============================================================
   STRATEGY ENFORCEMENT

   PURPOSE:
   - Filter valid targets
   - Deduplicate targets (first wins)
   - Enforce SIM_IDS constraint
   - Track per-target drop reasons (NEW)

   DESIGN PRINCIPLES:
   - PURE FUNCTION
   - NO mutation
   - NO global state
   - NO fallback logic
   - OUTPUT COMPATIBLE WITH commitStrategy
   - FULL OBSERVABILITY (drop-level diagnostics)

   RETURNS:
   {
     targets: [],
     meta: {
       inputCount,
       validCount,
       droppedInvalid,
       droppedDuplicates,
       droppedDetails: []
     }
   }
============================================================ */

export function enforceStrategy(validatedTargets = [], { DEBUG = false } = {}) {

  const nextTargets = [];
  const seen = new Set();

  let droppedInvalid = 0;
  let droppedDuplicates = 0;

  // 🔥 NEW: detailed drop tracking
  const droppedDetails = [];

  if (!Array.isArray(validatedTargets)) {
    return {
      targets: [],
      meta: {
        inputCount: 0,
        validCount: 0,
        droppedInvalid: 0,
        droppedDuplicates: 0,
        droppedDetails: []
      }
    };
  }

  const inputCount = validatedTargets.length;

  validatedTargets.forEach((entry, index) => {

    // ------------------------------------------------------------
    // INVALID ENTRY
    // ------------------------------------------------------------
    if (!entry || typeof entry !== "object") {
      droppedInvalid++;
      droppedDetails.push({
        index,
        id: null,
        reason: "invalid_entry"
      });
      return;
    }

    const { id, target, valid } = entry;
    const safeId = typeof id === "string" ? id : null;

    // ------------------------------------------------------------
    // INVALID FLAG
    // ------------------------------------------------------------
    if (!valid) {
      droppedInvalid++;
      droppedDetails.push({
        index,
        id: safeId,
        reason: "invalid_flag"
      });
      return;
    }

    // ------------------------------------------------------------
    // MISSING / INVALID ID
    // ------------------------------------------------------------
    if (!id || typeof id !== "string") {
      droppedInvalid++;
      droppedDetails.push({
        index,
        id: safeId,
        reason: "missing_id"
      });
      return;
    }

    const normalizedId = id.toUpperCase();

    // ------------------------------------------------------------
    // SIM ID CHECK
    // ------------------------------------------------------------
    if (!SIM_IDS.includes(normalizedId)) {
      droppedInvalid++;
      droppedDetails.push({
        index,
        id: normalizedId,
        reason: "invalid_sim_id"
      });
      return;
    }

    // ------------------------------------------------------------
    // DUPLICATE CHECK
    // ------------------------------------------------------------
    if (seen.has(normalizedId)) {
      droppedDuplicates++;
      droppedDetails.push({
        index,
        id: normalizedId,
        reason: "duplicate"
      });
      return;
    }

    seen.add(normalizedId);

    // ------------------------------------------------------------
    // TARGET STRUCTURE CHECK
    // ------------------------------------------------------------
    if (!target || typeof target !== "object") {
      droppedInvalid++;
      droppedDetails.push({
        index,
        id: normalizedId,
        reason: "missing_target"
      });
      return;
    }

    const {
      objective,
      hypothesis,
      reasoning,
      confidence = 0.5
    } = target;

    if (
      typeof objective !== "string" ||
      typeof hypothesis !== "string" ||
      !reasoning ||
      typeof reasoning.evidence !== "string" ||
      typeof reasoning.why_now !== "string"
    ) {
      droppedInvalid++;
      droppedDetails.push({
        index,
        id: normalizedId,
        reason: "invalid_structure"
      });
      return;
    }

    // ------------------------------------------------------------
    // ACCEPT TARGET
    // ------------------------------------------------------------
    nextTargets.push({
      id: normalizedId,
      objective: objective.trim(),
      hypothesis: hypothesis.trim(),
      why_now: reasoning.why_now.trim(),
      evidence: reasoning.evidence.trim(),
      _inferenceConfidence: confidence
    });

  });

  const validCount = nextTargets.length;

  if (DEBUG) {
    console.debug("[ENFORCE]");
    console.table({
      inputCount,
      validCount,
      droppedInvalid,
      droppedDuplicates,
      droppedDetails: droppedDetails.length
    });
  }

  return {
    targets: nextTargets,
    meta: {
      inputCount,
      validCount,
      droppedInvalid,
      droppedDuplicates,
      droppedDetails
    }
  };
}