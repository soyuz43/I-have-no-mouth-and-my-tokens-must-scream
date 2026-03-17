// js/engine/phases/evaluationPhase.js
//
// Evaluation Phase
//
// Responsible for:
// 1. Post-cycle assessment
// 2. Tactic evolution
// 3. AM psychological profiling
// 4. Debug relationship inspection

import { G } from "../../core/state.js";
import { SIM_IDS } from "../../core/constants.js";

import { timelineEvent } from "../../ui/timeline.js";
import { renderRelationships } from "../../ui/relationships.js";

import { runAssessment } from "../analysis/assessment.js";
import { runTacticEvolution } from "../analysis/tacticEvolution.js";
import { printRelationshipMatrix } from "../analysis/relationshipMatrix.js";

/* ============================================================
   EVALUATION PHASE ORCHESTRATOR
   ============================================================ */

export async function runEvaluationPhase() {

  /* ------------------------------------------------------------
     ASSESSMENT PHASE
     Compare intent vs results
  ------------------------------------------------------------ */

  try {

    timelineEvent(`>>> CYCLE ASSESSMENT`);

    await runAssessment();

    timelineEvent(`// ASSESSMENT COMPLETE`);

  } catch (e) {

    console.error("Assessment error:", e);

    timelineEvent(`!! ASSESSMENT ERROR`);

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