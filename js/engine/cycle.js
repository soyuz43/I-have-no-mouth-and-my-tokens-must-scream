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
import { addLog } from "../ui/logs.js";
import { runStrategyPhase } from "./phases/strategyPhase.js";
import { runPsychologyPhase } from "./phases/psychologyPhase.js";
import { runSocialPhase } from "./phases/socialPhase.js";
import { runEvaluationPhase } from "./phases/evaluationPhase.js";
import { logBeliefMetrics, logBeliefDynamics } from "./state/commit.js";
import { extractInteractionEvidence } from "./comms/analysis/extractInteractionEvidence.js";


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
     HARD FAIL: strategy must succeed
  ------------------------------------------------------------ */

  if (!execution) {
    console.error("[CYCLE] Strategy failed — aborting cycle");

    timelineEvent("!! CYCLE ABORTED (strategy failure)");

    const cycleNum = G.cycle;
    const parserMetrics = G.parserMetrics?.cycles?.[cycleNum] || {};

    const failureType = G.lastStrategyFailure?.type ?? "unknown";
    const failureStage = G.lastStrategyFailure?.stage ?? "unknown";

    const targetsDetected = Object.keys(G.amStrategy?.targets || {}).length;

    const messageCount =
      (G.interSimLog || []).filter(e => e.cycle === cycleNum).length;

    /* ------------------------------------------------------------
       AUTO-BUCKET FAILURE
    ------------------------------------------------------------ */

    if (!G.failureStats[failureType]) {
      G.failureStats[failureType] = 0;
    }
    G.failureStats[failureType]++;

    /* ------------------------------------------------------------
       FORMAT TERMINAL-STYLE OUTPUT
    ------------------------------------------------------------ */

    const metadataStr = [
      `cycle=${cycleNum}`,
      `directive="${(directive || "").slice(0, 60)}"`,
      `parse_ok=${parserMetrics.success ?? 0}`,
      `parse_fail=${parserMetrics.failures ?? 0}`,
      `parse_repair=${parserMetrics.repairs ?? 0}`,
      `failure=${failureType}`,
      `stage=${failureStage}`,
      `targets=${targetsDetected}`,
      `msgs=${messageCount}`
    ].join(" | ");

    /* ------------------------------------------------------------
       TRANSMISSION LOG ENTRY
    ------------------------------------------------------------ */

    addLog(
      `SYSTEM // CYCLE ${cycleNum} ABORTED`,
      `DIAGNOSTIC :: ${metadataStr}`,
      "sys"
    );

    /* ------------------------------------------------------------
       FAILURE DISTRIBUTION (THROTTLED)
    ------------------------------------------------------------ */

    const totalFailures = Object.values(G.failureStats)
      .reduce((a, b) => a + b, 0);

    if (totalFailures % 3 === 0) {
      const distributionStr = Object.entries(G.failureStats)
        .map(([k, v]) => `${k}:${v}`)
        .join(" | ");

      addLog(
        "SYSTEM // FAILURE DISTRIBUTION",
        distributionStr,
        "sys"
      );
    }
    endCycle(cycleStart);
    return;
  }
  /* ------------------------------------------------------------
     NORMAL PIPELINE (CORRECT ORDER + FULL DEBUG)
  ------------------------------------------------------------ */

  console.group(`[CYCLE ${G.cycle}] PIPELINE START`);

  console.debug("[DEBUG] execution object:", execution);
  console.debug("[DEBUG] execution?.targets:", execution?.targets);
  console.debug("[DEBUG] execution?.targets length:", execution?.targets?.length);
  console.debug("[DEBUG] G.amStrategy:", G.amStrategy);
  console.debug("[DEBUG] G.amStrategy.targets:", G.amStrategy?.targets);
  console.debug("[DEBUG] sims snapshot:", Object.keys(G.sims));

  /* ------------------------------------------------------------
     PSYCHOLOGY (JOURNALS FIRST)
  ------------------------------------------------------------ */

  console.warn("[PIPELINE] ENTER PSYCHOLOGY");

  if (!execution) {
    console.error("[PIPELINE] [X] execution is NULL — aborting psychology");
  } else if (!execution.targets || execution.targets.length === 0) {
    console.error("[PIPELINE] [X] execution.targets EMPTY — psychology will no-op");
  } else {
    console.debug("[PIPELINE] [Y] execution valid, running psychology");
  }

  await runPsychologyPhase(execution);

  console.warn("[PIPELINE] EXIT PSYCHOLOGY");

  /* ------------------------------------------------------------
     SOCIAL (COMMS AFTER JOURNALS)
  ------------------------------------------------------------ */

  console.warn("[PIPELINE] ENTER SOCIAL");

  await runSocialPhase();

  console.warn("[PIPELINE] EXIT SOCIAL");

  /* ------------------------------------------------------------
     INTERACTION ANALYSIS (AFTER COMMS)
  ------------------------------------------------------------ */

  console.warn("[PIPELINE] ENTER INTERACTION ANALYSIS");

  await runInteractionAnalysisPhase();

  console.warn("[PIPELINE] EXIT INTERACTION ANALYSIS");

  /* ------------------------------------------------------------
     EVALUATION
  ------------------------------------------------------------ */

  console.warn("[PIPELINE] ENTER EVALUATION");

  await runEvaluationPhase();

  console.warn("[PIPELINE] EXIT EVALUATION");

  /* ------------------------------------------------------------
     METRICS + FINALIZE
  ------------------------------------------------------------ */

  console.debug("[PIPELINE] belief metrics + dynamics");

  logBeliefMetrics(G);
  logBeliefDynamics(G);

  console.groupEnd();

  endCycle(cycleStart);
}

/* ============================================================
   CYCLE LIFECYCLE
============================================================ */

function beginCycle() {

  G.cycle++;

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

  const cycleNum = G.cycle;

  const commsMessages =
    (G.interSimLog || []).filter(e => e.cycle === cycleNum).length;

  const parserMetrics = G.parserMetrics?.cycles?.[cycleNum];
  const parserSuccess = parserMetrics?.success || 0;
  const parserFailures = parserMetrics?.failures || 0;
  const parserRepairs = parserMetrics?.repairs || 0;

  const metadata =
    `msg=${commsMessages} parse_ok=${parserSuccess} parse_fail=${parserFailures} parse_repair=${parserRepairs}`;

  addLog(
    `SYSTEM // CYCLE ${cycleNum} COMPLETE`,
    metadata,
    "sys"
  );
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

async function runInteractionAnalysisPhase() {

  timelineEvent("[INTERACTION] analysis start");

  /* ------------------------------------------------------------
   INTERACTION ANALYSIS (FIXED LIFECYCLE)
------------------------------------------------------------ */

  const nextEvidence = {};

  for (const sim of Object.values(G.sims)) {

    console.debug(`[INTERACTION LOOP] processing ${sim.id}`);

    const sourceLog =
      (G.comms?.history && G.comms.history.length)
        ? G.comms.history
        : (G.interSimLog || []);

    const episodesRaw = sourceLog
      .filter(e =>
        e.from === sim.id ||
        e.to === sim.id ||
        (Array.isArray(e.to) && e.to.includes(sim.id))
      )
      .slice(-6);

    console.debug(`[INTERACTION RAW COUNT] ${sim.id}`, episodesRaw.length);

    if (!episodesRaw.length) continue;

    const episodes = [episodesRaw];

    const perturbations = await extractInteractionEvidence({
      simId: sim.id,
      episodes,
      trajectory: G.trajectory?.[sim.id] || null,
      currentBeliefs: sim.beliefs
    });

    console.debug(`[INTERACTION RESULT] ${sim.id}`, perturbations);

    // ALWAYS store result — even empty
    nextEvidence[sim.id] = perturbations || [];

    if (!perturbations?.length) {
      console.debug(`[INTERACTION EMPTY] ${sim.id}`);
    } else {
      console.debug(`[COMMS EVIDENCE] ${sim.id}`, perturbations);
    }
  }

  /* ------------------------------------------------------------
      COMMIT AFTER LOOP
  ----------------------------------------------------------- */

  G.pendingBeliefEvidence = nextEvidence;

  console.debug("[INTERACTION FINAL STORE]", G.pendingBeliefEvidence);

  timelineEvent("[INTERACTION] analysis complete");
}