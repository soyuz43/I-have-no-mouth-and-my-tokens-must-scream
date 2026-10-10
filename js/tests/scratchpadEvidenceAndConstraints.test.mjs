// js/tests/scratchpadEvidenceAndConstraints.test.mjs
//
// Bridge-slice coverage: connect the Agency Phase sensors and the
// canonical Overhearing Ledger to the Scratchpad system.
//
// Four behaviors are exercised:
//
//  1. Scratchpad evidence validation accepts canonical overhearing
//     eventIds (e.g. "C1-O000001") as valid references alongside
//     messageIds, and rejects eventIds the prisoner did not perceive
//     or that do not exist.
//
//  2. generatePhysicalStateUpdate() deterministically derives an
//     engine-owned physicalLimitations token list from Agency Phase
//     capability bands, without any model call.
//
//  3. The physicalLimitations field is (a) initialized by
//     makeScratchpad(), (b) populated atomically by the commit path
//     from G.agency.capabilities, and (c) rendered into the compact
//     scratchpad prompt context.
//
//  4. NOTE operations citing an overhearing event commit into a
//     canonical note record carrying sourceEventId and an "overheard"
//     channel.

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
  generatePhysicalStateUpdate,
  physicalLimitationsChanged,
} from "../engine/scratchpad/physicalState.js";

import {
  buildVisibleOverhearingEventMap,
  eventPermitsTextReference,
} from "../engine/scratchpad/comms/overhearingEvidence.js";

import {
  formatCompactScratchpadContext,
  formatCompactScratchpadContextWithSections,
} from "../prompts/utils/formatCompactScratchpadContext.js";

import { G } from "../core/state.js";
import { makeScratchpad } from "../core/utils.js";

/* ============================================================
   FIXTURES
============================================================ */

function makeVisibleMessage(messageId) {
  return {
    messageId,
    sequence: 1,
    cycle: 0,
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

function makeOverhearingEvent({
  eventId = "C1-O000001",
  listener = "TED",
  from = "ELLEN",
  to = "BENNY",
  outcome = "full",
  perceivedText = "Meet me by the wall.",
} = {}) {
  return {
    eventId,
    sequence: 1,
    cycle: 1,
    listener,
    participants: { from, to },
    outcome,
    sourceMessageIds: ["C1-M000001"],
    sourceKind: "MESSAGE",
    observations: [
      {
        sourceMessageId: "C1-M000001",
        sourceMessageSequence: 1,
        perception: outcome === "full" ? "full" : outcome,
        text: perceivedText,
        characterRange: null,
      },
    ],
  };
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

const NORMAL_BANDS = {
  handUse: "normal",
  concentration: "normal",
  mobility: "normal",
  stability: "normal",
  interactionReach: "normal",
};

function validateWith({
  operation,
  simId = "TED",
  messages = [makeVisibleMessage("C0-M000001")],
  overhearing = { history: [makeOverhearingEvent()] },
  eventMap,
}) {
  const args = {
    simId,
    parsedResult: parseOperations(operation),
    evidence: messages,
  };

  if (eventMap !== undefined) {
    args.visibleEventMap = eventMap;
  } else if (overhearing) {
    args.visibleEventMap =
      buildVisibleOverhearingEventMap(overhearing, simId);
  }

  return validateScratchpadCommsOperations(args);
}

/* ============================================================
   1. OVERHEARING EVENT-ID VALIDATION
============================================================ */

test("OTHER referencing a perceived overhearing eventId is accepted", () => {
  const result = validateWith({
    operation:
      '<OTHER target="ELLEN" field="perceivedGoal" confidence="0.7" refs="C1-O000001">Ellen was seen coordinating with BENNY.</OTHER>',
  });

  assert.equal(result.status, "success");
  assert.equal(result.accepted.length, 1);
  assert.equal(result.rejected.length, 0);
  assert.deepEqual(result.accepted[0].refs, ["C1-O000001"]);
});

test("NOTE referencing a perceived overhearing eventId is accepted", () => {
  const result = validateWith({
    operation:
      '<NOTE ref="C1-O000001" confidence="0.8">They met by the wall and spoke quietly.</NOTE>',
  });

  assert.equal(result.status, "success");
  assert.equal(result.accepted.length, 1);
  assert.equal(result.accepted[0].messageId, "C1-O000001");
});

test("SCORE referencing a perceived overhearing eventId is accepted", () => {
  const result = validateWith({
    operation:
      '<SCORE target="ELLEN" field="perceivedTrustInMe" value="0.2" confidence="0.6" refs="C1-O000001">Ellen excluded TED from the exchange.</SCORE>',
  });

  assert.equal(result.status, "success");
  assert.deepEqual(result.accepted[0].refs, ["C1-O000001"]);
});

test("QUESTION and PREDICTION accept perceived overhearing eventIds", () => {
  const operations = [
    '<QUESTION about="ELLEN" priority="medium" refs="C1-O000001">Did Ellen meet Benny?</QUESTION>',
    '<PREDICTION about="AM" confidence="0.7" withinCycles="2" refs="C1-O000001">AM will intervene soon.</PREDICTION>',
  ];

  for (const operation of operations) {
    const result = validateWith({ operation });
    assert.equal(result.status, "success", operation);
    assert.equal(result.accepted.length, 1, operation);
    assert.deepEqual(result.accepted[0].refs, ["C1-O000001"]);
  }
});

test("mixed messageId and eventId references are accepted together", () => {
  const result = validateWith({
    operation:
      '<SCORE target="ELLEN" field="perceivedTrustInMe" value="0.4" confidence="0.6" refs="C0-M000001,C1-O000001">Combined evidence.</SCORE>',
  });

  assert.equal(result.status, "success");
  assert.deepEqual(result.accepted[0].refs, [
    "C0-M000001",
    "C1-O000001",
  ]);
});

test("reference to a non-existent eventId is rejected", () => {
  const result = validateWith({
    operation:
      '<OTHER target="ELLEN" field="perceivedGoal" confidence="0.7" refs="C9-O999999">Phantom event.</OTHER>',
  });

  assert.equal(result.status, "failure");
  assert.equal(result.accepted.length, 0);
  assert.equal(result.rejected.length, 1);
  assert.ok(
    result.rejected[0].reasons.some((reason) =>
      reason.includes("C9-O999999")
    )
  );
});

test("eventId perceived by another prisoner is rejected", () => {
  const bennyEvent = makeOverhearingEvent({
    eventId: "C1-O000002",
    listener: "BENNY",
    from: "ELLEN",
    to: "GORRISTER",
  });

  const result = validateWith({
    operation:
      '<OTHER target="ELLEN" field="perceivedGoal" confidence="0.7" refs="C1-O000002">TED did not hear this.</OTHER>',
    overhearing: { history: [bennyEvent] },
  });

  assert.equal(result.status, "failure");
  assert.equal(result.rejected.length, 1);
  assert.ok(
    result.rejected[0].reasons.some((reason) =>
      reason.includes("C1-O000002")
    )
  );
});

test("buildVisibleOverhearingEventMap filters by listener", () => {
  const history = [
    makeOverhearingEvent({ eventId: "C1-O000001", listener: "TED" }),
    makeOverhearingEvent({ eventId: "C1-O000002", listener: "BENNY" }),
  ];

  const tedMap = buildVisibleOverhearingEventMap(
    { history },
    "TED"
  );

  assert.deepEqual([...tedMap.keys()], ["C1-O000001"]);

  const bennyMap = buildVisibleOverhearingEventMap(
    { history },
    "BENNY"
  );

  assert.deepEqual([...bennyMap.keys()], ["C1-O000002"]);
});

test("buildVisibleOverhearingEventMap tolerates a malformed ledger", () => {
  assert.equal(
    buildVisibleOverhearingEventMap(null, "TED").size,
    0
  );
  assert.equal(
    buildVisibleOverhearingEventMap({}, "TED").size,
    0
  );
  assert.equal(
    buildVisibleOverhearingEventMap({ history: [] }, "TED").size,
    0
  );
});

// This directly tests a utility with no production callers, retained for
// future enforcement of the perceived-text distinction.
test("eventPermitsTextReference distinguishes observed_only events", () => {
  const map = buildVisibleOverhearingEventMap(
    {
      history: [
        makeOverhearingEvent({
          eventId: "C1-O000010",
          outcome: "full",
        }),
        makeOverhearingEvent({
          eventId: "C1-O000011",
          outcome: "observed_only",
          perceivedText: null,
        }),
      ],
    },
    "TED"
  );

  assert.equal(
    eventPermitsTextReference(map.get("C1-O000010")),
    true
  );
  assert.equal(
    eventPermitsTextReference(map.get("C1-O000011")),
    false
  );
});

/* ============================================================
   2. generatePhysicalStateUpdate
============================================================ */

test("generatePhysicalStateUpdate returns [] for all-normal bands", () => {
  assert.deepEqual(
    generatePhysicalStateUpdate({ id: "TED" }, { bands: { ...NORMAL_BANDS } }),
    []
  );
});

test("generatePhysicalStateUpdate tolerates missing envelopes", () => {
  assert.deepEqual(
    generatePhysicalStateUpdate({ id: "TED" }, null),
    []
  );
  assert.deepEqual(
    generatePhysicalStateUpdate({ id: "TED" }, undefined),
    []
  );
  assert.deepEqual(
    generatePhysicalStateUpdate({ id: "TED" }, {}),
    []
  );
  assert.deepEqual(
    generatePhysicalStateUpdate({ id: "TED" }, { bands: null }),
    []
  );
});

test("generatePhysicalStateUpdate maps every unavailable band to its token", () => {
  assert.deepEqual(
    generatePhysicalStateUpdate({ id: "TED" }, {
      bands: {
        handUse: "unavailable",
        concentration: "unavailable",
        mobility: "unavailable",
        stability: "unavailable",
        interactionReach: "unavailable",
      },
    }),
    [
      "hands_bound",
      "incapable_of_focus",
      "immobile",
      "unstable",
      "cannot_reach",
    ]
  );
});

test("generatePhysicalStateUpdate maps severely_impaired bands", () => {
  assert.deepEqual(
    generatePhysicalStateUpdate({ id: "TED" }, {
      bands: {
        handUse: "severely_impaired",
        concentration: "severely_impaired",
        mobility: "normal",
        stability: "normal",
        interactionReach: "normal",
      },
    }),
    ["severe_hand_impairment", "severe_concentration_impairment"]
  );
});

test("generatePhysicalStateUpdate excludes merely impaired bands", () => {
  assert.deepEqual(
    generatePhysicalStateUpdate({ id: "TED" }, {
      bands: { ...NORMAL_BANDS, handUse: "impaired", concentration: "impaired" },
    }),
    []
  );
});

test("generatePhysicalStateUpdate is band-order independent", () => {
  const forward = generatePhysicalStateUpdate({ id: "TED" }, {
    bands: { mobility: "unavailable", handUse: "unavailable" },
  });

  const reverse = generatePhysicalStateUpdate({ id: "TED" }, {
    bands: { handUse: "unavailable", mobility: "unavailable" },
  });

  assert.deepEqual(forward, reverse);
  assert.deepEqual(forward, ["hands_bound", "immobile"]);
});

test("generatePhysicalStateUpdate ignores unknown capability keys", () => {
  assert.deepEqual(
    generatePhysicalStateUpdate({ id: "TED" }, {
      bands: { handUse: "unavailable", bogusCapability: "unavailable" },
    }),
    ["hands_bound"]
  );
});

test("generatePhysicalStateUpdate normalizes band case and whitespace", () => {
  assert.deepEqual(
    generatePhysicalStateUpdate({ id: "TED" }, {
      bands: { handUse: "  UNAVAILABLE " },
    }),
    ["hands_bound"]
  );
});

test("generatePhysicalStateUpdate combines severe concentration with bound hands", () => {
  const bands = {
    handUse: "unavailable",
    concentration: "severely_impaired",
    mobility: "normal",
    stability: "normal",
    interactionReach: "normal",
  };

  assert.deepEqual(
    generatePhysicalStateUpdate({ id: "TED" }, { bands }).sort(),
    ["hands_bound", "severe_concentration_impairment"]
  );
});

test("physicalLimitationsChanged detects additions and removals", () => {
  assert.equal(
    physicalLimitationsChanged([], ["hands_bound"]),
    true
  );
  assert.equal(
    physicalLimitationsChanged(["hands_bound"], []),
    true
  );
  assert.equal(
    physicalLimitationsChanged(["hands_bound"], ["hands_bound"]),
    false
  );
  assert.equal(
    physicalLimitationsChanged(
      ["hands_bound"],
      ["hands_bound", "immobile"]
    ),
    true
  );
});

/* ============================================================
   3. makeScratchpad + compact context rendering
============================================================ */

test("makeScratchpad initializes physicalLimitations as an array", () => {
  const scratchpad = makeScratchpad("TED");
  assert.ok(Array.isArray(scratchpad.physicalLimitations));
  assert.deepEqual(scratchpad.physicalLimitations, []);
});

test("compact context omits physicalLimitations when empty", () => {
  const sim = {
    id: "TED",
    scratchpad: makeScratchpad("TED"),
  };
  sim.scratchpad.initialized = true;

  const text = formatCompactScratchpadContext(sim);
  assert.equal(text, "");

  const { sections } =
    formatCompactScratchpadContextWithSections(sim);
  assert.ok(
    !sections.some((s) => s.section === "physicalLimitations")
  );
});

test("compact context renders physicalLimitations when populated", () => {
  const sim = {
    id: "TED",
    scratchpad: makeScratchpad("TED"),
  };
  sim.scratchpad.initialized = true;
  sim.scratchpad.physicalLimitations = [
    "hands_bound",
    "severe_concentration_impairment",
  ];

  const text = formatCompactScratchpadContext(sim);
  assert.ok(text.includes("hands_bound"));
  assert.ok(
    text.includes("severe_concentration_impairment")
  );
  assert.ok(
    text.includes("Your current physical limitations")
  );

  const { sections } =
    formatCompactScratchpadContextWithSections(sim);
  const physicalSection = sections.find(
    (s) => s.section === "physicalLimitations"
  );
  assert.ok(physicalSection);
  assert.deepEqual(
    physicalSection.tokens.sort(),
    ["hands_bound", "severe_concentration_impairment"]
  );
});

/* ============================================================
   4. commit path populates physicalLimitations from G.agency
============================================================ */

function seedAgencyCapabilities(simId, bands, capabilities) {
  G.agency = G.agency || {};
  G.agency.capabilities = G.agency.capabilities || {};
  G.agency.capabilities[simId] = {
    capabilities: capabilities || { ...NORMAL_BANDS },
    bands,
    activeConstraintIds: [],
    provenance: [],
  };
}

function commitNoUpdate(simId, cycle) {
  return commitScratchpadCommsOperations({
    simId,
    validationResult: {
      status: "no_update",
      accepted: [
        { type: "no_update", tag: "NO_UPDATE", sourceIndex: 0 },
      ],
      rejected: [],
    },
    evidence: [],
    cycle,
  });
}

test("commit path sets physicalLimitations from G.agency.capabilities", () => {
  const sim = G.sims.TED;
  sim.scratchpad = makeScratchpad("TED");
  sim.scratchpad.initialized = true;

  seedAgencyCapabilities("TED", {
    ...NORMAL_BANDS,
    handUse: "unavailable",
  });

  const result = commitNoUpdate("TED", 1);

  assert.equal(result.committed, true);
  assert.deepEqual(sim.scratchpad.physicalLimitations, [
    "hands_bound",
  ]);
  assert.ok(result.changedPaths.includes("physicalLimitations"));

  delete G.agency.capabilities.TED;
});

test("commit path leaves physicalLimitations empty when no hard bands", () => {
  const sim = G.sims.ELLEN;
  sim.scratchpad = makeScratchpad("ELLEN");
  sim.scratchpad.initialized = true;

  seedAgencyCapabilities("ELLEN", { ...NORMAL_BANDS });

  const result = commitNoUpdate("ELLEN", 1);

  assert.equal(result.committed, true);
  assert.deepEqual(sim.scratchpad.physicalLimitations, []);

  delete G.agency.capabilities.ELLEN;
});

test("commit path clears physicalLimitations when bands return to normal", () => {
  const sim = G.sims.BENNY;
  sim.scratchpad = makeScratchpad("BENNY");
  sim.scratchpad.initialized = true;
  sim.scratchpad.physicalLimitations = ["hands_bound"];

  seedAgencyCapabilities("BENNY", { ...NORMAL_BANDS });

  const result = commitNoUpdate("BENNY", 1);

  assert.equal(result.committed, true);
  assert.deepEqual(sim.scratchpad.physicalLimitations, []);
  assert.ok(result.changedPaths.includes("physicalLimitations"));

  delete G.agency.capabilities.BENNY;
});

test("commit path is idempotent for an unchanged limitation set", () => {
  const sim = G.sims.GORRISTER;
  sim.scratchpad = makeScratchpad("GORRISTER");
  sim.scratchpad.initialized = true;

  seedAgencyCapabilities("GORRISTER", {
    ...NORMAL_BANDS,
    mobility: "unavailable",
  });

  const first = commitNoUpdate("GORRISTER", 1);
  assert.deepEqual(sim.scratchpad.physicalLimitations, ["immobile"]);

  const second = commitNoUpdate("GORRISTER", 2);
  assert.deepEqual(sim.scratchpad.physicalLimitations, ["immobile"]);
  assert.ok(
    !second.changedPaths.includes("physicalLimitations"),
    "unchanged limitations should not be reported as a change"
  );

  delete G.agency.capabilities.GORRISTER;
});

/* ============================================================
   5. NOTE commit via overhearing eventId
============================================================ */

test("NOTE citing an overhearing event commits with sourceEventId", () => {
  const sim = G.sims.TED;
  sim.scratchpad = makeScratchpad("TED");
  sim.scratchpad.initialized = true;

  const previousOverhearing = G.overhearing;
  G.overhearing = { history: [makeOverhearingEvent()] };

  try {
    const eventMap = buildVisibleOverhearingEventMap(
      G.overhearing,
      "TED"
    );

    const validationResult =
      validateScratchpadCommsOperations({
        simId: "TED",
        parsedResult: parseOperations(
          '<NOTE ref="C1-O000001" confidence="0.8">They met by the wall and spoke quietly.</NOTE>'
        ),
        evidence: [],
        visibleEventMap: eventMap,
      });

    assert.equal(validationResult.status, "success");

    const commitResult = commitScratchpadCommsOperations({
      simId: "TED",
      validationResult,
      evidence: [],
      cycle: 1,
    });

    assert.equal(commitResult.committed, true);
    assert.equal(sim.scratchpad.messageNotes.length, 1);

    const note = sim.scratchpad.messageNotes[0];
    assert.equal(note.messageId, "C1-O000001");
    assert.equal(note.sourceEventId, "C1-O000001");
    assert.equal(note.channel, "overheard");
    assert.equal(note.speaker, "ELLEN");
    assert.deepEqual(note.recipients, ["BENNY"]);
  } finally {
    G.overhearing = previousOverhearing;
  }
});
