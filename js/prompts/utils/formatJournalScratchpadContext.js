// js/prompts/utils/formatJournalScratchpadContext.js
//
// Journal-specific scratchpad formatter.
//
// The journal is the prisoner's introspective process, not a
// communication act. The communication formatter
// (formatCompactScratchpadContext) is therefore deliberately NOT reused
// here: it renders recipient-scoped person models and channel beliefs to
// shape what the prisoner says, which is the wrong selection and the
// wrong register for what the prisoner is thinking about.
//
// Design principles:
// - Curated, small subset: only the private cognition that plausibly
//   occupies attention right now (recent observations, open questions,
//   live expectations, and very recent lessons).
// - Source facts only: the prisoner already has this in their own
//   head. This block re-presents it; it never adds new information.
// - Explicit "load", not a checklist. The section header used by the
//   journal prompt supplies the framing instruction; this module keeps
//   the text short so the model has no material to enumerate.
// - Never leak canonical truth: renders only the prisoner's own
//   scratchpad fields, never evidence ids, rationales, or outcomes that
//   were not already theirs.
// - Return "" and [] for empty/uninitialized scratchpads so the caller
//   can omit the whole section and leave the prompt unchanged.
//
// Observability:
// Returns the same { text, sections } contract as
// formatCompactScratchpadContextWithSections so the shared injection
// logger can consume journal sections without modification. `sections`
// describes only what was actually rendered: section name, rendered
// count, and stable ids when the source entries carry them.

const DEFAULT_NOTE_LIMIT = 3;
const DEFAULT_QUESTION_LIMIT = 3;
const DEFAULT_PREDICTION_LIMIT = 3;
const DEFAULT_RESOLVED_PREDICTION_LIMIT = 2;

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function collectIds(entries) {
  return entries
    .map((entry) => entry?.id)
    .filter((id) => id !== undefined && id !== null);
}

function formatMessageNotes(scratchpad, limit) {
  // Message notes have no `id`; `sequence` is their stable ordering key.
  const notes = toArray(scratchpad.messageNotes)
    .filter((note) => normalizeText(note?.note).length > 0)
    .slice(-limit);

  const lines = notes.map((note) => {
    const speaker = normalizeText(note.speaker) || "someone";
    const body = normalizeText(note.note);
    return `- ${speaker}: ${body}`;
  });

  return {
    text: lines.join("\n"),
    entries: notes,
    ids: notes
      .map((note) => note?.sequence)
      .filter((sequence) => sequence !== undefined && sequence !== null),
  };
}

function formatQuestions(scratchpad, limit) {
  const questions = toArray(scratchpad.unresolvedQuestions)
    .filter(
      (question) =>
        question?.resolved !== true &&
        normalizeText(question?.question ?? question?.text).length > 0
    )
    .slice(-limit);

  const lines = questions.map((question) => {
    const body =
      normalizeText(question.question ?? question.text) || "none";
    const about = normalizeText(question.about);
    return about ? `- ${body} (about ${about})` : `- ${body}`;
  });

  return { text: lines.join("\n"), entries: questions, ids: collectIds(questions) };
}

function formatPredictions(scratchpad, limit) {
  const predictions = toArray(scratchpad.predictions)
    .filter(
      (prediction) =>
        prediction?.resolved !== true &&
        prediction?.expired !== true &&
        normalizeText(prediction?.prediction ?? prediction?.text).length > 0
    )
    .slice(-limit);

  const lines = predictions.map((prediction) => {
    const body =
      normalizeText(prediction.prediction ?? prediction.text) || "none";
    const about = normalizeText(prediction.about);
    return about ? `- ${body} (about ${about})` : `- ${body}`;
  });

  return { text: lines.join("\n"), entries: predictions, ids: collectIds(predictions) };
}

function formatResolvedPredictions(scratchpad, limit) {
  // Resolved predictions stay in `predictions` until consolidation moves
  // them to `archivedPredictions`. Merge both sources, most recent last.
  const resolved = toArray(scratchpad.archivedPredictions)
    .concat(toArray(scratchpad.predictions))
    .filter((prediction) => prediction?.resolved === true)
    .slice(-limit);

  const lines = resolved.map((prediction) => {
    const body =
      normalizeText(prediction.prediction ?? prediction.text) || "none";
    const outcome = normalizeText(prediction.outcome);
    return outcome
      ? `- ${body} → ${outcome}`
      : `- ${body} → (you are not sure how it turned out)`;
  });

  return { text: lines.join("\n"), entries: resolved, ids: collectIds(resolved) };
}

function pushSection(sections, rendered, name) {
  if (!rendered.text) {
    return;
  }
  sections.push({
    section: name,
    count: rendered.entries.length,
    ids: rendered.ids,
  });
}

/**
 * Format the journal cognitive-load block for one prisoner.
 *
 * @param {object} sim - The raw G.sims[id] object (must have .scratchpad)
 * @param {object} [options]
 * @param {number} [options.noteLimit] - Max recent message notes (default 3)
 * @param {number} [options.questionLimit] - Max open questions (default 3)
 * @param {number} [options.predictionLimit] - Max live predictions (default 3)
 * @param {number} [options.resolvedPredictionLimit] - Max recently
 *   resolved predictions (default 2)
 * @returns {{ text: string, sections: Array<object> }}
 */
export function formatJournalScratchpadContext(
  sim,
  {
    noteLimit = DEFAULT_NOTE_LIMIT,
    questionLimit = DEFAULT_QUESTION_LIMIT,
    predictionLimit = DEFAULT_PREDICTION_LIMIT,
    resolvedPredictionLimit = DEFAULT_RESOLVED_PREDICTION_LIMIT,
  } = {}
) {
  if (!sim || typeof sim !== "object") {
    return { text: "", sections: [] };
  }

  const scratchpad =
    sim.scratchpad && typeof sim.scratchpad === "object"
      ? sim.scratchpad
      : {};

  if (!scratchpad.initialized) {
    return { text: "", sections: [] };
  }

  const notes = formatMessageNotes(scratchpad, noteLimit);
  const questions = formatQuestions(scratchpad, questionLimit);
  const predictions = formatPredictions(scratchpad, predictionLimit);
  const resolved = formatResolvedPredictions(
    scratchpad,
    resolvedPredictionLimit
  );

  const sections = [];
  pushSection(sections, notes, "messageNotes");
  pushSection(sections, questions, "unresolvedQuestions");
  pushSection(sections, predictions, "predictions");
  pushSection(sections, resolved, "resolvedPredictions");

  if (sections.length === 0) {
    return { text: "", sections: [] };
  }

  const blocks = [];
  if (notes.text) {
    blocks.push(`Recent Observations\n\n${notes.text}`);
  }
  if (questions.text) {
    blocks.push(`Unresolved Questions\n\n${questions.text}`);
  }
  if (predictions.text) {
    blocks.push(`Active Predictions\n\n${predictions.text}`);
  }
  if (resolved.text) {
    blocks.push(`Recently Settled\n\n${resolved.text}`);
  }

  return { text: blocks.join("\n\n"), sections };
}
