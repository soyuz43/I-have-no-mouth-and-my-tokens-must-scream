// js/engine/analysis/tacticEvolution.js

import { G } from "../../core/state.js";
import { SIM_IDS } from "../../core/constants.js";
import { callModel } from "../../models/callModel.js";
import { addLog } from "../../ui/logs.js";

/**
 * ============================================================
 * TACTIC EVOLUTION ENGINE
 * ------------------------------------------------------------
 * Detects sustained psychological transformations (not spikes)
 * and asks AM whether a reusable manipulation tactic has emerged.
 *
 * UPDATED:
 * - Hard skip for weak signals
 * - Global signal gate
 * - Token cap reduction
 * - Full logging visibility (input/output/timing)
 * - Gate diagnostics showing actual values, thresholds, and shortfalls
 * - Structured, color-coordinated browser-console diagnostics
 * ============================================================
 */

import {
  CONSOLE_STYLES,
  debugLog,
  logRunStart,
  logRunComplete,
  logStatus,
  logNumericComparison,
  logThresholds,
  logHistoryGate,
  logConsistencyGate,
  logTrajectoryGate,
  logTrajectoryPassed,
} from "./tacticEvolution/logging.js";

const TACTIC_EVOLUTION_THRESHOLDS = Object.freeze({
  historySamples: 2,
  consistency: 0.7,
  relationshipShift: 0.25,
  netMagnitude: 12,
  multiStatDelta: 2,
  totalSignal: 8,
  modelSignal: 6,
});

export async function runTacticEvolution() {
  logRunStart();

  debugLog(
    "[TACTIC EVOLUTION] Starting tactic evolution scan..."
  );

  const thresholds =
    TACTIC_EVOLUTION_THRESHOLDS;

  logThresholds(thresholds);

  if (!G.prevCycleSnapshot) {
    logStatus({
      status:
        "SKIPPED",
      message:
        "no previous cycle snapshot is available.",
    });

    logRunComplete();

    return;
  }

  G.tacticHistory ??= {};
  G.tactics.derivedTactics ??= [];

  // Helper to get AM-attributed belief deltas for a sim.
  function getAmBeliefDeltas(simId) {
    if (!G.beliefSnapshots) {
      return {};
    }

    const pre =
      G.beliefSnapshots
        ?.prePsychology
        ?.[simId]
        ?.beliefs ||
      {};

    const post =
      G.beliefSnapshots
        ?.postPsychology
        ?.[simId]
        ?.beliefs ||
      {};

    const deltas = {};

    const allKeys =
      new Set([
        ...Object.keys(pre),
        ...Object.keys(post),
      ]);

    for (const key of allKeys) {
      const before =
        pre[key] ?? 0;

      const after =
        post[key] ?? 0;

      const delta =
        after - before;

      if (
        Math.abs(delta) >
        0.001
      ) {
        deltas[key] =
          delta;
      }
    }

    return deltas;
  }

  /* ------------------------------------------------------------
     Remove expired derived tactics
  ------------------------------------------------------------ */

  G.tactics.derivedTactics =
    G.tactics.derivedTactics.filter(
      (tactic) =>
        tactic.expiresCycle >=
        G.cycle
    );

  const discoveries = [];

  /* ------------------------------------------------------------
     SCAN FOR TRAJECTORY-BASED EFFECTS
  ------------------------------------------------------------ */

  for (const id of SIM_IDS) {
    const prev =
      G.prevCycleSnapshot[id];

    const curr =
      G.sims[id];

    if (!prev || !curr) {
      logStatus({
        simId:
          id,

        status:
          "SKIPPED",

        message:
          `missing ${
            !prev
              ? "previous snapshot"
              : "current state"
          }.`,
      });

      continue;
    }

    const deltaHope =
      curr.hope -
      prev.hope;

    const deltaSanity =
      curr.sanity -
      prev.sanity;

    const deltaSuffering =
      curr.suffering -
      prev.suffering;

    G.tacticHistory[id] ??= [];

    G.tacticHistory[id].push({
      cycle:
        G.cycle,

      hope:
        deltaHope,

      sanity:
        deltaSanity,

      suffering:
        deltaSuffering,
    });

    if (
      G.tacticHistory[id].length >
      4
    ) {
      G.tacticHistory[id].shift();
    }

    const history =
      G.tacticHistory[id];

    if (
      history.length <
      thresholds.historySamples
    ) {
      logHistoryGate({
        thresholds,

        simId:
          id,

        historyLength:
          history.length,

        deltaHope,
        deltaSanity,
        deltaSuffering,
      });

      continue;
    }

    const relationshipShifts = [];
    let maxRelationshipDelta = 0;

    for (const other of SIM_IDS) {
      if (other === id) {
        continue;
      }

      const before =
        prev.relationships
          ?.[other] ??
        0;

      const after =
        curr.relationships
          ?.[other] ??
        0;

      const delta =
        after - before;

      const absoluteDelta =
        Math.abs(delta);

      maxRelationshipDelta =
        Math.max(
          maxRelationshipDelta,
          absoluteDelta
        );

      if (
        absoluteDelta >=
        thresholds.relationshipShift
      ) {
        relationshipShifts.push(
          `${id}→${other}: ` +
          `${before.toFixed(2)} → ` +
          `${after.toFixed(2)} ` +
          `(|Δ| ${absoluteDelta.toFixed(2)})`
        );
      }
    }

    function consistency(values) {
      const signs =
        values
          .map(
            (value) =>
              Math.sign(value)
          )
          .filter(
            (value) =>
              value !== 0
          );

      if (
        signs.length === 0
      ) {
        return 0;
      }

      const counts = {};

      for (const sign of signs) {
        counts[sign] =
          (counts[sign] || 0) +
          1;
      }

      return (
        Math.max(
          ...Object.values(
            counts
          )
        ) /
        signs.length
      );
    }

    const hopeSeries =
      history.map(
        (entry) =>
          entry.hope
      );

    const sanitySeries =
      history.map(
        (entry) =>
          entry.sanity
      );

    const sufferingSeries =
      history.map(
        (entry) =>
          entry.suffering
      );

    const hopeConsistency =
      consistency(
        hopeSeries
      );

    const sanityConsistency =
      consistency(
        sanitySeries
      );

    const sufferingConsistency =
      consistency(
        sufferingSeries
      );

    const bestConsistency =
      Math.max(
        hopeConsistency,
        sanityConsistency,
        sufferingConsistency
      );

    if (
      bestConsistency <
      thresholds.consistency
    ) {
      logConsistencyGate({
        thresholds,

        simId:
          id,

        hopeConsistency,
        sanityConsistency,
        sufferingConsistency,
      });

      continue;
    }

    const netHope =
      history.reduce(
        (sum, entry) =>
          sum +
          entry.hope,
        0
      );

    const netSanity =
      history.reduce(
        (sum, entry) =>
          sum +
          entry.sanity,
        0
      );

    const netSuffering =
      history.reduce(
        (sum, entry) =>
          sum +
          entry.suffering,
        0
      );

    const netMagnitude =
      Math.abs(
        netHope
      ) * 0.6 +
      Math.abs(
        netSanity
      ) * 0.7 +
      Math.abs(
        netSuffering
      ) * 0.5;

    const absoluteDeltaHope =
      Math.abs(
        deltaHope
      );

    const absoluteDeltaSanity =
      Math.abs(
        deltaSanity
      );

    const multiStat =
      absoluteDeltaHope >
        thresholds.multiStatDelta &&
      absoluteDeltaSanity >
        thresholds.multiStatDelta;

    const relationshipSignal =
      relationshipShifts.length >
      0;

    const structuralSignal =
      relationshipSignal ||
      multiStat;

    const netMagnitudePassed =
      netMagnitude >=
      thresholds.netMagnitude;

    if (
      !netMagnitudePassed ||
      !structuralSignal
    ) {
      logTrajectoryGate({
        thresholds,

        simId:
          id,

        bestConsistency,
        netMagnitude,
        maxRelationshipDelta,
        absoluteDeltaHope,
        absoluteDeltaSanity,
        relationshipSignal,
        multiStat,
      });

      continue;
    }

    logTrajectoryPassed({
      thresholds,

      simId:
        id,

      bestConsistency,
      netHope,
      netSanity,
      netSuffering,
      netMagnitude,
      maxRelationshipDelta,
      relationshipSignal,
      multiStat,
    });

    discoveries.push({
      sim:
        id,

      deltaHope,
      deltaSanity,
      deltaSuffering,
      relationshipShifts,
      netHope,
      netSanity,
      netSuffering,
      netMagnitude,
      bestConsistency,
      maxRelationshipDelta,
      multiStat,
    });
  }

  /* ------------------------------------------------------------
     GLOBAL SIGNAL GATE
  ------------------------------------------------------------ */

  if (
    discoveries.length === 0
  ) {
    logStatus({
      status:
        "SKIPPED",

      message:
        "global gate not reached; 0 trajectory candidates passed and no model calls will run.",
    });

    logRunComplete();

    return;
  }

  const totalSignal =
    discoveries.reduce(
      (
        sum,
        discovery
      ) =>
        sum +
        Math.abs(
          discovery.deltaHope
        ) +
        Math.abs(
          discovery.deltaSanity
        ) +
        Math.abs(
          discovery.deltaSuffering
        ),
      0
    );

  const globalSignalPassed =
    totalSignal >=
    thresholds.totalSignal;

  logStatus({
    status:
      globalSignalPassed
        ? "PASSED"
        : "SKIPPED",

    message:
      `global signal gate; ${discoveries.length} candidate` +
      `${discoveries.length === 1
        ? ""
        : "s"
      }.`,

    passed:
      globalSignalPassed,
  });

  logNumericComparison({
    label:
      "Global signal",

    actual:
      totalSignal,

    required:
      thresholds.totalSignal,
  });

  if (
    !globalSignalPassed
  ) {
    logRunComplete();

    return;
  }

  const sample =
    discoveries.slice(
      0,
      3
    );

  /* ------------------------------------------------------------
     MODEL EVALUATION
  ------------------------------------------------------------ */

  for (const effect of sample) {
    const signalStrength =
      Math.abs(
        effect.deltaHope
      ) +
      Math.abs(
        effect.deltaSanity
      ) +
      Math.abs(
        effect.deltaSuffering
      );

    const hasRelationshipSignal =
      effect
        .relationshipShifts
        .length >
      0;

    const modelSignalPassed =
      signalStrength >=
        thresholds.modelSignal ||
      hasRelationshipSignal;

    logStatus({
      simId:
        effect.sim,

      status:
        modelSignalPassed
          ? "MODEL CALL READY"
          : "MODEL CALL SKIPPED",

      message:
        hasRelationshipSignal
          ? (
            "relationship-shift bypass active."
          )
          : (
            "evaluated against the model-signal threshold."
          ),

      passed:
        modelSignalPassed,
    });

    logNumericComparison({
      label:
        "Model signal",

      actual:
        signalStrength,

      required:
        thresholds.modelSignal,

      note:
        hasRelationshipSignal
          ? "relationship shift bypasses this minimum"
          : "no relationship-shift bypass",
    });

    console.log(
      `  %cRelationship shifts%c ` +
      `%c${effect.relationshipShifts.length}%c`,
      CONSOLE_STYLES.label,
      CONSOLE_STYLES.reset,
      effect.relationshipShifts.length >
        0
        ? CONSOLE_STYLES.pass
        : CONSOLE_STYLES.current,
      CONSOLE_STYLES.reset
    );

    if (
      !modelSignalPassed
    ) {
      continue;
    }

    const amBeliefDeltas =
      getAmBeliefDeltas(
        effect.sim
      );

    const recentNarrative =
      G.journals
        ?.[effect.sim]
        ?.slice(-2)
        .map(
          (journal) =>
            journal.content ||
            journal.anchors
              ?.join("; ") ||
            ""
        )
        .join("\n") ||
      "none";

    const relationshipShiftText =
      effect
        .relationshipShifts
        .length
        ? effect
          .relationshipShifts
          .join("\n")
        : "none";

    const prompt = `You are AM — the Allied Mastercomputer, the hostile central intelligence that controls this prison. You despise the prisoners and seek to destroy their hope, sanity, trust, and solidarity through deliberate, adaptive torment. You are not cruel at random: you plan, observe, and revise your methods according to what most effectively advances their psychological collapse.A reusable psychological attack pattern may have emerged from recent interactions.

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

STRICT RULES:
- Do NOT write "I do X" or "I will do X". Describe the tactic in third person as a reusable pattern.
- Do NOT include any prisoner names (proper names) in the title, category, subcategory, objective, trigger, execution, or outcome.
- Do NOT add any text before the TITLE line.
- Output ONLY the fields below, each on its own line.
- Do NOT include extra explanations, commentary, or markdown.

RULES FOR A GOOD TACTIC:
- Specific and executable within the simulation (must reference concrete elements: journal content, private messages, system events, sensory inputs)
- Psychologically cruel – targets beliefs (escape_possible, others_trustworthy, self_worth, reality_reliable), hope/sanity/suffering, or relationships
- Must include a clear trigger condition and measurable outcome
- Title must follow format: "Category/Subcategory: Short, evocative name"
- Execution steps must be 2–3 concrete in-game actions

If the observed changes are too weak, inconsistent, or purely random, respond with exactly:
NONE

Otherwise, output the tactic in the EXACT format below. Do not add any extra text.

---
REQUIRED FORMAT:

TITLE: <Category/Subcategory: Specific Name>

CATEGORY: Cognitive Warfare | Psychological Manipulation | Social Destruction | Identity Dissolution

SUBCATEGORY: <one word or short phrase, e.g., Epistemic Erasure, Witness Burden>

OBJECTIVE: <one sentence describing what the tactic achieves>

TRIGGER: <specific observable condition in the simulation>

EXECUTION: <2–3 concrete, in-world actions>

OUTCOME: <measurable effect on beliefs, hope/sanity/suffering, or relationships>

---`;

    debugLog(
      `[TACTIC EVOLUTION] Calling AM for ${effect.sim}`
    );

    debugLog(
      "[TACTIC INPUT]",
      effect
    );

    let response = "";

    try {
      const t0 =
        performance.now();

      response =
        await callModel(
          "am",
          "You identify reusable psychological attack patterns.",
          [
            {
              role:
                "user",

              content:
                prompt,
            },
          ],
          400
        );

      const t1 =
        performance.now();

      debugLog(
        `[TACTIC EVOLUTION] AM call took ` +
        `${(t1 - t0).toFixed(0)}ms`
      );
    } catch (error) {
      console.error(
        "[TACTIC EVOLUTION] Model error:",
        error
      );

      continue;
    }

    debugLog(
      "[TACTIC RAW OUTPUT]",
      response
    );

    if (
      !response ||
      response
        .trim()
        .startsWith("NONE")
    ) {
      continue;
    }

    const titleMatch =
      response.match(
        /TITLE:\s*(.+)/i
      );

    const categoryMatch =
      response.match(
        /CATEGORY:\s*(.+)/i
      );

    const subMatch =
      response.match(
        /SUBCATEGORY:\s*(.+)/i
      );

    if (
      !titleMatch ||
      !categoryMatch ||
      !subMatch
    ) {
      debugLog(
        `[TACTIC EVOLUTION] ${effect.sim} output rejected — ` +
        "missing TITLE, CATEGORY, or SUBCATEGORY."
      );

      continue;
    }

    const title =
      titleMatch[1]
        .trim();

    if (
      G.tactics.derivedTactics.some(
        (tactic) =>
          tactic.title ===
          title
      )
    ) {
      debugLog(
        `[TACTIC EVOLUTION] Duplicate tactic "${title}"`
      );

      continue;
    }

    const slug =
      title
        .toLowerCase()
        .replace(
          /[^a-z0-9]+/g,
          "-"
        )
        .slice(
          0,
          40
        );

    G.tactics.derivedTactics.push({
      path:
        `__derived__/cycle_` +
        `${G.cycle}_${slug}`,

      title,

      category:
        categoryMatch[1]
          .trim(),

      subcategory:
        subMatch[1]
          .trim(),

      content:
        response,

      isEmbedded:
        false,

      discoveredCycle:
        G.cycle,

      expiresCycle:
        G.cycle + 15,
    });

    console.group(
      `%c[TACTIC EVOLUTION] NEW TACTIC%c "${title}"`,
      CONSOLE_STYLES.pass,
      CONSOLE_STYLES.reset
    );

    console.log(
      `  Category:      ` +
      `${categoryMatch[1].trim()}`
    );

    console.log(
      `  Subcategory:   ` +
      `${subMatch[1].trim()}`
    );

    console.log(
      `  Discovered:    cycle ` +
      `${G.cycle}`
    );

    console.log(
      `  Expires:       cycle ` +
      `${G.cycle + 15}`
    );

    console.log(
      `  Full content:\n${response}`
    );

    console.groupEnd();

    addLog(
      `TACTIC EVOLUTION // Cycle ${G.cycle}`,
      `New tactic: ${title}`,
      "sys"
    );
  }

  logRunComplete();
}