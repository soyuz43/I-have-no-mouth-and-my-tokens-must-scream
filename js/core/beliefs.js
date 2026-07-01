// js/core/beliefs.js

export const BELIEF_KEYS = Object.freeze([
  "escape_possible",
  "others_trustworthy",
  "self_worth",
  "reality_reliable",
  "guilt_deserved",
  "resistance_possible",
  "am_has_limits"
]);

export const BELIEF_ALIASES = Object.freeze({
  "escape possible": "escape_possible",
  "escape": "escape_possible",
  "can escape": "escape_possible",

  "trust others": "others_trustworthy",
  "others trustworthy": "others_trustworthy",
  "rely on others": "others_trustworthy",

  "self worth": "self_worth",
  "worth": "self_worth",
  "self value": "self_worth",

  "reality reliable": "reality_reliable",
  "reality": "reality_reliable",
  "senses reliable": "reality_reliable",

  "guilt deserved": "guilt_deserved",
  "deserve punishment": "guilt_deserved",
  "I deserve this": "guilt_deserved",

  "resistance possible": "resistance_possible",
  "can resist": "resistance_possible",
  "fight back": "resistance_possible",

  "am has limits": "am_has_limits",
  "AM limited": "am_has_limits",
  "AM vulnerable": "am_has_limits"
});

const BELIEF_KEY_SET = new Set(BELIEF_KEYS);

export function isBeliefKey(value) {
  return (
    typeof value === "string" &&
    BELIEF_KEY_SET.has(value)
  );
}