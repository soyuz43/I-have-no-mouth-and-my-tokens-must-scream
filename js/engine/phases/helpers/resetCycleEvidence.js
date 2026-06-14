import { G } from "../../../core/state.js";

export function resetCycleEvidence() {
  G.pendingBeliefEvidence = Object.create(null);
  G.pendingPsychEvidence = Object.create(null);

  G.pendingEvidence ??= {
    journal: Object.create(null),
    comms: Object.create(null),
    constraints: Object.create(null),
    am: Object.create(null),
    system: Object.create(null),
  };

  for (const key of Object.keys(G.pendingEvidence)) {
    G.pendingEvidence[key] = Object.create(null);
  }

  console.debug(
    `[EVIDENCE RESET][Cycle ${G.cycle}] pending evidence cleared`
  );
}