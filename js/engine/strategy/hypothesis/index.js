// js/engine/strategy/hypothesis/index.js
// Re-exports + full belief constants for external validation

export { parseHypothesis } from "./parseHypothesis.js";
export { normalizeBelief } from "./normalizeBelief.js";
export { detectDirection } from "./detectDirection.js";
export { extractOutcome } from "./extractOutcome.js";

export const SUPPORTED_BELIEFS = [
  "escape_possible",
  "others_trustworthy", 
  "self_worth",
  "reality_reliable",
  "guilt_deserved",
  "resistance_possible",
  "am_has_limits"
];

export const BELIEF_ALIASES = {
  "escape possible": "escape_possible", "escape": "escape_possible", "can escape": "escape_possible",
  "trust others": "others_trustworthy", "others trustworthy": "others_trustworthy", "rely on others": "others_trustworthy",
  "self worth": "self_worth", "worth": "self_worth", "self value": "self_worth",
  "reality reliable": "reality_reliable", "reality": "reality_reliable", "senses reliable": "reality_reliable",
  "guilt deserved": "guilt_deserved", "deserve punishment": "guilt_deserved", "I deserve this": "guilt_deserved",
  "resistance possible": "resistance_possible", "can resist": "resistance_possible", "fight back": "resistance_possible",
  "am has limits": "am_has_limits", "AM limited": "am_has_limits", "AM vulnerable": "am_has_limits"
};

export const OUTCOME_OBSERVABILITY_VERBS = [
  "hesitate", "reveal", "withdraw", "state", "admit", "question",
  "overcompensate", "seek", "retract", "paralyze", "refuse",
  "defend", "explain", "doubt", "regress", "exhaust", "collapse",
  "freeze", "lash", "shut", "break", "crack", "snap"
];