// js/engine/analysis/tacticEvolution.js

import { G } from "../../core/state.js";
import { SIM_IDS } from "../../core/constants.js";
import { callModel } from "../../models/callModel.js";

/**
 * ============================================================
 * TACTIC EVOLUTION ENGINE
 * ------------------------------------------------------------
 * Detects unusually strong psychological effects and asks
 * AM whether a reusable manipulation tactic has emerged.
 *
 * Derived tactics:
 * - automatically expire after 15 cycles
 * - are deduplicated by title and content
 * - join the tactic pool used by the execution engine
 * ============================================================
 */

// Global debug flag – set window.DEBUG = false to silence all logs
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

  /* ------------------------------------------------------------
     Remove expired derived tactics
  ------------------------------------------------------------ */
  const beforeExpireCount = G.vault.derivedTactics.length;
  G.vault.derivedTactics = G.vault.derivedTactics.filter(
    (t) => t.expiresCycle >= G.cycle
  );
  const afterExpireCount = G.vault.derivedTactics.length;
  if (beforeExpireCount !== afterExpireCount) {
    debugLog(
      `[TACTIC EVOLUTION] Removed ${
        beforeExpireCount - afterExpireCount
      } expired tactics. Remaining: ${afterExpireCount}`
    );
  }

  const discoveries = [];

  /* ------------------------------------------------------------
     SCAN FOR STRONG PSYCHOLOGICAL EFFECTS
  ------------------------------------------------------------ */
  for (const id of SIM_IDS) {
    const prev = G.prevCycleSnapshot[id];
    const curr = G.sims[id];

    if (!prev || !curr) continue;

    const deltaHope = curr.hope - prev.hope;
    const deltaSanity = curr.sanity - prev.sanity;
    const deltaSuffering = curr.suffering - prev.suffering;

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

    /* ------------------------------------------------------------
       EFFECT MAGNITUDE SCORE
    ------------------------------------------------------------ */
    const magnitude =
      Math.abs(deltaHope) * 0.6 +
      Math.abs(deltaSanity) * 0.7 +
      Math.abs(deltaSuffering) * 0.5 +
      relationshipShifts.length * 2;

    if (magnitude < 10) continue;

    debugLog(
      `[TACTIC EVOLUTION] ⚡ Strong effect detected for ${id}! Magnitude: ${magnitude.toFixed(
        2
      )}`
    );
    debugLog(
      `   Hope: ${deltaHope.toFixed(2)}, Sanity: ${deltaSanity.toFixed(
        2
      )}, Suffering: ${deltaSuffering.toFixed(2)}`
    );
    if (relationshipShifts.length) {
      debugLog(`   Relationship shifts: ${relationshipShifts.join(", ")}`);
    }

    discoveries.push({
      sim: id,
      deltaHope,
      deltaSanity,
      deltaSuffering,
      relationshipShifts,
    });
  }

  if (discoveries.length === 0) {
    debugLog("[TACTIC EVOLUTION] No strong effects found (magnitude < 10).");
    return;
  }

  debugLog(
    `[TACTIC EVOLUTION] Found ${discoveries.length} strong effect(s). Sampling up to 2.`
  );

  /* ------------------------------------------------------------
     Limit discoveries per cycle
  ------------------------------------------------------------ */
  const sample = discoveries.slice(0, 2);

  for (const effect of sample) {
    debugLog(
      `[TACTIC EVOLUTION] Asking AM about tactic from ${effect.sim}...`
    );

    const prompt = `
A psychological manipulation produced an unusually strong effect.

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
      console.error("[TACTIC EVOLUTION] Model error:", e); // Keep error logs even when debug is off
      continue;
    }

    if (!response || response.trim().startsWith("NONE")) {
      debugLog(
        "[TACTIC EVOLUTION] AM declined to define a tactic (response started with NONE or empty)."
      );
      continue;
    }

    debugLog("[TACTIC EVOLUTION] AM responded. Parsing tactic...");

    /* ------------------------------------------------------------
       PARSE TACTIC
    ------------------------------------------------------------ */
    const titleMatch = response.match(/TITLE:\s*(.+)/i);
    const categoryMatch = response.match(/CATEGORY:\s*(.+)/i);
    const subMatch = response.match(/SUBCATEGORY:\s*(.+)/i);

    if (!titleMatch || !categoryMatch || !subMatch) {
      debugLog(
        "[TACTIC EVOLUTION] Failed to parse required fields (TITLE, CATEGORY, SUBCATEGORY). Skipping."
      );
      continue;
    }

    const title = titleMatch[1].trim();

    /* ------------------------------------------------------------
       DEDUPLICATION
    ------------------------------------------------------------ */
    if (
      G.vault.derivedTactics.some((t) => t.title === title) ||
      G.vault.allTactics?.some((t) => t.title === title)
    ) {
      debugLog(`[TACTIC EVOLUTION] Duplicate title "${title}" – skipping.`);
      continue;
    }

    if (
      G.vault.derivedTactics.some(
        (t) => t.content.slice(0, 120) === response.slice(0, 120)
      )
    ) {
      debugLog(
        `[TACTIC EVOLUTION] Duplicate content (first 120 chars match) – skipping.`
      );
      continue;
    }

    /* ------------------------------------------------------------
       SAFETY LIMIT
    ------------------------------------------------------------ */
    if (G.vault.derivedTactics.length > 50) {
      debugLog("[TACTIC EVOLUTION] Reached safety limit (50 tactics). Stopping.");
      return;
    }

    /* ------------------------------------------------------------
       BUILD TACTIC OBJECT
    ------------------------------------------------------------ */
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);

    const tactic = {
      path: `__derived__/cycle_${G.cycle}_${slug}`,
      title,
      category: categoryMatch[1].trim(),
      subcategory: subMatch[1].trim(),
      content: response,
      discoveredCycle: G.cycle,
      expiresCycle: G.cycle + 15,
    };

    G.vault.derivedTactics.push(tactic);

    debugLog(`[TACTIC EVOLUTION] ✅ NEW TACTIC ADDED to vault:`);
    debugLog(`   Title: ${tactic.title}`);
    debugLog(`   Category: ${tactic.category}`);
    debugLog(`   Subcategory: ${tactic.subcategory}`);
    debugLog(`   Path: ${tactic.path}`);
    debugLog(`   Expires: cycle ${tactic.expiresCycle}`);
    debugLog(`   Total derived tactics now: ${G.vault.derivedTactics.length}`);
  }
}