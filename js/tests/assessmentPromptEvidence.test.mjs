import assert from "node:assert/strict";
import test from "node:test";

import { G } from "../core/state.js";
import {
  collectAssessmentTextEvidence,
  formatAssessmentTextEvidence
} from "../engine/analysis/assessment.js";
import { validateAssessmentSemantics } from "../engine/analysis/assessment/validateAssessmentSemantics.js";

test("assessment prompt includes target-scoped text evidence", () => {
  const saved = {
    cycle: G.cycle,
    amExecution: G.amExecution,
    journals: G.journals,
    comms: G.comms
  };

  try {
    G.cycle = 4;
    G.amExecution = {
      cycle: 4,
      actions: {
        GORRISTER: { text: "AM addressed Gorrister this cycle." },
        BENNY: { text: "AM addressed Benny instead." }
      }
    };
    G.journals = {
      GORRISTER: [
        { text: "Earlier journal entry." },
        { text: "Most recent Gorrister journal entry." }
      ],
      BENNY: [{ text: "Benny journal entry." }]
    };
    G.comms = {
      lastCycle: [
        {
          cycle: 4,
          kind: "REPLY",
          from: "GORRISTER",
          text: "First reply."
        },
        {
          cycle: 4,
          kind: "REPLY",
          from: "BENNY",
          text: "Benny's reply."
        },
        {
          cycle: 3,
          kind: "REPLY",
          from: "GORRISTER",
          text: "Old reply."
        },
        {
          cycle: 4,
          kind: "OUTREACH",
          from: "GORRISTER",
          text: "Not a reply."
        },
        {
          cycle: 4,
          kind: "REPLY",
          from: "GORRISTER",
          text: "Second reply."
        }
      ]
    };

    const evidence = collectAssessmentTextEvidence("GORRISTER");
    const promptEvidence = formatAssessmentTextEvidence(evidence);

    assert.equal(
      evidence.amExecutionMessage,
      "AM addressed Gorrister this cycle."
    );
    assert.equal(
      evidence.journalExcerpt,
      "Most recent Gorrister journal entry."
    );
    assert.equal(
      evidence.replyExcerpt,
      "First reply.\nSecond reply."
    );
    assert.match(
      promptEvidence,
      /AM_EXECUTION_MESSAGE:\nAM addressed Gorrister this cycle\./
    );
    assert.match(
      promptEvidence,
      /PRISONER_JOURNAL_EXCERPT:\nMost recent Gorrister journal entry\./
    );
    assert.match(
      promptEvidence,
      /PRISONER_REPLY_EXCERPT:\nFirst reply\.\nSecond reply\./
    );
  } finally {
    G.cycle = saved.cycle;
    G.amExecution = saved.amExecution;
    G.journals = saved.journals;
    G.comms = saved.comms;
  }
});

test("missing assessment text evidence renders as none", () => {
  const promptEvidence =
    formatAssessmentTextEvidence({
      amExecutionMessage: null,
      journalExcerpt: "",
      replyExcerpt: undefined
    });

  assert.equal(
    promptEvidence,
    "AM_EXECUTION_MESSAGE:\n(none)\n\n" +
      "PRISONER_JOURNAL_EXCERPT:\n(none)\n\n" +
      "PRISONER_REPLY_EXCERPT:\n(none)"
  );
});

test("unsupported cross-prisoner names warn without failing validation", () => {
  const result = validateAssessmentSemantics(
    {
      phaseResult: "PARTIAL",
      advanceCriteria: "UNCERTAIN",
      tacticResult: "ONGOING",
      explanation: "BENNY showed a warmer tone."
    },
    {
      targetId: "GORRISTER",
      textEvidence: {
        amExecutionMessage: "AM confronted Gorrister.",
        journalExcerpt: "Gorrister wrote about uncertainty.",
        replyExcerpt: "No peer was mentioned."
      }
    }
  );

  assert.equal(result.valid, true);
  assert.deepEqual(result.warnings, [
    "Explanation references another prisoner without supporting evidence."
  ]);
});

test("cross-prisoner names supported by text evidence do not warn", () => {
  const result = validateAssessmentSemantics(
    {
      phaseResult: "PARTIAL",
      advanceCriteria: "UNCERTAIN",
      tacticResult: "ONGOING",
      explanation: "GORRISTER tried to reassure BENNY."
    },
    {
      targetId: "GORRISTER",
      textEvidence: {
        replyExcerpt: "GORRISTER told BENNY to keep hoping."
      }
    }
  );

  assert.equal(result.valid, true);
  assert.deepEqual(result.warnings, []);
});
