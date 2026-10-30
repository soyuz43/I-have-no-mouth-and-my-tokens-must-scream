import { test } from "node:test";
import assert from "node:assert/strict";

import { G } from "../core/state.js";
import {
  finalizeCycle,
  exportBootCycleReviews,
} from "../utils/exporter/aggregate.js";
import {
  ensureExporterState,
  Exporter,
} from "../utils/exporter/state.js";

function makeReviewLog() {
  return [
    {
      simId: "TED",
      cycle: 3,
      status: "committed",
      stage: "complete",
      reason: null,
      modelInvoked: true,
      modelId: "test-model",
      modelRequest: {
        purpose: "SCRATCHPAD_COMMS",
        maxTokens: 1200,
        messageCount: 1,
      },
      visibleMessageCount: 1,
      messageIds: ["C3-M000001"],
      cursorBefore: 2,
      cursorAfter: 3,
      parsedOperationCount: 1,
      acceptedOperationCount: 1,
      rejectedOperationCount: 1,
      substantiveChanged: true,
      revisionBefore: 4,
      revisionAfter: 5,
      changedPaths: ["messageNotes"],
      operationReports: [{ type: "note", changed: true, path: "messageNotes" }],
      acceptedOperations: [{ type: "note" }],
      rejectedOperations: [{ type: "question", reasons: ["evidence"] }],
      evidence: { cursorBefore: 2, messageIds: ["C3-M000001"], messageIdSet: new Set(["C3-M000001"]) },
      repairResult: { status: "clean" },
      parsedResult: { status: "success", operations: [{ tag: "NOTE" }] },
      validationResult: { status: "partial", accepted: [{ type: "note" }], rejected: [{ type: "question" }] },
      commitResult: { committed: true, changedPaths: ["messageNotes"] },
      durationMs: 123.4,
      error: null,
    },
    {
      simId: "ELLEN",
      cycle: 2,
      status: "skipped",
    },
  ];
}

test("finalizeCycle exports the per-cycle scratchpad review audit", async () => {
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
    Exporter.runId = "scratchpad-export-test";
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
        return "blob:scratchpad-export-test";
      },
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      writable: true,
      value: () => {},
    });

    const game = {
      ...G,
      cycle: 3,
      pendingEvidence: {
        ...G.pendingEvidence,
        scratchpadReviewLog: makeReviewLog(),
      },
    };

    finalizeCycle(game, {});

    assert.ok(exportedBlob instanceof Blob);
    const downloaded = JSON.parse(await exportedBlob.text());
    const [record] = downloaded.streams.scratchpad;

    assert.equal(downloaded.streams.scratchpad.length, 1);
    assert.equal(record.sim_id, "TED");
    assert.equal(record.status, "committed");
    assert.equal(record.model_invoked, true);
    assert.equal(record.model_id, "test-model");
    assert.deepEqual(record.evidence_message_ids, ["C3-M000001"]);
    assert.equal(record.parsed_operation_count, 1);
    assert.equal(record.accepted_operation_count, 1);
    assert.equal(record.rejected_operation_count, 1);
    assert.equal(record.revision_before, 4);
    assert.equal(record.revision_after, 5);
    assert.deepEqual(record.changed_paths, ["messageNotes"]);
    assert.equal(record.accepted_operations.length, 1);
    assert.equal(record.rejected_operations.length, 1);
    assert.equal(record.validation_result.status, "partial");
    assert.equal(record.commit_result.committed, true);
    assert.equal(record.duration_ms, 123.4);
    assert.deepEqual(record.evidence, { cursorBefore: 2, messageIds: ["C3-M000001"] });
    assert.deepEqual(
      Exporter.lastCompletedCycle.streams.scratchpad,
      downloaded.streams.scratchpad,
    );
    assert.deepEqual(Exporter.buffers.scratchpad, []);
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

test("the boot cycle exports its review records before the next reset clears them", async () => {
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
    Exporter.runId = "boot-cycle-export-test";
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
        return "blob:boot-cycle-export-test";
      },
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      writable: true,
      value: () => {},
    });

    const bootReviewLog = makeReviewLog().filter(
      (review) => review.cycle === 0,
    );
    bootReviewLog[0] = {
      ...bootReviewLog[0],
      cycle: 0,
      simId: "TED",
    };

    const game = {
      ...G,
      cycle: 0,
      pendingEvidence: {
        ...G.pendingEvidence,
        scratchpadReviewLog: bootReviewLog,
      },
    };

    /*
     * The boot path never runs finalizeCycle(), so its review records
     * would otherwise be cleared by the next cycle reset without ever
     * reaching an export file.
     */
    assert.equal(exportBootCycleReviews(game), true);

    const downloaded = JSON.parse(await exportedBlob.text());

    assert.equal(downloaded.cycle, 0);
    assert.equal(downloaded.streams.scratchpad.length, 1);
    assert.equal(downloaded.streams.scratchpad[0].cycle, 0);
    assert.equal(downloaded.streams.scratchpad[0].sim_id, "TED");

    /*
     * The exported records must not be written into a later cycle's
     * file as well.
     */
    assert.deepEqual(Exporter.buffers.scratchpad, []);
    assert.deepEqual(game.pendingEvidence.scratchpadReviewLog, []);
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

test("a boot cycle export failure does not abort the boot path", async () => {
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

  try {
    Exporter.runId = "boot-cycle-export-failure-test";
    Exporter.buffers = Object.fromEntries(
      Object.keys(saved.buffers).map((stream) => [stream, []]),
    );
    Exporter.runMetadata = null;
    Exporter.cycleMetadata = {};
    Exporter.lastCompletedCycle = null;
    Exporter.overviewHistory = [];

    const game = {
      ...G,
      cycle: 0,
      pendingEvidence: {
        ...G.pendingEvidence,
        scratchpadReviewLog: [
          {
            ...makeReviewLog()[0],
            cycle: 0,
            simId: "TED",
          },
        ],
      },
    };

    URL.createObjectURL = () => {
      throw new Error("export download unavailable");
    };

    assert.equal(exportBootCycleReviews(game), true);
    assert.deepEqual(game.pendingEvidence.scratchpadReviewLog, []);
  } finally {
    Exporter.runId = saved.runId;
    Exporter.buffers = saved.buffers;
    Exporter.runMetadata = saved.runMetadata;
    Exporter.cycleMetadata = saved.cycleMetadata;
    Exporter.lastCompletedCycle = saved.lastCompletedCycle;
    Exporter.overviewHistory = saved.overviewHistory;
    Exporter.overviewHistoryMax = saved.overviewHistoryMax;
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

test("exporter normalization restores every canonical buffer", () => {
  const exporter = ensureExporterState({});

  for (const key of Object.keys(Exporter.buffers)) {
    assert.ok(Array.isArray(exporter.buffers[key]));
  }
});
