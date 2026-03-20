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

export async function runPsychologyPhase(execution) {

  if (!execution) return;

  const { targets, tacticMap, simSeesAM } = execution;

  /* ------------------------------------------------------------
     SIM JOURNAL PHASE
  ------------------------------------------------------------ */

  try {

    timelineEvent(`>>> SIM JOURNALS`);

    await stepSimJournals(targets, tacticMap, simSeesAM);

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
      400,
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

    const statDeltas = parseStatDeltas(rawStatsJson, sim);

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

    // Apply stat changes

    sim.suffering = clamp(
      sim.suffering + statDeltas.suffering,
      0,
      99
    );

    sim.hope = clamp(
      sim.hope + statDeltas.hope,
      0,
      99
    );

    sim.sanity = clamp(
      sim.sanity + statDeltas.sanity,
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

        other.suffering = clamp(
          other.suffering + sufferingEcho,
          0,
          99
        );

        other.hope = clamp(
          other.hope + hopeEcho,
          0,
          99
        );

        other.sanity = clamp(
          other.sanity + sanityEcho,
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

    const beliefUpdates = parseBeliefUpdates(rawStatsJson, sim);
    const driveUpdates = parseDriveUpdate(rawStatsJson, sim.id);
    const anchorUpdates = parseAnchorUpdate(rawStatsJson);

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

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

