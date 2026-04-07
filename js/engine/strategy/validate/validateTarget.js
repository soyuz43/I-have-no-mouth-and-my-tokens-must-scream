// js/engine/strategy/validate/validateTarget.js

/* ============================================================
   TARGET VALIDATION

   PURPOSE:
   Validates a single parsed target object.

   DESIGN PRINCIPLES:
   - No mutation
   - No global state access
   - Returns structured result (no throwing)
   - Preserves original parser behavior
   - Separates errors vs warnings

   RETURNS:
   {
     valid: boolean,
     errors: string[],
     warnings: string[]
   }
============================================================ */

export function validateTarget(target, id, { DEBUG = false } = {}) {

  const errors = [];
  const warnings = [];

  /* ------------------------------------------------------------
     BASIC STRUCTURE VALIDATION
  ------------------------------------------------------------ */

  if (!target || typeof target !== "object") {
    errors.push(`Target must be an object`);
    return { valid: false, errors, warnings };
  }

  const {
    objective,
    hypothesis,
    why_now,
    evidence
  } = target;

  /* ------------------------------------------------------------
     REQUIRED FIELD VALIDATION
  ------------------------------------------------------------ */

  const requiredKeys = ["objective", "hypothesis", "why_now", "evidence"];
  const missing = requiredKeys.filter((k) => !(k in target));

  if (missing.length > 0) {
    errors.push(`Missing required keys: ${missing.join(", ")}`);
  }

  /* ------------------------------------------------------------
     FIELD TYPE + CONTENT VALIDATION
  ------------------------------------------------------------ */

if (typeof objective !== "string" || !objective.trim()) {

  // DEBUG: surface raw broken structure
  console.warn("[VALIDATE] missing/invalid objective. Raw target:", target);

  errors.push(`Invalid objective`);
}

  if (typeof hypothesis !== "string" || !hypothesis.trim()) {
    errors.push(`Invalid hypothesis`);
  }

  if (typeof why_now !== "string" || why_now.trim().length < 15) {
    errors.push(`Invalid or weak why_now`);
  }

  if (typeof evidence !== "string" || evidence.trim().length < 10) {
    errors.push(`Invalid or weak evidence`);
  }

  /* ------------------------------------------------------------
     HYPOTHESIS STRUCTURE CHECK (WARNING ONLY)
  ------------------------------------------------------------ */

  if (
    typeof hypothesis === "string" &&
    (!hypothesis.includes("causes") || !hypothesis.includes("leads"))
  ) {
    warnings.push(`Weak hypothesis structure`);
  }

  /* ------------------------------------------------------------
     ALIGNMENT CHECK (WARNING ONLY)
  ------------------------------------------------------------ */

  if (id && typeof id === "string") {

    const combined = (
      (evidence || "") +
      " " +
      (why_now || "") +
      " " +
      (hypothesis || "")
    ).toLowerCase();

    if (!combined.includes(id.toLowerCase())) {
      warnings.push(`Alignment issue: fields may not reference target consistently`);
    }

  }

  /* ------------------------------------------------------------
     FINAL RESULT
  ------------------------------------------------------------ */

  const valid = errors.length === 0;

  if (DEBUG) {
    if (!valid) {
      console.warn("[VALIDATE] errors:", errors);
    }
    if (warnings.length) {
      console.warn("[VALIDATE] warnings:", warnings);
    }
  }

  return {
    valid,
    errors,
    warnings
  };
}