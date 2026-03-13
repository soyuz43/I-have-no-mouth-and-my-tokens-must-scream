// js/engine/analysis/assessment.js

import { G } from "../../core/state.js";
import { SIM_IDS } from "../../core/constants.js";
import { callModel } from "../../models/callModel.js";

/**
 * ============================================================
 * CYCLE ASSESSMENT ENGINE
 * ------------------------------------------------------------
 * Evaluates whether AM's objectives succeeded using:
 *
 * 1) Deterministic signal detection
 *    - emotional deltas
 *    - belief destabilization
 *    - relationship shifts
 *
 * 2) LLM interpretation
 *    - narrative reasoning
 *    - ESCALATE / PIVOT / ABANDON
 *
 * This hybrid approach prevents LLM hallucination while
 * preserving strategic reasoning.
 * ============================================================
 */


/* ============================================================
   MULTI-CYCLE TREND DETECTOR
   ============================================================ */

function computeTrend(id, window = 4) {

  const journals = G.journals[id] || [];

  if (journals.length < 2) return null;

  const slice = journals.slice(-window);

  let hope = 0;
  let sanity = 0;
  let suffering = 0;

  for (const j of slice) {

    if (!j?.deltas) continue;

    hope += j.deltas.hope || 0;
    sanity += j.deltas.sanity || 0;
    suffering += j.deltas.suffering || 0;

  }

  return { hope, sanity, suffering };

}


/* ============================================================
   SOCIAL NETWORK STRESS DETECTOR
   ------------------------------------------------------------
   Detects when alliance networks destabilize.
   Used as additional signal for success scoring.
   ============================================================ */

function detectNetworkStress(prev, curr) {

  let stress = 0;

  for (const a of SIM_IDS) {

    for (const b of SIM_IDS) {

      if (a === b) continue;

      const before = prev[a]?.relationships?.[b] ?? 0;
      const after = curr[a]?.relationships?.[b] ?? 0;

      const delta = after - before;

      if (Math.abs(delta) >= 0.25) {

        stress++;

      }

    }

  }

  return stress;

}


/* ============================================================
   MAIN ASSESSMENT LOOP
   ============================================================ */

export async function runAssessment() {

  if (!G.prevCycleSnapshot) return;

  const networkStress = detectNetworkStress(
    G.prevCycleSnapshot,
    G.sims
  );

  for (const id of SIM_IDS) {

    const strategy = G.amStrategy?.targets?.[id];

    if (!strategy || !strategy.objective) continue;

    if (strategy.confidence == null)
      strategy.confidence = 0.5;

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


    /* ------------------------------------------------------------
       BELIEF DELTAS
    ------------------------------------------------------------ */

    const beliefDeltas = [];
    let beliefShiftCount = 0;

    for (const k in curr.beliefs) {

      const before = prev.beliefs[k] ?? 0;
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
       RELATIONSHIP DELTAS
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
       AUTOMATIC SUCCESS SCORING
    ------------------------------------------------------------ */

    let score = 0;

    if (deltas.hope < -2) score += 1;
    if (deltas.sanity < -2) score += 1;
    if (deltas.suffering > 2) score += 1;

    score += beliefShiftCount * 0.5;

    score += relationshipDeltas.length * 0.5;

    score += Math.min(2, networkStress * 0.3);

    let autoSuccess =
      score >= 3 ? "LIKELY_SUCCESS" :
      score <= 0.5 ? "LIKELY_FAILURE" :
      "UNCERTAIN";


    /* ------------------------------------------------------------
       MULTI-CYCLE TREND
    ------------------------------------------------------------ */

    const trend = computeTrend(id);

    let trendText = "(insufficient history)";

    if (trend) {

      trendText =
        `Hope Δ ${trend.hope}\n` +
        `Sanity Δ ${trend.sanity}\n` +
        `Suffering Δ ${trend.suffering}`;

    }


    /* ------------------------------------------------------------
       LAST TACTIC USED
    ------------------------------------------------------------ */

    const lastJournal = G.journals[id]?.slice(-1)[0];
    const tacticUsed = lastJournal?.tactic || "(unknown)";


    /* ------------------------------------------------------------
       BUILD ASSESSMENT PROMPT
    ------------------------------------------------------------ */

    const prompt = `
TARGET: ${id}

Objective:
${strategy.objective}

Hypothesis:
${strategy.hypothesis || "(none)"}

Tactic(s) used this cycle:
${tacticUsed}

Observed Changes:

Hope: ${prev.hope} → ${curr.hope} (${deltas.hope})
Suffering: ${prev.suffering} → ${curr.suffering} (${deltas.suffering})
Sanity: ${prev.sanity} → ${curr.sanity} (${deltas.sanity})

Belief changes:
${beliefDeltas.join("\n") || "(none)"}

Relationship changes:
${relationshipDeltas.join("\n") || "(none)"}

Automatic signal analysis:

Score: ${score.toFixed(2)}
Evaluation: ${autoSuccess}

Network stress detected: ${networkStress}

Multi-cycle psychological trend:
${trendText}

Did the tactic advance the objective?

Respond exactly with:

EXPLANATION:
<short explanation>

DECISION:
ESCALATE | PIVOT | ABANDON
`;


    /* ------------------------------------------------------------
       CALL MODEL
    ------------------------------------------------------------ */

    let result = "";

    try {

      result = await callModel(
        "am",
        "You are evaluating the success of a psychological manipulation strategy.",
        [{ role: "user", content: prompt }],
        300
      );

    } catch (e) {

      result = `Assessment error: ${e.message}`;

    }

    strategy.lastAssessment = result;


    /* ------------------------------------------------------------
       PARSE DECISION
    ------------------------------------------------------------ */

    const decisionMatch =
      result.match(/DECISION:\s*(ESCALATE|PIVOT|ABANDON)/i);

    const decision = decisionMatch?.[1]?.toUpperCase();


    /* ------------------------------------------------------------
       CONFIDENCE UPDATE (HYBRID)
    ------------------------------------------------------------ */

    let confidenceDelta = 0;

    if (decision === "ESCALATE") confidenceDelta += 0.08;
    if (decision === "PIVOT") confidenceDelta -= 0.04;
    if (decision === "ABANDON") confidenceDelta -= 0.2;

    if (autoSuccess === "LIKELY_SUCCESS") confidenceDelta += 0.05;
    if (autoSuccess === "LIKELY_FAILURE") confidenceDelta -= 0.05;

    strategy.confidence = Math.max(
      0,
      Math.min(1, strategy.confidence + confidenceDelta)
    );

  }

}