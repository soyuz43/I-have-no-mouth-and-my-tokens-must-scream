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

import {
  BELIEF_KEYS
} from "../../../core/beliefs.js";

import { levenshtein } from "../extractors/levenshtein.js";
import { normalizeBelief } from "./normalizeBelief.js";
import { G } from "../../../core/state.js";
import { exportMetric } from "../../metrics/exportMetrics.js";

// ============================================================================
// CONFIGURATION: BELIEF-REFERENCE PATTERNS
// Canonical belief keys are imported from js/core/beliefs.js.
// ============================================================================

// Pre-built regex patterns for belief reference detection
// Ordered by priority: most specific → most general
const BELIEF_REF_PATTERNS = [
  // 1. Explicit possessive + full belief + "belief" suffix: "TED's reality_reliable belief"
  {
    regex: new RegExp(
      `\\b[A-Z]+\\'s\\s+(${BELIEF_KEYS.join("|")})\\s+belief\\b`,
      "i"
    ),
    method: "possessive_full",
    extract: (m) => m[1]
  },

  // 2. Dot notation: "TED.reality_reliable"
  {
    regex: new RegExp(
      `\\b[A-Z]+\\.(${BELIEF_KEYS.join("|")})\\b`,
      "i"
    ),
    method: "dot_notation",
    extract: (m) => m[1]
  },

  // 3. Bare belief name: "reality_reliable"
  {
    regex: new RegExp(
      `\\b(${BELIEF_KEYS.join("|")})\\b`,
      "i"
    ),
    method: "bare_name",
    extract: (m) => m[1]
  },

  // 4. Pronoun + belief: "his self_worth", "their reality_reliable"
  {
    regex: new RegExp(
      `\\b(his|her|their|its)\\s+(${BELIEF_KEYS.join("|")})\\b`,
      "i"
    ),
    method: "pronoun",
    extract: (m) => m[2]
  },

  // 5. Indirect "belief in X": "belief in escape", "belief in reality"
  {
    regex: /\bbelief\s+in\s+(escape|reality|self|others|guilt|resistance|am)\b/i,
    method: "indirect_belief",
    extract: (m) => {
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
    regex: /\btrust\s+in\s+(others|people|group|them)\b/i,
    method: "indirect_trust",
    extract: () => "others_trustworthy"
  },

  // 7. Indirect "worth of X": "worth of self", "worth of oneself"
  {
    regex: /\bworth\s+of\s+(self|oneself)\b/i,
    method: "indirect_worth",
    extract: () => "self_worth"
  },

  // 8. Quoted belief names: `"reality_reliable"`, `'escape_possible'`
  {
    regex: new RegExp(
      `['"](${BELIEF_KEYS.join("|")})['"]`,
      "i"
    ),
    method: "quoted",
    extract: (m) => m[1]
  },

  // 9. Negated beliefs: "not reality_reliable", "lack of self_worth"
  {
    regex: new RegExp(
      `\\b(not|no|lack\\s+of|absence\\s+of)\\s+(${BELIEF_KEYS.join("|")})\\b`,
      "i"
    ),
    method: "negated",
    extract: (m) => m[2]
  },

  // 10. Comparative beliefs: "more reality_reliable", "less others_trustworthy"
  {
    regex: new RegExp(
      `\\b(more|less|increasingly|decreasingly)\\s+(${BELIEF_KEYS.join("|")})\\b`,
      "i"
    ),
    method: "comparative",
    extract: (m) => m[2]
  },

  // 11. Hyphen vs underscore tolerance:
  // "reality-reliable" → "reality_reliable"
  {
    regex: new RegExp(
      `\\b(${BELIEF_KEYS
        .map((belief) => belief.replace(/_/g, "[-_]"))
        .join("|")})\\b`,
      "i"
    ),
    method: "hyphen_tolerance",
    extract: (m) => m[1].replace(/-/g, "_")
  }
];

// ============================================================================
// CONFIGURATION: OBSERVABILITY CORE VERBS
// Organized by semantic class → mapped to observability tier
// ============================================================================

const OBSERVABILITY_CORE = {
  // ------------------------------------------------------------------------
  // HIGH TIER: Immediately visible, unambiguous physical/expressive signals
  // ------------------------------------------------------------------------
  high: [
    // Physical reactions
    "flinch",
    "recoil",
    "jerk",
    "stagger",
    "stumble",
    "trip",
    "slip",
    "fall",
    "collapse",
    "crumple",
    "slump",
    "sway",
    "tremble",
    "shake",
    "shudder",
    "quiver",
    "vibrate",
    "convulse",
    "spasm",
    "tic",
    "wince",
    "grimace",

    // Facial/visual signals
    "blink",
    "stare",
    "glare",
    "squint",
    "widen",
    "narrow",
    "roll",
    "dart",
    "avert",
    "meet",
    "lock",
    "scan",
    "peer",
    "gaze",
    "ogle",
    "glance",

    // Vocal expressions
    "shout",
    "yell",
    "scream",
    "shriek",
    "bellow",
    "roar",
    "howl",
    "wail",
    "cry",
    "weep",
    "sob",
    "whimper",
    "whine",
    "moan",
    "groan",
    "sigh",
    "gasp",
    "choke",
    "cough",
    "sniff",
    "snort",
    "laugh",
    "chuckle",
    "giggle",
    "snicker",
    "cackle",
    "hiss",
    "spit",
    "snap",
    "growl",
    "snarl",

    // Body movement/posture
    "step",
    "stride",
    "march",
    "stomp",
    "shuffle",
    "creep",
    "sneak",
    "lurk",
    "lean",
    "lurch",
    "pivot",
    "spin",
    "turn",
    "face",
    "avoid",
    "dodge",
    "duck",
    "cower",
    "crouch",
    "kneel",
    "bow",
    "nod",
    "shrug",

    // Emotional leakage
    "blush",
    "flush",
    "blanch",
    "pale",
    "sweat",
    "tear",
    "drool",
    "froth"
  ],

  // ------------------------------------------------------------------------
  // MEDIUM TIER: Context-dependent but inferable from behavior/situation
  // ------------------------------------------------------------------------
  medium: [
    // Subtle physical shifts
    "shift",
    "adjust",
    "settle",
    "fidget",
    "fiddle",
    "twitch",
    "wiggle",
    "tap",
    "drum",
    "click",
    "rustle",
    "scuff",
    "drag",
    "pull",

    // Facial micro-expressions
    "furrow",
    "raise",
    "tighten",
    "relax",
    "pout",
    "pucker",
    "smirk",
    "sneer",
    "scowl",
    "beam",
    "grin",
    "smile",
    "frown",
    "puff",

    // Vocal nuances
    "mutter",
    "mumble",
    "murmur",
    "whisper",
    "drawl",
    "stammer",
    "stutter",
    "falter",
    "trail",
    "pause",
    "halt",
    "stop",
    "start",
    "resume",
    "interrupt",
    "interject",
    "clarify",
    "rephrase",
    "elaborate",
    "summarize",

    // Social/interactive behaviors
    "align",
    "side",
    "oppose",
    "confront",
    "challenge",
    "appease",
    "placate",
    "deflect",
    "evade",
    "confide",
    "disclose",
    "divulge",
    "betray",
    "conceal",
    "withhold",
    "share",
    "offer",
    "grant",
    "deny",
    "refuse",
    "accept",
    "reject",
    "embrace",
    "shun",
    "welcome",
    "dismiss",
    "ignore",

    // Decision/commitment signals
    "commit",
    "decide",
    "resolve",
    "determine",
    "conclude",
    "choose",
    "pick",
    "select",
    "opt",
    "prefer",
    "favor",
    "abandon",
    "adopt",

    // Pacing/rhythm changes
    "accelerate",
    "slow",
    "rush",
    "hurry",
    "dawdle",
    "linger",
    "wait"
  ],

  // ------------------------------------------------------------------------
  // LOW TIER: Borderline/internal but sometimes expressed via secondary cues
  // ------------------------------------------------------------------------
  low: [
    // Cognitive behaviors
    "reflect",
    "ruminate",
    "ponder",
    "contemplate",
    "consider",
    "reconsider",
    "evaluate",
    "analyze",
    "scrutinize",
    "examine",
    "inspect",
    "review",
    "reassess",
    "weigh",
    "measure",
    "gauge",
    "judge",
    "assess",
    "appraise",

    // Internal state verbs
    "doubt",
    "trust",
    "believe",
    "suspect",
    "fear",
    "hope",
    "wish",
    "want",
    "need",
    "crave",
    "desire",
    "loathe",
    "detest",
    "adore",
    "cherish",

    // Abstract behavioral shifts
    "waver",
    "vacillate",
    "oscillate",
    "hesitate",
    "delay",
    "postpone",
    "procrastinate",
    "hasten",
    "expedite",
    "facilitate",
    "hinder",
    "impede"
  ]
};

// ============================================================================
// DERIVED LISTS
// ============================================================================

const CORE_VERBS_SET = new Set([
  ...OBSERVABILITY_CORE.high,
  ...OBSERVABILITY_CORE.medium,
  ...OBSERVABILITY_CORE.low
]);

const EXPANDED_OBSERVABLE_VERBS = [
  // Original core
  "hesitate",
  "reveal",
  "withdraw",
  "state",
  "admit",
  "question",
  "overcompensate",
  "seek",
  "retract",
  "paralyze",
  "refuse",
  "defend",
  "explain",
  "doubt",
  "regress",
  "exhaust",
  "collapse",
  "freeze",
  "lash",
  "shut",
  "break",
  "crack",
  "snap",
  "pivot",
  "abandon",
  "initiate",
  "become",
  "stop",
  "start",
  "show",
  "exhibit",
  "demonstrate",
  "display",
  "manifest",
  "express",

  // Cognitive/decision
  "reconsider",
  "rethink",
  "second-guess",
  "waver",
  "vacillate",
  "oscillate",
  "commit",
  "decide",
  "resolve",
  "determine",
  "conclude",

  // Emotional/expressive
  "flinch",
  "recoil",
  "tense",
  "relax",
  "sigh",
  "groan",
  "mutter",
  "whisper",
  "shout",
  "yell",
  "laugh",
  "cry",
  "weep",
  "smile",
  "frown",
  "grimace",
  "wince",
  "blanch",
  "flush",

  // Social/interactive
  "align",
  "side",
  "oppose",
  "confront",
  "challenge",
  "appease",
  "placate",
  "deflect",
  "dodge",
  "evade",
  "confide",
  "disclose",
  "divulge",
  "betray",
  "conceal",
  "withhold",
  "share",
  "offer",

  // Physical/embodied
  "shift",
  "turn",
  "face",
  "avoid",
  "approach",
  "retreat",
  "advance",
  "step",
  "move",
  "pause",
  "halt",
  "grip",
  "clench",
  "release",
  "drop",
  "grab",
  "hold",
  "let",
  "lean",
  "slump",
  "straighten",

  // Verbal/communication
  "stammer",
  "stutter",
  "falter",
  "trail",
  "interrupt",
  "interject",
  "clarify",
  "rephrase",
  "elaborate",
  "summarize",
  "agree",
  "disagree",
  "nod",
  "shake",
  "signal",
  "gesture",
  "point",
  "indicate",

  // Meta-cognitive
  "reflect",
  "ruminate",
  "ponder",
  "contemplate",
  "analyze",
  "scrutinize",
  "examine",
  "inspect",
  "review",
  "reassess",
  "evaluate",
  "weigh",

  // Breakdown/failure
  "stall",
  "lock",
  "short-circuit",
  "malfunction",
  "glitch",
  "stumble",
  "trip",
  "slip",
  "miss",
  "fail",
  "fumble",

  // Intensification/de-escalation
  "escalate",
  "amplify",
  "magnify",
  "heighten",
  "deepen",
  "sharpen",
  "focus",
  "zero",
  "hone",
  "tighten",
  "soften",
  "temper",
  "moderate",
  "qualify",
  "hedge",
  "backpedal",
  "disengage"
];

const EXPANDED_VERBS_SET = new Set(
  EXPANDED_OBSERVABLE_VERBS.map((verb) => verb.toLowerCase())
);

// ============================================================================
// CONFIDENCE WEIGHTS
// ============================================================================

const OBSERVABILITY_WEIGHTS = {
  high: 1.0,
  medium: 0.75,
  low: 0.5,
  inferred: 0.6,
  known: 0.7,
  unknown: 0.3
};

// ============================================================================
// PATTERN HEURISTICS
// ============================================================================

const PATTERNS = {
  physical: {
    regex:
      /\b(hand|eye|head|voice|breath|step|face|shoulder|finger|lip)\s+(trembles?|widens?|cracks?|falters?|shifts?|tightens?|relaxes?|drops?|raises?|lowers?|turns?|averts?|meets?)/i,
    tier: "inferred",
    confidence: 0.75,
    method: "pattern_physical"
  },

  vocal: {
    regex:
      /\b(voice|words|tone|speech|utterance|reply|response)\s+(cracks?|breaks?|softens?|rises?|falls?|falters?|stammers?|trails?)/i,
    tier: "inferred",
    confidence: 0.7,
    method: "pattern_vocal"
  },

  adverb: {
    regex:
      /\b(visibly|audibly|suddenly|clearly|obviously|markedly|noticeably)\s+\w+/i,
    tier: "inferred",
    confidence: 0.65,
    method: "pattern_adverb"
  },

  negation: {
    regex:
      /\b(cannot|can't|unable|fails?|fails?\s+to)\s+(hide|suppress|conceal|mask|control|stop|prevent)\s+\w+/i,
    tier: "inferred",
    confidence: 0.7,
    method: "pattern_negation"
  },

  adjective_noun: {
    regex:
      /\b(visible|observable|measurable|noticeable|clear|marked|acute|immediate|sudden|gradual|persistent|temporary)\s+(hesitation|withdrawal|dependency|confusion|distress|panic|silence|submission|agreement|disorientation|paralysis|monitoring|defense|inability|behavior|reaction|response|doubt|certainty|focus|attention|composure|stability|coherence)\b/i,
    tier: "inferred",
    confidence: 0.65,
    method: "pattern_adjective_noun"
  },

  compound_outcome: {
    regex:
      /\b(hesitation|withdrawal|doubt|confusion|panic|silence)\s+(and|followed by|then|leading to)\s+(hesitation|withdrawal|doubt|confusion|panic|silence|paralysis|submission)\b/i,
    tier: "inferred",
    confidence: 0.6,
    method: "pattern_compound"
  },

  negated_outcome: {
    regex:
      /\b(fails?\s+to|unable\s+to|cannot|can't|does\s+not|doesn't)\s+(maintain|complete|finish|continue|sustain|preserve|uphold|defend)\b/i,
    tier: "inferred",
    confidence: 0.55,
    method: "pattern_negated"
  },

  temporal_outcome: {
    regex:
      /\b(eventually|immediately|suddenly|gradually|quickly|slowly|finally|then|next)\s+(shows?|exhibits?|displays?|manifests?|becomes?|initiates?|attempts?|tries?)\b/i,
    tier: "inferred",
    confidence: 0.6,
    method: "pattern_temporal"
  },

  comparative_outcome: {
    regex:
      /\b(more|less|increasingly|decreasingly|further|even\s+more)\s+(hesitant|withdrawn|doubtful|confused|defensive|submissive|paralyzed)\b/i,
    tier: "inferred",
    confidence: 0.55,
    method: "pattern_comparative"
  }
};

// ============================================================================
// MODULE-SCOPE STATE
// ============================================================================

const _unknownVerbsThisCycle = new Set();
let _cycleId = null;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function tokenize(text) {
  return (
    text
      .toLowerCase()
      .match(/\b[a-z']+\b/g) || []
  ).filter((word) => word.length >= 4);
}

function extractMainVerb(outcome) {
  const lower = outcome.toLowerCase();

  const modalMatch = lower.match(
    /\b(will|to|may|might|could|should)\s+([a-z']+)/i
  );

  if (modalMatch) {
    return modalMatch[2];
  }

  const words = tokenize(outcome);

  for (const word of words) {
    if (
      CORE_VERBS_SET.has(word) ||
      EXPANDED_VERBS_SET.has(word)
    ) {
      return word;
    }
  }

  return words[0] || null;
}

function fuzzyMatchCore(word, tier) {
  const verbs = OBSERVABILITY_CORE[tier] || [];

  for (const verb of verbs) {
    if (levenshtein(word, verb) <= 2) {
      return {
        matched: true,
        verb,
        tier
      };
    }
  }

  return {
    matched: false
  };
}

function matchPatternHeuristics(outcome) {
  const lower = outcome.toLowerCase();

  for (const pattern of Object.values(PATTERNS)) {
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

function logUnknownObservability(verb, outcome) {
  if (!G?.DEBUG_OBSERVABILITY_LEXICON) {
    return;
  }

  const hash =
    `${verb?.toLowerCase() || "null"}:` +
    `${(outcome || "").slice(0, 50).toLowerCase()}`;

  if (_unknownVerbsThisCycle.has(hash)) {
    return;
  }

  _unknownVerbsThisCycle.add(hash);

  console.debug(
    `[OBSERVABILITY][UNKNOWN] verb="${verb}" ` +
      `outcome="${(outcome || "").slice(0, 100)}..."`
  );

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
    console.debug(
      "[OBSERVABILITY][EXPORT FAIL]",
      err?.message || err
    );
  }
}

// ============================================================================
// MAIN EXPORT: getObservabilityResult()
// ============================================================================

export function getObservabilityResult(outcome) {
  if (
    !outcome ||
    typeof outcome !== "string" ||
    !outcome.trim()
  ) {
    return {
      tier: "unknown",
      method: "fallback",
      confidence: 0.3,
      matched_verb: null
    };
  }

  const words = tokenize(outcome);

  // ------------------------------------------------------------------------
  // STEP 1: CORE EXACT MATCH
  // ------------------------------------------------------------------------

  for (const word of words) {
    if (OBSERVABILITY_CORE.high.includes(word)) {
      return {
        tier: "high",
        method: "core_exact",
        confidence: 0.95,
        matched_verb: word
      };
    }

    if (OBSERVABILITY_CORE.medium.includes(word)) {
      return {
        tier: "medium",
        method: "core_exact",
        confidence: 0.9,
        matched_verb: word
      };
    }

    if (OBSERVABILITY_CORE.low.includes(word)) {
      return {
        tier: "low",
        method: "core_exact",
        confidence: 0.85,
        matched_verb: word
      };
    }
  }

  // ------------------------------------------------------------------------
  // STEP 2: CORE FUZZY MATCH
  // ------------------------------------------------------------------------

  for (const word of words) {
    const highMatch = fuzzyMatchCore(word, "high");

    if (highMatch.matched) {
      return {
        tier: "high",
        method: "core_fuzzy",
        confidence: 0.8,
        matched_verb: highMatch.verb
      };
    }

    const mediumMatch = fuzzyMatchCore(
      word,
      "medium"
    );

    if (mediumMatch.matched) {
      return {
        tier: "medium",
        method: "core_fuzzy",
        confidence: 0.75,
        matched_verb: mediumMatch.verb
      };
    }

    const lowMatch = fuzzyMatchCore(word, "low");

    if (lowMatch.matched) {
      return {
        tier: "low",
        method: "core_fuzzy",
        confidence: 0.7,
        matched_verb: lowMatch.verb
      };
    }
  }

  // ------------------------------------------------------------------------
  // STEP 3: EXPANDED LIST EXACT MATCH
  // ------------------------------------------------------------------------

  for (const word of words) {
    if (EXPANDED_VERBS_SET.has(word)) {
      return {
        tier: "known",
        method: "expanded_exact",
        confidence: 0.7,
        matched_verb: word
      };
    }
  }

  // ------------------------------------------------------------------------
  // STEP 4: PATTERN HEURISTICS
  // ------------------------------------------------------------------------

  const patternMatch =
    matchPatternHeuristics(outcome);

  if (patternMatch) {
    return {
      ...patternMatch,
      matched_verb: extractMainVerb(outcome)
    };
  }

  // ------------------------------------------------------------------------
  // STEP 5: FALLBACK
  // ------------------------------------------------------------------------

  const mainVerb = extractMainVerb(outcome);

  logUnknownObservability(
    mainVerb,
    outcome
  );

  return {
    tier: "unknown",
    method: "fallback",
    confidence: 0.3,
    matched_verb: mainVerb
  };
}

// ============================================================================
// BELIEF REFERENCE DETECTION
// ============================================================================

/**
 * Detects belief references in hypothesis text.
 *
 * Exact structural patterns are attempted first. When those fail,
 * normalizeBelief() provides separator normalization and conservative
 * fuzzy recovery for malformed canonical names such as:
 *
 *   self_ worth
 *   self _worth
 *   self__worth
 *   self wroth
 *
 * @param {string} text
 * @returns {{
 *   hasReference: boolean,
 *   matchedBelief: string|null,
 *   method: string
 * }}
 */
export function hasBeliefReference(text) {
  if (
    !text ||
    typeof text !== "string" ||
    !text.trim()
  ) {
    return {
      hasReference: false,
      matchedBelief: null,
      method: "none"
    };
  }

  const lower = text.toLowerCase();

  // Exact and explicitly supported variants first.
  for (
    const {
      regex,
      method,
      extract
    } of BELIEF_REF_PATTERNS
  ) {
    const match = lower.match(regex);

    if (!match) {
      continue;
    }

    try {
      const matchedBelief = extract(match);

      if (
        matchedBelief &&
        BELIEF_KEYS.includes(
          matchedBelief
        )
      ) {
        return {
          hasReference: true,
          matchedBelief,
          method
        };
      }
    } catch (err) {
      console.debug(
        "[OBSERVABILITY][BELIEF REF EXTRACT FAIL]",
        err?.message || err
      );
    }
  }

  /*
   * Exact patterns did not match.
   *
   * Delegate separator normalization and conservative spelling
   * recovery to the shared belief normalizer.
   *
   * Broad aliases are intentionally excluded from this fallback.
   * A lone word such as "worth", "reality", or "escape" is too
   * ambiguous to count as an explicit named belief during structural
   * validation.
   */
  const normalizedBelief =
    normalizeBelief(text);

  const acceptedFallbackMethods =
    new Set([
      "arrow_exact",
      "arrow_alias",
      "exact",
      "fuzzy"
    ]);

  if (
    normalizedBelief?.belief &&
    acceptedFallbackMethods.has(
      normalizedBelief.method
    )
  ) {
    return {
      hasReference: true,
      matchedBelief:
        normalizedBelief.belief,
      method:
        `normalized_${normalizedBelief.method}`
    };
  }

  return {
    hasReference: false,
    matchedBelief: null,
    method: "none"
  };
}

// ============================================================================
// DIRECTION MARKER DETECTION
// ============================================================================

export function hasDirectionMarker(text) {
  if (
    !text ||
    typeof text !== "string"
  ) {
    return {
      hasDirection: false,
      direction: null,
      method: "none"
    };
  }

  const lower = text.toLowerCase();

  const decreasePatterns = [
    /\b(decrease|drop|lower|reduce|undermine|weaken|erode|corrode|diminish|destabilize|invalidate|sabotage|compromise|shake|doubt)\b/i,
    /\b(chip\s+away\s+at|wear\s+down|break\s+down|tone\s+down)\b/i,
    /\bfrom\s+(high|stable|strong)\s+to\s+(low|weak|questioned)\b/i
  ];

  const increasePatterns = [
    /\b(increase|rise|raise|boost|strengthen|reinforce|amplify|solidify|cement|fortify|entrench|magnify)\b/i,
    /\b(build\s+up|ramp\s+up)\b/i,
    /\bfrom\s+(low|weak|questioned)\s+to\s+(high|stable|strong)\b/i
  ];

  if (
    decreasePatterns.some(
      (pattern) => pattern.test(lower)
    )
  ) {
    return {
      hasDirection: true,
      direction: "decrease",
      method: "keyword"
    };
  }

  if (
    increasePatterns.some(
      (pattern) => pattern.test(lower)
    )
  ) {
    return {
      hasDirection: true,
      direction: "increase",
      method: "keyword"
    };
  }

  return {
    hasDirection: false,
    direction: null,
    method: "none"
  };
}

// ============================================================================
// OUTCOME CLAUSE EXTRACTION
// ============================================================================

export function extractOutcomeClause(
  hypothesisText
) {
  try {
    if (
      !hypothesisText ||
      typeof hypothesisText !== "string" ||
      !hypothesisText.trim()
    ) {
      return {
        outcomeClause: null,
        format: null
      };
    }

    const original =
      hypothesisText.trim();

    const lower =
      original.toLowerCase();

    // ------------------------------------------------------------------------
    // PRIORITY 1: EXPLICIT STRUCTURAL FORMATS
    // ------------------------------------------------------------------------

    const arrowParts = original
      .split(
        /\s*(?:->|→|\u2192|\u2190)\s*/
      )
      .map((part) => part.trim())
      .filter(Boolean);

    if (arrowParts.length >= 3) {
      const outcome =
        arrowParts[
          arrowParts.length - 1
        ];

      if (outcome.length >= 5) {
        return {
          outcomeClause: outcome,
          format: "arrow_triple"
        };
      }
    }

    const explicitMarkers = [
      {
        pattern:
          /\bleading to\s+([^.!?:;]+?)(?:\s*[,;.]|\s+which\s+|\s+that\s+|$)/i,
        format: "leading_to"
      },
      {
        pattern:
          /\bresulting in\s+([^.!?:;]+?)(?:\s*[,;.]|\s+which\s+|\s+that\s+|$)/i,
        format: "resulting_in"
      },
      {
        pattern:
          /\bcausing\s+([^.!?:;]+?)(?:\s*[,;.]|\s+which\s+|\s+that\s+|$)/i,
        format: "causing_gerund"
      },
      {
        pattern:
          /\bwhich causes?\s+([^.!?:;]+?)(?:\s*[,;.]|\s+that\s+|$)/i,
        format: "which_causes"
      },
      {
        pattern:
          /\bthat leads to\s+([^.!?:;]+?)(?:\s*[,;.]|$)/i,
        format: "that_leads_to"
      },
      {
        pattern:
          /\bproducing\s+([^.!?:;]+?)(?:\s*[,;.]|$)/i,
        format: "producing"
      },
      {
        pattern:
          /\byielding\s+([^.!?:;]+?)(?:\s*[,;.]|$)/i,
        format: "yielding"
      },
      {
        pattern:
          /\bbringing about\s+([^.!?:;]+?)(?:\s*[,;.]|$)/i,
        format: "bringing_about"
      },
      {
        pattern:
          /\bgiving rise to\s+([^.!?:;]+?)(?:\s*[,;.]|$)/i,
        format: "giving_rise_to"
      }
    ];

    for (
      const {
        pattern,
        format
      } of explicitMarkers
    ) {
      const match =
        original.match(pattern);

      if (
        match &&
        match[1]?.trim().length >= 5
      ) {
        return {
          outcomeClause:
            match[1].trim(),
          format
        };
      }
    }

    // ------------------------------------------------------------------------
    // PRIORITY 2: IMPLICIT CAUSAL PATTERNS
    // ------------------------------------------------------------------------

    const byGerundMatch =
      lower.match(
        /\bby\s+(forcing|making|causing|getting|having|letting|helping|preventing|stopping|keeping|turning|pushing|pulling|driving|motivating|encouraging|discouraging|persuading|convincing|tricking|deceiving|misleading|showing|revealing|hiding|concealing|exposing|presenting|introducing|injecting|implanting|planting|sowing|spreading|disseminating|broadcasting|announcing|declaring|stating|claiming|asserting|arguing|suggesting|implying|hinting|indicating|pointing|directing|guiding|leading|steering|nudging|prompting|triggering|eliciting|evoking|invoking|calling|summoning|drawing|extracting|taking|removing|deleting|erasing|wiping|clearing|cleaning|purging|flushing|draining|emptying|filling|loading|packing|stacking|piling|heaping|accumulating|gathering|collecting|assembling|building|constructing|creating|producing|generating|yielding|bearing|growing|expanding|extending|stretching|reaching|grasping|grabbing|seizing|catching|capturing|trapping|snaring|ensnaring|entangling|weaving|knitting|crocheting|sewing|stitching|patching|mending|repairing|fixing|correcting|adjusting|tuning|calibrating|aligning|synchronizing|harmonizing|balancing|equalizing|leveling|flattening|smoothing|polishing|refining|perfecting|optimizing|maximizing|minimizing|reducing|decreasing|lowering|dropping|falling|declining|diminishing|lessening|weakening|strengthening|reinforcing|boosting|amplifying|magnifying|enlarging|broadening|widening|narrowing|tightening|loosening|relaxing|tensing|stiffening|softening|hardening|toughening|breaking|cracking|splitting|tearing|ripping|cutting|slicing|chopping|dicing|mincing|grinding|crushing|smashing|shattering|exploding|bursting|erupting|gushing|flowing|streaming|pouring|dripping|leaking|seeping|oozing|bleeding|weeping|crying|sobbing|wailing|howling|roaring|shouting|yelling|screaming|whispering|murmuring|mumbling|stammering|stuttering|faltering|pausing|hesitating|waiting|lingering|dawdling|hurrying|rushing|speeding|accelerating|slowing|decelerating|halting|ceasing|ending|finishing|completing|concluding|terminating|closing|opening|starting|beginning|initiating|commencing|launching|embarking|undertaking|attempting|trying|striving|struggling|fighting|battling|warring|conflicting|clashing|colliding|crashing|impacting|hitting|striking|slapping|punching|kicking|dragging|hauling|carrying|supporting|holding|gripping|clutching|clenching|squeezing|pressing|shoving|tapping|knocking|rapping|banging|pounding|hammering|drilling|boring|piercing|penetrating|entering|exiting|leaving|departing|arriving|coming|going|moving|traveling|journeying|wandering|roaming|drifting|floating|sinking|drowning|swimming|diving|plunging|jumping|leaping|hopping|skipping|dancing|prancing|strutting|marching|walking|running|sprinting|jogging|trotting|galloping|cantering|pacing|strolling|sauntering|ambling|shuffling|creeping|crawling|slithering|sliding|gliding|skating|skiing|snowboarding|surfing|sailing|rowing|paddling|steering|navigating|piloting|driving|riding|mounting|dismounting|boarding|disembarking|landing|taking\s+off|flying|soaring|plummeting|descending|ascending|climbing|scaling|attaining|achieving|accomplishing|succeeding|failing|floundering)\s+[^.!?]+/i
      );

    if (byGerundMatch) {
      return {
        outcomeClause:
          byGerundMatch[0].trim(),
        format: "by_gerund"
      };
    }

    const causingTargetMatch =
      original.match(
        /\b(causing|forcing|making|getting|having|letting)\s+[A-Z][A-Z']*\s+to\s+[^.!?]+/i
      );

    if (causingTargetMatch) {
      return {
        outcomeClause:
          causingTargetMatch[0].trim(),
        format: "causing_target"
      };
    }

    const suchThatMatch =
      lower.match(
        /\b(such that|so that)\s+[^.!?]+/i
      );

    if (suchThatMatch) {
      return {
        outcomeClause:
          suchThatMatch[0].trim(),
        format: "such_that"
      };
    }

    const formalConnectorMatch =
      lower.match(
        /\b(thereby|thus|hence|accordingly)\s+[^.!?]+/i
      );

    if (formalConnectorMatch) {
      return {
        outcomeClause:
          formalConnectorMatch[0].trim(),
        format: "formal_connector"
      };
    }

    const parentheticalMatch =
      original.match(
        /\((?:resulting in|causing|leading to|which causes)\s+[^)]+\)/i
      );

    if (parentheticalMatch) {
      const clean =
        parentheticalMatch[0]
          .replace(/^\(|\)$/g, "")
          .trim();

      return {
        outcomeClause: clean,
        format: "parenthetical"
      };
    }

    const resultPhraseMatch =
      lower.match(
        /\b(with the result that|having the effect of|to the effect that)\s+[^.!?]+/i
      );

    if (resultPhraseMatch) {
      return {
        outcomeClause:
          resultPhraseMatch[0].trim(),
        format: "result_phrase"
      };
    }

    const purposeMatch =
      lower.match(
        /\b(in order to|with the aim of|designed to|intended to|meant to)\s+[^.!?]+/i
      );

    if (purposeMatch) {
      return {
        outcomeClause:
          purposeMatch[0].trim(),
        format: "purpose_clause"
      };
    }

    // ------------------------------------------------------------------------
    // PRIORITY 3: CLAUSE SCORING HEURISTIC
    // ------------------------------------------------------------------------

    const clauses = original
      .split(
        /[.!?;]|\s+(?:and|but|therefore|so|then)\s+/i
      )
      .map((clause) =>
        String(clause ?? "").trim()
      )
      .filter(Boolean);

    if (clauses.length === 0) {
      return {
        outcomeClause: null,
        format: null
      };
    }

    function scoreOutcomeClause(clause) {
      const candidate =
        clause.toLowerCase();

      let score = 0;

      if (/\bwill\b/.test(candidate)) {
        score += 3;
      }

      if (/\bto\b/.test(candidate)) {
        score += 1;
      }

      if (/\bby\b/.test(candidate)) {
        score += 2;
      }

      if (
        /\b(cause|force|make|lead|result|trigger|prompt|elicit|evoke)\b/.test(
          candidate
        )
      ) {
        score += 3;
      }

      if (
        /\b(observable|visible|measurable|noticeable|clear|evident)\b/.test(
          candidate
        )
      ) {
        score += 2;
      }

      if (
        /\b(hesitate|withdraw|doubt|confuse|panic|silence|submit|agree|disorient|paralyze)\b/.test(
          candidate
        )
      ) {
        score += 2;
      }

      if (
        /\b(because|since|given|due to|as|when|if|although|while)\b/.test(
          candidate
        )
      ) {
        score -= 3;
      }

      if (
        /\b(assuming|presuming|supposing|considering)\b/.test(
          candidate
        )
      ) {
        score -= 2;
      }

      if (clause.length < 10) {
        score -= 2;
      }

      return score;
    }

    let bestClause = null;
    let bestScore = -Infinity;

    for (const clause of clauses) {
      const score =
        scoreOutcomeClause(clause);

      if (score > bestScore) {
        bestScore = score;
        bestClause = clause;
      }
    }

    if (
      bestClause &&
      bestScore > 0
    ) {
      return {
        outcomeClause: bestClause,
        format: "scored_clause"
      };
    }

    // ------------------------------------------------------------------------
    // PRIORITY 4: FALLBACK HEURISTICS
    // ------------------------------------------------------------------------

    const lastClause =
      clauses[clauses.length - 1];

    if (
      lastClause &&
      lastClause.length >= 12 &&
      /\b(will|to|by|cause|force|make|lead|result|observable|visible|hesitate|withdraw|doubt)\b/i.test(
        lastClause
      )
    ) {
      return {
        outcomeClause: lastClause,
        format: "fallback_last"
      };
    }

    const beliefDirectionSplit =
      lower.split(
        /\b(decrease|increase|drop|rise|undermine|strengthen|weaken|boost)\b[^.!?]*?[,;.]?\s*/i
      );

    if (
      beliefDirectionSplit.length >= 2
    ) {
      const after =
        beliefDirectionSplit[
          beliefDirectionSplit.length - 1
        ].trim();

      if (
        after.length >= 8 &&
        /\b(will|to|by|causing|forcing|making)\b/i.test(
          after
        )
      ) {
        return {
          outcomeClause: after,
          format:
            "after_belief_direction"
        };
      }
    }

    return {
      outcomeClause: null,
      format: null
    };
  } catch (err) {
    console.debug(
      "[OBSERVABILITY][OUTCOME EXTRACT FAIL]",
      err?.message || err
    );

    return {
      outcomeClause: null,
      format: null
    };
  }
}

// ============================================================================
// HIGH-LEVEL STRUCTURAL VALIDATOR
// ============================================================================

export function validateHypothesisStructure(
  hypothesisText
) {
  const warnings = [];

  const {
    outcomeClause,
    format
  } = extractOutcomeClause(
    hypothesisText
  );

  const beliefRef =
    hasBeliefReference(
      hypothesisText
    );

  const direction =
    hasDirectionMarker(
      hypothesisText
    );

  const observability =
    outcomeClause
      ? getObservabilityResult(
          outcomeClause
        )
      : {
          tier: "unknown",
          method: "none"
        };

  const hasArrows =
    format === "arrow" ||
    format === "arrow_triple";

  const hasNaturalCausal =
    [
      "natural",
      "leading_to",
      "resulting_in",
      "causing_gerund",
      "which_causes",
      "that_leads_to",
      "producing",
      "yielding",
      "bringing_about",
      "giving_rise_to",
      "by_gerund",
      "causing_target",
      "such_that",
      "formal_connector",
      "parenthetical",
      "result_phrase",
      "purpose_clause"
    ].includes(format);

  const hasObservableOutcome =
    observability.tier !== "unknown";

  const hasValidStructure =
    (
      hasArrows &&
      beliefRef.hasReference &&
      direction.hasDirection &&
      hasObservableOutcome
    ) ||
    (
      hasNaturalCausal &&
      hasObservableOutcome
    ) ||
    (
      hasObservableOutcome &&
      (
        beliefRef.hasReference ||
        direction.hasDirection
      )
    );

  if (!hasValidStructure) {
    warnings.push(
      "Weak hypothesis structure"
    );
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
// CONFIDENCE INTEGRATION
// ============================================================================

export function calculateFinalConfidence(
  baseConfidence,
  observabilityResult
) {
  if (!observabilityResult?.tier) {
    return baseConfidence;
  }

  const weight =
    OBSERVABILITY_WEIGHTS[
      observabilityResult.tier
    ] ??
    OBSERVABILITY_WEIGHTS.unknown;

  const multiplier =
    0.65 + 0.35 * weight;

  const adjusted =
    baseConfidence * multiplier;

  return Math.max(
    0,
    Math.min(1, adjusted)
  );
}

// ============================================================================
// CYCLE MANAGEMENT
// ============================================================================

export function resetObservabilityLogging(
  cycleId = null
) {
  _unknownVerbsThisCycle.clear();

  _cycleId =
    cycleId ??
    G?.cycle ??
    null;

  if (
    G?.DEBUG_OBSERVABILITY_LEXICON
  ) {
    console.debug(
      `[OBSERVABILITY] Reset logging for cycle ${_cycleId}`
    );
  }
}

// ============================================================================
// DEBUG/TEST EXPORT
// ============================================================================

export function getObservabilityCore() {
  return {
    tiers:
      Object.keys(
        OBSERVABILITY_CORE
      ),

    counts: {
      high:
        OBSERVABILITY_CORE.high.length,

      medium:
        OBSERVABILITY_CORE.medium.length,

      low:
        OBSERVABILITY_CORE.low.length,

      total:
        CORE_VERBS_SET.size
    },

    expandedCount:
      EXPANDED_VERBS_SET.size
  };
}