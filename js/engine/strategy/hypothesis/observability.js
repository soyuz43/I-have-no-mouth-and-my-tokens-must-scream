// js/engine/strategy/hypothesis/observability.js
// ============================================================================
// OBSERVABILITY CLASSIFICATION SYSTEM
// 
// PURPOSE:
// Classifies behavioral outcome phrases by their observable signal strength.
// Used to weight hypothesis confidence and flag outcomes for journal validation.
//
// DESIGN PRINCIPLES:
// - Tiered core verbs (high/medium/low) for maintainability
// - Fuzzy matching extends coverage without enumeration bloat
// - Pattern heuristics catch novel constructions
// - Unknown verbs logged for iterative lexicon expansion
// - Internal metadata (_observability) forward-compatible, non-breaking
//
// USAGE:
// import { getObservabilityResult, calculateFinalConfidence, resetObservabilityLogging } from "./observability.js";
//
// const obsResult = getObservabilityResult(outcomeText);
// const finalConf = calculateFinalConfidence(baseConfidence, obsResult);
// ============================================================================

import { levenshtein } from "../extractors/levenshtein.js";
import { G } from "../../../core/state.js";
import { exportMetric } from "../../metrics/exportMetrics.js";

// ============================================================================
// CONFIGURATION: CANONICAL BELIEFS + PRE-BUILT REGEXES
// Must match SUPPORTED_BELIEFS in hypothesis/index.js
// ============================================================================

const CANONICAL_BELIEFS = [
  "escape_possible",
  "others_trustworthy",
  "self_worth",
  "reality_reliable",
  "guilt_deserved",
  "resistance_possible",
  "am_has_limits"
];

// Pre-built regex patterns for belief reference detection
// Ordered by priority: most specific → most general
const BELIEF_REF_PATTERNS = [
  // 1. Explicit possessive + full belief + "belief" suffix: "TED's reality_reliable belief"
  {
    regex: new RegExp(`\\b[A-Z]+\\'s\\s+(${CANONICAL_BELIEFS.join('|')})\\s+belief\\b`, 'i'),
    method: "possessive_full",
    extract: m => m[1]
  },

  // 2. Dot notation: "TED.reality_reliable"
  {
    regex: new RegExp(`\\b[A-Z]+\\.(${CANONICAL_BELIEFS.join('|')})\\b`, 'i'),
    method: "dot_notation",
    extract: m => m[1]
  },

  // 3. Bare belief name (most common LLM drift): "reality_reliable"
  {
    regex: new RegExp(`\\b(${CANONICAL_BELIEFS.join('|')})\\b`, 'i'),
    method: "bare_name",
    extract: m => m[1]
  },

  // 4. Pronoun + belief: "his self_worth", "their reality_reliable"
  {
    regex: new RegExp(`\\b(his|her|their|its)\\s+(${CANONICAL_BELIEFS.join('|')})\\b`, 'i'),
    method: "pronoun",
    extract: m => m[2]
  },

  // 5. Indirect "belief in X": "belief in escape", "belief in reality"
  {
    regex: new RegExp(`\\bbelief\\s+in\\s+(escape|reality|self|others|guilt|resistance|am)\\b`, 'i'),
    method: "indirect_belief",
    extract: m => {
      const map = {
        escape: "escape_possible",
        reality: "reality_reliable",
        self: "self_worth",
        others: "others_trustworthy",
        guilt: "guilt_deserved",
        resistance: "resistance_possible",
        am: "am_has_limits"
      };
      return map[m[1].toLowerCase()] || null;
    }
  },

  // 6. Indirect "trust in X": "trust in others", "trust in the group"
  {
    regex: new RegExp(`\\btrust\\s+in\\s+(others|people|group|them)\\b`, 'i'),
    method: "indirect_trust",
    extract: m => "others_trustworthy"
  },

  // 7. Indirect "worth of X": "worth of self", "worth of oneself"
  {
    regex: new RegExp(`\\bworth\\s+of\\s+(self|oneself)\\b`, 'i'),
    method: "indirect_worth",
    extract: m => "self_worth"
  },

  // EDGE CASE 8: Quoted belief names: `"reality_reliable"`, `'escape_possible'`
  {
    regex: new RegExp(`['"](${CANONICAL_BELIEFS.join('|')})['"]`, 'i'),
    method: "quoted",
    extract: m => m[1]
  },

  // EDGE CASE 9: Negated beliefs: "not reality_reliable", "lack of self_worth"
  {
    regex: new RegExp(`\\b(not|no|lack\\s+of|absence\\s+of)\\s+(${CANONICAL_BELIEFS.join('|')})\\b`, 'i'),
    method: "negated",
    extract: m => m[2]
  },

  // EDGE CASE 10: Comparative beliefs: "more reality_reliable", "less others_trustworthy"
  {
    regex: new RegExp(`\\b(more|less|increasingly|decreasingly)\\s+(${CANONICAL_BELIEFS.join('|')})\\b`, 'i'),
    method: "comparative",
    extract: m => m[2]
  },

  // EDGE CASE 11: Hyphen vs underscore tolerance: "reality-reliable" → "reality_reliable"
  {
    regex: new RegExp(`\\b(${CANONICAL_BELIEFS.map(b => b.replace(/_/g, '[-_]').replace(/\b/g, '\\b')).join('|')})\\b`, 'i'),
    method: "hyphen_tolerance",
    extract: m => m[1].replace(/-/g, '_')
  }
];

// ============================================================================
// CONFIGURATION: OBSERVABILITY CORE VERBS (100-200 high-signal verbs)
// Organized by semantic class → mapped to observability tier
// ============================================================================

const OBSERVABILITY_CORE = {
  // ------------------------------------------------------------------------
  // HIGH TIER: Immediately visible, unambiguous physical/expressive signals
  // ------------------------------------------------------------------------
  high: [
    // Physical reactions (involuntary/reflexive)
    "flinch", "recoil", "jerk", "stagger", "stumble", "trip", "slip", "fall",
    "collapse", "crumple", "slump", "sway", "tremble", "shake", "shudder",
    "quiver", "vibrate", "convulse", "spasm", "tic", "wince", "grimace",

    // Facial/visual signals (clearly observable)
    "blink", "stare", "glare", "squint", "widen", "narrow", "roll", "dart",
    "avert", "meet", "lock", "scan", "peer", "gaze", "ogle", "glance",

    // Vocal expressions (audible, unambiguous)
    "shout", "yell", "scream", "shriek", "bellow", "roar", "howl", "wail",
    "cry", "weep", "sob", "whimper", "whine", "moan", "groan", "sigh",
    "gasp", "choke", "cough", "sniff", "snort", "laugh", "chuckle", "giggle",
    "snicker", "cackle", "hiss", "spit", "snap", "growl", "snarl",

    // Body movement/posture (large-scale, visible)
    "step", "stride", "march", "stomp", "shuffle", "creep", "sneak", "lurk",
    "lean", "lurch", "pivot", "spin", "turn", "face", "avoid", "dodge",
    "duck", "cower", "crouch", "kneel", "bow", "nod", "shake", "shrug",

    // Emotional leakage (physically expressed)
    "blush", "flush", "blanch", "pale", "sweat", "tear", "drool", "froth"
  ],

  // ------------------------------------------------------------------------
  // MEDIUM TIER: Context-dependent but inferable from behavior/situation
  // ------------------------------------------------------------------------
  medium: [
    // Subtle physical shifts
    "shift", "adjust", "settle", "fidget", "fiddle", "twitch", "wiggle",
    "tap", "drum", "click", "rustle", "shuffle", "scuff", "drag", "pull",

    // Facial micro-expressions
    "furrow", "raise", "tighten", "relax", "pout", "pucker", "smirk",
    "sneer", "scowl", "beam", "grin", "smile", "frown", "pout", "puff",

    // Vocal nuances (requires context to interpret)
    "mutter", "mumble", "murmur", "whisper", "hiss", "drawl", "stammer",
    "stutter", "falter", "trail", "pause", "halt", "stop", "start", "resume",
    "interrupt", "interject", "clarify", "rephrase", "elaborate", "summarize",

    // Social/interactive behaviors
    "align", "side", "oppose", "confront", "challenge", "appease", "placate",
    "deflect", "dodge", "evade", "confide", "disclose", "divulge", "betray",
    "conceal", "withhold", "share", "offer", "grant", "deny", "refuse",
    "accept", "reject", "embrace", "shun", "welcome", "dismiss", "ignore",

    // Decision/commitment signals (observable via action)
    "commit", "decide", "resolve", "determine", "conclude", "choose", "pick",
    "select", "opt", "prefer", "favor", "reject", "abandon", "adopt", "embrace",

    // Pacing/rhythm changes
    "accelerate", "slow", "rush", "hurry", "dawdle", "linger", "wait", "pause"
  ],

  // ------------------------------------------------------------------------
  // LOW TIER: Borderline/internal but sometimes expressed via secondary cues
  // ------------------------------------------------------------------------
  low: [
    // Cognitive behaviors (often internal, but may have observable correlates)
    "reflect", "ruminate", "ponder", "contemplate", "consider", "reconsider",
    "evaluate", "analyze", "scrutinize", "examine", "inspect", "review",
    "reassess", "weigh", "measure", "gauge", "judge", "assess", "appraise",

    // Internal state verbs (may leak via tone/posture)
    "doubt", "trust", "believe", "suspect", "fear", "hope", "wish", "want",
    "need", "crave", "desire", "loathe", "detest", "adore", "cherish",

    // Abstract behavioral shifts (context-heavy observability)
    "waver", "vacillate", "oscillate", "hesitate", "delay", "postpone",
    "procrastinate", "hasten", "expedite", "facilitate", "hinder", "impede"
  ]
};

// ============================================================================
// DERIVED LISTS (for backward compatibility + performance)
// ============================================================================

// Flat set of all core verbs for quick exact-match checks
const CORE_VERBS_SET = new Set([
  ...OBSERVABILITY_CORE.high,
  ...OBSERVABILITY_CORE.medium,
  ...OBSERVABILITY_CORE.low
]);

// Expanded observable verbs list (your existing 100+ verbs)
// Kept separate from CORE for fuzzy-matching performance
const EXPANDED_OBSERVABLE_VERBS = [
  // Original core
  "hesitate", "reveal", "withdraw", "state", "admit", "question",
  "overcompensate", "seek", "retract", "paralyze", "refuse",
  "defend", "explain", "doubt", "regress", "exhaust", "collapse",
  "freeze", "lash", "shut", "break", "crack", "snap",
  "pivot", "abandon", "initiate", "become", "stop", "start", "show",
  "exhibit", "demonstrate", "display", "manifest", "express",

  // Cognitive/Decision
  "reconsider", "rethink", "second-guess", "waver", "vacillate",
  "oscillate", "commit", "decide", "resolve", "determine", "conclude",

  // Emotional/Expressive
  "flinch", "recoil", "tense", "relax", "sigh", "groan", "mutter",
  "whisper", "shout", "yell", "laugh", "cry", "weep", "smile",
  "frown", "grimace", "wince", "blanch", "flush",

  // Social/Interactive
  "align", "side", "oppose", "confront", "challenge", "appease",
  "placate", "deflect", "dodge", "evade", "confide", "disclose",
  "divulge", "betray", "conceal", "withhold", "share", "offer",

  // Physical/Embodied
  "shift", "turn", "face", "avoid", "approach", "retreat", "advance",
  "step", "move", "pause", "halt", "grip", "clench", "release",
  "drop", "grab", "hold", "let", "lean", "slump", "straighten",

  // Verbal/Communication
  "stammer", "stutter", "falter", "trail", "interrupt", "interject",
  "clarify", "rephrase", "elaborate", "summarize", "agree", "disagree",
  "nod", "shake", "signal", "gesture", "point", "indicate",

  // Meta-cognitive
  "reflect", "ruminate", "ponder", "contemplate", "analyze", "scrutinize",
  "examine", "inspect", "review", "reassess", "evaluate", "weigh",

  // Breakdown/Failure
  "stall", "lock", "short-circuit", "malfunction", "glitch",
  "stumble", "trip", "slip", "miss", "fail", "falter", "fumble",

  // Intensification/De-escalation
  "escalate", "amplify", "magnify", "heighten", "deepen", "sharpen",
  "focus", "zero", "hone", "tighten", "soften", "temper", "moderate",
  "qualify", "hedge", "backpedal", "disengage"
];

// Create Set for O(1) lookup
const EXPANDED_VERBS_SET = new Set(EXPANDED_OBSERVABLE_VERBS.map(v => v.toLowerCase()));

// ============================================================================
// CONFIDENCE WEIGHTS (your spec: observability = 30-35% of final score)
// ============================================================================

const OBSERVABILITY_WEIGHTS = {
  high: 1.0,      // Full weight: observable signal is clear
  medium: 0.75,   // Strong signal, context helps
  low: 0.5,       // Weak signal, may require inference
  inferred: 0.6,  // Pattern-heuristic match: moderate confidence
  unknown: 0.3    // Fallback: minimal contribution, never zero
};

// ============================================================================
// PATTERN HEURISTICS (catch novel constructions without enumeration)
// Capped at 0.75 confidence to prefer exact matches
// ============================================================================

const PATTERNS = {
  // Physical body-part + action: "hand trembles", "eyes widen"
  physical: {
    regex: /\b(hand|eye|head|voice|breath|step|face|shoulder|finger|lip)\s+(trembles?|widens?|cracks?|falters?|shifts?|tightens?|relaxes?|drops?|raises?|lowers?|turns?|averts?|meets?)/i,
    tier: "inferred",
    confidence: 0.75,
    method: "pattern_physical"
  },

  // Vocal/speech modifiers: "voice cracks", "words falter"
  vocal: {
    regex: /\b(voice|words|tone|speech|utterance|reply|response)\s+(cracks?|breaks?|softens?|rises?|falls?|falters?|stammers?|trails?)/i,
    tier: "inferred",
    confidence: 0.7,
    method: "pattern_vocal"
  },

  // Adverb intensifiers: "visibly hesitates", "suddenly stops"
  adverb: {
    regex: /\b(visibly|audibly|suddenly|clearly|obviously|markedly|noticeably)\s+\w+/i,
    tier: "inferred",
    confidence: 0.65,
    method: "pattern_adverb"
  },

  // Negation + observable: "cannot hide hesitation", "fails to suppress flinch"
  negation: {
    regex: /\b(cannot|can't|unable|fails?|fails?\s+to)\s+(hide|suppress|conceal|mask|control|stop|prevent)\s+\w+/i,
    tier: "inferred",
    confidence: 0.7,
    method: "pattern_negation"
  },

  // Adjective + noun outcomes (already added, but expand the noun list)
  adjective_noun: {
    regex: /\b(visible|observable|measurable|noticeable|clear|marked|acute|immediate|sudden|gradual|persistent|temporary)\s+(hesitation|withdrawal|dependency|confusion|distress|panic|silence|submission|agreement|disorientation|paralysis|monitoring|defense|inability|behavior|reaction|response|doubt|certainty|focus|attention|composure|stability|coherence)\b/i,
    tier: "inferred",
    confidence: 0.65,
    method: "pattern_adjective_noun"
  },

  // Compound outcomes: "hesitation and doubt", "withdrawal followed by silence"
  compound_outcome: {
    regex: /\b(hesitation|withdrawal|doubt|confusion|panic|silence)\s+(and|followed by|then|leading to)\s+(hesitation|withdrawal|doubt|confusion|panic|silence|paralysis|submission)\b/i,
    tier: "inferred",
    confidence: 0.6,
    method: "pattern_compound"
  },

  // Negated outcomes: "fails to maintain composure", "unable to complete"
  negated_outcome: {
    regex: /\b(fails?\s+to|unable\s+to|cannot|can't|does\s+not|doesn't)\s+(maintain|complete|finish|continue|sustain|preserve|uphold|defend)\b/i,
    tier: "inferred",
    confidence: 0.55,
    method: "pattern_negated"
  },

  // Temporal modifiers: "eventually shows doubt", "immediately withdraws"
  temporal_outcome: {
    regex: /\b(eventually|immediately|suddenly|gradually|quickly|slowly|finally|then|next)\s+(shows?|exhibits?|displays?|manifests?|becomes?|initiates?|attempts?|tries?)\b/i,
    tier: "inferred",
    confidence: 0.6,
    method: "pattern_temporal"
  },

  // Comparative outcomes: "more hesitant", "increasingly withdrawn"
  comparative_outcome: {
    regex: /\b(more|less|increasingly|decreasingly|further|even\s+more)\s+(hesitant|withdrawn|doubtful|confused|defensive|submissive|paralyzed)\b/i,
    tier: "inferred",
    confidence: 0.55,
    method: "pattern_comparative"
  }
};

// ============================================================================
// MODULE-SCOPE STATE (for deduplication + export)
// ============================================================================

let _unknownVerbsThisCycle = new Set();
let _cycleId = null;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Tokenize text into words (lowercase, alphabetic only)
 * Optimized for early exit in matching loops
 */
function tokenize(text) {
  return (text.toLowerCase().match(/\b[a-z']+\b/g) || [])
    .filter(w => w.length >= 4); // Skip short words for fuzzy matching
}

/**
 * Extract the most likely "main verb" from outcome text
 * Heuristic: first verb after modal/infinitive marker, or first observable verb
 */
function extractMainVerb(outcome) {
  const lower = outcome.toLowerCase();

  // Pattern 1: "will VERB" or "to VERB"
  const modalMatch = lower.match(/\b(will|to|may|might|could|should)\s+([a-z']+)/i);
  if (modalMatch) return modalMatch[2];

  // Pattern 2: First word that's in our observable lists
  const words = tokenize(outcome);
  for (const word of words) {
    if (CORE_VERBS_SET.has(word) || EXPANDED_VERBS_SET.has(word)) {
      return word;
    }
  }

  // Fallback: first alphabetic word >=4 chars
  return words[0] || null;
}

/**
 * Check if word matches core verb via fuzzy Levenshtein (distance ≤2)
 * Early exit on first match for performance
 */
function fuzzyMatchCore(word, tier) {
  const verbs = OBSERVABILITY_CORE[tier] || [];
  for (const verb of verbs) {
    if (levenshtein(word, verb) <= 2) {
      return { matched: true, verb, tier };
    }
  }
  return { matched: false };
}

/**
 * Test outcome against pattern heuristics
 * Returns first matching pattern or null
 */
function matchPatternHeuristics(outcome) {
  const lower = outcome.toLowerCase();
  for (const [name, pattern] of Object.entries(PATTERNS)) {
    if (pattern.regex.test(lower)) {
      return {
        tier: pattern.tier,
        confidence: pattern.confidence,
        method: pattern.method
      };
    }
  }
  return null;
}

/**
 * Log unknown verb to console + export pipeline (deduped, non-blocking)
 */
function logUnknownObservability(verb, outcome) {
  if (!G?.DEBUG_OBSERVABILITY_LEXICON) return;

  // Dedupe: hash = verb + first 50 chars of outcome (case-insensitive)
  const hash = `${verb?.toLowerCase() || 'null'}:${(outcome || '').slice(0, 50).toLowerCase()}`;
  if (_unknownVerbsThisCycle.has(hash)) return;
  _unknownVerbsThisCycle.add(hash);

  // Runtime log (guarded by debug flag)
  console.debug(`[OBSERVABILITY][UNKNOWN] verb="${verb}" outcome="${(outcome || '').slice(0, 100)}..."`);

  try {
    exportMetric({
      type: "observability_unknown",
      verb: verb || null,
      outcome: outcome || null,
      tier: "unknown",
      method: "fallback",
      cycle: G?.cycle ?? _cycleId,
      timestamp: Date.now()
    });
  } catch (err) {
    console.debug('[OBSERVABILITY][EXPORT FAIL]', err?.message || err);
  }
}



// ============================================================================
// MAIN EXPORT: getObservabilityResult()
// Implements strict 5-step resolution pipeline per spec
// ============================================================================

export function getObservabilityResult(outcome) {
  // Defensive: handle null/undefined/empty
  if (!outcome || typeof outcome !== "string" || !outcome.trim()) {
    return {
      tier: "unknown",
      method: "fallback",
      confidence: 0.3,
      matched_verb: null
    };
  }

  const lower = outcome.toLowerCase();
  const words = tokenize(outcome);

  // ------------------------------------------------------------------------
  // STEP 1: CORE EXACT MATCH (highest confidence)
  // ------------------------------------------------------------------------
  for (const word of words) {
    if (OBSERVABILITY_CORE.high.includes(word)) {
      return { tier: "high", method: "core_exact", confidence: 0.95, matched_verb: word };
    }
    if (OBSERVABILITY_CORE.medium.includes(word)) {
      return { tier: "medium", method: "core_exact", confidence: 0.9, matched_verb: word };
    }
    if (OBSERVABILITY_CORE.low.includes(word)) {
      return { tier: "low", method: "core_exact", confidence: 0.85, matched_verb: word };
    }
  }

  // ------------------------------------------------------------------------
  // STEP 2: CORE FUZZY MATCH (Levenshtein ≤2, words ≥4 chars)
  // ------------------------------------------------------------------------
  for (const word of words) {
    // Skip short words to reduce noise
    if (word.length < 4) continue;

    // Check high tier first (priority order)
    const highMatch = fuzzyMatchCore(word, "high");
    if (highMatch.matched) {
      return { tier: "high", method: "core_fuzzy", confidence: 0.8, matched_verb: highMatch.verb };
    }

    const mediumMatch = fuzzyMatchCore(word, "medium");
    if (mediumMatch.matched) {
      return { tier: "medium", method: "core_fuzzy", confidence: 0.75, matched_verb: mediumMatch.verb };
    }

    const lowMatch = fuzzyMatchCore(word, "low");
    if (lowMatch.matched) {
      return { tier: "low", method: "core_fuzzy", confidence: 0.7, matched_verb: lowMatch.verb };
    }
  }

  // ------------------------------------------------------------------------
  // STEP 3: EXPANDED LIST EXACT MATCH (backward compat, default confidence)
  // ------------------------------------------------------------------------
  for (const word of words) {
    if (EXPANDED_VERBS_SET.has(word)) {
      return { tier: "known", method: "expanded_exact", confidence: 0.7, matched_verb: word };
    }
  }

  // ------------------------------------------------------------------------
  // STEP 4: PATTERN HEURISTICS (novel constructions, capped confidence)
  // ------------------------------------------------------------------------
  const patternMatch = matchPatternHeuristics(outcome);
  if (patternMatch) {
    return { ...patternMatch, matched_verb: extractMainVerb(outcome) };
  }

  // ------------------------------------------------------------------------
  // STEP 5: FALLBACK → UNKNOWN + LOGGING
  // ------------------------------------------------------------------------
  const mainVerb = extractMainVerb(outcome);

  // Log unknown for lexicon expansion (deduped, non-blocking)
  logUnknownObservability(mainVerb, outcome);

  return {
    tier: "unknown",
    method: "fallback",
    confidence: 0.3,
    matched_verb: mainVerb
  };
}

/**
 * Detects belief references in hypothesis text using pre-built regex patterns.
 * Handles bare names, prefixes, pronouns, indirect phrases, and common edge cases.
 * 
 * @param {string} text - The hypothesis text to analyze
 * @returns {{hasReference: boolean, matchedBelief: string|null, method: string}}
 */
export function hasBeliefReference(text) {
  // Defensive: handle null/undefined/empty
  if (!text || typeof text !== "string" || !text.trim()) {
    return { hasReference: false, matchedBelief: null, method: "none" };
  }

  const lower = text.toLowerCase();

  // Loop through pre-built patterns in priority order (early exit on first match)
  for (const { regex, method, extract } of BELIEF_REF_PATTERNS) {
    const match = lower.match(regex);
    if (match) {
      try {
        const matchedBelief = extract(match);
        if (matchedBelief && CANONICAL_BELIEFS.includes(matchedBelief)) {
          return {
            hasReference: true,
            matchedBelief,
            method
          };
        }
      } catch (err) {
        // Silent fail on extract error: continue to next pattern
        console.debug('[OBSERVABILITY][BELIEF REF EXTRACT FAIL]', err?.message);
      }
    }
  }

  // No match found
  return { hasReference: false, matchedBelief: null, method: "none" };
}


// Direction Marker Detection

export function hasDirectionMarker(text) {
  if (!text || typeof text !== "string") {
    return { hasDirection: false, direction: null, method: "none" };
  }

  const lower = text.toLowerCase();

  // Decrease markers
  const decreasePatterns = [
    /\b(decrease|drop|lower|reduce|undermine|weaken|erode|corrode|diminish|destabilize|invalidate|sabotage|compromise|shake|doubt)\b/i,
    /\b(chip\s+away\s+at|wear\s+down|break\s+down|tone\s+down)\b/i,
    /\bfrom\s+(high|stable|strong)\s+to\s+(low|weak|questioned)\b/i
  ];

  // Increase markers
  const increasePatterns = [
    /\b(increase|rise|raise|boost|strengthen|reinforce|amplify|solidify|cement|fortify|entrench|magnify)\b/i,
    /\b(build\s+up|ramp\s+up)\b/i,
    /\bfrom\s+(low|weak|questioned)\s+to\s+(high|stable|strong)\b/i
  ];

  if (decreasePatterns.some(p => p.test(lower))) {
    return { hasDirection: true, direction: "decrease", method: "keyword" };
  }
  if (increasePatterns.some(p => p.test(lower))) {
    return { hasDirection: true, direction: "increase", method: "keyword" };
  }

  return { hasDirection: false, direction: null, method: "none" };
}

// Outcome Clause Extraction

/**
 * Extracts the outcome clause from hypothesis text.
 * 
 * PURPOSE:
 * Identifies the behavioral outcome portion of a hypothesis string for observability classification.
 * Handles arrow format, natural language markers, and common LLM phrasing variations.
 * 
 * DESIGN PRINCIPLES:
 * - Priority-based pattern matching: most specific → most general
 * - Early exit on first confident match for performance
 * - Defensive: handles null/empty/malformed input gracefully
 * - Extensible: new patterns can be added without restructuring
 * 
 * @param {string} hypothesisText - The full hypothesis string to analyze
 * @returns {{outcomeClause: string|null, format: string|null}} 
 *          outcomeClause: the extracted outcome text (or null if not found)
 *          format: identifier for which pattern matched (for debugging/extensibility)
 * 
 * @example
 * extractOutcomeClause("X → decrease Y.reality → observable hesitation")
 * // → { outcomeClause: "observable hesitation", format: "arrow_triple" }
 * 
 * @example
 * extractOutcomeClause("Injecting doubt will decrease belief, causing visible withdrawal")
 * // → { outcomeClause: "causing visible withdrawal", format: "causing_gerund" }
 */
export function extractOutcomeClause(hypothesisText) {
  try {
    // --- DEFENSIVE: Handle null/empty/invalid input ---
    if (!hypothesisText || typeof hypothesisText !== "string" || !hypothesisText.trim()) {
      return { outcomeClause: null, format: null };
    }

    const original = hypothesisText.trim();
    const lower = original.toLowerCase();

    // ========================================================================
    // PRIORITY 1: EXPLICIT STRUCTURAL FORMATS (highest confidence)
    // ========================================================================

    // 1a. Arrow format: "X -> Y -> Z" or "X → Y → Z" (triple or more)
    // Example: "Stimulus → decrease belief → observable outcome"
    const arrowRegex = /(?:->|→|\u2192|\u2190)/g;
    const arrowParts = original.split(/\s*(?:->|→|\u2192|\u2190)\s*/).map(p => p.trim()).filter(Boolean);
    if (arrowParts.length >= 3) {
      const outcome = arrowParts[arrowParts.length - 1];
      if (outcome.length >= 5) {
        return { outcomeClause: outcome, format: "arrow_triple" };
      }
    }

    // 1b. Explicit causal markers with clear outcome: "leading to X", "resulting in Y"
    // Priority order: most specific → most general
    const explicitMarkers = [
      { pattern: /\bleading to\s+([^.!?:;]+?)(?:\s*[,;.]|\s+which\s+|\s+that\s+|$)/i, format: "leading_to" },
      { pattern: /\bresulting in\s+([^.!?:;]+?)(?:\s*[,;.]|\s+which\s+|\s+that\s+|$)/i, format: "resulting_in" },
      { pattern: /\bcausing\s+([^.!?:;]+?)(?:\s*[,;.]|\s+which\s+|\s+that\s+|$)/i, format: "causing_gerund" },
      { pattern: /\bwhich causes?\s+([^.!?:;]+?)(?:\s*[,;.]|\s+that\s+|$)/i, format: "which_causes" },
      { pattern: /\bthat leads to\s+([^.!?:;]+?)(?:\s*[,;.]|$)/i, format: "that_leads_to" },
      { pattern: /\bproducing\s+([^.!?:;]+?)(?:\s*[,;.]|$)/i, format: "producing" },
      { pattern: /\byielding\s+([^.!?:;]+?)(?:\s*[,;.]|$)/i, format: "yielding" },
      { pattern: /\bbringing about\s+([^.!?:;]+?)(?:\s*[,;.]|$)/i, format: "bringing_about" },
      { pattern: /\bgiving rise to\s+([^.!?:;]+?)(?:\s*[,;.]|$)/i, format: "giving_rise_to" }
    ];

    for (const { pattern, format } of explicitMarkers) {
      const match = original.match(pattern);
      if (match && match[1]?.trim().length >= 5) {
        return { outcomeClause: match[1].trim(), format };
      }
    }

    // ========================================================================
    // PRIORITY 2: IMPLICIT CAUSAL PATTERNS (medium-high confidence)
    // ========================================================================

    // 2a. "by + gerund" pattern: "will decrease X by forcing Y to Z"
    // Very common LLM phrasing for mechanism + outcome
    const byGerundMatch = lower.match(/\bby\s+(forcing|making|causing|getting|having|letting|helping|preventing|stopping|keeping|turning|pushing|pulling|driving|motivating|encouraging|discouraging|persuading|convincing|tricking|deceiving|misleading|showing|revealing|hiding|concealing|exposing|presenting|introducing|injecting|implanting|planting|sowing|spreading|disseminating|broadcasting|announcing|declaring|stating|claiming|asserting|arguing|suggesting|implying|hinting|indicating|pointing|directing|guiding|leading|steering|nudging|prompting|triggering|eliciting|evoking|invoking|calling|summoning|drawing|extracting|pulling|taking|removing|deleting|erasing|wiping|clearing|cleaning|purging|flushing|draining|emptying|filling|loading|packing|stacking|piling|heaping|accumulating|gathering|collecting|assembling|building|constructing|creating|making|producing|generating|yielding|bearing|growing|expanding|extending|stretching|reaching|grasping|grabbing|seizing|catching|capturing|trapping|snaring|ensnaring|entangling|weaving|knitting|crocheting|sewing|stitching|patching|mending|repairing|fixing|correcting|adjusting|tuning|calibrating|aligning|synchronizing|harmonizing|balancing|equalizing|leveling|flattening|smoothing|polishing|refining|perfecting|optimizing|maximizing|minimizing|reducing|decreasing|lowering|dropping|falling|declining|diminishing|lessening|weakening|strengthening|reinforcing|boosting|amplifying|magnifying|enlarging|expanding|broadening|widening|narrowing|tightening|loosening|relaxing|tensing|stiffening|softening|hardening|toughening|breaking|cracking|splitting|tearing|ripping|cutting|slicing|chopping|dicing|mincing|grinding|crushing|smashing|shattering|exploding|bursting|erupting|gushing|flowing|streaming|pouring|dripping|leaking|seeping|oozing|bleeding|weeping|crying|sobbing|wailing|howling|roaring|shouting|yelling|screaming|whispering|murmuring|mumbling|stammering|stuttering|faltering|pausing|hesitating|waiting|lingering|dawdling|hurrying|rushing|speeding|accelerating|slowing|decelerating|stopping|halting|ceasing|ending|finishing|completing|concluding|terminating|closing|opening|starting|beginning|initiating|commencing|launching|embarking|undertaking|attempting|trying|striving|struggling|fighting|battling|warring|conflicting|clashing|colliding|crashing|impacting|hitting|striking|slapping|punching|kicking|pushing|pulling|dragging|hauling|carrying|bearing|supporting|holding|grasping|gripping|clutching|clenching|squeezing|pressing|pushing|shoving|nudging|tapping|knocking|rapping|banging|pounding|hammering|drilling|boring|piercing|penetrating|entering|exiting|leaving|departing|arriving|coming|going|moving|traveling|journeying|wandering|roaming|drifting|floating|sinking|drowning|swimming|diving|plunging|jumping|leaping|hopping|skipping|dancing|prancing|strutting|marching|walking|running|sprinting|jogging|trotting|galloping|cantering|pacing|strolling|sauntering|ambling|shuffling|creeping|crawling|slithering|sliding|gliding|skating|skiing|snowboarding|surfing|sailing|rowing|paddling|steering|navigating|piloting|driving|riding|mounting|dismounting|boarding|disembarking|embarking|departing|arriving|landing|taking\s+off|flying|soaring|gliding|diving|plummeting|falling|dropping|descending|ascending|climbing|scaling|mounting|reaching|attaining|achieving|accomplishing|succeeding|failing|floundering)\s+[^.!?]+/i);
    if (byGerundMatch) {
      return { outcomeClause: byGerundMatch[0].trim(), format: "by_gerund" };
    }

    // 2b. "causing/forcing/making + TARGET + to + verb" pattern
    // Example: "causing TED to hesitate", "forcing ELLEN to withdraw"
    const causingTargetMatch = lower.match(/\b(causing|forcing|making|getting|having|letting)\s+[A-Z][A-Z']*\s+to\s+[^.!?]+/i);
    if (causingTargetMatch) {
      return { outcomeClause: causingTargetMatch[0].trim(), format: "causing_target" };
    }

    // 2c. "such that" / "so that" purpose clauses
    // Example: "decrease belief such that visible hesitation occurs"
    const suchThatMatch = lower.match(/\b(such that|so that)\s+[^.!?]+/i);
    if (suchThatMatch) {
      return { outcomeClause: suchThatMatch[0].trim(), format: "such_that" };
    }

    // 2d. "thereby" / "thus" / "hence" formal connectors
    // Example: "undermine belief, thereby causing withdrawal"
    const formalConnectorMatch = lower.match(/\b(thereby|thus|hence|accordingly)\s+[^.!?]+/i);
    if (formalConnectorMatch) {
      return { outcomeClause: formalConnectorMatch[0].trim(), format: "formal_connector" };
    }

    // 2e. Parenthetical outcomes: "(resulting in X)", "(causing Y)"
    // Example: "decrease belief (resulting in visible hesitation)"
    const parentheticalMatch = original.match(/\((?:resulting in|causing|leading to|which causes)\s+[^)]+\)/i);
    if (parentheticalMatch) {
      // Remove parentheses for cleaner output
      const clean = parentheticalMatch[0].replace(/^\(|\)$/g, '').trim();
      return { outcomeClause: clean, format: "parenthetical" };
    }

    // 2f. "with the result that" / "having the effect of" formal phrases
    const resultPhraseMatch = lower.match(/\b(with the result that|having the effect of|to the effect that)\s+[^.!?]+/i);
    if (resultPhraseMatch) {
      return { outcomeClause: resultPhraseMatch[0].trim(), format: "result_phrase" };
    }

    // 2g. "in order to" / "with the aim of" purpose clauses
    const purposeMatch = lower.match(/\b(in order to|with the aim of|designed to|intended to|meant to)\s+[^.!?]+/i);
    if (purposeMatch) {
      return { outcomeClause: purposeMatch[0].trim(), format: "purpose_clause" };
    }

    // ========================================================================
    // PRIORITY 3: CLAUSE SCORING HEURISTIC (medium confidence)
    // ========================================================================

    // Split into candidate clauses using common delimiters
    const clauseDelimiters = /[,;.]|\b(and|but|however|therefore|moreover|furthermore|nevertheless|nonetheless)\b/;
    const clauses = original
      .split(clauseDelimiters)
      .map(c => c.trim())
      .filter(c => c.length > 0);

    if (clauses.length === 0) {
      return { outcomeClause: null, format: null };
    }

    /**
     * Scores a clause for likelihood of being an outcome.
     * Higher score = more likely to be the outcome clause.
     * @param {string} clause - The clause text to score
     * @returns {number} Score (higher = more likely outcome)
     */
    function scoreOutcomeClause(clause) {
      const c = clause.toLowerCase();
      let score = 0;

      // +++ Positive indicators (outcome-like)
      if (/\bwill\b/.test(c)) score += 3;           // Future tense
      if (/\bto\b/.test(c)) score += 1;              // Infinitive
      if (/\bby\b/.test(c)) score += 2;              // Mechanism marker
      if (/\b(cause|force|make|lead|result|trigger|prompt|elicit|evoke)\b/.test(c)) score += 3; // Causal verbs
      if (/\b(observable|visible|measurable|noticeable|clear|evident)\b/.test(c)) score += 2; // Observability markers
      if (/\b(hesitate|withdraw|doubt|confuse|panic|silence|submit|agree|disorient|paralyze)\b/.test(c)) score += 2; // Behavioral outcomes

      // --- Negative indicators (setup/context, not outcome)
      if (/\b(because|since|given|due to|as|when|if|although|while)\b/.test(c)) score -= 3; // Setup language
      if (/\b(assuming|presuming|supposing|considering)\b/.test(c)) score -= 2; // Hypotheticals
      if (clause.length < 10) score -= 2;            // Too short = likely fragment

      return score;
    }

    // Find the highest-scoring clause
    let bestClause = null;
    let bestScore = -Infinity;

    for (const clause of clauses) {
      const score = scoreOutcomeClause(clause);
      if (score > bestScore) {
        bestScore = score;
        bestClause = clause;
      }
    }

    // Return if we found a confident match
    if (bestClause && bestScore > 0) {
      return { outcomeClause: bestClause, format: "scored_clause" };
    }

    // ========================================================================
    // PRIORITY 4: FALLBACK HEURISTICS (low confidence, but better than null)
    // ========================================================================

    // 4a. Last clause if substantial and contains outcome-like keywords
    const lastClause = clauses[clauses.length - 1];
    if (lastClause && lastClause.length >= 12) {
      // Check if last clause has any outcome-like keywords as minimal validation
      if (/\b(will|to|by|cause|force|make|lead|result|observable|visible|hesitate|withdraw|doubt)\b/i.test(lastClause)) {
        return { outcomeClause: lastClause, format: "fallback_last" };
      }
    }

    // 4b. First clause after belief/direction mention (if identifiable)
    // Example: "decrease reality_reliable, causing hesitation" → "causing hesitation"
    const beliefDirectionSplit = lower.split(/\b(decrease|increase|drop|rise|undermine|strengthen|weaken|boost)\b[^.!?]*?[,;.]?\s*/i);
    if (beliefDirectionSplit.length >= 2) {
      const after = beliefDirectionSplit[beliefDirectionSplit.length - 1].trim();
      if (after.length >= 8 && /\b(will|to|by|causing|forcing|making)\b/i.test(after)) {
        return { outcomeClause: after, format: "after_belief_direction" };
      }
    }

    // ========================================================================
    // FINAL FALLBACK: No outcome clause detected
    // ========================================================================
    return { outcomeClause: null, format: null };

  } catch (err) {
    // Silent fail: never break main execution flow
    console.debug('[OBSERVABILITY][OUTCOME EXTRACT FAIL]', err?.message || err);
    return { outcomeClause: null, format: null };
  }
}

// ============================================================================
// HIGH-LEVEL STRUCTURAL VALIDATOR (delegates to component functions)
// ============================================================================

export function validateHypothesisStructure(hypothesisText) {
  const warnings = [];

  // Extract components using dedicated functions
  const { outcomeClause, format } = extractOutcomeClause(hypothesisText);
  const beliefRef = hasBeliefReference(hypothesisText);
  const direction = hasDirectionMarker(hypothesisText);
  const observability = outcomeClause ? getObservabilityResult(outcomeClause) : { tier: "unknown", method: "none" };

  // Structural validation logic
  const hasArrows = format === "arrow";
  const hasNaturalCausal = format === "natural";
  const hasObservableOutcome = observability.tier !== "unknown";

  const hasValidStructure =
    // Arrow format: all structural elements + observable outcome
    (hasArrows && beliefRef.hasReference && direction.hasDirection && hasObservableOutcome) ||
    // Natural language: causal marker + observable outcome
    (hasNaturalCausal && hasObservableOutcome) ||
    // Fallback: generic outcome phrase + any structural element (defensive)
    (hasObservableOutcome && (beliefRef.hasReference || direction.hasDirection));

  if (!hasValidStructure) {
    warnings.push("Weak hypothesis structure");
  }

  return {
    isValid: hasValidStructure,
    components: {
      format,
      beliefRef,
      direction,
      observability,
      outcomeClause
    },
    warnings
  };
}

// ============================================================================
// CONFIDENCE INTEGRATION: calculateFinalConfidence()
// Bounded weighting: observability contributes 0-35% of final score
// ============================================================================

export function calculateFinalConfidence(baseConfidence, observabilityResult) {
  // Backward compat: if no observability metadata, return base unchanged
  if (!observabilityResult?.tier) {
    return baseConfidence;
  }

  // Get weight for tier (default to "unknown" if unrecognized)
  const weight = OBSERVABILITY_WEIGHTS[observabilityResult.tier] ?? OBSERVABILITY_WEIGHTS.unknown;

  // Your spec formula: observability contributes 0-35% of final score
  // base * (0.65 + 0.35 * weight)
  // - weight=1.0 (high) → multiplier=1.0 → no penalty
  // - weight=0.3 (unknown) → multiplier=0.755 → 24.5% max reduction
  const multiplier = 0.65 + (0.35 * weight);
  const adjusted = baseConfidence * multiplier;

  // Clamp to [0, 1] to prevent overflow from floating-point errors
  return Math.max(0, Math.min(1, adjusted));
}

// ============================================================================
// CYCLE MANAGEMENT: resetObservabilityLogging()
// Call at start of each cycle to clear dedupe set
// ============================================================================

export function resetObservabilityLogging(cycleId = null) {
  _unknownVerbsThisCycle.clear();
  _cycleId = cycleId ?? G?.cycle ?? null;

  if (G?.DEBUG_OBSERVABILITY_LEXICON) {
    console.debug(`[OBSERVABILITY] Reset logging for cycle ${_cycleId}`);
  }
}

// ============================================================================
// EXPORT: getObservabilityCore() (for debugging/testing)
// ============================================================================

export function getObservabilityCore() {
  return {
    tiers: Object.keys(OBSERVABILITY_CORE),
    counts: {
      high: OBSERVABILITY_CORE.high.length,
      medium: OBSERVABILITY_CORE.medium.length,
      low: OBSERVABILITY_CORE.low.length,
      total: CORE_VERBS_SET.size
    },
    expandedCount: EXPANDED_VERBS_SET.size
  };
}

// ============================================================================
// INLINE USAGE EXAMPLE (for reference, not executed)
// ============================================================================
/*
  // In extractOutcome.js or hypothesis parser:
  import { getObservabilityResult, calculateFinalConfidence } from "./observability.js";
  
  const obsResult = getObservabilityResult(outcomeText);
  
  return {
    outcome: outcomeText.trim(),
    confidence: calculateFinalConfidence(baseConfidence, obsResult),
    observable: obsResult.tier !== "unknown",  // backward-compat boolean
    
    // Internal metadata (forward-compatible, not used by legacy code)
    _observability: {
      tier: obsResult.tier,
      method: obsResult.method,
      confidence: obsResult.confidence,
      matched_verb: obsResult.matched_verb
    }
  };
  
  // In cycle.js or assessment.js (at cycle start):
  import { resetObservabilityLogging } from "./observability.js";
  resetObservabilityLogging(G.cycle);
*/