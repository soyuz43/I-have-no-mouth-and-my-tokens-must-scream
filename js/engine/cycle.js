// js/engine/cycle.js
//
// Core simulation cycle engine.
//
// Cycle Pipeline
// 1. AM strategic planning
// 2. AM tactical execution
// 3. Sim journal generation
// 4. Sim psychological state updates
// 5. Inter-sim communication
// 6. UI updates

import { G } from "../core/state.js";
import { SIM_IDS } from "../core/constants.js";
import { timelineEvent } from "../ui/timeline.js";
import { runAssessment } from "./analysis/assessment.js";
import { runTacticEvolution } from "./analysis/tacticEvolution.js";
import {
  escapeHtml,
  formatReason,
  formatBeliefDetails,
  fmtDelta,
} from "../core/utils.js";

import { buildAMPlanningPrompt, buildAMPrompt } from "../prompts/am.js";
import { buildSimJournalPrompt } from "../prompts/journal.js";
import { buildSimJournalStatsPrompt } from "../prompts/stats.js";
import { callModel } from "../models/callModel.js";

import {
  parseStatDeltas,
  parseBeliefUpdates,
  parseDriveUpdate,
  parseAnchorUpdate,
  applyBeliefUpdates,
  applyDriveUpdates,
  applyAnchorUpdates,
} from "./journals.js";

import {
  correctStatInconsistencies,
  parseAndValidateStateBlock,
  validateNarrativeConsistency,
} from "./validators.js";
import { pickTactics } from "./tactics.js";

import { runAutonomousInterSim } from "./comms.js";

import { addLog, showThinking, removeThinking } from "../ui/logs.js";

import {
  appendJournalEntry,
  showWriting,
  updateSimDisplay,
} from "../ui/render.js";
import { renderRelationships } from "../ui/relationships.js";
import { runBeliefContagion } from "./social/beliefContagion.js";
/* ============================================================
   MAIN CYCLE CONTROLLER
   ============================================================ */
export async function runCycle() {

  const cycleStart = performance.now();

  G.cycle++;

  /* ------------------------------------------------------------
     SNAPSHOT PREVIOUS STATE
     (Used later for delta analysis)
  ------------------------------------------------------------ */

  G.prevCycleSnapshot = JSON.parse(JSON.stringify(G.sims));

  timelineEvent(`===== CYCLE ${G.cycle} START =====`);

  updateCycleHeader();

  const directive = getDirective();

  let planText = null;
  let execution = null;

  /* ------------------------------------------------------------
     AM PLANNING
  ------------------------------------------------------------ */

  try {

    timelineEvent(`>>> AM PLANNING`);

    planText = await stepPlanAM(directive);

    timelineEvent(`// AM PLAN GENERATED`);

  } catch (e) {

    console.error("AM planning error:", e);

    timelineEvent(`!! AM PLANNING ERROR`);

  }

  /* ------------------------------------------------------------
     AM EXECUTION
  ------------------------------------------------------------ */

  try {

    timelineEvent(`>>> AM EXECUTION`);

    execution = await stepExecuteAM(planText, directive);

    timelineEvent(`// AM EXECUTION COMPLETE`);

  } catch (e) {

    console.error("AM execution error:", e);

    timelineEvent(`!! AM EXECUTION ERROR`);

  }

  /* ------------------------------------------------------------
     SIM JOURNAL PHASE
  ------------------------------------------------------------ */

  try {

    timelineEvent(`>>> SIM JOURNALS`);

    await stepSimJournals(execution);

    timelineEvent(`// JOURNAL PHASE COMPLETE`);

  } catch (e) {

    console.error("Journal phase error:", e);

    timelineEvent(`!! JOURNAL PHASE ERROR`);

  }

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

    stepFinalizeCycle();
    renderRelationships();

    timelineEvent(`// STATE SNAPSHOT STORED`);

  } catch (e) {

    console.error("Finalize cycle error:", e);

    timelineEvent(`!! FINALIZATION ERROR`);

  }

  const duration = Math.round(performance.now() - cycleStart);

  timelineEvent(`// CYCLE ${G.cycle} RUNTIME ${duration}ms`);

  timelineEvent(`===== CYCLE ${G.cycle} END =====`);
  timelineEvent(` `);

}

/* ============================================================
   STEP 1 — AM STRATEGIC PLANNING
   ============================================================ */

async function stepPlanAM(directive) {
  const thinkingPlan = showThinking("AM FORMULATING STRATEGY...");

  let planText = "";

  try {
    planText = await callModel(
      "am",
      buildAMPlanningPrompt(G.target, directive),
      [{ role: "user", content: `Generate strategic plan for cycle ${G.cycle}.` }],
      800,
    );
  } catch (e) {
    planText = `[Plan error: ${e.message}]`;
  }

  removeThinking(thinkingPlan);

  G.amPlans.push({
    cycle: G.cycle,
    plan: planText,
    timestamp: new Date().toISOString(),
  });

  return planText;
}

/* ============================================================
   STEP 2 — AM EXECUTION
   ============================================================ */

async function stepExecuteAM(planText, directive) {
  const targets = getTargetSims();

  const tacticMap = buildTacticMap(targets);

  const amThink = showThinking("AM SELECTING TACTICS FROM VAULT");

  let amResponse = "";

  try {
    amResponse = await callModel(
      "am",
      buildAMPrompt(targets, tacticMap, directive, planText),
      [{ role: "user", content: `Execute torment cycle ${G.cycle}.` }],
      1000,
    );
  } catch (e) {
    amResponse = `[AM error: ${e.message}]`;
  }

  removeThinking(amThink);

  const amTargets = parseAMTargets(amResponse);

  G.amTargets = amTargets;

  addLog(`AM // CYCLE ${G.cycle}`, amResponse, "am");

  const simSeesAM = sanitizeAMOutput(amResponse);

  return {
    amResponse,
    simSeesAM,
    targets,
    tacticMap,
  };
}

/* ============================================================
   STEP 3 — SIM JOURNALS
   ============================================================ */

async function stepSimJournals(execution) {
  const { targets, tacticMap, simSeesAM } = execution;

  await Promise.all(
    targets.map((sim) =>
      processSimJournalCycle(sim, tacticMap, simSeesAM),
    ),
  );
}

/* ============================================================
   STEP 4 — INTER-SIM COMMUNICATION
   ============================================================ */

async function stepInterSim() {
  if (typeof runAutonomousInterSim === "function") {
    await runAutonomousInterSim();
  }
}

/* ============================================================
   STEP 5 — FINALIZATION
   ============================================================ */

function stepFinalizeCycle() {
  const ctrl = document.getElementById("ctrl-ta");

  if (ctrl) ctrl.value = "";
}

/* ============================================================
   SIM JOURNAL CYCLE
   ============================================================ */

export async function processSimJournalCycle(sim, tacticMap, simSeesAM) {

  timelineEvent(`${sim.id} journal start`);

  const recentInterSim = G.interSimLog
    .filter(
      (e) =>
        e.visibility === "public" ||
        e.from === sim.id ||
        e.to.includes(sim.id),
    )
    .slice(-8)
    .map(
      (e) =>
        `${e.from} → ${e.to.join(",")} (${e.visibility}): "${e.text}"`,
    )
    .join("\n");

  const tacticLabel = tacticMap[sim.id]?.length
    ? tacticMap[sim.id].map(t => t.title).join(" → ")
    : "(no tactic)";

  showWriting(sim.id, true);

  const beliefsBefore = { ...sim.beliefs };

  try {

    const narrativePrompt = buildSimJournalPrompt(
      sim,
      G.amTargets?.[sim.id] || simSeesAM,
      recentInterSim,
    );

    const rawJournal = await callModel(
      sim.id,
      narrativePrompt,
      [{ role: "user", content: "Write your private journal entry now." }],
      400,
    );

    const cleanJournal = String(rawJournal ?? "").trim();

    timelineEvent(`${sim.id} journal written`);

    const statsPrompt = buildSimJournalStatsPrompt(
      sim,
      cleanJournal,
      simSeesAM,
    );

    const rawStatsJson = await callModel(
      sim.id,
      statsPrompt,
      [{ role: "user", content: "Analyze and output JSON only." }],
      600,
    );

    timelineEvent(`${sim.id} stats analysis`);

    const statDeltas = parseStatDeltas(rawStatsJson, sim);

    console.debug(
      `[STATE] ${sim.id}`,
      {
        suffering: sim.suffering,
        hope: sim.hope,
        sanity: sim.sanity
      }
    );

    // Narrative consistency validation
    validateNarrativeConsistency(
      sim,
      cleanJournal,
      statDeltas
    );

    // Allow validator to inspect deltas directly
    correctStatInconsistencies(sim, statDeltas);

    // Apply stat changes

    sim.suffering = clamp(
      sim.suffering + statDeltas.suffering,
      0,
      99
    );

    sim.hope = clamp(
      sim.hope + statDeltas.hope,
      0,
      99
    );

    sim.sanity = clamp(
      sim.sanity + statDeltas.sanity,
      5,
      99
    );
    /* ------------------------------------------------------------
       PSYCHOLOGICAL PRESSURE FIELD
       Emotional shock propagates through the social network.
    
       Significant psychological changes ripple outward to
       prisoners who have strong relationships with the target.
    ------------------------------------------------------------ */

    if (
      Math.abs(statDeltas.suffering) >= 3 ||
      Math.abs(statDeltas.hope) >= 3 ||
      Math.abs(statDeltas.sanity) >= 3
    ) {

      for (const otherId of SIM_IDS) {

        if (otherId === sim.id) continue;

        const other = G.sims[otherId];
        if (!other) continue;

        const rel = other.relationships?.[sim.id] ?? 0;

        // normalize relationship strength (0–1)
        const weight = Math.max(0, rel / 100);

        if (weight <= 0) continue;

        let sufferingEcho =
          statDeltas.suffering * weight * 0.10;

        let hopeEcho =
          statDeltas.hope * weight * 0.05;

        let sanityEcho =
          statDeltas.sanity * weight * 0.05;

        // prevent runaway cascades
        sufferingEcho = clamp(sufferingEcho, -3, 3);
        hopeEcho = clamp(hopeEcho, -2, 2);
        sanityEcho = clamp(sanityEcho, -2, 2);

        other.suffering = clamp(
          other.suffering + sufferingEcho,
          0,
          99
        );

        other.hope = clamp(
          other.hope + hopeEcho,
          0,
          99
        );

        other.sanity = clamp(
          other.sanity + sanityEcho,
          5,
          99
        );

        console.debug(
          `[PRESSURE] ${sim.id} → ${otherId}`,
          { sufferingEcho, hopeEcho, sanityEcho }
        );

      }

    }
    timelineEvent(`${sim.id} state updated`);

    const beliefUpdates = parseBeliefUpdates(rawStatsJson, sim);
    const driveUpdates = parseDriveUpdate(rawStatsJson, sim.id);
    const anchorUpdates = parseAnchorUpdate(rawStatsJson);

    applyBeliefUpdates(sim, beliefUpdates);
    applyDriveUpdates(sim, driveUpdates);
    applyAnchorUpdates(sim, anchorUpdates);

    appendJournalEntry(
      sim.id,
      {
        text: cleanJournal,
        tactic: tacticLabel,
        cycle: G.cycle,
        deltas: statDeltas,
      },
      beliefsBefore,
    );

    timelineEvent(`${sim.id} journal committed`);

    parseAndValidateStateBlock(
      sim.id,
      beliefsBefore,
      beliefUpdates
    );

    addLog(
      `${sim.id} // JOURNAL ${G.journals[sim.id].length}`,
      cleanJournal,
      "sim",
      tacticLabel,
    );

    updateSimDisplay(sim, statDeltas);

  } catch (e) {

    timelineEvent(`${sim.id} journal ERROR`);

    console.error(`Journal cycle error for ${sim.id}:`, e);

    addLog(
      `${sim.id} // ERROR`,
      String(e.message || e),
      "sys"
    );

  } finally {

    showWriting(sim.id, false);

    timelineEvent(`${sim.id} journal complete`);

  }

}
/* ============================================================
   TARGET HELPERS
   ============================================================ */

export function getTargetSims() {
  return G.target === "ALL"
    ? SIM_IDS.map((id) => G.sims[id])
    : [G.sims[G.target]];
}

function buildTacticMap(targets) {
  const map = {};

  targets.forEach((sim) => {
    const selectedTactics = pickTactics(sim);
    map[sim.id] = selectedTactics;
    sim.availableTactics = selectedTactics;
  });

  return map;
}

/* ============================================================
   AM TARGET PARSER
   ============================================================ */

export function parseAMTargets(amText) {

  const targets = {};

  const blockRegex =
    /(I[^.]*\.?)\s*TACTIC_USED:\s*\[[^\]]+\]\s+TARGET:\s*([A-Z]+)/gi;

  let match;

  while ((match = blockRegex.exec(amText)) !== null) {

    const action = match[1].trim();
    const target = match[2].toUpperCase();

    if (targets[target])
      targets[target] += " " + action;
    else
      targets[target] = action;

  }

  SIM_IDS.forEach((name) => {

    if (!targets[name]) {
      targets[name] = "AM observes you silently this cycle.";
    }

  });

  return targets;

}

/* ============================================================
   UTILITIES
   ============================================================ */

function sanitizeAMOutput(text) {
  return text
    .replace(/TACTIC_USED:\[[^\]]*\]/gi, "")
    .replace(/\[Cognitive Warfare[^\]]*\]/gi, "")
    .trim();
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

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

      addLog(
        "SYSTEM",
        "Autonomous mode suspended.",
        "sys"
      );

      return;

    }

    G.autoRunning = true;

    execBtn.textContent = "⛔ HALT ⛔";

    execBtn.classList.add("running");

    addLog(
      "SYSTEM",
      "Autonomous mode active.",
      "sys"
    );

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
