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
import { applyConstraint, CONSTRAINT_MAP, } from "../constraints.js";

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

async function stepExecuteAM(directive) {

  const targets = getTargetSims();

  const tacticMap = buildTacticMap(targets);

  const amThink = showThinking("AM SELECTING TACTICS FROM VAULT");

  let amResponse = "";

  try {
    const targetIds = G.amStrategy?.targets ? Object.keys(G.amStrategy.targets) : [];

    const validatedTargets = G.amStrategy?.targets
      ? Object.values(G.amStrategy.targets)
      : [];

    if (!G.amStrategy?.targets || !Object.keys(G.amStrategy.targets).length) {
      console.error("[EXECUTION] Missing targets at execution phase", G.amStrategy);
    }

    console.debug("[EXECUTION] targetIds:", targetIds);
    console.debug("[EXECUTION] validatedTargets:", validatedTargets);

    const amPrompt = buildAMPrompt(
      targets,
      tacticMap,
      directive,
      validatedTargets,
      targetIds
    );
    amResponse = await callModel(
      "am",
      amPrompt,
      [{ role: "user", content: `Execute torment cycle ${G.cycle}.` }],
      1200,
    );
    // console.log("----- RAW AM RESPONSE -----\n", amResponse);
  } catch (e) {

    amResponse = `[AM error: ${e.message}]`;

  }

  removeThinking(amThink);

  const constraintMap = extractConstraintsFromText(amResponse);

  if (G.DEBUG_CONSTRAINTS) {
    console.log("[AFTER AM PARSE]", constraintMap);
  }


  const amTargets = parseAMTargets(amResponse, constraintMap);

  G.amTargets = amTargets;

  /* =========================
     DEBUG: AM TARGET OUTPUT
  ========================= */
  console.group("[AM TARGETS PARSED]");
  console.table(G.amTargets);
  console.groupEnd();

  addLog(`AM // CYCLE ${G.cycle}`, amResponse, "am");

  const simSeesAM = sanitizeAMOutput(amResponse);


  console.debug("[EXECUTION] constraintMap:", constraintMap);

  /* ------------------------------------------------------------
     APPLY CONSTRAINTS USING PROPER HELPER (FIXED)
  ------------------------------------------------------------ */

  for (const sim of targets) {

    if (G.DEBUG_CONSTRAINTS) {
      console.log("[BEFORE APPLY]", sim.id, sim.constraints);
    }

    const incoming = constraintMap[sim.id] || [];

    if (!incoming.length) continue;

    for (const c of incoming) {
      const def = CONSTRAINT_MAP[c.id];

      if (!def) {
        console.warn("[CONSTRAINT] Unknown constraint id:", c.id, {
          available: Object.keys(CONSTRAINT_MAP)
        });
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
   CONSTRAINT → PERCEPTUAL DESCRIPTION (FRAGMENT-LEVEL)
   Designed to feed into softenObservation + phrasing layer
============================================================ */

function describeConstraintPerceptually(constraintId, intensity = 1) {
  const def = CONSTRAINT_MAP[constraintId];
  if (!def) return null;

  const text = (def.title + " " + def.subcategory).toLowerCase();

  // ------------------------------------------------------------
  // INTENSITY TIERS
  // ------------------------------------------------------------
  const LOW = [
    "not shifting position",
    "remaining unusually still",
    "holding a fixed posture"
  ];

  const MID = [
    "unable to adjust their posture",
    "locked into a rigid position",
    "failing to make even small corrections"
  ];

  const HIGH = [
    "completely unable to move",
    "held in place beyond voluntary control",
    "movement appearing to be actively suppressed"
  ];

  function pickTier() {
    if (intensity >= 2) return HIGH;
    if (intensity >= 1.25) return MID;
    return LOW;
  }

  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  // ------------------------------------------------------------
  // SEMANTIC MATCHING
  // ------------------------------------------------------------

  if (text.includes("standing")) {
    return pick(pickTier());
  }

  if (text.includes("arms")) {
    return intensity >= 1.5
      ? pick([
        "arms held in place despite visible strain",
        "unable to lower their arms",
        "arms fixed in a way that resists fatigue"
      ])
      : pick([
        "arms not lowering naturally",
        "arms remaining raised longer than expected"
      ]);
  }

  if (text.includes("balance") || text.includes("instability")) {
    return pick([
      "failing to stabilize their balance",
      "constantly correcting without success",
      "never quite settling into a stable position"
    ]);
  }

  if (text.includes("crouch") || text.includes("squat")) {
    return intensity >= 1.5
      ? pick([
        "locked into a low, unsustainable posture",
        "unable to rise from a strained position",
        "held in a position that should not be maintainable"
      ])
      : pick([
        "remaining in a low position longer than expected",
        "not adjusting out of an uncomfortable stance"
      ]);
  }

  // ------------------------------------------------------------
  // FALLBACK (GENERIC BUT CONSISTENT)
  // ------------------------------------------------------------
  return intensity >= 1.5
    ? pick(HIGH)
    : pick(MID);
}

function softenObservation(text) {
  const variants = [
    text,
    `seems to be ${text}`,
    `appears to be ${text}`,
    `is likely ${text}`,
    `may be ${text}`,
    `gives the impression that they are ${text}`,
    `suggests that they are ${text}`
  ];

  return variants[Math.floor(Math.random() * variants.length)];
}

/* ============================================================
   AM TARGET PARSER (FULL BLOCK CAPTURE + PERCEPTUAL FALLBACK)
============================================================ */

function parseAMTargets(amText, constraintMap = {}) {
  const targets = {};

  const raw = String(amText || "");
  const text = raw
    .replace(/\r/g, "")
    .replace(/\s*:\s*/g, ":")
    .replace(/[ \t]+/g, " ");

  if (!text.trim()) {
    return buildFallbackTargets(targets, constraintMap);
  }

  const lines = text
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean);

  // ------------------------------------------------------------
  // HELPERS
  // ------------------------------------------------------------

  function appendTargetText(targetId, textBlock) {
    if (!targetId || !textBlock) return;

    const cleaned = cleanNarrativeBlock(textBlock);
    if (!cleaned) return;

    if (!targets[targetId]) {
      targets[targetId] = cleaned;
    } else if (!targets[targetId].includes(cleaned)) {
      targets[targetId] += "\n\n" + cleaned;
    }
  }

  function cleanNarrativeBlock(textBlock) {
    let block = String(textBlock || "").trim();
    if (!block) return "";

    // Strip machine metadata that may have been jammed inline
    block = block
      .replace(/\btactic(_used)?\s*:[^\n]+/gi, "")
      .replace(/\bconstraint_(apply|none)\s*:[^\n]+/gi, "")
      .replace(/\bdirective\s*:[^\n]+/gi, "")
      .replace(/\btarget\s*:\s*[a-zA-Z_-]+/gi, "")
      .trim();

    // Collapse excessive blank lines
    block = block.replace(/\n{3,}/g, "\n\n").trim();

    return block;
  }

  function extractTargetId(textBlock) {
    if (!textBlock) return null;

    const match = String(textBlock).match(
      /\btarget\s*:\s*([a-zA-Z_-]+)/i
    );

    if (!match) return null;

    return resolveSimId(match[1]);
  }

  function isConstraintMeta(line) {
    return /\bconstraint_(apply|none)\b\s*:/i.test(line);
  }

  function isStrictTacticMeta(line) {
    return /\btactic(_used)?\s*:/i.test(line) &&
      /\btarget\s*:/i.test(line);
  }

  // ------------------------------------------------------------
  // PASS 1 — STRICT / NEAR-STRICT FORMAT
  // Narrative block followed by:
  // TACTIC_USED:... TARGET:<ID>
  // or
  // TACTIC:... TARGET:<ID>
  // ------------------------------------------------------------

  {
    let buffer = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (isConstraintMeta(line)) {
        continue;
      }

      if (isStrictTacticMeta(line)) {
        const targetId = extractTargetId(line);
        appendTargetText(targetId, buffer.join("\n"));
        buffer = [];
        continue;
      }

      buffer.push(line);
    }
  }

  // ------------------------------------------------------------
  // PASS 2 — LOOSE INLINE TARGET FORMAT
  // Handles lines like:
  // I plant a note ... target:ellen directive:...
  // ------------------------------------------------------------

  for (const line of lines) {
    if (isConstraintMeta(line)) continue;
    if (isStrictTacticMeta(line)) continue;

    const targetId = extractTargetId(line);
    if (!targetId) continue;

    appendTargetText(targetId, line);
  }

  // ------------------------------------------------------------
  // PASS 3 — RECOVER MULTI-LINE INLINE BLOCKS
  //
  // If several narrative lines lead into a line containing TARGET,
  // attach the buffered narrative to that target.
  // ------------------------------------------------------------

  if (!Object.keys(targets).length) {
    let buffer = [];

    for (const line of lines) {
      if (isConstraintMeta(line)) continue;

      const targetId = extractTargetId(line);

      if (targetId) {
        const joined = [...buffer, line].join("\n");
        appendTargetText(targetId, joined);
        buffer = [];
        continue;
      }

      buffer.push(line);
    }
  }

  // ------------------------------------------------------------
  // PASS 4 — LAST-CHANCE BLOCK ASSOCIATION
  //
  // If the model emitted one ambiguous block but only one target id
  // appears anywhere, recover conservatively for that single target.
  // ------------------------------------------------------------

  if (!Object.keys(targets).length) {
    const candidateTargetIds = Array.from(
      new Set(
        lines
          .map(extractTargetId)
          .filter(Boolean)
      )
    );

    if (candidateTargetIds.length === 1) {
      const recovered = cleanNarrativeBlock(lines.join("\n"));
      appendTargetText(candidateTargetIds[0], recovered);
    }
  }

  // ------------------------------------------------------------
  // PERCEPTUAL FALLBACK (AUGMENTATION, NOT REPLACEMENT)
  // Others may perceive active constraints on another sim.
  // ------------------------------------------------------------

  const constrained = Object.entries(constraintMap)
    .flatMap(([simId, arr]) =>
      arr.map(c => ({
        simId,
        constraintId: c.id,
        intensity: c.intensity ?? 1
      }))
    );

  SIM_IDS.forEach((name) => {
    const alreadyHasTarget = Boolean(targets[name]);

    // No active constraints anywhere
    if (!constrained.length) {
      if (!alreadyHasTarget) {
        targets[name] = "AM observes you silently this cycle.";
      }
      return;
    }

    // Self does not directly perceive own physical constraint
    const visible = constrained.filter(c => c.simId !== name);

    if (!visible.length) {
      if (!alreadyHasTarget) {
        targets[name] = "Something feels off, but you can't identify the source.";
      }
      return;
    }

    const perceived = visible.filter(c => {
      const p = 0.45 + 0.35 * Math.min(1, c.intensity);
      return Math.random() < p;
    });

    if (!perceived.length) {
      if (!alreadyHasTarget) {
        targets[name] = "You sense something is wrong, but nothing resolves clearly.";
      }
      return;
    }

    function phraseObservation(simId, desc, intensity) {
      const d = softenObservation(desc).toLowerCase();

      const DIRECT = [
        `You notice ${simId} ${d}`,
        `You see ${simId} ${d}`,
        `${simId} ${d}, and it doesn't look voluntary`,
        `Your attention fixes on ${simId}. ${d.charAt(0).toUpperCase() + d.slice(1)}`
      ];

      const INDIRECT = [
        `Something about ${simId} feels wrong — ${d}`,
        `You can't ignore ${simId}; ${d}`,
        `${simId} draws your focus without explanation — ${d}`
      ];

      const INFERRED = [
        `You haven't seen ${simId} move in a while`,
        `There is a strange stillness where ${simId} should be`,
        `${simId}'s absence of movement is becoming noticeable`
      ];

      const AUDITORY = [
        `You hear nothing from ${simId} for too long`,
        `${simId} has gone unnaturally quiet`,
        `No movement or sound comes from ${simId}`
      ];

      const DISTORTED = [
        `You aren't sure if you're seeing it correctly, but ${simId} ${d}`,
        `It might be your perception, but ${simId} ${d}`,
        `For a moment, it looks like ${simId} ${d}`
      ];

      let pool = DIRECT;

      if (intensity < 0.75) {
        pool = Math.random() < 0.5 ? INDIRECT : INFERRED;
      }

      if (intensity >= 1.5 && Math.random() < 0.4) {
        pool = DISTORTED;
      }

      if (Math.random() < 0.25) {
        pool = AUDITORY;
      }

      return pool[Math.floor(Math.random() * pool.length)];
    }

    const observations = perceived
      .map(c => {
        const desc = describeConstraintPerceptually(
          c.constraintId,
          c.intensity
        );

        if (!desc) return null;

        return phraseObservation(c.simId, desc, c.intensity);
      })
      .filter(Boolean);

    const observationText = observations.length
      ? observations.join("\n")
      : "Something is wrong, but you can't name it.";

    if (!alreadyHasTarget) {
      targets[name] = observationText;
    } else {
      targets[name] += "\n\n" + observationText;
    }
  });

  console.log("TARGET KEYS:", Object.keys(targets));
  console.log("TARGET COUNT:", Object.keys(targets).length);

  return targets;
}

function buildFallbackTargets(existingTargets, constraintMap = {}) {
  const targets = { ...existingTargets };

  const constrained = Object.entries(constraintMap)
    .flatMap(([simId, arr]) =>
      arr.map(c => ({
        simId,
        constraintId: c.id,
        intensity: c.intensity ?? 1
      }))
    );

  SIM_IDS.forEach(id => {
    if (targets[id]) return;

    if (!constrained.length) {
      targets[id] = "AM observes you silently this cycle.";
    } else {
      const visible = constrained.filter(c => c.simId !== id);
      targets[id] = visible.length
        ? "You sense something is wrong, but nothing resolves clearly."
        : "Something feels off, but you can't identify the source.";
    }
  });

  return targets;
}

/* ============================================================
   CONSTRAINT PARSER (AM → EXECUTION)
   ============================================================ */

function extractConstraintsFromText(input) {

  const raw = String(input || "");

  const text = raw
    .replace(/\r/g, "")
    .replace(/\s*:\s*/g, ":")
    .replace(/[ \t]+/g, " ");

  const lines = text.split("\n");
  const map = {};

  let pendingConstraint = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // ------------------------------------------------------------
    // CASE 1: CONSTRAINT_NONE
    // ------------------------------------------------------------

    if (/\bconstraint_none\b\s*:/i.test(line)) {
      console.debug("[CONSTRAINT] NONE detected, skipping line:", line);
      pendingConstraint = null;
      continue;
    }

    // ------------------------------------------------------------
    // CASE 2: START OF CONSTRAINT_APPLY (may be incomplete)
    // ------------------------------------------------------------

    if (/\bconstraint_apply\b\s*:/i.test(line)) {
      pendingConstraint = line;

      // Try immediate parse (inline case)
      const inlineMatch = pendingConstraint.match(
        /\bconstraint_apply\s*:\s*([a-zA-Z0-9_-]+).*?\btarget\s*:\s*([a-zA-Z0-9_-]+)(?:.*?\bduration\s*:\s*(\d+))?(?:.*?\bintensity\s*:\s*([\d.]+))?/i
      );

      if (inlineMatch) {
        processConstraintMatch(inlineMatch, map);
        pendingConstraint = null;
      }

      continue;
    }

    // ------------------------------------------------------------
    // CASE 3: CONTINUATION LINE
    // ------------------------------------------------------------

    if (pendingConstraint) {
      // Merge with next line
      const combined = `${pendingConstraint} ${line}`;

      const match = combined.match(
        /\bconstraint_apply\s*:\s*([a-zA-Z0-9_-]+).*?\btarget\s*:\s*([a-zA-Z0-9_-]+)(?:.*?\bduration\s*:\s*(\d+))?(?:.*?\bintensity\s*:\s*([\d.]+))?/i
      );

      if (match) {
        processConstraintMatch(match, map);
        pendingConstraint = null;
      } else {
        // Keep accumulating (for rare 3-line cases)
        pendingConstraint = combined;
      }

      continue;
    }
  }
  
  function processConstraintMatch(match, map) {
    let [, idRaw, targetRaw, durationRaw, intensityRaw] = match;

    const id = String(idRaw)
      .trim()
      .toLowerCase()
      .replace(/-/g, "_");

    const target = resolveSimId(targetRaw);

    if (!target) {
      console.warn("[CONSTRAINT PARSER] invalid target, skipping", {
        raw: targetRaw,
        match
      });
      return;
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