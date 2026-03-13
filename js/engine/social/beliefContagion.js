// js/engine/social/beliefContagion.js

import { G } from "../../core/state.js";
import { SIM_IDS } from "../../core/constants.js";

/*
============================================================
BELIEF CONTAGION ENGINE
------------------------------------------------------------
Propagates belief influence across the relationship graph.

Psychological premise:

Trusted individuals influence each other's beliefs.

If A trusts B strongly, B's beliefs will gradually
pull A's beliefs in the same direction.

This produces emergent group psychology:

- despair cascades
- alliance reinforcement
- paranoia spread
- resistance collapse

Runs once per cycle after journal updates.
============================================================
*/


/* =========================================================
   Configuration
========================================================= */

const TRUST_THRESHOLD = 0.55;
const MAX_INFLUENCE = 0.04;
const MIN_BELIEF_DIFF = 0.08;
const MAX_TOTAL_SHIFT = 0.06;


/* =========================================================
   Utility: Soft resistance near belief extremes
========================================================= */

function resistanceFactor(v) {

  const distance = Math.abs(v - 0.5);

  return Math.max(
    0.2,
    1 - (distance * 1.6)
  );

}


/* =========================================================
   Influence strength calculation
========================================================= */

function computeInfluence(trust, beliefDiff) {

  const strength =
    trust *
    beliefDiff *
    0.5;

  return Math.min(MAX_INFLUENCE, strength);

}


/* =========================================================
   Main Contagion Function
========================================================= */

export function runBeliefContagion() {

  if (!G?.sims) return;

  const adjustments = {};

  SIM_IDS.forEach(id => {

    adjustments[id] = {};

  });


  /* -----------------------------------------
     Evaluate influence edges
  ----------------------------------------- */

  for (const a of SIM_IDS) {

    const simA = G.sims[a];

    if (!simA?.relationships) continue;

    for (const b of SIM_IDS) {

      if (a === b) continue;

      const trust = simA.relationships[b] ?? 0;

      if (trust < TRUST_THRESHOLD) continue;

      const simB = G.sims[b];

      if (!simB?.beliefs) continue;


      /* ----------------------------------
         Compare beliefs
      ---------------------------------- */

      Object.keys(simA.beliefs).forEach(key => {

        const beliefA = simA.beliefs[key];
        const beliefB = simB.beliefs[key];

        if (
          !Number.isFinite(beliefA) ||
          !Number.isFinite(beliefB)
        ) return;

        const diff = beliefB - beliefA;

        if (Math.abs(diff) < MIN_BELIEF_DIFF) return;


        /* ----------------------------------
           Compute influence
        ---------------------------------- */

        const influence =
          computeInfluence(trust, Math.abs(diff));

        const direction = diff > 0 ? 1 : -1;

        const delta = influence * direction;


        /* ----------------------------------
           Accumulate adjustments
        ---------------------------------- */

        adjustments[a][key] =
          (adjustments[a][key] || 0) + delta;

      });

    }

  }


  /* -----------------------------------------
     Apply accumulated adjustments
  ----------------------------------------- */

  for (const id of SIM_IDS) {

    const sim = G.sims[id];

    const deltas = adjustments[id];

    Object.keys(deltas).forEach(key => {

      if (!Object.prototype.hasOwnProperty.call(sim.beliefs, key)) return;

      let delta = deltas[key];

      if (!Number.isFinite(delta)) return;


      /* ----------------------------------
         Cap total shift per cycle
      ---------------------------------- */

      delta = Math.max(
        -MAX_TOTAL_SHIFT,
        Math.min(MAX_TOTAL_SHIFT, delta)
      );


      const belief = sim.beliefs[key];

      const resistance = resistanceFactor(belief);

      delta *= resistance;


      let newVal = belief + delta;


      /* ----------------------------------
         Soft saturation
      ---------------------------------- */

      if (newVal < 0) newVal = newVal * 0.5;

      if (newVal > 1) newVal = 1 + (newVal - 1) * 0.5;


      sim.beliefs[key] = newVal;

    });

  }

}