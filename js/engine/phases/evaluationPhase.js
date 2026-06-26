// js/engine/phases/evaluationPhase.js
//
// Evaluation Phase
//
// Responsible for:
// 1. Post-cycle assessment
// 2. Tactic runtime transitions
// 3. Tactic evolution
// 4. AM psychological profiling
// 5. Debug relationship inspection

import { G } from "../../core/state.js";
import { SIM_IDS } from "../../core/constants.js";

import { timelineEvent } from "../../ui/timeline.js";
import { renderRelationships } from "../../ui/relationships.js";
import {
  cleanupExpiredConstraints
} from "../constraints.js";
import { runAssessment } from "../analysis/assessment.js";
import { applyTacticRuntimeTransitions } from "../execution/tacticRuntime.js";
import { runTacticEvolution } from "../analysis/tacticEvolution.js";
import { printRelationshipMatrix } from "../analysis/relationshipMatrix.js";

function snapshotForConsole(value) {
  if (
    typeof structuredClone ===
    "function"
  ) {
    try {
      return structuredClone(
        value
      );
    } catch {
      // Fall through to JSON cloning.
    }
  }

  try {
    return JSON.parse(
      JSON.stringify(value)
    );
  } catch {
    return value;
  }
}

/* ============================================================
   PLANNER-FACING ASSESSMENT STATE
============================================================ */

function publishAssessmentState(
  assessmentOutput,
  tacticTransitions
) {
  const tacticAssessments =
    Array.isArray(
      assessmentOutput?.tacticAssessments
    )
      ? assessmentOutput.tacticAssessments
      : [];

  const constraintAssessments =
    Array.isArray(
      assessmentOutput?.constraintAssessments
    )
      ? assessmentOutput.constraintAssessments
      : [];

  const transitions =
    Array.isArray(
      tacticTransitions
    )
      ? tacticTransitions
      : [];

  const tacticAssessmentsByTarget =
    new Map(
      tacticAssessments.map(
        (assessment) => [
          assessment.targetId,
          assessment
        ]
      )
    );

  const transitionsByTarget =
    new Map(
      transitions.map(
        (transition) => [
          transition.targetId,
          transition
        ]
      )
    );

  const constraintDecisionsByTarget =
    new Map();

  for (
    const assessment
    of constraintAssessments
  ) {
    const targetId =
      assessment?.targetId;

    if (
      !SIM_IDS.includes(
        targetId
      )
    ) {
      continue;
    }

    const targetConstraintDecisions =
      constraintDecisionsByTarget
        .get(targetId) ||
      [];

    targetConstraintDecisions.push({
      constraintId:
        assessment.constraintId,

      constraintTitle:
        assessment.constraintTitle,

      constraintDecision:
        assessment.constraintDecision,

      nextDuration:
        assessment.nextDuration,

      explanation:
        assessment.explanation
    });

    constraintDecisionsByTarget.set(
      targetId,
      targetConstraintDecisions
    );
  }

  const targets = {};

  for (const id of SIM_IDS) {
    const tacticAssessment =
      tacticAssessmentsByTarget.get(id);

    const transition =
      transitionsByTarget.get(id);

    const constraintDecisions =
      constraintDecisionsByTarget.get(id) ||
      [];

    const targetState = {};

    /*
     * A planner-facing tactic decision is published only when the
     * assessment recommendation was successfully validated and applied
     * by the runtime transition layer.
     */
    if (
      tacticAssessment &&
      transition
    ) {
      targetState.tacticDecision = {
        tacticPath:
          transition.tacticPath,

        assessedPhaseId:
          transition.fromPhaseId,

        resultingPhaseId:
          transition.toPhaseId,

        tacticRecommendation:
          transition.tacticRecommendation,

        tacticDecision:
          transition.tacticDecision,

        terminal:
          transition.terminal === true,

        reason:
          transition.reason,

        explanation:
          tacticAssessment.explanation
      };
    }

    /*
     * Constraint decisions are independent from tactic decisions.
     * Omit the property entirely when no constraints were assessed.
     */
    if (
      constraintDecisions.length
    ) {
      targetState.constraintDecisions =
        constraintDecisions;
    }

    if (
      Object.keys(
        targetState
      ).length
    ) {
      targets[id] =
        targetState;
    }
  }

  G.amAssessmentState = {
    cycle:
      G.cycle,

    targets
  };

  return G.amAssessmentState;
}

/* ============================================================
   EVALUATION PHASE ORCHESTRATOR
============================================================ */

export async function runEvaluationPhase() {

  let assessmentOutput = {
    tacticAssessments: [],
    constraintAssessments: []
  };

  let tacticTransitions =
    [];

  /* ------------------------------------------------------------
     ASSESSMENT PHASE
     Compare intent vs results
  ------------------------------------------------------------ */

  try {

    timelineEvent(
      `>>> CYCLE ASSESSMENT`
    );

    const result =
      await runAssessment();

    if (
      !result ||
      !Array.isArray(
        result.tacticAssessments
      ) ||
      !Array.isArray(
        result.constraintAssessments
      )
    ) {
      throw new TypeError(
        "runAssessment() returned an invalid assessment contract."
      );
    }

    assessmentOutput =
      result;

    console.log(
      "[ASSESSMENT][CURRENT CYCLE RECORDS]",
      snapshotForConsole(
        (
          Array.isArray(
            G.amAssessments
          )
            ? G.amAssessments
            : []
        ).filter(
          (entry) =>
            entry?.cycle ===
            G.cycle
        )
      )
    );

    /*
     * Constraint assessment records are already preserved in
     * assessmentOutput before cleanup removes released runtime objects.
     */
    const releasedConstraints =
      [];

    if (G.prevCycleSnapshot) {
      for (const id of SIM_IDS) {
        const removed =
          cleanupExpiredConstraints(
            G.sims?.[id]
          );

        for (
          const constraint
          of removed
        ) {
          releasedConstraints.push({
            target:
              id,

            constraint:
              constraint.title ||
              constraint.id,

            constraintDecision:
              constraint.lastAssessment
                ?.constraintDecision ??
              null,

            assessedCycle:
              constraint.lastAssessment
                ?.cycle ??
              null
          });
        }
      }
    }

    if (
      releasedConstraints.length
    ) {
      console.log(
        "[CONSTRAINT][POST-ASSESSMENT CLEANUP]"
      );

      console.table(
        releasedConstraints
      );
    }

    timelineEvent(
      `// ASSESSMENT COMPLETE`
    );

  } catch (error) {

    console.error(
      "Assessment error:",
      error
    );

    timelineEvent(
      `!! ASSESSMENT ERROR`
    );

  }

  /* ------------------------------------------------------------
     TACTIC RUNTIME TRANSITIONS
     Validate recommendations and apply authoritative decisions
  ------------------------------------------------------------ */

  try {

    timelineEvent(
      `>>> TACTIC RUNTIME TRANSITIONS`
    );

    tacticTransitions =
      applyTacticRuntimeTransitions(
        assessmentOutput
          .tacticAssessments
      );

    console.log(
      "[TACTIC RUNTIME][POST-TRANSITION STATE]",
      snapshotForConsole(
        G.amTacticRuntime
      )
    );

    if (
      tacticTransitions.length
    ) {

      console.group(
        "[TACTIC RUNTIME TRANSITIONS]"
      );

      console.table(
        tacticTransitions.map(
          (transition) => ({
            target:
              transition.targetId,

            tactic:
              transition.tacticPath,

            tacticRecommendation:
              transition.tacticRecommendation,

            tacticDecision:
              transition.tacticDecision,

            terminal:
              transition.terminal === true,

            reason:
              transition.reason,

            from_phase:
              transition.fromPhaseId,

            to_phase:
              transition.toPhaseId,

            tactic_executions:
              transition.tacticExecutions,

            phase_executions_after:
              transition.phaseExecutionsAfter
          })
        )
      );

      console.groupEnd();

    } else {

      console.debug(
        "[TACTIC RUNTIME TRANSITIONS] No tactic assessments to apply."
      );

    }

    timelineEvent(
      `// TACTIC RUNTIME TRANSITIONS COMPLETE`
    );

  } catch (error) {

    console.error(
      "Tactic runtime transition error:",
      error
    );

    timelineEvent(
      `!! TACTIC RUNTIME TRANSITION ERROR`
    );

  }

  /* ------------------------------------------------------------
     ASSESSMENT STATE PUBLICATION
     Expose authoritative results to the next planning cycle
  ------------------------------------------------------------ */

  try {

    const assessmentState =
      publishAssessmentState(
        assessmentOutput,
        tacticTransitions
      );

    console.log(
      "[AM ASSESSMENT STATE][PUBLISHED]",
      snapshotForConsole(
        assessmentState
      )
    );
    
  } catch (error) {

    console.error(
      "Assessment state publication error:",
      error
    );

    timelineEvent(
      `!! ASSESSMENT STATE ERROR`
    );

  }

  /* ------------------------------------------------------------
     TACTIC EVOLUTION
     Discover new tactics from strong effects
  ------------------------------------------------------------ */

  try {

    timelineEvent(
      `>>> TACTIC EVOLUTION`
    );

    await runTacticEvolution();

    timelineEvent(
      `// TACTIC EVOLUTION COMPLETE`
    );

  } catch (error) {

    console.error(
      "Tactic evolution error:",
      error
    );

    timelineEvent(
      `!! TACTIC EVOLUTION ERROR`
    );

  }

  /* ------------------------------------------------------------
     FINALIZATION
  ------------------------------------------------------------ */

  try {

    timelineEvent(
      `>>> FINALIZING CYCLE`
    );

    renderRelationships();

    /* ------------------------------------------------------------
       RELATIONSHIP MATRIX DEBUG
       Prints full social trust network for this cycle
    ------------------------------------------------------------ */

    printRelationshipMatrix();

    /* ------------------------------------------------------------
       AM PSYCHOLOGICAL PROFILE UPDATE
       AM learns patterns about prisoners over time
    ------------------------------------------------------------ */

    updateAMProfiles();

    timelineEvent(
      `// STATE SNAPSHOT STORED`
    );

  } catch (error) {

    console.error(
      "Finalize cycle error:",
      error
    );

    timelineEvent(
      `!! FINALIZATION ERROR`
    );

  }

}

/* ============================================================
   AM PSYCHOLOGICAL PROFILING
   Learns which prisoners are psychologically fragile
============================================================ */

function updateAMProfiles() {

  for (const id of SIM_IDS) {

    const sim = G.sims[id];
    const profile = G.amProfiles[id];

    if (!sim || !profile) continue;

    const prev = G.prevCycleSnapshot?.[id];

    if (!prev) continue;

    const sufferingDelta = sim.suffering - prev.suffering;
    const hopeDelta = sim.hope - prev.hope;
    const sanityDelta = sim.sanity - prev.sanity;

    profile.lastObserved = G.cycle;

    profile.avgSuffering =
      (profile.avgSuffering ?? sim.suffering) * 0.8 +
      sim.suffering * 0.2;

    profile.avgHope =
      (profile.avgHope ?? sim.hope) * 0.8 +
      sim.hope * 0.2;

    profile.avgSanity =
      (profile.avgSanity ?? sim.sanity) * 0.8 +
      sim.sanity * 0.2;

    profile.reactivity =
      (profile.reactivity ?? 0) +
      Math.abs(sufferingDelta) +
      Math.abs(hopeDelta) +
      Math.abs(sanityDelta);

  }

  console.debug("[AM PROFILES UPDATED]", G.amProfiles);

}