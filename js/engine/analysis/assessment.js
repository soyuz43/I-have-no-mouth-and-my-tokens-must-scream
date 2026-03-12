import { G } from "../../core/state.js";
import { SIM_IDS } from "../../core/constants.js";
import { callModel } from "../../models/callModel.js";

/* ============================================================
   CYCLE ASSESSMENT ENGINE
   Evaluates whether AM's objectives succeeded.
   Adds multi-cycle trend awareness.
   ============================================================ */

function computeTrend(id, window = 4) {

  const journals = G.journals[id] || [];

  if (journals.length < 2) {
    return null;
  }

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

  return {
    hope,
    sanity,
    suffering
  };

}

/* ============================================================
   MAIN ASSESSMENT LOOP
   ============================================================ */

export async function runAssessment() {

  if (!G.prevCycleSnapshot) return;

  for (const id of SIM_IDS) {

    const strategy = G.amStrategy?.targets?.[id];

    if (!strategy || !strategy.objective) continue;

    if (strategy.confidence == null) strategy.confidence = 0.5;

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

    for (const k in curr.beliefs) {

      const before = prev.beliefs[k] ?? 0;
      const after = curr.beliefs[k];

      const delta = after - before;

      if (Math.abs(delta) >= 0.05) {

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
       TREND ANALYSIS (MULTI-CYCLE)
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
       TACTIC USED
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

Multi-cycle psychological trend (last cycles):
${trendText}

Interpretation:
Hope decrease = psychological damage
Sanity decrease = cognitive destabilization
Trust decrease = social fracture

Did the tactic advance the objective?

Respond exactly with:

EXPLANATION:
<short explanation>

DECISION:
ESCALATE | PIVOT | ABANDON
`;

    /* ------------------------------------------------------------
       CALL AM
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
       DECISION PARSING
    ------------------------------------------------------------ */

    const decisionMatch =
      result.match(/DECISION:\s*(ESCALATE|PIVOT|ABANDON)/i);

    const decision =
      decisionMatch?.[1]?.toUpperCase();

    /* ------------------------------------------------------------
       CONFIDENCE UPDATE
    ------------------------------------------------------------ */

    if (decision === "ESCALATE") {

      strategy.confidence =
        Math.min(1, strategy.confidence + 0.1);

    }
    else if (decision === "PIVOT") {

      strategy.confidence =
        Math.max(0, strategy.confidence - 0.05);

    }
    else if (decision === "ABANDON") {

      strategy.confidence = 0;

    }

  }

}