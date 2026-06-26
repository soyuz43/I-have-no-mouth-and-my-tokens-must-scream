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

/* ============================================================
   EVALUATION PHASE ORCHESTRATOR
   ============================================================ */

export async function runEvaluationPhase() {

  let assessmentResults = [];

  /* ------------------------------------------------------------
     ASSESSMENT PHASE
     Compare intent vs results
  ------------------------------------------------------------ */

  try {

    timelineEvent(`>>> CYCLE ASSESSMENT`);

    assessmentResults =
      await runAssessment();

    /*
     * Constraint assessment has now had the opportunity to renew each
     * completed constraint or explicitly release it.
     *
     * Remove only constraints whose current-cycle assessment selected
     * RELEASE. Unassessed zero-remaining constraints are preserved.
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

            decision:
              constraint.lastAssessment
                ?.decision ?? null,

            assessedCycle:
              constraint.lastAssessment
                ?.cycle ?? null
          });
        }
      }
    }

    if (releasedConstraints.length) {
      console.log(
        "[CONSTRAINT][POST-ASSESSMENT CLEANUP]"
      );

      console.table(
        releasedConstraints
      );
    }

    timelineEvent(`// ASSESSMENT COMPLETE`);

  } catch (e) {

    console.error("Assessment error:", e);

    timelineEvent(`!! ASSESSMENT ERROR`);

  }

  /* ------------------------------------------------------------
   TACTIC RUNTIME TRANSITIONS
   Validate and apply assessment recommendations
------------------------------------------------------------ */

  try {

    timelineEvent(
      `>>> TACTIC RUNTIME TRANSITIONS`
    );

    const transitions =
      applyTacticRuntimeTransitions(
        assessmentResults
      );

    if (transitions.length) {

      console.group(
        "[TACTIC RUNTIME TRANSITIONS]"
      );

      console.table(
        transitions.map(
          (transition) => ({
            target:
              transition.targetId,

            tactic:
              transition.tacticPath,

            recommended:
              transition.recommendedDecision,

            applied:
              transition.appliedDecision,

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
        "[TACTIC RUNTIME TRANSITIONS] No assessment results to apply."
      );

    }

    timelineEvent(
      `// TACTIC RUNTIME TRANSITIONS COMPLETE`
    );

  } catch (e) {

    console.error(
      "Tactic runtime transition error:",
      e
    );

    timelineEvent(
      `!! TACTIC RUNTIME TRANSITION ERROR`
    );

  }

  /* ------------------------------------------------------------
     TACTIC EVOLUTION
     Discover new tactics from strong effects
  ------------------------------------------------------------ */

  try {

    timelineEvent(`>>> TACTIC EVOLUTION`);

    await runTacticEvolution();

    timelineEvent(`// TACTIC EVOLUTION COMPLETE`);

  } catch (e) {

    console.error("Tactic evolution error:", e);

    timelineEvent(`!! TACTIC EVOLUTION ERROR`);

  }

  /* ------------------------------------------------------------
     FINALIZATION
  ------------------------------------------------------------ */

  try {

    timelineEvent(`>>> FINALIZING CYCLE`);

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

    timelineEvent(`// STATE SNAPSHOT STORED`);

  } catch (e) {

    console.error("Finalize cycle error:", e);

    timelineEvent(`!! FINALIZATION ERROR`);

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