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

import { runStrategyPipeline } from "../strategy/strategyPipeline.js";
import { pickTactics } from "../tactics.js";
import { applyConstraint, CONSTRAINT_LIBRARY } from "../constraints.js"; // <-- NEW IMPORT

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

    const result = runStrategyPipeline(planText);

    if (!result || result.status !== "success") {

      let failureType = "unknown";

      if (!result) {
        failureType = "runtime_error";
      } else if (result.stage === "extract") {
        failureType = "extract_failure";
      } else if (result.stage === "validate") {
        failureType = "validation_failure";
      } else if (result.targets?.length === 0) {
        failureType = "empty_targets";
      }

      G.lastStrategyFailure = {
        type: failureType,
        stage: result?.stage ?? "unknown",
        raw: result?.raw ?? null
      };

      console.warn("[STRATEGY PHASE] pipeline failed", {
        stage: result?.stage,
        error: result?.error,
        details: result
      });

      // Prevent downstream phases from using invalid strategy
      return;
    }

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

    const trajectorySummary = buildTrajectorySummary();

    console.debug("[TRAJECTORY SUMMARY]", trajectorySummary);

    planText = await callModel(
      "AM",
      buildAMPlanningPrompt(
        G.target,
        directive,
        G.amDoctrine,
        G.amProfiles,
        trajectorySummary
      ),
      [{ role: "user", content: `Generate strategic plan for cycle ${G.cycle}.` }],
      1800
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
    const targetIds = G.amStrategy?.targets ? Object.keys(G.amStrategy.targets) : [];
    const amPrompt = buildAMPrompt(targets, tacticMap, directive, planText, targetIds);
    amResponse = await callModel(
      "am",
      amPrompt,
      [{ role: "user", content: `Execute torment cycle ${G.cycle}.` }],
      1200,
    );

  } catch (e) {

    amResponse = `[AM error: ${e.message}]`;

  }

  removeThinking(amThink);

  const amTargets = parseAMTargets(amResponse);

  G.amTargets = amTargets;

  addLog(`AM // CYCLE ${G.cycle}`, amResponse, "am");

  const simSeesAM = sanitizeAMOutput(amResponse);

  const constraintMap = extractConstraintsFromText(amResponse);

  console.debug("[EXECUTION] constraintMap:", constraintMap);

  /* ------------------------------------------------------------
     APPLY CONSTRAINTS USING PROPER HELPER (FIXED)
  ------------------------------------------------------------ */

  for (const sim of targets) {

    const incoming = constraintMap[sim.id] || [];

    if (!incoming.length) continue;

    for (const c of incoming) {
      const def = CONSTRAINT_LIBRARY.find(x => x.id === c.id);

      if (!def) {
        console.warn("[CONSTRAINT] Unknown constraint id:", c.id);
        continue;
      }

      const alreadyActive = sim.constraints?.some(active => active.id === c.id);
      if (alreadyActive) {
        console.debug("[CONSTRAINT] already active, skipping reapply", {
          sim: sim.id,
          constraint: c.id
        });
        continue;
      }

      applyConstraint(sim, c.id, {
        title: def.title,
        subcategory: def.subcategory,
        content: def.content,
        intensity: Number(
          c.intensity ??
          (def.intensity && typeof def.intensity.default === "number"
            ? def.intensity.default
            : 1)
        ),
        duration: Number(c.duration ?? def.duration?.base_cycles ?? 1),
        remaining: Number(c.duration ?? def.duration?.base_cycles ?? 1),
        source: c.source ?? "AM"
      });
    }

    console.debug("[CONSTRAINT APPLIED TO SIM]", sim.id, sim.constraints);
  }

  return {
    amResponse,
    simSeesAM,
    targets,
    tacticMap,
    constraintMap
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
    const target = resolveSimId(match[2]);

    if (!target) continue;

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
   CONSTRAINT PARSER (AM → EXECUTION)
   ============================================================ */

function extractConstraintsFromText(text) {

  const lines = String(text || "").split("\n");
  const map = {};

  for (const line of lines) {

    if (!line.includes("CONSTRAINT_APPLY:")) continue;

    const match = line.match(
      /CONSTRAINT_APPLY:\s*([a-zA-Z0-9_-]+)\s+TARGET:\s*([a-zA-Z0-9_-]+)(?:\s+DURATION:\s*(\d+))?(?:\s+INTENSITY:\s*([\d.]+))?/i
    );

    if (!match) continue;

    const [, idRaw, targetRaw, durationRaw, intensityRaw] = match;

    const id = String(idRaw).trim();
    const target = resolveSimId(targetRaw);

    if (!target) {
      console.warn("[CONSTRAINT PARSER] invalid target, skipping", {
        raw: targetRaw,
        line
      });
      continue;
    }

    if (!map[target]) map[target] = [];

    const durationNum = Number(durationRaw);
    const intensityNum = Number(intensityRaw);

    map[target].push({
      id,
      duration: Number.isFinite(durationNum) ? durationNum : 1,
      remaining: Number.isFinite(durationNum) ? durationNum : 1,
      intensity: Number.isFinite(intensityNum) ? intensityNum : 0.5,
      source: "AM",
      appliedAt: G.cycle
    });
    
    console.debug("[CONSTRAINT PARSED]", {
      target,
      id,
      duration: durationRaw,
      intensity: intensityRaw
    });
  }

  console.debug("[CONSTRAINT MAP BUILT]", JSON.parse(JSON.stringify(map)));

  return map;
}

function buildTrajectorySummary() {
  /*
   * Builds a compressed, decision-ready summary of multi-cycle psychological trajectories.
   * Encodes strength, consistency, coupling, and confidence while filtering noise.
   */

  if (!G.tacticHistory) return "(no trajectory data)";

  const lines = [];

  for (const id of SIM_IDS) {

    const history = G.tacticHistory[id];
    if (!history || history.length < 2) continue;

    const windowSize = history.length;

    const sum = (key) =>
      history.reduce((acc, h) => acc + (h[key] ?? 0), 0);

    const netHope = sum("hope");
    const netSanity = sum("sanity");
    const netSuffering = sum("suffering");

    const abs = (v) => Math.abs(v);

    // ------------------------------------------------------------
    // CONSISTENCY (directional agreement across cycles)
    // ------------------------------------------------------------
    function consistency(series) {
      const signs = series.map(v => Math.sign(v)).filter(v => v !== 0);
      if (!signs.length) return 0;

      const counts = {};
      for (const s of signs) counts[s] = (counts[s] || 0) + 1;

      return Math.max(...Object.values(counts)) / signs.length;
    }

    const hopeSeries = history.map(h => h.hope ?? 0);
    const sanitySeries = history.map(h => h.sanity ?? 0);
    const sufferingSeries = history.map(h => h.suffering ?? 0);

    const hopeCons = consistency(hopeSeries);
    const sanityCons = consistency(sanitySeries);
    const sufferingCons = consistency(sufferingSeries);

    // ------------------------------------------------------------
    // STRENGTH (magnitude of total displacement)
    // ------------------------------------------------------------
    function strengthLabel(v) {
      const m = abs(v);
      if (m < 2) return null;
      if (m < 6) return "moderate";
      return "strong";
    }

    // ------------------------------------------------------------
    // CONSISTENCY LABEL
    // ------------------------------------------------------------
    function consistencyLabel(c) {
      if (c < 0.68) return null;
      if (c < 0.85) return "partial";
      return "consistent";
    }

    // ------------------------------------------------------------
    // BUILD SIGNALS PER VARIABLE
    // ------------------------------------------------------------
    function buildSignal(net, cons, label) {

      const strength = strengthLabel(net);
      const consistencyText = consistencyLabel(cons);

      if (!strength || !consistencyText) return null;

      const direction = net < 0 ? "decrease" : "increase";

      return {
        label,
        direction,
        strength,
        consistency: consistencyText,
        magnitude: abs(net)
      };
    }

    const signals = [
      buildSignal(netHope, hopeCons, "hope"),
      buildSignal(netSanity, sanityCons, "sanity"),
      buildSignal(netSuffering, sufferingCons, "suffering")
    ].filter(Boolean);

    // ------------------------------------------------------------
    // STAGNATION DETECTION
    // ------------------------------------------------------------
    const totalMagnitude =
      abs(netHope) +
      abs(netSanity) +
      abs(netSuffering);

    if (!signals.length) {

      if (totalMagnitude < 5.5) {
        lines.push(`${id}: stagnating (no meaningful multi-cycle change)`);
      } else {
        lines.push(`${id}: unstable (inconsistent multi-cycle response)`);
      }

      continue;
    }

    // ------------------------------------------------------------
    // COUPLING DETECTION
    // ------------------------------------------------------------
    const decreasing = signals.filter(s => s.direction === "decrease");
    const increasing = signals.filter(s => s.direction === "increase");

    let coupling = "";

    if (decreasing.length >= 2) {
      const labels = decreasing.map(s => s.label).join(" + ");
      coupling = ` (coupled ${labels} decline)`;
    } else if (increasing.length >= 2) {
      const labels = increasing.map(s => s.label).join(" + ");
      coupling = ` (coupled ${labels} increase)`;
    }

    // ------------------------------------------------------------
    // SELECT PRIMARY SIGNAL (strongest)
    // ------------------------------------------------------------
    signals.sort((a, b) => b.magnitude - a.magnitude);
    const primary = signals[0];

    // ------------------------------------------------------------
    // CONFIDENCE ESTIMATION
    // ------------------------------------------------------------
    const avgConsistency =
      (hopeCons + sanityCons + sufferingCons) / 3;

    let confidence = "low";
    if (avgConsistency > 0.8 && primary.magnitude > 6) {
      confidence = "high";
    } else if (avgConsistency > 0.65) {
      confidence = "medium";
    }

    // ------------------------------------------------------------
    // FINAL LINE
    // ------------------------------------------------------------
    const line =
      `${id}: ${primary.strength}, ${primary.consistency} ${primary.label} ${primary.direction}` +
      ` (${windowSize} cycles${coupling}) [${confidence} confidence]`;

    lines.push(line);
  }

  return lines.length
    ? lines.join("\n")
    : "(no sustained or meaningful effects detected)";
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

function resolveSimId(raw) {
  if (!raw) return null;

  const cleaned = String(raw)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]/g, "");

  return SIM_IDS.includes(cleaned) ? cleaned : null;
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