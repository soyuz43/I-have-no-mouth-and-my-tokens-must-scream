// js/tests/scratchpadAgencyEvidence.test.mjs
//
// Bridge-slice coverage: make agency events first-class evidence in
// the scratchpad review.
//
// THE CONTRACT MISMATCH THIS COVERS
// ---------------------------------
// The review trigger admits a prisoner who has agency events but no
// visible messages. The evidence contract used to admit only message
// references, so such a review could only ever produce NO_UPDATE —
// a wasted inference call every cycle.
//
// Five behaviors are exercised:
//
//  1. An event-only review can now cite its agency event and produce
//     a valid scratchpad operation instead of NO_UPDATE.
//
//  2. The validator accepts "agency:<cycle>:<sequence>" references
//     when the event exists and is admissible for this prisoner, and
//     rejects them when it does not.
//
//  3. The review prompt lists agency event IDs in the
//     allowed-reference section, alongside message IDs.
//
//  4. Message references still work exactly as before.
//
//  5. A review with BOTH messages and agency events may cite either.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  validateScratchpadCommsOperations,
} from "../engine/scratchpad/comms/validate.js";

import {
  parseScratchpadCommsOutput,
} from "../engine/scratchpad/comms/parse.js";

import {
  commitScratchpadCommsOperations,
} from "../engine/scratchpad/comms/commit.js";

import {
  buildVisibleAgencyEventMap,
  isAgencyEventReference,
} from "../engine/scratchpad/comms/agencyEvidence.js";

import {
  createAgencyEvent,
  getAgencyEventsForReview,
} from "../engine/agency/events.js";

import {
  buildScratchpadCommsPrompt,
} from "../prompts/scratchpadComms.js";

import {
  runScratchpadCommsReviewForSim,
} from "../engine/scratchpad/comms/orchestrator.js";

import { resetCycleEvidence } from "../engine/phases/helpers/resetCycleEvidence.js";

import {
  setMode,
  TAPE_MODES,
  hashRequest,
  recordRequest,
  clearTape,
} from "../core/replayTape.js";

import { G } from "../core/state.js";
import { makeScratchpad } from "../core/utils.js";

/* ============================================================
   FIXTURES
============================================================ */

function makeVisibleMessage(messageId = "C3-M000001") {
  return {
    messageId,
    sequence: 1,
    cycle: 3,
    kind: "MESSAGE",
    from: "ELLEN",
    to: ["TED"],
    text: "I will send the next message to TED.",
    visibility: "public",
    intent: null,
    rawIntent: null,
    normalizedIntent: null,
    intentParseStatus: null,
    autonomous: false,
    rumor: false,
  };
}

/*
 * A real agency event, built through the production factory so the
 * eventId shape and provenance are the canonical ones.
 */
function makeAgencyEvent({
  cycle = 3,
  sequence = 1,
  actorId = "TED",
  actionType = "SMOKE",
  status = "success",
  targetId = null,
  reason = null,
} = {}) {
  return createAgencyEvent(
    {
      actorId,
      action: { type: actionType },
      status,
      reason,
      operations: [],
      provenance: {
        source: "agency_resolver",
        targetId,
      },
    },
    cycle,
    sequence
  );
}

function parseOperations(operation) {
  return parseScratchpadCommsOutput(
    [
      "<SCRATCHPAD_UPDATES>",
      operation,
      "</SCRATCHPAD_UPDATES>",
    ].join("\n")
  );
}

function validateWith({
  operation,
  simId = "TED",
  messages = [],
  agencyEvents = [],
}) {
  return validateScratchpadCommsOperations({
    simId,
    parsedResult: parseOperations(operation),
    evidence: messages,
    visibleAgencyEventMap:
      buildVisibleAgencyEventMap(
        agencyEvents,
        simId
      ),
  });
}

/* ============================================================
   1. EVENT-ONLY REVIEW PRODUCES A VALID UPDATE
============================================================ */

test("an event-only review can cite its agency event instead of returning NO_UPDATE", () => {
  const event = makeAgencyEvent({
    cycle: 3,
    sequence: 1,
    actionType: "SMOKE",
    status: "blocked",
    reason: "resource_unavailable",
  });

  const result = validateWith({
    operation:
      '<QUESTION about="AM" priority="medium" refs="agency:3:1">Why was there nothing to smoke?</QUESTION>',
    agencyEvents: [event],
  });

  assert.equal(result.status, "success");
  assert.equal(result.accepted.length, 1);
  assert.equal(result.rejected.length, 0);
  assert.deepEqual(
    result.accepted[0].refs,
    ["agency:3:1"]
  );

  /*
   * The validation result reports which agency events the accepted
   * operations actually cited, so the export can distinguish an
   * agency-driven update from a message-driven one.
   */
  assert.deepEqual(
    result.referencedAgencyEventIds,
    ["agency:3:1"]
  );
});

test("every evidence-grounded operation accepts an agency event reference", () => {
  const event = makeAgencyEvent({
    cycle: 3,
    sequence: 2,
  });

  const operations = [
    '<NOTE ref="agency:3:2" confidence="0.8">I reached for it and found nothing there.</NOTE>',
    '<OTHER target="ELLEN" field="perceivedGoal" confidence="0.7" refs="agency:3:2">Ellen was seen coordinating.</OTHER>',
    '<SCORE target="ELLEN" field="perceivedTrustInMe" value="0.2" confidence="0.6" refs="agency:3:2">Outcome only.</SCORE>',
    '<QUESTION about="AM" priority="medium" refs="agency:3:2">What happened?</QUESTION>',
    '<PREDICTION about="AM" confidence="0.7" withinCycles="2" refs="agency:3:2">AM will intervene soon.</PREDICTION>',
  ];

  for (const operation of operations) {
    const result = validateWith({
      operation,
      agencyEvents: [event],
    });

    assert.equal(result.status, "success", operation);
    assert.equal(result.accepted.length, 1, operation);
    assert.deepEqual(
      result.accepted[0].refs,
      ["agency:3:2"],
      operation
    );
  }
});

test("a NOTE citing an agency event commits with the agency event as its source", () => {
  const sim = G.sims.TED;
  sim.scratchpad = makeScratchpad("TED");
  sim.scratchpad.initialized = true;

  const event = makeAgencyEvent({
    cycle: 3,
    sequence: 1,
    actionType: "SMOKE",
    status: "blocked",
    reason: "resource_unavailable",
  });

  const validationResult =
    validateWith({
      operation:
        '<NOTE ref="agency:3:1" confidence="0.8">I reached for it and there was nothing there.</NOTE>',
      agencyEvents: [event],
    });

  assert.equal(validationResult.status, "success");

  const commitResult =
    commitScratchpadCommsOperations({
      simId: "TED",
      validationResult,
      evidence: [],
      cycle: 4,
      visibleAgencyEventMap:
        buildVisibleAgencyEventMap(
          [event],
          "TED"
        ),
    });

  assert.equal(commitResult.committed, true);
  assert.equal(sim.scratchpad.messageNotes.length, 1);

  const note = sim.scratchpad.messageNotes[0];
  assert.equal(note.messageId, "agency:3:1");
  assert.equal(note.sourceEventId, "agency:3:1");
  assert.equal(note.channel, "agency");
  assert.equal(note.kind, "SMOKE");
  assert.equal(note.speaker, "TED");
});

/* ============================================================
   2. AGENCY EVENT REFERENCE VALIDATION
============================================================ */

test("an agency event reference is accepted when the event exists for this prisoner", () => {
  const event = makeAgencyEvent({
    cycle: 3,
    sequence: 1,
  });

  const result = validateWith({
    operation:
      '<OTHER target="ELLEN" field="perceivedGoal" confidence="0.7" refs="agency:3:1">Outcome.</OTHER>',
    agencyEvents: [event],
  });

  assert.equal(result.status, "success");
  assert.equal(result.accepted.length, 1);
});

test("an agency event reference is rejected when the event does not exist", () => {
  const result = validateWith({
    operation:
      '<OTHER target="ELLEN" field="perceivedGoal" confidence="0.7" refs="agency:3:99">Phantom event.</OTHER>',
    agencyEvents: [
      makeAgencyEvent({
        cycle: 3,
        sequence: 1,
      }),
    ],
  });

  assert.equal(result.status, "failure");
  assert.equal(result.accepted.length, 0);
  assert.equal(result.rejected.length, 1);
  assert.ok(
    result.rejected[0].reasons.some((reason) =>
      reason.includes("agency:3:99")
    )
  );
});

test("an agency event belonging to another prisoner is rejected", () => {
  const result = validateWith({
    operation:
      '<OTHER target="ELLEN" field="perceivedGoal" confidence="0.7" refs="agency:3:1">Not mine to cite.</OTHER>',
    simId: "BENNY",
    agencyEvents: [
      makeAgencyEvent({
        cycle: 3,
        sequence: 1,
        actorId: "TED",
      }),
    ],
  });

  assert.equal(result.status, "failure");
  assert.equal(result.rejected.length, 1);
  assert.ok(
    result.rejected[0].reasons.some((reason) =>
      reason.includes("agency:3:1")
    )
  );
});

test("a blocked action is not admissible to the prisoner it did not reach", () => {
  /*
   * A blocked action never reached its target, so the target has
   * nothing to review and cannot cite it. This mirrors the scoping
   * getAgencyEventsForReview() already applies.
   */
  const event = makeAgencyEvent({
    cycle: 3,
    sequence: 1,
    actorId: "TED",
    actionType: "TRANSFER",
    status: "blocked",
    targetId: "BENNY",
    reason: "resource_unavailable",
  });

  const result = validateWith({
    operation:
      '<OTHER target="ELLEN" field="perceivedGoal" confidence="0.7" refs="agency:3:1">Blocked transfer.</OTHER>',
    simId: "BENNY",
    agencyEvents: [event],
  });

  assert.equal(result.status, "failure");
  assert.equal(result.rejected.length, 1);
});

test("a successful action is admissible to its recipient", () => {
  const event = makeAgencyEvent({
    cycle: 3,
    sequence: 1,
    actorId: "TED",
    actionType: "TRANSFER",
    status: "success",
    targetId: "BENNY",
  });

  const result = validateWith({
    operation:
      '<QUESTION about="AM" priority="low" refs="agency:3:1">Something was handed to me.</QUESTION>',
    simId: "BENNY",
    agencyEvents: [event],
  });

  assert.equal(result.status, "success");
  assert.equal(result.accepted.length, 1);
});

test("isAgencyEventReference recognizes only the canonical agency event ID shape", () => {
  assert.equal(isAgencyEventReference("agency:3:1"), true);
  assert.equal(isAgencyEventReference("agency:12:345"), true);

  assert.equal(isAgencyEventReference("agency:3"), false);
  assert.equal(isAgencyEventReference("agency::1"), false);
  assert.equal(isAgencyEventReference("agency:3:x"), false);
  assert.equal(isAgencyEventReference("C3-M000001"), false);
  assert.equal(isAgencyEventReference("C1-O000001"), false);
  assert.equal(isAgencyEventReference(null), false);
});

test("buildVisibleAgencyEventMap scopes events to the actor and the successful recipient", () => {
  const events = [
    makeAgencyEvent({
      cycle: 3,
      sequence: 1,
      actorId: "TED",
    }),
    makeAgencyEvent({
      cycle: 3,
      sequence: 2,
      actorId: "ELLEN",
      actionType: "TRANSFER",
      status: "success",
      targetId: "TED",
    }),
    makeAgencyEvent({
      cycle: 3,
      sequence: 3,
      actorId: "BENNY",
      actionType: "TRANSFER",
      status: "blocked",
      targetId: "TED",
    }),
  ];

  const tedMap =
    buildVisibleAgencyEventMap(events, "TED");

  assert.deepEqual(
    [...tedMap.keys()].sort(),
    ["agency:3:1", "agency:3:2"]
  );

  const ellenMap =
    buildVisibleAgencyEventMap(events, "ELLEN");

  assert.deepEqual(
    [...ellenMap.keys()],
    ["agency:3:2"]
  );
});

test("buildVisibleAgencyEventMap tolerates a missing or malformed ledger", () => {
  assert.equal(
    buildVisibleAgencyEventMap(null, "TED").size,
    0
  );
  assert.equal(
    buildVisibleAgencyEventMap({}, "TED").size,
    0
  );
  assert.equal(
    buildVisibleAgencyEventMap([], "TED").size,
    0
  );
});

/* ============================================================
   3. THE PROMPT LISTS AGENCY EVENTS AS CITABLE
============================================================ */

test("the review prompt lists agency event IDs in the allowed-reference section", () => {
  const event = makeAgencyEvent({
    cycle: 3,
    sequence: 1,
    actorId: "TED",
    actionType: "SMOKE",
    status: "blocked",
    reason: "resource_unavailable",
  });

  const prompt =
    buildScratchpadCommsPrompt(
      { id: "TED", scratchpad: { initialized: true } },
      [],
      {},
      [event]
    );

  assert.match(prompt, /VALID REFERENCES/);
  assert.match(prompt, /AGENCY EVENTS YOU MAY CITE/);
  assert.match(prompt, /- agency:3:1 /);

  /*
   * The parenthetical tells the model what the event actually was,
   * so it can connect the ID it must cite with the outcome.
   */
  assert.match(
    prompt,
    /TED attempted SMOKE, blocked: resource_unavailable/
  );

  /*
   * The prompt no longer tells the model that only message IDs are
   * admissible.
   */
  assert.ok(
    !prompt.includes(
      "Use only message IDs listed in VALID MESSAGE REFERENCES"
    )
  );
});

test("the prompt shows a successful agency event as a success", () => {
  const event = makeAgencyEvent({
    cycle: 3,
    sequence: 2,
    actorId: "TED",
    actionType: "HIDE",
    status: "success",
  });

  const prompt =
    buildScratchpadCommsPrompt(
      { id: "TED", scratchpad: { initialized: true } },
      [],
      {},
      [event]
    );

  assert.match(
    prompt,
    /TED attempted HIDE, success/
  );
});

test("the prompt omits the agency reference section when there are no agency events", () => {
  const prompt =
    buildScratchpadCommsPrompt(
      { id: "TED", scratchpad: { initialized: true } },
      [],
      {},
      []
    );

  assert.ok(
    !prompt.includes("AGENCY EVENTS YOU MAY CITE")
  );
});

/* ============================================================
   4. BACKWARD COMPATIBILITY — MESSAGE REFERENCES
============================================================ */

test("message references still validate exactly as before", () => {
  const result = validateWith({
    operation:
      '<OTHER target="ELLEN" field="perceivedGoal" confidence="0.7" refs="C3-M000001">Ellen said something.</OTHER>',
    messages: [makeVisibleMessage("C3-M000001")],
  });

  assert.equal(result.status, "success");
  assert.equal(result.accepted.length, 1);
  assert.deepEqual(
    result.accepted[0].refs,
    ["C3-M000001"]
  );

  /*
   * A message-only review cites no agency events.
   */
  assert.deepEqual(
    result.referencedAgencyEventIds,
    []
  );
});

test("an unknown message reference is still rejected", () => {
  const result = validateWith({
    operation:
      '<OTHER target="ELLEN" field="perceivedGoal" confidence="0.7" refs="C9-M999999">Phantom message.</OTHER>',
    messages: [makeVisibleMessage("C3-M000001")],
  });

  assert.equal(result.status, "failure");
  assert.equal(result.accepted.length, 0);
  assert.equal(result.rejected.length, 1);
});

test("the prompt still lists message IDs as citable", () => {
  const prompt =
    buildScratchpadCommsPrompt(
      { id: "TED", scratchpad: { initialized: true } },
      [makeVisibleMessage("C3-M000001")],
      {},
      []
    );

  assert.match(prompt, /MESSAGE IDS YOU MAY CITE/);
  assert.match(prompt, /- C3-M000001/);
});

/* ============================================================
   5. MIXED EVIDENCE
============================================================ */

test("a review with both messages and agency events may cite either type", () => {
  const result = validateWith({
    operation:
      '<SCORE target="ELLEN" field="perceivedTrustInMe" value="0.4" confidence="0.6" refs="C3-M000001,agency:3:1">Combined evidence.</SCORE>',
    messages: [makeVisibleMessage("C3-M000001")],
    agencyEvents: [
      makeAgencyEvent({
        cycle: 3,
        sequence: 1,
      }),
    ],
  });

  assert.equal(result.status, "success");
  assert.deepEqual(
    result.accepted[0].refs,
    ["C3-M000001", "agency:3:1"]
  );

  assert.deepEqual(
    result.referencedAgencyEventIds,
    ["agency:3:1"]
  );
});

test("the prompt lists message IDs and agency event IDs side by side", () => {
  const prompt =
    buildScratchpadCommsPrompt(
      { id: "TED", scratchpad: { initialized: true } },
      [makeVisibleMessage("C3-M000001")],
      {},
      [
        makeAgencyEvent({
          cycle: 3,
          sequence: 1,
        }),
      ]
    );

  assert.match(prompt, /MESSAGE IDS YOU MAY CITE/);
  assert.match(prompt, /AGENCY EVENTS YOU MAY CITE/);
  assert.match(prompt, /- C3-M000001/);
  assert.match(prompt, /- agency:3:1 /);
});

/* ============================================================
   6. THE SHOWN SET AND THE CITABLE SET AGREE
============================================================ */

test("the events the prompt shows are exactly the events the prisoner may cite", () => {
  const events = [
    makeAgencyEvent({
      cycle: 3,
      sequence: 1,
      actorId: "TED",
    }),
    makeAgencyEvent({
      cycle: 3,
      sequence: 2,
      actorId: "ELLEN",
      actionType: "TRANSFER",
      status: "success",
      targetId: "TED",
    }),
  ];

  /*
   * The review cycle is 4, so the review shows the events of cycle 3.
   */
  const reviewCycle = 4;

  const shown =
    getAgencyEventsForReview(
      events,
      "TED",
      reviewCycle
    );

  const citable =
    buildVisibleAgencyEventMap(
      shown,
      "TED"
    );

  assert.deepEqual(
    [...citable.keys()].sort(),
    shown
      .map((event) => event.eventId)
      .sort()
  );
});

test("the standalone validator fallback does not widen the citable set past the shown set", () => {
  /*
   * The validator can be used without the orchestrator, in which case
   * it re-derives the admissible set from G.agency.events. That
   * fallback must apply the same prior-cycle scoping the review
   * trigger uses, otherwise it would admit events the model was
   * never shown.
   */
  const events = [
    makeAgencyEvent({
      cycle: 3,
      sequence: 1,
      actorId: "TED",
    }),
    /*
     * A SAME-cycle event. A review in cycle 4 shows the events of
     * cycle 3 only, so this one must not be citable.
     */
    makeAgencyEvent({
      cycle: 4,
      sequence: 2,
      actorId: "TED",
    }),
  ];

  const saved = {
    agency: G.agency,
    cycle: G.cycle,
  };

  try {
    G.agency = {
      ...(G.agency ?? {}),
      events,
    };
    G.cycle = 4;

    const shown =
      getAgencyEventsForReview(
        events,
        "TED",
        4
      );

    assert.deepEqual(
      shown.map((event) => event.eventId),
      ["agency:3:1"]
    );

    /*
     * No map is supplied, so the validator derives its own.
     */
    const result =
      validateScratchpadCommsOperations({
        simId: "TED",
        parsedResult: parseOperations(
          '<OTHER target="ELLEN" field="perceivedGoal" confidence="0.7" refs="agency:4:2">Same-cycle event.</OTHER>'
        ),
        evidence: [],
        reviewCycle: 4,
      });

    assert.equal(result.status, "failure");
    assert.equal(result.rejected.length, 1);

    /*
     * The prior-cycle event IS admissible through the same fallback.
     */
    const accepted =
      validateScratchpadCommsOperations({
        simId: "TED",
        parsedResult: parseOperations(
          '<OTHER target="ELLEN" field="perceivedGoal" confidence="0.7" refs="agency:3:1">Prior-cycle event.</OTHER>'
        ),
        evidence: [],
        reviewCycle: 4,
      });

    assert.equal(accepted.status, "success");
    assert.equal(accepted.accepted.length, 1);
  } finally {
    G.agency = saved.agency;
    G.cycle = saved.cycle;
  }
});

/* ============================================================
   7. END-TO-END: THE WASTED EVENT-ONLY REVIEW
============================================================ */

test("an event-only review through the orchestrator now commits a real update", async () => {
  /*
   * This is the production path the fix exists for.
   *
   * Before it, a prisoner with an agency event and no messages was
   * still sent a review prompt, but the only admissible references
   * were message IDs, so the model could only answer NO_UPDATE. The
   * call was made, the tokens were spent, and nothing was learned.
   */
  const saved = {
    cycle: G.cycle,
    agency: G.agency,
    pendingEvidence: G.pendingEvidence,
    scratchpad: G.sims.TED.scratchpad,
    model: G.models.TED,
  };

  try {
    G.cycle = 4;
    resetCycleEvidence();

    G.sims.TED.scratchpad = makeScratchpad("TED");
    G.sims.TED.scratchpad.initialized = true;

    /*
     * A prior-cycle event for TED, which is exactly what
     * getAgencyEventsForReview() surfaces for a review in cycle 4.
     */
    G.agency = {
      ...(G.agency ?? {}),
      events: [
        makeAgencyEvent({
          cycle: 3,
          sequence: 1,
          actorId: "TED",
          actionType: "SMOKE",
          status: "blocked",
          reason: "resource_unavailable",
        }),
      ],
    };

    /*
     * The replay tape intercepts the real model call, so this
     * exercises the production path rather than a stubbed one. The
     * response is pre-registered against the exact prompt the review
     * will build, which is itself the assertion that matters: the
     * prompt must name agency:3:1 as citable.
     */
    const response = [
      "<SCRATCHPAD_UPDATES>",
      '<NOTE ref="agency:3:1" confidence="0.7">I reached for it and there was nothing there.</NOTE>',
      "</SCRATCHPAD_UPDATES>",
    ].join("\n");

    const prompt =
      buildScratchpadCommsPrompt(
        G.sims.TED,
        [],
        G,
        G.agency.events
      );

    const tapeHash = hashRequest(
      prompt,
      [
        {
          role: "user",
          content:
            "Review the visible communications and return scratchpad updates now.",
        },
      ],
      null,
      1200
    );

    recordRequest(tapeHash, response, {
      purpose: "scratchpad-agency-evidence-test",
    });

    setMode(TAPE_MODES.REPLAY);

    const result =
      await runScratchpadCommsReviewForSim(
        "TED",
        {
          messages: [],
          cycle: 4,
        }
      );

    assert.equal(result.status, "committed");
    assert.equal(result.acceptedOperationCount, 1);
    assert.equal(result.rejectedOperationCount, 0);
    assert.equal(result.substantiveChanged, true);

    /*
     * The note landed in the scratchpad, sourced from the agency
     * event rather than from a message.
     */
    assert.equal(
      G.sims.TED.scratchpad.messageNotes.length,
      1
    );

    const note =
      G.sims.TED.scratchpad.messageNotes[0];

    assert.equal(note.messageId, "agency:3:1");
    assert.equal(note.sourceEventId, "agency:3:1");

    /*
     * The audit carrier records which agency events the accepted
     * operations cited, so the export can distinguish an
     * agency-driven update from a message-driven one.
     */
    const [review] =
      G.pendingEvidence.scratchpadReviewLog;

    assert.deepEqual(
      review.referencedAgencyEventIds,
      ["agency:3:1"]
    );
  } finally {
    G.cycle = saved.cycle;
    G.agency = saved.agency;
    G.pendingEvidence = saved.pendingEvidence;
    G.sims.TED.scratchpad = saved.scratchpad;
    G.models.TED = saved.model;

    setMode(TAPE_MODES.OFF);
    clearTape();
  }
});
