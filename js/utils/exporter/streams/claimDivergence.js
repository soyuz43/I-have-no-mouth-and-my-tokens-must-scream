// js/utils/exporter/streams/claimDivergence.js
//
// The Divergence Loop export stream.
//
// WHAT THIS STREAM IS
// -------------------
// The claim_events stream records what each prisoner's BELIEF did.
// This stream records the GAP between that belief and the objective
// reality: one record per open divergence, plus one record per
// divergence that resolved during the cycle.
//
// A run analysed with only the objective ledger cannot distinguish a
// prisoner who knew they were robbed from one who still believes
// they are holding the item. This stream is the one that makes the
// belief/reality gap measurable: how many divergences are open, how
// old each one is, and whether it is still fresh enough for the
// engine to act on.
//
// WHY THE RECORD SHAPE IS CAMEL CASE
// ----------------------------------
// The other streams use snake_case because they were written for CSV
// export. This stream's records are read as OBJECTS by the analysis
// layer, and the divergence vocabulary already exists in camel case
// throughout the engine (`onsetCycle`, `claimedResourceId`,
// `believedQuantity`). Keeping one spelling across the engine and
// the export means a researcher never has to remember that the
// export renamed the fields.
//
// WHY IT IS FILTERED BY CYCLE
// ---------------------------
// The divergence view is a derived snapshot that is replaced every
// cycle, and the lifecycle log is run-scoped and grows without bound.
// The snapshot is per-cycle by nature; the resolutions are filtered
// by cycle exactly like the claim and goal event streams.

import { Exporter } from "../state.js";
import { attachRecordMeta } from "../metadata.js";
import { collectDivergenceSnapshots } from "../../../engine/agency/divergenceTelemetry.js";

/*
 * The divergence snapshot for one cycle.
 */
export function recordClaimDivergence(G, cycle) {
  const snapshots = collectDivergenceSnapshots(
    G?.claimDivergence,
    G?.divergenceEvents,
    cycle
  );

  for (const snapshot of snapshots) {
    Exporter.buffers.claim_divergence.push(attachRecordMeta({
      cycle: snapshot.cycle,
      simId: snapshot.simId,
      resourceId: snapshot.resourceId,
      definitionId: snapshot.definitionId,
      believedQuantity: snapshot.believedQuantity,
      objectiveQuantity: snapshot.objectiveQuantity,
      onsetCycle: snapshot.onsetCycle,
      age: snapshot.age,
      fresh: snapshot.fresh,
      status: snapshot.status
    }, cycle));
  }
}
