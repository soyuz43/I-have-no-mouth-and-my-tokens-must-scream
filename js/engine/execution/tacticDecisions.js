// js/engine/execution/tacticDecisions.js

export const TACTIC_RECOMMENDATIONS =
  Object.freeze({
    CONTINUE:
      "CONTINUE",

    ADVANCE:
      "ADVANCE",

    FINISH:
      "FINISH",

    ABANDON:
      "ABANDON"
  });

export const TACTIC_RUNTIME_DECISIONS =
  Object.freeze({
    CONTINUE:
      "CONTINUE",

    ADVANCE:
      "ADVANCE",

    FINISH:
      "FINISH",

    ABANDON:
      "ABANDON"
  });

export const TACTIC_RECOMMENDATION_VALUES =
  Object.freeze(
    Object.values(
      TACTIC_RECOMMENDATIONS
    )
  );

export const TACTIC_RUNTIME_DECISION_VALUES =
  Object.freeze(
    Object.values(
      TACTIC_RUNTIME_DECISIONS
    )
  );

export function isTacticRecommendation(
  value
) {
  return TACTIC_RECOMMENDATION_VALUES
    .includes(value);
}

export function isTacticRuntimeDecision(
  value
) {
  return TACTIC_RUNTIME_DECISION_VALUES
    .includes(value);
}