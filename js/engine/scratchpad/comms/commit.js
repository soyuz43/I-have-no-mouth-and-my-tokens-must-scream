// js/engine/scratchpad/comms/commit.js

import { G } from "../../../core/state.js";
import { SIM_IDS } from "../../../core/constants.js";

import {
  buildVisibleMessageMap,
  getHighestMessageSequence,
} from "./visibility.js";

/*
============================================================
SCRATCHPAD COMMUNICATION COMMIT LAYER

Applies validated scratchpad communication operations atomically.

This is the only scratchpad-comms module allowed to mutate:

  G.sims[simId].scratchpad

Commit sequence:
1. Validate the commit inputs.
2. Clone the current scratchpad.
3. Apply every accepted operation to the clone.
4. Update review and revision metadata.
5. Replace the original scratchpad only after all work succeeds.

A failure before step 5 leaves persistent state untouched.

Revision behavior:
- Substantive state changes increment revision once per review.
- NO_UPDATE advances review metadata without incrementing revision.
- Duplicate/no-op accepted operations advance review metadata but do
  not increment revision.
- Failed validation or commit does not advance the review cursor.
============================================================
*/

/* ============================================================
   BASIC HELPERS
============================================================ */

function normalizeSimId(simId) {
  return String(simId ?? "")
    .trim()
    .toUpperCase();
}

function cloneValue(value) {
  if (
    typeof structuredClone ===
    "function"
  ) {
    try {
      return structuredClone(value);
    } catch {
      // Fall through to JSON cloning.
    }
  }

  return JSON.parse(
    JSON.stringify(value)
  );
}

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueStrings(values) {
  return [
    ...new Set(
      Array.isArray(values)
        ? values
            .map((value) =>
              String(value ?? "").trim()
            )
            .filter(Boolean)
        : []
    ),
  ];
}

function valuesEqual(left, right) {
  try {
    return (
      JSON.stringify(left) ===
      JSON.stringify(right)
    );
  } catch {
    return left === right;
  }
}

function makeCommitError(error) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack ?? null,
    };
  }

  return {
    name: "Error",
    message: String(error),
    stack: null,
  };
}

function assertCycle(cycle) {
  if (
    !Number.isSafeInteger(cycle) ||
    cycle < 0
  ) {
    throw new TypeError(
      "Scratchpad commit cycle must be a non-negative safe integer."
    );
  }
}

/* ============================================================
   INPUT RESOLUTION
============================================================ */

function resolveEvidenceMessages(evidence) {
  if (Array.isArray(evidence)) {
    return evidence;
  }

  if (
    evidence &&
    Array.isArray(
      evidence.messages
    )
  ) {
    return evidence.messages;
  }

  throw new TypeError(
    "commitScratchpadCommsOperations expected evidence or evidence.messages to be an array."
  );
}

function assertScratchpadShape(
  scratchpad,
  simId
) {
  if (
    !scratchpad ||
    typeof scratchpad !== "object" ||
    Array.isArray(scratchpad)
  ) {
    throw new TypeError(
      `${simId} has no valid scratchpad object.`
    );
  }

  if (
    !Array.isArray(
      scratchpad.messageNotes
    )
  ) {
    throw new TypeError(
      `${simId}.scratchpad.messageNotes must be an array.`
    );
  }

  if (
    !scratchpad.hypothesesAboutOthers ||
    typeof scratchpad
      .hypothesesAboutOthers !==
      "object"
  ) {
    throw new TypeError(
      `${simId}.scratchpad.hypothesesAboutOthers must be an object.`
    );
  }

  if (
    !scratchpad.informationModel ||
    typeof scratchpad
      .informationModel !==
      "object" ||
    !scratchpad
      .informationModel
      .channels
  ) {
    throw new TypeError(
      `${simId}.scratchpad.informationModel.channels is missing.`
    );
  }

  if (
    !Array.isArray(
      scratchpad.predictions
    )
  ) {
    throw new TypeError(
      `${simId}.scratchpad.predictions must be an array.`
    );
  }

  if (
    !Array.isArray(
      scratchpad.unresolvedQuestions
    )
  ) {
    throw new TypeError(
      `${simId}.scratchpad.unresolvedQuestions must be an array.`
    );
  }
}

function resolveAcceptedOperations(
  validationResult
) {
  if (
    !validationResult ||
    typeof validationResult !== "object"
  ) {
    throw new TypeError(
      "Scratchpad validation result is missing or invalid."
    );
  }

  const allowedStatuses =
    new Set([
      "success",
      "partial",
      "no_update",
    ]);

  if (
    !allowedStatuses.has(
      validationResult.status
    )
  ) {
    throw new Error(
      `Scratchpad validation result is not committable: ${validationResult.status ?? "unknown"}.`
    );
  }

  if (
    !Array.isArray(
      validationResult.accepted
    )
  ) {
    throw new TypeError(
      "Scratchpad validation result has no accepted-operation array."
    );
  }

  if (
    validationResult
      .accepted
      .length === 0
  ) {
    throw new Error(
      "Scratchpad validation result contains no accepted operations."
    );
  }

  const noUpdateOperations =
    validationResult.accepted.filter(
      (operation) =>
        operation?.type ===
        "no_update"
    );

  const substantiveOperations =
    validationResult.accepted.filter(
      (operation) =>
        operation?.type !==
        "no_update"
    );

  if (
    noUpdateOperations.length > 1
  ) {
    throw new Error(
      "Scratchpad commit received multiple NO_UPDATE operations."
    );
  }

  if (
    noUpdateOperations.length > 0 &&
    substantiveOperations.length > 0
  ) {
    throw new Error(
      "Scratchpad commit cannot mix NO_UPDATE with substantive operations."
    );
  }

  return [
    ...validationResult.accepted,
  ];
}

/* ============================================================
   EPISTEMIC CLAIM HELPERS
============================================================ */

function makeEpistemicClaim({
  value,
  confidence,
  evidence,
  rationale = null,
}) {
  return {
    value,

    confidence,

    evidence:
      uniqueStrings(evidence),

    rationale:
      rationale == null
        ? null
        : normalizeText(rationale),
  };
}

function setEpistemicClaim({
  container,
  field,
  claim,
  path,
  changedPaths,
}) {
  if (
    !container ||
    typeof container !== "object"
  ) {
    throw new TypeError(
      `Cannot write epistemic claim at ${path}.`
    );
  }

  if (
    valuesEqual(
      container[field],
      claim
    )
  ) {
    return false;
  }

  container[field] =
    claim;

  changedPaths.push(path);

  return true;
}

/* ============================================================
   NOTE COMMITTING
============================================================ */

function applyNoteOperation({
  scratchpad,
  operation,
  messageMap,
  changedPaths,
}) {
  const message =
    messageMap.get(
      operation.messageId
    );

  if (!message) {
    throw new Error(
      `Validated NOTE references unavailable message ${operation.messageId}.`
    );
  }

  const existingIndex =
    scratchpad.messageNotes.findIndex(
      (note) =>
        note?.messageId ===
        operation.messageId
    );

  /*
   * A canonical message should receive at most one note through this
   * review pipeline. Replayed accepted operations therefore become
   * harmless no-ops instead of duplicate memory entries.
   */
  if (existingIndex >= 0) {
    return {
      changed: false,
      path:
        `messageNotes[${existingIndex}]`,
      reason:
        "message_note_already_exists",
    };
  }

  const note = {
    messageId:
      message.messageId,

    sequence:
      message.sequence,

    cycle:
      message.cycle,

    speaker:
      message.from,

    recipients:
      [...message.to],

    channel:
      message.visibility,

    kind:
      message.kind,

    intent:
      message.normalizedIntent ??
      message.intent ??
      null,

    note:
      operation.text,

    confidence:
      operation.confidence,
  };

  scratchpad.messageNotes.push(
    note
  );

  const path =
    `messageNotes[` +
    `${scratchpad.messageNotes.length - 1}]`;

  changedPaths.push(path);

  return {
    changed: true,
    path,
  };
}

/* ============================================================
   OTHER-PRISONER MODEL COMMITTING
============================================================ */

function resolveOtherPrisonerModel({
  scratchpad,
  target,
}) {
  const model =
    scratchpad
      .hypothesesAboutOthers
      ?.[target];

  if (
    !model ||
    typeof model !== "object"
  ) {
    throw new Error(
      `Scratchpad has no hypothesesAboutOthers model for ${target}.`
    );
  }

  return model;
}

function applyOtherOperation({
  scratchpad,
  operation,
  changedPaths,
}) {
  const model =
    resolveOtherPrisonerModel({
      scratchpad,
      target:
        operation.target,
    });

  const claim =
    makeEpistemicClaim({
      value:
        operation.value,

      confidence:
        operation.confidence,

      evidence:
        operation.refs,
    });

  const path =
    `hypothesesAboutOthers.` +
    `${operation.target}.` +
    `${operation.field}`;

  const changed =
    setEpistemicClaim({
      container:
        model,

      field:
        operation.field,

      claim,
      path,
      changedPaths,
    });

  return {
    changed,
    path,
  };
}

function applyScoreOperation({
  scratchpad,
  operation,
  changedPaths,
}) {
  const model =
    resolveOtherPrisonerModel({
      scratchpad,
      target:
        operation.target,
    });

  const claim =
    makeEpistemicClaim({
      value:
        operation.value,

      confidence:
        operation.confidence,

      evidence:
        operation.refs,

      rationale:
        operation.reason,
    });

  const path =
    `hypothesesAboutOthers.` +
    `${operation.target}.` +
    `${operation.field}`;

  const changed =
    setEpistemicClaim({
      container:
        model,

      field:
        operation.field,

      claim,
      path,
      changedPaths,
    });

  return {
    changed,
    path,
  };
}

/* ============================================================
   QUESTION COMMITTING
============================================================ */

function isSameOpenQuestion(
  existing,
  operation
) {
  if (
    !existing ||
    typeof existing !== "object"
  ) {
    return false;
  }

  const existingText =
    normalizeText(
      existing.question ??
      existing.text
    ).toLowerCase();

  return (
    String(
      existing.about ?? ""
    ).toUpperCase() ===
      operation.about &&
    existingText ===
      operation.text.toLowerCase() &&
    existing.resolved !== true
  );
}

function applyQuestionOperation({
  scratchpad,
  operation,
  cycle,
  changedPaths,
}) {
  const existingIndex =
    scratchpad
      .unresolvedQuestions
      .findIndex(
        (existing) =>
          isSameOpenQuestion(
            existing,
            operation
          )
      );

  if (existingIndex >= 0) {
    return {
      changed: false,

      path:
        `unresolvedQuestions[` +
        `${existingIndex}]`,

      reason:
        "question_already_exists",
    };
  }

  const question = {
    about:
      operation.about,

    question:
      operation.text,

    priority:
      operation.priority,

    evidence:
      uniqueStrings(
        operation.refs
      ),

    createdCycle:
      cycle,

    resolved:
      false,

    resolution:
      null,

    resolvedCycle:
      null,
  };

  scratchpad
    .unresolvedQuestions
    .push(question);

  const path =
    `unresolvedQuestions[` +
    `${scratchpad.unresolvedQuestions.length - 1}]`;

  changedPaths.push(path);

  return {
    changed: true,
    path,
  };
}

/* ============================================================
   PREDICTION COMMITTING
============================================================ */

function isSameOpenPrediction(
  existing,
  operation
) {
  if (
    !existing ||
    typeof existing !== "object"
  ) {
    return false;
  }

  const existingText =
    normalizeText(
      existing.prediction ??
      existing.text
    ).toLowerCase();

  return (
    String(
      existing.about ?? ""
    ).toUpperCase() ===
      operation.about &&
    existingText ===
      operation.text.toLowerCase() &&
    existing.resolved !== true
  );
}

function applyPredictionOperation({
  scratchpad,
  operation,
  cycle,
  changedPaths,
}) {
  const existingIndex =
    scratchpad.predictions.findIndex(
      (existing) =>
        isSameOpenPrediction(
          existing,
          operation
        )
    );

  if (existingIndex >= 0) {
    return {
      changed: false,

      path:
        `predictions[` +
        `${existingIndex}]`,

      reason:
        "prediction_already_exists",
    };
  }

  const prediction = {
    about:
      operation.about,

    prediction:
      operation.text,

    confidence:
      operation.confidence,

    evidence:
      uniqueStrings(
        operation.refs
      ),

    createdCycle:
      cycle,

    withinCycles:
      operation.withinCycles,

    evaluateByCycle:
      cycle +
      operation.withinCycles,

    resolved:
      false,

    outcome:
      null,

    resolvedCycle:
      null,
  };

  scratchpad.predictions.push(
    prediction
  );

  const path =
    `predictions[` +
    `${scratchpad.predictions.length - 1}]`;

  changedPaths.push(path);

  return {
    changed: true,
    path,
  };
}

/* ============================================================
   CHANNEL-MODEL COMMITTING
============================================================ */

function applyChannelOperation({
  scratchpad,
  operation,
  changedPaths,
}) {
  const channelModel =
    scratchpad
      .informationModel
      ?.channels
      ?.[operation.channel];

  if (
    !channelModel ||
    typeof channelModel !== "object"
  ) {
    throw new Error(
      `Scratchpad has no information-model channel named ${operation.channel}.`
    );
  }

  const claim =
    makeEpistemicClaim({
      value:
        operation.value,

      confidence:
        operation.confidence,

      evidence:
        operation.refs,

      rationale:
        operation.reason,
    });

  const path =
    `informationModel.channels.` +
    `${operation.channel}.` +
    `${operation.field}`;

  const changed =
    setEpistemicClaim({
      container:
        channelModel,

      field:
        operation.field,

      claim,
      path,
      changedPaths,
    });

  return {
    changed,
    path,
  };
}

/* ============================================================
   OPERATION DISPATCH
============================================================ */

function applyOperation({
  scratchpad,
  operation,
  messageMap,
  cycle,
  changedPaths,
}) {
  switch (operation.type) {
    case "note":
      return applyNoteOperation({
        scratchpad,
        operation,
        messageMap,
        changedPaths,
      });

    case "other":
      return applyOtherOperation({
        scratchpad,
        operation,
        changedPaths,
      });

    case "score":
      return applyScoreOperation({
        scratchpad,
        operation,
        changedPaths,
      });

    case "question":
      return applyQuestionOperation({
        scratchpad,
        operation,
        cycle,
        changedPaths,
      });

    case "prediction":
      return applyPredictionOperation({
        scratchpad,
        operation,
        cycle,
        changedPaths,
      });

    case "channel":
      return applyChannelOperation({
        scratchpad,
        operation,
        changedPaths,
      });

    case "no_update":
      return {
        changed: false,
        path: null,
        reason: "no_update",
      };

    default:
      throw new Error(
        `No commit handler exists for scratchpad operation type: ${operation.type ?? "unknown"}.`
      );
  }
}

/* ============================================================
   MAIN COMMIT FUNCTION
============================================================ */

export function commitScratchpadCommsOperations({
  simId,
  validationResult,
  evidence,
  cycle = G.cycle,
}) {
  const normalizedSimId =
    normalizeSimId(simId);

  const revisionBefore =
    G.sims
      ?.[normalizedSimId]
      ?.scratchpad
      ?.revision ?? null;

  const cursorBefore =
    G.sims
      ?.[normalizedSimId]
      ?.scratchpad
      ?.lastReviewedMessageSequence ?? null;

  try {
    if (
      !SIM_IDS.includes(
        normalizedSimId
      )
    ) {
      throw new Error(
        `Cannot commit scratchpad operations for unknown prisoner: ${normalizedSimId || simId}`
      );
    }

    assertCycle(cycle);

    const sim =
      G.sims?.[normalizedSimId];

    if (!sim) {
      throw new Error(
        `Simulation state has no prisoner named ${normalizedSimId}.`
      );
    }

    assertScratchpadShape(
      sim.scratchpad,
      normalizedSimId
    );

    const acceptedOperations =
      resolveAcceptedOperations(
        validationResult
      );

    const evidenceMessages =
      resolveEvidenceMessages(
        evidence
      );

    const messageMap =
      buildVisibleMessageMap(
        evidenceMessages
      );

    const currentScratchpad =
      sim.scratchpad;

    const nextScratchpad =
      cloneValue(
        currentScratchpad
      );

    assertScratchpadShape(
      nextScratchpad,
      normalizedSimId
    );

    const currentCursor =
      Number.isSafeInteger(
        currentScratchpad
          .lastReviewedMessageSequence
      )
        ? currentScratchpad
            .lastReviewedMessageSequence
        : 0;

    const highestPresentedSequence =
      getHighestMessageSequence(
        evidenceMessages,
        currentCursor
      );

    if (
      highestPresentedSequence <
      currentCursor
    ) {
      throw new Error(
        "Scratchpad review cursor cannot move backwards."
      );
    }

    const changedPaths = [];
    const operationReports = [];

    let appliedOperationCount = 0;
    let noOpOperationCount = 0;

    for (
      const operation of
      acceptedOperations
    ) {
      const result =
        applyOperation({
          scratchpad:
            nextScratchpad,

          operation,
          messageMap,
          cycle,
          changedPaths,
        });

      if (result.changed) {
        appliedOperationCount++;
      } else {
        noOpOperationCount++;
      }

      operationReports.push({
        type:
          operation.type,

        tag:
          operation.tag,

        changed:
          result.changed,

        path:
          result.path ?? null,

        reason:
          result.reason ?? null,
      });
    }

    const substantiveChanged =
      changedPaths.length > 0;

    const initializedBefore =
      Boolean(
        currentScratchpad.initialized
      );

    const revisionNumber =
      Number.isSafeInteger(
        currentScratchpad.revision
      )
        ? currentScratchpad.revision
        : 0;

    nextScratchpad.initialized =
      true;

    nextScratchpad
      .lastCommunicationReviewCycle =
      cycle;

    nextScratchpad
      .lastReviewedMessageSequence =
      highestPresentedSequence;

    if (substantiveChanged) {
      nextScratchpad.revision =
        revisionNumber + 1;

      nextScratchpad.lastUpdatedCycle =
        cycle;
    } else {
      nextScratchpad.revision =
        revisionNumber;
    }

    /*
     * Atomic replacement point. No persistent state has been mutated
     * before this assignment.
     */
    sim.scratchpad =
      nextScratchpad;

    return {
      status:
        substantiveChanged
          ? "committed"
          : validationResult.status ===
              "no_update"
            ? "no_update"
            : "reviewed_no_change",

      committed: true,

      simId:
        normalizedSimId,

      cycle,

      validationStatus:
        validationResult.status,

      initializedBefore,

      initializedAfter:
        true,

      substantiveChanged,

      revisionBefore:
        revisionNumber,

      revisionAfter:
        nextScratchpad.revision,

      cursorBefore:
        currentCursor,

      cursorAfter:
        highestPresentedSequence,

      reviewCycleBefore:
        currentScratchpad
          .lastCommunicationReviewCycle ??
        null,

      reviewCycleAfter:
        cycle,

      acceptedOperationCount:
        acceptedOperations.length,

      appliedOperationCount,

      noOpOperationCount,

      rejectedOperationCount:
        Array.isArray(
          validationResult.rejected
        )
          ? validationResult
              .rejected
              .length
          : 0,

      changedPaths:
        [...changedPaths],

      operationReports,

      error: null,
    };
  } catch (error) {
    return {
      status:
        "failure",

      committed:
        false,

      simId:
        normalizedSimId ||
        String(simId ?? ""),

      cycle:
        Number.isSafeInteger(cycle)
          ? cycle
          : null,

      validationStatus:
        validationResult?.status ??
        null,

      initializedBefore:
        G.sims
          ?.[normalizedSimId]
          ?.scratchpad
          ?.initialized ?? null,

      initializedAfter:
        G.sims
          ?.[normalizedSimId]
          ?.scratchpad
          ?.initialized ?? null,

      substantiveChanged:
        false,

      revisionBefore,

      revisionAfter:
        G.sims
          ?.[normalizedSimId]
          ?.scratchpad
          ?.revision ?? null,

      cursorBefore,

      cursorAfter:
        G.sims
          ?.[normalizedSimId]
          ?.scratchpad
          ?.lastReviewedMessageSequence ??
        null,

      reviewCycleBefore:
        G.sims
          ?.[normalizedSimId]
          ?.scratchpad
          ?.lastCommunicationReviewCycle ??
        null,

      reviewCycleAfter:
        G.sims
          ?.[normalizedSimId]
          ?.scratchpad
          ?.lastCommunicationReviewCycle ??
        null,

      acceptedOperationCount:
        Array.isArray(
          validationResult?.accepted
        )
          ? validationResult
              .accepted
              .length
          : 0,

      appliedOperationCount: 0,
      noOpOperationCount: 0,

      rejectedOperationCount:
        Array.isArray(
          validationResult?.rejected
        )
          ? validationResult
              .rejected
              .length
          : 0,

      changedPaths: [],
      operationReports: [],

      error:
        makeCommitError(error),
    };
  }
}

/* ============================================================
   CONVENIENCE HELPERS
============================================================ */

export function didScratchpadCommitSucceed(
  commitResult
) {
  return Boolean(
    commitResult?.committed
  );
}

export function didScratchpadContentChange(
  commitResult
) {
  return Boolean(
    commitResult
      ?.substantiveChanged
  );
}