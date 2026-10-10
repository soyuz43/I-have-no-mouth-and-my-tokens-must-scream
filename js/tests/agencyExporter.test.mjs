import { test } from "node:test";
import assert from "node:assert/strict";

import { G } from "../core/state.js";
import { createAgencyState } from "../engine/agency/state/createAgencyState.js";
import { finalizeCycle } from "../utils/exporter/aggregate.js";
import { Exporter } from "../utils/exporter/state.js";

test("finalizeCycle records canonical agency events in the exported JSON stream", async () => {
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
  const event = {
    eventId: "agency:14:1",
    cycle: 14,
    actorId: "TED",
    actionType: "TRANSFER",
    status: "success",
    provenance: {
      source: "agency_resolver",
      targetId: "ELLEN",
      resourceIds: ["cigarette-1"],
    },
  };
  let exportedBlob;

  try {
    Exporter.runId = "agency-export-test";
    Exporter.buffers = Object.fromEntries(
      Object.keys(saved.buffers).map((stream) => [stream, []]),
    );
    Exporter.runMetadata = null;
    Exporter.cycleMetadata = {};
    Exporter.lastCompletedCycle = null;
    Exporter.overviewHistory = [];
    globalThis.document = {
      body: {
        appendChild() {},
        removeChild() {},
      },
      createElement: () => ({ click() {} }),
    };
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: (blob) => {
        exportedBlob = blob;
        return "blob:agency-export-test";
      },
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      writable: true,
      value: () => {},
    });

    const game = {
      ...G,
      cycle: 14,
      agency: {
        ...createAgencyState(),
        events: [
          event,
          { ...event, eventId: "agency:13:1", cycle: 13 },
        ],
      },
    };

    finalizeCycle(game, {});

    assert.ok(exportedBlob instanceof Blob);
    const downloaded = JSON.parse(await exportedBlob.text());
    const [record] = downloaded.streams.agency_events;

    assert.equal(downloaded.streams.agency_events.length, 1);
    assert.equal(record.event_id, event.eventId);
    assert.equal(record.actor_id, "TED");
    assert.equal(record.action_type, "TRANSFER");
    assert.equal(record.status, "success");
    assert.deepEqual(record.provenance, event.provenance);
    assert.deepEqual(
      Exporter.lastCompletedCycle.streams.agency_events,
      downloaded.streams.agency_events,
    );
    assert.deepEqual(Exporter.buffers.agency_events, []);
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
