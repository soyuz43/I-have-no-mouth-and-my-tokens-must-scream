// js/engine/state/utils/dampBeliefDelta.js


import { G } from "../../../core/state.js";

/*
============================================================
DAMP BELIEF DELTA

PURE (no mutation). Multiplies the proposed delta by a
transmission multiplier `finalResistance` in [minR, ~0.97] (defaults).

NOTE on naming: the variable is called `resistance`, but it is a
transmission coefficient, not a damping force. output = delta * finalResistance,
so a LARGER value preserves MORE of the proposed delta (less damping),
and a SMALLER value preserves LESS (more damping). Do not invert the
semantics when reading this function.

Override surface: the constants are read from G.dampingParams (currently
unpopulated in production, so the ?? defaults below apply). Assigning
G.dampingParams.{logisticK,logisticMid,hybridBlend,minResistance} would
change the live equation.

Hybrid model:
- Logistic -> transition shape (threshold near the adjusted midpoint)
- Quadratic -> stronger transmission near the center (0.5)

Context modulation of the midpoint:
- greater sim.suffering lowers transmission
- greater sim.beliefs.others_trustworthy raises transmission
============================================================
*/

export function dampBeliefDelta(sim, beliefKey, currentValue, delta) {
    const params = G.dampingParams || {};

    const k = params.logisticK ?? 5;
    const mid = params.logisticMid ?? 0.5;
    const blend = params.hybridBlend ?? 0.68;
    const minR = params.minResistance ?? 0.5;

    const distance = Math.abs(currentValue - 0.5);
    const d = distance / 0.5;

    /* -----------------------------
       CONTEXT
    ----------------------------- */

    const stress = (sim.suffering ?? 0) / 100;
    const trust = sim.beliefs?.others_trustworthy ?? 0.5;

    const adjustedMid = mid - (stress * 0.12) + (trust * 0.1);

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
