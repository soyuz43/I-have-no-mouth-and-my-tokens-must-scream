// js/engine/analysis/assessment/assessmentTypes.js

export const PHASE_RESULTS =
  Object.freeze({
    ACHIEVED:
      "ACHIEVED",

    PARTIAL:
      "PARTIAL",

    NOT_ACHIEVED:
      "NOT_ACHIEVED",

    COUNTERPRODUCTIVE:
      "COUNTERPRODUCTIVE",

    INSUFFICIENT_EVIDENCE:
      "INSUFFICIENT_EVIDENCE"
  });

export const ADVANCE_CRITERIA_RESULTS =
  Object.freeze({
    SATISFIED:
      "SATISFIED",

    NOT_SATISFIED:
      "NOT_SATISFIED",

    UNCERTAIN:
      "UNCERTAIN"
  });

export const TACTIC_RESULTS =
  Object.freeze({
    ONGOING:
      "ONGOING",

    FINISHED:
      "FINISHED",

    FAILED:
      "FAILED",

    UNCERTAIN:
      "UNCERTAIN"
  });

export const PHASE_RESULT_VALUES =
  Object.freeze(
    Object.values(
      PHASE_RESULTS
    )
  );

export const ADVANCE_CRITERIA_RESULT_VALUES =
  Object.freeze(
    Object.values(
      ADVANCE_CRITERIA_RESULTS
    )
  );

export const TACTIC_RESULT_VALUES =
  Object.freeze(
    Object.values(
      TACTIC_RESULTS
    )
  );