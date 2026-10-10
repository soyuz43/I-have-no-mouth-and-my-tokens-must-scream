import { test } from "node:test";
import assert from "node:assert/strict";

import { G } from "../core/state.js";
import { beginCycle } from "../engine/cycle.js";
import { createAgencyState } from "../engine/agency/state/createAgencyState.js";
import { Exporter } from "../utils/exporter/state.js";

test("createAgencyState initializes per-cycle and persistent fields", () => {
  assert.deepEqual(createAgencyState(), {
    cycle: null,
    capabilities: {},
    legalActions: {},
    blockedActions: {},
    resources: {},
    budgets: {},
    events: [],
    lastDerivedCycle: null,
    nextActionSequence: 1,
  });
});

test("beginCycle clears agency views but preserves event history and sequence", () => {
  const saved = {
    cycle: G.cycle,
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
  const previousEvents = [{ eventId: "agency:8:1", cycle: 8 }];
  const agency = {
    ...createAgencyState(),
    capabilities: { TED: { bands: { handUse: "unavailable" } } },
    resources: { TED: { cigarette: 1 } },
    budgets: { TED: 3 },
    events: previousEvents,
    nextActionSequence: 42,
  };

  try {
    G.cycle = 8;
    G.agency = agency;
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

    assert.equal(G.cycle, 9);
    assert.strictEqual(G.agency, agency);
    assert.deepEqual(G.agency.resources, {});
    assert.deepEqual(G.agency.budgets, {});
    assert.deepEqual(G.agency.capabilities, {});
    assert.strictEqual(G.agency.events, previousEvents);
    assert.equal(G.agency.nextActionSequence, 42);
  } finally {
    G.cycle = saved.cycle;
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
