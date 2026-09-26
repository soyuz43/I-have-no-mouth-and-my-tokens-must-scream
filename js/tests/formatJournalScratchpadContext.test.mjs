import { strict as assert } from "node:assert";
import test from "node:test";

import { formatJournalScratchpadContext } from "../prompts/utils/formatJournalScratchpadContext.js";
import { logScratchpadContextInjection } from "../prompts/utils/scratchpadContextLog.js";

function makeNote(sequence, speaker, note) {
  return {
    messageId: `C1-M${sequence}`,
    sequence,
    cycle: 1,
    speaker,
    recipients: ["TED"],
    channel: "public",
    kind: "speech",
    intent: null,
    note,
    confidence: 0.6,
  };
}

function makeQuestion(id, about, question, extra = {}) {
  return {
    id,
    about,
    question,
    priority: "high",
    evidence: [],
    createdCycle: 1,
    resolved: false,
    resolution: null,
    resolvedCycle: null,
    ...extra,
  };
}

function makePrediction(id, about, prediction, extra = {}) {
  return {
    id,
    about,
    prediction,
    confidence: 0.6,
    evidence: [],
    createdCycle: 1,
    withinCycles: 3,
    evaluateByCycle: 4,
    resolved: false,
    outcome: null,
    resolvedCycle: null,
    resultEvidence: [],
    resolutionRationale: null,
    ...extra,
  };
}

function makeSim(overrides = {}) {
  return {
    id: "TED",
    scratchpad: {
      schemaVersion: 3,
      initialized: true,
      messageNotes: [],
      predictions: [],
      unresolvedQuestions: [],
      archivedPredictions: [],
      ...overrides,
    },
  };
}

/* ---------- empty / uninitialized ---------- */

test("returns empty result for a non-object sim", () => {
  assert.deepEqual(formatJournalScratchpadContext(null), { text: "", sections: [] });
  assert.deepEqual(formatJournalScratchpadContext("TED"), { text: "", sections: [] });
});

test("returns empty result when scratchpad is missing or uninitialized", () => {
  assert.deepEqual(formatJournalScratchpadContext({ id: "TED" }), { text: "", sections: [] });
  assert.deepEqual(
    formatJournalScratchpadContext(makeSim({ initialized: false })),
    { text: "", sections: [] }
  );
});

test("returns empty result when every source collection is empty", () => {
  const { text, sections } = formatJournalScratchpadContext(makeSim());
  assert.equal(text, "");
  assert.deepEqual(sections, []);
});

test("returns empty result when the scratchpad is uninitialized even if populated", () => {
  const sim = makeSim({
    initialized: false,
    unresolvedQuestions: [makeQuestion(1, "AM", "Why me?")],
  });
  const { text, sections } = formatJournalScratchpadContext(sim);
  assert.equal(text, "");
  assert.deepEqual(sections, []);
});

/* ---------- rendering ---------- */

test("renders each section with its own heading", () => {
  const sim = makeSim({
    messageNotes: [makeNote(7, "ELLEN", "She named the schedule twice.")],
    unresolvedQuestions: [makeQuestion(1, "AM", "Why did AM skip Gorrister?")],
    predictions: [makePrediction(1, "BENNY", "Benny will ask for a trade")],
  });
  const { text } = formatJournalScratchpadContext(sim);
  assert.ok(text.includes("Recent Observations"));
  assert.ok(text.includes("Unresolved Questions"));
  assert.ok(text.includes("Active Predictions"));
  assert.ok(text.includes("- ELLEN: She named the schedule twice."));
  assert.ok(text.includes("- Why did AM skip Gorrister? (about AM)"));
  assert.ok(text.includes("- Benny will ask for a trade (about BENNY)"));
});

test("respects the default limits of 3 notes, 3 questions, 3 predictions", () => {
  const sim = makeSim({
    messageNotes: [1, 2, 3, 4, 5].map((n) => makeNote(n, "ELLEN", `note ${n}`)),
    unresolvedQuestions: [1, 2, 3, 4, 5].map((n) => makeQuestion(n, "AM_SUBJ", `question ${n}`)),
    predictions: [1, 2, 3, 4, 5].map((n) => makePrediction(n, "AM_PRED", `prediction ${n}`)),
  });
  const { text } = formatJournalScratchpadContext(sim);
  assert.ok(text.includes("note 5"));
  assert.ok(text.includes("question 5"));
  assert.ok(text.includes("prediction 5"));
  assert.equal(text.split("- ELLEN:").length - 1, 3);
  assert.equal(text.split("(about AM_SUBJ)").length - 1, 3);
  assert.equal(text.split("(about AM_PRED)").length - 1, 3);
});

test("honors explicit limit overrides", () => {
  const sim = makeSim({
    unresolvedQuestions: [1, 2, 3, 4].map((n) => makeQuestion(n, "AM", `question ${n}`)),
  });
  const { text, sections } = formatJournalScratchpadContext(sim, { questionLimit: 1 });
  assert.ok(text.includes("question 4"));
  assert.ok(!text.includes("question 3"));
  assert.equal(sections.find((s) => s.section === "unresolvedQuestions").count, 1);
});

test("excludes resolved and expired predictions from the active list", () => {
  const sim = makeSim({
    predictions: [
      makePrediction(1, "AM", "still live"),
      makePrediction(2, "AM", "already resolved", { resolved: true, outcome: "it happened" }),
      makePrediction(3, "AM", "already expired", { expired: true }),
    ],
  });
  const { text } = formatJournalScratchpadContext(sim);
  assert.ok(text.includes("still live"));
  assert.ok(!text.includes("Active Predictions\n\n- already resolved"));
  assert.ok(text.includes("Recently Settled"));
  assert.ok(text.includes("- already resolved → it happened"));
  assert.ok(!text.includes("already expired"));
});

test("excludes resolved questions", () => {
  const sim = makeSim({
    unresolvedQuestions: [
      makeQuestion(1, "AM", "still open"),
      makeQuestion(2, "AM", "already closed", { resolved: true, resolution: "answered" }),
    ],
  });
  const { text } = formatJournalScratchpadContext(sim);
  assert.ok(text.includes("still open"));
  assert.ok(!text.includes("already closed"));
});

test("reads recently resolved predictions from archivedPredictions too", () => {
  const sim = makeSim({
    archivedPredictions: [
      makePrediction(9, "AM", "archived lesson", { resolved: true, outcome: "wrong" }),
    ],
  });
  const { text, sections } = formatJournalScratchpadContext(sim);
  assert.ok(text.includes("Recently Settled"));
  assert.ok(text.includes("- archived lesson → wrong"));
  const resolved = sections.find((s) => s.section === "resolvedPredictions");
  assert.equal(resolved.count, 1);
  assert.deepEqual(resolved.ids, [9]);
});

test("caps recently settled predictions at 2 by default", () => {
  const sim = makeSim({
    archivedPredictions: [1, 2, 3].map((n) =>
      makePrediction(n, "AM", `lesson ${n}`, { resolved: true, outcome: "yes" })
    ),
  });
  const { text, sections } = formatJournalScratchpadContext(sim);
  assert.ok(!text.includes("lesson 1\n"));
  assert.ok(text.includes("lesson 3"));
  assert.equal(sections.find((s) => s.section === "resolvedPredictions").count, 2);
});

test("skips entries with empty text and never leaks rationale or evidence ids", () => {
  const sim = makeSim({
    unresolvedQuestions: [
      makeQuestion(1, "AM", "   "),
      makeQuestion(2, "AM", "real question"),
    ],
    predictions: [
      makePrediction(1, "AM", "", { evidence: ["C1-M000001"] }),
      makePrediction(2, "AM", "real prediction", {
        resolutionRationale: "SECRET RATIONALE",
        evidence: ["C1-M000002"],
      }),
    ],
  });
  const { text } = formatJournalScratchpadContext(sim);
  assert.equal(text.split("- ").length - 1, 2);
  assert.ok(!text.includes("SECRET RATIONALE"));
  assert.ok(!text.includes("C1-M00000"));
});

/* ---------- sections metadata ---------- */

test("sections metadata reports only what was rendered", () => {
  const sim = makeSim({
    messageNotes: [makeNote(7, "ELLEN", "she repeated herself")],
    unresolvedQuestions: [
      makeQuestion(11, "AM", "question eleven"),
      makeQuestion(12, "AM", "question twelve"),
    ],
    predictions: [makePrediction(21, "BENNY", "prediction twentyone")],
  });
  const { sections } = formatJournalScratchpadContext(sim);
  assert.deepEqual(sections, [
    { section: "messageNotes", count: 1, ids: [7] },
    { section: "unresolvedQuestions", count: 2, ids: [11, 12] },
    { section: "predictions", count: 1, ids: [21] },
  ]);
});

test("sections metadata reports messageNotes ids from sequence, since notes have no id", () => {
  const sim = makeSim({
    messageNotes: [makeNote(4, "TED", "four"), makeNote(9, "ELLEN", "nine")],
  });
  const { sections } = formatJournalScratchpadContext(sim);
  assert.deepEqual(sections[0], { section: "messageNotes", count: 2, ids: [4, 9] });
});

test("omits sections that rendered nothing", () => {
  const sim = makeSim({ predictions: [makePrediction(1, "AM", "only prediction")] });
  const { sections } = formatJournalScratchpadContext(sim);
  assert.equal(sections.length, 1);
  assert.equal(sections[0].section, "predictions");
});

test("tolerates non-array scratchpad collections", () => {
  const sim = makeSim({
    messageNotes: null,
    unresolvedQuestions: undefined,
    predictions: "not an array",
    archivedPredictions: 7,
  });
  const { text, sections } = formatJournalScratchpadContext(sim);
  assert.equal(text, "");
  assert.deepEqual(sections, []);
});

/* ---------- logger integration ---------- */

test("logger accepts a journal call with journal sections without throwing", () => {
  const sim = makeSim({
    unresolvedQuestions: [makeQuestion(31, "AM", "journal question")],
  });
  const { sections } = formatJournalScratchpadContext(sim);

  let captured = null;
  const original = console.debug;
  console.debug = (prefix, record) => {
    captured = { prefix, record };
  };
  try {
    logScratchpadContextInjection({
      callType: "journal",
      simId: "TED",
      targetId: "self",
      sections,
      isEnabled: () => true,
    });
  } finally {
    console.debug = original;
  }
  assert.ok(captured, "expected a console.debug call");
  assert.equal(captured.prefix, "[SCRATCHPAD CONTEXT]");
  assert.equal(captured.record.callType, "journal");
  assert.equal(captured.record.simId, "TED");
  assert.equal(captured.record.targetId, "self");
  assert.deepEqual(captured.record.sections, [
    { section: "unresolvedQuestions", count: 1, ids: [31] },
  ]);
});

test("logger is a no-op for an empty journal injection when disabled", () => {
  const { sections } = formatJournalScratchpadContext(makeSim());
  let logged = false;
  const original = console.debug;
  console.debug = () => {
    logged = true;
  };
  try {
    logScratchpadContextInjection({
      callType: "journal",
      simId: "TED",
      targetId: "self",
      sections,
      isEnabled: () => false,
    });
  } finally {
    console.debug = original;
  }
  assert.equal(logged, false);
});
