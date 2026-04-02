// js/engine/state/utils/dampBeliefDelta.js

import { G } from "../../../core/state.js";

/*
================================================================
DAMP BELIEF DELTA

Hybrid model:
- Logistic → threshold / breaking point
- Quadratic → post-belief rigidity

This function is PURE (no mutation).
================================================================
*/

export function dampBeliefDelta(sim, beliefKey, currentValue, delta) {
    const params = G.dampingParams || {};

    const k = params.logisticK ?? 7;
    const mid = params.logisticMid ?? 0.5;
    const blend = params.hybridBlend ?? 0.6;
    const minR = params.minResistance ?? 0.38;

    const distance = Math.abs(currentValue - 0.5);
    const d = distance / 0.5;

    /* -----------------------------
       CONTEXT
    ----------------------------- */

    const stress = (sim.suffering ?? 0) / 100;
    const trust = sim.beliefs?.others_trustworthy ?? 0.5;

    const adjustedMid = mid - (stress * 0.15) + (trust * 0.1);

    /* -----------------------------
       LOGISTIC
    ----------------------------- */

    const logistic =
        1 / (1 + Math.exp(k * (d - adjustedMid)));

    /* -----------------------------
       QUADRATIC
    ----------------------------- */

    const quadratic = (1 - d) * (1 - d);

    /* -----------------------------
       BLEND
    ----------------------------- */

    const resistance =
        blend * logistic +
        (1 - blend) * quadratic;

    const finalResistance = Math.max(minR, resistance);

    const output = delta * finalResistance;

    if (G.DEBUG_DAMPING) {
        const distance = Math.abs(currentValue - 0.5);
        const d = distance / 0.5;

        console.debug(`[DAMP][${sim.id}] ${beliefKey}`, {
            belief_before: currentValue,
            delta_input: delta,
            normalized_distance: d,
            resistance: finalResistance,
            delta_output: output,
            stress: (sim.suffering ?? 0) / 100,
            trust: sim.beliefs?.others_trustworthy ?? 0.5,
            mode: "hybrid"
        });
    }

    return output;
}