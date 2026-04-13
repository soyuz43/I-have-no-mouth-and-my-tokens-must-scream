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

import { tickConstraints, CONSTRAINT_MAP } from "../constraints.js";

/* ============================================================
   BELIEF DIFF UTILITIES (DEBUG / OBSERVABILITY)
   ============================================================ */

function snapshotBeliefs(sim) {
  return { ...(sim.beliefs || {}) };
}

function diffBeliefs(before, after) {
  const rows = [];

  const keys = new Set([
    ...Object.keys(before || {}),
    ...Object.keys(after || {})
  ]);

  for (const key of keys) {
    const b = before?.[key];
    const a = after?.[key];

    if (!Number.isFinite(b) && !Number.isFinite(a)) continue;

    const delta = (a ?? 0) - (b ?? 0);

    if (delta === 0) continue;

    rows.push({
      belief: key,
      before: Number(b ?? 0).toFixed(4),
      after: Number(a ?? 0).toFixed(4),
      delta: delta.toFixed(4)
    });
  }

  return rows;
}

/* ============================================================
   PSYCHOLOGY PHASE ORCHESTRATOR
   ============================================================ */


export async function runPsychologyPhase(execution) {
  const cycleBeliefSummary = {};
  if (!execution) return;

  const { targets, tacticMap, simSeesAM } = execution;

  /* ------------------------------------------------------------
     SNAPSHOT STATS BEFORE JOURNAL
  ------------------------------------------------------------ */

  const statsBefore = {};

  for (const sim of targets) {
    console.log(`[CONSTRAINT STATE BEFORE JOURNAL][${sim.id}]`, {
      constraints: sim.constraints,
      count: sim.constraints?.length ?? 0
    });

    statsBefore[sim.id] = {
      suffering: sim.suffering,
      hope: sim.hope,
      sanity: sim.sanity
    };
  }

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

    await stepSimJournals(journalTargets, tacticMap, simSeesAM, cycleBeliefSummary);

    timelineEvent(`// JOURNAL PHASE COMPLETE`);

    /* ------------------------------------------------------------
      LOG STAT DELTAS AFTER JOURNAL
   ------------------------------------------------------------ */
    console.group(`[STATS SUMMARY][Cycle ${G.cycle}]`);
    const statRows = [];
    for (const sim of journalTargets) {
      const before = statsBefore[sim.id];
      const after = {
        suffering: sim.suffering,
        hope: sim.hope,
        sanity: sim.sanity
      };
      const delta = {
        suffering: after.suffering - before.suffering,
        hope: after.hope - before.hope,
        sanity: after.sanity - before.sanity
      };
      statRows.push({
        sim: sim.id,
        suffering_before: before.suffering,
        suffering_after: after.suffering,
        suffering_delta: delta.suffering,
        hope_before: before.hope,
        hope_after: after.hope,
        hope_delta: delta.hope,
        sanity_before: before.sanity,
        sanity_after: after.sanity,
        sanity_delta: delta.sanity
      });
    }
    console.table(statRows);
    console.groupEnd();

    /* ------------------------------------------------------------
       BELIEF SUMMARY (FULL SYSTEM VIEW)
    ------------------------------------------------------------ */

    console.group(`[BELIEF SUMMARY][Cycle ${G.cycle}]`);

    const summaryRows = [];

    for (const simId of SIM_IDS) {
      const diffs = cycleBeliefSummary[simId] || [];

      const totalShift = diffs.reduce(
        (sum, d) => sum + Math.abs(Number(d.delta)),
        0
      );

      summaryRows.push({
        sim: simId,
        changes: diffs.length,
        totalShift: totalShift.toFixed(4)
      });
    }

    console.table(summaryRows);

    // Optional: show detailed diffs grouped
    for (const simId of Object.keys(cycleBeliefSummary)) {
      const diffs = cycleBeliefSummary[simId];
      if (!diffs.length) continue;

      console.groupCollapsed(`DETAIL ${simId}`);
      console.table(diffs);
      console.groupEnd();
    }

    console.groupEnd();

  } catch (e) {

    console.error("Journal phase error:", e);

    timelineEvent(`!! JOURNAL PHASE ERROR`);

  }

}

/* ============================================================
   STEP 3 — SIM JOURNALS
   ============================================================ */

async function stepSimJournals(targets, tacticMap, simSeesAM, cycleBeliefSummary) {

  const results = await Promise.all(
    targets.map((sim) =>
      processSimJournalCycle(sim, tacticMap, simSeesAM)
    )
  );

  // Aggregate deterministically
  for (const r of results) {
    if (!r) continue;

    if (!cycleBeliefSummary[r.simId]) {
      cycleBeliefSummary[r.simId] = [];
    }

    cycleBeliefSummary[r.simId].push(...(r.diff || []));
  }
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


  /* ------------------------------------------------------------
     PHASE GUARD (CRITICAL)
     Prevent journals from running outside psychology phase
  ------------------------------------------------------------ */

  if (!sim || !sim.id) {
    console.warn(`[BLOCKED] invalid sim for journal`);
    return;
  }
  timelineEvent(`${sim.id} journal start`);

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

  try {
    // ------------------------------------------------------------
    // SANITIZE AM INPUT (CRITICAL)
    // Convert system-level AM output into subjective experience
    // ------------------------------------------------------------
    const statsBefore = {
      suffering: sim.suffering,
      hope: sim.hope,
      sanity: sim.sanity
    };

    // --- USE PARSED PER-TARGET ACTION (CRITICAL FIX) ---
    const rawAM = G.amTargets?.[sim.id] || "AM observes you silently this cycle.";

    const cleanAM = rawAM; // already isolated, no need for line filtering

    if (!G.amTargets?.[sim.id]) {
      console.error("[CRITICAL] Missing AM target at psychology phase", sim.id, G.amTargets);
    }
    /* =========================
   DEBUG: AM PERCEPTION
========================= */
    console.group(`[AM PERCEPTION][${sim.id}]`);
    // console.log("AM TARGET BLOCK:", rawAM);
    console.log("FINAL INPUT TO MODEL:", cleanAM);
    console.groupEnd();

    // ------------------------------------------------------------

    const narrativePrompt = buildSimJournalPrompt(
      sim,
      cleanAM,
    );

    /* =========================
   DEBUG: JOURNAL INPUT
========================= */
    // console.group(`[JOURNAL INPUT][${sim.id}]`);

    // console.log("STATE:", {
    //   suffering: sim.suffering,
    //   hope: sim.hope,
    //   sanity: sim.sanity
    // });

    // console.log("BELIEFS:", sim.beliefs);

    // console.log("CONSTRAINTS:", sim.constraints);

    // console.log("AM INPUT:", cleanAM);

    // console.log("LAST JOURNAL:", (G.journals?.[sim.id] || []).slice(-1)[0]?.text);

    // console.groupEnd();

    const rawJournal = await callModel(
      sim.id,
      narrativePrompt,
      [{ role: "user", content: "Write your private journal entry now." }],
      850,
    );

    const cleanJournal = String(rawJournal ?? "").trim();
  
   // DEBUG: JOURNAL RAW OUTPUT
  
   // console.log(`[JOURNAL RAW][${sim.id}]`, rawJournal);

    timelineEvent(`${sim.id} journal written`);

    const statsPrompt = buildSimJournalStatsPrompt(
      sim,
      cleanJournal,
      cleanAM,
    );

    /* =========================
       DEBUG: STATS INPUT
    ========================= */
    // console.group(`[STATS INPUT][${sim.id}]`);

    // console.log("JOURNAL TEXT:", cleanJournal);
    // console.log("AM INPUT:", cleanAM);
    // console.log("CURRENT STATE:", {
    //   suffering: sim.suffering,
    //   hope: sim.hope,
    //   sanity: sim.sanity
    // });

    // console.groupEnd();

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

    /* =========================
   DEBUG: PARSED STAT DELTAS
========================= */
    console.log(`[STAT DELTAS][${sim.id}]`, statDeltas);


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

    // Apply stat changes with resistance + cap + floor protection

    // ------------------------------------------------------------
    const MAX_STEP = 8;
    function capStep(x) {
      return Math.max(-MAX_STEP, Math.min(MAX_STEP, x));
    }

    function floorResistStat(value) {
      if (value < 15) return 0.5;
      if (value < 35) return 0.8;
      return 1;
    }

    function sufferingResist(value) {
      if (value > 85) return 0.4;
      if (value > 65) return 0.7;
      return 1;
    }

    const sufferingDeltaRaw = statDeltas.suffering * statResistance(sim.suffering);
    const hopeDeltaRaw = statDeltas.hope * statResistance(sim.hope);
    const sanityDeltaRaw = statDeltas.sanity * statResistance(sim.sanity);

    const sufferingDelta = capStep(sufferingDeltaRaw) * sufferingResist(sim.suffering);
    const hopeDelta = capStep(hopeDeltaRaw) * floorResistStat(sim.hope);
    const sanityDelta = capStep(sanityDeltaRaw) * floorResistStat(sim.sanity);

    sim.suffering = clamp(sim.suffering + sufferingDelta, 0, 99);
    sim.hope = clamp(sim.hope + hopeDelta, 0, 99);
    sim.sanity = clamp(sim.sanity + sanityDelta, 5, 99);

    console.debug("[CONSTRAINT STATE]", sim.id, {
      count: sim.constraints?.length ?? 0,
      constraints: sim.constraints
    });

    if (sim.constraints?.length) {
      console.debug("[CONSTRAINT RESOLUTION TEST]", sim.id,
        sim.constraints.map(c => {
          const def = CONSTRAINT_MAP[c.id];

          if (!def) {
            console.warn("[CONSTRAINT] Unknown constraint id:", c.id, {
              available: Object.keys(CONSTRAINT_MAP)
            });
          } return {
            id: c.id,
            resolved: !!def
          };
        })
      );
    }
    // ------------------------------------------------------------
    // APPLY CONSTRAINT FORCES (CRITICAL)
    // Constraints are deterministic physical pressure,
    // separate from narrative-driven journal effects.
    // ------------------------------------------------------------

    if (sim.constraints?.length) {

      if (G.DEBUG_CONSTRAINTS) {
        console.debug("[CONSTRAINT][BEFORE TICK]", sim.id, {
          suffering: sim.suffering,
          hope: sim.hope,
          sanity: sim.sanity
        });
      }

      tickConstraints(sim);

      if (G.DEBUG_CONSTRAINTS) {
        console.debug("[CONSTRAINT][AFTER TICK]", sim.id, {
          suffering: sim.suffering,
          hope: sim.hope,
          sanity: sim.sanity
        });
      }
    }
    // ATTACH DELTAS TO CURRENT CYCLE TACTICS

    const recent = sim.tacticHistory
      ?.filter(h => h.cycle === G.cycle) || [];

    for (const h of recent) {
      h.deltas = {
        reported: {
          hope: statDeltas.hope,
          sanity: statDeltas.sanity,
          suffering: statDeltas.suffering
        },
        effective: {
          hope: +(sim.hope - statsBefore.hope).toFixed(2),
          sanity: +(sim.sanity - statsBefore.sanity).toFixed(2),
          suffering: +(sim.suffering - statsBefore.suffering).toFixed(2)
        }
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

    // --- SNAPSHOT BEFORE ---
    const beliefsBeforeCommit = snapshotBeliefs(sim);

    // --- APPLY ---
    applyBeliefUpdates(sim, beliefUpdates);
    applyDriveUpdates(sim, driveUpdates);
    applyAnchorUpdates(sim, anchorUpdates);

    // --- SNAPSHOT AFTER ---
    const beliefsAfterCommit = sim.beliefs;

    // --- DIFF ---
    const diff = diffBeliefs(beliefsBeforeCommit, beliefsAfterCommit);


    // --- PER-SIM LOG ---
    if (diff.length > 0) {
      console.groupCollapsed(`[BELIEF Δ] ${sim.id}`);
      console.table(diff);
      console.groupEnd();
    } else {
      console.debug(`[BELIEF Δ] ${sim.id} (no change)`);
    }

    appendJournalEntry(
      sim.id,
      {
        text: cleanJournal,
        tactic: tacticLabel,
        cycle: G.cycle,
        deltas: statDeltas,
      },
      beliefsBeforeCommit,
    );

    timelineEvent(`${sim.id} journal committed`);

    const validatedBeliefShifts = {};

    for (const d of diff || []) {
      const k = d.belief;
      const v = Number(d.delta);

      validatedBeliefShifts[k] = (validatedBeliefShifts[k] ?? 0) + v;
    }

    parseAndValidateStateBlock(
      sim.id,
      beliefsBeforeCommit,
      validatedBeliefShifts,
      sanitizedStatsJson
    );

    addLog(
      `${sim.id} // JOURNAL ${G.journals[sim.id].length}`,
      cleanJournal,
      "sim",
      tacticLabel,
    );
    const actualDeltas = {
      suffering: +(sim.suffering - statsBefore.suffering).toFixed(2),
      hope: +(sim.hope - statsBefore.hope).toFixed(2),
      sanity: +(sim.sanity - statsBefore.sanity).toFixed(2)
    };

    updateSimDisplay(sim, actualDeltas);

    return {
      simId: sim.id,
      diff
    };

  } catch (e) {

    timelineEvent(`${sim.id} journal ERROR`);

    console.error(`Journal cycle error for ${sim.id}:`, e);

    addLog(
      `${sim.id} // ERROR`,
      String(e.message || e),
      "sys"
    );

    return {
      simId: sim.id,
      diff: []
    };

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
    0.2,
    1 - (distance * 0.8)
  );

  return resistance;
}

function clamp(v, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}
