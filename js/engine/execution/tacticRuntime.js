// js/engine/execution/tacticRuntime.js

import { G } from "../../core/state.js";
import { SIM_IDS } from "../../core/constants.js";

import {
  getInitialTacticPhase,
  getTacticByPath,
  getTacticPhase
} from "../tactics.js";

/* ============================================================
   TACTIC RUNTIME DECISIONS
============================================================ */

export const TACTIC_RUNTIME_DECISIONS =
  Object.freeze({
    CONTINUE: "CONTINUE",
    ADVANCE: "ADVANCE"
  });

/* ============================================================
   RUNTIME ROOT
============================================================ */

function ensureTacticRuntimeRoot() {
  if (
    !G.amTacticRuntime ||
    typeof G.amTacticRuntime !== "object" ||
    Array.isArray(G.amTacticRuntime)
  ) {
    G.amTacticRuntime = {
      targets: {}
    };
  }

  if (
    !G.amTacticRuntime.targets ||
    typeof G.amTacticRuntime.targets !== "object" ||
    Array.isArray(G.amTacticRuntime.targets)
  ) {
    G.amTacticRuntime.targets = {};
  }

  return G.amTacticRuntime;
}

/* ============================================================
   NORMALIZATION
============================================================ */

function normalizeTargetId(rawTargetId) {
  const normalized =
    String(rawTargetId || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z]/g, "");

  return SIM_IDS.includes(normalized)
    ? normalized
    : null;
}

function normalizeDecision(rawDecision) {
  const normalized =
    String(rawDecision || "")
      .trim()
      .toUpperCase();

  return Object.values(
    TACTIC_RUNTIME_DECISIONS
  ).includes(normalized)
    ? normalized
    : null;
}

function normalizeExecutionLimit(
  value,
  fallback
) {
  const numeric =
    Number(value);

  if (
    !Number.isFinite(numeric) ||
    numeric < 0
  ) {
    return fallback;
  }

  return Math.floor(numeric);
}

function orderedTargetIds(values) {
  const requested =
    new Set(
      (
        Array.isArray(values)
          ? values
          : []
      )
        .map(normalizeTargetId)
        .filter(Boolean)
    );

  return SIM_IDS.filter(
    (id) =>
      requested.has(id)
  );
}

/* ============================================================
   RUNTIME LOOKUP
============================================================ */

export function getTacticRuntime(
  rawTargetId
) {
  const targetId =
    normalizeTargetId(rawTargetId);

  if (!targetId) {
    return null;
  }

  return (
    G.amTacticRuntime?.targets?.[
      targetId
    ] || null
  );
}

export function getTacticRuntimeContext(
  rawTargetId
) {
  const targetId =
    normalizeTargetId(rawTargetId);

  if (!targetId) {
    throw new Error(
      `Cannot resolve tactic runtime: invalid target ID ${rawTargetId}.`
    );
  }

  const runtime =
    getTacticRuntime(targetId);

  if (
    !runtime ||
    typeof runtime !== "object" ||
    !runtime.path ||
    !runtime.phaseId
  ) {
    throw new Error(
      `Cannot resolve tactic runtime for ${targetId}: runtime missing or invalid.`
    );
  }

  const tactic =
    getTacticByPath(
      runtime.path
    );

  if (!tactic) {
    throw new Error(
      `Cannot resolve tactic runtime for ${targetId}: ` +
      `canonical tactic not found for ${runtime.path}.`
    );
  }

  const phase =
    getTacticPhase(
      tactic,
      runtime.phaseId
    );

  if (!phase) {
    throw new Error(
      `Cannot resolve tactic runtime for ${targetId}: ` +
      `phase ${runtime.phaseId} not found in ${runtime.path}.`
    );
  }

  return {
    targetId,
    runtime,
    tactic,
    phase
  };
}

/* ============================================================
   ASSIGNMENT INITIALIZATION
============================================================ */

export function initializeTacticRuntime(
  tacticAssignmentsByTarget
) {
  ensureTacticRuntimeRoot();

  const assignments =
    tacticAssignmentsByTarget &&
    typeof tacticAssignmentsByTarget === "object" &&
    !Array.isArray(
      tacticAssignmentsByTarget
    )
      ? tacticAssignmentsByTarget
      : {};

  for (
    const [rawTargetId, assignment]
    of Object.entries(assignments)
  ) {
    const targetId =
      normalizeTargetId(rawTargetId);

    if (!targetId) {
      throw new Error(
        `Cannot initialize tactic runtime: invalid target ID ${rawTargetId}.`
      );
    }

    const existing =
      G.amTacticRuntime.targets[
        targetId
      ];

    if (existing) {
      if (
        !existing.path ||
        !existing.phaseId
      ) {
        throw new Error(
          `Invalid tactic runtime for ${targetId}.`
        );
      }

      if (
        existing.path !==
        assignment?.path
      ) {
        throw new Error(
          `Resolved tactic does not match active runtime for ${targetId}.`
        );
      }

      const existingTactic =
        getTacticByPath(
          existing.path
        );

      const existingPhase =
        getTacticPhase(
          existingTactic,
          existing.phaseId
        );

      if (
        !existingTactic ||
        !existingPhase
      ) {
        throw new Error(
          `Existing tactic runtime cannot be resolved for ${targetId}.`
        );
      }

      continue;
    }

    const tactic =
      assignment?.tactic;

    const initialPhase =
      getInitialTacticPhase(
        tactic
      );

    if (
      !tactic?.path ||
      !tactic?.initialPhaseId ||
      !initialPhase
    ) {
      throw new Error(
        `Cannot initialize tactic runtime for ${targetId}.`
      );
    }

    G.amTacticRuntime.targets[
      targetId
    ] = {
      path:
        tactic.path,

      phaseId:
        tactic.initialPhaseId,

      startedCycle:
        G.cycle,

      phaseStartedCycle:
        G.cycle,

      tacticExecutions:
        0,

      phaseExecutions:
        0,

      lastAppliedCycle:
        null,

      lastAssessment:
        null,

      lastTransition:
        null,

      transitionHistory:
        []
    };
  }
}

/* ============================================================
   EXECUTION ACCOUNTING
============================================================ */

export function recordTacticRuntimeExecutions(
  targetIds
) {
  const updated = [];

  for (
    const targetId
    of orderedTargetIds(targetIds)
  ) {
    const {
      runtime
    } =
      getTacticRuntimeContext(
        targetId
      );

    /*
     * Protect against accidental duplicate processing of the same
     * successful execution during one cycle.
     */
    if (
      runtime.lastAppliedCycle ===
      G.cycle
    ) {
      continue;
    }

    runtime.tacticExecutions =
      Number.isFinite(
        runtime.tacticExecutions
      )
        ? runtime.tacticExecutions + 1
        : 1;

    runtime.phaseExecutions =
      Number.isFinite(
        runtime.phaseExecutions
      )
        ? runtime.phaseExecutions + 1
        : 1;

    runtime.lastAppliedCycle =
      G.cycle;

    updated.push({
      targetId,
      path:
        runtime.path,
      phaseId:
        runtime.phaseId,
      tacticExecutions:
        runtime.tacticExecutions,
      phaseExecutions:
        runtime.phaseExecutions
    });
  }

  return updated;
}

/* ============================================================
   TRANSITION HISTORY
============================================================ */

function appendTransitionHistory(
  runtime,
  transition
) {
  if (
    !Array.isArray(
      runtime.transitionHistory
    )
  ) {
    runtime.transitionHistory = [];
  }

  runtime.transitionHistory.push(
    transition
  );

  if (
    runtime.transitionHistory.length >
    50
  ) {
    runtime.transitionHistory.shift();
  }

  runtime.lastTransition =
    transition;
}

/* ============================================================
   ASSESSMENT VALIDATION
============================================================ */

function validateAssessmentContext(
  assessment,
  context
) {
  const {
    targetId,
    runtime
  } = context;

  if (
    !assessment ||
    typeof assessment !== "object" ||
    Array.isArray(assessment)
  ) {
    throw new Error(
      `Cannot transition tactic runtime for ${targetId}: invalid assessment.`
    );
  }

  if (
    assessment.targetId !==
    targetId
  ) {
    throw new Error(
      `Cannot transition tactic runtime for ${targetId}: ` +
      `assessment target does not match.`
    );
  }

  if (
    assessment.cycle !==
    G.cycle
  ) {
    throw new Error(
      `Cannot transition tactic runtime for ${targetId}: ` +
      `assessment cycle ${assessment.cycle} does not match current cycle ${G.cycle}.`
    );
  }

  if (
    assessment.tacticPath !==
    runtime.path
  ) {
    throw new Error(
      `Cannot transition tactic runtime for ${targetId}: ` +
      `assessment tactic path is stale or mismatched.`
    );
  }

  if (
    assessment.phaseId !==
    runtime.phaseId
  ) {
    throw new Error(
      `Cannot transition tactic runtime for ${targetId}: ` +
      `assessment phase is stale or mismatched.`
    );
  }

  const recommendation =
    normalizeDecision(
      assessment.recommendation
    );

  if (!recommendation) {
    throw new Error(
      `Cannot transition tactic runtime for ${targetId}: ` +
      `unsupported recommendation ${assessment.recommendation}.`
    );
  }

  return recommendation;
}

/* ============================================================
   TRANSITION RESOLUTION
============================================================ */

function resolveAppliedDecision(
  recommendation,
  context
) {
  const {
    runtime,
    tactic,
    phase
  } = context;

  const phaseExecutions =
    normalizeExecutionLimit(
      runtime.phaseExecutions,
      0
    );

  const minExecutions =
    normalizeExecutionLimit(
      phase.minExecutions,
      1
    );

  const maxExecutions =
    normalizeExecutionLimit(
      phase.maxExecutions,
      Number.POSITIVE_INFINITY
    );

  const nextPhaseId =
    String(
      phase.nextPhaseId || ""
    ).trim();

  const nextPhase =
    nextPhaseId
      ? getTacticPhase(
          tactic,
          nextPhaseId
        )
      : null;

  /*
   * The model may recommend advancement, but the engine owns the
   * minimum-execution gate.
   */
  if (
    recommendation ===
      TACTIC_RUNTIME_DECISIONS.ADVANCE &&
    phaseExecutions <
      minExecutions
  ) {
    return {
      appliedDecision:
        TACTIC_RUNTIME_DECISIONS.CONTINUE,

      reason:
        "minimum_executions_not_met",

      nextPhaseId:
        null
    };
  }

  /*
   * A phase may not continue indefinitely beyond its declared
   * maximum. Once exhausted, the canonical next phase is forced.
   */
  if (
    recommendation ===
      TACTIC_RUNTIME_DECISIONS.CONTINUE &&
    Number.isFinite(
      maxExecutions
    ) &&
    phaseExecutions >=
      maxExecutions
  ) {
    if (
      !nextPhaseId ||
      !nextPhase
    ) {
      throw new Error(
        `Cannot continue exhausted phase ${runtime.phaseId}: ` +
        `no valid canonical next phase exists.`
      );
    }

    return {
      appliedDecision:
        TACTIC_RUNTIME_DECISIONS.ADVANCE,

      reason:
        "maximum_executions_reached",

      nextPhaseId
    };
  }

  if (
    recommendation ===
    TACTIC_RUNTIME_DECISIONS.ADVANCE
  ) {
    if (
      !nextPhaseId ||
      !nextPhase
    ) {
      throw new Error(
        `Cannot advance phase ${runtime.phaseId}: ` +
        `no valid canonical next phase exists.`
      );
    }

    return {
      appliedDecision:
        TACTIC_RUNTIME_DECISIONS.ADVANCE,

      reason:
        "assessment_recommended_advance",

      nextPhaseId
    };
  }

  return {
    appliedDecision:
      TACTIC_RUNTIME_DECISIONS.CONTINUE,

    reason:
      "assessment_recommended_continue",

    nextPhaseId:
      null
  };
}

/* ============================================================
   TRANSITION APPLICATION
============================================================ */

function applyOneTacticRuntimeTransition(
  assessment
) {
  const targetId =
    normalizeTargetId(
      assessment?.targetId
    );

  if (!targetId) {
    throw new Error(
      `Cannot apply tactic runtime transition: invalid target ID ${assessment?.targetId}.`
    );
  }

  const context =
    getTacticRuntimeContext(
      targetId
    );

  const recommendation =
    validateAssessmentContext(
      assessment,
      context
    );

  const {
    runtime
  } = context;

  const fromPhaseId =
    runtime.phaseId;

  const resolution =
    resolveAppliedDecision(
      recommendation,
      context
    );

  const assessmentRecord = {
    cycle:
      assessment.cycle,

    targetId,

    tacticPath:
      runtime.path,

    phaseId:
      fromPhaseId,

    recommendation,

    appliedDecision:
      resolution.appliedDecision,

    explanation:
      String(
        assessment.explanation || ""
      ).trim(),

    evidence:
      assessment.evidence &&
      typeof assessment.evidence === "object"
        ? assessment.evidence
        : null
  };

  runtime.lastAssessment =
    assessmentRecord;

  if (
    resolution.appliedDecision ===
    TACTIC_RUNTIME_DECISIONS.ADVANCE
  ) {
    runtime.phaseId =
      resolution.nextPhaseId;

    /*
     * Evaluation runs after the current cycle's execution. The new
     * phase becomes executable on the next cycle.
     */
    runtime.phaseStartedCycle =
      G.cycle + 1;

    runtime.phaseExecutions =
      0;
  }

  const transition = {
    cycle:
      G.cycle,

    targetId,

    tacticPath:
      runtime.path,

    recommendedDecision:
      recommendation,

    appliedDecision:
      resolution.appliedDecision,

    reason:
      resolution.reason,

    fromPhaseId,

    toPhaseId:
      runtime.phaseId,

    tacticExecutions:
      runtime.tacticExecutions,

    phaseExecutionsAfter:
      runtime.phaseExecutions,

    timestamp:
      Date.now()
  };

  appendTransitionHistory(
    runtime,
    transition
  );

  return transition;
}

export function applyTacticRuntimeTransitions(
  assessmentResults
) {
  if (
    !Array.isArray(
      assessmentResults
    )
  ) {
    throw new TypeError(
      "assessmentResults must be an array."
    );
  }

  const transitions = [];

  for (
    const assessment
    of assessmentResults
  ) {
    transitions.push(
      applyOneTacticRuntimeTransition(
        assessment
      )
    );
  }

  return transitions;
}