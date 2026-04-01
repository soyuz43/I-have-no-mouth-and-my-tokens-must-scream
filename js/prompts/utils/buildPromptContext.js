// js/prompts/utils/buildPromptContext.js

import { SIM_IDS } from "../../core/constants.js";
import { clamp } from "../../core/utils.js";
/*
===============================================================
PROMPT CONTEXT BUILDER

Purpose:
- Prevent undefined variable bugs in prompts
- Normalize sim + state into a safe, consistent shape

Guarantees:
- All commonly used variables exist
- Missing fields get safe defaults
===============================================================
*/



function toNumber(val, fallback = 0.5) {
  return typeof val === "number" && !isNaN(val)
    ? val
    : fallback;
}

export function buildPromptContext(sim, state = null) {

  const raw = sim.beliefs || {};
// clamp is a SECOND LAYER DEFENSE here
  const b = {
    escape_possible: clamp(toNumber(raw.escape_possible), 0, 1),
    others_trustworthy: clamp(toNumber(raw.others_trustworthy), 0, 1),
    resistance_possible: clamp(toNumber(raw.resistance_possible), 0, 1),
    self_worth: clamp(toNumber(raw.self_worth), 0, 1),
    guilt_deserved: clamp(toNumber(raw.guilt_deserved), 0, 1),
    reality_reliable: clamp(toNumber(raw.reality_reliable), 0, 1),
    am_has_limits: clamp(toNumber(raw.am_has_limits), 0, 1),
  };

  const others = SIM_IDS.filter(id => id !== sim.id);

  const reactiveIntel = state?.pendingReactiveIntel?.get(sim.id) || null;

  return {
    sim,
    b,
    others,
    reactiveIntel
  };
}