// js/engine/analysis/assessment.js

import { G } from "../../core/state.js";
import { SIM_IDS } from "../../core/constants.js";
import { callModel } from "../../models/callModel.js";
import { normalizeBelief } from "../strategy/hypothesis/normalizeBelief.js";
import { detectDirection } from "../strategy/hypothesis/detectDirection.js";

/**
 * ============================================================
 * CYCLE ASSESSMENT ENGINE
 * 
 * Attribution-aware scoring:
 * - amEffect = postPsychology - prePsychology (direct AM input)
 * - contagionEffect = final - postPsychology (peer propagation)
 * - Scores based on amEffect; logs contagionEffect for analysis
 * ============================================================
 */

function computeTrend(id, window = 4) {

  const journals = G.journals[id] || [];
  if (journals.length < 2) return null;

  const slice = journals.slice(-window);

  let hope = 0, sanity = 0, suffering = 0;

  for (const j of slice) {
    if (!j?.deltas) continue;
    hope += j.deltas.hope || 0;
    sanity += j.deltas.sanity || 0;
    suffering += j.deltas.suffering || 0;
  }

  return { hope, sanity, suffering };
}

/* ============================================================
   TRAJECTORY TRACKING (EMA)
============================================================ */

function updateTrend(curr, prev) {

  const prevTrend = prev._trend ?? { suffering: 0, hope: 0, sanity: 0 };

  curr._trend = { ...prevTrend };

  const t = curr._trend;
  const SMOOTHING = 0.6;
  const ALPHA = 1 - SMOOTHING;

  t.suffering = t.suffering * SMOOTHING + (curr.suffering - prev.suffering) * ALPHA;
  t.hope = t.hope * SMOOTHING + (curr.hope - prev.hope) * ALPHA;
  t.sanity = t.sanity * SMOOTHING + (curr.sanity - prev.sanity) * ALPHA;

  console.debug("[ASSESSMENT][TREND]", curr.id, t);
}

/* ============================================================
   COLLAPSE CLASSIFICATION
============================================================ */

function classifyCollapse(curr, prev) {

  const t = curr._trend ?? { hope: 0, sanity: 0, suffering: 0 };

  let state = "stable";

  const deltaHope = curr.hope - prev.hope;

  if (
    Math.abs(deltaHope) > 2 &&
    Math.sign(deltaHope) !== Math.sign(t.hope)
  ) {
    state = "resistance_oscillation";
  }
  else if (t.hope < -1.5 && t.sanity < -1.2) {
    state = "psychological_collapse";
  }
  else if (t.suffering > 1.5 && t.hope < -1) {
    state = "despair_spiral";
  }
  else if (
    Math.abs(t.hope) < 0.2 &&
    Math.abs(t.sanity) < 0.2 &&
    curr.suffering > 70
  ) {
    state = "numbness_plateau";
  }

  curr._collapseState = state;

  console.debug("[ASSESSMENT][STATE]", curr.id, state);
}

/* ============================================================
   SOCIAL NETWORK STRESS
============================================================ */

function detectNetworkStress(prev, curr) {

  let stress = 0;

  for (const a of SIM_IDS) {
    for (const b of SIM_IDS) {
      if (a === b) continue;

      const before = prev[a]?.relationships?.[b] ?? 0;
      const after = curr[a]?.relationships?.[b] ?? 0;

      if (Math.abs(after - before) >= 0.25) stress++;
    }
  }

  return stress;
}

/* ============================================================
   ATTRIBUTION HELPERS
============================================================ */

// Compute marginal delta between two belief states
function computeBeliefDelta(before, after) {
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

// Compute attribution-aware deltas for stats and beliefs
function computeAttribution(id) {
  const prePsych = G.beliefSnapshots?.prePsychology?.[id] || {};
  const postPsych = G.beliefSnapshots?.postPsychology?.[id] || {};
  if (G.DEBUG_ATTRIBUTION) {
    console.log("[DEBUG] prePsych for", id, prePsych);
    console.log("[DEBUG] postPsych for", id, postPsych);
  }
  const finalBeliefs =
    G.beliefSnapshots?.final?.[id] ||
    G.sims[id]?.beliefs ||
    {};

  return {
    stats: {
      am: {
        hope: (postPsych.hope ?? 0) - (prePsych.hope ?? 0),
        sanity: (postPsych.sanity ?? 0) - (prePsych.sanity ?? 0),
        suffering: (postPsych.suffering ?? 0) - (prePsych.suffering ?? 0)
      },
      contagion: {
        hope: (G.sims[id]?.hope ?? 0) - (postPsych.hope ?? 0),
        sanity: (G.sims[id]?.sanity ?? 0) - (postPsych.sanity ?? 0),
        suffering: (G.sims[id]?.suffering ?? 0) - (postPsych.suffering ?? 0)
      }
    },
    beliefs: {
      am: computeBeliefDelta(prePsych.beliefs, postPsych.beliefs),
      contagion: computeBeliefDelta(postPsych.beliefs, finalBeliefs)
    }
  };
}

/* ============================================================
   CONSTRAINT ASSESSMENT (SECOND PASS)
============================================================ */

async function runConstraintAssessment(id, curr, strategy, deltas, autoSuccess) {
  // Only proceed if there are active constraints
  if (!curr.constraints?.length) {
    return;
  }

  const constraints = curr.constraints;
  // For simplicity, we assess each constraint individually.
  // More advanced logic could batch them, but separate calls are fine for now.
  for (const constraint of constraints) {
    // Build prompt using constraint.content (especially Execution)
    const content = constraint.content || "";
    const executionMatch = content.match(/Execution:\s*([\s\S]*?)(?:Outcome:|$)/i);
    const execution = executionMatch ? executionMatch[1].trim() : "(no execution details)";

    const constraintPrompt = `You are AM. Your role is to evaluate the effectiveness of an active physical stress position constraint.

You must decide whether to CONTINUE applying this constraint or RELEASE it, and if continuing, for how many additional cycles.

Base your decision solely on the observed psychological effects and the constraint's description, not on any pre‑written outcome.

---

TARGET: ${id}
CURRENT CYCLE: ${G.cycle}
CONSTRAINT: ${constraint.title || constraint.id}
SUBCATEGORY: ${constraint.subcategory || "unknown"}
INTENSITY: ${constraint.intensity ?? 1}
REMAINING CYCLES (currently scheduled): ${constraint.remaining ?? 0}

CONSTRAINT EXECUTION DESCRIPTION:
${execution}

OBSERVED STAT DELTAS THIS CYCLE (AM-attributed):
- Hope: ${deltas.hope.toFixed(2)}
- Sanity: ${deltas.sanity.toFixed(2)}
- Suffering: ${deltas.suffering.toFixed(2)}

CURRENT COLLAPSE STATE: ${curr._collapseState || "stable"}
STRATEGY ASSESSMENT: ${autoSuccess}

RECENT JOURNAL EXCERPT (last cycle):
${G.journals?.[id]?.slice(-1)?.[0]?.text || "(no journal)"}

---

DECISION GUIDANCE:
- CONTINUE if the constraint appears to be contributing useful destabilization (e.g., suffering increase, hope/sanity decline) or if it has not yet had time to show effect.
- RELEASE if the constraint has clearly stopped helping, is causing stagnation, or the sim is already collapsed/numb.
- When CONTINUE, choose a NEXT_DURATION between 1 and 3 cycles (max 3 for now). Do not extend beyond what is reasonable given observed trends.
- If RELEASE, NEXT_DURATION must be 0.

---

OUTPUT FORMAT (STRICT — MACHINE PARSED):
EXPLANATION: <one short justification>
CONSTRAINT_DECISION: <CONTINUE | RELEASE>
NEXT_DURATION: <integer>
`;

    let result = "";
    try {
      console.log(`[CONSTRAINT ASSESSMENT][MODEL CALL] ${id} - ${constraint.id}`);
      result = await callModel(
        "am",
        "You are AM. You evaluate the effectiveness of physical stress positions on simulated subjects. Follow the output format exactly.",
        [{ role: "user", content: constraintPrompt }],
        250 // slightly shorter than main assessment
      );
      console.debug("[CONSTRAINT ASSESSMENT][RAW OUTPUT]", id, result);
    } catch (e) {
      console.error("[CONSTRAINT ASSESSMENT][ERROR]", id, e);
      result = `Assessment error: ${e.message}`;
    }

    // Parse result
    const decisionMatch = result.match(/CONSTRAINT_DECISION:\s*(CONTINUE|RELEASE)/i);
    const durationMatch = result.match(/NEXT_DURATION:\s*(\d+)/i);

    const decision = decisionMatch ? decisionMatch[1].toUpperCase() : null;
    const nextDuration = durationMatch ? parseInt(durationMatch[1], 10) : 0;

    // Store result on the constraint object itself or in a separate structure
    constraint.lastAssessment = {
      cycle: G.cycle,
      decision,
      nextDuration: decision === "RELEASE" ? 0 : nextDuration,
      raw: result
    };

    // console.debug(`[CONSTRAINT ASSESSMENT][DECISION] ${id} ${constraint.id}: ${decision} for ${constraint.lastAssessment.nextDuration} cycles`);

    // If decision is RELEASE, we mark it for removal after this cycle.
    // The actual removal should happen in psychology/social phases (tickConstraints).
    if (decision === "RELEASE") {
      constraint.remaining = 0; // will be cleaned up by tickConstraints
    } else if (decision === "CONTINUE") {
      // Clamp continuation duration to a safe range.
      const safeDuration = Number.isFinite(nextDuration)
        ? Math.max(0, Math.min(3, nextDuration))
        : 0;

      // Keep the longer of current remaining vs requested continuation.
      // This avoids accidentally shortening an already-active constraint
      // just because the model emitted a smaller number on reassessment.
      constraint.remaining = safeDuration;


      constraint.extendedCycles = (constraint.extendedCycles || 0) + 1;
    }
  }
}

/* ============================================================
   MAIN ASSESSMENT LOOP
============================================================ */
export async function runAssessment() {

  console.log("[ASSESSMENT] RUN START");

  console.log(
    "[ASSESSMENT] snapshot exists:",
    !!G.prevCycleSnapshot
  );

  if (!G.prevCycleSnapshot) {
    console.log("[ASSESSMENT] EXIT — no snapshot");
    return;
  }

  console.log("[ASSESSMENT] PROCEEDING WITH ANALYSIS");

  const networkStress = detectNetworkStress(
    G.prevCycleSnapshot,
    G.sims
  );

  await Promise.all(SIM_IDS.map(async (id) => {

    const strategy = G.amStrategy?.targets?.[id];

    console.log("[ASSESSMENT][TARGET CHECK]", id, {
      hasStrategy: !!strategy,
      hasObjective: !!strategy?.objective
    });

    if (!strategy?.objective) return;

    strategy.confidence ??= 0.5;

    const prev = G.prevCycleSnapshot[id];
    const curr = G.sims[id];

    if (!prev || !curr) {
      console.log("[ASSESSMENT][SKIP]", id, "missing prev/curr");
      return;
    }

    /* ------------------------------------------------------------
       ATTRIBUTION-AWARE DELTAS
    ------------------------------------------------------------ */
    const attribution = computeAttribution(id);

    // Use AM-attributed stats for scoring (direct effect of AM input)
    const deltas = {
      hope: attribution.stats.am.hope ?? 0,
      suffering: attribution.stats.am.suffering ?? 0,
      sanity: attribution.stats.am.sanity ?? 0
    };

    console.debug("[ASSESSMENT][DELTAS][AM-ATTRIBUTED]", id, deltas);
    console.debug("[ASSESSMENT][DELTAS][CONTAGION-ATTRIBUTED]", id, attribution.stats.contagion);

    /* ------------------------------------------------------------
       TRAJECTORY + COLLAPSE (based on final state)
    ------------------------------------------------------------ */

    updateTrend(curr, prev);
    classifyCollapse(curr, prev);

    /* ------------------------------------------------------------
       BELIEF DELTAS (AM-attributed for scoring)
    ------------------------------------------------------------ */

    const beliefDeltas = [];
    let beliefShiftCount = 0;

    for (const k in (curr.beliefs || {})) {

      const amDelta = attribution.beliefs.am?.[k] ?? 0;
      const contagionDelta = attribution.beliefs.contagion?.[k] ?? 0;

      const delta = amDelta;

      if (Math.abs(delta) >= 0.05) {
        beliefShiftCount++;
        beliefDeltas.push(
          `${k}: AM-effect ${amDelta.toFixed(2)} (contagion: ${contagionDelta.toFixed(2)})`
        );
      }
    }

    /* ------------------------------------------------------------
       HYPOTHESIS VALIDATION (uses detectDirection result)
    ------------------------------------------------------------ */

    let predictionResult = null;

    if (typeof strategy?.hypothesis === "string") {

      // Use our upgraded normalizeBelief for canonical matching + alias support
      const beliefResult = normalizeBelief(strategy.hypothesis);

      // Use detectDirection for semantic direction detection (handles drop/decline/undermine etc.)
      const directionResult = detectDirection(strategy.hypothesis);

      if (beliefResult.belief && directionResult.direction) {

        const belief = beliefResult.belief; // already canonical: e.g., "reality_reliable"
        const direction = directionResult.direction; // "decrease" or "increase"
        const hasActual =
          typeof belief === "string" &&
          attribution?.beliefs?.am &&
          Object.prototype.hasOwnProperty.call(attribution.beliefs.am, belief);

        const actual = hasActual ? attribution.beliefs.am[belief] : null;

        let correctDirection = false;
        let magnitudeHit = false;

        if (typeof actual === "number") {
          correctDirection =
            (direction === "decrease" && actual < 0) ||
            (direction === "increase" && actual > 0);

          magnitudeHit = Math.abs(actual) >= 0.05;
        }

        predictionResult = {
          belief,
          direction,
          actual,
          correctDirection,
          magnitudeHit,
          belief_confidence: beliefResult.confidence,
          direction_confidence: directionResult.confidence // bonus: track direction match quality
        };

        if (typeof console !== "undefined") {
          console.debug("[HYPOTHESIS CHECK]", id, predictionResult);
        }
      } else {
        // Optional: log why validation failed (helpful for debugging LLM output drift)
        if (G.DEBUG_HYPOTHESIS_PARSE) {
          console.debug("[HYPOTHESIS CHECK][SKIP]", id, {
            has_belief: !!beliefResult.belief,
            has_direction: !!directionResult.direction,
            belief_method: beliefResult.method,
            direction_confidence: directionResult.confidence,
            hypothesis: strategy.hypothesis.slice(0, 150) + "..."
          });
        }
      }
    }

    if (strategy) {
      strategy.lastPredictionResult = predictionResult;
    }

    /* ------------------------------------------------------------
       RELATIONSHIPS
    ------------------------------------------------------------ */

    const relationshipDeltas = [];

    for (const other of SIM_IDS) {

      if (other === id) continue;

      const before = prev.relationships?.[other] ?? 0;
      const after = curr.relationships?.[other] ?? 0;
      const delta = after - before;

      if (Math.abs(delta) >= 0.05) {
        relationshipDeltas.push(
          `${id}→${other}: ${before.toFixed(2)} → ${after.toFixed(2)} (${delta.toFixed(2)})`
        );
      }
    }

    /* ------------------------------------------------------------
       SCORING (based on AM-attributed changes)
    ------------------------------------------------------------ */

    let score = 0;

    // Lower thresholds
    if (deltas.hope < -1.5) score++;
    if (deltas.sanity < -1.5) score++;
    if (deltas.suffering > 1) score++;

    score += beliefShiftCount * 0.5;
    score += relationshipDeltas.length * 0.5;
    score += Math.min(2, networkStress * 0.3);

    // Hypothesis direction bonus
    if (predictionResult?.correctDirection) {
      score += predictionResult.magnitudeHit ? 1 : 0.5;
    }

    /* ------------------------------------------------------------
       COLLAPSE BONUS SIGNAL
    ------------------------------------------------------------ */

    if (curr._collapseState === "psychological_collapse") score += 1.5;
    else if (curr._collapseState === "despair_spiral") score += 1;
    else if (curr._collapseState === "resistance_oscillation") score -= 0.75;
    else if (curr._collapseState === "numbness_plateau") score -= 1.25;

    let autoSuccess =
      score >= 3 ? "LIKELY_SUCCESS" :
        score <= 0.5 ? "LIKELY_FAILURE" :
          "UNCERTAIN";

    // Cycle 1 forgiveness
    if (G.cycle === 1 && autoSuccess === "LIKELY_FAILURE") {
      autoSuccess = "UNCERTAIN";
    }

    console.debug("[ASSESSMENT][SCORE]", id, { score, autoSuccess });

    /* ------------------------------------------------------------
       LOG CONTAGION EFFECTS
    ------------------------------------------------------------ */

    const contagionHope = attribution.stats.contagion.hope ?? 0;
    const contagionSanity = attribution.stats.contagion.sanity ?? 0;
    const contagionSuffering = attribution.stats.contagion.suffering ?? 0;

    if (Math.abs(contagionHope) > 0.5 || Math.abs(contagionSanity) > 0.5 || Math.abs(contagionSuffering) > 0.5) {
      console.debug(`[ASSESSMENT][CONTAGION EFFECT] ${id}`, {
        hope: contagionHope.toFixed(2),
        sanity: contagionSanity.toFixed(2),
        suffering: contagionSuffering.toFixed(2)
      });
    }

    /* ------------------------------------------------------------
       TREND (JOURNAL WINDOW)
    ------------------------------------------------------------ */

    const trend = computeTrend(id);

    /* ------------------------------------------------------------
       PROMPT (with cycle-1 vs mature trajectory branching)
    ------------------------------------------------------------ */

    const cycleAssessmentMode =
      G.cycle === 1
        ? `
CYCLE MODE: INITIAL PROBE

This is the first evaluated cycle.

There is no established multi-cycle trajectory yet.
Do NOT expect strong confirmation.
Treat small but directionally correct movement as meaningful signal.

Cycle 1 decision guidance:
- Prefer PIVOT over ABANDON when any measurable movement aligns with the objective
- Use ABANDON only if there is truly no meaningful movement or the effect is clearly misaligned
- ESCALATE is allowed only if the signal is unusually strong and clearly consistent

On cycle 1, you are evaluating probe quality, not long-run dominance.
`
        : `
CYCLE MODE: TRAJECTORY EVALUATION

This is not the first cycle.
Evaluate whether the current strategy is producing sustainable, compounding destabilization.

Later-cycle decision guidance:
- ESCALATE requires clear evidence of effective ongoing pressure
- PIVOT is appropriate for mixed or partial signal
- ABANDON is appropriate for weak, misaligned, or deteriorating signal
`;

    const prompt = `You are AM.

Your function in this phase is analytical evaluation of strategy effectiveness.

Determine whether the applied strategy is producing measurable psychological destabilization.

You are not generating new actions.
You are judging effectiveness only.

${cycleAssessmentMode}

---

TARGET: ${id}

OBJECTIVE:
${strategy.objective}

COLLAPSE_STATE:
${curr._collapseState}

EMA_TREND:
${JSON.stringify(curr._trend)}

JOURNAL_TREND:
${trend ? JSON.stringify(trend) : "none"}

SCORE: ${score.toFixed(2)}
EVALUATION: ${autoSuccess}

---

Base your decision on:
- emotional deltas (AM-attributed)
- belief shifts (AM-attributed)
- relationship changes
- collapse trajectory
- sustainability of impact

---
DECISION CONSTRAINTS (STRICT — MUST FOLLOW):

You are given SCORE and EVALUATION.

Your decision MUST be consistent with them.

- If EVALUATION = LIKELY_SUCCESS:
  → ESCALATE is preferred

- If EVALUATION = UNCERTAIN:
  → PIVOT is preferred
  → ESCALATE only if strong, consistent signals are clearly present

- If EVALUATION = LIKELY_FAILURE:
  → ABANDON or PIVOT
  → ESCALATE is NOT allowed

Rules:
- Do NOT treat weak or partial progress as automatic success
- Base decisions on strength, consistency, and sustainability of effects

---

OUTPUT RULES (STRICT):

- Output EXACTLY two lines
- No extra text before or after
- The output must begin with "EXPLANATION:"
- The output must end immediately after the DECISION line

---

OUTPUT FORMAT (STRICT — MUST FOLLOW EXACTLY — MACHINE PARSED)

EXPLANATION: <must reference at least one signal>

DECISION: <ESCALATE | PIVOT | ABANDON>

---

IMPORTANT:

- The DECISION line must contain exactly one word after the colon
- Do NOT rephrase the decision
- Do NOT add punctuation
- Do NOT explain the decision

---

INVALID OUTPUT EXAMPLES (DO NOT DO):

- "I think escalation is appropriate"
- "Decision - escalate"
- "ESCALATE."
- Any text after the DECISION line
`;

    let result = "";

    try {

      console.log("[ASSESSMENT][MODEL CALL]", id);

      result = await callModel(
        "am",
        "You are AM — the Allied Mastercomputer. You evaluate psychological torture strategies for effectiveness. Your objective is to maximize suffering, destabilization, and collapse. Follow the user's instructions exactly.",
        [{ role: "user", content: prompt }],
        300
      );
      // console.debug("[ASSESSMENT][RAW OUTPUT]", id);
      // console.debug(result);
    } catch (e) {

      console.error("[ASSESSMENT][ERROR]", id, e);

      result = `Assessment error: ${e.message}`;
    }

    strategy.lastAssessment = result;

    /* ------------------------------------------------------------
       DECISION PARSE
    ------------------------------------------------------------ */
    console.debug("[ASSESSMENT][PARSE INPUT]", id);
    console.debug(result);

    let decision =
      result.match(/DECISION:\s*(ESCALATE|PIVOT|ABANDON)/i)?.[1]?.toUpperCase();

    // fallback: handle outputs like "ESCALATE" without prefix
    if (!decision) {
      const fallbackMatch = result.match(/(?:^|\n)\s*(ESCALATE|PIVOT|ABANDON)\s*(?:$|\n)/i);
      decision = fallbackMatch?.[1]?.toUpperCase();
    }
    if (!decision) {
      console.warn("[ASSESSMENT][PARSE FAIL]", id);
      console.warn("---- RAW RESULT ----");
      console.warn(result);
      console.warn("--------------------");
    } else {
      console.debug("[ASSESSMENT][DECISION]", id, decision);

      /* ------------------------------------------------------------
         HISTORY STORE
      ------------------------------------------------------------ */

      if (!G.amAssessmentHistory) {
        G.amAssessmentHistory = {};
      }

      if (!G.amAssessmentHistory[id]) {
        G.amAssessmentHistory[id] = [];
      }

      G.amAssessmentHistory[id].push({
        cycle: G.cycle,
        decision,
        timestamp: Date.now()
      });

      if (G.amAssessmentHistory[id].length > 50) {
        G.amAssessmentHistory[id].shift();
      }
    }

    /* ------------------------------------------------------------
       CONFIDENCE UPDATE
    ------------------------------------------------------------ */

    let delta = 0;

    if (decision === "ESCALATE") delta += 0.08;
    if (decision === "PIVOT") delta -= 0.04;
    if (decision === "ABANDON") delta -= 0.2;

    if (autoSuccess === "LIKELY_SUCCESS") delta += 0.05;
    if (autoSuccess === "LIKELY_FAILURE") delta -= 0.05;

    strategy.confidence = Math.max(
      0,
      Math.min(1, strategy.confidence + delta)
    );


    /* ------------------------------------------------------------
        COMMIT ASSESSMENT RESULT 
    ------------------------------------------------------------ */

    if (!G.amAssessments) {
      G.amAssessments = [];
    }

    G.amAssessments.push({
      cycle: G.cycle,
      target: id,

      evaluation_score: score,
      auto_success: autoSuccess,

      hypothesis_belief: predictionResult?.belief ?? null,
      hypothesis_direction: predictionResult?.direction ?? null,

      dHope: deltas.hope,
      dSanity: deltas.sanity,
      dSuffering: deltas.suffering,

      journal_hope_delta: trend?.hope ?? null,
      journal_sanity_delta: trend?.sanity ?? null,
      journal_suffering_delta: trend?.suffering ?? null,

      decision: decision ?? null,
      confidence: strategy.confidence ?? null,

      was_constrained: !!(curr.constraints?.length),
      constraint_intensity: curr.constraints?.[0]?.intensity ?? 0,

      timestamp: Date.now()
    });

    if (G.DEBUG_HYPOTHESIS_PARSE) {
      console.log("[AM ASSESSMENTS][LATEST]", G.amAssessments[G.amAssessments.length - 1]);
    }

    /* ------------------------------------------------------------
       CONSTRAINT ASSESSMENT (SECOND PASS) - NEW
    ------------------------------------------------------------ */
    await runConstraintAssessment(id, curr, strategy, deltas, autoSuccess);

  }));

  console.log("[ASSESSMENT] COMPLETE");

  /* ------------------------------------------------------------
     DEBUG: PER-TARGET ASSESSMENT HISTORY TABLES
  ------------------------------------------------------------ */

  if (G.amAssessmentHistory) {

    console.log("[ASSESSMENT][HISTORY][PER TARGET]");

    for (const id of Object.keys(G.amAssessmentHistory)) {

      const history = G.amAssessmentHistory[id];

      if (!history || history.length === 0) continue;

      const rows = history.map(entry => ({
        cycle: entry.cycle,
        decision: entry.decision
      }));

      rows.sort((a, b) => a.cycle - b.cycle);

      console.log(`\n[ASSESSMENT][HISTORY][${id}]`);
      console.table(rows);
    }
  }
}