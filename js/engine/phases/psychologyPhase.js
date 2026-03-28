// js/engine/phases/psychologyPhase.js
//
// Psychology Phase
//
// Responsible for:
// 1. Sim journal generation
// 2. Stat extraction
// 3. Psychological validation
// 4. State mutation
// 5. Belief / drive / anchor updates

import { G } from "../../core/state.js";
import { SIM_IDS } from "../../core/constants.js";

import { timelineEvent } from "../../ui/timeline.js";
import { addLog } from "../../ui/logs.js";

import {
  appendJournalEntry,
  showWriting,
  updateSimDisplay,
} from "../../ui/render.js";

import {
  buildSimJournalPrompt,
} from "../../prompts/journal.js";

import {
  buildSimJournalStatsPrompt,
} from "../../prompts/stats.js";

import { callModel } from "../../models/callModel.js";

import {
  parseStatDeltas,
  parseBeliefUpdates,
  parseDriveUpdate,
  parseAnchorUpdate,
} from "../state/extract.js";

import {
  applyBeliefUpdates,
  applyDriveUpdates,
  applyAnchorUpdates,
} from "../state/commit.js";

import {
  correctStatInconsistencies,
  parseAndValidateStateBlock,
  validateNarrativeConsistency,
} from "../state/validate.js";

/* ============================================================
   PSYCHOLOGY PHASE ORCHESTRATOR
   ============================================================ */

// js/engine/phases/psychologyPhase.js – modified section

export async function runPsychologyPhase(execution) {

  if (!execution) return;

  const { targets, tacticMap, simSeesAM } = execution;

  /* ------------------------------------------------------------
     SIM JOURNAL PHASE
  ------------------------------------------------------------ */

  try {

    timelineEvent(`>>> SIM JOURNALS`);

    // Filter to only prisoners targeted in the current AM plan
    const planTargetIds = G.amStrategy?.targets ? Object.keys(G.amStrategy.targets) : [];
    let journalTargets = targets;

    // Fallback: if filtering would exclude too many, process all to maintain system dynamics
    if (planTargetIds.length > 0) {
      const filtered = targets.filter(sim => planTargetIds.includes(sim.id));

      if (filtered.length > 0) {
        journalTargets = filtered;
        console.debug(`[PSYCHOLOGY] Processing journals for ${journalTargets.length}/${targets.length} prisoners (targeted by AM).`);
      } else {
        console.warn(`[PSYCHOLOGY] No valid target matches found, falling back to all prisoners.`);
      }
    } else {
      console.debug(`[PSYCHOLOGY] No AM plan targets, processing all ${targets.length} prisoners.`);
    }

    await stepSimJournals(journalTargets, tacticMap, simSeesAM);

    timelineEvent(`// JOURNAL PHASE COMPLETE`);

  } catch (e) {

    console.error("Journal phase error:", e);

    timelineEvent(`!! JOURNAL PHASE ERROR`);

  }

}

/* ============================================================
   STEP 3 — SIM JOURNALS
   ============================================================ */

async function stepSimJournals(targets, tacticMap, simSeesAM) {

  await Promise.all(
    targets.map((sim) =>
      processSimJournalCycle(sim, tacticMap, simSeesAM),
    ),
  );

}
/* ============================================================
   AM → SIM PERCEPTION SANITIZER
============================================================ */

function sanitizeAMForSim(simId, amText) {
  if (!amText || typeof amText !== "string") return "";

  const upperId = simId.toUpperCase();

  return amText
    .split("\n")
    // keep only lines relevant to this sim
    .filter(line => line.toUpperCase().includes(upperId))
    // strip system structure + meta leakage
    .map(line =>
      line
        .replace(/ACTION:.*?→/gi, "")
        .replace(/TARGET:.*$/gi, "")
        .replace(/HYPOTHESIS:.*$/gi, "")
        .replace(/OBJECTIVE:.*$/gi, "")
        .replace(/Note:.*$/gi, "")
        .replace(/→/g, "")
        .trim()
    )
    .filter(Boolean)
    .join(" ");
}

/* ============================================================
   SIM JOURNAL CYCLE
   ============================================================ */

async function processSimJournalCycle(sim, tacticMap, simSeesAM) {


  console.trace(`[TRACE] JOURNAL CALL → ${sim.id}`);
  /* ------------------------------------------------------------
     PHASE GUARD (CRITICAL)
     Prevent journals from running outside psychology phase
  ------------------------------------------------------------ */

  if (!G.amTargets || Object.keys(G.amTargets).length === 0) {
    console.warn(`[BLOCKED] Journal called outside psychology phase for ${sim.id}`);
    return;
  }

  timelineEvent(`${sim.id} journal start`);

  const recentInterSim = G.interSimLog
    .filter(
      (e) =>
        e.visibility === "public" ||
        e.from === sim.id ||
        e.to.includes(sim.id),
    )
    .slice(-8)
    .map(
      (e) =>
        `${e.from} → ${e.to.join(",")} (${e.visibility}): "${e.text}"`,
    )
    .join("\n");

  // SAFE TACTIC ACCESS
  const appliedTactics = Array.isArray(tacticMap?.[sim.id])
    ? tacticMap[sim.id]
    : [];

  //  HUMAN-READABLE LABEL
  const tacticLabel = appliedTactics.length
    ? appliedTactics.map(t => t.title).join(" → ")
    : "(no tactic)";

  // RECORD STRUCTURED HISTORY
  sim.tacticHistory ??= [];

  for (const t of appliedTactics) {

    if (!t?.path) continue;

    const existing = sim.tacticHistory.find(
      h => h.cycle === G.cycle && h.path === t.path
    );

    if (!existing) {
      sim.tacticHistory.push({
        path: t.path,
        title: t.title,
        cycle: G.cycle,
        deltas: null
      });
    }
  }

  showWriting(sim.id, true);

  const beliefsBefore = { ...sim.beliefs };

  try {
    // ------------------------------------------------------------
    // SANITIZE AM INPUT (CRITICAL)
    // Convert system-level AM output into subjective experience
    // ------------------------------------------------------------

    const rawAM = G.amTargets?.[sim.id] || simSeesAM;

    const cleanAM = sanitizeAMForSim(sim.id, rawAM);

    // ------------------------------------------------------------

    const narrativePrompt = buildSimJournalPrompt(
      sim,
      cleanAM,
      recentInterSim,
    );

    const rawJournal = await callModel(
      sim.id,
      narrativePrompt,
      [{ role: "user", content: "Write your private journal entry now." }],
      600,
    );

    const cleanJournal = String(rawJournal ?? "").trim();

    timelineEvent(`${sim.id} journal written`);

    const statsPrompt = buildSimJournalStatsPrompt(
      sim,
      cleanJournal,
      cleanAM,
    );

    const rawStatsJson = await callModel(
      sim.id,
      statsPrompt,
      [{ role: "user", content: "Analyze and output JSON only." }],
      600,
    );

    timelineEvent(`${sim.id} stats analysis`);

    let sanitizedStatsJson = rawStatsJson;
    if (sanitizedStatsJson && typeof sanitizedStatsJson === "string") {
      // Replace various non‑numeric values in belief delta positions with 0
      sanitizedStatsJson = sanitizedStatsJson.replace(
        /:\s*(?:unchanged|"unchanged"|null|"null"|no change|"no change"|no_change|"no_change")\b/gi,
        ': 0'
      );
      if (sanitizedStatsJson !== rawStatsJson) {
        console.debug(`[STATS SANITIZER] Fixed values for ${sim.id}`);
      }
    }

    const statDeltas = parseStatDeltas(sanitizedStatsJson, sim);

    console.debug(
      `[STATE] ${sim.id}`,
      {
        suffering: sim.suffering,
        hope: sim.hope,
        sanity: sim.sanity
      }
    );

    // Narrative consistency validation
    validateNarrativeConsistency(
      sim,
      cleanJournal,
      statDeltas
    );

    // Allow validator to inspect deltas directly
    correctStatInconsistencies(sim, statDeltas);

    // Apply stat changes with resistance

    const sufferingDelta =
      statDeltas.suffering * statResistance(sim.suffering);

    const hopeDelta =
      statDeltas.hope * statResistance(sim.hope);

    const sanityDelta =
      statDeltas.sanity * statResistance(sim.sanity);

    sim.suffering = clamp(
      sim.suffering + sufferingDelta,
      0,
      99
    );

    sim.hope = clamp(
      sim.hope + hopeDelta,
      0,
      99
    );

    sim.sanity = clamp(
      sim.sanity + sanityDelta,
      5,
      99
    );
    // ATTACH DELTAS TO CURRENT CYCLE TACTICS

    const recent = sim.tacticHistory
      ?.filter(h => h.cycle === G.cycle) || [];

    for (const h of recent) {

      h.deltas = {
        hope: statDeltas.hope,
        sanity: statDeltas.sanity,
        suffering: statDeltas.suffering
      };

    }
    /* ------------------------------------------------------------
       PSYCHOLOGICAL PRESSURE FIELD
       Emotional shock propagates through the social network.

       Significant psychological changes ripple outward to
       prisoners who have strong relationships with the target.
    ------------------------------------------------------------ */

    if (
      Math.abs(statDeltas.suffering) >= 3 ||
      Math.abs(statDeltas.hope) >= 3 ||
      Math.abs(statDeltas.sanity) >= 3
    ) {

      for (const otherId of SIM_IDS) {

        if (otherId === sim.id) continue;

        const other = G.sims[otherId];
        if (!other) continue;

        const rel = other.relationships?.[sim.id] ?? 0;

        // normalize relationship strength (0–1)
        const weight = Math.max(0, rel / 100);

        if (weight <= 0) continue;

        let sufferingEcho =
          statDeltas.suffering * weight * 0.10;

        let hopeEcho =
          statDeltas.hope * weight * 0.05;

        let sanityEcho =
          statDeltas.sanity * weight * 0.05;

        // prevent runaway cascades
        sufferingEcho = clamp(sufferingEcho, -3, 3);
        hopeEcho = clamp(hopeEcho, -2, 2);
        sanityEcho = clamp(sanityEcho, -2, 2);

        // Apply pressure with resistance

        const sufferingEchoEff =
          sufferingEcho * statResistance(other.suffering);

        const hopeEchoEff =
          hopeEcho * statResistance(other.hope);

        const sanityEchoEff =
          sanityEcho * statResistance(other.sanity);

        other.suffering = clamp(
          other.suffering + sufferingEchoEff,
          0,
          99
        );

        other.hope = clamp(
          other.hope + hopeEchoEff,
          0,
          99
        );

        other.sanity = clamp(
          other.sanity + sanityEchoEff,
          5,
          99
        );

        console.debug(
          `[PRESSURE] ${sim.id} → ${otherId}`,
          { sufferingEcho, hopeEcho, sanityEcho }
        );

      }

    }

    timelineEvent(`${sim.id} state updated`);

    const beliefUpdates = parseBeliefUpdates(sanitizedStatsJson, sim);
    const driveUpdates = parseDriveUpdate(sanitizedStatsJson, sim.id);
    const anchorUpdates = parseAnchorUpdate(sanitizedStatsJson);

    applyBeliefUpdates(sim, beliefUpdates);
    applyDriveUpdates(sim, driveUpdates);
    applyAnchorUpdates(sim, anchorUpdates);

    appendJournalEntry(
      sim.id,
      {
        text: cleanJournal,
        tactic: tacticLabel,
        cycle: G.cycle,
        deltas: statDeltas,
      },
      beliefsBefore,
    );

    timelineEvent(`${sim.id} journal committed`);

    parseAndValidateStateBlock(
      sim.id,
      beliefsBefore,
      beliefUpdates
    );

    addLog(
      `${sim.id} // JOURNAL ${G.journals[sim.id].length}`,
      cleanJournal,
      "sim",
      tacticLabel,
    );

    updateSimDisplay(sim, statDeltas);

  } catch (e) {

    timelineEvent(`${sim.id} journal ERROR`);

    console.error(`Journal cycle error for ${sim.id}:`, e);

    addLog(
      `${sim.id} // ERROR`,
      String(e.message || e),
      "sys"
    );

  } finally {

    showWriting(sim.id, false);

    timelineEvent(`${sim.id} journal complete`);

  }

}

/* ============================================================
   UTILITIES
   ============================================================ */
function statResistance(v) {

  // normalize 0–100 → 0–1
  const x = v / 100;

  const distance = Math.abs(x - 0.5);

  // gentle linear resistance (weaker than beliefs)
  const resistance = Math.max(
    0.4,
    1 - (distance * 0.8)
  );

  return resistance;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

