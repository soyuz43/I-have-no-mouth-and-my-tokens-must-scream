// js/engine/scratchpad/comms/protocol.js

import { SIM_IDS } from "../../../core/constants.js";
import {
  getAllResourceDefinitionIds,
} from "../../agency/resourceDefs.js";

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

// Bumped for the RESOURCE_CLAIM operation.
//
// The scratchpad schema version is unchanged: the operation writes to
// the OPTIONAL `resourceBeliefs` collection, which a scratchpad that
// predates it simply does not have. A save written before this
// operation existed therefore still loads, and a scratchpad without
// the collection is a valid scratchpad.
//
// The protocol version IS bumped, because the set of operations the
// model may emit has changed. A model that learned the version 3
// operation set will never emit RESOURCE_CLAIM, and one that has not
// been taught it will have its output rejected rather than silently
// ignored.
export const SCRATCHPAD_COMMS_PROTOCOL_VERSION = 4;

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

/*
 * The claimed quantity in a RESOURCE_CLAIM.
 *
 * Resources are tracked as whole units in both ledgers, so the
 * claimed count is an integer. The ceiling is a sanity bound that
 * keeps a malformed or hallucinated count from being stored; the
 * REAL bound on a claim is the speaker's own belief, and that clamp
 * is applied at commit time.
 */
export const RESOURCE_CLAIM_QUANTITY_RANGE = Object.freeze({
  min: 0,
  max: 99,
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
  "QUESTION_RESOLVE",
  "PREDICTION",
  "PREDICTION_RESOLVE",
  "CHANNEL",
  "RESOURCE_CLAIM",
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
  "predictability",
]);

export const SCRATCHPAD_QUESTION_PRIORITIES =
  Object.freeze([
    "low",
    "medium",
    "high",
  ]);

export const SCRATCHPAD_PREDICTION_OUTCOMES =
  Object.freeze([
    "confirmed",
    "disconfirmed",
    "ambiguous",
    "unobservable",
    "superseded",
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

    QUESTION_RESOLVE: Object.freeze({
      type: "question_resolve",

      // Content-addressed: a QUESTION_RESOLVE locates the target
      // question by the same (about + question text) identity used for
      // duplicate detection, never by question id. "resolution" carries
      // the resolution text; "refs" grounds it in visible canonical
      // evidence like every other evidence-grounded operation.
      requiredAttributes: Object.freeze([
        "about",
        "resolution",
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

    PREDICTION_RESOLVE: Object.freeze({
      type: "prediction_resolve",

      requiredAttributes: Object.freeze([
        "about",
        "withinCycles",
        "outcome",
        "rationale",
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

    /*
     * RESOURCE_CLAIM is TESTIMONY: a prisoner states what they
     * personally hold, and the listener forms a belief about the
     * speaker's holdings.
     *
     * `about` is the SPEAKER. The claim is about what the speaker
     * holds, and the engine requires the cited message's sender to
     * be that same speaker, so the operation is first-hand by
     * construction: a prisoner cannot testify about a third party.
     *
     * `definition` is a resource DEFINITION, not a stack id. A
     * belief about holdings is tracked per definition, matching the
     * way the subjective ledger tracks a prisoner's own holdings.
     *
     * `quantity` is the claimed count. It is CLAMPED at commit time
     * to what the speaker themselves believe they hold, so a speaker
     * may overstate but never beyond their own belief.
     *
     * `ref` is exactly one message id: the message the testimony
     * came from. The same reference-grounding machinery as NOTE
     * applies, so an invisible or unknown message is rejected.
     *
     * The operation has no text body: the testimony IS the message.
     */
    RESOURCE_CLAIM: Object.freeze({
      type: "resource_claim",

      requiredAttributes: Object.freeze([
        "about",
        "definition",
        "quantity",
        "confidence",
        "ref",
      ]),

      optionalAttributes: Object.freeze([]),

      referenceAttribute: "ref",
      textRequired: false,
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

/*
 * Whether a value names a resource definition a RESOURCE_CLAIM may
 * talk about.
 *
 * The catalogue is the source of truth. A definition that does not
 * exist cannot be believed to be held, so naming one is rejected.
 */
export function isAllowedResourceClaimDefinition(value) {
  return getAllResourceDefinitionIds().includes(
    String(value ?? "").trim()
  );
}
