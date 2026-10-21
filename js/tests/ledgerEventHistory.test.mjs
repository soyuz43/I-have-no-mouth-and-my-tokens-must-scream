// js/tests/ledgerEventHistory.test.mjs
//
// Coverage for Milestone 1: the Objective Ledger.
//
// WHAT THIS GUARDS
// -----------------
//   1. Every ledger mutation emits exactly one event, AFTER the
//      mutation succeeds. Observing must not change behavior.
//   2. Event ids are strictly monotonic within a cycle and
//      deterministic across runs.
//   3. The history survives a save/load round-trip.
//
// THE BEHAVIOUR MOST LIKELY TO REGRESS SILENTLY
// ----------------------------------------------
// An event emitted BEFORE the mutation commits, or emitted from
// inside the resolver rather than the committer. A resolver that
// speculates about a mutation that the commit path then rejects
// would put phantom events in the ledger, and the AM trajectory
// would narrate a world that never existed.

import assert from "node:assert/strict";
import { test } from "node:test";

import { G } from "../core/state.js";
import { exportState, importState } from "../core/saveLoad.js";
import { SIM_IDS } from "../core/constants.js";
import { commitAgencyResolution } from "../engine/agency/commit.js";
import { createAgencyState } from "../engine/agency/state/createAgencyState.js";
import {
  createResourceLedger,
  maintainResourceDrying,
  seedResources
} from "../engine/agency/resourceLedger.js";
import {
  recordResourceEvent
} from "../engine/agency/resourceEventLog.js";
import { commitResourceInterventions } from "../engine/analysis/commitResourceInterventions.js";
import { buildTacticPlanningContext } from "../prompts/amPlan/buildTacticPlanningContext.js";
import { formatResourceTrajectory } from "../prompts/utils/formatResourceTrajectory.js";
import { Exporter } from "../utils/exporter/state.js";
import { recordResourceEvents } from "../utils/exporter/streams/resourceEvents.js";

/* ============================================================
   FIXTURES
============================================================ */

function createGame(cycle = 5, instances = []) {
  const sims = Object.fromEntries(
    SIM_IDS.map((id) => [id, {
      id,
      hope: 50,
      sanity: 60,
      suffering: 10,
      waitStreak: 0,
      drives: {},
      anchors: [],
      beliefs: {},
      constraints: [],
      scratchpad: { initialized: true }
    }])
  );

  return {
    cycle,
    sims,
    resources: { instances },
    agency: createAgencyState(),
    pendingResourceDiscoveries: [],
    resourceEvents: [],
    resourceEventSequence: { cycle: null, next: 1 }
  };
}

function cigaretteStack(overrides = {}) {
  return {
    resourceId: "cigarette_stack_01",
    definitionId: "cigarette",
    quantity: 3,
    holderId: "TED",
    locationId: null,
    accessible: true,
    concealed: false,
    provenance: { source: "test" },
    ...overrides
  };
}

/*
 * A minimal but COMPLETE tactic.
 *
 * `buildTacticPlanningContext` validates the phase structure, so a
 * fixture with only a path and a title is rejected. This mirrors the
 * fixture shape the existing planning-context test uses.
 */
function testTactic() {
  return {
    path: "__test__/tactic-a",
    title: "Tactic A",
    category: "Test Category",
    subcategory: "Test Subcategory",
    objective: "Complete objective A.",
    initialPhaseId: "start",
    phases: {
      start: {
        purpose: "Establish the opening condition.",
        instruction: "Apply the opening intervention.",
        nextPhaseId: "current"
      },
      current: {
        purpose: "Exploit the established condition.",
        instruction: "Apply the current intervention.",
        nextPhaseId: null
      }
    },
    finishWhen: "The whole tactic succeeds.",
    abandonWhen: "The whole tactic should stop."
  };
}

function interventionState(cycle, instances) {
  return {
    cycle,
    sims: {
      TED: { id: "TED", scratchpad: {} },
      ELLEN: { id: "ELLEN", scratchpad: {} }
    },
    resources: { instances },
    pendingEvidence: { resourceInterventions: Object.create(null) },
    resourceEvents: [],
    resourceEventSequence: { cycle: null, next: 1 }
  };
}

/* ============================================================
   A) STATE SCHEMA
============================================================ */

test("the initial state carries an empty resource event history", () => {
  assert.ok(Array.isArray(G.resourceEvents));
  assert.equal(G.resourceEvents.length, 0);
});

test("the event sequence counter lives on the state and survives cloning", () => {
  assert.ok(G.resourceEventSequence);
  assert.equal(typeof G.resourceEventSequence, "object");
  assert.equal(G.resourceEventSequence.next, 1);

  const cloned = structuredClone(G.resourceEventSequence);
  assert.deepEqual(cloned, G.resourceEventSequence);
});

/* ============================================================
   B) PRISONER ACTIONS
============================================================ */

test("a SEARCH action emits a prisoner_action event", () => {
  const game = createGame(11);

  commitAgencyResolution(game, [{
    actorId: "TED",
    action: { type: "SEARCH" },
    status: "success",
    operations: [{ type: "find", definitionId: "cigarette", quantity: 2 }],
    provenance: { searchAttempted: true }
  }]);

  assert.equal(game.resourceEvents.length, 1);

  const [event] = game.resourceEvents;

  assert.equal(event.kind, "prisoner_action");
  assert.equal(event.cycle, 11);
  assert.equal(event.actorId, "TED");
  assert.equal(event.definitionId, "cigarette");
  assert.equal(event.quantityBefore, 0);
  assert.equal(event.quantityAfter, 2);
  assert.equal(event.fromHolderId, null);
  assert.equal(event.toHolderId, "TED");
  assert.equal(event.cause.action, "SEARCH");
  assert.equal(event.cause.phase, "agency_phase");
  assert.equal(event.cause.source, "agency_resolver");
  assert.match(event.resourceId, /^cigarette_found_\d+_\d+$/);
});

test("a CONSUME action emits a prisoner_action event whose units cease to exist", () => {
  const game = createGame(12, [cigaretteStack()]);

  commitAgencyResolution(game, [{
    actorId: "TED",
    action: { type: "CONSUME" },
    status: "success",
    operations: [{
      kind: "consume",
      resourceId: "cigarette_stack_01",
      definitionId: "cigarette",
      quantity: 1
    }],
    provenance: {}
  }]);

  const [event] = game.resourceEvents;

  assert.equal(event.kind, "prisoner_action");
  assert.equal(event.resourceId, "cigarette_stack_01");
  assert.equal(event.quantityBefore, 1);
  assert.equal(event.quantityAfter, 0);
  assert.equal(event.fromHolderId, "TED");
  assert.equal(event.toHolderId, null);
  assert.equal(event.actorId, "TED");
});

test("a TRANSFER action emits a prisoner_action event naming both holders", () => {
  const game = createGame(13, [cigaretteStack()]);

  commitAgencyResolution(game, [{
    actorId: "TED",
    action: { type: "TRANSFER" },
    status: "success",
    operations: [{
      kind: "transfer",
      resourceId: "cigarette_stack_01",
      definitionId: "cigarette",
      quantity: 3,
      targetId: "ELLEN"
    }],
    provenance: {}
  }]);

  const [event] = game.resourceEvents;

  assert.equal(event.kind, "prisoner_action");
  assert.equal(event.fromHolderId, "TED");
  assert.equal(event.toHolderId, "ELLEN");
  assert.equal(event.quantityBefore, 3);
  assert.equal(event.quantityAfter, 3);
  assert.equal(event.actorId, "TED");
});

test("a HIDE action emits a prisoner_action event without moving quantity", () => {
  const game = createGame(14, [cigaretteStack()]);

  commitAgencyResolution(game, [{
    actorId: "TED",
    action: { type: "HIDE" },
    status: "success",
    operations: [{
      kind: "conceal",
      resourceId: "cigarette_stack_01",
      definitionId: "cigarette",
      quantity: 3,
      concealed: true
    }],
    provenance: {}
  }]);

  const [event] = game.resourceEvents;

  assert.equal(event.kind, "prisoner_action");
  assert.equal(event.cause.action, "HIDE");
  assert.equal(event.quantityBefore, 3);
  assert.equal(event.quantityAfter, 3);
  assert.equal(event.fromHolderId, "TED");
  assert.equal(event.toHolderId, "TED");
});

test("a blocked resolution emits no resource event", () => {
  const game = createGame(15, [cigaretteStack()]);

  commitAgencyResolution(game, [{
    actorId: "TED",
    action: { type: "CONSUME" },
    status: "blocked",
    operations: [{
      kind: "consume",
      resourceId: "cigarette_stack_01",
      definitionId: "cigarette",
      quantity: 1
    }],
    provenance: {}
  }]);

  assert.deepEqual(game.resourceEvents, []);
});

/* ============================================================
   C) AM INTERVENTIONS
============================================================ */

test("an AM confiscate emits an am_intervention event", () => {
  const state = interventionState(5, [cigaretteStack()]);

  const previousTimeline = G.timeline;
  const previousCycle = G.cycle;
  G.timeline = [];
  G.cycle = state.cycle;

  try {
    const result = commitResourceInterventions(state, [{
      intervention_type: "confiscate",
      resource_id: "cigarette_stack_01",
      holder_id: "TED",
      quantity: 1,
      rationale: "Remove one."
    }]);

    assert.equal(result.committed.length, 1);
    assert.equal(state.resourceEvents.length, 1);

    const [event] = state.resourceEvents;

    assert.equal(event.kind, "am_intervention");
    assert.equal(event.cycle, 5);
    assert.equal(event.actorId, "AM");
    assert.equal(event.definitionId, "cigarette");
    assert.equal(event.quantityBefore, 1);
    assert.equal(event.quantityAfter, 1);
    assert.equal(event.fromHolderId, "TED");
    assert.equal(event.toHolderId, "AM");
    assert.equal(event.cause.action, "CONFISCATE");
  } finally {
    G.timeline = previousTimeline;
    G.cycle = previousCycle;
  }
});

test("an AM destroy emits an am_intervention event whose units cease to exist", () => {
  const state = interventionState(6, [cigaretteStack()]);

  const previousTimeline = G.timeline;
  const previousCycle = G.cycle;
  G.timeline = [];
  G.cycle = state.cycle;

  try {
    commitResourceInterventions(state, [{
      intervention_type: "destroy",
      resource_id: "cigarette_stack_01",
      rationale: "Remove the option."
    }]);

    const [event] = state.resourceEvents;

    assert.equal(event.kind, "am_intervention");
    assert.equal(event.cause.action, "DESTROY");
    assert.equal(event.quantityBefore, 3);
    assert.equal(event.quantityAfter, 0);
    assert.equal(event.fromHolderId, "TED");
    assert.equal(event.toHolderId, null);
  } finally {
    G.timeline = previousTimeline;
    G.cycle = previousCycle;
  }
});

test("a rejected AM intervention emits no resource event", () => {
  const state = interventionState(7, [cigaretteStack()]);

  const previousTimeline = G.timeline;
  const previousCycle = G.cycle;
  G.timeline = [];
  G.cycle = state.cycle;

  try {
    const result = commitResourceInterventions(state, [{
      intervention_type: "confiscate",
      resource_id: "cigarette_stack_01",
      holder_id: "TED",
      quantity: 99,
      rationale: "Too much."
    }]);

    assert.equal(result.committed.length, 0);
    assert.equal(result.rejected.length, 1);
    assert.deepEqual(state.resourceEvents, []);
  } finally {
    G.timeline = previousTimeline;
    G.cycle = previousCycle;
  }
});

/* ============================================================
   D) DRYING
============================================================ */

test("resource drying emits a drying event", () => {
  const game = createGame(20, [{
    ...cigaretteStack({
      resourceId: "wet_cigarette_found_20_0",
      definitionId: "wet_cigarette"
    }),
    dryingTurns: 1
  }]);

  maintainResourceDrying(game);

  assert.equal(game.resources.instances[0].definitionId, "cigarette");
  assert.equal(game.resourceEvents.length, 1);

  const [event] = game.resourceEvents;

  assert.equal(event.kind, "drying");
  assert.equal(event.cycle, 20);
  assert.equal(event.actorId, "ENGINE");
  assert.equal(event.resourceId, "wet_cigarette_found_20_0");
  assert.equal(event.definitionId, "cigarette");
  assert.equal(event.quantityBefore, 3);
  assert.equal(event.quantityAfter, 3);
  assert.equal(event.fromHolderId, "TED");
  assert.equal(event.toHolderId, "TED");
  assert.equal(event.cause.action, "DRIED");
});

test("a wet cigarette that is not yet dry emits no event", () => {
  const game = createGame(21, [{
    ...cigaretteStack({ definitionId: "wet_cigarette" }),
    dryingTurns: 2
  }]);

  maintainResourceDrying(game);

  assert.deepEqual(game.resourceEvents, []);
});

/* ============================================================
   E) SEED
============================================================ */

test("seeding the ledger emits one seed event per seeded instance", () => {
  const state = {
    cycle: 0,
    resourceEvents: [],
    resourceEventSequence: { cycle: null, next: 1 }
  };

  seedResources(createResourceLedger(), state);

  assert.equal(state.resourceEvents.length, 2);
  assert.deepEqual(
    state.resourceEvents.map((event) => event.kind),
    ["seed", "seed"]
  );
  assert.deepEqual(
    state.resourceEvents.map((event) => event.actorId),
    ["ENGINE", "ENGINE"]
  );
  assert.deepEqual(
    state.resourceEvents.map((event) => event.toHolderId),
    ["TED", "ELLEN"]
  );
  assert.deepEqual(
    state.resourceEvents.map((event) => event.quantityBefore),
    [0, 0]
  );
});

/* ============================================================
   F) SEQUENCING AND DETERMINISM
============================================================ */

test("event ids are strictly monotonic within a cycle", () => {
  const game = createGame(30);

  commitAgencyResolution(game, [{
    actorId: "TED",
    action: { type: "SEARCH" },
    status: "success",
    operations: [{ type: "find", definitionId: "cigarette", quantity: 1 }],
    provenance: { searchAttempted: true }
  }]);

  commitAgencyResolution(game, [{
    actorId: "ELLEN",
    action: { type: "SEARCH" },
    status: "success",
    operations: [{ type: "find", definitionId: "match", quantity: 1 }],
    provenance: { searchAttempted: true }
  }]);

  assert.equal(game.resourceEvents.length, 2);
  assert.equal(game.resourceEvents[0].eventId, "evt_30_1");
  assert.equal(game.resourceEvents[1].eventId, "evt_30_2");
});

test("event ids restart their sequence on each new cycle", () => {
  const game = createGame(31);

  commitAgencyResolution(game, [{
    actorId: "TED",
    action: { type: "SEARCH" },
    status: "success",
    operations: [{ type: "find", definitionId: "cigarette", quantity: 1 }],
    provenance: { searchAttempted: true }
  }]);

  game.cycle = 32;

  commitAgencyResolution(game, [{
    actorId: "TED",
    action: { type: "SEARCH" },
    status: "success",
    operations: [{ type: "find", definitionId: "cigarette", quantity: 1 }],
    provenance: { searchAttempted: true }
  }]);

  assert.equal(game.resourceEvents[0].eventId, "evt_31_1");
  assert.equal(game.resourceEvents[1].eventId, "evt_32_1");
});

test("the same mutations produce byte-identical event histories", () => {
  const runScenario = () => {
    const game = createGame(33, [cigaretteStack()]);

    commitAgencyResolution(game, [{
      actorId: "TED",
      action: { type: "SEARCH" },
      status: "success",
      operations: [{ type: "find", definitionId: "match", quantity: 2 }],
      provenance: { searchAttempted: true }
    }]);

    commitAgencyResolution(game, [{
      actorId: "TED",
      action: { type: "TRANSFER" },
      status: "success",
      operations: [{
        kind: "transfer",
        resourceId: "cigarette_stack_01",
        definitionId: "cigarette",
        quantity: 3,
        targetId: "ELLEN"
      }],
      provenance: {}
    }]);

    return game.resourceEvents;
  };

  assert.deepEqual(runScenario(), runScenario());
});

test("event ids are unique across the whole run, not just within a cycle", () => {
  const game = createGame(40);

  for (const cycle of [40, 41, 42]) {
    game.cycle = cycle;

    commitAgencyResolution(game, [{
      actorId: "TED",
      action: { type: "SEARCH" },
      status: "success",
      operations: [{ type: "find", definitionId: "cigarette", quantity: 1 }],
      provenance: { searchAttempted: true }
    }]);
  }

  const ids = game.resourceEvents.map((event) => event.eventId);

  assert.equal(new Set(ids).size, ids.length, "event ids must never repeat");
  assert.deepEqual(ids, [
    "evt_40_1",
    "evt_41_1",
    "evt_42_1"
  ]);
});

test("an unknown event kind is rejected rather than silently recorded", () => {
  const state = { cycle: 1, resourceEvents: [] };

  assert.throws(
    () => recordResourceEvent(state, { kind: "not_a_kind" }),
    /unknown kind/
  );
  assert.deepEqual(state.resourceEvents, []);
});

/* ============================================================
   G) SAVE / LOAD ROUND-TRIP
============================================================ */

test("the resource event history survives a save/load round-trip", async () => {
  const previousEvents = G.resourceEvents;
  const previousSequence = G.resourceEventSequence;
  const previousCycle = G.cycle;
  const previousResources = G.resources;
  const previousAgency = G.agency;
  const previousPending = G.pendingResourceDiscoveries;

  try {
    G.cycle = 42;
    G.resourceEvents = [];
    G.resourceEventSequence = { cycle: null, next: 1 };
    G.resources = { instances: [cigaretteStack()] };
    G.agency = createAgencyState();
    G.pendingResourceDiscoveries = [];

    commitAgencyResolution(G, [{
      actorId: "TED",
      action: { type: "SEARCH" },
      status: "success",
      operations: [{ type: "find", definitionId: "cigarette", quantity: 2 }],
      provenance: { searchAttempted: true }
    }]);

    const expected = structuredClone(G.resourceEvents);
    const expectedSequence = structuredClone(G.resourceEventSequence);

    assert.equal(expected.length, 1);

    const saved = exportState();
    const parsed = JSON.parse(saved);

    assert.equal(parsed.G.resourceEvents.length, 1);
    assert.equal(parsed.G.resourceEvents[0].eventId, "evt_42_1");

    await importState(saved);

    assert.deepEqual(G.resourceEvents, expected);
    assert.deepEqual(G.resourceEventSequence, expectedSequence);
  } finally {
    G.resourceEvents = previousEvents;
    G.resourceEventSequence = previousSequence;
    G.cycle = previousCycle;
    G.resources = previousResources;
    G.agency = previousAgency;
    G.pendingResourceDiscoveries = previousPending;
  }
});

/* ============================================================
   H) AM TRAJECTORY INJECTION
============================================================ */

test("the AM planning context injects a bounded recent resource trajectory", () => {
  const result = buildTacticPlanningContext({
    requiredTargetIds: ["TED"],
    tacticCandidatesByTarget: {
      TED: [testTactic()]
    },
    tacticRuntimeByTarget: {},
    resourceEvents: [
      {
        eventId: "evt_4_1",
        cycle: 4,
        kind: "prisoner_action",
        resourceId: "cigarette_found_4_0",
        definitionId: "cigarette",
        quantityBefore: 0,
        quantityAfter: 2,
        fromHolderId: null,
        toHolderId: "TED",
        actorId: "TED",
        cause: { phase: "agency_phase", action: "SEARCH", source: "agency_resolver" }
      }
    ],
    cycle: 5,
    simIds: ["TED"]
  });

  assert.match(result.resourceTrajectorySection, /^\[RECENT RESOURCE TRAJECTORY\]/);
  assert.match(result.resourceTrajectorySection, /Cycle 4: TED found 2 Cigarette by searching/);
});

test("the AM planning context omits the trajectory section when there is no history", () => {
  const result = buildTacticPlanningContext({
    requiredTargetIds: ["TED"],
    tacticCandidatesByTarget: {
      TED: [testTactic()]
    },
    tacticRuntimeByTarget: {},
    resourceEvents: [],
    cycle: 5,
    simIds: ["TED"]
  });

  assert.equal(result.resourceTrajectorySection, "");
});

test("the trajectory section is bounded to a fixed number of entries", () => {
  const events = Array.from({ length: 40 }, (_, index) => ({
    eventId: "evt_5_" + (index + 1),
    cycle: 5,
    kind: "prisoner_action",
    resourceId: "cigarette_" + index,
    definitionId: "cigarette",
    quantityBefore: 0,
    quantityAfter: 1,
    fromHolderId: null,
    toHolderId: "TED",
    actorId: "TED",
    cause: { phase: "agency_phase", action: "SEARCH", source: "agency_resolver" }
  }));

  const section = formatResourceTrajectory(events);
  const lines = section.split("\n").filter((line) => line.startsWith("- Cycle"));

  assert.equal(lines.length, 12);
  assert.match(lines.at(-1), /Cycle 5: TED found 1 Cigarette by searching/);
});

test("the trajectory renders an AM confiscation and a drying event", () => {
  const section = formatResourceTrajectory([
    {
      eventId: "evt_6_1",
      cycle: 6,
      kind: "am_intervention",
      resourceId: "cigarette_stack_01",
      definitionId: "cigarette",
      quantityBefore: 1,
      quantityAfter: 1,
      fromHolderId: "TED",
      toHolderId: "AM",
      actorId: "AM",
      cause: { phase: "strategy_phase", action: "CONFISCATE", source: "am_resource_intervention" }
    },
    {
      eventId: "evt_7_1",
      cycle: 7,
      kind: "drying",
      resourceId: "wet_cigarette_found_6_0",
      definitionId: "cigarette",
      quantityBefore: 1,
      quantityAfter: 1,
      fromHolderId: "ELLEN",
      toHolderId: "ELLEN",
      actorId: "ENGINE",
      cause: { phase: "ledger_maintenance", action: "DRIED", source: "wet_cigarette" }
    }
  ]);

  assert.match(section, /Cycle 6: AM confiscated 1 Cigarette from TED/);
  assert.match(section, /Cycle 7: ELLEN's Cigarette dried out and became usable/);
});

/* ============================================================
   I) EXPORTER STREAM
============================================================ */

test("the resource events stream is part of the exporter buffers", () => {
  const previousBuffer = Exporter.buffers.resource_events;
  const previousRunId = Exporter.runId;

  try {
    Exporter.runId = "ledger-event-export-test";
    Exporter.buffers.resource_events = [];

    recordResourceEvents({
      resourceEvents: [
        {
          eventId: "evt_9_1",
          cycle: 9,
          kind: "prisoner_action",
          resourceId: "cigarette_found_9_0",
          definitionId: "cigarette",
          quantityBefore: 0,
          quantityAfter: 2,
          fromHolderId: null,
          toHolderId: "TED",
          actorId: "TED",
          cause: { phase: "agency_phase", action: "SEARCH", source: "agency_resolver" }
        },
        {
          eventId: "evt_8_1",
          cycle: 8,
          kind: "drying",
          resourceId: "wet_1",
          definitionId: "cigarette",
          quantityBefore: 1,
          quantityAfter: 1,
          fromHolderId: "ELLEN",
          toHolderId: "ELLEN",
          actorId: "ENGINE",
          cause: { phase: "ledger_maintenance", action: "DRIED", source: "wet_cigarette" }
        }
      ]
    }, 9);

    assert.equal(Exporter.buffers.resource_events.length, 1);

    const [record] = Exporter.buffers.resource_events;

    assert.equal(record.event_id, "evt_9_1");
    assert.equal(record.kind, "prisoner_action");
    assert.equal(record.resource_id, "cigarette_found_9_0");
    assert.equal(record.definition_id, "cigarette");
    assert.equal(record.quantity_before, 0);
    assert.equal(record.quantity_after, 2);
    assert.equal(record.from_holder_id, null);
    assert.equal(record.to_holder_id, "TED");
    assert.equal(record.actor_id, "TED");
    assert.equal(record.cycle, 9);
    assert.deepEqual(record.cause, {
      phase: "agency_phase",
      action: "SEARCH",
      source: "agency_resolver"
    });
  } finally {
    Exporter.buffers.resource_events = previousBuffer;
    Exporter.runId = previousRunId;
  }
});

test("the exported JSON payload carries the resource event stream", async () => {
  const { finalizeCycle } = await import("../utils/exporter/aggregate.js");

  const saved = {
    runId: Exporter.runId,
    buffers: Exporter.buffers,
    runMetadata: Exporter.runMetadata,
    cycleMetadata: Exporter.cycleMetadata,
    lastCompletedCycle: Exporter.lastCompletedCycle,
    overviewHistory: Exporter.overviewHistory,
    overviewHistoryMax: Exporter.overviewHistoryMax,
    document: globalThis.document,
    createObjectURL: Object.getOwnPropertyDescriptor(URL, "createObjectURL"),
    revokeObjectURL: Object.getOwnPropertyDescriptor(URL, "revokeObjectURL")
  };

  let exportedBlob;

  try {
    Exporter.runId = "ledger-event-export-payload-test";
    Exporter.buffers = Object.fromEntries(
      Object.keys(saved.buffers).map((stream) => [stream, []])
    );
    Exporter.runMetadata = null;
    Exporter.cycleMetadata = {};
    Exporter.lastCompletedCycle = null;
    Exporter.overviewHistory = [];
    globalThis.document = {
      body: { appendChild() {}, removeChild() {} },
      createElement: () => ({ click() {} })
    };
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: (blob) => {
        exportedBlob = blob;
        return "blob:ledger-event-export-payload-test";
      }
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      writable: true,
      value: () => {}
    });

    finalizeCycle({
      ...G,
      cycle: 14,
      resourceEvents: [
        {
          eventId: "evt_14_1",
          cycle: 14,
          kind: "prisoner_action",
          resourceId: "cigarette_found_14_0",
          definitionId: "cigarette",
          quantityBefore: 0,
          quantityAfter: 2,
          fromHolderId: null,
          toHolderId: "TED",
          actorId: "TED",
          cause: { phase: "agency_phase", action: "SEARCH", source: "agency_resolver" }
        }
      ]
    }, {});

    assert.ok(exportedBlob instanceof Blob);

    const downloaded = JSON.parse(await exportedBlob.text());

    assert.equal(downloaded.streams.resource_events.length, 1);
    assert.equal(
      downloaded.streams.resource_events[0].event_id,
      "evt_14_1"
    );
    assert.equal(
      downloaded.streams.resource_events[0].kind,
      "prisoner_action"
    );
    assert.deepEqual(
      Exporter.lastCompletedCycle.streams.resource_events,
      downloaded.streams.resource_events
    );
    assert.deepEqual(Exporter.buffers.resource_events, []);
  } finally {
    Exporter.runId = saved.runId;
    Exporter.buffers = saved.buffers;
    Exporter.runMetadata = saved.runMetadata;
    Exporter.cycleMetadata = saved.cycleMetadata;
    Exporter.lastCompletedCycle = saved.lastCompletedCycle;
    Exporter.overviewHistory = saved.overviewHistory;
    Exporter.overviewHistoryMax = saved.overviewHistoryMax;
    if (saved.document === undefined) delete globalThis.document;
    else globalThis.document = saved.document;
    if (saved.createObjectURL) {
      Object.defineProperty(URL, "createObjectURL", saved.createObjectURL);
    } else {
      delete URL.createObjectURL;
    }
    if (saved.revokeObjectURL) {
      Object.defineProperty(URL, "revokeObjectURL", saved.revokeObjectURL);
    } else {
      delete URL.revokeObjectURL;
    }
  }
});
