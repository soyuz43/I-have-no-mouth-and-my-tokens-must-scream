// js/engine/phases/socialPhase.js
//
// Social Phase
//
// Responsible for:
// 1. Inter-sim communication
// 2. Belief propagation across the social network

import { timelineEvent } from "../../ui/timeline.js";

import { runAutonomousInterSim } from "../comms.js";
import { runBeliefContagion } from "../social/beliefContagion.js";

/* ============================================================
   SOCIAL PHASE ORCHESTRATOR
   ============================================================ */

export async function runSocialPhase() {

  /* ------------------------------------------------------------
     INTER-SIM COMMUNICATION
  ------------------------------------------------------------ */

  try {

    timelineEvent(`>>> INTER-SIM COMMUNICATION`);

    await stepInterSim();

    timelineEvent(`// INTER-SIM COMPLETE`);

  } catch (e) {

    console.error("Inter-sim error:", e);

    timelineEvent(`!! INTER-SIM ERROR`);

  }

  /* ------------------------------------------------------------
     BELIEF CONTAGION
     Propagate beliefs across trust network
  ------------------------------------------------------------ */

  try {

    timelineEvent(`>>> BELIEF CONTAGION`);

    runBeliefContagion();

    timelineEvent(`// BELIEF CONTAGION COMPLETE`);

  } catch (e) {

    console.error("Belief contagion error:", e);

    timelineEvent(`!! BELIEF CONTAGION ERROR`);

  }

}

/* ============================================================
   STEP 4 — INTER-SIM COMMUNICATION
   ============================================================ */

async function stepInterSim() {

  if (typeof runAutonomousInterSim === "function") {

    await runAutonomousInterSim();

  }

}