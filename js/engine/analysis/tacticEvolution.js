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
 * ============================================================
 */

const isDebugEnabled = () => (typeof window !== 'undefined' ? window.DEBUG : true);

function debugLog(...args) {
  if (isDebugEnabled()) {
    console.log(...args);
  }
}

export async function runTacticEvolution() {
  debugLog("[TACTIC EVOLUTION] Starting tactic evolution scan...");

  if (!G.prevCycleSnapshot) {
    debugLog("[TACTIC EVOLUTION] No previous cycle snapshot, skipping.");
    return;
  }

  G.tacticHistory ??= {};

  /* ------------------------------------------------------------
     Remove expired derived tactics
  ------------------------------------------------------------ */
  G.vault.derivedTactics = G.vault.derivedTactics.filter(
    (t) => t.expiresCycle >= G.cycle
  );

  const discoveries = [];

  /* ------------------------------------------------------------
     SCAN FOR TRAJECTORY-BASED EFFECTS
  ------------------------------------------------------------ */
  for (const id of SIM_IDS) {

    const prev = G.prevCycleSnapshot[id];
    const curr = G.sims[id];
    if (!prev || !curr) continue;

    // Compute deltas
    const deltaHope = curr.hope - prev.hope;
    const deltaSanity = curr.sanity - prev.sanity;
    const deltaSuffering = curr.suffering - prev.suffering;

    // Track short history (last 4 cycles)
    G.tacticHistory[id] ??= [];

    G.tacticHistory[id].push({
      cycle: G.cycle,
      hope: deltaHope,
      sanity: deltaSanity,
      suffering: deltaSuffering
    });

    if (G.tacticHistory[id].length > 4) {
      G.tacticHistory[id].shift();
    }

    const history = G.tacticHistory[id];

    if (history.length < 2) continue;

    // Relationship shifts
    const relationshipShifts = [];

    for (const other of SIM_IDS) {
      if (other === id) continue;

      const before = prev.relationships?.[other] ?? 0;
      const after = curr.relationships?.[other] ?? 0;
      const delta = after - before;

      if (Math.abs(delta) >= 0.25) {
        relationshipShifts.push(
          `${id}→${other}: ${before.toFixed(2)} → ${after.toFixed(2)}`
        );
      }
    }

    // Directional consistency
    function consistency(arr) {
      const signs = arr.map(v => Math.sign(v)).filter(v => v !== 0);
      if (signs.length === 0) return 0;

      const counts = {};
      for (const s of signs) counts[s] = (counts[s] || 0) + 1;

      return Math.max(...Object.values(counts)) / signs.length;
    }

    const hopeSeries = history.map(h => h.hope);
    const sanitySeries = history.map(h => h.sanity);
    const sufferingSeries = history.map(h => h.suffering);

    const hopeConsistency = consistency(hopeSeries);
    const sanityConsistency = consistency(sanitySeries);
    const sufferingConsistency = consistency(sufferingSeries);

    if (
      hopeConsistency < 0.7 &&
      sanityConsistency < 0.7 &&
      sufferingConsistency < 0.7
    ) continue;

    // Net displacement
    const netHope = history.reduce((sum, h) => sum + h.hope, 0);
    const netSanity = history.reduce((sum, h) => sum + h.sanity, 0);
    const netSuffering = history.reduce((sum, h) => sum + h.suffering, 0);

    const netMagnitude =
      Math.abs(netHope) * 0.6 +
      Math.abs(netSanity) * 0.7 +
      Math.abs(netSuffering) * 0.5;

    // Structural signal
    const multiStat =
      Math.abs(deltaHope) > 2 &&
      Math.abs(deltaSanity) > 2;

    const structuralSignal =
      relationshipShifts.length > 0 || multiStat;

    if (netMagnitude < 8 || !structuralSignal) continue;

    debugLog(`[TACTIC EVOLUTION] ✓ Trajectory detected for ${id}`);
    debugLog(`   Net magnitude: ${netMagnitude.toFixed(2)}`);
    debugLog(`   Consistency:`, {
      hopeConsistency,
      sanityConsistency,
      sufferingConsistency
    });

    discoveries.push({
      sim: id,
      deltaHope,
      deltaSanity,
      deltaSuffering,
      relationshipShifts,
    });
  }

  if (discoveries.length === 0) {
    debugLog("[TACTIC EVOLUTION] No trajectory-based effects found.");
    return;
  }

  const sample = discoveries.slice(0, 2);

  for (const effect of sample) {

    const prompt = `
A sustained psychological manipulation produced a consistent effect.

TARGET: ${effect.sim}

Observed changes:

Hope delta: ${effect.deltaHope}
Sanity delta: ${effect.deltaSanity}
Suffering delta: ${effect.deltaSuffering}

Relationship shifts:
${effect.relationshipShifts.join("\n") || "(none)"}

Did this reveal a repeatable psychological manipulation tactic?

If NO respond:

NONE

If YES define the tactic exactly as:

TITLE:
CATEGORY:
SUBCATEGORY:

Objective:
<one sentence>

Trigger:
<one sentence>

Execution:
1.
2.
3.

Loop:
<short explanation>

Outcome:
<short explanation>
`;

    let response = "";

    try {
      response = await callModel(
        "am",
        "You are identifying emergent psychological torture tactics.",
        [{ role: "user", content: prompt }],
        800
      );
    } catch (e) {
      console.error("[TACTIC EVOLUTION] Model error:", e);
      continue;
    }

    if (!response || response.trim().startsWith("NONE")) continue;

    const titleMatch = response.match(/TITLE:\s*(.+)/i);
    const categoryMatch = response.match(/CATEGORY:\s*(.+)/i);
    const subMatch = response.match(/SUBCATEGORY:\s*(.+)/i);

    if (!titleMatch || !categoryMatch || !subMatch) continue;

    const title = titleMatch[1].trim();

    if (
      G.vault.derivedTactics.some((t) => t.title === title)
    ) {
      debugLog(`[TACTIC EVOLUTION] Tactic "${title}" already exists, skipping.`);
      continue;
    }

    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);

    G.vault.derivedTactics.push({
      path: `__derived__/cycle_${G.cycle}_${slug}`,
      title,
      category: categoryMatch[1].trim(),
      subcategory: subMatch[1].trim(),
      content: response,
      discoveredCycle: G.cycle,
      expiresCycle: G.cycle + 15,
    });

    // ------------------------------------------------------------
    // LOGGING IMPROVEMENTS — detailed console output
    // ------------------------------------------------------------
    const category = categoryMatch[1].trim();
    const subcategory = subMatch[1].trim();
    const discoveredCycle = G.cycle;

    // 1. Unconditional console log with all details
    console.group(`[TACTIC EVOLUTION] New tactic: "${title}"`);
    console.log(`  Category:      ${category}`);
    console.log(`  Subcategory:   ${subcategory}`);
    console.log(`  Discovered:    cycle ${discoveredCycle}`);
    console.log(`  Expires:       cycle ${G.cycle + 15}`);
    console.log(`  Full content:\n${response}`);
    console.groupEnd();

    // 2. UI system log (concise)
    addLog(
      `TACTIC EVOLUTION // Cycle ${G.cycle}`,
      `New tactic: ${title} (${category}/${subcategory})`,
      "sys"
    );

    // 3. debugLog for additional details (when DEBUG is on)
    debugLog(`[TACTIC EVOLUTION] New tactic: ${title} (${category}/${subcategory})`);
  }
}