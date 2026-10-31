// js/tests/divergenceTelemetry.test.mjs
//
// Coverage for the DIVERGENCE TELEMETRY: the measurement of the
// divergence loop.
//
// THE PROBLEM THIS SOLVES
// -----------------------
// The Dual Ledger can create a divergence (a silent AM confiscation)
// and resolve one (a refused attempt corrects the belief). But
// nothing MEASURED either. The engine could not answer:
//
//   - How many divergences are active?
//   - How long do they last?
//   - How many are resolved vs. how many go stale?
//
// THIS FILE PINS DOWN
// -------------------
//   1. A newly created divergence records its onset cycle.
//   2. The export stream emits one snapshot per active divergence,
//      and the age increments on subsequent cycles.
//   3. A resolution is recorded, the metrics update, and the stream
//      reflects the resolution.
//   4. The metrics and the stream read no globals and preserve the
//      purity contract.
//
// THE BEHAVIOURS MOST LIKELY TO REGRESS SILENTLY
// ----------------------------------------------
//
//   - The onset being reported as the current cycle rather than the
//     cycle the belief and the reality actually parted. The onset
//     comes from the claim ledger, not from the clock.
//   - The age not incrementing, because the age was computed from a
//     value captured at export time rather than from the cycle.
//   - A resolution being invisible: the divergence simply vanishes
//     from the export, and the researcher cannot tell a resolution
//     apart from a divergence that was never recorded.
//   - Staleness being treated as an EVENT. A divergence does not
//     "become stale"; it gets old. Only appearance and disappearance
//     are events.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { G } from "../core/state.js";
import {
  CLAIM_DISCLOSURES,
  CLAIM_EVENT_KINDS,
  DIVERGENCE_LIFECYCLE_KINDS,
  DIVERGENCE_RECENCY_WINDOW,
  getClaimDivergenceEntries,
  getDivergenceEvents,
  getDivergenceEventsForCycle,
  getFreshClaimDivergenceEntries,
  recordBeliefCorrection,
  refreshClaimDivergence
} from "../engine/agency/claimLedger.js";
import {
  DIVERGENCE_STATUSES,
  collectDivergenceSnapshots,
  countDivergenceStates
} from "../engine/agency/divergenceTelemetry.js";
import {
  DIVERGENCE_METRIC_NAMES,
  computeDivergenceMetrics
} from "../engine/metrics/divergenceMetrics.js";
import {
  createResourceLedger,
  seedResources
} from "../engine/agency/resourceLedger.js";
import {
  commitResourceInterventions
} from "../engine/analysis/commitResourceInterventions.js";
import { finalizeCycle } from "../utils/exporter/aggregate.js";
import { Exporter } from "../utils/exporter/state.js";

/* ============================================================
   HELPERS
============================================================ */

function makeSim(id) {
  return {
    id,
    name: id,
    hope: 50,
    sanity: 50,
    suffering: 50,
    beliefs: {},
    scratchpad: {
      initialized: true,
      messageNotes: [],
      hypothesesAboutOthers: {},
      informationModel: { channels: { public: {}, private: {} } },
      predictions: [],
      questions: []
    }
  };
}

function makeState(overrides = {}) {
  return {
    cycle: 5,
    sims: {
      TED: makeSim("TED"),
      ELLEN: makeSim("ELLEN"),
      NIMDOK: makeSim("NIMDOK"),
      GORRISTER: makeSim("GORRISTER"),
      BENNY: makeSim("BENNY")
    },
    resources: createResourceLedger(),
    resourceEvents: [],
    resourceEventSequence: { cycle: null, next: 1 },
    claimEvents: [],
    claimEventSequence: { cycle: null, next: 1 },
    divergenceEvents: [],
    divergenceEventSequence: { cycle: null, next: 1 },
    claimState: {},
    claimDivergence: {},
    pendingEvidence: {
      resourceInterventions: Object.create(null),
      exposures: Object.create(null)
    },
    recentResourceDiscoveries: [],
    pendingResourceDiscoveries: [],
    ...overrides
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
 * TED's cigarettes were confiscated SILENTLY.
 *
 * The objective ledger says he holds nothing. The subjective ledger
 * says he still believes he holds three. This is the divergence.
 */
function makeDivergedState({ cycle = 5 } = {}) {
  const state = makeState({ cycle });

  state.resources.instances = [cigaretteStack()];

  seedResources(state.resources, state);

  commitResourceInterventions(state, [{
    intervention_type: "confiscate",
    resource_id: "cigarette_stack_01",
    holder_id: "TED",
    disclosure: CLAIM_DISCLOSURES.SILENT,
    rationale: "Take it without telling him."
  }]);

  return state;
}

/*
 * Resolve the divergence the way the engine does: the belief catches
 * up with the reality and the divergence closes.
 */
function resolveDivergence(state, { cycle = 5 } = {}) {
  const recorded = recordBeliefCorrection(state, {
    subjectId: "TED",
    definitionId: "cigarette",
    cycle,
    sourceEventId: `agency:${cycle}:1`,
    actorId: "TED",
    resourceId: "cigarette_stack_01"
  });

  assert.ok(recorded, "the correction must be recorded");

  refreshClaimDivergence(state);

  return recorded;
}

/* ============================================================
   A) THE ONSET CYCLE IS RECORDED
============================================================ */

test("a newly created divergence records its onset cycle", () => {
  const state = makeDivergedState({ cycle: 5 });

  const entries = getClaimDivergenceEntries(state, "TED");

  assert.equal(entries.length, 1);
  assert.equal(entries[0].onsetCycle, 5);
  assert.equal(entries[0].claimed, 3);
  assert.equal(entries[0].objective, 0);
});

test("the divergence lifecycle log records one onset for the new divergence", () => {
  const state = makeDivergedState({ cycle: 5 });

  const onsets = getDivergenceEvents(state).filter(
    (event) => event.kind === DIVERGENCE_LIFECYCLE_KINDS.ONSET
  );

  assert.equal(onsets.length, 1);

  const [onset] = onsets;

  assert.equal(onset.subjectId, "TED");
  assert.equal(onset.definitionId, "cigarette");
  assert.equal(onset.cycle, 5);
  assert.equal(onset.onsetCycle, 5);
  assert.equal(onset.claimed, 3);
  assert.equal(onset.objective, 0);
  assert.equal(onset.claimedResourceId, "cigarette_stack_01");
});

test("the onset cycle is the cycle the belief and reality parted, not the current one", () => {
  const state = makeDivergedState({ cycle: 5 });

  /*
   * The divergence is created in cycle 5. Refreshing it in a later
   * cycle must NOT move the onset forward: the belief and the
   * reality parted in cycle 5 and stayed parted.
   */
  state.cycle = 7;
  refreshClaimDivergence(state);

  const entries = getClaimDivergenceEntries(state, "TED");

  assert.equal(entries[0].onsetCycle, 5);

  /*
   * And the refresh must not produce a SECOND onset: the divergence
   * was already open, so nothing changed.
   */
  const onsets = getDivergenceEvents(state).filter(
    (event) => event.kind === DIVERGENCE_LIFECYCLE_KINDS.ONSET
  );

  assert.equal(onsets.length, 1);
});

/* ============================================================
   B) THE EXPORT STREAM
============================================================ */

test("the export stream emits one snapshot per active divergence", () => {
  const state = makeDivergedState({ cycle: 5 });

  const snapshots = collectDivergenceSnapshots(
    state.claimDivergence,
    state.divergenceEvents,
    5
  );

  assert.equal(snapshots.length, 1);

  const [snapshot] = snapshots;

  assert.equal(snapshot.cycle, 5);
  assert.equal(snapshot.simId, "TED");
  assert.equal(snapshot.resourceId, "cigarette_stack_01");
  assert.equal(snapshot.definitionId, "cigarette");
  assert.equal(snapshot.believedQuantity, 3);
  assert.equal(snapshot.objectiveQuantity, 0);
  assert.equal(snapshot.onsetCycle, 5);
  assert.equal(snapshot.age, 0);
  assert.equal(snapshot.fresh, true);
  assert.equal(snapshot.status, DIVERGENCE_STATUSES.FRESH);
});

test("the age increments on subsequent cycles", () => {
  const state = makeDivergedState({ cycle: 5 });

  for (const cycle of [5, 6, 7]) {
    const snapshots = collectDivergenceSnapshots(
      state.claimDivergence,
      state.divergenceEvents,
      cycle
    );

    assert.equal(snapshots.length, 1);
    assert.equal(snapshots[0].age, cycle - 5);
    assert.equal(snapshots[0].onsetCycle, 5);
    assert.equal(snapshots[0].cycle, cycle);
  }
});

test("a divergence ages into stale and stays reported", () => {
  const state = makeDivergedState({ cycle: 5 });

  const staleCycle = 5 + DIVERGENCE_RECENCY_WINDOW + 1;

  const snapshots = collectDivergenceSnapshots(
    state.claimDivergence,
    state.divergenceEvents,
    staleCycle
  );

  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].status, DIVERGENCE_STATUSES.STALE);
  assert.equal(snapshots[0].fresh, false);
  assert.equal(snapshots[0].age, staleCycle - 5);

  /*
   * The engine agrees that the divergence is no longer fresh. The
   * telemetry and the engine must not disagree about what "fresh"
   * means.
   */
  assert.equal(
    getFreshClaimDivergenceEntries(state, "TED", staleCycle).length,
    0
  );
});

test("the export stream is registered and writes into the export payload", async () => {
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
    revokeObjectURL: Object.getOwnPropertyDescriptor(URL, "revokeObjectURL"),
  };
  let exportedBlob;

  try {
    Exporter.runId = "divergence-export-test";
    Exporter.buffers = Object.fromEntries(
      Object.keys(saved.buffers).map((stream) => [stream, []]),
    );
    Exporter.runMetadata = null;
    Exporter.cycleMetadata = {};
    Exporter.lastCompletedCycle = null;
    Exporter.overviewHistory = [];
    globalThis.document = {
      body: { appendChild() {}, removeChild() {} },
      createElement: () => ({ click() {} }),
    };
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: (blob) => {
        exportedBlob = blob;
        return "blob:divergence-export-test";
      },
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      writable: true,
      value: () => {},
    });

    const game = {
      ...G,
      cycle: 5,
      claimDivergence: {
        TED: {
          cigarette: {
            definitionId: "cigarette",
            claimed: 3,
            objective: 0,
            delta: -3,
            onsetCycle: 5,
            claimedResourceId: "cigarette_stack_01"
          }
        }
      },
      divergenceEvents: [],
    };

    finalizeCycle(game, {});

    assert.ok(exportedBlob instanceof Blob);
    const downloaded = JSON.parse(await exportedBlob.text());

    assert.equal(downloaded.streams.claim_divergence.length, 1);

    const [record] = downloaded.streams.claim_divergence;

    assert.equal(record.cycle, 5);
    assert.equal(record.simId, "TED");
    assert.equal(record.resourceId, "cigarette_stack_01");
    assert.equal(record.definitionId, "cigarette");
    assert.equal(record.believedQuantity, 3);
    assert.equal(record.objectiveQuantity, 0);
    assert.equal(record.onsetCycle, 5);
    assert.equal(record.age, 0);
    assert.equal(record.fresh, true);
    assert.equal(record.status, DIVERGENCE_STATUSES.FRESH);

    assert.deepEqual(
      Exporter.lastCompletedCycle.streams.claim_divergence,
      downloaded.streams.claim_divergence,
    );
    assert.deepEqual(Exporter.buffers.claim_divergence, []);
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

/* ============================================================
   C) RESOLUTION
============================================================ */

test("a resolved divergence is recorded as a resolution", () => {
  const state = makeDivergedState({ cycle: 5 });

  assert.equal(getClaimDivergenceEntries(state, "TED").length, 1);

  const recorded = resolveDivergence(state);

  assert.equal(recorded.cause.kind, CLAIM_EVENT_KINDS.BELIEF_CORRECTED);

  /*
   * The divergence is closed.
   */
  assert.equal(getClaimDivergenceEntries(state, "TED").length, 0);

  const resolutions = getDivergenceEvents(state).filter(
    (event) => event.kind === DIVERGENCE_LIFECYCLE_KINDS.RESOLVED
  );

  assert.equal(resolutions.length, 1);

  const [resolution] = resolutions;

  assert.equal(resolution.subjectId, "TED");
  assert.equal(resolution.definitionId, "cigarette");
  assert.equal(resolution.cycle, 5);
  assert.equal(resolution.onsetCycle, 5);
  assert.equal(resolution.claimed, 3);
  assert.equal(resolution.objective, 0);
});

test("the metrics update when a divergence resolves", () => {
  const state = makeDivergedState({ cycle: 5 });

  const before = computeDivergenceMetrics(
    state.claimDivergence,
    state.divergenceEvents,
    5
  );

  assert.equal(before[DIVERGENCE_METRIC_NAMES.ONSETS_TOTAL], 1);
  assert.equal(before[DIVERGENCE_METRIC_NAMES.RESOLVED_TOTAL], 0);
  assert.equal(before[DIVERGENCE_METRIC_NAMES.ACTIVE_COUNT], 1);
  assert.equal(before[DIVERGENCE_METRIC_NAMES.FRESH_COUNT], 1);
  assert.equal(before[DIVERGENCE_METRIC_NAMES.STALE_COUNT], 0);

  resolveDivergence(state);

  const after = computeDivergenceMetrics(
    state.claimDivergence,
    state.divergenceEvents,
    5
  );

  assert.equal(after[DIVERGENCE_METRIC_NAMES.ONSETS_TOTAL], 1);
  assert.equal(after[DIVERGENCE_METRIC_NAMES.RESOLVED_TOTAL], 1);
  assert.equal(after[DIVERGENCE_METRIC_NAMES.ACTIVE_COUNT], 0);
  assert.equal(after[DIVERGENCE_METRIC_NAMES.FRESH_COUNT], 0);
  assert.equal(after[DIVERGENCE_METRIC_NAMES.STALE_COUNT], 0);
});

test("the export stream reflects the resolution", () => {
  const state = makeDivergedState({ cycle: 5 });

  resolveDivergence(state);

  const snapshots = collectDivergenceSnapshots(
    state.claimDivergence,
    state.divergenceEvents,
    5
  );

  /*
   * The divergence is closed, but it must still be REPORTED. Without
   * this, a resolution would be indistinguishable from a divergence
   * that was never recorded at all.
   */
  assert.equal(snapshots.length, 1);

  const [snapshot] = snapshots;

  assert.equal(snapshot.status, DIVERGENCE_STATUSES.RESOLVED);
  assert.equal(snapshot.fresh, false);
  assert.equal(snapshot.simId, "TED");
  assert.equal(snapshot.definitionId, "cigarette");
  assert.equal(snapshot.onsetCycle, 5);
  assert.equal(snapshot.age, 0);
  assert.equal(snapshot.believedQuantity, 3);
  assert.equal(snapshot.objectiveQuantity, 0);
});

test("a divergence that is open again wins over a resolution in the same cycle", () => {
  const state = makeDivergedState({ cycle: 5 });

  resolveDivergence(state);

  /*
   * The belief is wrong AGAIN in the same cycle: the divergence
   * reopened. The snapshot must describe the END of the cycle, so it
   * reports an OPEN divergence, not a resolution.
   */
  state.claimState.TED.cigarette = 3;

  refreshClaimDivergence(state);

  const snapshots = collectDivergenceSnapshots(
    state.claimDivergence,
    state.divergenceEvents,
    5
  );

  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].status, DIVERGENCE_STATUSES.FRESH);
  assert.equal(snapshots[0].believedQuantity, 3);
});

/* ============================================================
   D) THE COUNTS
============================================================ */

test("the counts partition the active set", () => {
  const state = makeDivergedState({ cycle: 5 });

  const staleCycle = 5 + DIVERGENCE_RECENCY_WINDOW + 1;

  const counts = countDivergenceStates(
    state.claimDivergence,
    state.divergenceEvents,
    staleCycle
  );

  assert.equal(counts.active, 1);
  assert.equal(counts.fresh, 0);
  assert.equal(counts.stale, 1);
  assert.equal(counts.fresh + counts.stale, counts.active);

  const freshCounts = countDivergenceStates(
    state.claimDivergence,
    state.divergenceEvents,
    5
  );

  assert.equal(freshCounts.active, 1);
  assert.equal(freshCounts.fresh, 1);
  assert.equal(freshCounts.stale, 0);
});

test("the totals are cumulative over the run and the counts are instantaneous", () => {
  const state = makeDivergedState({ cycle: 5 });

  /*
   * The divergence ages out of the recency window but is never
   * resolved: it is still open, and it is stale.
   */
  const staleCycle = 5 + DIVERGENCE_RECENCY_WINDOW + 1;

  const metrics = computeDivergenceMetrics(
    state.claimDivergence,
    state.divergenceEvents,
    staleCycle
  );

  assert.equal(metrics[DIVERGENCE_METRIC_NAMES.ONSETS_TOTAL], 1);
  assert.equal(metrics[DIVERGENCE_METRIC_NAMES.RESOLVED_TOTAL], 0);
  assert.equal(metrics[DIVERGENCE_METRIC_NAMES.ACTIVE_COUNT], 1);
  assert.equal(metrics[DIVERGENCE_METRIC_NAMES.FRESH_COUNT], 0);
  assert.equal(metrics[DIVERGENCE_METRIC_NAMES.STALE_COUNT], 1);
});

test("the divergence metrics are written into the global export stream", async () => {
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
    revokeObjectURL: Object.getOwnPropertyDescriptor(URL, "revokeObjectURL"),
  };
  let exportedBlob;

  try {
    Exporter.runId = "divergence-metrics-test";
    Exporter.buffers = Object.fromEntries(
      Object.keys(saved.buffers).map((stream) => [stream, []]),
    );
    Exporter.runMetadata = null;
    Exporter.cycleMetadata = {};
    Exporter.lastCompletedCycle = null;
    Exporter.overviewHistory = [];
    globalThis.document = {
      body: { appendChild() {}, removeChild() {} },
      createElement: () => ({ click() {} }),
    };
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: (blob) => {
        exportedBlob = blob;
        return "blob:divergence-metrics-test";
      },
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      writable: true,
      value: () => {},
    });

    const game = {
      ...G,
      cycle: 5,
      claimDivergence: {
        TED: {
          cigarette: {
            definitionId: "cigarette",
            claimed: 3,
            objective: 0,
            delta: -3,
            onsetCycle: 5,
            claimedResourceId: "cigarette_stack_01"
          }
        }
      },
      divergenceEvents: [
        {
          eventId: "dvg_5_1",
          cycle: 5,
          kind: DIVERGENCE_LIFECYCLE_KINDS.ONSET,
          subjectId: "TED",
          definitionId: "cigarette",
          onsetCycle: 5,
          claimed: 3,
          objective: 0,
          claimedResourceId: "cigarette_stack_01"
        }
      ],
    };

    finalizeCycle(game, {});

    assert.ok(exportedBlob instanceof Blob);
    const downloaded = JSON.parse(await exportedBlob.text());

    const [global] = downloaded.streams.global;

    assert.equal(global.divergence_onsets_total, 1);
    assert.equal(global.divergence_resolved_total, 0);
    assert.equal(global.divergence_active_count, 1);
    assert.equal(global.divergence_fresh_count, 1);
    assert.equal(global.divergence_stale_count, 0);
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

/* ============================================================
   E) PURITY
============================================================ */

test("the telemetry and metrics modules do not import the global state", () => {
  /*
   * The purity contract is enforced by the module graph, not by
   * convention: if either module reached for `G`, it would have to
   * import it, and this would fail.
   */
  const telemetrySource = readFileSync(
    new URL("../engine/agency/divergenceTelemetry.js", import.meta.url),
    "utf8"
  );
  const metricsSource = readFileSync(
    new URL("../engine/metrics/divergenceMetrics.js", import.meta.url),
    "utf8"
  );

  for (const source of [telemetrySource, metricsSource]) {
    assert.doesNotMatch(
      source,
      /core\/state\.js/,
      "the divergence telemetry must not import the global state"
    );
    assert.doesNotMatch(
      source,
      /[^A-Za-z]G\./,
      "the divergence telemetry must not read the global state"
    );
  }
});

test("the metrics and the snapshots do not mutate their arguments", () => {
  const state = makeDivergedState({ cycle: 5 });

  const divergenceBefore = JSON.stringify(state.claimDivergence);
  const eventsBefore = JSON.stringify(state.divergenceEvents);

  computeDivergenceMetrics(
    state.claimDivergence,
    state.divergenceEvents,
    5
  );

  collectDivergenceSnapshots(
    state.claimDivergence,
    state.divergenceEvents,
    5
  );

  assert.equal(JSON.stringify(state.claimDivergence), divergenceBefore);
  assert.equal(JSON.stringify(state.divergenceEvents), eventsBefore);
});

test("the same arguments always produce the same metrics and snapshots", () => {
  const state = makeDivergedState({ cycle: 5 });

  const first = computeDivergenceMetrics(
    state.claimDivergence,
    state.divergenceEvents,
    5
  );
  const second = computeDivergenceMetrics(
    state.claimDivergence,
    state.divergenceEvents,
    5
  );

  assert.deepEqual(first, second);

  const snapshotsA = collectDivergenceSnapshots(
    state.claimDivergence,
    state.divergenceEvents,
    5
  );
  const snapshotsB = collectDivergenceSnapshots(
    state.claimDivergence,
    state.divergenceEvents,
    5
  );

  assert.deepEqual(snapshotsA, snapshotsB);
});

test("the telemetry is deterministic across identical runs", () => {
  const first = makeDivergedState({ cycle: 5 });
  const second = makeDivergedState({ cycle: 5 });

  assert.deepEqual(
    collectDivergenceSnapshots(
      first.claimDivergence,
      first.divergenceEvents,
      5
    ),
    collectDivergenceSnapshots(
      second.claimDivergence,
      second.divergenceEvents,
      5
    )
  );

  assert.deepEqual(
    computeDivergenceMetrics(
      first.claimDivergence,
      first.divergenceEvents,
      5
    ),
    computeDivergenceMetrics(
      second.claimDivergence,
      second.divergenceEvents,
      5
    )
  );

  /*
   * The lifecycle LOG is deterministic too: the same run produces the
   * same events, with the same ids, in the same order.
   */
  assert.deepEqual(
    getDivergenceEvents(first),
    getDivergenceEvents(second)
  );
});

test("an empty or malformed divergence state produces empty telemetry", () => {
  assert.deepEqual(
    collectDivergenceSnapshots(null, null, 5),
    []
  );

  assert.deepEqual(
    collectDivergenceSnapshots({}, undefined, 5),
    []
  );

  const counts = countDivergenceStates(null, null, 5);

  assert.equal(counts.active, 0);
  assert.equal(counts.fresh, 0);
  assert.equal(counts.stale, 0);
  assert.equal(counts.onsets, 0);
  assert.equal(counts.resolutions, 0);
});

test("the divergence events are filtered by cycle", () => {
  const state = makeDivergedState({ cycle: 5 });

  resolveDivergence(state);

  assert.equal(getDivergenceEventsForCycle(state, 5).length, 2);
  assert.equal(getDivergenceEventsForCycle(state, 6).length, 0);
});

test("the divergence lifecycle log survives a save and load round trip", () => {
  const state = makeDivergedState({ cycle: 5 });

  resolveDivergence(state);

  const before = getDivergenceEvents(state);

  /*
   * The lifecycle log is engine-owned run state, exactly like the
   * claim and goal event logs, so it has to survive a round trip
   * through the save envelope.
   */
  const restored = JSON.parse(JSON.stringify({
    divergenceEvents: state.divergenceEvents,
    divergenceEventSequence: state.divergenceEventSequence,
  }));

  state.divergenceEvents = restored.divergenceEvents;
  state.divergenceEventSequence = restored.divergenceEventSequence;

  assert.deepEqual(getDivergenceEvents(state), before);
  assert.equal(state.divergenceEvents.length, 2);
  assert.equal(state.divergenceEventSequence.next, 3);
});
