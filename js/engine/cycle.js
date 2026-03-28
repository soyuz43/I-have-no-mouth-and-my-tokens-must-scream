// js/engine/cycle.js
//
// Core simulation cycle engine.
//
// Cycle Pipeline
// 1. Strategy Phase (AM planning + execution)
// 2. Psychology Phase (sim journals + state mutation)
// 3. Social Phase (inter-sim communication + belief contagion)
// 4. Evaluation Phase (assessment + tactic evolution)

import { G } from "../core/state.js";
import { timelineEvent } from "../ui/timeline.js";

import { runStrategyPhase } from "./phases/strategyPhase.js";
import { runPsychologyPhase } from "./phases/psychologyPhase.js";
import { runSocialPhase } from "./phases/socialPhase.js";
import { runEvaluationPhase } from "./phases/evaluationPhase.js";
import { logBeliefMetrics } from "./state/commit.js";
/* ============================================================
   MAIN CYCLE CONTROLLER
   ============================================================ */

export async function runCycle() {

  const cycleStart = performance.now();

  beginCycle();

  const directive = getDirective();

  let execution = null;

  /* ------------------------------------------------------------
     STRATEGY PHASE
  ------------------------------------------------------------ */

  execution = await runStrategyPhase(directive);

  /* ------------------------------------------------------------
     PSYCHOLOGY PHASE
  ------------------------------------------------------------ */

  await runPsychologyPhase(execution);

  /* ------------------------------------------------------------
  SOCIAL PHASE
  ------------------------------------------------------------ */

  await runSocialPhase();

  /* ------------------------------------------------------------
  EVALUATION PHASE
  ------------------------------------------------------------ */

  await runEvaluationPhase();

  logBeliefMetrics(G);
  endCycle(cycleStart);

}

/* ============================================================
   CYCLE LIFECYCLE
   ============================================================ */

function beginCycle() {

  G.cycle++;

  /* ------------------------------------------------------------
     SNAPSHOT PREVIOUS STATE
     (Used later for delta analysis)
  ------------------------------------------------------------ */

  G.prevCycleSnapshot = JSON.parse(JSON.stringify(G.sims));

  timelineEvent(`===== CYCLE ${G.cycle} START =====`);

  updateCycleHeader();

}

function endCycle(cycleStart) {
  const durationMs = performance.now() - cycleStart;
  const totalSeconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const runtimeStr = `${minutes}m ${seconds}s`;

  timelineEvent(`// CYCLE ${G.cycle} RUNTIME ${runtimeStr}`);

  for (const id of Object.keys(G.sims)) {
    console.log(
      `[TACTIC HISTORY][C${G.cycle}] ${id}`,
      JSON.stringify(G.sims[id]?.tacticHistory?.slice(-2), null, 2)
    );
  }

  timelineEvent(`===== CYCLE ${G.cycle} END =====`);
  timelineEvent(` `);
}

/* ============================================================
   UTILITIES
   ============================================================ */

function updateCycleHeader() {

  const el = document.getElementById("h-cycle");

  if (el) el.textContent = G.cycle;

}

function getDirective() {

  const el = document.getElementById("ctrl-ta");

  return el ? el.value.trim() : "";

}

/* ============================================================
   EXECUTION ENTRY POINT
   ============================================================ */

export async function executeMain() {

  const execBtn = document.getElementById("exec-btn");

  if (G.mode === "autonomous") {

    if (G.autoRunning) {

      clearTimeout(G.autoTimer);

      G.autoRunning = false;

      execBtn.textContent = "⚡ EXECUTE ⚡";

      execBtn.classList.remove("running");

      return;

    }

    G.autoRunning = true;

    execBtn.textContent = "⛔ HALT ⛔";

    execBtn.classList.add("running");

    autonomousLoop();

    return;

  }

  execBtn.disabled = true;

  await runCycle();

  execBtn.disabled = false;

}

/* ============================================================
   AUTONOMOUS LOOP
   ============================================================ */

async function autonomousLoop() {

  if (!G.autoRunning) return;

  await runCycle();

  if (G.autoRunning) {

    G.autoTimer = setTimeout(
      autonomousLoop,
      22000
    );

  }

}