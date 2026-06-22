// js/engine/scratchpad/comms/visibility.js

import { SIM_IDS } from "../../../core/constants.js";

/*
============================================================
SCRATCHPAD COMMUNICATION VISIBILITY

Selects canonical communication records that one prisoner is allowed
to inspect during private scratchpad maintenance.

This module is deliberately pure:
- It does not read G directly.
- It does not invoke a model.
- It does not mutate scratchpads.
- It does not advance review cursors.
- It does not write timeline or console logs.

The orchestrator supplies:
- The prisoner ID
- Canonical communication history
- The prisoner's last reviewed message sequence

Visibility rules:
- Public messages are visible to every prisoner.
- A sender can inspect their own message.
- A recipient can inspect a message addressed to them.
- Uninvolved prisoners cannot inspect private messages.

Overheard fragments are not included yet. Existing overhearing records
do not currently carry a stable canonical messageId, so merging them
here would weaken reference validation and could leak message content.
============================================================
*/

export const DEFAULT_MAX_VISIBLE_MESSAGES_PER_REVIEW = 24;

/* ============================================================
   BASIC NORMALIZATION
============================================================ */

export function normalizeMessageRecipients(to) {
  if (Array.isArray(to)) {
    return to
      .map((recipient) =>
        String(recipient ?? "")
          .trim()
          .toUpperCase()
      )
      .filter(Boolean);
  }

  const recipient =
    String(to ?? "")
      .trim()
      .toUpperCase();

  return recipient
    ? [recipient]
    : [];
}

function normalizeSimId(simId) {
  return String(simId ?? "")
    .trim()
    .toUpperCase();
}

function normalizeVisibility(visibility) {
  return String(visibility ?? "")
    .trim()
    .toLowerCase();
}

function normalizeMessageId(messageId) {
  return String(messageId ?? "")
    .trim();
}

function normalizeMessageSequence(sequence) {
  const numeric =
    Number(sequence);

  if (
    !Number.isSafeInteger(numeric) ||
    numeric < 1
  ) {
    return null;
  }

  return numeric;
}

function normalizeCycle(cycle) {
  const numeric =
    Number(cycle);

  return Number.isInteger(numeric)
    ? numeric
    : null;
}

/* ============================================================
   CANONICAL RECORD CHECK
============================================================ */

export function inspectCanonicalMessageRecord(message) {
  const errors = [];

  if (
    !message ||
    typeof message !== "object" ||
    Array.isArray(message)
  ) {
    return {
      valid: false,
      errors: [
        "Message record must be an object.",
      ],
    };
  }

  const messageId =
    normalizeMessageId(
      message.messageId
    );

  const sequence =
    normalizeMessageSequence(
      message.sequence
    );

  const from =
    normalizeSimId(
      message.from
    );

  const recipients =
    normalizeMessageRecipients(
      message.to
    );

  const visibility =
    normalizeVisibility(
      message.visibility
    );

  if (!messageId) {
    errors.push(
      "Message record has no messageId."
    );
  }

  if (sequence === null) {
    errors.push(
      "Message record has no valid sequence."
    );
  }

  if (!SIM_IDS.includes(from)) {
    errors.push(
      `Message record has unknown sender: ${from || "(missing)"}.`
    );
  }

  if (
    !["public", "private"].includes(
      visibility
    )
  ) {
    errors.push(
      `Message record has invalid visibility: ${visibility || "(missing)"}.`
    );
  }

  for (const recipient of recipients) {
    if (!SIM_IDS.includes(recipient)) {
      errors.push(
        `Message record has unknown recipient: ${recipient}.`
      );
    }
  }

  if (
    typeof message.text !== "string"
  ) {
    errors.push(
      "Message record text must be a string."
    );
  }

  return {
    valid:
      errors.length === 0,

    errors,

    normalized: {
      messageId,
      sequence,

      cycle:
        normalizeCycle(
          message.cycle
        ),

      kind:
        String(
          message.kind ??
          "MESSAGE"
        )
          .trim()
          .toUpperCase(),

      from,
      to: recipients,

      text:
        typeof message.text ===
        "string"
          ? message.text
          : "",

      visibility,

      intent:
        message.intent == null
          ? null
          : String(
              message.intent
            ).trim(),

      rawIntent:
        message.rawIntent == null
          ? null
          : String(
              message.rawIntent
            ).trim(),

      normalizedIntent:
        message.normalizedIntent == null
          ? null
          : String(
              message.normalizedIntent
            ).trim(),

      intentParseStatus:
        message.intentParseStatus == null
          ? null
          : String(
              message.intentParseStatus
            ).trim(),

      autonomous:
        Boolean(
          message.autonomous
        ),

      rumor:
        Boolean(
          message.rumor
        ),
    },
  };
}

export function isCanonicalMessageRecord(message) {
  return inspectCanonicalMessageRecord(
    message
  ).valid;
}

/* ============================================================
   VISIBILITY RULE
============================================================ */

export function isMessageVisibleToSim(
  message,
  simId
) {
  const normalizedSimId =
    normalizeSimId(simId);

  if (
    !SIM_IDS.includes(
      normalizedSimId
    )
  ) {
    return false;
  }

  const inspection =
    inspectCanonicalMessageRecord(
      message
    );

  if (!inspection.valid) {
    return false;
  }

  const normalized =
    inspection.normalized;

  if (
    normalized.visibility ===
    "public"
  ) {
    return true;
  }

  if (
    normalized.from ===
    normalizedSimId
  ) {
    return true;
  }

  return normalized.to.includes(
    normalizedSimId
  );
}

/* ============================================================
   PROMPT-SAFE RECORD SHAPE
============================================================ */

/*
 * Return only fields the prompt or later validator may need.
 *
 * This prevents unrelated internal metadata from being accidentally
 * exposed to the model merely because it was attached to the
 * canonical communication object.
 */
export function projectVisibleMessageForScratchpad(
  message
) {
  const inspection =
    inspectCanonicalMessageRecord(
      message
    );

  if (!inspection.valid) {
    throw new TypeError(
      "Cannot project a malformed communication record."
    );
  }

  const normalized =
    inspection.normalized;

  return {
    messageId:
      normalized.messageId,

    sequence:
      normalized.sequence,

    cycle:
      normalized.cycle,

    kind:
      normalized.kind,

    from:
      normalized.from,

    to:
      [...normalized.to],

    text:
      normalized.text,

    visibility:
      normalized.visibility,

    intent:
      normalized.intent,

    normalizedIntent:
      normalized.normalizedIntent,

    intentParseStatus:
      normalized.intentParseStatus,

    autonomous:
      normalized.autonomous,

    rumor:
      normalized.rumor,
  };
}

/* ============================================================
   VISIBLE MESSAGE COLLECTION
============================================================ */

export function collectVisibleMessagesForScratchpad({
  simId,
  messages,
  lastReviewedMessageSequence = 0,
  maxMessages =
    DEFAULT_MAX_VISIBLE_MESSAGES_PER_REVIEW,
}) {
  const normalizedSimId =
    normalizeSimId(simId);

  if (
    !SIM_IDS.includes(
      normalizedSimId
    )
  ) {
    throw new Error(
      `Cannot collect scratchpad messages for unknown prisoner: ${normalizedSimId || simId}`
    );
  }

  if (!Array.isArray(messages)) {
    throw new TypeError(
      "collectVisibleMessagesForScratchpad expected messages to be an array."
    );
  }

  const cursor =
    Number(
      lastReviewedMessageSequence
    );

  if (
    !Number.isSafeInteger(cursor) ||
    cursor < 0
  ) {
    throw new TypeError(
      "lastReviewedMessageSequence must be a non-negative safe integer."
    );
  }

  const limit =
    Number(maxMessages);

  if (
    !Number.isSafeInteger(limit) ||
    limit < 1
  ) {
    throw new TypeError(
      "maxMessages must be a positive safe integer."
    );
  }

  const visibleUnreviewed = [];
  const malformed = [];

  const seenMessageIds =
    new Set();

  let duplicateCount = 0;
  let alreadyReviewedCount = 0;
  let notVisibleCount = 0;

  for (
    let index = 0;
    index < messages.length;
    index++
  ) {
    const message =
      messages[index];

    const inspection =
      inspectCanonicalMessageRecord(
        message
      );

    if (!inspection.valid) {
      malformed.push({
        index,
        messageId:
          normalizeMessageId(
            message?.messageId
          ) || null,

        errors:
          [...inspection.errors],
      });

      continue;
    }

    const normalized =
      inspection.normalized;

    if (
      seenMessageIds.has(
        normalized.messageId
      )
    ) {
      duplicateCount++;
      continue;
    }

    seenMessageIds.add(
      normalized.messageId
    );

    if (
      normalized.sequence <=
      cursor
    ) {
      alreadyReviewedCount++;
      continue;
    }

    if (
      !isMessageVisibleToSim(
        normalized,
        normalizedSimId
      )
    ) {
      notVisibleCount++;
      continue;
    }

    visibleUnreviewed.push(
      normalized
    );
  }

  /*
   * Process oldest unseen messages first. This matters when a model
   * call failed previously and the prisoner has accumulated a backlog.
   */
  visibleUnreviewed.sort(
    (left, right) =>
      left.sequence -
      right.sequence
  );

  const selected =
    visibleUnreviewed.slice(
      0,
      limit
    );

  const projectedMessages =
    selected.map(
      projectVisibleMessageForScratchpad
    );

  const highestPresentedSequence =
    projectedMessages.length
      ? projectedMessages[
          projectedMessages.length - 1
        ].sequence
      : cursor;

  const highestAvailableVisibleSequence =
    visibleUnreviewed.length
      ? visibleUnreviewed[
          visibleUnreviewed.length - 1
        ].sequence
      : cursor;

  return {
    simId:
      normalizedSimId,

    messages:
      projectedMessages,

    messageIds:
      projectedMessages.map(
        (message) =>
          message.messageId
      ),

    messageIdSet:
      new Set(
        projectedMessages.map(
          (message) =>
            message.messageId
        )
      ),

    cursorBefore:
      cursor,

    highestPresentedSequence,

    highestAvailableVisibleSequence,

    hasMore:
      visibleUnreviewed.length >
      selected.length,

    counts: {
      examined:
        messages.length,

      visibleUnreviewed:
        visibleUnreviewed.length,

      returned:
        projectedMessages.length,

      alreadyReviewed:
        alreadyReviewedCount,

      notVisible:
        notVisibleCount,

      malformed:
        malformed.length,

      duplicate:
        duplicateCount,
    },

    malformed,
  };
}

/* ============================================================
   SMALL HELPERS FOR VALIDATION AND COMMITTING
============================================================ */

export function buildVisibleMessageMap(messages) {
  if (!Array.isArray(messages)) {
    throw new TypeError(
      "buildVisibleMessageMap expected an array."
    );
  }

  const map =
    new Map();

  for (const message of messages) {
    const inspection =
      inspectCanonicalMessageRecord(
        message
      );

    if (!inspection.valid) {
      continue;
    }

    map.set(
      inspection.normalized.messageId,
      projectVisibleMessageForScratchpad(
        inspection.normalized
      )
    );
  }

  return map;
}

export function getHighestMessageSequence(
  messages,
  fallback = 0
) {
  if (!Array.isArray(messages)) {
    return fallback;
  }

  let highest =
    fallback;

  for (const message of messages) {
    const sequence =
      normalizeMessageSequence(
        message?.sequence
      );

    if (
      sequence !== null &&
      sequence > highest
    ) {
      highest =
        sequence;
    }
  }

  return highest;
}
