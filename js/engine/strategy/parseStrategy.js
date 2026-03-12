import { G } from "../../core/state.js";
import { SIM_IDS } from "../../core/constants.js";

/* ============================================================
   ROBUST STRATEGY DECLARATION PARSER
   Line-based parsing for resilience to LLM formatting drift.
   ============================================================ */

export function parseStrategyDeclarations(text) {

  if (!text) return;

  G.amStrategy.targets = {};
  G.amStrategy.relationships = {};
  G.amStrategy.group = [];

  const lines = text.split("\n");

  let currentTarget = null;
  let currentRelationship = null;
  let inGroup = false;

  for (let raw of lines) {

    const line = raw.trim();

    if (!line) continue;

    /* ------------------------------------------------------------
       TARGET BLOCK
    ------------------------------------------------------------ */

    if (line.startsWith("TARGET:")) {

      const id = line.replace("TARGET:", "").trim();

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
       RELATIONSHIP BLOCK
    ------------------------------------------------------------ */

    if (line.startsWith("RELATIONSHIP:")) {

      const key = line.replace("RELATIONSHIP:", "").trim();

      currentRelationship = key;
      currentTarget = null;
      inGroup = false;

      G.amStrategy.relationships[key] = {
        objective: "",
        cycle: G.cycle
      };

      continue;
    }

    /* ------------------------------------------------------------
       GROUP BLOCK
    ------------------------------------------------------------ */

    if (line === "GROUP") {

      inGroup = true;
      currentTarget = null;
      currentRelationship = null;

      continue;
    }

    /* ------------------------------------------------------------
       OBJECTIVE
    ------------------------------------------------------------ */

    if (line.startsWith("OBJECTIVE:")) {

      const value = line.replace("OBJECTIVE:", "").trim();

      if (currentTarget) {

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

    if (line.startsWith("HYPOTHESIS:") && currentTarget) {

      const value = line.replace("HYPOTHESIS:", "").trim();

      G.amStrategy.targets[currentTarget].hypothesis = value;

      continue;
    }

  }

  /* ------------------------------------------------------------
     DEBUG GUARD
  ------------------------------------------------------------ */

  if (Object.keys(G.amStrategy.targets).length === 0) {

    console.warn(
      "Strategy parser: No TARGET declarations found in AM plan."
    );

  }

}