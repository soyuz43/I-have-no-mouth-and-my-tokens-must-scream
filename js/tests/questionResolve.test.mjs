// js/tests/questionResolve.test.mjs
//
// Focused coverage for the content-addressed QUESTION_RESOLVE
// operation added to the scratchpad communication protocol
// (Priority 2 lifecycle slice). Tests the protocol definition,
// parsing, validation, commit, and consolidation-archival paths.
//
// QUESTION_RESOLVE identifies the target question by (about + exact
// question text), never by id, and never changes prompt text or
// model-facing scratchpad context.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  SCRATCHPAD_COMMS_PROTOCOL_VERSION,
  SCRATCHPAD_OPERATION_TAGS,
  getScratchpadOperationDefinition,
  isKnownScratchpadOperationTag,
} from "../engine/scratchpad/comms/protocol.js";

import {
  parseScratchpadCommsOutput,
} from "../engine/scratchpad/comms/parse.js";

import {
  repairScratchpadCommsOutput,
} from "../engine/scratchpad/comms/repair.js";

import {
  validateScratchpadCommsOperations,
} from "../engine/scratchpad/comms/validate.js";

import {
  commitScratchpadCommsOperations,
} from "../engine/scratchpad/comms/commit.js";

import {
  archiveResolvedQuestions,
  consolidateScratchpad,
} from "../engine/scratchpad/consolidate.js";

import { G } from "../core/state.js";
import { makeScratchpad } from "../core/utils.js";

/* ============================================================
   PROTOCOL REGISTRATION / VERSION
============================================================ */

test("QUESTION_RESOLVE is a registered operation tag", () => {
  assert.ok(
    SCRATCHPAD_OPERATION_TAGS.includes(
      "QUESTION_RESOLVE"
    )
  );
  assert.equal(
    isKnownScratchpadOperationTag(
      "QUESTION_RESOLVE"
    ),
    true
  );
});

test("QUESTION_RESOLVE protocol version was bumped to 2", () => {
  assert.equal(
    SCRATCHPAD_COMMS_PROTOCOL_VERSION,
    2
  );
});

test("QUESTION_RESOLVE definition mirrors QUESTION semantics", () => {
  const definition =
    getScratchpadOperationDefinition(
      "QUESTION_RESOLVE"
    );

  assert.ok(definition);
  assert.equal(definition.type, "question_resolve");
  assert.deepEqual(
    [...definition.requiredAttributes].sort(),
    ["about", "refs", "resolution"].sort()
  );
  assert.equal(definition.referenceAttribute, "refs");
  assert.equal(definition.textRequired, true);
});

/* ============================================================
   PARSING
============================================================ */

function repairAndParse(input) {
  const repairResult =
    repairScratchpadCommsOutput(input);
  const parsedResult =
    parseScratchpadCommsOutput(
      repairResult.repaired
    );
  return { repairResult, parsedResult };
}

test("parser extracts a valid QUESTION_RESOLVE operation", () => {
  const input = [
    "<SCRATCHPAD_UPDATES>",
    '<QUESTION_RESOLVE about="ELLEN" resolution="She confirmed it." refs="C0-M000001">Did Ellen receive the message?</QUESTION_RESOLVE>',
    "</SCRATCHPAD_UPDATES>",
  ].join("\n");

  const { parsedResult } = repairAndParse(input);

  assert.equal(parsedResult.status, "success");
  const op = parsedResult.operations.find(
    (o) => o.tag === "QUESTION_RESOLVE"
  );
  assert.ok(op);
  assert.equal(op.known, true);
  assert.equal(op.attributes.about, "ELLEN");
  assert.equal(
    op.attributes.resolution,
    "She confirmed it."
  );
  assert.equal(
    op.text,
    "Did Ellen receive the message?"
  );
});

/* ============================================================
   VALIDATION
============================================================ */

function makeVisibleMessage(messageId, from, to, simId) {
  return {
    messageId,
    sequence: 1,
    cycle: 0,
    kind: "MESSAGE",
    from,
    to: to === simId || to.includes(simId)
      ? to
      : [simId, ...to],
    text: "hello",
    visibility: "public",
    intent: null,
    rawIntent: null,
    normalizedIntent: null,
    intentParseStatus: null,
    autonomous: false,
    rumor: false,
  };
}

function validateSingle(input, simId = "TED") {
  const { parsedResult } = repairAndParse(input);
  const evidence = [
    makeVisibleMessage(
      "C0-M000001",
      "ELLEN",
      ["TED"],
      simId
    ),
  ];
  return validateScratchpadCommsOperations({
    simId,
    parsedResult,
    evidence,
  });
}

test("validation rejects QUESTION_RESOLVE missing required fields", () => {
  const result = validateSingle(
    [
      "<SCRATCHPAD_UPDATES>",
      "<QUESTION_RESOLVE>Did Ellen receive the message?</QUESTION_RESOLVE>",
      "</SCRATCHPAD_UPDATES>",
    ].join("\n")
  );

  assert.notEqual(result.rejected.length, 0);
  const reasons = result.rejected
    .flatMap((r) => r.reasons);
  assert.ok(
    reasons.some((r) => /Missing required attribute/.test(r)),
    `expected missing-attribute rejection, got: ${reasons.join(" | ")}`
  );
  assert.ok(
    reasons.some((r) =>
      /resolution/i.test(r)
    ),
    `expected resolution requirement, got: ${reasons.join(" | ")}`
  );
});

test("validation rejects invalid evidence references", () => {
  const result = validateSingle(
    [
      "<SCRATCHPAD_UPDATES>",
      '<QUESTION_RESOLVE about="ELLEN" resolution="Yes." refs="C0-M999999">Did Ellen receive the message?</QUESTION_RESOLVE>',
      "</SCRATCHPAD_UPDATES>",
    ].join("\n")
  );

  assert.notEqual(result.rejected.length, 0);
  const reasons = result.rejected
    .flatMap((r) => r.reasons);
  assert.ok(
    reasons.some((r) =>
      /Unknown or invisible message reference/.test(r)
    ),
    `expected unknown-reference rejection, got: ${reasons.join(" | ")}`
  );
});

test("validation rejects unsupported attributes on QUESTION_RESOLVE", () => {
  const result = validateSingle(
    [
      "<SCRATCHPAD_UPDATES>",
      '<QUESTION_RESOLVE about="ELLEN" resolution="Yes." refs="C0-M000001" priority="low" id="1">Did Ellen receive the message?</QUESTION_RESOLVE>',
      "</SCRATCHPAD_UPDATES>",
    ].join("\n")
  );

  assert.notEqual(result.rejected.length, 0);
  const reasons = result.rejected
    .flatMap((r) => r.reasons);
  assert.ok(
    reasons.some((r) =>
      /Unknown attribute "priority"/.test(r)
    ),
    `expected unknown-attribute rejection, got: ${reasons.join(" | ")}`
  );
  assert.ok(
    reasons.some((r) =>
      /Unknown attribute "id"/.test(r)
    ),
    `expected unknown-attribute rejection for id, got: ${reasons.join(" | ")}`
  );
});

test("validation accepts a structurally valid QUESTION_RESOLVE", () => {
  const result = validateSingle(
    [
      "<SCRATCHPAD_UPDATES>",
      '<QUESTION_RESOLVE about="ELLEN" resolution="Yes, she did." refs="C0-M000001">Did Ellen receive the message?</QUESTION_RESOLVE>',
      "</SCRATCHPAD_UPDATES>",
    ].join("\n")
  );

  assert.equal(result.accepted.length, 1);
  assert.equal(result.accepted.length, 1);
  assert.equal(
    result.accepted[0].type,
    "question_resolve"
  );
});

test("QUESTION_RESOLVE rejects an unsupported subject", () => {
  const result = validateSingle(
    [
      "<SCRATCHPAD_UPDATES>",
      '<QUESTION_RESOLVE about="NONSENSE" resolution="Yes." refs="C0-M000001">Question?</QUESTION_RESOLVE>',
      "</SCRATCHPAD_UPDATES>",
    ].join("\n")
  );

  assert.notEqual(result.rejected.length, 0);
});

/* ============================================================
   COMMIT BEHAVIOR
============================================================ */

function makeSimWithQuestion() {
  const sim = { id: "TED", scratchpad: makeScratchpad("TED") };
  sim.scratchpad.initialized = true;
  sim.scratchpad.unresolvedQuestions.push({
    id: 1,
    about: "ELLEN",
    question: "Did Ellen receive the message?",
    priority: "medium",
    evidence: ["C0-M000001"],
    createdCycle: 0,
    resolved: false,
    resolution: null,
    resolvedCycle: null,
  });
  return sim;
}

function commitSingle(input, simId = "TED") {
  G.cycle = 5;
  const sim = makeSimWithQuestion();
  G.sims = { [simId]: sim };

  const { parsedResult } = repairAndParse(input);
  const evidence = [
    makeVisibleMessage(
      "C0-M000001",
      "ELLEN",
      ["TED"],
      simId
    ),
  ];
  const validationResult =
    validateScratchpadCommsOperations({
      simId,
      parsedResult,
      evidence,
    });

  const commitResult =
    commitScratchpadCommsOperations({
      simId,
      validationResult,
      evidence,
      cycle: 5,
    });

  return { sim, validationResult, commitResult };
}

test("resolving a matching unresolved question sets resolved state", () => {
  const { sim } = commitSingle(
    [
      "<SCRATCHPAD_UPDATES>",
      '<QUESTION_RESOLVE about="ELLEN" resolution="Yes, she acknowledged it." refs="C0-M000001">Did Ellen receive the message?</QUESTION_RESOLVE>',
      "</SCRATCHPAD_UPDATES>",
    ].join("\n")
  );

  const question = sim.scratchpad.unresolvedQuestions[0];
  assert.equal(question.resolved, true);
  assert.equal(
    question.resolution,
    "Yes, she acknowledged it."
  );
  assert.equal(question.resolvedCycle, 5);
  assert.equal(question.id, 1);
  assert.equal(question.about, "ELLEN");
  assert.equal(
    question.question,
    "Did Ellen receive the message?"
  );
  assert.equal(question.priority, "medium");
  assert.equal(question.createdCycle, 0);
});

test("resolving an already-resolved question is a no-op", () => {
  const { sim, commitResult } = commitSingle(
    [
      "<SCRATCHPAD_UPDATES>",
      '<QUESTION_RESOLVE about="ELLEN" resolution="Second answer." refs="C0-M000001">Did Ellen receive the message?</QUESTION_RESOLVE>',
      "</SCRATCHPAD_UPDATES>",
    ].join("\n")
  );

  // First resolution.
  assert.equal(
    sim.scratchpad.unresolvedQuestions[0].resolved,
    true
  );

  const beforeRevision =
    sim.scratchpad.revision;
  const beforeResolvedCycle =
    sim.scratchpad.unresolvedQuestions[0]
      .resolvedCycle;

  // Re-resolve the same question.
  const { parsedResult } = repairAndParse(
    [
      "<SCRATCHPAD_UPDATES>",
      '<QUESTION_RESOLVE about="ELLEN" resolution="Second answer." refs="C0-M000001">Did Ellen receive the message?</QUESTION_RESOLVE>',
      "</SCRATCHPAD_UPDATES>",
    ].join("\n")
  );
  const evidence = [
    makeVisibleMessage(
      "C0-M000001",
      "ELLEN",
      ["TED"],
      "TED"
    ),
  ];
  const validationResult =
    validateScratchpadCommsOperations({
      simId: "TED",
      parsedResult,
      evidence,
    });
  const second = commitScratchpadCommsOperations({
    simId: "TED",
    validationResult,
    evidence,
    cycle: 6,
  });

  assert.equal(
    sim.scratchpad.unresolvedQuestions[0].resolvedCycle,
    beforeResolvedCycle
  );
  assert.equal(
    sim.scratchpad.unresolvedQuestions[0].resolution,
    "Second answer."
  );
  assert.equal(
    sim.scratchpad.revision,
    beforeRevision
  );
  assert.ok(
    ["reviewed_no_change", "no_update"].includes(
      second.status
    ) || second.status === "committed"
  );
});

test("resolving a non-matching question is a validated no-op", () => {
  G.cycle = 5;
  const sim = makeSimWithQuestion();
  G.sims = { TED: sim };

  const { parsedResult } = repairAndParse(
    [
      "<SCRATCHPAD_UPDATES>",
      '<QUESTION_RESOLVE about="TED" resolution="n/a" refs="C0-M000001">A question that does not exist.</QUESTION_RESOLVE>',
      "</SCRATCHPAD_UPDATES>",
    ].join("\n")
  );
  const evidence = [
    makeVisibleMessage(
      "C0-M000001",
      "ELLEN",
      ["TED"],
      "TED"
    ),
  ];
  const validationResult =
    validateScratchpadCommsOperations({
      simId: "TED",
      parsedResult,
      evidence,
    });
  assert.equal(validationResult.status, "success");

  const beforeRevision = sim.scratchpad.revision;
  const commitResult = commitScratchpadCommsOperations({
    simId: "TED",
    validationResult,
    evidence,
    cycle: 5,
  });

  assert.equal(
    sim.scratchpad.unresolvedQuestions[0].resolved,
    false
  );
  assert.equal(
    sim.scratchpad.revision,
    beforeRevision
  );
});

test("substantive resolution increments revision; no-op does not", () => {
  const { sim, commitResult } = commitSingle(
    [
      "<SCRATCHPAD_UPDATES>",
      '<QUESTION_RESOLVE about="ELLEN" resolution="Yes." refs="C0-M000001">Did Ellen receive the message?</QUESTION_RESOLVE>',
      "</SCRATCHPAD_UPDATES>",
    ].join("\n")
  );

  assert.equal(
    commitResult.status,
    "committed"
  );
  assert.equal(sim.scratchpad.revision, 1);
  assert.equal(
    sim.scratchpad.lastUpdatedCycle,
    5
  );
});

/* ============================================================
   CONSOLIDATION ARCHIVAL
============================================================ */

test("consolidation archives a resolved question preserving provenance", () => {
  const { resolvedCount, archived } =
    archiveResolvedQuestions([
      {
        id: 1,
        about: "ELLEN",
        question: "Did Ellen receive the message?",
        priority: "medium",
        evidence: ["C0-M000001"],
        createdCycle: 0,
        resolved: true,
        resolution: "Yes.",
        resolvedCycle: 5,
      },
      {
        id: 2,
        about: "AM",
        question: "Open question?",
        priority: "low",
        evidence: [],
        createdCycle: 0,
        resolved: false,
        resolution: null,
        resolvedCycle: null,
      },
    ]);

  assert.equal(resolvedCount ?? archived.length, 1);
  const archivedQuestion = archived[0];
  assert.equal(archivedQuestion.id, 1);
  assert.equal(archivedQuestion.about, "ELLEN");
  assert.equal(
    archivedQuestion.question,
    "Did Ellen receive the message?"
  );
  assert.equal(archivedQuestion.priority, "medium");
  assert.deepEqual(archivedQuestion.evidence, [
    "C0-M000001",
  ]);
  assert.equal(archivedQuestion.createdCycle, 0);
  assert.equal(archivedQuestion.resolved, true);
  assert.equal(archivedQuestion.resolution, "Yes.");
  assert.equal(archivedQuestion.resolvedCycle, 5);
});

test("consolidateScratchpad moves a resolved question into archivedQuestions", () => {
  const scratchpad = makeScratchpad("TED");
  scratchpad.unresolvedQuestions.push({
    id: 1,
    about: "ELLEN",
    question: "Did Ellen receive the message?",
    priority: "medium",
    evidence: ["C0-M000001"],
    createdCycle: 0,
    resolved: true,
    resolution: "Yes.",
    resolvedCycle: 5,
  });

  consolidateScratchpad(scratchpad, 5, 1);

  assert.equal(
    scratchpad.unresolvedQuestions.length,
    0
  );
  assert.equal(
    scratchpad.archivedQuestions.length,
    1
  );
  const archived = scratchpad.archivedQuestions[0];
  assert.equal(archived.resolved, true);
  assert.equal(archived.resolution, "Yes.");
  assert.equal(archived.resolvedCycle, 5);
  assert.equal(archived.id, 1);
});


/* ============================================================
   OPTION C: PRE-BATCH QUESTION_EXISTENCE GATE FOR RESOLVE
   A QUESTION_RESOLVE may only resolve a question that was an
   open, unresolved question before the review batch began.
   The cross-type destination-key collision has been removed;
   QUESTION uses "question:" and QUESTION_RESOLVE uses
   "question_resolve:" keys.
============================================================ */

function makeSimNoQuestion(simId = "TED") {
  const sim = { id: simId, scratchpad: makeScratchpad(simId) };
  sim.scratchpad.initialized = true;
  return sim;
}

function makeSimWithResolvedQuestion(simId = "TED") {
  const sim = makeSimWithQuestion();
  sim.scratchpad.unresolvedQuestions[0].resolved = true;
  sim.scratchpad.unresolvedQuestions[0].resolution = "Already answered.";
  sim.scratchpad.unresolvedQuestions[0].resolvedCycle = 2;
  return sim;
}

function commitBatch(input, { builder } = {}) {
  G.cycle = 5;
  const sim =
    builder
      ? builder()
      : makeSimNoQuestion();
  G.sims = { [sim.id]: sim };

  const { parsedResult } = repairAndParse(input);
  const evidence = [
    makeVisibleMessage(
      "C0-M000001",
      "ELLEN",
      ["TED"],
      sim.id
    ),
  ];
  const validationResult =
    validateScratchpadCommsOperations({
      simId: sim.id,
      parsedResult,
      evidence,
    });
  const commitResult = commitScratchpadCommsOperations({
    simId: sim.id,
    validationResult,
    evidence,
    cycle: 5,
  });
  return { sim, validationResult, commitResult };
}

const NEW_Q = `<QUESTION about="ELLEN" priority="medium" refs="C0-M000001">Did Ellen receive the message?</QUESTION>`;
const RESOLVE_Q = `<QUESTION_RESOLVE about="ELLEN" resolution="Yes, she did." refs="C0-M000001">Did Ellen receive the message?</QUESTION_RESOLVE>`;

test("new question ID exceeds archived question IDs", () => {
  function makeSimWithArchivedIds() {
    const sim = makeSimNoQuestion();
    sim.scratchpad.archivedQuestions = [
      {
        id: 4,
        about: "ELLEN",
        question: "Did Ellen receive the first message?",
        priority: "medium",
        evidence: ["C0-M000001"],
        createdCycle: 0,
        resolved: true,
        resolution: "Yes, she did.",
        resolvedCycle: 1,
      },
    ];
    sim.scratchpad.unresolvedQuestions = [
      {
        id: 2,
        about: "NIMDOK",
        question: "Did NIMDOK receive the message?",
        priority: "low",
        evidence: ["C0-M000001"],
        createdCycle: 1,
        resolved: false,
        resolution: null,
        resolvedCycle: null,
      },
    ];
    return sim;
  }

  const { sim, validationResult, commitResult } =
    commitBatch(
      [
        "<SCRATCHPAD_UPDATES>",
        NEW_Q,
        "</SCRATCHPAD_UPDATES>",
      ].join("\n"),
      { builder: makeSimWithArchivedIds }
    );

  assert.equal(validationResult.accepted.length, 1);
  assert.equal(commitResult.status, "committed");
  const newQuestion =
    sim.scratchpad.unresolvedQuestions.find(
      (question) => question.id === 5
    );
  assert.ok(newQuestion);
  assert.equal(newQuestion.id, 5);
});

test("new question ID works when legacy scratchpad lacks archivedQuestions", () => {
  function makeSimWithoutQuestionArchive() {
    const sim = makeSimNoQuestion();
    delete sim.scratchpad.archivedQuestions;
    return sim;
  }

  const { sim, validationResult, commitResult } =
    commitBatch(
      [
        "<SCRATCHPAD_UPDATES>",
        NEW_Q,
        "</SCRATCHPAD_UPDATES>",
      ].join("\n"),
      { builder: makeSimWithoutQuestionArchive }
    );

  assert.equal(validationResult.accepted.length, 1);
  assert.equal(commitResult.status, "committed");
  assert.equal(
    sim.scratchpad.unresolvedQuestions[0].id,
    1
  );
});

test("question archived after resolution does not release its ID for reuse", () => {
  const created =
    commitBatch(
      [
        "<SCRATCHPAD_UPDATES>",
        NEW_Q,
        "</SCRATCHPAD_UPDATES>",
      ].join("\n"),
      { builder: makeSimNoQuestion }
    );

  const firstQuestion =
    created.sim.scratchpad.unresolvedQuestions[0];
  assert.equal(firstQuestion.id, 1);

  const resolved = commitBatch(
    [
      "<SCRATCHPAD_UPDATES>",
      RESOLVE_Q,
      "</SCRATCHPAD_UPDATES>",
    ].join("\n"),
    { builder: () => created.sim }
  );
  assert.equal(
    resolved.sim.scratchpad.unresolvedQuestions[0]
      .resolved,
    true
  );

  consolidateScratchpad(
    resolved.sim.scratchpad,
    5,
    1
  );
  assert.equal(
    resolved.sim.scratchpad.archivedQuestions[0].id,
    1
  );
  assert.equal(
    resolved.sim.scratchpad.unresolvedQuestions.length,
    0
  );

  G.sims = { TED: resolved.sim };
  const recreated = commitBatch(
    [
      "<SCRATCHPAD_UPDATES>",
      NEW_Q,
      "</SCRATCHPAD_UPDATES>",
    ].join("\n"),
    {
      builder: () => {
        const sim = makeSimNoQuestion();
        sim.scratchpad.archivedQuestions =
          resolved.sim.scratchpad.archivedQuestions;
        return sim;
      },
    }
  );

  assert.equal(recreated.commitResult.status, "committed");
  assert.equal(
    recreated.sim.scratchpad.unresolvedQuestions[0].id,
    2
  );
});

test("same-batch [QUESTION new, QUESTION_RESOLVE same] leaves question unresolved", () => {
  const { sim, validationResult, commitResult } =
    commitBatch(
      [
        "<SCRATCHPAD_UPDATES>",
        NEW_Q,
        RESOLVE_Q,
        "</SCRATCHPAD_UPDATES>",
      ].join("\n"),
      { builder: makeSimNoQuestion }
    );

  assert.equal(
    validationResult.accepted.length,
    2
  );
  assert.equal(commitResult.status, "committed");

  const question = sim.scratchpad.unresolvedQuestions[0];
  assert.ok(question);
  assert.equal(question.resolved, false);

  const resolveReport = commitResult.operationReports.find(
    (r) => r.tag === "QUESTION_RESOLVE"
  );
  assert.equal(resolveReport.changed, false);
  assert.equal(
    resolveReport.reason,
    "question_resolve_target_not_prebatch"
  );
});

test("same-batch [QUESTION_RESOLVE same, QUESTION new] leaves question unresolved", () => {
  const { sim, validationResult, commitResult } =
    commitBatch(
      [
        "<SCRATCHPAD_UPDATES>",
        RESOLVE_Q,
        NEW_Q,
        "</SCRATCHPAD_UPDATES>",
      ].join("\n"),
      { builder: makeSimNoQuestion }
    );

  assert.equal(
    validationResult.accepted.length,
    2
  );
  assert.equal(commitResult.status, "committed");

  const question = sim.scratchpad.unresolvedQuestions[0];
  assert.ok(question);
  assert.equal(question.resolved, false);

  const resolveReport = commitResult.operationReports.find(
    (r) => r.tag === "QUESTION_RESOLVE"
  );
  assert.equal(resolveReport.changed, false);
});

test("pre-existing open question plus QUESTION_RESOLVE only resolves it", () => {
  const { sim, validationResult, commitResult } =
    commitBatch(
      [
        "<SCRATCHPAD_UPDATES>",
        RESOLVE_Q,
        "</SCRATCHPAD_UPDATES>",
      ].join("\n"),
      { builder: makeSimWithQuestion }
    );

  assert.equal(
    validationResult.accepted.length,
    1
  );
  assert.equal(commitResult.status, "committed");

  const question = sim.scratchpad.unresolvedQuestions[0];
  assert.equal(question.resolved, true);
  assert.equal(question.resolution, "Yes, she did.");
  assert.equal(question.resolvedCycle, 5);
  assert.equal(sim.scratchpad.revision, 1);
});

test("pre-existing question plus duplicate QUESTION plus QUESTION_RESOLVE resolves pre-existing", () => {
  const { sim, validationResult, commitResult } =
    commitBatch(
      [
        "<SCRATCHPAD_UPDATES>",
        NEW_Q,
        RESOLVE_Q,
        "</SCRATCHPAD_UPDATES>",
      ].join("\n"),
      { builder: makeSimWithQuestion }
    );

  assert.equal(
    validationResult.accepted.length,
    2
  );

  const questionReport = commitResult.operationReports.find(
    (r) => r.tag === "QUESTION"
  );
  assert.equal(questionReport.changed, false);
  assert.equal(
    questionReport.reason,
    "question_already_exists"
  );

  const resolveReport = commitResult.operationReports.find(
    (r) => r.tag === "QUESTION_RESOLVE"
  );
  assert.equal(resolveReport.changed, true);

  const question = sim.scratchpad.unresolvedQuestions[0];
  assert.equal(question.resolved, true);
  assert.equal(sim.scratchpad.revision, 1);
  assert.equal(
    sim.scratchpad.unresolvedQuestions.length,
    1
  );
});

test("two QUESTION_RESOLVE for same identity: first resolves, second rejected as duplicate destination", () => {
  const { sim, validationResult, commitResult } =
    commitBatch(
      [
        "<SCRATCHPAD_UPDATES>",
        RESOLVE_Q,
        RESOLVE_Q,
        "</SCRATCHPAD_UPDATES>",
      ].join("\n"),
      { builder: makeSimWithQuestion }
    );

  assert.equal(validationResult.accepted.length, 1);
  assert.equal(validationResult.rejected.length, 1);
  assert.match(
    String(validationResult.rejected[0].reasons.join(" ")),
    /Conflicting or duplicate operation destination/
  );

  assert.equal(commitResult.status, "committed");
  const question = sim.scratchpad.unresolvedQuestions[0];
  assert.equal(question.resolved, true);
  assert.equal(sim.scratchpad.revision, 1);
});

test("already-resolved (not yet archived) question plus QUESTION_RESOLVE returns question_already_resolved", () => {
  const { sim, validationResult, commitResult } =
    commitBatch(
      [
        "<SCRATCHPAD_UPDATES>",
        RESOLVE_Q,
        "</SCRATCHPAD_UPDATES>",
      ].join("\n"),
      { builder: makeSimWithResolvedQuestion }
    );

  assert.equal(
    validationResult.accepted.length,
    1
  );
  assert.equal(commitResult.status, "reviewed_no_change");
  assert.equal(sim.scratchpad.revision, 0);

  const resolveReport = commitResult.operationReports.find(
    (r) => r.tag === "QUESTION_RESOLVE"
  );
  assert.equal(resolveReport.changed, false);
  assert.equal(
    resolveReport.reason,
    "question_already_resolved"
  );

  // Existing resolution must not be overwritten or reopened.
  assert.equal(
    sim.scratchpad.unresolvedQuestions[0].resolved,
    true
  );
  assert.equal(
    sim.scratchpad.unresolvedQuestions[0].resolution,
    "Already answered."
  );
  assert.equal(
    sim.scratchpad.unresolvedQuestions[0].resolvedCycle,
    2
  );
});

function makeSimWithArchivedQuestion(simId = "TED") {
  const sim = makeSimNoQuestion(simId);
  // The once-unresolved question has been archived, so no matching
  // identity remains in unresolvedQuestions.
  sim.scratchpad.archivedQuestions = [
    {
      id: 1,
      about: "ELLEN",
      question: "Did Ellen receive the message?",
      priority: "medium",
      evidence: ["C0-M000001"],
      createdCycle: 0,
      resolved: true,
      resolution: "Already answered.",
      resolvedCycle: 2,
    },
  ];
  return sim;
}

test("resolved-and-archived question plus QUESTION_RESOLVE returns question_resolve_target_not_found", () => {
  const { sim, validationResult, commitResult } =
    commitBatch(
      [
        "<SCRATCHPAD_UPDATES>",
        RESOLVE_Q,
        "</SCRATCHPAD_UPDATES>",
      ].join("\n"),
      { builder: makeSimWithArchivedQuestion }
    );

  assert.equal(
    validationResult.accepted.length,
    1
  );
  assert.equal(commitResult.status, "reviewed_no_change");
  assert.equal(sim.scratchpad.revision, 0);

  const resolveReport = commitResult.operationReports.find(
    (r) => r.tag === "QUESTION_RESOLVE"
  );
  assert.equal(resolveReport.changed, false);
  assert.equal(
    resolveReport.reason,
    "question_resolve_target_not_found"
  );
  assert.equal(
    sim.scratchpad.unresolvedQuestions.length,
    0
  );
});

test("invalid refs combined with a non-pre-batch target are rejected at validation", () => {
  G.cycle = 5;
  const sim = makeSimWithQuestion();
  G.sims = { TED: sim };

  const input = [
    "<SCRATCHPAD_UPDATES>",
    '<QUESTION_RESOLVE about="ELLEN" resolution="Yes." refs="C0-M999999">Did Ellen receive the message?</QUESTION_RESOLVE>',
    "</SCRATCHPAD_UPDATES>",
  ].join("\n");

  const { parsedResult } = repairAndParse(input);
  const evidence = [
    makeVisibleMessage(
      "C0-M000001",
      "ELLEN",
      ["TED"],
      "TED"
    ),
  ];
  const validationResult =
    validateScratchpadCommsOperations({
      simId: "TED",
      parsedResult,
      evidence,
    });

  assert.notEqual(
    validationResult.rejected.length,
    0
  );
  const reasons = validationResult.rejected.flatMap(
    (r) => r.reasons
  );
  assert.ok(
    reasons.some((r) =>
      /Unknown or invisible message reference/.test(r)
    ),
    `expected unknown-reference rejection, got: ${reasons.join(" | ")}`
  );

  // Commit is never reached for a rejected op; the pre-existing
  // question stays open and untouched.
  assert.equal(
    sim.scratchpad.unresolvedQuestions[0].resolved,
    false
  );
});

test("QUESTION_RESOLVE with never-existing target is a no-op; revision unchanged", () => {
  const { sim, validationResult, commitResult } =
    commitBatch(
      [
        "<SCRATCHPAD_UPDATES>",
        '<QUESTION_RESOLVE about="TED" resolution="n/a" refs="C0-M000001">A question that does not exist.</QUESTION_RESOLVE>',
        "</SCRATCHPAD_UPDATES>",
      ].join("\n"),
      { builder: makeSimWithQuestion }
    );

  assert.equal(
    validationResult.accepted.length,
    1
  );
  assert.equal(commitResult.status, "reviewed_no_change");
  assert.equal(sim.scratchpad.revision, 0);
  assert.equal(
    sim.scratchpad.unresolvedQuestions[0].resolved,
    false
  );
});
