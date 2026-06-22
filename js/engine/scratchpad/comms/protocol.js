// js/engine/scratchpad/comms/protocol.js

import { SIM_IDS } from "../../../core/constants.js";

/*
============================================================
SCRATCHPAD COMMUNICATION PROTOCOL

Single source of truth for the sparse XML-like operation protocol.

Used by:
- The scratchpad communication prompt
- Output repair
- Output parsing
- Operation validation
- Scratchpad committing

This module contains protocol definitions only.
It does not parse model output or mutate simulation state.
============================================================
*/

export const SCRATCHPAD_COMMS_PROTOCOL_VERSION = 1;

export const SCRATCHPAD_UPDATES_WRAPPER =
  "SCRATCHPAD_UPDATES";

export const MAX_SCRATCHPAD_OPERATIONS = 10;

export const MAX_SCRATCHPAD_OPERATION_TEXT_LENGTH = 800;

export const MIN_PREDICTION_HORIZON = 1;
export const MAX_PREDICTION_HORIZON = 12;

export const CONFIDENCE_RANGE = Object.freeze({
  min: 0,
  max: 1,
});

export const SCORE_VALUE_RANGE = Object.freeze({
  min: 0,
  max: 1,
});

/* ============================================================
   OPERATION TAGS
============================================================ */

export const SCRATCHPAD_OPERATION_TAGS = Object.freeze([
  "NOTE",
  "OTHER",
  "SCORE",
  "QUESTION",
  "PREDICTION",
  "CHANNEL",
  "NO_UPDATE",
]);

/* ============================================================
   ALLOWED VALUES
============================================================ */

export const SCRATCHPAD_OTHER_FIELDS = Object.freeze([
  "perceivedGoal",
  "perceivedViewOfMe",
]);

export const SCRATCHPAD_SCORE_FIELDS = Object.freeze([
  "perceivedTrustInMe",
  "perceivedThreatFromMe",
  "predictability",
]);

export const SCRATCHPAD_QUESTION_PRIORITIES =
  Object.freeze([
    "low",
    "medium",
    "high",
  ]);

export const SCRATCHPAD_CHANNELS = Object.freeze([
  "public",
  "private",
]);

export const SCRATCHPAD_CHANNEL_FIELDS =
  Object.freeze({
    public: Object.freeze([
      "visibleToAM",
      "visibleToOtherPrisoners",
      "canBeAlteredByAM",
      "canBeDelayedOrSuppressed",
    ]),

    private: Object.freeze([
      "visibleToAM",
      "visibleToNonRecipients",
      "canBeAlteredByAM",
      "canBeDelayedOrSuppressed",
    ]),
  });

export const SCRATCHPAD_BOOLEAN_VALUES =
  Object.freeze([
    "true",
    "false",
  ]);

export const SCRATCHPAD_TARGET_IDS =
  Object.freeze([
    ...SIM_IDS,
  ]);

export const SCRATCHPAD_SUBJECTS =
  Object.freeze([
    "AM",
    "GROUP",
    "PUBLIC_CHANNEL",
    "PRIVATE_CHANNEL",
    ...SIM_IDS,
  ]);

/* ============================================================
   OPERATION DEFINITIONS

   requiredAttributes:
   Attributes that must exist for the operation to be valid.

   optionalAttributes:
   Attributes permitted but not required.

   referenceAttribute:
   Attribute containing one or more canonical message IDs.

   textRequired:
   Whether meaningful text must appear between the tags.
============================================================ */

export const SCRATCHPAD_OPERATION_DEFINITIONS =
  Object.freeze({
    NOTE: Object.freeze({
      type: "note",

      requiredAttributes: Object.freeze([
        "ref",
        "confidence",
      ]),

      optionalAttributes: Object.freeze([]),

      referenceAttribute: "ref",
      textRequired: true,
    }),

    OTHER: Object.freeze({
      type: "other",

      requiredAttributes: Object.freeze([
        "target",
        "field",
        "confidence",
        "refs",
      ]),

      optionalAttributes: Object.freeze([]),

      referenceAttribute: "refs",
      textRequired: true,
    }),

    SCORE: Object.freeze({
      type: "score",

      requiredAttributes: Object.freeze([
        "target",
        "field",
        "value",
        "confidence",
        "refs",
      ]),

      optionalAttributes: Object.freeze([]),

      referenceAttribute: "refs",
      textRequired: true,
    }),

    QUESTION: Object.freeze({
      type: "question",

      requiredAttributes: Object.freeze([
        "about",
        "priority",
        "refs",
      ]),

      optionalAttributes: Object.freeze([]),

      referenceAttribute: "refs",
      textRequired: true,
    }),

    PREDICTION: Object.freeze({
      type: "prediction",

      requiredAttributes: Object.freeze([
        "about",
        "confidence",
        "withinCycles",
        "refs",
      ]),

      optionalAttributes: Object.freeze([]),

      referenceAttribute: "refs",
      textRequired: true,
    }),

    CHANNEL: Object.freeze({
      type: "channel",

      requiredAttributes: Object.freeze([
        "channel",
        "field",
        "value",
        "confidence",
        "refs",
      ]),

      optionalAttributes: Object.freeze([]),

      referenceAttribute: "refs",
      textRequired: true,
    }),

    NO_UPDATE: Object.freeze({
      type: "no_update",

      requiredAttributes: Object.freeze([]),
      optionalAttributes: Object.freeze([]),

      referenceAttribute: null,
      textRequired: false,
    }),
  });

/* ============================================================
   LOOKUP HELPERS
============================================================ */

export function normalizeScratchpadOperationTag(tag) {
  return String(tag ?? "")
    .trim()
    .toUpperCase();
}

export function getScratchpadOperationDefinition(tag) {
  const normalizedTag =
    normalizeScratchpadOperationTag(tag);

  return (
    SCRATCHPAD_OPERATION_DEFINITIONS[
      normalizedTag
    ] ?? null
  );
}

export function isKnownScratchpadOperationTag(tag) {
  return Boolean(
    getScratchpadOperationDefinition(tag)
  );
}

export function getAllowedAttributesForTag(tag) {
  const definition =
    getScratchpadOperationDefinition(tag);

  if (!definition) {
    return [];
  }

  return [
    ...definition.requiredAttributes,
    ...definition.optionalAttributes,
  ];
}

export function isAllowedScratchpadTarget(value) {
  return SCRATCHPAD_TARGET_IDS.includes(
    String(value ?? "").trim().toUpperCase()
  );
}

export function isAllowedScratchpadSubject(value) {
  return SCRATCHPAD_SUBJECTS.includes(
    String(value ?? "").trim().toUpperCase()
  );
}

export function isAllowedOtherField(value) {
  return SCRATCHPAD_OTHER_FIELDS.includes(
    String(value ?? "").trim()
  );
}

export function isAllowedScoreField(value) {
  return SCRATCHPAD_SCORE_FIELDS.includes(
    String(value ?? "").trim()
  );
}

export function isAllowedQuestionPriority(value) {
  return SCRATCHPAD_QUESTION_PRIORITIES.includes(
    String(value ?? "").trim().toLowerCase()
  );
}

export function isAllowedScratchpadChannel(value) {
  return SCRATCHPAD_CHANNELS.includes(
    String(value ?? "").trim().toLowerCase()
  );
}

export function isAllowedChannelField(
  channel,
  field
) {
  const normalizedChannel =
    String(channel ?? "")
      .trim()
      .toLowerCase();

  const normalizedField =
    String(field ?? "")
      .trim();

  const allowedFields =
    SCRATCHPAD_CHANNEL_FIELDS[
      normalizedChannel
    ];

  return Boolean(
    allowedFields?.includes(normalizedField)
  );
}

export function isAllowedBooleanValue(value) {
  return SCRATCHPAD_BOOLEAN_VALUES.includes(
    String(value ?? "").trim().toLowerCase()
  );
}
