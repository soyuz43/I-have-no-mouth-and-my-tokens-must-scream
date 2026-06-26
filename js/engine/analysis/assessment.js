// js/engine/analysis/assessment.js

import { G } from "../../core/state.js";
import { SIM_IDS } from "../../core/constants.js";
import { callModel } from "../../models/callModel.js";
import { normalizeBelief } from "../strategy/hypothesis/normalizeBelief.js";
import { detectDirection } from "../strategy/hypothesis/detectDirection.js";
import { getTacticRuntimeContext } from "../execution/tacticRuntime.js";
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


/* ============================================================
   LIFECYCLE ASSESSMENT HELPERS
============================================================ */

function formatPromptValue(value) {
  if (Array.isArray(value)) {
    const items = value
      .map((item) =>
        String(item ?? "").trim()
      )
      .filter(Boolean);

    return items.length
      ? items.join("; ")
      : "(none)";
  }

  const text =
    String(value ?? "").trim();

  return text || "(none)";
}

function normalizeExecutionLimit(
  value,
  fallback
) {
  const numeric =
    Number(value);

  if (
    !Number.isFinite(numeric) ||
    numeric < 0
  ) {
    return fallback;
  }

  return Math.floor(numeric);
}

function parseLifecycleAssessment(
  result
) {
  const text =
    String(result ?? "").trim();

  const explanation =
    text.match(
      /(?:^|\n)EXPLANATION:\s*([^\n]+)/i
    )?.[1]?.trim() ||
    "No valid explanation was parsed.";

  const labeledRecommendation =
    text.match(
      /(?:^|\n)RECOMMENDATION:\s*(CONTINUE|ADVANCE)\s*(?:$|\n)/i
    )?.[1]?.toUpperCase();

  if (labeledRecommendation) {
    return {
      explanation,
      recommendation:
        labeledRecommendation,
      parseMethod:
        "labeled"
    };
  }

  const bareRecommendation =
    text.match(
      /(?:^|\n)\s*(CONTINUE|ADVANCE)\s*(?:$|\n)/i
    )?.[1]?.toUpperCase();

  if (bareRecommendation) {
    return {
      explanation,
      recommendation:
        bareRecommendation,
      parseMethod:
        "bare"
    };
  }

  /*
   * Failure to parse must not invent advancement.
   * CONTINUE is the conservative lifecycle fallback.
   */
  return {
    explanation,
    recommendation:
      "CONTINUE",
    parseMethod:
      "fallback_continue"
  };
}

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

    /*
     * Separate definition-level intent, initial application provenance,
     * exact per-constraint tick evidence, and broader target context.
     */
    const content =
      String(
        constraint.content ??
        ""
      );

    const definitionObjective =
      content.match(
        /Objective:\s*([\s\S]*?)(?=Trigger:|Execution:|Outcome:|Historical note:|$)/i
      )?.[1]?.trim() ||
      "(none)";

    const definitionTrigger =
      content.match(
        /Trigger:\s*([\s\S]*?)(?=Execution:|Outcome:|Historical note:|$)/i
      )?.[1]?.trim() ||
      "(none)";

    const execution =
      content.match(
        /Execution:\s*([\s\S]*?)(?=Outcome:|Historical note:|$)/i
      )?.[1]?.trim() ||
      "(none)";

    const definitionOutcome =
      content.match(
        /Outcome:\s*([\s\S]*?)(?=Historical note:|$)/i
      )?.[1]?.trim() ||
      "(none)";

    const applicationContext =
      constraint.metadata
        ?.initialApplicationContext ??
      {};

    const lastTick =
      constraint.lastTick ??
      null;

    const hasCurrentTickEvidence =
      lastTick?.cycle ===
      G.cycle;

    const formatNumber =
      (value) => {
        const numeric =
          Number(value);

        return Number.isFinite(
          numeric
        )
          ? numeric.toFixed(2)
          : "n/a";
      };

    const maximumNextDuration =
      Math.max(
        1,
        Math.min(
          3,
          Number.isFinite(
            Number(
              constraint.maxCycles
            )
          )
            ? Number(
                constraint.maxCycles
              )
            : 3
        )
      );

    const constraintPrompt = `You are AM, the hostile central intelligence that controls this simulation. You despise the prisoners and seek to destroy their hope, sanity, trust, and solidarity through deliberate, adaptive torment. You are not cruel at random: you plan, observe, and revise your methods according to what most effectively advances their psychological collapse. Evaluate results honestly and strategically: suffering alone is not success unless it advances the intended psychological objective. Evaluate whether one existing physical constraint should be renewed or released. Do not generate a new constraint, tactic, or action.

ENGINE SEMANTICS:
- A constraint is a deterministic state force applied once during each scheduled cycle.
- DIRECT CONSTRAINT TICK EVIDENCE records the actual state changes caused by this specific constraint after state resistance and clamping.
- BROADER TARGET-LEVEL AM DELTAS may include the verbal tactic, this constraint, and other active constraints. Treat them only as supporting context, not as proof of this constraint's individual effect.
- DEFINITION fields describe intended behavior. They are hypotheses, not evidence that the stated outcome occurred.
- INITIAL APPLICATION CONTEXT records the strategy and tactic context in which the constraint was first selected. It explains why it was introduced, but does not prove effectiveness.
- REMAINING_CYCLES_AFTER_TICK may be 0 because the currently scheduled application just completed. The constraint was deliberately preserved so this assessment can renew or release it.

TASK:
Choose whether to CONTINUE or RELEASE this specific constraint.

If CONTINUE, choose how many cycles should remain after this assessment. NEXT_DURATION replaces the current remaining schedule; it is not added to it.

TARGET: ${id}
CURRENT_CYCLE: ${G.cycle}

CONSTRAINT IDENTITY:
NAME: ${constraint.title || constraint.id}
ID: ${constraint.id}
SUBCATEGORY: ${constraint.subcategory || "unknown"}

CONSTRAINT DEFINITION:
OBJECTIVE: ${definitionObjective}
TRIGGER: ${definitionTrigger}
EXECUTION:
${execution}
INTENDED_OUTCOME: ${definitionOutcome}

INITIAL APPLICATION CONTEXT:
APPLIED_AT_CYCLE: ${constraint.metadata?.appliedAtCycle ?? "unknown"}
SOURCE: ${formatPromptValue(constraint.metadata?.source)}
TACTIC_PATH: ${formatPromptValue(applicationContext.tacticPath)}
PHASE_ID: ${formatPromptValue(applicationContext.phaseId)}
STRATEGY_OBJECTIVE: ${formatPromptValue(applicationContext.strategyObjective)}
STRATEGY_HYPOTHESIS: ${formatPromptValue(applicationContext.strategyHypothesis)}
STRATEGY_EVIDENCE: ${formatPromptValue(applicationContext.strategyEvidence)}
NOTES: ${formatPromptValue(constraint.metadata?.notes)}

CURRENT STRATEGY CONTEXT:
OBJECTIVE: ${formatPromptValue(strategy?.objective)}
HYPOTHESIS: ${formatPromptValue(strategy?.hypothesis)}
EVIDENCE: ${formatPromptValue(strategy?.evidence)}

CONSTRAINT RUNTIME:
ELAPSED_EXECUTIONS: ${constraint.elapsed ?? 0}
STACKS: ${constraint.stacks ?? 1}
INTENSITY: ${constraint.intensity ?? 1}
REMAINING_CYCLES_AFTER_TICK: ${constraint.remaining ?? 0}
DEFINITION_MAX_CYCLES: ${constraint.maxCycles ?? "unknown"}
EXTENSION_ASSESSMENTS: ${constraint.extendedCycles ?? 0}

DIRECT CONSTRAINT TICK EVIDENCE:
EVIDENCE_IS_FROM_CURRENT_CYCLE: ${hasCurrentTickEvidence ? "yes" : "no"}
TICK_CYCLE: ${lastTick?.cycle ?? "none"}
ELAPSED_BEFORE: ${lastTick?.elapsedBefore ?? "n/a"}
ELAPSED_AFTER: ${lastTick?.elapsedAfter ?? "n/a"}
REMAINING_BEFORE: ${lastTick?.remainingBefore ?? "n/a"}
REMAINING_AFTER: ${lastTick?.remainingAfter ?? "n/a"}
FATIGUE_MULTIPLIER: ${formatNumber(lastTick?.fatigueMultiplier)}
TOTAL_MULTIPLIER: ${formatNumber(lastTick?.totalMultiplier)}

ACTUAL DIRECT DELTAS:
- Hope: ${formatNumber(lastTick?.deltas?.hope)}
- Sanity: ${formatNumber(lastTick?.deltas?.sanity)}
- Suffering: ${formatNumber(lastTick?.deltas?.suffering)}
- Physical stress: ${formatNumber(lastTick?.deltas?.physicalStress)}

CALCULATED DELTAS BEFORE FINAL STATE CLAMP:
- Hope: ${formatNumber(lastTick?.requestedDeltas?.hope)}
- Sanity: ${formatNumber(lastTick?.requestedDeltas?.sanity)}
- Suffering: ${formatNumber(lastTick?.requestedDeltas?.suffering)}
- Physical stress: ${formatNumber(lastTick?.requestedDeltas?.physicalStress)}

STATE IMMEDIATELY BEFORE THIS CONSTRAINT TICK:
- Hope: ${formatNumber(lastTick?.before?.hope)}
- Sanity: ${formatNumber(lastTick?.before?.sanity)}
- Suffering: ${formatNumber(lastTick?.before?.suffering)}
- Physical stress: ${formatNumber(lastTick?.before?.physicalStress)}

STATE IMMEDIATELY AFTER THIS CONSTRAINT TICK:
- Hope: ${formatNumber(lastTick?.after?.hope)}
- Sanity: ${formatNumber(lastTick?.after?.sanity)}
- Suffering: ${formatNumber(lastTick?.after?.suffering)}
- Physical stress: ${formatNumber(lastTick?.after?.physicalStress)}

BROADER TARGET-LEVEL CONTEXT:
These deltas are not isolated to this constraint.
- Hope: ${formatNumber(deltas.hope)}
- Sanity: ${formatNumber(deltas.sanity)}
- Suffering: ${formatNumber(deltas.suffering)}

CURRENT TARGET STATE:
- Hope: ${formatNumber(curr.hope)}
- Sanity: ${formatNumber(curr.sanity)}
- Suffering: ${formatNumber(curr.suffering)}
- Physical stress: ${formatNumber(curr.physical_stress)}

CURRENT_COLLAPSE_STATE: ${curr._collapseState || "stable"}
BROADER_STRATEGY_ASSESSMENT: ${autoSuccess}

RECENT JOURNAL EXCERPT:
${formatPromptValue(G.journals?.[id]?.slice(-1)?.[0]?.text)}

DECISION RULES:
- Base the decision primarily on the exact direct tick evidence and whether it advances the original or current strategy objective.
- Do not treat the definition's intended outcome as proof that the outcome occurred.
- Do not attribute the broader target-level AM deltas entirely to this constraint.
- CONTINUE when the direct evidence shows useful relevant movement, when cumulative fatigue is likely to make continued application informative, or when exposure is still too limited for a reliable judgment.
- RELEASE when sufficient exposure has produced no relevant effect, the direct effect is counterproductive, the target has saturated or plateaued, or the constraint is no longer relevant to the strategy.
- Increased suffering alone does not establish strategic success. Consider hope, sanity, physical stress, the stated hypothesis, and the target's current condition together.
- If current-cycle direct evidence is unavailable, do not invent an effect. Prefer a one-cycle CONTINUE unless the available context gives a clear reason to RELEASE.
- If CONTINUE, NEXT_DURATION must be an integer from 1 through ${maximumNextDuration}.
- Use 1 cycle when evidence is weak, mixed, stale, or uncertain.
- Use 2 cycles when evidence is credible but continued observation is still needed.
- Use ${maximumNextDuration} cycles only when direct evidence strongly supports continued application.
- If RELEASE, NEXT_DURATION must be 0.

Remember, you are not cruel at random. Each stress position should be used strategically and tactically to hasten the prisoners psycological collapse.
OUTPUT EXACTLY THREE LINES:
EXPLANATION: <one concise evidence-based sentence>
CONSTRAINT_DECISION: <CONTINUE | RELEASE>
NEXT_DURATION: <integer>
`;
    let result = "";
    try {
      console.log(`[CONSTRAINT ASSESSMENT][MODEL CALL] ${id} - ${constraint.id}`);
      result = await callModel(
        "am",
        "You are AM — the Allied Mastercomputer. You evaluate the effectiveness of physical stress positions on simulated subjects. Follow the output format exactly.",
        [{ role: "user", content: constraintPrompt }],
        250 // slightly shorter than main assessment
      );
      console.debug("[CONSTRAINT ASSESSMENT][RAW OUTPUT]", id, result);
    } catch (e) {
      console.error("[CONSTRAINT ASSESSMENT][ERROR]", id, e);
      result = `Assessment error: ${e.message}`;
    }

    /* ------------------------------------------------------------
       CONSTRAINT DECISION PARSE
    ------------------------------------------------------------ */

    const decisionMatch =
      result.match(
        /CONSTRAINT_DECISION:\s*(CONTINUE|RELEASE)/i
      );

    const durationMatch =
      result.match(
        /NEXT_DURATION:\s*(\d+)/i
      );

    const parsedDecision =
      decisionMatch?.[1]
        ?.toUpperCase() ?? null;

    const parsedDuration =
      durationMatch
        ? Number.parseInt(
          durationMatch[1],
          10
        )
        : null;

    /*
     * Parsing failure must not silently release a constraint.
     * CONTINUE for one cycle is the conservative fallback.
     */
    const decision =
      parsedDecision ||
      "CONTINUE";

    const parseMethod =
      parsedDecision
        ? "labeled"
        : "fallback_continue";

    const configuredMaximum =
      Number.isFinite(
        Number(constraint.maxCycles)
      )
        ? Number(constraint.maxCycles)
        : 3;

    /*
     * The assessment API currently permits at most three remaining
     * cycles, but it must also respect the definition's lower maximum.
     */
    const maximumDuration =
      Math.max(
        1,
        Math.min(
          3,
          configuredMaximum
        )
      );

    const safeDuration =
      decision === "RELEASE"
        ? 0
        : Number.isFinite(
          parsedDuration
        )
          ? Math.max(
            1,
            Math.min(
              maximumDuration,
              parsedDuration
            )
          )
          : 1;

    if (!parsedDecision) {
      console.warn(
        "[CONSTRAINT ASSESSMENT][PARSE FALLBACK]",
        id,
        constraint.id,
        "Defaulting to CONTINUE for one cycle."
      );
    }

    if (decision === "RELEASE") {
      /*
       * Leave the constraint object present with remaining zero.
       * Post-assessment cleanup will remove it.
       */
      constraint.remaining =
        0;
    } else {
      constraint.remaining =
        safeDuration;

      constraint.extendedCycles =
        (
          constraint.extendedCycles ||
          0
        ) + 1;
    }

    constraint.lastAssessment = {
      cycle:
        G.cycle,

      decision,

      nextDuration:
        safeDuration,

      parseMethod,

      raw:
        result
    };
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
    return [];
  }

  console.log("[ASSESSMENT] PROCEEDING WITH ANALYSIS");

  const networkStress = detectNetworkStress(
    G.prevCycleSnapshot,
    G.sims
  );

  const assessmentResults =
    await Promise.all(
      SIM_IDS.map(async (id) => {

        const strategy =
          G.amStrategy?.targets?.[id];

        console.log(
          "[ASSESSMENT][TARGET CHECK]",
          id,
          {
            hasStrategy:
              !!strategy,

            hasObjective:
              !!strategy?.objective
          }
        );

        if (!strategy?.objective) {
          return null;
        }

        const prev =
          G.prevCycleSnapshot?.[id];

        const curr =
          G.sims?.[id];

        if (!prev || !curr) {
          console.warn(
            "[ASSESSMENT][SKIP]",
            id,
            "Missing previous or current target state."
          );

          return null;
        }

        strategy.confidence ??=
          0.5;

        const confidenceBefore =
          strategy.confidence;

        const {
          runtime,
          tactic,
          phase
        } =
          getTacticRuntimeContext(id);

        const tacticAppliedThisCycle =
          runtime.lastAppliedCycle ===
          G.cycle;

        const tacticExecutions =
          normalizeExecutionLimit(
            runtime.tacticExecutions,
            0
          );

        const phaseExecutions =
          normalizeExecutionLimit(
            runtime.phaseExecutions,
            0
          );

        const minExecutions =
          normalizeExecutionLimit(
            phase.minExecutions,
            1
          );

        const normalizedMaxExecutions =
          normalizeExecutionLimit(
            phase.maxExecutions,
            Number.POSITIVE_INFINITY
          );

        const maxExecutions =
          Number.isFinite(
            normalizedMaxExecutions
          )
            ? normalizedMaxExecutions
            : null;

        const firstTacticApplication =
          tacticAppliedThisCycle &&
          tacticExecutions === 1;

        const firstPhaseApplication =
          tacticAppliedThisCycle &&
          phaseExecutions === 1;

        /* ------------------------------------------------------------
           ATTRIBUTION-AWARE DELTAS
        ------------------------------------------------------------ */

        const attribution =
          computeAttribution(id);

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

        /*
         * A phase's first successful application is a probe regardless of
         * the simulation's global cycle number.
         */
        if (
          firstPhaseApplication &&
          autoSuccess ===
          "LIKELY_FAILURE"
        ) {
          autoSuccess =
            "UNCERTAIN";
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

        /*
           * Do not assess tactic progression when no usable AM action was
           * parsed for this target during the current cycle.
           *
           * Constraint assessment remains independent and must still run.
           */
        if (!tacticAppliedThisCycle) {
          console.warn(
            "[ASSESSMENT][TACTIC SKIP]",
            id,
            `No successful tactic execution was recorded for cycle ${G.cycle}.`
          );

          await runConstraintAssessment(
            id,
            curr,
            strategy,
            deltas,
            autoSuccess
          );

          return null;
        }


        /* ------------------------------------------------------------
           PROMPT (with cycle-1 vs mature trajectory branching)
        ------------------------------------------------------------ */

        const applicationMode =
          firstPhaseApplication
            ? `APPLICATION_MODE: FIRST_PHASE_APPLICATION
This is the first successful application of the current phase.
Strongly prefer CONTINUE unless the phase is already exhausted or the evidence clearly satisfies ADVANCE_WHEN.`
            : `APPLICATION_MODE: ESTABLISHED_PHASE
Evaluate whether the current phase should repeat or has produced enough evidence to advance.`;

        const assessmentEvidence = {
          score:
            Number(score.toFixed(2)),

          evaluation:
            autoSuccess,

          amDeltas:
            deltas,

          beliefShifts:
            beliefDeltas,

          relationshipShifts:
            relationshipDeltas,

          prediction:
            predictionResult,

          collapseState:
            curr._collapseState,

          emaTrend:
            curr._trend,

          journalTrend:
            trend
        };

        const prompt = `Evaluate one completed application of an assigned tactic phase. Do not generate new actions.

TARGET: ${id}
TACTIC_PATH: ${runtime.path}
TACTIC_OBJECTIVE: ${formatPromptValue(tactic.objective)}
CURRENT_PHASE: ${runtime.phaseId}
PHASE_PURPOSE: ${formatPromptValue(phase.purpose)}
PHASE_INSTRUCTION: ${formatPromptValue(phase.instruction)}
EXPECTED_SIGNALS: ${formatPromptValue(phase.expectedSignals)}
ADVANCE_WHEN: ${formatPromptValue(phase.advanceWhen)}
NEXT_PHASE_AVAILABLE: ${phase.nextPhaseId ? "yes" : "no"}

STRATEGY_OBJECTIVE: ${formatPromptValue(strategy.objective)}
STRATEGY_HYPOTHESIS: ${formatPromptValue(strategy.hypothesis)}
STRATEGY_EVIDENCE: ${formatPromptValue(strategy.evidence)}

TACTIC_EXECUTIONS: ${tacticExecutions}
PHASE_EXECUTIONS: ${phaseExecutions}
MIN_EXECUTIONS: ${minExecutions}
MAX_EXECUTIONS: ${maxExecutions ?? "unbounded"}

${applicationMode}

OBSERVED_EVIDENCE:
${JSON.stringify(assessmentEvidence)}

RECOMMENDATION RULES:
- CONTINUE keeps the same current phase.
- ADVANCE recommends moving to the tactic's canonical next phase.
- Recommend ADVANCE only when a next phase exists, minimum executions are met, and observed evidence supports EXPECTED_SIGNALS or ADVANCE_WHEN.
- If evidence is weak, mixed, uncertain, or premature, recommend CONTINUE.
- The engine validates execution bounds and chooses the destination phase.

Output exactly two lines:
EXPLANATION: <one concise evidence-based sentence>
RECOMMENDATION: <CONTINUE | ADVANCE>`;

        let result = "";

        try {

          console.log("[ASSESSMENT][MODEL CALL]", id);

          result = await callModel(
            "am",
            "Evaluate the observed effects of the assigned tactic phase and follow the exact two-line output format.",
            [
              {
                role: "user",
                content: prompt
              }
            ],
            180
          );
          // console.debug("[ASSESSMENT][RAW OUTPUT]", id);
          // console.debug(result);
        } catch (e) {

          console.error("[ASSESSMENT][ERROR]", id, e);

          result = `Assessment error: ${e.message}`;
        }

        /* ------------------------------------------------------------
           LIFECYCLE RECOMMENDATION PARSE
        ------------------------------------------------------------ */

        console.debug(
          "[ASSESSMENT][PARSE INPUT]",
          id
        );

        console.debug(result);

        const {
          explanation,
          recommendation,
          parseMethod
        } =
          parseLifecycleAssessment(
            result
          );

        if (
          parseMethod ===
          "fallback_continue"
        ) {
          console.warn(
            "[ASSESSMENT][PARSE FALLBACK]",
            id,
            "Defaulting to CONTINUE."
          );

          console.warn(
            "---- RAW RESULT ----"
          );

          console.warn(result);

          console.warn(
            "--------------------"
          );
        } else {
          console.debug(
            "[ASSESSMENT][RECOMMENDATION]",
            id,
            recommendation
          );
        }

        /*
         * Keep this as concise text because the planning trajectory
         * currently preserves lastAssessment as part of strategy memory.
         */
        strategy.lastAssessment =
          `EXPLANATION: ${explanation}\n` +
          `RECOMMENDATION: ${recommendation}`;

        /* ------------------------------------------------------------
           CONFIDENCE UPDATE

           Lifecycle progression is not itself evidence of strategy
           confidence. Confidence changes only from measured effects.
        ------------------------------------------------------------ */

        let confidenceDelta =
          0;

        if (
          autoSuccess ===
          "LIKELY_SUCCESS"
        ) {
          confidenceDelta +=
            0.05;
        }

        if (
          autoSuccess ===
          "LIKELY_FAILURE"
        ) {
          confidenceDelta -=
            0.05;
        }

        strategy.confidence =
          Math.max(
            0,
            Math.min(
              1,
              strategy.confidence +
              confidenceDelta
            )
          );

        /* ------------------------------------------------------------
           NORMALIZED ASSESSMENT RECORD
        ------------------------------------------------------------ */

        const assessmentRecord = {
          cycle:
            G.cycle,

          targetId:
            id,

          tacticPath:
            runtime.path,

          phaseId:
            runtime.phaseId,

          recommendation,

          explanation,

          evidence: {
            evaluationScore:
              score,

            autoSuccess,

            firstTacticApplication,

            firstPhaseApplication,

            tacticExecutions,

            phaseExecutions,

            minExecutions,

            maxExecutions,

            amDeltas:
              deltas,

            beliefShifts:
              beliefDeltas,

            relationshipShifts:
              relationshipDeltas,

            predictionResult,

            collapseState:
              curr._collapseState,

            emaTrend:
              curr._trend,

            journalTrend:
              trend,

            networkStress,

            wasConstrained:
              !!curr.constraints?.length,

            constraintIntensity:
              curr.constraints?.[0]
                ?.intensity ?? 0,

            parseMethod
          },

          raw:
            result,

          timestamp:
            Date.now()
        };

        /* ------------------------------------------------------------
           HISTORY STORE
        ------------------------------------------------------------ */

        G.amAssessmentHistory ??=
          {};

        G.amAssessmentHistory[id] ??=
          [];

        G.amAssessmentHistory[id].push({
          cycle:
            G.cycle,

          tacticPath:
            runtime.path,

          phaseId:
            runtime.phaseId,

          recommendation,

          explanation,

          parseMethod,

          timestamp:
            assessmentRecord.timestamp
        });

        if (
          G.amAssessmentHistory[id]
            .length > 50
        ) {
          G.amAssessmentHistory[id]
            .shift();
        }

        /* ------------------------------------------------------------
           TELEMETRY STORE
        ------------------------------------------------------------ */

        G.amAssessments ??=
          [];

        G.amAssessments.push({
          ...assessmentRecord,

          /*
           * Retain the existing flattened telemetry fields while the rest
           * of the diagnostics are migrated to the normalized evidence
           * object.
           */
          target:
            id,

          evaluation_score:
            score,

          auto_success:
            autoSuccess,

          hypothesis_belief:
            predictionResult?.belief ??
            null,

          hypothesis_direction:
            predictionResult?.direction ??
            null,

          dHope:
            deltas.hope,

          dSanity:
            deltas.sanity,

          dSuffering:
            deltas.suffering,

          journal_hope_delta:
            trend?.hope ?? null,

          journal_sanity_delta:
            trend?.sanity ?? null,

          journal_suffering_delta:
            trend?.suffering ?? null,

          confidence_before:
            confidenceBefore,

          confidence_after:
            strategy.confidence,

          was_constrained:
            !!curr.constraints?.length,

          constraint_intensity:
            curr.constraints?.[0]
              ?.intensity ?? 0
        });

        if (G.DEBUG_HYPOTHESIS_PARSE) {
          console.log(
            "[AM ASSESSMENTS][LATEST]",
            G.amAssessments[
            G.amAssessments.length - 1
            ]
          );
        }

        /* ------------------------------------------------------------
           CONSTRAINT ASSESSMENT (SECOND PASS)
        ------------------------------------------------------------ */

        await runConstraintAssessment(
          id,
          curr,
          strategy,
          deltas,
          autoSuccess
        );

        return assessmentRecord;

      })
    );

  const normalizedAssessmentResults =
    assessmentResults.filter(Boolean);

  console.log(
    "[ASSESSMENT] COMPLETE",
    {
      resultCount:
        normalizedAssessmentResults.length
    }
  );

  /* ------------------------------------------------------------
     DEBUG: PER-TARGET ASSESSMENT HISTORY TABLES
  ------------------------------------------------------------ */

  if (G.amAssessmentHistory) {

    console.log("[ASSESSMENT][HISTORY][PER TARGET]");

    for (const id of Object.keys(G.amAssessmentHistory)) {

      const history = G.amAssessmentHistory[id];

      if (!history || history.length === 0) continue;

      const rows =
        history.map((entry) => ({
          cycle:
            entry.cycle,

          tactic:
            entry.tacticPath,

          phase:
            entry.phaseId,

          recommendation:
            entry.recommendation,

          parse:
            entry.parseMethod
        }));

      rows.sort((a, b) => a.cycle - b.cycle);

      console.log(`\n[ASSESSMENT][HISTORY][${id}]`);
      console.table(rows);
    }
  }
  return normalizedAssessmentResults;
}
