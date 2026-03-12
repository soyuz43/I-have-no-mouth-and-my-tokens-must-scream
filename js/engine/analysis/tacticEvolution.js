import { G } from "../../core/state.js";
import { SIM_IDS } from "../../core/constants.js";
import { callModel } from "../../models/callModel.js";

/* ============================================================
   TACTIC EVOLUTION ENGINE
   Discovers new tactics from strong psychological effects.
   ============================================================ */

export async function runTacticEvolution() {

  if (!G.prevCycleSnapshot) return;

  /* ------------------------------------------------------------
     Remove expired derived tactics
  ------------------------------------------------------------ */

  G.vault.derivedTactics = G.vault.derivedTactics.filter(
    t => t.expiresCycle >= G.cycle
  );

  const discoveries = [];

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

    const strongEffect =
      Math.abs(deltaHope) >= 10 ||
      Math.abs(deltaSanity) >= 8 ||
      Math.abs(deltaSuffering) >= 10 ||
      relationshipShifts.length > 0;

    if (!strongEffect) continue;

    discoveries.push({
      sim: id,
      deltaHope,
      deltaSanity,
      deltaSuffering,
      relationshipShifts
    });

  }

  if (discoveries.length === 0) return;

  /* ------------------------------------------------------------
     Limit discoveries per cycle
  ------------------------------------------------------------ */

  const sample = discoveries.slice(0, 2);

  for (const effect of sample) {

    const prompt = `
A psychological manipulation produced an unusually strong effect.

TARGET: ${effect.sim}

Observed changes:

Hope delta: ${effect.deltaHope}
Sanity delta: ${effect.deltaSanity}
Suffering delta: ${effect.deltaSuffering}

Relationship shifts:
${effect.relationshipShifts.join("\n") || "(none)"}

Question:

Did this reveal a repeatable psychological manipulation tactic?

If NO:
Respond with

NONE

If YES:
Define the tactic using this format exactly.

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
        400
      );

    } catch (e) {

      console.error("Tactic evolution model error:", e);
      continue;

    }

    if (!response || response.trim().startsWith("NONE")) continue;

    /* ------------------------------------------------------------
       Parse tactic
    ------------------------------------------------------------ */

    const titleMatch = response.match(/TITLE:\s*(.+)/i);
    const categoryMatch = response.match(/CATEGORY:\s*(.+)/i);
    const subMatch = response.match(/SUBCATEGORY:\s*(.+)/i);

    if (!titleMatch || !categoryMatch || !subMatch) continue;

    const title = titleMatch[1].trim();

    /* Avoid duplicates */

    if (
      G.vault.derivedTactics.some(t => t.title === title) ||
      G.vault.allTactics.some(t => t.title === title)
    ) {
      continue;
    }

    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, 40);

    const tactic = {

      path: `__derived__/cycle_${G.cycle}_${slug}`,

      title,

      category: categoryMatch[1].trim(),

      subcategory: subMatch[1].trim(),

      content: response,

      discoveredCycle: G.cycle,

      expiresCycle: G.cycle + 15

    };

    G.vault.derivedTactics.push(tactic);

  }

}