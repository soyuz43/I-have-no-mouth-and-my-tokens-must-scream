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
//
// Observability:
// A separate metadata-producing entry point
// (formatCompactScratchpadContextWithSections) returns the same text
// together with a structured description of which scratchpad sections
// and field paths were actually rendered. This is developer-only
// observability for prompt-injection auditing and does not change the
// prisoner-facing text or any runtime state.

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
    return { text: "", fields: [] };
  }

  const lines = [];
  const fields = [];

  for (const field of OTHER_FIELDS) {
    if (isPopulatedClaim(claims[field])) {
      lines.push(
        formatClaimLine(FIELD_LABELS[field], claims[field])
      );
      fields.push(field);
    }
  }

  return { text: lines.join("\n"), fields };
}

function formatChannelBeliefsCompact(scratchpad) {
  const channels =
    scratchpad.informationModel?.channels ?? {};

  const lines = [];
  const publicFields = [];
  const privateFields = [];

  for (const field of PUBLIC_CHANNEL_FIELDS) {
    if (isPopulatedClaim(channels.public?.[field])) {
      lines.push(
        formatClaimLine(
          PUBLIC_CHANNEL_LABELS[field],
          channels.public[field]
        )
      );
      publicFields.push(field);
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
      privateFields.push(field);
    }
  }

  return {
    text: lines.join("\n"),
    scopes: [
      { scope: "public", fields: publicFields },
      { scope: "private", fields: privateFields },
    ].filter((entry) => entry.fields.length > 0),
  };
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

  return {
    text: lines.join("\n"),
    ids: predictions
      .map((p) => p?.id)
      .filter((id) => id !== undefined && id !== null),
  };
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

  return {
    text: lines.join("\n"),
    ids: questions
      .map((q) => q?.id)
      .filter((id) => id !== undefined && id !== null),
  };
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
  return formatCompactScratchpadContextWithSections(sim, {
    targetId,
    otherPrisonerIds,
    predictionLimit,
    questionLimit,
  }).text;
}

/**
 * Format the compact scratchpad context block (identical text to
 * formatCompactScratchpadContext) and also return a structured
 * description of which sections and field paths were rendered.
 *
 * The sections metadata describes only what was actually injected:
 * - personModel: one entry per rendered prisoner, with targetId and the
 *   list of rendered person-model field keys.
 * - channelBeliefs: scope ("public"/"private") and rendered field keys.
 * - predictions: rendered count and stable prediction ids where present.
 * - questions: rendered count and stable question ids where present.
 *
 * Sections that rendered nothing are omitted. The text output is
 * byte-for-byte identical to formatCompactScratchpadContext.
 *
 * @param {object} sim
 * @param {object} options
 * @returns {{ text: string, sections: Array<object> }}
 */
export function formatCompactScratchpadContextWithSections(
  sim,
  {
    targetId = null,
    otherPrisonerIds = [],
    predictionLimit = DEFAULT_PREDICTION_LIMIT,
    questionLimit = DEFAULT_QUESTION_LIMIT,
  } = {}
) {
  if (!sim || typeof sim !== "object") {
    return { text: "", sections: [] };
  }

  const scratchpad =
    sim.scratchpad &&
    typeof sim.scratchpad === "object"
      ? sim.scratchpad
      : {};

  if (!scratchpad.initialized) {
    return { text: "", sections: [] };
  }

  const sections = [];
  const renderedTexts = [];

  // Person-model claims
  if (targetId) {
    const { text: personBlock, fields } =
      formatPersonModel(scratchpad, targetId);
    if (personBlock) {
      renderedTexts.push(
        `What you believe about ${targetId}:\n${personBlock}`
      );
      sections.push({
        section: "personModel",
        targetId,
        fields,
      });
    }
  } else {
    const ids = Array.isArray(otherPrisonerIds)
      ? otherPrisonerIds
      : [];
    const parts = [];

    for (const id of ids) {
      const { text: block, fields } =
        formatPersonModel(scratchpad, id);
      if (block) {
        parts.push(`${id}:\n${block}`);
        sections.push({
          section: "personModel",
          targetId: id,
          fields,
        });
      }
    }

    if (parts.length > 0) {
      renderedTexts.push(
        `What you believe about the others:\n${parts.join("\n\n")}`
      );
    }
  }

  // Channel beliefs
  const {
    text: channelBlock,
    scopes,
  } = formatChannelBeliefsCompact(scratchpad);
  if (channelBlock) {
    renderedTexts.push(
      `What you suspect about communication channels:\n${channelBlock}`
    );
    for (const { scope, fields } of scopes) {
      sections.push({
        section: "channelBeliefs",
        scope,
        fields,
      });
    }
  }

  // Predictions
  const {
    text: predictionBlock,
    ids: predictionIds,
  } = formatPredictionsCompact(scratchpad, predictionLimit);
  if (predictionBlock) {
    renderedTexts.push(
      `What you expect to happen:\n${predictionBlock}`
    );
    sections.push({
      section: "predictions",
      count: predictionIds.length,
      ids: predictionIds,
    });
  }

  // Questions
  const {
    text: questionBlock,
    ids: questionIds,
  } = formatQuestionsCompact(scratchpad, questionLimit);
  if (questionBlock) {
    renderedTexts.push(
      `What you still wonder about:\n${questionBlock}`
    );
    sections.push({
      section: "questions",
      count: questionIds.length,
      ids: questionIds,
    });
  }

  const text =
    renderedTexts.length === 0
      ? ""
      : ["YOUR PRIVATE COGNITION", "", ...renderedTexts].join("\n");

  return { text, sections };
}
