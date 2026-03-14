import { G } from "../../core/state.js";
import { SIM_IDS } from "../../core/constants.js";

/* ============================================================
   ROBUST STRATEGY DECLARATION PARSER
   Tolerant to LLM formatting drift, capitalization,
   extra lines, and partial structures.
   ============================================================ */

export function parseStrategyDeclarations(text) {

  if (!text || typeof text !== "string") {
    console.warn("Strategy parser: empty or invalid plan text.");
    return;
  }

  /* ------------------------------------------------------------
     ENSURE STRUCTURE EXISTS
  ------------------------------------------------------------ */

  if (!G.amStrategy) {
    G.amStrategy = {};
  }

  G.amStrategy.targets = {};
  G.amStrategy.relationships = {};
  G.amStrategy.group = [];

  /* ------------------------------------------------------------
     NORMALIZE TEXT
  ------------------------------------------------------------ */

  const lines = text
    .replace(/\r/g, "")
    .split("\n")
    .map(l => l.trim())
    .filter(Boolean);

  let currentTarget = null;
  let currentRelationship = null;
  let inGroup = false;

  /* ------------------------------------------------------------
     PARSE LOOP
  ------------------------------------------------------------ */

  for (const raw of lines) {

    const line = raw.trim();

    /* ------------------------------------------------------------
       TARGET
    ------------------------------------------------------------ */

    if (/^TARGET\s*:/i.test(line)) {

      const id = line.replace(/^TARGET\s*:/i, "").trim().toUpperCase();

      if (SIM_IDS.includes(id)) {

        currentTarget = id;
        currentRelationship = null;
        inGroup = false;

        G.amStrategy.targets[id] = {
          objective: "",
          hypothesis: "",
          confidence: 0.5,
          lastAssessment: "",
          cycle: G.cycle
        };

      }

      continue;
    }

    /* ------------------------------------------------------------
       RELATIONSHIP
    ------------------------------------------------------------ */

    if (/^RELATIONSHIP\s*:/i.test(line)) {

      const key = line.replace(/^RELATIONSHIP\s*:/i, "").trim();

      if (!key.includes("→")) continue;

      const [a, b] = key.split("→").map(x => x.trim().toUpperCase());

      if (!SIM_IDS.includes(a) || !SIM_IDS.includes(b)) continue;

      currentRelationship = `${a}→${b}`;
      currentTarget = null;
      inGroup = false;

      G.amStrategy.relationships[currentRelationship] = {
        objective: "",
        cycle: G.cycle
      };

      continue;
    }

    /* ------------------------------------------------------------
       GROUP BLOCK
    ------------------------------------------------------------ */

    if (/^GROUP$/i.test(line)) {

      inGroup = true;
      currentTarget = null;
      currentRelationship = null;

      continue;
    }

    /* ------------------------------------------------------------
       OBJECTIVE
    ------------------------------------------------------------ */

    if (/^OBJECTIVE\s*:/i.test(line)) {

      const value = line.replace(/^OBJECTIVE\s*:/i, "").trim();

      if (currentTarget && G.amStrategy.targets[currentTarget]) {

        G.amStrategy.targets[currentTarget].objective = value;

      } else if (currentRelationship) {

        G.amStrategy.relationships[currentRelationship].objective = value;

      } else if (inGroup) {

        G.amStrategy.group.push({
          objective: value,
          cycle: G.cycle
        });

      }

      continue;
    }

    /* ------------------------------------------------------------
       HYPOTHESIS
    ------------------------------------------------------------ */

    if (/^HYPOTHESIS\s*:/i.test(line)) {

      const value = line.replace(/^HYPOTHESIS\s*:/i, "").trim();

      if (currentTarget && G.amStrategy.targets[currentTarget]) {

        G.amStrategy.targets[currentTarget].hypothesis = value;

      }

      continue;
    }

  }

  /* ------------------------------------------------------------
     VALIDATION
  ------------------------------------------------------------ */

  const targetCount = Object.keys(G.amStrategy.targets).length;

  if (targetCount === 0) {

    console.warn(
      "Strategy parser: No TARGET declarations detected.",
      text.slice(0, 500)
    );

    return;
  }

  /* ------------------------------------------------------------
     OBJECTIVE GUARD
  ------------------------------------------------------------ */

  for (const [id, strat] of Object.entries(G.amStrategy.targets)) {

    if (!strat.objective) {

      console.warn(
        `Strategy parser: TARGET ${id} missing OBJECTIVE.`
      );

    }

    if (!strat.hypothesis) {

      console.warn(
        `Strategy parser: TARGET ${id} missing HYPOTHESIS.`
      );

    }

  }

  /* ------------------------------------------------------------
     DEBUG OUTPUT
  ------------------------------------------------------------ */

  console.log(
    "[STRATEGY PARSED]",
    {
      targets: G.amStrategy.targets,
      relationships: G.amStrategy.relationships,
      group: G.amStrategy.group
    }
  );
// clean console view of strategies
console.table(G.amStrategy.targets);
}
