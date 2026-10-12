// js/engine/analysis/assessment/validateAssessmentSemantics.js

import {
    PHASE_RESULTS,
    ADVANCE_CRITERIA_RESULTS,
    TACTIC_RESULTS
} from "./assessmentTypes.js";
import { SIM_IDS } from "../../../core/constants.js";

export function validateAssessmentSemantics(
    assessment,
    {
        hasNextPhase = false,
        targetId = null,
        textEvidence = {}
    } = {}
) {
    const inconsistencies =
        [];

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
        inconsistencies.push(
            "The assessment implies phase advancement, but no canonical next phase exists."
        );
    }

    const explanation =
        String(assessment.explanation ?? "");

    const supportingEvidence =
        Object.values(textEvidence ?? {})
            .map((text) => String(text ?? ""))
            .join("\n");

    const normalizedTargetId =
        String(targetId ?? "").trim().toUpperCase();

    for (const prisonerId of SIM_IDS) {
        if (prisonerId === normalizedTargetId) {
            continue;
        }

        const prisonerNamePattern =
            new RegExp(`\\b${prisonerId}\\b`, "i");

        if (
            prisonerNamePattern.test(explanation) &&
            !prisonerNamePattern.test(supportingEvidence)
        ) {
            warnings.push(
                "Explanation references another prisoner without supporting evidence."
            );
        }
    }

    return {
        valid:
            inconsistencies.length === 0,

        warnings: [
            ...inconsistencies,
            ...warnings
        ]
    };
}
