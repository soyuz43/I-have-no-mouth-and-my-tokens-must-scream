// js/utils/exporter/executionContext.js
//
// Helpers for resolving and normalizing AM execution provenance shared by
// the decision, strategy, execution, observation, journal, and assessment
// streams.

import { asArray } from "./format.js";

export function getExecutionForCycle(G, cycle) {
    const execution = G.amExecution;

    if (
        !execution ||
        typeof execution !== "object"
    ) {
        return null;
    }

    /*
     * Reject stale state when an execution explicitly names a cycle.
     * Missing cycle fields are accepted for backward compatibility.
     */
    if (
        execution.cycle !== null &&
        execution.cycle !== undefined
    ) {
        const executionCycle =
            Number(
                execution.cycle
            );

        const requestedCycle =
            Number(cycle);

        if (
            Number.isFinite(
                executionCycle
            ) &&
            Number.isFinite(
                requestedCycle
            ) &&
            executionCycle !== requestedCycle
        ) {
            console.warn(
                "[EXPORTER] Ignoring stale AM execution record",
                {
                    requestedCycle,
                    executionCycle,
                }
            );

            return null;
        }
    }

    return execution;
}

export function collectExecutionAgentIds(G, execution) {
    const ids = new Set(
        Object.keys(
            G.sims || {}
        )
    );

    const collections = [
        execution.targetIds,
        execution.actionTargetIds,
        execution.constraintTargetIds,
        execution.activeConstraintTargetIds,
        execution.observerIds,
        execution.journalTargetIds,
        execution.missingTargetIds,
        execution.nonJournalExpectedTargetIds,

        Object.keys(
            execution.actions || {}
        ),

        Object.keys(
            execution.perceptions || {}
        ),

        Object.keys(
            execution.observationRolls || {}
        ),
    ];

    for (const collection of collections) {
        for (
            const id
            of asArray(collection)
        ) {
            if (id) {
                ids.add(id);
            }
        }
    }

    return Array.from(ids);
}

export function normalizeActionForExport(rawAction) {
    if (typeof rawAction === "string") {
        const text = rawAction.trim();

        return text
            ? {
                text,
                tactic: null,
                origin: "model",
            }
            : null;
    }

    if (
        !rawAction ||
        typeof rawAction !== "object"
    ) {
        return null;
    }

    const text =
        typeof rawAction.text === "string"
            ? rawAction.text.trim()
            : "";

    if (!text) {
        return null;
    }

    return {
        text,

        tactic:
            typeof rawAction.tactic === "string"
                ? rawAction.tactic.trim() ||
                null
                : null,

        origin:
            typeof rawAction.origin === "string"
                ? rawAction.origin.trim() ||
                "model"
                : "model",
    };
}

export function normalizePerceptionForExport(rawPerception) {
    if (
        typeof rawPerception === "string"
    ) {
        const text = rawPerception.trim();

        return text
            ? {
                text,
                origin:
                    "parser_fallback",
                observedTargetIds:
                    [],
            }
            : null;
    }

    if (
        !rawPerception ||
        typeof rawPerception !== "object"
    ) {
        return null;
    }

    const text =
        typeof rawPerception.text === "string"
            ? rawPerception.text.trim()
            : "";

    if (!text) {
        return null;
    }

    return {
        text,

        origin:
            typeof rawPerception.origin === "string"
                ? rawPerception.origin.trim() ||
                null
                : null,

        observedTargetIds:
            asArray(
                rawPerception.observedTargetIds
            ),
    };
}
