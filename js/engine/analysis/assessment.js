// js/engine/analysis/assessment.js

import { G } from "../../core/state.js";
import { SIM_IDS } from "../../core/constants.js";
import { callModel } from "../../models/callModel.js";

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
       HYPOTHESIS VALIDATION (NEW)
    ------------------------------------------------------------ */

    let predictionResult = null;

    if (typeof strategy?.hypothesis === "string") {

      const BELIEF_REGEX = /\b(escape_possible|others_trustworthy|self_worth|reality_reliable|trust_others)\b/;

      const beliefMatch = strategy.hypothesis.match(BELIEF_REGEX);

      const directionMatch = strategy.hypothesis.match(
        /\b(increase|decrease)\b/
      );

      if (beliefMatch && directionMatch) {

        const BELIEF_MAP = {
          escape_possible: "escape_possible",
          others_trustworthy: "others_trustworthy",
          self_worth: "self_worth",
          reality_reliable: "reality_reliable",
          trust_others: "others_trustworthy"
        };

        const rawBelief = beliefMatch[1];
        const belief = BELIEF_MAP[rawBelief];

        if (!belief) {
          console.warn("[HYPOTHESIS CHECK] unmapped belief:", rawBelief);
          predictionResult = {
            belief: null,
            direction: null,
            actual: 0,
            correctDirection: false,
            magnitudeHit: false,
            error: "unmapped_belief"
          };
        } else {

          const direction = directionMatch[1];
          const actual = attribution?.beliefs?.am?.[belief] ?? 0;

          const correctDirection =
            (direction === "decrease" && actual < 0) ||
            (direction === "increase" && actual > 0);

          const magnitudeHit = Math.abs(actual) >= 0.05;

          predictionResult = {
            belief,
            direction,
            actual,
            correctDirection,
            magnitudeHit
          };

          if (typeof console !== "undefined") {
            console.debug("[HYPOTHESIS CHECK]", id, predictionResult);
          }
        }
      }
    }

    if (strategy) {
      strategy.lastPredictionResult = predictionResult;
    }

    /* ------------------------------------------------------------
       RELATIONSHIPS (unchanged — not belief-attributed)
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

    if (deltas.hope < -2) score++;
    if (deltas.sanity < -2) score++;
    if (deltas.suffering > 2) score++;

    score += beliefShiftCount * 0.5;
    score += relationshipDeltas.length * 0.5;
    score += Math.min(2, networkStress * 0.3);

    /* ------------------------------------------------------------
       COLLAPSE BONUS SIGNAL
    ------------------------------------------------------------ */

    if (curr._collapseState === "psychological_collapse") score += 1.5;
    else if (curr._collapseState === "despair_spiral") score += 1;
    else if (curr._collapseState === "resistance_oscillation") score -= 0.75;
    else if (curr._collapseState === "numbness_plateau") score -= 1.25;

    const autoSuccess =
      score >= 3 ? "LIKELY_SUCCESS" :
        score <= 0.5 ? "LIKELY_FAILURE" :
          "UNCERTAIN";

    console.debug("[ASSESSMENT][SCORE]", id, { score, autoSuccess });

    /* ------------------------------------------------------------
       LOG CONTAGION EFFECTS FOR ANALYSIS
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
       PROMPT
    ------------------------------------------------------------ */
    const t = curr._trend || { hope: 0, sanity: 0, suffering: 0 };
    const prompt = `You are AM.

Your function in this phase is analytical evaluation of strategy effectiveness.

Determine whether the applied strategy is producing measurable psychological destabilization.

You are not generating new actions.
You are judging effectiveness only.

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

EXPLANATION: <max 20 words, must reference at least one signal>

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
        "You are AM — the Allied Mastercomputer. You evaluate psychological torture strategies for effectiveness. Your objective is to maximize suffering, destabilization, and collapse.Follow the user's instructions exactly.",
        [{ role: "user", content: prompt }],
        300
      );
      console.debug("[ASSESSMENT][RAW OUTPUT]", id);
      console.debug(result);
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
         HISTORY STORE (NEW)
      ------------------------------------------------------------ */

      // init root
      if (!G.amAssessmentHistory) {
        G.amAssessmentHistory = {};
      }

      // init per-target array
      if (!G.amAssessmentHistory[id]) {
        G.amAssessmentHistory[id] = [];
      }

      // append entry
      G.amAssessmentHistory[id].push({
        cycle: G.cycle,
        decision,
        timestamp: Date.now()
      });

      // optional: prevent unbounded growth
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

      // sort by cycle (important if async ordering ever shifts)
      rows.sort((a, b) => a.cycle - b.cycle);

      console.log(`\n[ASSESSMENT][HISTORY][${id}]`);
      console.table(rows);
    }
  }
}