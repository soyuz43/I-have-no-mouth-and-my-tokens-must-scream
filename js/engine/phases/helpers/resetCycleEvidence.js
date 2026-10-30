import { G } from "../../../core/state.js";

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

  for (const key of Object.keys(G.pendingEvidence)) {
    G.pendingEvidence[key] = Object.create(null);
  }

  G.pendingEvidence.exposures = nextExposures;
  /*
   * The review carrier must always be an array. A non-array value
   * causes recordScratchpadReviews() to silently drop records.
   */
  G.pendingEvidence.scratchpadReviewLog = [];

  console.debug(
    `[EVIDENCE RESET][Cycle ${G.cycle}] pending evidence cleared`
  );
}
