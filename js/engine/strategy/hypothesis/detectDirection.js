// js/engine/strategy/hypothesis/detectDirection.js
// HARDENED: Dual-format, synonym-rich, negation-aware direction detection
// Returns: { direction: "decrease" | "increase" | null, confidence: 0.0-1.0 }

// ============================================================================
// DIRECTION KEYWORDS (comprehensive synonym lists)
// ============================================================================

const DECREASE = [
  // Core verbs
  "decrease", "reduce", "undermine", "weaken", "lower",
  // Erosion metaphors
  "erode", "diminish", "destabilize", "invalidate", "undercut",
  "compromise", "shake", "doubt", "corrode", "subvert",
  // Decline/fall metaphors
  "drop", "decline", "fall", "deteriorate", "plummet", "slump", "sink", "dip",
  // Weakening metaphors
  "dilute", "attenuate", "debilitate", "impair", "sap", "drain",
  // Destruction metaphors (strong decrease)
  "destroy", "shatter", "break", "crush", "demolish", "annihilate"
];

const INCREASE = [
  // Core verbs
  "increase", "reinforce", "strengthen", "raise", "boost",
  // Amplification metaphors
  "amplify", "solidify", "confirm", "validate", "entrench",
  "cement", "fortify", "affirm", "escalate", "intensify",
  // Growth metaphors
  "rise", "grow", "climb", "surge", "soar", "expand", "build",
  // Strengthening metaphors
  "enhance", "augment", "magnify", "elevate", "uplift", "bolster",
  // Creation metaphors (strong increase)
  "establish", "found", "create", "generate", "produce", "forge"
];

// ============================================================================
// PATTERN MATCHERS (format-specific detection)
// ============================================================================

// Arrow-format state transitions: "from high to low", "stable -> questioned"
const ARROW_DECREASE_PATTERNS = [
  /\bfrom\s+(high|stable|strong|certain|trusted|firm|secure)\s+to\s+(low|questioned|undermined|weak|doubt|fragile|uncertain|shaky|insecure)\b/i,
  /\bfrom\s+(moderate|medium|neutral)\s+to\s+(low|questioned|undermined|weak|doubt)\b/i,
  /\b(high|stable|strong)\s*->\s*(low|questioned|undermined|weak|doubt)\b/i,
  /\b(stable|certain)\s+becomes\s+(unstable|uncertain|questioned)\b/i
];

const ARROW_INCREASE_PATTERNS = [
  /\bfrom\s+(low|questioned|weak|doubt|fragile)\s+to\s+(high|stable|strong|certain|trusted|firm|secure)\b/i,
  /\bfrom\s+(low|questioned)\s+to\s+(moderate|medium|neutral)\b/i,
  /\b(low|questioned|weak)\s*->\s*(high|stable|strong|certain)\b/i,
  /\b(uncertain|shaky)\s+becomes\s+(stable|certain|firm)\b/i
];

// "to <verb>" patterns: "cause X to drop", "lead Y to rise"
const TO_VERB_DECREASE = /\bto\s+(drop|decline|fall|deteriorate|plummet|slump|sink|dip|weaken|erode|diminish|undermine|reduce|decrease)\b/i;
const TO_VERB_INCREASE = /\bto\s+(rise|grow|climb|surge|soar|escalate|expand|build|strengthen|reinforce|increase|boost|amplify)\b/i;

// Explicit future-tense markers (highest confidence)
const WILL_DECREASE = /\bwill\s+(decrease|reduce|undermine|weaken|lower|erode|diminish|destabilize|drop|decline|fall)\b/i;
const WILL_INCREASE = /\bwill\s+(increase|reinforce|strengthen|raise|boost|amplify|solidify|confirm|validate|rise|grow|climb)\b/i;

// Negation patterns that flip direction
const NEGATION_PATTERNS = [
  /\bnot\s+(?:decrease|reduce|undermine|weaken|lower|erode|diminish|destabilize|drop|decline|fall|increase|reinforce|strengthen|raise|boost|amplify)\b/i,
  /\bnever\s+(?:decrease|reduce|undermine|weaken|increase|reinforce|strengthen)\b/i,
  /\bfails?\s+to\s+(?:decrease|reduce|undermine|increase|reinforce|strengthen)\b/i,
  /\bwithout\s+(?:decreasing|reducing|undermining|increasing|reinforcing|strengthening)\b/i,
  /\bcannot\s+(?:decrease|undermine|increase|reinforce)\b/i,
  /\bunlikely\s+to\s+(?:decrease|increase)\b/i
];

// ============================================================================
// MAIN EXPORT
// ============================================================================

export function detectDirection(text, beliefClause = null) {
  // Defensive: handle null/undefined input
  if (!text || typeof text !== "string") {
    return { direction: null, confidence: 0.0 };
  }

  // Scope detection to belief clause if provided (more precise)
  const scope = beliefClause && typeof beliefClause === "string"
    ? beliefClause.toLowerCase()
    : text.toLowerCase();

  // --------------------------------------------------------------------------
  // PRIORITY 1: Explicit future-tense markers (highest confidence)
  // --------------------------------------------------------------------------
  if (WILL_DECREASE.test(scope)) {
    return { direction: "decrease", confidence: 0.95 };
  }
  if (WILL_INCREASE.test(scope)) {
    return { direction: "increase", confidence: 0.95 };
  }

  // --------------------------------------------------------------------------
  // PRIORITY 2: Arrow-format state transitions (high confidence)
  // --------------------------------------------------------------------------
  const isArrowDecrease = ARROW_DECREASE_PATTERNS.some(p => p.test(text));
  const isArrowIncrease = ARROW_INCREASE_PATTERNS.some(p => p.test(text));

  if (isArrowDecrease && !isArrowIncrease) {
    return { direction: "decrease", confidence: 0.9 };
  }
  if (isArrowIncrease && !isArrowDecrease) {
    return { direction: "increase", confidence: 0.9 };
  }

  // --------------------------------------------------------------------------
  // PRIORITY 3: "to <verb>" patterns (medium-high confidence)
  // --------------------------------------------------------------------------
  if (TO_VERB_DECREASE.test(scope) && !TO_VERB_INCREASE.test(scope)) {
    return { direction: "decrease", confidence: 0.85 };
  }
  if (TO_VERB_INCREASE.test(scope) && !TO_VERB_DECREASE.test(scope)) {
    return { direction: "increase", confidence: 0.85 };
  }

  // --------------------------------------------------------------------------
  // PRIORITY 4: Semantic keyword detection with negation handling
  // --------------------------------------------------------------------------
  const hasDecrease = DECREASE.some(w => scope.includes(w));
  const hasIncrease = INCREASE.some(w => scope.includes(w));
  const isNegated = NEGATION_PATTERNS.some(p => p.test(scope));

  // Single-direction signal (no conflict)
  if (hasDecrease && !hasIncrease) {
    return {
      direction: isNegated ? "increase" : "decrease",
      confidence: isNegated ? 0.7 : 0.85
    };
  }
  if (hasIncrease && !hasDecrease) {
    return {
      direction: isNegated ? "decrease" : "increase",
      confidence: isNegated ? 0.7 : 0.85
    };
  }

  // --------------------------------------------------------------------------
  // PRIORITY 5: Conflicting signals (both decrease AND increase keywords)
  // --------------------------------------------------------------------------
  if (hasDecrease && hasIncrease) {
    // Try to resolve by order of appearance (later signal wins)
    const decreaseIdx = DECREASE.map(w => scope.indexOf(w)).filter(i => i >= 0);
    const increaseIdx = INCREASE.map(w => scope.indexOf(w)).filter(i => i >= 0);
    
    const lastDecrease = Math.max(...decreaseIdx);
    const lastIncrease = Math.max(...increaseIdx);
    
    if (lastDecrease > lastIncrease) {
      return { direction: isNegated ? "increase" : "decrease", confidence: 0.5 };
    } else if (lastIncrease > lastDecrease) {
      return { direction: isNegated ? "decrease" : "increase", confidence: 0.5 };
    }
    // Truly ambiguous
    return { direction: null, confidence: 0.2 };
  }

  // --------------------------------------------------------------------------
  // FALLBACK: No signal detected
  // --------------------------------------------------------------------------
  return { direction: null, confidence: 0.3 };
}