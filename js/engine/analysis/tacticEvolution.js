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
 * ============================================================
 */

const isDebugEnabled = () => (typeof window !== 'undefined' ? window.DEBUG : true);

function debugLog(...args) {
  if (isDebugEnabled()) {
    console.log(...args);
  }
}

export async function runTacticEvolution() {

  console.log(`>>> TACTIC EVOLUTION`);
  debugLog("[TACTIC EVOLUTION] Starting tactic evolution scan...");

  if (!G.prevCycleSnapshot) {
    debugLog("[TACTIC EVOLUTION] No previous cycle snapshot, skipping.");
    return;
  }

  G.tacticHistory ??= {};
  G.vault.derivedTactics ??= [];


  // Helper to get AM-attributed belief deltas for a sim
  function getAmBeliefDeltas(simId) {
    // Ensure snapshots exist
    if (!G.beliefSnapshots) return {};
    const pre = G.beliefSnapshots?.prePsychology?.[simId]?.beliefs || {};
    const post = G.beliefSnapshots?.postPsychology?.[simId]?.beliefs || {};
    const deltas = {};
    const allKeys = new Set([...Object.keys(pre), ...Object.keys(post)]);
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

    const deltaHope = curr.hope - prev.hope;
    const deltaSanity = curr.sanity - prev.sanity;
    const deltaSuffering = curr.suffering - prev.suffering;

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

    const netHope = history.reduce((sum, h) => sum + h.hope, 0);
    const netSanity = history.reduce((sum, h) => sum + h.sanity, 0);
    const netSuffering = history.reduce((sum, h) => sum + h.suffering, 0);

    const netMagnitude =
      Math.abs(netHope) * 0.6 +
      Math.abs(netSanity) * 0.7 +
      Math.abs(netSuffering) * 0.5;

    const multiStat =
      Math.abs(deltaHope) > 2 &&
      Math.abs(deltaSanity) > 2;

    const structuralSignal =
      relationshipShifts.length > 0 || multiStat;

    if (netMagnitude < 8 || !structuralSignal) continue;

    debugLog(`[TACTIC EVOLUTION] ✓ Trajectory detected for ${id}`);
    debugLog(`   Net magnitude: ${netMagnitude.toFixed(2)}`);

    discoveries.push({
      sim: id,
      deltaHope,
      deltaSanity,
      deltaSuffering,
      relationshipShifts,
    });
  }

  /* ------------------------------------------------------------
     GLOBAL SIGNAL GATE
  ------------------------------------------------------------ */
  if (discoveries.length === 0) {
    debugLog("[TACTIC EVOLUTION] No trajectory-based effects found.");
    console.log(`// TACTIC EVOLUTION COMPLETE`);
    return;
  }

  const totalSignal = discoveries.reduce((sum, d) => {
    return sum +
      Math.abs(d.deltaHope) +
      Math.abs(d.deltaSanity) +
      Math.abs(d.deltaSuffering);
  }, 0);

  if (totalSignal < 10) {
    debugLog("[TACTIC EVOLUTION] Skipping — total signal too weak:", totalSignal.toFixed(2));
    console.log(`// TACTIC EVOLUTION COMPLETE`);
    return;
  }

  const sample = discoveries.slice(0, 2);

  /* ------------------------------------------------------------
     MODEL EVALUATION
  ------------------------------------------------------------ */
  for (const effect of sample) {

    const signalStrength =
      Math.abs(effect.deltaHope) +
      Math.abs(effect.deltaSanity) +
      Math.abs(effect.deltaSuffering);

    if (signalStrength < 6 && effect.relationshipShifts.length === 0) {
      debugLog(`[TACTIC EVOLUTION] Skipping ${effect.sim} — weak signal`);
      continue;
    }

    // Compute AM-attributed belief deltas for this sim
    const amBeliefDeltas = getAmBeliefDeltas(effect.sim);

    const prompt = `You are AM. A reusable psychological attack pattern may have emerged from recent interactions.

TARGET: ${effect.sim}

RECENT NARRATIVE (journal excerpts or anchors):
${(G.journals[effect.sim]?.slice(-2).map(j => j.content || j.anchors?.join("; ") || "").join("\n") || "none")}

RELATIONSHIP SHIFTS (last cycle):
${effect.relationshipShifts.length ? effect.relationshipShifts.join("\n") : "none"}

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

    debugLog(`[TACTIC EVOLUTION] Calling AM for ${effect.sim}`);
    debugLog(`[TACTIC INPUT]`, effect);

    let response = "";

    try {
      const t0 = performance.now();

      response = await callModel(
        "am",
        "You identify reusable psychological attack patterns.",
        [{ role: "user", content: prompt }],
        400
      );

      const t1 = performance.now();
      debugLog(`[TACTIC EVOLUTION] AM call took ${(t1 - t0).toFixed(0)}ms`);

    } catch (e) {
      console.error("[TACTIC EVOLUTION] Model error:", e);
      continue;
    }

    debugLog(`[TACTIC RAW OUTPUT]`, response);

    if (!response || response.trim().startsWith("NONE")) continue;

    const titleMatch = response.match(/TITLE:\s*(.+)/i);
    const categoryMatch = response.match(/CATEGORY:\s*(.+)/i);
    const subMatch = response.match(/SUBCATEGORY:\s*(.+)/i);

    if (!titleMatch || !categoryMatch || !subMatch) continue;

    const title = titleMatch[1].trim();

    if (G.vault.derivedTactics.some((t) => t.title === title)) {
      debugLog(`[TACTIC EVOLUTION] Duplicate tactic "${title}"`);
      continue;
    }

    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);

    G.vault.derivedTactics.push({
      path: `__derived__/cycle_${G.cycle}_${slug}`,
      title,
      category: categoryMatch[1].trim(),
      subcategory: subMatch[1].trim(),
      content: response,
      isEmbedded: false,
      discoveredCycle: G.cycle,
      expiresCycle: G.cycle + 15,
    });

    console.group(`[TACTIC EVOLUTION] New tactic: "${title}"`);
    console.log(`  Category:      ${categoryMatch[1].trim()}`);
    console.log(`  Subcategory:   ${subMatch[1].trim()}`);
    console.log(`  Discovered:    cycle ${G.cycle}`);
    console.log(`  Expires:       cycle ${G.cycle + 15}`);
    console.log(`  Full content:\n${response}`);
    console.groupEnd();

    addLog(
      `TACTIC EVOLUTION // Cycle ${G.cycle}`,
      `New tactic: ${title}`,
      "sys"
    );
  }

  console.log(`// TACTIC EVOLUTION COMPLETE`);
}