// js/engine/strategy/hypothesis/index.js
// Public hypothesis API and compatibility re-exports.

export { parseHypothesis } from "./parseHypothesis.js";
export { normalizeBelief } from "./normalizeBelief.js";
export { detectDirection } from "./detectDirection.js";
export { extractOutcome } from "./extractOutcome.js";

export {
  BELIEF_KEYS,
  BELIEF_KEYS as SUPPORTED_BELIEFS,
  BELIEF_ALIASES,
  isBeliefKey
} from "../../../core/beliefs.js";

export const OUTCOME_OBSERVABILITY_VERBS = [
  "hesitate", "reveal", "withdraw", "state", "admit", "question",
  "overcompensate", "seek", "retract", "paralyze", "refuse",
  "defend", "explain", "doubt", "regress", "exhaust", "collapse",
  "freeze", "lash", "shut", "break", "crack", "snap"
];