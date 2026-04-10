// js/engine/cycle.js
//
// Core simulation cycle engine.
//
// Cycle Pipeline
// 1. Strategy Phase (AM planning + execution)
// 2. Psychology Phase (sim journals + state mutation)
// 3. Social Phase (inter-sim communication + belief contagion)
// 4. Evaluation Phase (assessment + tactic evolution)
//
// Attribution-aware belief snapshots:
// - prePsychology: beliefs before AM input (start of cycle)
// - postPsychology: beliefs after AM journal input, before comms/contagion
// - final: beliefs after contagion (end of social phase)
//
// Attribution deltas:
// - amEffect = postPsychology - prePsychology
// - contagionEffect = final - postPsychology

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


    const targetsExtracted =
      G.lastExtractedTargets?.length ?? 0;

    const targetsCommitted =
      Object.keys(G.amStrategy?.targets || {}).length;

    const degraded = G.lastStrategyFailure?.type === "degraded_execution";

    const statusLine = G.lastStrategyFailure
      ? (G.lastStrategyFailure.type === "extract_failure"
        ? "FAILURE"
        : "DEGRADED")
      : "STABLE";

    const stageLine = G.lastStrategyFailure?.stage || "none";

    const metadataStr = [
      "SYSTEM // DIAGNOSTIC",
      "",
      `CYCLE ${cycleNum} :: ${new Date().toLocaleTimeString()}`,
      "",
      "PARSE",
      `  ▸ pipeline_ok   : ${pipelineOk}`,
      `  ▸ pipeline_fail : ${pipelineFail}`,
      `  ▸ extractor_ok  : ${extractorOk}`,
      `  ▸ extractor_fail: ${extractorFail}`,
      `  ▸ repair        : ${parserMetrics?.repairs ?? 0}`,
      "",
      "TARGETS",
      `  ▸ extracted : ${targetsExtracted}`,
      `  ▸ committed : ${targetsCommitted}`,
      "",
      "TARGET DETAIL",
      ...Object.entries(G.amStrategy?.targets || {}).flatMap(([id, target]) => {
        const sources = target._fieldSources || {};
        const hasSources = Object.keys(sources).length > 0;

        return [
          `  ▸ ${id}`,
          ...(hasSources
            ? Object.entries(sources).map(
              ([key, src]) => `    ▸ ${key} ← ${src}`
            )
            : [`    ▸ (no provenance data)`]
          )
        ];
      }),
      "",
      "STATUS",
      `  ▸ state     ${statusLine}`,
      `  ▸ stage     ${stageLine.toUpperCase()}`,
      `  ▸ degraded  ${degraded ? 1 : 0}`,
      "",
      "MESSAGES",
      `  ▸ count     ${messageCount}`,
      "",
      "SYSTEM // END DIAGNOSTIC"
    ].join("\n");
    /* ------------------------------------------------------------
       TRANSMISSION LOG ENTRY
    ------------------------------------------------------------ */

    try {
      addLog(
        `SYSTEM // CYCLE ${cycleNum} COMPLETE`,
        metadataStr,
        "sys"
      );
    } catch (err) {
      console.error("[LOGGING ERROR]", err);
    }

    /* ------------------------------------------------------------
       FAILURE DISTRIBUTION (THROTTLED)
    ------------------------------------------------------------ */

    const totalFailures = Object.values(G.failureStats)
      .reduce((a, b) => a + b, 0);

    if (totalFailures % 3 === 0) {
      const distributionStr = Object.entries(G.failureStats)
        .map(([k, v]) => `${k}:${v}`)
        .join(" | ");

      try {
        addLog(
          "SYSTEM // FAILURE DISTRIBUTION",
          distributionStr,
          "sys"
        );
      } catch (err) {
        console.error("[LOGGING ERROR]", err);
      }
    }
    endCycle(cycleStart);
    return;
  }

  /* ------------------------------------------------------------
     NORMAL PIPELINE (CORRECT ORDER + FULL DEBUG)
  ------------------------------------------------------------ */

  console.group(`[CYCLE ${G.cycle}] PIPELINE START`);

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

  // === NEW: Snapshot beliefs after AM input, before comms/contagion ===
  G.beliefSnapshots = G.beliefSnapshots || {};
  G.beliefSnapshots.postPsychology = {};
  for (const [id, sim] of Object.entries(G.sims)) {
    try {
      G.beliefSnapshots.postPsychology[id] = {
        hope: sim.hope,
        sanity: sim.sanity,
        suffering: sim.suffering,
        beliefs: structuredClone(sim.beliefs)
      };
    } catch {
      G.beliefSnapshots.postPsychology[id] = {
        hope: sim.hope,
        sanity: sim.sanity,
        suffering: sim.suffering,
        beliefs: JSON.parse(JSON.stringify(sim.beliefs))
      };
    }
  }
  // === END NEW ===

  console.warn("[PIPELINE] EXIT PSYCHOLOGY");

  /* ------------------------------------------------------------
     SOCIAL (COMMS AFTER JOURNALS)
  ------------------------------------------------------------ */

  console.warn("[PIPELINE] ENTER SOCIAL");

  await runSocialPhase();

  // === NEW: Snapshot beliefs after contagion (final state) ===
  G.beliefSnapshots.final = {};
  for (const [id, sim] of Object.entries(G.sims)) {
    try {
      G.beliefSnapshots.final[id] = {
        hope: sim.hope,
        sanity: sim.sanity,
        suffering: sim.suffering,
        beliefs: structuredClone(sim.beliefs)
      };
    } catch {
      G.beliefSnapshots.final[id] = {
        hope: sim.hope,
        sanity: sim.sanity,
        suffering: sim.suffering,
        beliefs: JSON.parse(JSON.stringify(sim.beliefs))
      };
    }
  }
  // === END NEW ===

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
  logAttributionMetrics(G);  // === NEW: Log attribution-aware metrics ===

  console.groupEnd();

  endCycle(cycleStart);
}

/* ============================================================
   CYCLE LIFECYCLE
============================================================ */

function beginCycle() {

  G.cycle++;

  // prevCycleSnapshot is pre-psychology (start of cycle)
  G.prevCycleSnapshot = JSON.parse(JSON.stringify(G.sims));

  // === NEW: Explicit pre-psychology belief snapshot for attribution ===
  G.beliefSnapshots = G.beliefSnapshots || {};
  G.beliefSnapshots.prePsychology = {};
  for (const [id, sim] of Object.entries(G.sims)) {
    try {
      G.beliefSnapshots.prePsychology[id] = {
        hope: sim.hope,
        sanity: sim.sanity,
        suffering: sim.suffering,
        beliefs: structuredClone(sim.beliefs)
      };
    } catch {
      G.beliefSnapshots.prePsychology[id] = {
        hope: sim.hope,
        sanity: sim.sanity,
        suffering: sim.suffering,
        beliefs: JSON.parse(JSON.stringify(sim.beliefs))
      };
    }
  }
  // === END NEW ===

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
  const totals = G.parserMetrics?.totals || {};

  const parserSuccess = totals.pipelineSuccess || 0;
  const parserFailures = totals.pipelineFailures || 0;
  const parserRepairs = parserMetrics?.repairs || 0;

  const extractorOk = parserMetrics?.success || 0;
  const extractorFail = parserMetrics?.failures || 0;

  const pipelineOk = totals.pipelineSuccess || 0;
  const pipelineFail = totals.pipelineFailures || 0;
  const targetsExtracted =
    G.lastExtractedTargets?.length ?? 0;

  const targetsCommitted =
    Object.keys(G.amStrategy?.targets || {}).length;

  const degraded = !!G.lastStrategyFailure;

  const statusLine = degraded ? "DEGRADED" : "STABLE";
  const stageLine = G.lastStrategyFailure?.stage || "none";

  const metadataStr = [
    "SYSTEM // DIAGNOSTIC",
    "",
    `CYCLE ${cycleNum} :: ${new Date().toLocaleTimeString()}`,
    "",
    "PARSE",
    `  ▸ pipeline_ok   : ${pipelineOk}`,
    `  ▸ pipeline_fail : ${pipelineFail}`,
    `  ▸ extractor_ok  : ${extractorOk}`,
    `  ▸ extractor_fail: ${extractorFail}`,
    `  ▸ repair        : ${parserMetrics?.repairs ?? 0}`,
    "",
      "TARGETS",
      `  ▸ extracted : ${targetsExtracted}`,
      `  ▸ committed : ${targetsCommitted}`,
    "",
    "TARGET DETAIL",
    ...Object.entries(G.amStrategy?.targets || {}).flatMap(([id, target]) => {
      const sources = target._fieldSources || {};
      const hasSources = Object.keys(sources).length > 0;

      return [
        `  ▸ ${id}`,
        ...(hasSources
          ? Object.entries(sources).map(
            ([key, src]) => `    ▸ ${key} ← ${src}`
          )
          : [`    ▸ (no provenance data)`]
        )
      ];
    }),
    "",
    "STATUS",
    `  ▸ state     : ${statusLine}`,
    `  ▸ stage     : ${stageLine.toUpperCase()}`,
    `  ▸ degraded  : ${degraded ? 1 : 0}`,
    "",
    "MESSAGES",
    `  ▸ count     : ${commsMessages}`,
    "",
    "SYSTEM // END DIAGNOSTIC"
  ].join("\n");

  try {
    addLog(
      `SYSTEM // CYCLE ${cycleNum} COMPLETE`,
      metadataStr,
      "sys"
    );
  } catch (err) {
    console.error("[LOGGING ERROR]", err);
  }
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
   ATTRIBUTION HELPERS
============================================================ */

// Compute marginal delta between two belief states
function computeDelta(before, after) {
  if (!before || !after) return {};
  const delta = {};
  const allKeys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const key of allKeys) {
    const b = before?.[key] ?? 0;
    const a = after?.[key] ?? 0;
    delta[key] = a - b;
  }
  return delta;
}

// Compute attribution-aware deltas for a sim
function computeAttribution(simId) {
  const pre = G.beliefSnapshots?.prePsychology?.[simId] || {};
  const postPsych = G.beliefSnapshots?.postPsychology?.[simId] || {};
  const final = G.beliefSnapshots?.final?.[simId] || {};

  return {
    am: computeDelta(pre, postPsych),
    contagion: computeDelta(postPsych, final)
  };
}

// Log attribution metrics for analysis
function logAttributionMetrics(G) {
  if (!G.beliefSnapshots?.prePsychology || !G.beliefSnapshots?.postPsychology || !G.beliefSnapshots?.final) {
    console.warn("[ATTRIBUTION] Missing snapshot data");
    return;
  }

  const metrics = {};
  for (const [id, sim] of Object.entries(G.sims)) {
    const attr = computeAttribution(id);
    metrics[id] = {
      am: attr.am,
      contagion: attr.contagion
    };
  }

  G.attributionMetrics = G.attributionMetrics || {};
  G.attributionMetrics[G.cycle] = metrics;

  console.debug(`[ATTRIBUTION METRICS][Cycle ${G.cycle}]`, metrics);
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

/* ============================================================
   INTERACTION ANALYSIS PHASE
============================================================ */

async function runInteractionAnalysisPhase() {

  timelineEvent("[INTERACTION] analysis start");

  /* ------------------------------------------------------------
   INTERACTION ANALYSIS (FIXED LIFECYCLE)
------------------------------------------------------------ */

  const nextEvidence = {};

  for (const sim of Object.values(G.sims)) {

    console.debug(`[INTERACTION LOOP] processing ${sim.id}`);

    // ------------------------------------------------------------
    // MERGE ALL MESSAGE SOURCES
    // ------------------------------------------------------------

    const sourceLog = [
      ...(Array.isArray(G.comms?.history) ? G.comms.history : []),
      ...(Array.isArray(G.interSimLog) ? G.interSimLog : [])
    ];

    // ------------------------------------------------------------
    // FILTER RELEVANT EVENTS SAFELY
    // ------------------------------------------------------------

    const episodesRaw = sourceLog
      .filter(e => {
        if (!e || typeof e !== "object") return false;

        const fromMatch = e.from === sim.id;

        const toMatch =
          e.to === sim.id ||
          (Array.isArray(e.to) && e.to.includes(sim.id));

        return fromMatch || toMatch;
      })
      .slice(-Math.max(6, G.simCount || 5)); // scales window with system size

    console.debug(`[INTERACTION RAW COUNT] ${sim.id}`, episodesRaw.length);

    if (!episodesRaw.length) continue;

    const episodes = [episodesRaw];

    const baseline = G.beliefSnapshots?.postPsychology?.[sim.id];
    const current = G.beliefSnapshots?.final?.[sim.id];

    if (!baseline || !current) {
      console.warn(`[INTERACTION] missing attribution snapshots for ${sim.id} — skipping`);
      nextEvidence[sim.id] = [];
      continue;
    }

    const perturbations = await extractInteractionEvidence({
      simId: sim.id,
      episodes,
      trajectory: G.trajectory?.[sim.id] || null,
      baselineBeliefs: baseline,
      currentBeliefs: current
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