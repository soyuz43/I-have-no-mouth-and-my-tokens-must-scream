// js/engine/strategy/sanitizeStrategy.js
//
// STRATEGY SANITIZATION STAGE
//
// PURPOSE:
// Normalize raw LLM output into a clean, extraction-ready string.
//
// DESIGN PRINCIPLES:
// - Preserve original intent (no semantic changes)
// - Remove formatting artifacts (code fences, etc.)
// - Be fully observable (debug-friendly)
// - NEVER perform parsing, inference, or validation here
//
// This is the FIRST stage of the strategy pipeline.
//
// INPUT:
//   raw string (LLM output)
//
// OUTPUT:
//   cleaned string (safe for extraction phase)
//

export function sanitizeStrategyInput(raw, options = {}) {

  const {
    DEBUG = true
  } = options;

  if (DEBUG) {
    console.debug("[SANITIZE] raw input received");
  }

  /* ------------------------------------------------------------
     INPUT VALIDATION
  ------------------------------------------------------------ */

  if (!raw || typeof raw !== "string") {
    console.trace("[SANITIZE] invalid input (not a string)");
    throw new Error("sanitizeStrategyInput received invalid input");
  }

  /* ------------------------------------------------------------
     NORMALIZATION PIPELINE
  ------------------------------------------------------------ */

  let cleaned = raw;

  // ------------------------------------------------------------
  // TRIM WHITESPACE
  // ------------------------------------------------------------
  cleaned = cleaned.trim();

  // ------------------------------------------------------------
  // REMOVE MARKDOWN CODE FENCES
  // Handles:
  // ```json ... ```
  // ``` ... ```
  // ------------------------------------------------------------
  const beforeFenceStrip = cleaned;

  cleaned = cleaned
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```[\s]*$/i, "")
    .trim();

  if (DEBUG && beforeFenceStrip !== cleaned) {
    console.trace("[SANITIZE] code fences removed");
  }

  /* ------------------------------------------------------------
     OUTPUT DEBUG
  ------------------------------------------------------------ */

  if (DEBUG) {
    console.debug("[SANITIZE] cleaned output:\n", cleaned);
  }

  /* ------------------------------------------------------------
     RETURN CLEAN STRING
  ------------------------------------------------------------ */

  return cleaned;
}