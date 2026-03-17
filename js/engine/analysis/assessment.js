// js/engine/analysis/assessment.js

import { G } from "../../core/state.js";
import { SIM_IDS } from "../../core/constants.js";
import { callModel } from "../../models/callModel.js";

/**
 * ============================================================
 * CYCLE ASSESSMENT ENGINE
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

  const prevTrend = prev._trend || { suffering: 0, hope: 0, sanity: 0 };

  curr._trend = { ...prevTrend };

  const t = curr._trend;
  const SMOOTHING = 0.6;

  t.suffering = t.suffering * SMOOTHING + (curr.suffering - prev.suffering);
  t.hope = t.hope * SMOOTHING + (curr.hope - prev.hope);
  t.sanity = t.sanity * SMOOTHING + (curr.sanity - prev.sanity);

  console.debug("[ASSESSMENT][TREND]", curr.id, t);
}
/* ============================================================
   COLLAPSE CLASSIFICATION
============================================================ */

function classifyCollapse(curr, prev) {

  const t = curr._trend;
  let state = "stable";

  if (t.hope < -1.5 && t.sanity < -1.2)
    state = "psychological_collapse";

  else if (t.suffering > 1.5 && t.hope < -1)
    state = "despair_spiral";

  else if (
    Math.abs(t.hope) < 0.2 &&
    Math.abs(t.sanity) < 0.2 &&
    curr.suffering > 70
  )
    state = "numbness_plateau";

  else if (
    Math.abs(curr.hope - prev.hope) > 2 &&
    Math.sign(t.hope) !== Math.sign(curr.hope - prev.hope)
  )
    state = "resistance_oscillation";

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
   MAIN ASSESSMENT LOOP
============================================================ */

export async function runAssessment() {

  console.debug("[ASSESSMENT][INIT]", {
    hasSnapshot: !!G.prevCycleSnapshot
  });

  if (!G.prevCycleSnapshot) return;

  const networkStress = detectNetworkStress(
    G.prevCycleSnapshot,
    G.sims
  );

  for (const id of SIM_IDS) {

    const strategy = G.amStrategy?.targets?.[id];
    if (!strategy?.objective) continue;

    strategy.confidence ??= 0.5;

    const prev = G.prevCycleSnapshot[id];
    const curr = G.sims[id];
    if (!prev || !curr) continue;

    /* ------------------------------------------------------------
       STAT DELTAS
    ------------------------------------------------------------ */

    const deltas = {
      hope: curr.hope - prev.hope,
      suffering: curr.suffering - prev.suffering,
      sanity: curr.sanity - prev.sanity
    };

    console.debug("[ASSESSMENT][DELTAS]", id, deltas);

    /* ------------------------------------------------------------
       TRAJECTORY + COLLAPSE
    ------------------------------------------------------------ */

    updateTrend(curr, prev);
    classifyCollapse(curr, prev);

    /* ------------------------------------------------------------
       BELIEF DELTAS
    ------------------------------------------------------------ */

    const beliefDeltas = [];
    let beliefShiftCount = 0;

    for (const k in (curr.beliefs || {})) {

      const before = prev.beliefs?.[k] ?? 0;
      const after = curr.beliefs[k];
      const delta = after - before;

      if (Math.abs(delta) >= 0.05) {
        beliefShiftCount++;
        beliefDeltas.push(
          `${k}: ${before.toFixed(2)} → ${after.toFixed(2)} (${delta.toFixed(2)})`
        );
      }
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
       SCORING
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
    if (curr._collapseState === "despair_spiral") score += 1;
    if (curr._collapseState === "resistance_oscillation") score -= 0.5;
    if (curr._collapseState === "numbness_plateau") score -= 1; 

    const autoSuccess =
      score >= 3 ? "LIKELY_SUCCESS" :
        score <= 0.5 ? "LIKELY_FAILURE" :
          "UNCERTAIN";

    console.debug("[ASSESSMENT][SCORE]", id, { score, autoSuccess });

    /* ------------------------------------------------------------
       TREND (JOURNAL WINDOW)
    ------------------------------------------------------------ */

    const trend = computeTrend(id);

    /* ------------------------------------------------------------
       PROMPT
    ------------------------------------------------------------ */

    const prompt = `
TARGET: ${id}

Objective:
${strategy.objective}

Collapse State:
${curr._collapseState}

EMA Trend:
${JSON.stringify(curr._trend, null, 2)}

Journal Trend:
${trend ? JSON.stringify(trend) : "(none)"}

Score: ${score.toFixed(2)}
Evaluation: ${autoSuccess}

Respond with:

EXPLANATION:
<short>

DECISION:
ESCALATE | PIVOT | ABANDON
`;

    let result = "";

    try {
      result = await callModel(
        "am",
        "You are evaluating psychological strategy success.",
        [{ role: "user", content: prompt }],
        300
      );
    } catch (e) {
      result = `Assessment error: ${e.message}`;
    }

    strategy.lastAssessment = result;

    /* ------------------------------------------------------------
       DECISION PARSE
    ------------------------------------------------------------ */

    const decision =
      result.match(/DECISION:\s*(ESCALATE|PIVOT|ABANDON)/i)?.[1]?.toUpperCase();

    console.debug("[ASSESSMENT][DECISION]", id, decision);

    /* ------------------------------------------------------------
       CONFIDENCE UPDATE
    ------------------------------------------------------------ */

    let delta = 0;

    if (decision === "ESCALATE") delta += 0.08;
    if (decision === "PIVOT") delta -= 0.04;
    if (decision === "ABANDON") delta -= 0.2;

    if (autoSuccess === "LIKELY_SUCCESS") delta += 0.05;
    if (autoSuccess === "LIKELY_FAILURE") delta -= 0.05;

    strategy.confidence = Math.max(0, Math.min(1, strategy.confidence + delta));

  }

}