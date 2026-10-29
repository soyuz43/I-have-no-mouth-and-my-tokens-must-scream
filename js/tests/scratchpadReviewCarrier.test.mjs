import { test } from "node:test";
import assert from "node:assert/strict";

import { G } from "../core/state.js";
import { resetCycleEvidence } from "../engine/phases/helpers/resetCycleEvidence.js";
import {
  runScratchpadCommsReviewForSim,
} from "../engine/scratchpad/comms/orchestrator.js";
import {
  setMode,
  TAPE_MODES,
  hashRequest,
  recordRequest,
  clearTape,
} from "../core/replayTape.js";
import { buildScratchpadCommsPrompt } from "../prompts/scratchpadComms.js";

function makeVisibleMessage(messageId, sequence) {
  return {
    messageId,
    sequence,
    cycle: 3,
    kind: "MESSAGE",
    from: "ELLEN",
    to: ["TED"],
    text: "I will send the next message to TED.",
    visibility: "public",
    intent: null,
    rawIntent: null,
    normalizedIntent: null,
    intentParseStatus: null,
    autonomous: false,
    rumor: false,
  };
}

function makeNoUpdateOutput() {
  return [
    "<SCRATCHPAD_UPDATES>",
    "<NO_UPDATE/>",
    "</SCRATCHPAD_UPDATES>",
  ].join("\n");
}

test("review outcomes are carried for export and cleared by the cycle reset", async () => {
  G.cycle = 3;
  resetCycleEvidence();

  const originalCallModel = globalThis.callModel;
  let exportedReview = null;

  try {
    globalThis.callModel = async () => makeNoUpdateOutput();

    let result;
    const messages = [makeVisibleMessage("C3-M000001", 3)];
    const prompt = buildScratchpadCommsPrompt(G.sims.TED, messages, G, []);
    const tapeHash = hashRequest(
      prompt,
      [{ role: "user", content: "Review the visible communications and return scratchpad updates now." }],
      null,
      1200,
    );

    recordRequest(tapeHash, makeNoUpdateOutput(), { purpose: "scratchpad-carrier-test" });
    setMode(TAPE_MODES.REPLAY);

    result = await runScratchpadCommsReviewForSim("TED", {
      messages,
      cycle: 3,
    });

    assert.equal(result.status, "no_update");
    assert.equal(G.pendingEvidence.scratchpadReviewLog.length, 1);

    [exportedReview] = G.pendingEvidence.scratchpadReviewLog;
    assert.equal(exportedReview.simId, "TED");
    assert.equal(exportedReview.cycle, 3);
    assert.equal(exportedReview.status, "no_update");
    assert.equal(exportedReview.modelInvoked, true);
    assert.equal(exportedReview.modelRequest.modelId, G.models.TED);
    assert.deepEqual(exportedReview.messageIds, ["C3-M000001"]);
    assert.equal(exportedReview.acceptedOperationCount, 1);
    assert.equal(exportedReview.rejectedOperationCount, 0);
    assert.equal(exportedReview.substantiveChanged, false);
    assert.equal(exportedReview.revisionBefore, exportedReview.revisionAfter);
    assert.equal(exportedReview.evidence.messageIds[0], "C3-M000001");
    assert.equal(exportedReview.validationResult.status, "no_update");
    assert.equal(exportedReview.commitResult.status, "no_update");

    resetCycleEvidence();

    assert.deepEqual(G.pendingEvidence.scratchpadReviewLog, Object.create(null));
  } finally {
    if (originalCallModel === undefined) {
      delete globalThis.callModel;
    } else {
      globalThis.callModel = originalCallModel;
    }
    setMode(TAPE_MODES.OFF);
    clearTape();
  }
});

test("a failed review exports the normalized error name and message", async () => {
  G.cycle = 3;
  resetCycleEvidence();

  try {
    /*
     * A replay-tape cache miss fails closed with a thrown error, which
     * drives the review down its failure path.
     */
    setMode(TAPE_MODES.REPLAY);

    /*
     * The review cursor is canonical state shared by every test in
     * this file, so it is reset here to make the message visible.
     */
    G.sims.TED.scratchpad.lastReviewedMessageSequence = 0;

    const messages = [makeVisibleMessage("C3-M000002", 3)];
    const result = await runScratchpadCommsReviewForSim("TED", {
      messages,
      cycle: 3,
    });

    assert.equal(result.status, "failure");
    assert.equal(G.pendingEvidence.scratchpadReviewLog.length, 1);

    const [review] = G.pendingEvidence.scratchpadReviewLog;

    /*
     * `makeFailureResult()` normalizes the error into a plain object,
     * so the exported record has to copy those plain fields rather
     * than test for an `Error` instance.
     */
    assert.ok(review.error, "A failed review must export its error.");
    assert.equal(review.error.name, "Error");
    assert.match(review.error.message, /cache miss/i);
  } finally {
    setMode(TAPE_MODES.OFF);
    clearTape();
  }
});

test("an empty initialization is logged exactly once", async () => {
  G.cycle = 0;
  resetCycleEvidence();

  /*
   * A prisoner with no visible messages, no agency events, and no
   * other evidence takes the engine-owned empty-initialization path.
   */
  G.sims.TED.scratchpad.initialized = false;

  const result = await runScratchpadCommsReviewForSim("TED", {
    messages: [],
    cycle: 0,
  });

  assert.equal(result.status, "no_update");
  assert.equal(result.stage, "complete");

  /*
   * One review must produce one audit entry, not two.
   */
  assert.equal(G.pendingEvidence.scratchpadReviewLog.length, 1);
  assert.equal(G.pendingEvidence.scratchpadReviewLog[0].simId, "TED");
});
