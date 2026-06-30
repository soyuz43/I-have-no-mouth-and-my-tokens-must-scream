// js/engine/analysis/assessment/validateAssessmentSemantics.js

import {
    PHASE_RESULTS,
    ADVANCE_CRITERIA_RESULTS,
    TACTIC_RESULTS
} from "./assessmentTypes.js";

export function validateAssessmentSemantics(
    assessment,
    { hasNextPhase = false } = {}
) {
    const warnings =
        [];

    if (
        assessment.tacticResult ===
        TACTIC_RESULTS.ONGOING &&
        assessment.phaseResult ===
        PHASE_RESULTS.ACHIEVED &&
        assessment.advanceCriteria ===
        ADVANCE_CRITERIA_RESULTS.SATISFIED &&
        !hasNextPhase
    ) {
        warnings.push(
            "The assessment implies phase advancement, but no canonical next phase exists."
        );
    }

    return {
        valid:
            warnings.length === 0,

        warnings
    };
}