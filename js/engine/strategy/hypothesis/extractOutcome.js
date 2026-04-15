// js/engine/strategy/hypothesis/extractOutcome.js
// HARDENED: Dual-format extraction with Unicode arrow support + observability integration
// 
// RESPONSIBILITY: Extract outcome TEXT from hypothesis string (parsing logic)
// DELEGATES: Observability classification to ./observability.js (domain logic)

// ============================================================================
// IMPORTS
// ============================================================================
import { getObservabilityResult, calculateFinalConfidence } from "./observability.js";

// ============================================================================
// CONFIGURATION: OUTCOME MARKERS (for TEXT EXTRACTION only)
// These locate WHERE the outcome clause is — not what verbs it contains
// ============================================================================

const OUTCOME_MARKERS = [
  // --- Original core ---
  "leading to", "causing", "resulting in", "thereby", 
  "prompting", "triggering", "eliciting", "which causes", "that leads to",
  
  // --- Direct causation (LLM loves these) ---
  "producing", "generating", "yielding", "bringing about", "giving rise to",
  "setting off", "sparking", "igniting", "precipitating", "culminating in",
  
  // --- Consequence markers (formal/academic) ---
  "with the result that", "so that", "such that", "to the point that",
  "to the extent that", "entailing", "implying", "necessitating",
  
  // --- Temporal/causal blends ---
  "eventually", "consequently", "as a result", "in turn", "thereupon",
  "hence", "thus", "accordingly", "subsequently", "following this",
  
  // --- Informal/narrative ---
  "making", "having", "getting", "ending up", "winding up",
  "and so", "and thus", "and therefore", "then",
  
  // --- Conditional outcome ---
  "which will", "that will", "which then", "that then",
  "leading them to", "causing them to", "prompting them to"
];

// Supports BOTH ASCII "->" AND Unicode "→" (U+2192)
// Used for arrow-format outcome extraction
const ARROW_REGEX = /(?:->|→)\s*/gi;
const EXPLICIT_LABEL_REGEX = /observable\s+outcome:\s*/i;

// ============================================================================
// HELPER: Normalize extracted outcome text (remove noise, standardize)
// ============================================================================
function normalizeOutcome(text) {
  if (!text) return "";
  
  let normalized = text.trim();
  
  // Remove leading pronouns + infinitives
  normalized = normalized.replace(/^(him|her|them|it|they)\s+/i, "");
  normalized = normalized.replace(/^to\s+/i, "");
  
  // Remove subordinate clauses that aren't the core outcome
  normalized = normalized.replace(/[,;]\s*which\s+.*$/i, "");
  normalized = normalized.replace(/[,;]\s*that\s+.*$/i, "");
  
  // Trim trailing punctuation
  normalized = normalized.replace(/[.,!?]+$/, "");
  
  return normalized.trim();
}

// ============================================================================
// MAIN EXPORT: extractOutcome()
// Returns: { outcome, confidence, observable, _observability }
// ============================================================================

export function extractOutcome(text, outcomeClause = null) {
  // Defensive: handle null/undefined/empty input
  if (!text || typeof text !== "string" || !text.trim()) {
    return {
      outcome: null,
      confidence: 0.1,
      observable: false,
      _observability: {
        tier: "unknown",
        method: "fallback",
        confidence: 0.3,
        matched_verb: null
      }
    };
  }

  const scope = outcomeClause && typeof outcomeClause === "string" 
    ? outcomeClause 
    : text;
  const lower = scope.toLowerCase();

  // --------------------------------------------------------------------------
  // FORMAT 1: Natural-language causal markers (original format)
  // --------------------------------------------------------------------------
  for (const marker of OUTCOME_MARKERS) {
    const idx = lower.indexOf(marker);
    if (idx !== -1) {
      const rawOutcome = scope.slice(idx + marker.length);
      const outcome = normalizeOutcome(rawOutcome);
      
      // Delegate observability classification to dedicated module
      const obsResult = getObservabilityResult(outcome);
      const baseConfidence = 0.9; // High confidence: explicit marker found
      const finalConfidence = calculateFinalConfidence(baseConfidence, obsResult);
      
      return {
        outcome,
        confidence: finalConfidence,
        observable: obsResult.tier !== "unknown",  // backward-compat boolean
        
        // Internal metadata (forward-compatible, not used by legacy code)
        _observability: {
          tier: obsResult.tier,
          method: obsResult.method,
          confidence: obsResult.confidence,
          matched_verb: obsResult.matched_verb
        }
      };
    }
  }

  // --------------------------------------------------------------------------
  // FORMAT 2: Arrow-based extraction (supports Unicode → AND ASCII ->)
  // --------------------------------------------------------------------------
  
  // First, check for explicit "Observable outcome:" label (highest confidence)
  const explicitLabelMatch = scope.match(EXPLICIT_LABEL_REGEX);
  if (explicitLabelMatch) {
    const rawOutcome = scope.slice(explicitLabelMatch.index + explicitLabelMatch[0].length);
    const outcome = normalizeOutcome(rawOutcome);
    
    const obsResult = getObservabilityResult(outcome);
    const baseConfidence = 0.9; // High confidence: explicit label found
    const finalConfidence = calculateFinalConfidence(baseConfidence, obsResult);
    
    return {
      outcome,
      confidence: finalConfidence,
      observable: obsResult.tier !== "unknown",
      
      _observability: {
        tier: obsResult.tier,
        method: obsResult.method,
        confidence: obsResult.confidence,
        matched_verb: obsResult.matched_verb
      }
    };
  }
  
  // Otherwise, look for arrow chains and use the LAST arrow (outcome follows final arrow)
  const arrowMatches = [...scope.matchAll(ARROW_REGEX)];
  
  if (arrowMatches.length >= 2) {
    // Use the LAST arrow — in 3-part format: Stimulus → BeliefChange → Outcome
    const lastArrow = arrowMatches[arrowMatches.length - 1];
    let rawOutcome = scope.slice(lastArrow.index + lastArrow[0].length);
    
    // Clean up: remove trailing punctuation and incomplete fragments
    let outcome = normalizeOutcome(rawOutcome);
    
    // If outcome is too short, fallback to second-to-last arrow
    if (outcome.length < 5 && arrowMatches.length >= 3) {
      const secondLastArrow = arrowMatches[arrowMatches.length - 2];
      rawOutcome = scope.slice(secondLastArrow.index + secondLastArrow[0].length);
      outcome = normalizeOutcome(rawOutcome);
    }
    
    const obsResult = getObservabilityResult(outcome);
    const baseConfidence = 0.85; // Medium-high: arrow format, multi-part structure
    const finalConfidence = calculateFinalConfidence(baseConfidence, obsResult);
    
    return {
      outcome,
      confidence: finalConfidence,
      observable: obsResult.tier !== "unknown",
      
      _observability: {
        tier: obsResult.tier,
        method: obsResult.method,
        confidence: obsResult.confidence,
        matched_verb: obsResult.matched_verb
      }
    };
  }
  
  // Single arrow fallback (less confident — might be belief change, not outcome)
  if (arrowMatches.length === 1) {
    const arrowMatch = arrowMatches[0];
    const rawOutcome = scope.slice(arrowMatch.index + arrowMatch[0].length);
    const outcome = normalizeOutcome(rawOutcome);
    
    const obsResult = getObservabilityResult(outcome);
    const baseConfidence = 0.7; // Medium: single arrow, ambiguous structure
    const finalConfidence = calculateFinalConfidence(baseConfidence, obsResult);
    
    return {
      outcome,
      confidence: finalConfidence,
      observable: obsResult.tier !== "unknown",
      
      _observability: {
        tier: obsResult.tier,
        method: obsResult.method,
        confidence: obsResult.confidence,
        matched_verb: obsResult.matched_verb
      }
    };
  }

  // --------------------------------------------------------------------------
  // FALLBACK: Last-clause heuristic (lowest confidence)
  // --------------------------------------------------------------------------
  const parts = scope.split(",").map(p => p.trim()).filter(p => p.length > 0);
  if (parts.length > 1) {
    const fallback = parts[parts.length - 1];
    const outcome = normalizeOutcome(fallback);
    
    const obsResult = getObservabilityResult(outcome);
    const baseConfidence = 0.4; // Low: comma-split heuristic
    const finalConfidence = calculateFinalConfidence(baseConfidence, obsResult);
    
    return {
      outcome,
      confidence: finalConfidence,
      observable: obsResult.tier !== "unknown",
      
      _observability: {
        tier: obsResult.tier,
        method: obsResult.method,
        confidence: obsResult.confidence,
        matched_verb: obsResult.matched_verb
      }
    };
  }

  // --------------------------------------------------------------------------
  // TOTAL FALLBACK: No outcome detected
  // --------------------------------------------------------------------------
  return {
    outcome: null,
    confidence: 0.2,
    observable: false,
    
    _observability: {
      tier: "unknown",
      method: "fallback",
      confidence: 0.3,
      matched_verb: null
    }
  };
}