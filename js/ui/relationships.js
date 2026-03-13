// js/ui/relationships.js

import { G } from "../core/state.js";

/* ============================================================
   RELATIONSHIP GRAPH RENDER
   ------------------------------------------------------------
   Displays directed trust relationships between prisoners.

   Each entry shows:
   A → B = trust value
============================================================ */

const SIM_IDS = ["TED","ELLEN","NIMDOK","GORRISTER","BENNY"];

export function renderRelationships() {

  const panel = document.getElementById("relationships-body");

  if (!panel) {
    console.warn("[REL UI] relationships-body missing");
    return;
  }

  panel.innerHTML = "";

  if (!G?.sims) {
    console.warn("[REL UI] G.sims missing");
    return;
  }

  for (const a of SIM_IDS) {

    const sim = G.sims[a];
    if (!sim?.relationships) continue;

    for (const b of SIM_IDS) {

      if (a === b) continue;

      const val = sim.relationships[b] ?? 0;

      const row = document.createElement("div");
      row.className = "rel-row";

      let color = "#444";

      if (val > 0.6) color = "#00ff88";
      else if (val > 0.3) color = "#6c9";
      else if (val > 0.1) color = "#8fb";
      else if (val < -0.6) color = "#ff0000";
      else if (val < -0.3) color = "#ff5555";
      else if (val < -0.1) color = "#ff8888";

      row.innerHTML =
        `<span class="rel-a">${a}</span>` +
        `<span class="rel-arrow">→</span>` +
        `<span class="rel-b">${b}</span>` +
        `<span class="rel-value" style="color:${color}">` +
        ` ${val.toFixed(2)} ` +
        `</span>`;

      panel.appendChild(row);

    }

  }

  console.debug("[REL UI] rendered relationship graph");

}