// js/engine/analysis/relationshipDebug.js

import { G } from "../../core/state.js";

/* ============================================================
   RELATIONSHIP DEBUG UTILITIES
   ------------------------------------------------------------
   Tools for visualizing the evolving prisoner trust network.

   Outputs:
   1. Full relationship matrix (console.table)
   2. Strongest alliance
   3. Strongest hostility

   This helps diagnose whether relationship dynamics
   are actually evolving across cycles.
============================================================ */

/* ============================================================
   RELATIONSHIP MATRIX
============================================================ */

export function debugRelationshipMatrix() {

  if (!G?.sims) {
    console.warn("[REL MATRIX] G.sims missing");
    return;
  }

  const sims = Object.keys(G.sims);
  const table = {};

  for (const a of sims) {

    const simA = G.sims[a];

    if (!simA?.relationships) {
      console.warn(`[REL MATRIX] ${a} missing relationships`);
      continue;
    }

    const row = {};

    for (const b of sims) {

      if (a === b) {
        row[b] = "—";
        continue;
      }

      const value = simA.relationships[b] ?? 0;

      row[b] = Number(value.toFixed(3));

    }

    table[a] = row;

  }

  console.groupCollapsed(
    `%cRELATIONSHIP MATRIX // CYCLE ${G.cycle}`,
    "color:#9cf;font-weight:bold"
  );

  console.table(table);

  console.groupEnd();

}

/* ============================================================
   RELATIONSHIP EXTREMES
   ------------------------------------------------------------
   Detects strongest positive and negative relationships
   in the entire network.
============================================================ */

export function debugRelationshipExtremes() {

  if (!G?.sims) return;

  const sims = Object.keys(G.sims);

  let best = null;
  let worst = null;

  let bestValue = -Infinity;
  let worstValue = Infinity;

  for (const a of sims) {

    const rels = G.sims[a]?.relationships;

    if (!rels) continue;

    for (const b of sims) {

      if (a === b) continue;

      const v = rels[b] ?? 0;

      if (v > bestValue) {
        bestValue = v;
        best = `${a} → ${b}`;
      }

      if (v < worstValue) {
        worstValue = v;
        worst = `${a} → ${b}`;
      }

    }

  }

  console.groupCollapsed(
    `%cRELATIONSHIP EXTREMES // CYCLE ${G.cycle}`,
    "color:#fc9;font-weight:bold"
  );

  console.log("Strongest alliance:", best, bestValue.toFixed(3));
  console.log("Strongest hostility:", worst, worstValue.toFixed(3));

  console.groupEnd();

}

/* ============================================================
   MASTER DEBUG ENTRY
   ------------------------------------------------------------
   Call this once per cycle.
============================================================ */

export function debugRelationshipNetwork() {

  debugRelationshipMatrix();
  debugRelationshipExtremes();

}