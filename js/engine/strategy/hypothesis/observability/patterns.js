// js/engine/strategy/hypothesis/observability/patterns.js
// ============================================================================
// STATIC OBSERVABILITY PATTERN DEFINITIONS
//
// Extracted from observability.js. Declarative pattern definitions only:
// immutable pattern descriptors with pre-built regexes. No classification,
// confidence selection, precedence, or telemetry.
// Imported by observability.js; this module must not import the entry module.
// ============================================================================

// PATTERN HEURISTICS
// ============================================================================

export const PATTERNS = {
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
