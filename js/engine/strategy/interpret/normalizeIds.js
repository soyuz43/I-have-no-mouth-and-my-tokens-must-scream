// js/engine/strategy/interpret/normalizeIds.js
//
// STRATEGY INTERPRETATION — ID NORMALIZATION
//
// PURPOSE:
// Convert raw "id" field from LLM output into a normalized array of candidate IDs.
//
// This function handles:
// - casing normalization
// - separator normalization (AND, →, +, etc.)
// - quote stripping
// - whitespace cleanup
// - safe token splitting
//
// IMPORTANT:
// - This function does NOT validate IDs
// - This function does NOT perform fuzzy matching
// - This function does NOT infer missing IDs
//
// It ONLY standardizes raw input into consistent tokens.
//
// INPUT:
//   string (raw id field from LLM output)
//
// OUTPUT:
//   array of normalized ID tokens (strings)
//
// EXAMPLES:
//   "TED" → ["TED"]
//   "ellen & nimdok" → ["ELLEN", "NIMDOK"]
//   "GORRISTER + BENNY" → ["GORRISTER", "BENNY"]
//   "  'ted'  " → ["TED"]
//

export function normalizeStrategyIds(idField, options = {}) {

  const {
    DEBUG = false
  } = options;

  if (DEBUG) {
    console.debug("[INTERPRET][normalizeIds] raw input:", idField);
  }

  /* ------------------------------------------------------------
     INPUT GUARD
  ------------------------------------------------------------ */

  if (!idField || typeof idField !== "string") {
    if (DEBUG) {
      console.warn("[INTERPRET][normalizeIds] invalid input");
    }
    return [];
  }

  /* ------------------------------------------------------------
     NORMALIZATION PIPELINE
  ------------------------------------------------------------ */

  const normalized = idField
    .toUpperCase()

    // ------------------------------------------------------------
    // NORMALIZE CONNECTORS
    // "AND" → ","
    // "→", "+", etc. → ","
    // ------------------------------------------------------------
    .replace(/\bAND\b/g, ",")
    .replace(/->|→|\+/g, ",")

    // ------------------------------------------------------------
    // REMOVE QUOTES
    // ------------------------------------------------------------
    .replace(/["']/g, "")

    // ------------------------------------------------------------
    // NORMALIZE WHITESPACE
    // ------------------------------------------------------------
    .replace(/\s+/g, " ")
    .trim()

    // ------------------------------------------------------------
    // SPLIT INTO TOKENS
    // ------------------------------------------------------------
    .split(/[&,]/)

    // ------------------------------------------------------------
    // CLEAN TOKENS
    // ------------------------------------------------------------
    .map(token => token.trim())
    .filter(Boolean);

  /* ------------------------------------------------------------
     DEBUG OUTPUT
  ------------------------------------------------------------ */

  if (DEBUG) {
    console.debug("[INTERPRET][normalizeIds] result:", normalized);
  }

  return normalized;
}