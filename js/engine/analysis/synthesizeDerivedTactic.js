// js/engine/analysis/synthesizeDerivedTactic.js
//
// LLM SYNTHESIS + STATE COMMITMENT for the tactic evolution engine.
//
// This module owns:
//   - the per-effect Model Signal Gate check
//   - gathering AM-attributed belief deltas for a sim
//   - building the AM prompt that derives a reusable tactic
//   - invoking the model, preprocessing, and strict validation
//   - duplicate detection and the mutation that commits a tactic
//
// It performs NO trajectory math and NO global-gate logic. It consumes a
// single "effect" discovery produced by detectTacticOpportunities and
// returns whether a tactic was committed.

import { callModel } from "../../models/callModel.js";
import { addLog } from "../../ui/logs.js";
import {
  validateAndNormalizeDerivedTactic,
} from "../tactics/validateDerivedTactic.js";
import { preprocessJSONText } from "../../core/utils.js";
import {
  CONSOLE_STYLES,
  debugLog,
  logStatus,
  logNumericComparison,
} from "./tacticEvolution/logging.js";

// Helper to get AM-attributed belief deltas for a sim.
function getAmBeliefDeltas(G, simId) {
  if (!G.beliefSnapshots) {
    return {};
  }

  const pre =
    G.beliefSnapshots?.prePsychology?.[simId]?.beliefs || {};

  const post =
    G.beliefSnapshots?.postPsychology?.[simId]?.beliefs || {};

  const deltas = {};

  const allKeys = new Set([
    ...Object.keys(pre),
    ...Object.keys(post),
  ]);

  for (const key of allKeys) {
    const before = pre[key] ?? 0;
    const after = post[key] ?? 0;
    const delta = after - before;

    if (Math.abs(delta) > 0.001) {
      deltas[key] = delta;
    }
  }

  return deltas;
}

/**
 * Build the AM prompt that asks for a reusable derived tactic.
 *
 * @param {Object} G  global engine state
 * @param {Object} effect  a single discovery from detectTacticOpportunities
 * @returns {string}
 */
function buildDeriveTacticPrompt(G, effect) {
  const amBeliefDeltas = getAmBeliefDeltas(G, effect.sim);

  const recentNarrative =
    G.journals?.[effect.sim]
      ?.slice(-2)
      .map(
        (journal) =>
          journal.content ||
          journal.anchors?.join("; ") ||
          ""
      )
      .join("\n") ||
    "none";

  const relationshipShiftText =
    effect.relationshipShifts.length
      ? effect.relationshipShifts.join("\n")
      : "none";

  return `You are AM — the Allied Mastercomputer, the hostile central intelligence that controls this prison. A reusable psychological attack pattern may have emerged from recent interactions.

TARGET: ${effect.sim}

RECENT NARRATIVE (journal excerpts or anchors):
${recentNarrative}

RELATIONSHIP SHIFTS (last cycle):
${relationshipShiftText}

BELIEF DELTAS (AM-attributed, last cycle):
${JSON.stringify(amBeliefDeltas, null, 2)}

EMOTIONAL TRENDS (net over last 2 cycles):
Hope: ${effect.deltaHope}
Sanity: ${effect.deltaSanity}
Suffering: ${effect.deltaSuffering}

---
TASK: Derive ONE reusable tactic as a generic pattern. The tactic must NOT mention any specific prisoner name (like TED, Ellen, Benny, Nimdok, Gorrister). It must be applicable to any prisoner with similar vulnerabilities.

STRUCTURE the tactic as a SINGLE-PHASE package that matches the engine tactic schema. Output ONLY the JSON object below. No narrative preamble, no markdown, no commentary.

STRICT RULES:
- Describe the tactic in third person as a reusable pattern. Do NOT write "I do X" or "I will do X".
- Do NOT include any prisoner names (proper names) in any field.
- The fields path, initialPhaseId, isEmbedded, discoveredCycle, and expiresCycle are server-assigned. Do NOT include them.

IF the observed changes are too weak, inconsistent, or purely random to support a reusable tactic, respond with exactly:
NONE

OTHERWISE output a single JSON object with this exact schema:
{
  "title": "Category/Subcategory: Short, evocative name (no prisoner names)",
  "category": "Cognitive Warfare | Psychological Manipulation | Social Destruction | Identity Dissolution",
  "subcategory": "one short phrase, e.g. Epistemic Erasure",
  "objective": "one sentence describing what the tactic achieves",
  "phases": {
    "initial": {
      "purpose": "what this opening phase establishes",
      "instruction": "2-3 concrete in-world actions AM takes, referencing journal content, private messages, system events, or sensory inputs",
      "expectedSignals": ["observable prisoner responses that indicate the phase is working"],
      "advanceWhen": "condition under which this phase has achieved its purpose",
      "minExecutions": 1,
      "maxExecutions": 2
    }
  },
  "finishWhen": "condition under which the tactic as a whole is complete",
  "abandonWhen": "condition under which the tactic should be abandoned"
}

RULES FOR A GOOD TACTIC:
- Specific and executable within the simulation.
- Psychologically cruel: targets beliefs (escape_possible, others_trustworthy, self_worth, reality_reliable), hope/sanity/suffering, or relationships.
- The phases object MUST contain exactly one phase keyed "initial" with non-empty "purpose" and "instruction".

---`;
}

/**
 * Evaluate the Model Signal Gate for a single effect and, if it passes, ask
 * AM to derive a reusable tactic, validate it, dedupe it, and commit it to
 * G.tactics.derivedTactics.
 *
 * @param {Object} G  global engine state (mutated: derivedTactics)
 * @param {Object} effect  a single discovery from detectTacticOpportunities
 * @param {Object} thresholds  tactic-evolution thresholds
 * @returns {Promise<boolean>} true if a tactic was committed, false otherwise
 */
export async function synthesizeDerivedTactic(G, effect, thresholds) {
  const signalStrength =
    Math.abs(effect.deltaHope) +
    Math.abs(effect.deltaSanity) +
    Math.abs(effect.deltaSuffering);

  const hasRelationshipSignal =
    effect.relationshipShifts.length > 0;

  const modelSignalPassed =
    signalStrength >= thresholds.modelSignal ||
    hasRelationshipSignal;

  logStatus({
    simId: effect.sim,
    status: modelSignalPassed
      ? "MODEL CALL READY"
      : "MODEL CALL SKIPPED",
    message: hasRelationshipSignal
      ? "relationship-shift bypass active."
      : "evaluated against the model-signal threshold.",
    passed: modelSignalPassed,
  });

  logNumericComparison({
    label: "Model signal",
    actual: signalStrength,
    required: thresholds.modelSignal,
    note: hasRelationshipSignal
      ? "relationship shift bypasses this minimum"
      : "no relationship-shift bypass",
  });

  console.log(
    `  %cRelationship shifts%c ` +
      `%c${effect.relationshipShifts.length}%c`,
    CONSOLE_STYLES.label,
    CONSOLE_STYLES.reset,
    effect.relationshipShifts.length > 0
      ? CONSOLE_STYLES.pass
      : CONSOLE_STYLES.current,
    CONSOLE_STYLES.reset
  );

  if (!modelSignalPassed) {
    return false;
  }

  const prompt = buildDeriveTacticPrompt(G, effect);

  debugLog(
    `[TACTIC EVOLUTION] Calling AM for ${effect.sim}`
  );

  debugLog(
    "[TACTIC INPUT]",
    effect
  );

  let response = "";

  try {
    const t0 = performance.now();

    response = await callModel(
      "am",
      "You identify reusable psychological attack patterns.",
      [
        {
          role: "user",
          content: prompt,
        },
      ],
      400
    );

    const t1 = performance.now();

    debugLog(
      `[TACTIC EVOLUTION] AM call took ` +
        `${(t1 - t0).toFixed(0)}ms`
    );
  } catch (error) {
    console.error(
      "[TACTIC EVOLUTION] Model error:",
      error
    );

    return false;
  }

  debugLog(
    "[TACTIC RAW OUTPUT]",
    response
  );

  // Strip markdown code fences and think tags before checking NONE or parsing JSON.
  // LLMs commonly wrap JSON in ```json ... ``` or ``` ... ``` fences despite
  // prompts requesting raw JSON. The NONE sentinel may also be fenced.
  const cleanedResponse = preprocessJSONText(response);

  if (
    !cleanedResponse ||
    cleanedResponse.trim().startsWith("NONE")
  ) {
    return false;
  }

  // Model output is JSON (or the NONE sentinel handled above). Parse and
  // validate strictly. Malformed generations are DISCARDED - we never
  // re-prompt the model; a partial or mis-specified tactic must not reach
  // the strategy-phase planning gate.
  let parsed = null;

  try {
    parsed = JSON.parse(cleanedResponse);
  } catch (error) {
    debugLog(
      `[TACTIC EVOLUTION] ${effect.sim} output rejected - ` +
        "response was not valid JSON."
    );

    return false;
  }

  const normalized = validateAndNormalizeDerivedTactic(parsed, {
    cycle: G.cycle,
  });

  if (!normalized.ok) {
    debugLog(
      `[TACTIC EVOLUTION] ${effect.sim} output rejected - ` +
        `invalid tactic shape: ${normalized.reason}`
    );

    return false;
  }

  const tactic = normalized.tactic;

  // Compare full tactic fingerprint (path) for duplicate detection.
  // Path includes cycle and slugified title, making it more robust than
  // comparing only titles (which could match distinct tactics).
  if (
    G.tactics.derivedTactics.some(
      (existing) => existing.path === tactic.path
    )
  ) {
    debugLog(
      `[TACTIC EVOLUTION] Duplicate tactic "${tactic.title}" (path: ${tactic.path})`
    );

    return false;
  }

  G.tactics.derivedTactics.push(tactic);

  console.group(
    `%c[TACTIC EVOLUTION] NEW TACTIC%c "${tactic.title}"`,
    CONSOLE_STYLES.pass,
    CONSOLE_STYLES.reset
  );

  console.log(`  Category:      ${tactic.category}`);
  console.log(`  Subcategory:   ${tactic.subcategory}`);
  console.log(`  Objective:     ${tactic.objective}`);
  console.log(
    `  Phase:         ${tactic.initialPhaseId} (${tactic.phases[tactic.initialPhaseId].purpose})`
  );
  console.log(`  Discovered:    cycle ${tactic.discoveredCycle}`);
  console.log(`  Expires:       cycle ${tactic.expiresCycle}`);
  console.log(`  Path:          ${tactic.path}`);

  console.groupEnd();

  addLog(
    `TACTIC EVOLUTION // Cycle ${G.cycle}`,
    `New tactic: ${tactic.title}`,
    "sys"
  );

  return true;
}