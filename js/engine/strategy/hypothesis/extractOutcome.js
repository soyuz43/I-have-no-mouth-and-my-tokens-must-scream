// js/engine/strategy/hypothesis/extractOutcome.js
//
// NEXT-GEN OUTCOME EXTRACTION
//
// DESIGN:
// - Multiple extraction strategies (explicit → structural → heuristic)
// - Each strategy returns confidence + method
// - Observability is applied AFTER extraction (not mixed in)
// - Never returns invalid structure (safe defaults)
//
// OUTPUT SHAPE (stable):
// {
//   outcome: string | null,
//   confidence: number,
//   observable: boolean,
//   _meta: {
//     method: string,
//     extraction_confidence: number,
//     observability: {...}
//   }
// }

import { getObservabilityResult, calculateFinalConfidence } from "./observability.js";

// ============================================================================
// CONFIG
// ============================================================================

const STRONG_MARKERS = [
  "leading to",
  "resulting in",
  "causing",
  "which causes",
  "that leads to"
];

const SOFT_MARKERS = [
  "making",
  "forcing",
  "prompting",
  "triggering",
  "leading them to"
];

const ARROW_REGEX = /(?:->|→)/g;

// ============================================================================
// HELPERS
// ============================================================================

function normalize(text) {
  if (!text) return "";

  return text
    .trim()
    .replace(/^[,;:\s]+/, "")
    .replace(/[.,!?]+$/, "")
    .replace(/\s+/g, " ");
}

function splitClauses(text) {
  return text
    .split(/[,;]|\band\b|\bbut\b/)
    .map(s => s.trim())
    .filter(Boolean);
}

function scoreClause(clause) {
  let score = 0;

  if (/\bwill\b/.test(clause)) score += 2;
  if (/\bby\b/.test(clause)) score += 2;
  if (/\b(causing|forcing|making|leading)\b/.test(clause)) score += 2;

  if (clause.length > 20) score += 1;
  if (clause.length < 8) score -= 1;

  return score;
}

// ============================================================================
// EXTRACTION METHODS
// ============================================================================

function extractByStrongMarker(text) {
  const lower = text.toLowerCase();

  for (const marker of STRONG_MARKERS) {
    const idx = lower.lastIndexOf(marker);
    if (idx !== -1) {
      const outcome = normalize(text.slice(idx + marker.length));
      if (outcome.length > 5) {
        return {
          outcome,
          confidence: 0.9,
          method: "strong_marker"
        };
      }
    }
  }

  return null;
}

function extractByArrow(text) {
  const matches = [...text.matchAll(ARROW_REGEX)];
  if (matches.length < 1) return null;

  const last = matches[matches.length - 1];
  const outcome = normalize(text.slice(last.index + last[0].length));

  if (outcome.length > 5) {
    return {
      outcome,
      confidence: matches.length >= 2 ? 0.85 : 0.7,
      method: "arrow"
    };
  }

  return null;
}

function extractByClauseScoring(text) {
  const clauses = splitClauses(text);
  if (!clauses.length) return null;

  let best = null;
  let bestScore = -Infinity;

  for (const clause of clauses) {
    const score = scoreClause(clause);
    if (score > bestScore) {
      bestScore = score;
      best = clause;
    }
  }

  if (best && bestScore > 0) {
    return {
      outcome: normalize(best),
      confidence: 0.6,
      method: "scored_clause"
    };
  }

  return null;
}

// ============================================================================
// MAIN EXPORT
// ============================================================================

export function extractOutcome(text, providedClause = null) {
  if (!text || typeof text !== "string") {
    return buildResult(null, 0.1, "invalid_input");
  }

  const scope = providedClause || text;

  // --- METHOD 1: STRONG MARKERS ---
  const strong = extractByStrongMarker(scope);
  if (strong) return finalize(strong);

  // --- METHOD 2: ARROW FORMAT ---
  const arrow = extractByArrow(scope);
  if (arrow) return finalize(arrow);

  // --- METHOD 3: CLAUSE SCORING ---
  const scored = extractByClauseScoring(scope);
  if (scored) return finalize(scored);

  // --- FALLBACK ---
  return buildResult(null, 0.2, "fallback");
}

// ============================================================================
// FINALIZATION
// ============================================================================

function finalize(extraction) {
  const { outcome, confidence, method } = extraction;

  const obs = outcome ? getObservabilityResult(outcome) : {
    tier: "unknown",
    method: "none",
    confidence: 0.3,
    matched_verb: null
  };

  const finalConfidence = calculateFinalConfidence(confidence, obs);

  return {
    outcome,
    confidence: finalConfidence,
    observable: obs.tier !== "unknown",

    _meta: {
      method,
      extraction_confidence: confidence,
      observability: obs
    },

    // backward compatibility
    _observability: {
      tier: obs.tier,
      method: obs.method,
      confidence: obs.confidence,
      matched_verb: obs.matched_verb
    }
  };
}

function buildResult(outcome, confidence, method) {
  const obs = {
    tier: "unknown",
    method: "fallback",
    confidence: 0.3,
    matched_verb: null
  };

  return {
    outcome,
    confidence,
    observable: false,

    _meta: {
      method,
      extraction_confidence: confidence,
      observability: obs
    },

    // backward compatibility
    _observability: {
      tier: obs.tier,
      method: obs.method,
      confidence: obs.confidence,
      matched_verb: obs.matched_verb
    }
  };
}