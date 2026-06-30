// js/engine/analysis/assessment/validateAssessmentSemantics.js

import {
    TACTIC_RECOMMENDATIONS
} from "../../execution/tacticDecisions.js";

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
        assessment.tacticRecommendation ===
        TACTIC_RECOMMENDATIONS.ADVANCE &&
        assessment.advanceCriteria !==
        ADVANCE_CRITERIA_RESULTS.SATISFIED
    ) {
        warnings.push(
            "ADVANCE was recommended without satisfied advance criteria."
        );
    }

    if (
        assessment.tacticRecommendation ===
        TACTIC_RECOMMENDATIONS.FINISH &&
        assessment.tacticResult !==
        TACTIC_RESULTS.FINISHED
    ) {
        warnings.push(
            "FINISH was recommended without a finished tactic result."
        );
    }

    if (
        assessment.tacticRecommendation ===
        TACTIC_RECOMMENDATIONS.ABANDON &&
        assessment.tacticResult !==
        TACTIC_RESULTS.FAILED
    ) {
        warnings.push(
            "ABANDON was recommended without a failed tactic result."
        );
    }

    if (
        assessment.tacticResult ===
        TACTIC_RESULTS.FINISHED &&
        assessment.tacticRecommendation !==
        TACTIC_RECOMMENDATIONS.FINISH
    ) {
        warnings.push(
            "The tactic was classified as FINISHED without recommending FINISH."
        );
    }

    if (
        assessment.tacticResult ===
        TACTIC_RESULTS.FAILED &&
        assessment.tacticRecommendation !==
        TACTIC_RECOMMENDATIONS.ABANDON
    ) {
        warnings.push(
            "The tactic was classified as FAILED without recommending ABANDON."
        );
    }

    if (
        hasNextPhase &&
        assessment.phaseResult ===
        PHASE_RESULTS.ACHIEVED &&
        assessment.advanceCriteria ===
        ADVANCE_CRITERIA_RESULTS.SATISFIED &&
        assessment.tacticResult ===
        TACTIC_RESULTS.ONGOING &&
        assessment.tacticRecommendation ===
        TACTIC_RECOMMENDATIONS.CONTINUE
    ) {
        warnings.push(
            "CONTINUE conflicts with an achieved phase, satisfied advance criteria, ongoing tactic, and available next phase."
        );
    }

    return {
        valid:
            warnings.length === 0,

        warnings
    };
}
