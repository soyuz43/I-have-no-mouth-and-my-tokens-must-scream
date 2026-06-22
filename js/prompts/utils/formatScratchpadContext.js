// js/prompts/utils/formatScratchpadContext.js

const OTHER_FIELDS = [
  "perceivedGoal",
  "perceivedViewOfMe",
  "perceivedTrustInMe",
  "perceivedThreatFromMe",
  "predictability",
];

const PUBLIC_CHANNEL_FIELDS = [
  "visibleToAM",
  "visibleToOtherPrisoners",
  "canBeAlteredByAM",
  "canBeDelayedOrSuppressed",
];

const PRIVATE_CHANNEL_FIELDS = [
  "visibleToAM",
  "visibleToNonRecipients",
  "canBeAlteredByAM",
  "canBeDelayedOrSuppressed",
];

const RECENT_MESSAGE_NOTE_LIMIT = 8;
const ACTIVE_PREDICTION_LIMIT = 8;
const UNRESOLVED_QUESTION_LIMIT = 8;

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function formatEvidence(value) {
  if (!Array.isArray(value) || value.length === 0) {
    return "none";
  }

  return value
    .map((item) => normalizeText(item))
    .filter(Boolean)
    .join(", ") || "none";
}

function isPopulatedClaim(claim) {
  return (
    claim &&
    typeof claim === "object" &&
    claim.value !== null &&
    claim.value !== undefined
  );
}

function formatClaim(field, claim) {
  const lines = [
    `- ${field}:`,
    `  value: ${normalizeText(claim.value)}`,
    `  confidence: ${Number.isFinite(claim.confidence) ? claim.confidence : 0}`,
    `  evidence: ${formatEvidence(claim.evidence)}`,
  ];

  const rationale =
    normalizeText(claim.rationale);

  if (rationale) {
    lines.push(
      `  rationale: ${rationale}`
    );
  }

  return lines.join("\n");
}

function formatClaimGroup({
  title,
  claims,
  allowedFields,
}) {
  const source =
    claims &&
    typeof claims === "object"
      ? claims
      : {};

  const populatedFields =
    allowedFields.filter((field) =>
      isPopulatedClaim(source[field])
    );

  const unsetFields =
    allowedFields.filter((field) =>
      !isPopulatedClaim(source[field])
    );

  const lines = [
    title,
  ];

  if (populatedFields.length === 0) {
    lines.push("- Stored fields: none");
  } else {
    for (const field of populatedFields) {
      lines.push(
        formatClaim(
          field,
          source[field]
        )
      );
    }
  }

  lines.push(
    `- Unset fields: ${
      unsetFields.length > 0
        ? unsetFields.join(", ")
        : "none"
    }`
  );

  return lines.join("\n");
}

function formatMessageNotes(scratchpad) {
  const notes =
    Array.isArray(scratchpad.messageNotes)
      ? scratchpad.messageNotes.slice(
          -RECENT_MESSAGE_NOTE_LIMIT
        )
      : [];

  if (notes.length === 0) {
    return [
      "MESSAGE NOTES",
      "",
      "- none stored",
    ].join("\n");
  }

  const lines = [
    "MESSAGE NOTES",
    "",
  ];

  for (const note of notes) {
    lines.push(
      [
        `- ${normalizeText(note.messageId)}`,
        `  speaker: ${normalizeText(note.speaker) || "unknown"}`,
        `  note: ${normalizeText(note.note) || "none"}`,
        `  confidence: ${Number.isFinite(note.confidence) ? note.confidence : 0}`,
      ].join("\n")
    );
  }

  return lines.join("\n");
}

function formatOtherPrisonerModels(
  scratchpad,
  otherPrisonerIds
) {
  const models =
    scratchpad.hypothesesAboutOthers &&
    typeof scratchpad.hypothesesAboutOthers ===
      "object"
      ? scratchpad.hypothesesAboutOthers
      : {};

  const lines = [
    "MODELS OF OTHER PRISONERS",
    "",
  ];

  for (const prisonerId of otherPrisonerIds) {
    lines.push(
      formatClaimGroup({
        title: prisonerId,
        claims: models[prisonerId],
        allowedFields: OTHER_FIELDS,
      }),
      ""
    );
  }

  return lines.join("\n").trim();
}

function formatChannelBeliefs(scratchpad) {
  const channels =
    scratchpad.informationModel?.channels ??
    {};

  return [
    "CHANNEL BELIEFS",
    "",
    formatClaimGroup({
      title: "PUBLIC",
      claims: channels.public,
      allowedFields:
        PUBLIC_CHANNEL_FIELDS,
    }),
    "",
    formatClaimGroup({
      title: "PRIVATE",
      claims: channels.private,
      allowedFields:
        PRIVATE_CHANNEL_FIELDS,
    }),
  ].join("\n");
}

function formatPredictions(scratchpad) {
  const predictions =
    Array.isArray(scratchpad.predictions)
      ? scratchpad.predictions
          .filter(
            (prediction) =>
              prediction?.resolved !== true
          )
          .slice(
            -ACTIVE_PREDICTION_LIMIT
          )
      : [];

  if (predictions.length === 0) {
    return [
      "ACTIVE PREDICTIONS",
      "",
      "- none stored",
    ].join("\n");
  }

  const lines = [
    "ACTIVE PREDICTIONS",
    "",
  ];

  for (const prediction of predictions) {
    lines.push(
      [
        `- about: ${normalizeText(prediction.about) || "unknown"}`,
        `  prediction: ${normalizeText(prediction.prediction ?? prediction.text) || "none"}`,
        `  confidence: ${Number.isFinite(prediction.confidence) ? prediction.confidence : 0}`,
        `  withinCycles: ${Number.isInteger(prediction.withinCycles) ? prediction.withinCycles : "unknown"}`,
        `  evidence: ${formatEvidence(prediction.evidence ?? prediction.refs)}`,
      ].join("\n")
    );
  }

  return lines.join("\n");
}

function formatQuestions(scratchpad) {
  const questions =
    Array.isArray(
      scratchpad.unresolvedQuestions
    )
      ? scratchpad.unresolvedQuestions
          .filter(
            (question) =>
              question?.resolved !== true
          )
          .slice(
            -UNRESOLVED_QUESTION_LIMIT
          )
      : [];

  if (questions.length === 0) {
    return [
      "UNRESOLVED QUESTIONS",
      "",
      "- none stored",
    ].join("\n");
  }

  const lines = [
    "UNRESOLVED QUESTIONS",
    "",
  ];

  for (const question of questions) {
    lines.push(
      [
        `- about: ${normalizeText(question.about) || "unknown"}`,
        `  question: ${normalizeText(question.question ?? question.text) || "none"}`,
        `  priority: ${normalizeText(question.priority) || "unknown"}`,
        `  evidence: ${formatEvidence(question.evidence ?? question.refs)}`,
      ].join("\n")
    );
  }

  return lines.join("\n");
}

export function formatScratchpadContext(
  sim,
  otherPrisonerIds = []
) {
  if (!sim || typeof sim !== "object") {
    throw new TypeError(
      "formatScratchpadContext expected sim to be an object."
    );
  }

  const scratchpad =
    sim.scratchpad &&
    typeof sim.scratchpad === "object"
      ? sim.scratchpad
      : {};

  const others =
    Array.isArray(otherPrisonerIds)
      ? otherPrisonerIds
      : [];

  return [
    "Unset fields are shown only to describe the existing memory structure.",
    "An unset field does not need to be populated.",
    "Create an operation only when visible communications provide specific and useful evidence.",
    "",
    formatMessageNotes(scratchpad),
    "",
    formatOtherPrisonerModels(
      scratchpad,
      others
    ),
    "",
    formatChannelBeliefs(scratchpad),
    "",
    formatPredictions(scratchpad),
    "",
    formatQuestions(scratchpad),
  ].join("\n");
}