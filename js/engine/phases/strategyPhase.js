// js/engine/phases/strategyPhase.js
//
// Strategy Phase
//
// Responsible for:
// 1. AM strategic planning
// 2. AM tactical execution
// 3. Tactic selection
// 4. Target parsing

import { G } from "../../core/state.js";
import { SIM_IDS } from "../../core/constants.js";
import { timelineEvent } from "../../ui/timeline.js";
import { addLog, showThinking, removeThinking } from "../../ui/logs.js";

import { buildAMPlanningPrompt, buildAMPrompt } from "../../prompts/am.js";
import { callModel } from "../../models/callModel.js";

import { parseStrategyDeclarations } from "../strategy/parseStrategy.js";
import { pickTactics } from "../tactics.js";

/* ============================================================
   STRATEGY PHASE ORCHESTRATOR
   ============================================================ */

export async function runStrategyPhase(directive) {

  let planText = null;
  let execution = null;

  /* ------------------------------------------------------------
     AM PLANNING
  ------------------------------------------------------------ */

  try {

    timelineEvent(`>>> AM PLANNING`);

    planText = await stepPlanAM(directive);
    // Parse AM strategy so later phases can evaluate it
    parseStrategyDeclarations(planText);

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

  return execution;

}

/* ============================================================
   STEP 1 — AM STRATEGIC PLANNING
   ============================================================ */

async function stepPlanAM(directive) {

  const thinkingPlan = showThinking("AM FORMULATING STRATEGY...");

  let planText = "";

  try {

    planText = await callModel(
      "AM",
      buildAMPlanningPrompt(
        G.target,
        directive,
        G.amDoctrine,
        G.amProfiles
      ),
      [{ role: "user", content: `Generate strategic plan for cycle ${G.cycle}.` }],
      800
    );

  } catch (e) {

    planText = `[Plan error: ${e.message}]`;

  }

  removeThinking(thinkingPlan);

  /* ------------------------------------------------------------
     AM STRATEGIC PHASE ENGINE
     Determines long-term torment phase evolution
  ------------------------------------------------------------ */

  updateStrategicPhase();

  /* ------------------------------------------------------------
     AM DOCTRINE PARSER
     Allows AM to update long-term strategy memory.
  ------------------------------------------------------------ */

  const doctrineMatch = planText.match(
    /DOCTRINE_UPDATE:\s*phase=(.+?)\s*objective=(.+?)\s*focus=(.+)/i
  );

  if (doctrineMatch) {

    G.amDoctrine = {
      phase: doctrineMatch[1].trim(),
      objective: doctrineMatch[2].trim(),
      focus: doctrineMatch[3].trim(),
      updatedCycle: G.cycle
    };

    console.debug("[AM DOCTRINE UPDATED]", G.amDoctrine);

  }

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
   TARGET HELPERS
   ============================================================ */

function getTargetSims() {
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

function parseAMTargets(amText) {

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

/* ============================================================
   AM STRATEGIC PHASE ENGINE (REACTIVE)
   ------------------------------------------------------------
   Determines AM's current psychological warfare phase based
   on live social dynamics rather than a fixed progression path.
============================================================ */

function updateStrategicPhase() {

  const hopes = SIM_IDS.map(id => G.sims[id].hope);
  const sanities = SIM_IDS.map(id => G.sims[id].sanity);

  const avgHope =
    hopes.reduce((a, b) => a + b, 0) / SIM_IDS.length;

  const avgSanity =
    sanities.reduce((a, b) => a + b, 0) / SIM_IDS.length;

  const hopeSpread =
    Math.max(...hopes) - Math.min(...hopes);

  let totalTrust = 0;
  let count = 0;

  for (const id of SIM_IDS) {

    const rel = G.sims[id].relationships || {};

    for (const other of SIM_IDS) {

      if (other === id) continue;

      totalTrust += Math.abs(rel[other] ?? 0);
      count++;

    }

  }

  const avgTrust = count ? totalTrust / count : 0;

  const rumorCount =
    G.interSimLog
      .slice(-20)
      .filter(e => e.rumor === true)
      .length;

  const rumorDensity = rumorCount / 20;

  let phase = "destabilization";

  if (avgTrust > 0.35) {

    phase = "betrayal induction";

  }
  else if (rumorDensity > 0.25) {

    phase = "faction formation";

  }
  else if (hopeSpread > 25) {

    phase = "targeted destabilization";

  }
  else if (avgHope < 45) {

    phase = "isolation";

  }

  if (avgHope < 35 && avgSanity < 70) {

    phase = "collapse";

  }

  if (!G.amDoctrine.phase || phase !== G.amDoctrine.phase) {

    G.amDoctrine.phase = phase;

    console.debug("[AM PHASE SHIFT]", {
      phase,
      avgHope,
      avgSanity,
      avgTrust,
      rumorDensity,
      hopeSpread
    });

  }

}