import { G } from "../../../core/state.js";

import {
  FOCUS_PREPARATION_EVIDENCE_KEY
} from "../../psychology/journalGate.js";

export function resetCycleEvidence() {
  G.pendingPsychEvidence = Object.create(null);
  G.recentResourceDiscoveries = Array.isArray(G.pendingResourceDiscoveries)
    ? G.pendingResourceDiscoveries.map((discovery) => ({ ...discovery }))
    : [];
  G.pendingResourceDiscoveries = [];

  G.pendingEvidence ??= {
    journal: Object.create(null),
    comms: Object.create(null),
    constraints: Object.create(null),
    am: Object.create(null),
    resourceInterventions: Object.create(null),
    exposures: Object.create(null),
    system: Object.create(null),
  };
  G.pendingEvidence.resourceInterventions ??= Object.create(null);
  G.pendingEvidence.exposures ??= Object.create(null);
  G.pendingEvidence[
    FOCUS_PREPARATION_EVIDENCE_KEY
  ] ??= Object.create(null);

  /*
   * Capability-Ledger Entanglement records are written by the
   * agency phase, which runs AFTER the social phase that consumes
   * evidence. They therefore have to SURVIVE this reset in order to
   * be read in the NEXT cycle's scratchpad review.
   *
   * Only the previous cycle's records are carried forward. The
   * generic clear below would otherwise drop them, and carrying
   * every record forever would grow the channel without bound. A
   * record from the previous cycle is one the prisoner has not been
   * shown yet; anything older was either shown already or missed,
   * and either way it no longer describes the prisoner's present
   * situation.
   */
  const carriedExposures = G.pendingEvidence.exposures;
  const carriedJournalPreparations =
    G.pendingEvidence[
      FOCUS_PREPARATION_EVIDENCE_KEY
    ];
  const previousCycle = Number.isFinite(Number(G.cycle))
    ? Number(G.cycle) - 1
    : null;

  const nextExposures = Object.create(null);

  for (const [simId, records] of Object.entries(carriedExposures ?? {})) {
    if (!Array.isArray(records) || records.length === 0) continue;

    const kept = records.filter(
      (record) =>
        previousCycle === null ||
        Number(record?.cycle) === previousCycle
    );

    if (kept.length > 0) {
      nextExposures[simId] = kept;
    }
  }

  /*
   * The same carry-forward applies to a prisoner's FOCUS
   * PREPARATION, and for the same reason.
   *
   * The agency phase runs AFTER the psychology phase, so the
   * preparation a prisoner buys in cycle N is written after the
   * cycle N journal was already decided. It therefore has to
   * SURVIVE this reset in order to be read by cycle N+1's
   * psychology phase.
   *
   * Only the previous cycle's preparation is carried forward. A
   * preparation from an older cycle has already been consumed, and
   * carrying it would let one action credit buy more than one
   * journal.
   */
  const nextJournalPreparations = Object.create(null);

  for (const [simId, record] of Object.entries(
    carriedJournalPreparations ?? {}
  )) {
    if (!record || typeof record !== "object") continue;

    if (
      previousCycle === null ||
      Number(record?.cycle) === previousCycle
    ) {
      nextJournalPreparations[simId] = { ...record };
    }
  }

  for (const key of Object.keys(G.pendingEvidence)) {
    G.pendingEvidence[key] = Object.create(null);
  }

  G.pendingEvidence.exposures = nextExposures;
  G.pendingEvidence[
    FOCUS_PREPARATION_EVIDENCE_KEY
  ] =
    nextJournalPreparations;
  /*
   * The review carrier must always be an array. A non-array value
   * causes recordScratchpadReviews() to silently drop records.
   */
  G.pendingEvidence.scratchpadReviewLog = [];

  console.debug(
    `[EVIDENCE RESET][Cycle ${G.cycle}] pending evidence cleared`
  );
}
