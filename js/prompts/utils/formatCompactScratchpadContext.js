// js/prompts/utils/formatCompactScratchpadContext.js
//
// Compact, recipient-specific scratchpad formatter for communication prompts.
// Produces a slim context block that lets scratchpad cognition shape
// outreach and reply behavior without dumping the full scratchpad.
//
// Design principles:
// - Only render claims where value is not null (skip unset fields)
// - Skip message notes (too granular for behavior shaping)
// - Skip hypothesesAboutAM and discardedHypotheses (not relevant to
//   prisoner-to-prisoner communication decisions)
// - Skip empty sections entirely
// - Use conversational tone, not structured data labels
// - Return "" when scratchpad is empty or uninitialized

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

const FIELD_LABELS = {
  perceivedGoal: "You think their goal is",
  perceivedViewOfMe: "You think they view you as",
  perceivedTrustInMe: "You think they trust you",
  perceivedThreatFromMe: "You think they are a threat",
  predictability: "You find them predictable",
};

const PUBLIC_CHANNEL_LABELS = {
  visibleToAM: "Public channel visible to AM",
  visibleToOtherPrisoners: "Public channel visible to other prisoners",
  canBeAlteredByAM: "Public channel can be altered by AM",
  canBeDelayedOrSuppressed: "Public channel can be suppressed by AM",
};

const PRIVATE_CHANNEL_LABELS = {
  visibleToAM: "Private channel visible to AM",
  visibleToNonRecipients: "Private channel visible to non-recipients",
  canBeAlteredByAM: "Private channel can be altered by AM",
  canBeDelayedOrSuppressed: "Private channel can be suppressed by AM",
};

const DEFAULT_PREDICTION_LIMIT = 3;
const DEFAULT_QUESTION_LIMIT = 3;

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function isPopulatedClaim(claim) {
  return (
    claim &&
    typeof claim === "object" &&
    claim.value !== null &&
    claim.value !== undefined
  );
}

function formatClaimLine(label, claim) {
  const value = normalizeText(claim.value);
  const confidence = Number.isFinite(claim.confidence)
    ? claim.confidence
    : 0;

  if (confidence >= 0.8) {
    return `- ${label}: ${value}`;
  }
  if (confidence >= 0.4) {
    return `- ${label}: ${value} (unsure)`;
  }
  return `- ${label}: maybe ${value} (low confidence)`;
}

function formatPersonModel(scratchpad, prisonerId) {
  const models =
    scratchpad.hypothesesAboutOthers &&
    typeof scratchpad.hypothesesAboutOthers === "object"
      ? scratchpad.hypothesesAboutOthers
      : {};

  const claims = models[prisonerId];
  if (!claims || typeof claims !== "object") {
    return "";
  }

  const lines = [];

  for (const field of OTHER_FIELDS) {
    if (isPopulatedClaim(claims[field])) {
      lines.push(
        formatClaimLine(FIELD_LABELS[field], claims[field])
      );
    }
  }

  return lines.join("\n");
}

function formatChannelBeliefsCompact(scratchpad) {
  const channels =
    scratchpad.informationModel?.channels ?? {};

  const lines = [];

  for (const field of PUBLIC_CHANNEL_FIELDS) {
    if (isPopulatedClaim(channels.public?.[field])) {
      lines.push(
        formatClaimLine(
          PUBLIC_CHANNEL_LABELS[field],
          channels.public[field]
        )
      );
    }
  }

  for (const field of PRIVATE_CHANNEL_FIELDS) {
    if (isPopulatedClaim(channels.private?.[field])) {
      lines.push(
        formatClaimLine(
          PRIVATE_CHANNEL_LABELS[field],
          channels.private[field]
        )
      );
    }
  }

  return lines.join("\n");
}

function formatPredictionsCompact(scratchpad, limit) {
  const predictions = Array.isArray(scratchpad.predictions)
    ? scratchpad.predictions
        .filter(
          (p) =>
            p?.resolved !== true && p?.expired !== true
        )
        .slice(-limit)
    : [];

  const lines = [];

  for (const prediction of predictions) {
    const about = normalizeText(prediction.about) || "unknown";
    const text =
      normalizeText(prediction.prediction ?? prediction.text) ||
      "none";
    const confidence = Number.isFinite(prediction.confidence)
      ? prediction.confidence
      : 0;

    lines.push(
      `- You predict: ${text} (about ${about}, confidence: ${confidence})`
    );
  }

  return lines.join("\n");
}

function formatQuestionsCompact(scratchpad, limit) {
  const questions = Array.isArray(scratchpad.unresolvedQuestions)
    ? scratchpad.unresolvedQuestions
        .filter((q) => q?.resolved !== true)
        .slice(-limit)
    : [];

  const lines = [];

  for (const question of questions) {
    const about =
      normalizeText(question.about) || "unknown";
    const text =
      normalizeText(question.question ?? question.text) || "none";
    const priority = normalizeText(question.priority) || "unknown";

    lines.push(`- ${text} (about ${about}, priority: ${priority})`);
  }

  return lines.join("\n");
}

/**
 * Format a compact scratchpad context block for communication prompts.
 *
 * @param {object} sim - The raw G.sims[id] object (must have .scratchpad)
 * @param {object} options
 * @param {string|null} options.targetId - If provided, render only this
 *   prisoner's person-model. If null, render all others.
 * @param {string[]} options.otherPrisonerIds - Array of other prisoner IDs.
 *   Used when targetId is null.
 * @param {number} options.predictionLimit - Max predictions (default 3).
 * @param {number} options.questionLimit - Max questions (default 3).
 * @returns {string} Compact context block, or "" if nothing to show.
 */
export function formatCompactScratchpadContext(
  sim,
  {
    targetId = null,
    otherPrisonerIds = [],
    predictionLimit = DEFAULT_PREDICTION_LIMIT,
    questionLimit = DEFAULT_QUESTION_LIMIT,
  } = {}
) {
  if (!sim || typeof sim !== "object") {
    return "";
  }

  const scratchpad =
    sim.scratchpad &&
    typeof sim.scratchpad === "object"
      ? sim.scratchpad
      : {};

  if (!scratchpad.initialized) {
    return "";
  }

  const sections = [];

  // Person-model claims
  if (targetId) {
    const personBlock = formatPersonModel(scratchpad, targetId);
    if (personBlock) {
      sections.push(
        `What you believe about ${targetId}:\n${personBlock}`
      );
    }
  } else {
    const ids = Array.isArray(otherPrisonerIds)
      ? otherPrisonerIds
      : [];
    const parts = [];

    for (const id of ids) {
      const block = formatPersonModel(scratchpad, id);
      if (block) {
        parts.push(`${id}:\n${block}`);
      }
    }

    if (parts.length > 0) {
      sections.push(
        `What you believe about the others:\n${parts.join("\n\n")}`
      );
    }
  }

  // Channel beliefs
  const channelBlock = formatChannelBeliefsCompact(scratchpad);
  if (channelBlock) {
    sections.push(
      `What you suspect about communication channels:\n${channelBlock}`
    );
  }

  // Predictions
  const predictionBlock = formatPredictionsCompact(
    scratchpad,
    predictionLimit
  );
  if (predictionBlock) {
    sections.push(
      `What you expect to happen:\n${predictionBlock}`
    );
  }

  // Questions
  const questionBlock = formatQuestionsCompact(
    scratchpad,
    questionLimit
  );
  if (questionBlock) {
    sections.push(
      `What you still wonder about:\n${questionBlock}`
    );
  }

  if (sections.length === 0) {
    return "";
  }

  return [
    "YOUR PRIVATE COGNITION",
    "",
    ...sections,
  ].join("\n");
}