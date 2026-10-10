import { test } from "node:test";
import assert from "node:assert/strict";

import { G } from "../core/state.js";
import { makeScratchpad } from "../core/utils.js";
import { beginCycle } from "../engine/cycle.js";
import { createAgencyState } from "../engine/agency/state/createAgencyState.js";
import { commitScratchpadCommsOperations } from "../engine/scratchpad/comms/commit.js";
import { Exporter } from "../utils/exporter/state.js";

function commitNoUpdate(simId, cycle) {
  return commitScratchpadCommsOperations({
    simId,
    validationResult: {
      status: "no_update",
      accepted: [{ type: "no_update", tag: "NO_UPDATE", sourceIndex: 0 }],
      rejected: [],
    },
    evidence: [],
    cycle,
  });
}

test("beginCycle's Social-order scratchpad commit tolerates missing and uses available capability bands", () => {
  const saved = {
    cycle: G.cycle,
    sims: G.sims,
    agency: G.agency,
    prevCycleSnapshot: G.prevCycleSnapshot,
    beliefSnapshots: G.beliefSnapshots,
    pendingBeliefEvidence: G.pendingBeliefEvidence,
    pendingPsychEvidence: G.pendingPsychEvidence,
    pendingEvidence: G.pendingEvidence,
    timeline: G.timeline,
    exporterPrevState: Exporter.prevState,
    document: globalThis.document,
    window: globalThis.window,
  };

  try {
    G.cycle = 0;
    G.sims = structuredClone(saved.sims);
    G.sims.TED.scratchpad = makeScratchpad("TED");
    G.sims.TED.scratchpad.initialized = true;
    G.sims.TED.scratchpad.physicalLimitations = ["hands_bound"];
    G.agency = {
      ...createAgencyState(),
      capabilities: {
        TED: { bands: { handUse: "unavailable" } },
      },
    };
    G.beliefSnapshots = {};
    G.pendingBeliefEvidence = {};
    G.pendingPsychEvidence = {};
    G.pendingEvidence = {
      journal: {},
      comms: {},
      constraints: {},
      am: {},
      system: {},
    };
    G.timeline = [];
    globalThis.document = { getElementById: () => null };
    globalThis.window = {};

    beginCycle();
    assert.deepEqual(G.agency.capabilities, {});

    const missingEnvelopeCommit = commitNoUpdate("TED", G.cycle);
    assert.equal(missingEnvelopeCommit.committed, true);
    assert.deepEqual(G.sims.TED.scratchpad.physicalLimitations, []);
    assert.ok(missingEnvelopeCommit.changedPaths.includes("physicalLimitations"));

    G.agency.capabilities.TED = {
      bands: {
        handUse: "unavailable",
        concentration: "severely_impaired",
        mobility: "normal",
        stability: "unavailable",
        interactionReach: "normal",
      },
    };
    const availableEnvelopeCommit = commitNoUpdate("TED", G.cycle);

    assert.equal(availableEnvelopeCommit.committed, true);
    assert.deepEqual(G.sims.TED.scratchpad.physicalLimitations, [
      "hands_bound",
      "severe_concentration_impairment",
      "unstable",
    ]);
  } finally {
    G.cycle = saved.cycle;
    G.sims = saved.sims;
    G.agency = saved.agency;
    G.prevCycleSnapshot = saved.prevCycleSnapshot;
    G.beliefSnapshots = saved.beliefSnapshots;
    G.pendingBeliefEvidence = saved.pendingBeliefEvidence;
    G.pendingPsychEvidence = saved.pendingPsychEvidence;
    G.pendingEvidence = saved.pendingEvidence;
    G.timeline = saved.timeline;
    Exporter.prevState = saved.exporterPrevState;
    if (saved.document === undefined) delete globalThis.document;
    else globalThis.document = saved.document;
    if (saved.window === undefined) delete globalThis.window;
    else globalThis.window = saved.window;
  }
});
