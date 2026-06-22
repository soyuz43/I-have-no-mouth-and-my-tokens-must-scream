// js/engine/scratchpad/comms/validate.js

import { SIM_IDS } from "../../../core/constants.js";

import {
  MAX_SCRATCHPAD_OPERATIONS,
  MAX_SCRATCHPAD_OPERATION_TEXT_LENGTH,
  MIN_PREDICTION_HORIZON,
  MAX_PREDICTION_HORIZON,
  CONFIDENCE_RANGE,
  SCORE_VALUE_RANGE,
  getScratchpadOperationDefinition,
  getAllowedAttributesForTag,
  isAllowedScratchpadTarget,
  isAllowedScratchpadSubject,
  isAllowedOtherField,
  isAllowedScoreField,
  isAllowedQuestionPriority,
  isAllowedScratchpadChannel,
  isAllowedChannelField,
  isAllowedBooleanValue,
} from "./protocol.js";

import {
  buildVisibleMessageMap,
  isMessageVisibleToSim,
} from "./visibility.js";

/*
============================================================
SCRATCHPAD COMMUNICATION VALIDATION

Validates parsed scratchpad operations before commit.

This module:
- Checks protocol tags and attributes.
- Coerces valid primitive values into canonical types.
- Verifies prisoner targets and subjects.
- Verifies message references against the exact evidence supplied
  to the model.
- Rejects conflicting writes within one response.
- Allows valid operations to survive alongside rejected operations.
- Produces normalized operation objects for commit.js.

This module does not:
- Repair model output.
- Parse XML-like text.
- Invoke models.
- Mutate simulation state.
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

function hasOwn(object, key) {
  return Boolean(
    object &&
    Object.prototype.hasOwnProperty.call(
      object,
      key
    )
  );
}

function normalizeOperationText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function containsInvalidControlCharacters(value) {
  return /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(
    String(value ?? "")
  );
}

function uniqueStrings(values) {
  return [
    ...new Set(
      values.filter(Boolean)
    ),
  ];
}

function createRejectedOperation(
  operation,
  reasons
) {
  return {
    index:
      operation?.index ?? null,

    tag:
      operation?.tag ?? "UNKNOWN",

    type:
      operation?.type ?? null,

    reasons:
      uniqueStrings(reasons),

    raw:
      operation?.raw ?? "",

    operation,
  };
}

/* ============================================================
   PRIMITIVE VALUE PARSING
============================================================ */

function parseNumberInRange(
  rawValue,
  {
    name,
    min,
    max,
    reasons,
  }
) {
  const text =
    String(rawValue ?? "")
      .trim();

  if (!text) {
    reasons.push(
      `${name} is required.`
    );

    return null;
  }

  const value =
    Number(text);

  if (!Number.isFinite(value)) {
    reasons.push(
      `${name} must be a finite number.`
    );

    return null;
  }

  if (
    value < min ||
    value > max
  ) {
    reasons.push(
      `${name} must be between ${min} and ${max}.`
    );

    return null;
  }

  return value;
}

function parseIntegerInRange(
  rawValue,
  {
    name,
    min,
    max,
    reasons,
  }
) {
  const text =
    String(rawValue ?? "")
      .trim();

  if (!text) {
    reasons.push(
      `${name} is required.`
    );

    return null;
  }

  const value =
    Number(text);

  if (!Number.isSafeInteger(value)) {
    reasons.push(
      `${name} must be a safe integer.`
    );

    return null;
  }

  if (
    value < min ||
    value > max
  ) {
    reasons.push(
      `${name} must be between ${min} and ${max}.`
    );

    return null;
  }

  return value;
}

function parseBooleanValue(
  rawValue,
  reasons
) {
  const normalized =
    String(rawValue ?? "")
      .trim()
      .toLowerCase();

  if (
    !isAllowedBooleanValue(
      normalized
    )
  ) {
    reasons.push(
      'value must be either "true" or "false".'
    );

    return null;
  }

  return normalized === "true";
}

/* ============================================================
   REFERENCE VALIDATION
============================================================ */

function parseReferenceList(
  rawValue,
  {
    attributeName,
    requireExactlyOne = false,
    visibleMessageMap,
    simId,
    reasons,
  }
) {
  const source =
    String(rawValue ?? "")
      .trim();

  if (!source) {
    reasons.push(
      `${attributeName} must contain at least one message ID.`
    );

    return [];
  }

  const rawReferences =
    source
      .split(",")
      .map((reference) =>
        reference.trim()
      )
      .filter(Boolean);

  const references =
    uniqueStrings(
      rawReferences
    );

  if (
    requireExactlyOne &&
    references.length !== 1
  ) {
    reasons.push(
      `${attributeName} must contain exactly one message ID.`
    );
  }

  if (
    !requireExactlyOne &&
    references.length === 0
  ) {
    reasons.push(
      `${attributeName} must contain at least one message ID.`
    );
  }

  if (
    rawReferences.length !==
    references.length
  ) {
    reasons.push(
      `${attributeName} contains duplicate message references.`
    );
  }

  for (const reference of references) {
    const message =
      visibleMessageMap.get(
        reference
      );

    if (!message) {
      reasons.push(
        `Unknown or invisible message reference: ${reference}.`
      );

      continue;
    }

    if (
      !isMessageVisibleToSim(
        message,
        simId
      )
    ) {
      reasons.push(
        `Message reference ${reference} is not visible to ${simId}.`
      );
    }
  }

  return references;
}

/* ============================================================
   COMMON OPERATION VALIDATION
============================================================ */

function validateCommonOperationShape(
  operation,
  definition
) {
  const reasons = [];

  if (
    !operation ||
    typeof operation !== "object"
  ) {
    return [
      "Parsed operation must be an object.",
    ];
  }

  if (!operation.known) {
    reasons.push(
      `Unknown operation tag: ${operation.tag || "(missing)"}.`
    );
  }

  if (!definition) {
    reasons.push(
      `No protocol definition exists for ${operation.tag || "(missing)"}.`
    );

    return reasons;
  }

  const attributes =
    operation.attributes &&
    typeof operation.attributes === "object"
      ? operation.attributes
      : Object.create(null);

  const allowedAttributes =
    getAllowedAttributesForTag(
      operation.tag
    );

  const allowedAttributeSet =
    new Set(
      allowedAttributes
    );

  for (
    const attributeName of
    Object.keys(attributes)
  ) {
    if (
      !allowedAttributeSet.has(
        attributeName
      )
    ) {
      reasons.push(
        `Unknown attribute "${attributeName}" on ${operation.tag}.`
      );
    }
  }

  for (
    const requiredAttribute of
    definition.requiredAttributes
  ) {
    if (
      !hasOwn(
        attributes,
        requiredAttribute
      )
    ) {
      reasons.push(
        `Missing required attribute "${requiredAttribute}".`
      );

      continue;
    }

    if (
      String(
        attributes[
          requiredAttribute
        ] ?? ""
      ).trim() === ""
    ) {
      reasons.push(
        `Required attribute "${requiredAttribute}" cannot be empty.`
      );
    }
  }

  if (
    Array.isArray(
      operation.duplicateAttributes
    ) &&
    operation
      .duplicateAttributes
      .length > 0
  ) {
    for (
      const duplicate of
      operation.duplicateAttributes
    ) {
      reasons.push(
        `Duplicate attribute "${duplicate.name}".`
      );
    }
  }

  if (
    operation.hasMalformedAttributes
  ) {
    reasons.push(
      `Malformed attribute content: ${operation.unparsedAttributeText || "(unknown)"}.`
    );
  }

  const text =
    normalizeOperationText(
      operation.text
    );

  if (
    definition.textRequired &&
    !text
  ) {
    reasons.push(
      `${operation.tag} requires operation text.`
    );
  }

  if (
    !definition.textRequired &&
    text
  ) {
    reasons.push(
      `${operation.tag} must not contain operation text.`
    );
  }

  if (
    text.length >
    MAX_SCRATCHPAD_OPERATION_TEXT_LENGTH
  ) {
    reasons.push(
      `${operation.tag} text exceeds ${MAX_SCRATCHPAD_OPERATION_TEXT_LENGTH} characters.`
    );
  }

  if (
    containsInvalidControlCharacters(
      text
    )
  ) {
    reasons.push(
      `${operation.tag} text contains invalid control characters.`
    );
  }

  if (
    operation.tag === "NO_UPDATE"
  ) {
    if (!operation.selfClosing) {
      reasons.push(
        "NO_UPDATE must be self-closing."
      );
    }
  } else if (
    operation.selfClosing
  ) {
    reasons.push(
      `${operation.tag} cannot be self-closing.`
    );
  }

  return reasons;
}

/* ============================================================
   DESTINATION CONFLICT DETECTION
============================================================ */

function getOperationDestinationKey(
  operation
) {
  switch (operation.type) {
    case "note":
      return (
        `note:` +
        `${operation.messageId}`
      );

    case "other":
      return (
        `other:` +
        `${operation.target}:` +
        `${operation.field}`
      );

    case "score":
      return (
        `score:` +
        `${operation.target}:` +
        `${operation.field}`
      );

    case "channel":
      return (
        `channel:` +
        `${operation.channel}:` +
        `${operation.field}`
      );

    case "question":
      return (
        `question:` +
        `${operation.about}:` +
        `${operation.text.toLowerCase()}`
      );

    case "prediction":
      return (
        `prediction:` +
        `${operation.about}:` +
        `${operation.text.toLowerCase()}`
      );

    case "no_update":
      return "no_update";

    default:
      return null;
  }
}

/* ============================================================
   INDIVIDUAL OPERATION VALIDATION
============================================================ */

function validateAndNormalizeOperation({
  operation,
  simId,
  visibleMessageMap,
  noUpdateMixedWithOperations,
}) {
  const definition =
    getScratchpadOperationDefinition(
      operation?.tag
    );

  const reasons =
    validateCommonOperationShape(
      operation,
      definition
    );

  const attributes =
    operation?.attributes &&
    typeof operation.attributes === "object"
      ? operation.attributes
      : Object.create(null);

  const text =
    normalizeOperationText(
      operation?.text
    );

  if (!definition) {
    return {
      accepted: false,
      reasons,
      normalized: null,
    };
  }

  if (
    operation.tag === "NO_UPDATE"
  ) {
    if (
      noUpdateMixedWithOperations
    ) {
      reasons.push(
        "NO_UPDATE cannot appear with substantive operations."
      );
    }

    return {
      accepted:
        reasons.length === 0,

      reasons,

      normalized:
        reasons.length === 0
          ? {
              type:
                "no_update",

              tag:
                "NO_UPDATE",

              sourceIndex:
                operation.sourceIndex,
            }
          : null,
    };
  }

  let normalized = null;

  switch (operation.tag) {
    case "NOTE": {
      const refs =
        parseReferenceList(
          attributes.ref,
          {
            attributeName:
              "ref",

            requireExactlyOne:
              true,

            visibleMessageMap,
            simId,
            reasons,
          }
        );

      const confidence =
        parseNumberInRange(
          attributes.confidence,
          {
            name:
              "confidence",

            min:
              CONFIDENCE_RANGE.min,

            max:
              CONFIDENCE_RANGE.max,

            reasons,
          }
        );

      normalized = {
        type:
          "note",

        tag:
          "NOTE",

        sourceIndex:
          operation.sourceIndex,

        messageId:
          refs[0] ?? null,

        refs,

        confidence,
        text,
      };

      break;
    }

    case "OTHER": {
      const target =
        String(
          attributes.target ?? ""
        )
          .trim()
          .toUpperCase();

      const field =
        String(
          attributes.field ?? ""
        ).trim();

      if (
        !isAllowedScratchpadTarget(
          target
        )
      ) {
        reasons.push(
          `Unknown prisoner target: ${target || "(missing)"}.`
        );
      }

      if (target === simId) {
        reasons.push(
          "OTHER cannot target the reviewing prisoner."
        );
      }

      if (
        !isAllowedOtherField(
          field
        )
      ) {
        reasons.push(
          `Unsupported OTHER field: ${field || "(missing)"}.`
        );
      }

      const confidence =
        parseNumberInRange(
          attributes.confidence,
          {
            name:
              "confidence",

            min:
              CONFIDENCE_RANGE.min,

            max:
              CONFIDENCE_RANGE.max,

            reasons,
          }
        );

      const refs =
        parseReferenceList(
          attributes.refs,
          {
            attributeName:
              "refs",

            visibleMessageMap,
            simId,
            reasons,
          }
        );

      normalized = {
        type:
          "other",

        tag:
          "OTHER",

        sourceIndex:
          operation.sourceIndex,

        target,
        field,

        value:
          text,

        confidence,
        refs,
      };

      break;
    }

    case "SCORE": {
      const target =
        String(
          attributes.target ?? ""
        )
          .trim()
          .toUpperCase();

      const field =
        String(
          attributes.field ?? ""
        ).trim();

      if (
        !isAllowedScratchpadTarget(
          target
        )
      ) {
        reasons.push(
          `Unknown prisoner target: ${target || "(missing)"}.`
        );
      }

      if (target === simId) {
        reasons.push(
          "SCORE cannot target the reviewing prisoner."
        );
      }

      if (
        !isAllowedScoreField(
          field
        )
      ) {
        reasons.push(
          `Unsupported SCORE field: ${field || "(missing)"}.`
        );
      }

      const value =
        parseNumberInRange(
          attributes.value,
          {
            name:
              "value",

            min:
              SCORE_VALUE_RANGE.min,

            max:
              SCORE_VALUE_RANGE.max,

            reasons,
          }
        );

      const confidence =
        parseNumberInRange(
          attributes.confidence,
          {
            name:
              "confidence",

            min:
              CONFIDENCE_RANGE.min,

            max:
              CONFIDENCE_RANGE.max,

            reasons,
          }
        );

      const refs =
        parseReferenceList(
          attributes.refs,
          {
            attributeName:
              "refs",

            visibleMessageMap,
            simId,
            reasons,
          }
        );

      normalized = {
        type:
          "score",

        tag:
          "SCORE",

        sourceIndex:
          operation.sourceIndex,

        target,
        field,
        value,
        confidence,

        reason:
          text,

        refs,
      };

      break;
    }

    case "QUESTION": {
      const about =
        String(
          attributes.about ?? ""
        )
          .trim()
          .toUpperCase();

      const priority =
        String(
          attributes.priority ?? ""
        )
          .trim()
          .toLowerCase();

      if (
        !isAllowedScratchpadSubject(
          about
        )
      ) {
        reasons.push(
          `Unsupported QUESTION subject: ${about || "(missing)"}.`
        );
      }

      if (
        !isAllowedQuestionPriority(
          priority
        )
      ) {
        reasons.push(
          `Unsupported QUESTION priority: ${priority || "(missing)"}.`
        );
      }

      const refs =
        parseReferenceList(
          attributes.refs,
          {
            attributeName:
              "refs",

            visibleMessageMap,
            simId,
            reasons,
          }
        );

      normalized = {
        type:
          "question",

        tag:
          "QUESTION",

        sourceIndex:
          operation.sourceIndex,

        about,
        priority,
        text,
        refs,
      };

      break;
    }

    case "PREDICTION": {
      const about =
        String(
          attributes.about ?? ""
        )
          .trim()
          .toUpperCase();

      if (
        !isAllowedScratchpadSubject(
          about
        )
      ) {
        reasons.push(
          `Unsupported PREDICTION subject: ${about || "(missing)"}.`
        );
      }

      const confidence =
        parseNumberInRange(
          attributes.confidence,
          {
            name:
              "confidence",

            min:
              CONFIDENCE_RANGE.min,

            max:
              CONFIDENCE_RANGE.max,

            reasons,
          }
        );

      const withinCycles =
        parseIntegerInRange(
          attributes.withinCycles,
          {
            name:
              "withinCycles",

            min:
              MIN_PREDICTION_HORIZON,

            max:
              MAX_PREDICTION_HORIZON,

            reasons,
          }
        );

      const refs =
        parseReferenceList(
          attributes.refs,
          {
            attributeName:
              "refs",

            visibleMessageMap,
            simId,
            reasons,
          }
        );

      normalized = {
        type:
          "prediction",

        tag:
          "PREDICTION",

        sourceIndex:
          operation.sourceIndex,

        about,
        confidence,
        withinCycles,
        text,
        refs,
      };

      break;
    }

    case "CHANNEL": {
      const channel =
        String(
          attributes.channel ?? ""
        )
          .trim()
          .toLowerCase();

      const field =
        String(
          attributes.field ?? ""
        ).trim();

      if (
        !isAllowedScratchpadChannel(
          channel
        )
      ) {
        reasons.push(
          `Unsupported communication channel: ${channel || "(missing)"}.`
        );
      }

      if (
        channel &&
        !isAllowedChannelField(
          channel,
          field
        )
      ) {
        reasons.push(
          `Unsupported ${channel} channel field: ${field || "(missing)"}.`
        );
      }

      const value =
        parseBooleanValue(
          attributes.value,
          reasons
        );

      const confidence =
        parseNumberInRange(
          attributes.confidence,
          {
            name:
              "confidence",

            min:
              CONFIDENCE_RANGE.min,

            max:
              CONFIDENCE_RANGE.max,

            reasons,
          }
        );

      const refs =
        parseReferenceList(
          attributes.refs,
          {
            attributeName:
              "refs",

            visibleMessageMap,
            simId,
            reasons,
          }
        );

      normalized = {
        type:
          "channel",

        tag:
          "CHANNEL",

        sourceIndex:
          operation.sourceIndex,

        channel,
        field,
        value,
        confidence,

        reason:
          text,

        refs,
      };

      break;
    }

    default:
      reasons.push(
        `No validator exists for operation tag ${operation.tag}.`
      );
  }

  if (reasons.length > 0) {
    return {
      accepted: false,
      reasons,
      normalized: null,
    };
  }

  return {
    accepted: true,
    reasons: [],
    normalized,
  };
}

/* ============================================================
   EVIDENCE INPUT
============================================================ */

function resolveEvidenceMessages(
  evidence
) {
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
    "validateScratchpadCommsOperations expected evidence or evidence.messages to be an array."
  );
}

/* ============================================================
   MAIN VALIDATOR
============================================================ */

export function validateScratchpadCommsOperations({
  parsedResult,
  simId,
  evidence,
}) {
  const normalizedSimId =
    normalizeSimId(simId);

  if (
    !SIM_IDS.includes(
      normalizedSimId
    )
  ) {
    throw new Error(
      `Cannot validate scratchpad operations for unknown prisoner: ${normalizedSimId || simId}`
    );
  }

  const visibleMessages =
    resolveEvidenceMessages(
      evidence
    );

  const visibleMessageMap =
    buildVisibleMessageMap(
      visibleMessages
    );

  const accepted = [];
  const rejected = [];
  const warnings = [];
  const errors = [];

  if (
    !parsedResult ||
    typeof parsedResult !== "object"
  ) {
    return {
      status:
        "failure",

      simId:
        normalizedSimId,

      accepted,
      rejected,
      warnings,

      errors: [
        "Parsed result is missing or invalid.",
      ],

      noUpdate:
        false,

      diagnostics: {
        parsedOperationCount: 0,
        acceptedOperationCount: 0,
        rejectedOperationCount: 0,
        visibleMessageCount:
          visibleMessageMap.size,
      },
    };
  }

  const operations =
    Array.isArray(
      parsedResult.operations
    )
      ? parsedResult.operations
      : [];

  if (
    parsedResult.status ===
    "failure"
  ) {
    errors.push(
      "Scratchpad output parsing failed."
    );
  }

  if (
    Array.isArray(
      parsedResult.errors
    )
  ) {
    warnings.push(
      ...parsedResult.errors
    );
  }

  if (
    Array.isArray(
      parsedResult.malformedRecords
    ) &&
    parsedResult
      .malformedRecords
      .length > 0
  ) {
    warnings.push(
      `${parsedResult.malformedRecords.length} malformed or unparsed fragment(s) were detected.`
    );
  }

  if (
    operations.length === 0
  ) {
    errors.push(
      "No scratchpad operations were parsed."
    );
  }

  const noUpdateOperations =
    operations.filter(
      (operation) =>
        operation.tag ===
        "NO_UPDATE"
    );

  const substantiveOperations =
    operations.filter(
      (operation) =>
        operation.tag !==
        "NO_UPDATE"
    );

  const noUpdateMixedWithOperations =
    noUpdateOperations.length > 0 &&
    substantiveOperations.length > 0;

  if (
    noUpdateMixedWithOperations
  ) {
    warnings.push(
      "NO_UPDATE appeared with substantive operations and will be rejected."
    );
  }

  const destinationKeys =
    new Set();

  let acceptedNoUpdate = false;

  for (
    let index = 0;
    index < operations.length;
    index++
  ) {
    const operation =
      operations[index];

    if (
      index >=
      MAX_SCRATCHPAD_OPERATIONS
    ) {
      rejected.push(
        createRejectedOperation(
          operation,
          [
            `Operation exceeds the maximum of ${MAX_SCRATCHPAD_OPERATIONS} operations.`,
          ]
        )
      );

      continue;
    }

    if (
      operation.tag ===
        "NO_UPDATE" &&
      acceptedNoUpdate
    ) {
      rejected.push(
        createRejectedOperation(
          operation,
          [
            "Duplicate NO_UPDATE operation.",
          ]
        )
      );

      continue;
    }

    const result =
      validateAndNormalizeOperation({
        operation,

        simId:
          normalizedSimId,

        visibleMessageMap,

        noUpdateMixedWithOperations,
      });

    if (
      !result.accepted ||
      !result.normalized
    ) {
      rejected.push(
        createRejectedOperation(
          operation,
          result.reasons
        )
      );

      continue;
    }

    const destinationKey =
      getOperationDestinationKey(
        result.normalized
      );

    if (
      destinationKey &&
      destinationKeys.has(
        destinationKey
      )
    ) {
      rejected.push(
        createRejectedOperation(
          operation,
          [
            `Conflicting or duplicate operation destination: ${destinationKey}.`,
          ]
        )
      );

      continue;
    }

    if (destinationKey) {
      destinationKeys.add(
        destinationKey
      );
    }

    if (
      result.normalized.type ===
      "no_update"
    ) {
      acceptedNoUpdate = true;
    }

    accepted.push(
      result.normalized
    );
  }

  const acceptedSubstantive =
    accepted.filter(
      (operation) =>
        operation.type !==
        "no_update"
    );

  const acceptedNoUpdateOperation =
    accepted.find(
      (operation) =>
        operation.type ===
        "no_update"
    );

  const hasMalformedRecords =
    Array.isArray(
      parsedResult.malformedRecords
    ) &&
    parsedResult.malformedRecords.length > 0;

  const hasParserEnvelopeErrors =
    Array.isArray(
      parsedResult.errors
    ) &&
    parsedResult.errors.length > 0;

  const hasCleanParsedEnvelope =
    parsedResult.status === "success" &&
    errors.length === 0 &&
    !hasMalformedRecords &&
    !hasParserEnvelopeErrors;

  let status =
    "failure";

  if (
    acceptedNoUpdateOperation &&
    accepted.length === 1 &&
    rejected.length === 0 &&
    hasCleanParsedEnvelope
  ) {
    status =
      "no_update";
  } else if (
    acceptedSubstantive.length > 0 &&
    rejected.length === 0 &&
    hasCleanParsedEnvelope
  ) {
    status =
      "success";
  } else if (
    acceptedSubstantive.length > 0
  ) {
    status =
      "partial";
  }

  /*
   * NO_UPDATE is meaningful only when it is the sole accepted
   * operation. Defensive cleanup prevents future callers from
   * accidentally treating a mixed response as an empty update.
   */
  const finalAccepted =
    acceptedSubstantive.length > 0
      ? acceptedSubstantive
      : accepted;

  const referencedMessageIds =
    uniqueStrings(
      finalAccepted.flatMap(
        (operation) =>
          Array.isArray(
            operation.refs
          )
            ? operation.refs
            : []
      )
    );

  return {
    status,

    simId:
      normalizedSimId,

    accepted:
      finalAccepted,

    rejected,

    warnings:
      uniqueStrings(
        warnings
      ),

    errors:
      uniqueStrings(
        errors
      ),

    noUpdate:
      status ===
      "no_update",

    referencedMessageIds,

    diagnostics: {
      parsedStatus:
        parsedResult.status ?? null,

      parsedOperationCount:
        operations.length,

      acceptedOperationCount:
        finalAccepted.length,

      acceptedSubstantiveCount:
        finalAccepted.filter(
          (operation) =>
            operation.type !==
            "no_update"
        ).length,

      rejectedOperationCount:
        rejected.length,

      malformedRecordCount:
        Array.isArray(
          parsedResult.malformedRecords
        )
          ? parsedResult
              .malformedRecords
              .length
          : 0,

      unknownTagCount:
        Array.isArray(
          parsedResult.unknownTags
        )
          ? parsedResult
              .unknownTags
              .length
          : 0,

      visibleMessageCount:
        visibleMessageMap.size,

      referencedMessageCount:
        referencedMessageIds.length,

      exceededOperationLimit:
        operations.length >
        MAX_SCRATCHPAD_OPERATIONS,
    },
  };
}

/* ============================================================
   CONVENIENCE HELPERS
============================================================ */

export function hasValidScratchpadOperations(
  validationResult
) {
  return Boolean(
    validationResult &&
    (
      validationResult.status ===
        "success" ||
      validationResult.status ===
        "partial" ||
      validationResult.status ===
        "no_update"
    )
  );
}

export function getRejectedScratchpadReasons(
  validationResult
) {
  if (
    !Array.isArray(
      validationResult?.rejected
    )
  ) {
    return [];
  }

  return validationResult.rejected.flatMap(
    (record) =>
      Array.isArray(
        record.reasons
      )
        ? record.reasons
        : []
  );
}
