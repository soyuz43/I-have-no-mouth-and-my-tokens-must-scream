// js/engine/strategy/validate/validateTargetsArray.js

import { SIM_IDS } from "../../../core/constants.js";
import { validateTarget } from "./validateTarget.js";

/* ============================================================
   TARGET ARRAY VALIDATION

   PURPOSE:
   - Validate full targets[] array
   - Delegate per-target validation
   - Enforce uniqueness
   - Preserve tolerant behavior (skip invalid)

   DESIGN:
   - Does NOT mutate targets
   - Uses validateTarget for evaluation only
   - Returns filtered targets
============================================================ */

export function validateTargetsArray(targets, { DEBUG = false } = {}) {

  if (DEBUG) {
    console.debug("[VALIDATE][ARRAY] start");
  }

  /* ------------------------------------------------------------
     STRUCTURE VALIDATION
  ------------------------------------------------------------ */

  if (!Array.isArray(targets)) {
    throw new Error("'targets' must be an array");
  }

  if (
    targets.length === 0 ||
    targets.length > SIM_IDS.length
  ) {
    throw new Error(
      `Invalid number of targets: ${targets.length}. Max allowed is ${SIM_IDS.length}`
    );
  }

  /* ------------------------------------------------------------
     VALIDATION LOOP
  ------------------------------------------------------------ */

  const seen = new Set();
  const validTargets = [];
  let duplicateCount = 0;

  targets.forEach((target, index) => {

    const id = target?.id;

    if (DEBUG) {
      console.debug(`[VALIDATE][ARRAY] target[${index}]`, target);
    }

    if (!id || typeof id !== "string") {
      console.warn(`[VALIDATE] Target ${index} missing valid id — skipping`);
      return;
    }

    if (!SIM_IDS.includes(id)) {
      console.warn(`[VALIDATE] Invalid id: ${id} — skipping`);
      return;
    }

    if (seen.has(id)) {
      duplicateCount++;
      console.warn(`[VALIDATE] Duplicate target: ${id} — skipping`);
      return;
    }

    const result = validateTarget(target, id, { DEBUG: true });

    if (!result.valid) {
      console.warn(
        `[VALIDATE] Target ${id} rejected:`,
        result.errors
      );
      return;
    }

    if (result.warnings.length && DEBUG) {
      console.warn(
        `[VALIDATE] Target ${id} warnings:`,
        result.warnings
      );
    }

    seen.add(id);
    validTargets.push(target);

  });

  /* ------------------------------------------------------------
     FINAL VALIDATION
  ------------------------------------------------------------ */

  if (validTargets.length === 0) {

    console.warn("[VALIDATE] no valid targets — allowing degraded execution");

    return [];
  }

  if (validTargets.length > SIM_IDS.length) {
    throw new Error(
      `Too many valid targets: ${validTargets.length}. Maximum is ${SIM_IDS.length}`
    );
  }

  if (DEBUG) {
    console.debug(
      `[VALIDATE][ARRAY] valid=${validTargets.length} total=${targets.length} duplicates=${duplicateCount}`
    );
  }

  return validTargets;
}