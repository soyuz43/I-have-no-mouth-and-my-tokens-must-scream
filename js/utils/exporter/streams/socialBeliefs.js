// js/utils/exporter/streams/socialBeliefs.js
//
// The Social Belief export stream.
//
// WHAT THIS STREAM IS
// -------------------
// The `claim_events` stream records how each prisoner's belief about
// their OWN holdings moved. The `claim_divergence` stream records the
// gap between that belief and the objective reality.
//
// This stream records a DIFFERENT kind of belief entirely: what a
// prisoner believes a PEER holds, learned from that peer's own
// testimony.
//
// WHY IT IS A SEPARATE STREAM
// ---------------------------
// A social belief is not a claim event. It is not derived from an
// objective ledger mutation, it produces no divergence, and it never
// grants permission to act. Putting it in `claim_events` would make
// `subject_id` mean two different things in the same column, and
// putting it in `claim_divergence` would inflate the divergence
// metrics with events that are not divergences.
//
// A social belief may be WRONG. It is clamped to what the SPEAKER
// believed, not to what is true, so a prisoner can transmit a
// mistaken or inflated claim. `source_id` names the message the
// testimony came from, so a researcher can trace the claim back to
// the words that produced it.
//
// WHY IT IS FILTERED BY CYCLE
// ---------------------------
// The collection is a CURRENT snapshot, not an append-only history:
// a later testimony about the same pair replaces the earlier one. So
// one record is written per belief, and only for beliefs updated in
// the cycle being exported.

import { Exporter } from "../state.js";
import { attachRecordMeta } from "../metadata.js";
import { cloneValue } from "../format.js";

/*
 * The social beliefs updated during one cycle.
 */
export function recordSocialBeliefs(G, cycle) {
  for (const [simId, sim] of Object.entries(G?.sims ?? {})) {
    if (!sim) continue;

    const beliefs =
      sim.scratchpad &&
      typeof sim.scratchpad === "object" &&
      sim.scratchpad.resourceBeliefs &&
      typeof sim.scratchpad.resourceBeliefs === "object" &&
      !Array.isArray(sim.scratchpad.resourceBeliefs)
        ? sim.scratchpad.resourceBeliefs
        : {};

    for (const [targetId, definitions] of Object.entries(beliefs)) {
      if (
        !definitions ||
        typeof definitions !== "object" ||
        Array.isArray(definitions)
      ) {
        continue;
      }

      for (const [definitionId, belief] of Object.entries(definitions)) {
        if (!belief || typeof belief !== "object") continue;

        const updatedCycle = Number(belief.updatedCycle);

        if (!Number.isFinite(updatedCycle)) continue;
        if (updatedCycle !== cycle) continue;

        Exporter.buffers.social_beliefs.push(attachRecordMeta({
          cycle,
          sim_id: simId,
          target_id: targetId,
          definition_id: definitionId,
          quantity: Number(belief.quantity) || 0,
          confidence: Number(belief.confidence) || 0,
          source_id: belief.sourceId ?? null,
          evidence: cloneValue(belief.evidence ?? []),
          updated_cycle: updatedCycle
        }, cycle));
      }
    }
  }
}
