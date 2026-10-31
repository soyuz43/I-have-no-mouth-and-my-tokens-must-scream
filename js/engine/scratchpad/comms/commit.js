// js/engine/scratchpad/comms/commit.js

import { G } from "../../../core/state.js";
import { SIM_IDS } from "../../../core/constants.js";

import {
  buildVisibleMessageMap,
  getHighestMessageSequence,
} from "./visibility.js";

import {
  buildVisibleOverhearingEventMap,
} from "./overhearingEvidence.js";

import {
  buildVisibleAgencyEventMap,
} from "./agencyEvidence.js";

import {
  getAgencyEventsForReview,
} from "../../agency/events.js";

import {
  generatePhysicalStateUpdate,
} from "../physicalState.js";

import {
  getClaimQuantity,
} from "../../agency/claimLedger.js";

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

/*
 * The agency events a prisoner may review in a given cycle.
 *
 * This is the review trigger's own scoping, applied here so a
 * standalone commit resolves exactly the events the review prompt
 * showed. The review cycle is the cycle the commit belongs to, and
 * the trigger shows the PREVIOUS cycle's events.
 */
function resolveReviewAgencyEvents(
  events,
  simId,
  cycle
) {
  if (!Array.isArray(events)) {
    return [];
  }

  if (!Number.isSafeInteger(cycle)) {
    return [];
  }

  return getAgencyEventsForReview(
    events,
    simId,
    cycle
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

  /*
   * physicalLimitations is an optional engine-owned array. It is not
   * required for a scratchpad to be valid (legacy and test scratchpads
   * may omit it), but when present it must be an array so the
   * deterministic commit path can treat it uniformly.
   */
  if (
    scratchpad.physicalLimitations !== undefined &&
    !Array.isArray(scratchpad.physicalLimitations)
  ) {
    throw new TypeError(
      simId + ".scratchpad.physicalLimitations must be an array when present."
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

  /*
   * resourceBeliefs is an OPTIONAL engine-owned collection of
   * beliefs about a PEER's holdings, formed from that peer's own
   * testimony. It is optional because a scratchpad written before
   * the RESOURCE_CLAIM operation existed does not have one, and such
   * a scratchpad is still valid.
   *
   * It is NOT part of the subjective ledger. It never appears in
   * `claimState`, never produces a divergence, and never grants
   * permission to act.
   */
  if (
    scratchpad.resourceBeliefs !== undefined &&
    (
      !scratchpad.resourceBeliefs ||
      typeof scratchpad.resourceBeliefs !== "object" ||
      Array.isArray(scratchpad.resourceBeliefs)
    )
  ) {
    throw new TypeError(
      simId + ".scratchpad.resourceBeliefs must be an object when present."
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
  eventMap,
  agencyEventMap,
  changedPaths,
}) {
  const message =
    messageMap.get(
      operation.messageId
    );

  const event =
    !message && eventMap
      ? eventMap.get(
          operation.messageId
        )
      : null;

  const agencyEvent =
    !message &&
    !event &&
    agencyEventMap
      ? agencyEventMap.get(
          operation.messageId
        )
      : null;

  if (
    !message &&
    !event &&
    !agencyEvent
  ) {
    throw new Error(
      "Validated NOTE references unavailable message, overhearing event, " +
      "or agency event " +
        String(operation.messageId) +
        "."
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
        "messageNotes[" + existingIndex + "]",
      reason:
        "message_note_already_exists",
    };
  }

  /*
   * When the note cites an overhearing event (a conversation the
   * prisoner perceived but did not receive as a canonical message),
   * project a canonical record from the event so the note shape stays
   * stable. perceivedText is null for "observed_only" events, which is
   * correct: the prisoner may record that a conversation occurred
   * without quoting words they never heard.
   *
   * When the note cites an agency event (an engine-resolved action
   * outcome the prisoner experienced), the record describes the
   * ACTION rather than a conversation: the actor is the prisoner
   * themselves, and the channel marks it as an experienced outcome
   * rather than something that was said to them.
   */
  const source = message
    ? {
        messageId: message.messageId,
        sequence: message.sequence,
        cycle: message.cycle,
        from: message.from,
        to: [...message.to],
        visibility: message.visibility,
        kind: message.kind,
        intent:
          message.normalizedIntent ??
          message.intent ??
          null,
      }
    : event
      ? {
          messageId: event.eventId,
          sequence: event.sequence,
          cycle: event.cycle,
          from: event.participants.from,
          to: [event.participants.to],
          visibility: "overheard",
          kind: event.sourceKind || "MESSAGE",
          intent: null,
        }
      : {
          messageId: agencyEvent.eventId,
          sequence: agencyEvent.actionSequence,
          cycle: agencyEvent.cycle,
          from: agencyEvent.actorId,
          to: agencyEvent.targetId
            ? [agencyEvent.targetId]
            : [],
          visibility: "agency",
          kind: agencyEvent.actionType || "ACTION",
          intent: null,
        };

  const note = {
    messageId: source.messageId,
    sequence: source.sequence,
    cycle: source.cycle,
    speaker: source.from,
    recipients: [...source.to],
    channel: source.visibility,
    kind: source.kind,
    intent: source.intent,
    sourceEventId:
      event && !message
        ? event.eventId
        : agencyEvent && !message && !event
          ? agencyEvent.eventId
          : null,
    note: operation.text,
    confidence: operation.confidence,
  };

  scratchpad.messageNotes.push(note);

  const path =
    "messageNotes[" +
    (scratchpad.messageNotes.length - 1) + "]";

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
   QUESTION IDENTITY MATCHING (RESOLVED-AGNOSTIC)
   ------------------------------------------------------------
   Like isSameOpenQuestion but does NOT require the question to
   be unresolved. Used to detect a resolved-but-present question
   (still in unresolvedQuestions, resolved === true) so a
   QUESTION_RESOLVE can report question_already_resolved instead
   of a generic not-found. Does not affect open-question duplicate
   detection, which keeps using isSameOpenQuestion.
============================================================ */

function isSameQuestionIdentity(
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
      operation.text.toLowerCase()
  );
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

  const currentQuestions =
    scratchpad.unresolvedQuestions || [];

  const archivedQuestions =
    Array.isArray(scratchpad.archivedQuestions)
      ? scratchpad.archivedQuestions
      : [];

  const maxQuestionId =
    currentQuestions
      .concat(archivedQuestions)
      .reduce(
        (max, entry) =>
          Math.max(
            max,
            entry?.id || 0
          ),
        0
      );

  const nextQuestionId =
    maxQuestionId + 1;

  const question = {
    id:
      nextQuestionId,

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
   QUESTION RESOLUTION COMMITTING
   ------------------------------------------------------------
   Content-addressed RESOLVE. Locates the target via the same
   question-identity matcher used for duplicate detection
   (about + lowercased text), preserving every existing field
   (id, evidence, subject, priority, creation metadata). Sets only
   resolved / resolution / resolvedCycle. No-op when the target is
   already resolved or no matching unresolved question exists.
============================================================ */

function applyQuestionResolveOperation({
  scratchpad,
  operation,
  cycle,
  changedPaths,
  preBatchUnresolvedQuestions = [],
}) {
  if (
    !Array.isArray(
      scratchpad.unresolvedQuestions
    )
  ) {
    return {
      changed: false,
      path: null,
      reason:
        "no_unresolved_questions_collection",
    };
  }

  // Lifecycle routing for QUESTION_RESOLVE.
  // (1) Resolve only when an OPEN question existed in the pre-batch
  //     snapshot. The snapshot is captured before the clone
  //     (currentScratchpad.unresolvedQuestions), so a QUESTION
  //     created earlier in this same batch cannot satisfy it.
  const openPreBatchIndex =
    Array.isArray(preBatchUnresolvedQuestions)
      ? preBatchUnresolvedQuestions.findIndex(
          (existing) =>
            isSameOpenQuestion(
              existing,
              operation
            )
        )
      : -1;

  if (openPreBatchIndex >= 0) {
    const existingIndex =
      scratchpad.unresolvedQuestions.findIndex(
        (existing) =>
          isSameOpenQuestion(
            existing,
            operation
          )
      );

    if (existingIndex < 0) {
      return {
        changed: false,
        path: null,
        reason:
          "question_resolve_target_not_found",
      };
    }

    const existing =
      scratchpad.unresolvedQuestions[
        existingIndex
      ];

    if (existing.resolved === true) {
      return {
        changed: false,
        path:
          `unresolvedQuestions[${existingIndex}]`,
        reason:
          "question_already_resolved",
      };
    }

    existing.resolved = true;
    existing.resolution =
      normalizeText(operation.resolution);
    existing.resolvedCycle = cycle;

    const path =
      `unresolvedQuestions[${existingIndex}]`;

    changedPaths.push(path);

    return {
      changed: true,
      path,
    };
  }

  // (2) No open pre-batch question. If the SAME BATCH created an open
  //     question (a QUESTION earlier in this batch), block it with an
  //     explicit not-prebatch reason rather than a generic not-found.
  const openPostBatchIndex =
    scratchpad.unresolvedQuestions.findIndex(
      (existing) =>
        isSameOpenQuestion(
          existing,
          operation
        )
    );

  if (openPostBatchIndex >= 0) {
    return {
      changed: false,
      path: null,
      reason:
        "question_resolve_target_not_prebatch",
    };
  }

  // (3) No open question anywhere. If a matching question identity is
  //     present but already resolved (either in the pre-batch
  //     snapshot or still lingering in unresolvedQuestions), report
  //     already-resolved without overwriting it.
  const resolvedPresent =
    (Array.isArray(preBatchUnresolvedQuestions) &&
      preBatchUnresolvedQuestions.some(
        (existing) =>
          isSameQuestionIdentity(
            existing,
            operation
          ) &&
          existing.resolved === true
      )) ||
    scratchpad.unresolvedQuestions.some(
      (existing) =>
        isSameQuestionIdentity(
          existing,
          operation
        ) &&
        existing.resolved === true
    );

  if (resolvedPresent) {
    return {
      changed: false,
      path: null,
      reason:
        "question_already_resolved",
    };
  }

  // (4) No matching question identity exists at all.
  return {
    changed: false,
    path: null,
    reason:
      "question_resolve_target_not_found",
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
    existing.resolved !== true &&
    existing.expired !== true
  );
}

function isSamePredictionResolveIdentity(
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
    existing.withinCycles ===
      operation.withinCycles
  );
}

function applyPredictionResolveOperation({
  scratchpad,
  operation,
  cycle,
  changedPaths,
  preBatchPredictions = [],
}) {
  const preBatchTarget =
    Array.isArray(preBatchPredictions)
      ? preBatchPredictions.find(
          (existing) =>
            isSamePredictionResolveIdentity(
              existing,
              operation
            )
        )
      : null;

  if (!preBatchTarget) {
    const postBatchIndex =
      scratchpad.predictions.findIndex(
        (existing) =>
          isSamePredictionResolveIdentity(
            existing,
            operation
          )
      );

    return {
      changed: false,
      path: null,
      reason:
        postBatchIndex >= 0
          ? "prediction_resolve_target_not_prebatch"
          : "prediction_resolve_target_not_found",
    };
  }

  if (preBatchTarget.resolved === true) {
    return {
      changed: false,
      path: null,
      reason:
        "prediction_already_resolved",
    };
  }

  const targetId = preBatchTarget.id;
  const existingIndex =
    scratchpad.predictions.findIndex(
      (existing) =>
        existing?.id === targetId
    );

  if (existingIndex < 0) {
    return {
      changed: false,
      path: null,
      reason:
        "prediction_resolve_target_not_found",
    };
  }

  const existing =
    scratchpad.predictions[existingIndex];

  if (existing.resolved === true) {
    return {
      changed: false,
      path:
        `predictions[${existingIndex}]`,
      reason:
        "prediction_already_resolved",
    };
  }

  existing.resolved = true;
  existing.outcome = operation.outcome;
  existing.resolutionRationale =
    operation.rationale;
  existing.resultEvidence =
    [...operation.refs];
  existing.resolvedCycle = cycle;

  const path =
    `predictions[${existingIndex}]`;

  changedPaths.push(path);

  return {
    changed: true,
    path,
  };
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

  const currentPredictions =
    scratchpad.predictions || [];

  const archivedPredictions =
    Array.isArray(scratchpad.archivedPredictions)
      ? scratchpad.archivedPredictions
      : [];

  const maxPredictionId =
    currentPredictions
      .concat(archivedPredictions)
      .reduce(
        (max, entry) =>
          Math.max(
            max,
            entry?.id || 0
          ),
        0
      );

  const nextPredictionId =
    maxPredictionId + 1;

  const prediction = {
    id:
      nextPredictionId,

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

    resultEvidence:
      [],

    resolutionRationale:
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

/* ============================================================
   RESOURCE CLAIM COMMITTING
   ------------------------------------------------------------
   A prisoner states what they personally hold, and the listener
   forms a belief about the speaker's holdings.

   THE CLAMP
   --------
   The claimed quantity is reduced to what the SPEAKER themselves
   believe they hold. The clamp reads the speaker's SUBJECTIVE
   belief (`getClaimQuantity`), never the objective quantity
   (`getObjectiveQuantity`).

   This is the whole point of the mechanism. A speaker may overstate
   their holdings to bluff, bargain, or deceive, but never beyond
   what they believe to be true. A speaker whose OWN belief has
   diverged from reality transmits that diverged belief, which is
   exactly the behavior the dual ledger exists to produce.

   Clamping to the objective truth instead would turn speech into a
   truth oracle: only a speaker who knows the truth could testify,
   and every belief formed from testimony would be a fact rather than
   a belief.

   The clamp reads the UNFILTERED belief. The fresh-scoped readers
   (`getBelievedResourceIds`) would silence a speaker whose belief
   has gone dormant, and the filtered `believed` map would erase a
   speaker claiming zero of something.

   WHERE IT IS WRITTEN
   ------------------
   It is written to the OPTIONAL `resourceBeliefs` collection on the
   scratchpad. It is NEVER written to `claimState`, `claimEvents`, or
   `claimDivergence`.

   That separation is load-bearing. `claimState` is egocentric: it
   records what a prisoner believes they PERSONALLY hold. Writing a
   peer's holdings there would not record "ELLEN believes TED has 3
   cigarettes"; it would record "ELLEN believes SHE holds 3
   cigarettes", which manufactures a false divergence naming TED's
   stack and licenses ELLEN to reach for a resource she does not
   hold.
 ============================================================ */

function applyResourceClaimOperation({
  scratchpad,
  operation,
  cycle,
  changedPaths,
}) {
  const about =
    String(
      operation.about ?? ""
    ).trim();

  const definition =
    String(
      operation.definition ?? ""
    ).trim();

  const requestedQuantity =
    Number(operation.quantity);

  /*
   * The SPEAKER's own belief. This is the clamp source, and it is
   * the only truth source this operation is allowed to consult.
   */
  const speakerQuantity =
    getClaimQuantity(
      G,
      about,
      definition
    );

  const effectiveQuantity =
    Math.max(
      0,
      Math.min(
        Number.isFinite(requestedQuantity)
          ? requestedQuantity
          : 0,
        speakerQuantity
      )
    );

  const clamped =
    effectiveQuantity !== requestedQuantity;

  if (!scratchpad.resourceBeliefs ||
      typeof scratchpad.resourceBeliefs !== "object") {
    scratchpad.resourceBeliefs = {};
  }

  if (!scratchpad.resourceBeliefs[about] ||
      typeof scratchpad.resourceBeliefs[about] !== "object") {
    scratchpad.resourceBeliefs[about] = {};
  }

  const belief = {
    quantity: effectiveQuantity,
    confidence: Number.isFinite(Number(operation.confidence))
      ? Number(operation.confidence)
      : 0,
    evidence: [...(operation.refs ?? [])],
    sourceId: operation.refs?.[0] ?? null,
    updatedCycle: cycle
  };

  scratchpad.resourceBeliefs[about][definition] = belief;

  const path =
    `resourceBeliefs.` +
    `${about}.` +
    `${definition}`;

  changedPaths.push(path);

  return {
    changed: true,
    path,
    reason: clamped
      ? "resource_claim_clamped"
      : null,
    requestedQuantity,
    effectiveQuantity,
    clamped
  };
}

function applyOperation({
  scratchpad,
  operation,
  eventMap,
  agencyEventMap,
  messageMap,
  cycle,
  changedPaths,
  preBatchUnresolvedQuestions,
  preBatchPredictions,
}) {
  switch (operation.type) {
    case "note":
      return applyNoteOperation({
        scratchpad,
        operation,
        messageMap,
        eventMap,
        agencyEventMap,
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

    case "question_resolve":
      return applyQuestionResolveOperation({
        scratchpad,
        operation,
        cycle,
        changedPaths,
        preBatchUnresolvedQuestions,
      });

    case "prediction":
      return applyPredictionOperation({
        scratchpad,
        operation,
        cycle,
        changedPaths,
      });

    case "prediction_resolve":
      return applyPredictionResolveOperation({
        scratchpad,
        operation,
        cycle,
        changedPaths,
        preBatchPredictions,
      });

    case "channel":
      return applyChannelOperation({
        scratchpad,
        operation,
        changedPaths,
      });

    case "resource_claim":
      return applyResourceClaimOperation({
        scratchpad,
        operation,
        cycle,
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
  visibleAgencyEventMap = null,
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

    /*
     * Admissible overhearing events for this prisoner, used only by
     * NOTE operations that cite an eventId rather than a messageId.
     */
    const eventMap = buildVisibleOverhearingEventMap(
      G && G.overhearing && typeof G.overhearing === "object"
        ? G.overhearing
        : null,
      normalizedSimId
    );

    /*
     * Admissible agency events for this prisoner, used only by NOTE
     * operations that cite an agency event ID rather than a messageId
     * or an overheard event ID.
     *
     * The orchestrator passes the map it validated against, so the
     * commit resolves exactly the set of events the model was allowed
     * to cite. When it passes nothing, the map is re-derived from
     * G.agency.events so the commit remains usable standalone.
     *
     * The fallback applies the SAME prior-cycle scoping the review
     * trigger uses (getAgencyEventsForReview), so a standalone commit
     * cannot resolve an event the model was never shown.
     */
    const agencyEventMap =
      visibleAgencyEventMap instanceof Map &&
      visibleAgencyEventMap.size > 0
        ? visibleAgencyEventMap
        : buildVisibleAgencyEventMap(
            resolveReviewAgencyEvents(
              G.agency?.events,
              normalizedSimId,
              cycle
            ),
            normalizedSimId
          );

    const currentScratchpad =
      sim.scratchpad;

    const preBatchUnresolvedQuestions =
      Array.isArray(
        currentScratchpad.unresolvedQuestions
      )
        ? currentScratchpad.unresolvedQuestions
        : [];

    const preBatchPredictions =
      Array.isArray(currentScratchpad.predictions)
        ? currentScratchpad.predictions
        : [];

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
          eventMap,
          agencyEventMap,
          messageMap,
          cycle,
          changedPaths,
          preBatchUnresolvedQuestions,
          preBatchPredictions,
        });

      if (result.changed) {
        appliedOperationCount++;
      } else {
        noOpOperationCount++;
      }

      const report = {
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
      };

      /*
       * The CLAMP is reported so the export shows that a claim was
       * reduced to the speaker's own belief. Without it, a stored
       * quantity that differs from what the speaker said would be
       * indistinguishable from a stored quantity they actually
       * said.
       *
       * These fields are added ONLY for the operation that clamps.
       * Every other operation's report keeps the shape it has
       * always had, because the report is consumed by tests and by
       * the export as a stable record.
       */
      if (operation.type === "resource_claim") {
        report.requestedQuantity =
          result.requestedQuantity ?? null;

        report.effectiveQuantity =
          result.effectiveQuantity ?? null;

        report.clamped =
          Boolean(result.clamped);
      }

      operationReports.push(report);
    }

    /*
     * Engine-owned physical-limitation awareness.
     *
     * Deterministic, read-only bridge from the Agency Phase's derived
     * capability bands to the scratchpad. This is NOT a model
     * judgement: it records objectively impaired posture (e.g. bound
     * hands) as fact so the prisoner prompt reflects physical reality.
     * Read-only on G.agency; the only write below is to the local
     * nextScratchpad clone, which is atomically swapped in later.
     */
    {
      const agencyCapabilities =
        G &&
        G.agency &&
        G.agency.capabilities &&
        typeof G.agency.capabilities === "object"
          ? G.agency.capabilities[normalizedSimId]
          : null;

      const nextLimitations =
        generatePhysicalStateUpdate(
          sim,
          agencyCapabilities
        );

      const currentLimitations =
        Array.isArray(
          currentScratchpad.physicalLimitations
        )
          ? currentScratchpad.physicalLimitations
          : [];

      const limitationsChanged =
        currentLimitations.length !==
          nextLimitations.length ||
        nextLimitations.some(
          (token) => !currentLimitations.includes(token)
        );

      nextScratchpad.physicalLimitations =
        [...nextLimitations];

      if (limitationsChanged) {
        changedPaths.push("physicalLimitations");
      }
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
