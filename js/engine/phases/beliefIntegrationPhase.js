// js/engine/phases/beliefIntegrationPhase.js
//
// Belief Integration Phase
//
// Responsible for:
// 1. Applying comms-derived belief evidence
// 2. Integrating social/interpersonal influence into belief state

import { G } from "../../core/state.js";
import { SIM_IDS } from "../../core/constants.js";

import { applyBeliefUpdates } from "../state/commit.js";

export function runBeliefIntegrationPhase() {

  console.group(`[BELIEF INTEGRATION][Cycle ${G.cycle}]`);

  for (const simId of SIM_IDS) {

    const sim = G.sims[simId];
    if (!sim) continue;

    const evidence = G.pendingBeliefEvidence?.[simId] || [];

    if (!evidence.length) {
      console.debug(`[COMMS Δ][${simId}] (none)`);
      continue;
    }

    const updates = {};

    for (const p of evidence) {

      if (!p?.belief || !sim.beliefs?.hasOwnProperty(p.belief)) continue;

      const sign = p.direction === "increase" ? 1 : -1;

      let delta = sign * (p.strength / 100);

      // confidence weighting
      delta *= (p.confidence ?? 1);

      // clamp
      const MAX = 0.4;
      if (Math.abs(delta) > MAX) {
        delta = Math.sign(delta) * MAX;
      }

      updates[p.belief] =
        (updates[p.belief] ?? 0) + delta;
    }

    console.debug(`[COMMS Δ][${simId}]`, evidence);

    applyBeliefUpdates(sim, updates, {
      DEBUG: true
    });

  }

  console.groupEnd();
}