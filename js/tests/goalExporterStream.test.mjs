import { test } from "node:test";
import assert from "node:assert/strict";

import { G } from "../core/state.js";
import { finalizeCycle } from "../utils/exporter/aggregate.js";
import { Exporter } from "../utils/exporter/state.js";

function makeGoalEvents() {
  return [
    {
      eventId: "goal_4_1",
      cycle: 4,
      kind: "initialize",
      actorId: "TED",
      goalId: "endure",
      progress: 0,
      startedCycle: 4,
      terminalCycle: null,
      terminalReason: null,
      evidenceEventIds: [],
    },
    {
      eventId: "goal_4_2",
      cycle: 4,
      kind: "continue",
      actorId: "ELLEN",
      goalId: "observe_am",
      progress: 1,
      startedCycle: 2,
      terminalCycle: null,
      terminalReason: null,
      evidenceEventIds: ["agency:4:2"],
    },
    {
      eventId: "goal_3_1",
      cycle: 3,
      kind: "complete",
      actorId: "NIMDOK",
    },
  ];
}

test("finalizeCycle exports canonical goal lifecycle events", async () => {
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
    Exporter.runId = "goal-export-test";
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
        return "blob:goal-export-test";
      },
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      writable: true,
      value: () => {},
    });

    const game = {
      ...G,
      cycle: 4,
      goalEvents: makeGoalEvents(),
    };

    finalizeCycle(game, {});

    assert.ok(exportedBlob instanceof Blob);
    const downloaded = JSON.parse(await exportedBlob.text());

    assert.equal(downloaded.streams.goal_events.length, 2);
    assert.equal(downloaded.streams.goal_events[0].event_id, "goal_4_1");
    assert.equal(downloaded.streams.goal_events[0].kind, "initialize");
    assert.equal(downloaded.streams.goal_events[1].event_id, "goal_4_2");
    assert.equal(downloaded.streams.goal_events[1].kind, "continue");
    assert.deepEqual(
      Exporter.lastCompletedCycle.streams.goal_events,
      downloaded.streams.goal_events,
    );
    assert.deepEqual(Exporter.buffers.goal_events, []);
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
