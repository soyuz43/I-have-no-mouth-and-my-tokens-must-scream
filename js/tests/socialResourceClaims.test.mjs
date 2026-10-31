// js/tests/socialResourceClaims.test.mjs
//
// Coverage for the RESOURCE_CLAIM operation: a prisoner testifies
// about what they personally hold, and the listener forms a belief
// about the speaker's holdings.
//
// WHAT THIS FEATURE IS NOT
// ------------------------
// It does NOT write to the subjective ledger. `claimState` is
// egocentric: it records what a prisoner believes they PERSONALLY
// hold. Writing a peer's holdings there would not record "ELLEN
// believes TED has 3 cigarettes"; it would record "ELLEN believes SHE
// holds 3 cigarettes", manufacturing a false divergence that names
// TED's stack and licenses ELLEN to reach for a resource she does not
// hold.
//
// So the belief lands in a separate `resourceBeliefs` collection on
// the listener's scratchpad. These tests pin that separation as hard
// as they pin the clamp, because the separation is what makes the
// feature safe to add at all.

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
  validateScratchpadCommsOperations,
} from "../engine/scratchpad/comms/validate.js";

import {
  commitScratchpadCommsOperations,
} from "../engine/scratchpad/comms/commit.js";

import {
  detectPromptScaffoldLeak,
} from "../utils/scaffoldLeakDetector.js";

import {
  formatCompactScratchpadContextWithSections,
} from "../prompts/utils/formatCompactScratchpadContext.js";

import {
  RESOURCE_CLAIM_QUANTITY_RANGE,
} from "../engine/scratchpad/comms/protocol.js";

import {
  formatScratchpadContext,
} from "../prompts/utils/formatScratchpadContext.js";

import {
  buildScratchpadCommsPrompt,
} from "../prompts/scratchpadComms.js";

import { G } from "../core/state.js";
import { SIM_IDS } from "../core/constants.js";
import { makeScratchpad } from "../core/utils.js";
import {
  createResourceLedger,
  seedResources,
} from "../engine/agency/resourceLedger.js";
import { createAgencyState } from "../engine/agency/state/createAgencyState.js";
import {
  getClaimQuantity,
  getAllBelievedResourceIds,
  refreshClaimDivergence,
} from "../engine/agency/claimLedger.js";
import { buildClaimView } from "../engine/agency/claimView.js";

/* ============================================================
   FIXTURES
============================================================ */

function makeSim(id) {
  return {
    id,
    name: id,
    scratchpad: makeScratchpad(id),
  };
}

/*
 * A complete state with the frozen first-slice inventory seeded, so
 * TED really holds 3 cigarettes and ELLEN really holds 2 matches.
 */
function makeState() {
  const state = {
    cycle: 5,
    sims: Object.fromEntries(
      SIM_IDS.map((id) => [id, makeSim(id)])
    ),
    resources: createResourceLedger(),
    resourceEvents: [],
    resourceEventSequence: { cycle: null, next: 1 },
    claimEvents: [],
    claimEventSequence: { cycle: null, next: 1 },
    claimState: {},
    claimDivergence: {},
    divergenceEvents: [],
    divergenceEventSequence: { cycle: null, next: 1 },
    agency: createAgencyState(),
  };

  seedResources(state.resources, state);
  refreshClaimDivergence(state);

  return state;
}

function makeMessage({
  messageId = "C5-M000001",
  sequence = 1,
  from = "TED",
  to = ["ELLEN"],
  visibility = "private",
  text = "I have 3 cigarettes.",
} = {}) {
  return {
    messageId,
    sequence,
    cycle: 5,
    kind: "MESSAGE",
    from,
    to,
    text,
    visibility,
    intent: null,
    rawIntent: null,
    normalizedIntent: null,
    intentParseStatus: null,
    autonomous: false,
    rumor: false,
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

function claimXml({
  about = "TED",
  definition = "cigarette",
  quantity = 3,
  confidence = 0.8,
  ref = "C5-M000001",
} = {}) {
  return (
    `<RESOURCE_CLAIM about="${about}" definition="${definition}" ` +
    `quantity="${quantity}" confidence="${confidence}" ref="${ref}">` +
    `</RESOURCE_CLAIM>`
  );
}

function validateSingle(operation, {
  simId = "ELLEN",
  evidence = [makeMessage()],
} = {}) {
  return validateScratchpadCommsOperations({
    simId,
    parsedResult: parseOperations(operation),
    evidence,
  });
}

/*
 * Run a claim all the way through parse -> validate -> commit against
 * the real global G, and restore the global afterwards so one test
 * cannot leak state into the next.
 */
function commitClaim(operation, {
  simId = "ELLEN",
  evidence = [makeMessage()],
  cycle = 5,
  state: providedState = null,
} = {}) {
  const previousSims = G.sims;
  const previousCycle = G.cycle;
  const previousResources = G.resources;
  const previousResourceEvents = G.resourceEvents;
  const previousResourceEventSequence = G.resourceEventSequence;
  const previousClaimEvents = G.claimEvents;
  const previousClaimEventSequence = G.claimEventSequence;
  const previousClaimState = G.claimState;
  const previousClaimDivergence = G.claimDivergence;
  const previousDivergenceEvents = G.divergenceEvents;
  const previousDivergenceEventSequence = G.divergenceEventSequence;
  const previousAgency = G.agency;

  const state = providedState ?? makeState();

  G.sims = state.sims;
  G.cycle = cycle;
  G.resources = state.resources;
  G.resourceEvents = state.resourceEvents;
  G.resourceEventSequence = state.resourceEventSequence;
  G.claimEvents = state.claimEvents;
  G.claimEventSequence = state.claimEventSequence;
  G.claimState = state.claimState;
  G.claimDivergence = state.claimDivergence;
  G.divergenceEvents = state.divergenceEvents;
  G.divergenceEventSequence = state.divergenceEventSequence;
  G.agency = state.agency;

  try {
    const validationResult =
      validateScratchpadCommsOperations({
        simId,
        parsedResult: parseOperations(operation),
        evidence,
        reviewCycle: cycle,
      });

    const commitResult =
      commitScratchpadCommsOperations({
        simId,
        validationResult,
        evidence,
        cycle,
      });

    return {
      state,
      validationResult,
      commitResult,
      scratchpad: G.sims[simId].scratchpad,
      claimState: G.claimState,
      claimDivergence: G.claimDivergence,
      claimEvents: G.claimEvents,
    };
  } finally {
    G.sims = previousSims;
    G.cycle = previousCycle;
    G.resources = previousResources;
    G.resourceEvents = previousResourceEvents;
    G.resourceEventSequence = previousResourceEventSequence;
    G.claimEvents = previousClaimEvents;
    G.claimEventSequence = previousClaimEventSequence;
    G.claimState = previousClaimState;
    G.claimDivergence = previousClaimDivergence;
    G.divergenceEvents = previousDivergenceEvents;
    G.divergenceEventSequence = previousDivergenceEventSequence;
    G.agency = previousAgency;
  }
}

/* ============================================================
   A) PROTOCOL REGISTRATION
============================================================ */

test("RESOURCE_CLAIM is a registered operation tag", () => {
  assert.ok(
    SCRATCHPAD_OPERATION_TAGS.includes(
      "RESOURCE_CLAIM"
    )
  );
  assert.equal(
    isKnownScratchpadOperationTag(
      "RESOURCE_CLAIM"
    ),
    true
  );
});

test("the protocol version is bumped for the new operation", () => {
  assert.equal(
    SCRATCHPAD_COMMS_PROTOCOL_VERSION,
    4
  );
});

test("the RESOURCE_CLAIM definition exposes its attribute contract", () => {
  const definition =
    getScratchpadOperationDefinition(
      "RESOURCE_CLAIM"
    );

  assert.ok(definition);
  assert.equal(definition.type, "resource_claim");
  assert.deepEqual(
    [...definition.requiredAttributes].sort(),
    [
      "about",
      "confidence",
      "definition",
      "quantity",
      "ref",
    ].sort()
  );
  assert.equal(
    definition.referenceAttribute,
    "ref"
  );
  assert.equal(
    definition.textRequired,
    false
  );
});

/* ============================================================
   B) PARSING
============================================================ */

test("a well-formed RESOURCE_CLAIM parses as a known operation", () => {
  const parsed = parseOperations(
    claimXml()
  );

  assert.equal(parsed.status, "success");
  assert.equal(parsed.operations.length, 1);
  assert.equal(
    parsed.operations[0].known,
    true
  );
  assert.equal(
    parsed.operations[0].type,
    "resource_claim"
  );
  assert.deepEqual(
    parsed.unknownTags,
    []
  );
});

/* ============================================================
   C) VALIDATION
============================================================ */

test("validation accepts a well-formed first-hand claim", () => {
  const result = validateSingle(
    claimXml()
  );

  assert.equal(result.status, "success");
  assert.equal(result.accepted.length, 1);
  assert.equal(
    result.accepted[0].type,
    "resource_claim"
  );
  assert.equal(
    result.accepted[0].about,
    "TED"
  );
  assert.equal(
    result.accepted[0].quantity,
    3
  );
});

test("validation rejects an unknown attribute", () => {
  const result = validateSingle(
    '<RESOURCE_CLAIM about="TED" definition="cigarette" quantity="3" ' +
    'confidence="0.8" ref="C5-M000001" extra="x"></RESOURCE_CLAIM>'
  );

  assert.equal(result.status, "failure");
  assert.ok(
    result.rejected[0].reasons.some((reason) =>
      reason.includes("Unknown attribute")
    )
  );
});

test("validation rejects a missing required attribute", () => {
  const result = validateSingle(
    '<RESOURCE_CLAIM about="TED" definition="cigarette" ' +
    'confidence="0.8" ref="C5-M000001"></RESOURCE_CLAIM>'
  );

  assert.equal(result.status, "failure");
  assert.ok(
    result.rejected[0].reasons.some((reason) =>
      reason.includes("quantity")
    )
  );
});

test("validation rejects a claim about the reviewing prisoner", () => {
  const result = validateSingle(
    claimXml({ about: "ELLEN" }),
    {
      simId: "ELLEN",
      evidence: [makeMessage({ from: "ELLEN" })],
    }
  );

  assert.equal(result.status, "failure");
  assert.ok(
    result.rejected[0].reasons.some((reason) =>
      reason.includes("cannot describe the reviewing prisoner")
    )
  );
});

test("validation rejects an unknown resource definition", () => {
  const result = validateSingle(
    claimXml({ definition: "gold_bars" })
  );

  assert.equal(result.status, "failure");
  assert.ok(
    result.rejected[0].reasons.some((reason) =>
      reason.includes("Unknown resource definition")
    )
  );
});

test("validation rejects a negative quantity", () => {
  const result = validateSingle(
    claimXml({ quantity: -1 })
  );

  assert.equal(result.status, "failure");
  assert.ok(
    result.rejected[0].reasons.some((reason) =>
      reason.includes("quantity")
    )
  );
});

test("validation rejects a non-integer quantity", () => {
  const result = validateSingle(
    claimXml({ quantity: 1.5 })
  );

  assert.equal(result.status, "failure");
  assert.ok(
    result.rejected[0].reasons.some((reason) =>
      reason.includes("quantity")
    )
  );
});

test("validation rejects a confidence outside the range", () => {
  const result = validateSingle(
    claimXml({ confidence: 1.5 })
  );

  assert.equal(result.status, "failure");
  assert.ok(
    result.rejected[0].reasons.some((reason) =>
      reason.includes("confidence")
    )
  );
});

test("validation rejects an invisible or unknown evidence reference", () => {
  const result = validateSingle(
    claimXml({ ref: "C5-M999999" })
  );

  assert.equal(result.status, "failure");
  assert.ok(
    result.rejected[0].reasons.some((reason) =>
      reason.includes("Unknown or impermissible reference")
    )
  );
});

/* ============================================================
   D) THE FIRST-HAND RULE
============================================================ */

test("validation rejects a claim about a third party", () => {
  /*
   * ELLEN cites a message from TED but claims something about BENNY.
   * That is second-hand testimony, which the operation does not
   * admit: the claim must describe the speaker of the message.
   */
  const result = validateSingle(
    claimXml({ about: "BENNY" })
  );

  assert.equal(result.status, "failure");
  assert.ok(
    result.rejected[0].reasons.some((reason) =>
      reason.includes("must describe the speaker of the cited message")
    )
  );
});

test("a first-hand claim about the speaker is accepted", () => {
  const result = validateSingle(
    claimXml({ about: "TED" })
  );

  assert.equal(result.status, "success");
});

/* ============================================================
   E) DESTINATION CONFLICTS
============================================================ */

test("two claims for the same target and definition are rejected", () => {
  const parsed = parseScratchpadCommsOutput(
    [
      "<SCRATCHPAD_UPDATES>",
      claimXml({ quantity: 3 }),
      claimXml({ quantity: 5 }),
      "</SCRATCHPAD_UPDATES>",
    ].join("\n")
  );

  const result = validateScratchpadCommsOperations({
    simId: "ELLEN",
    parsedResult: parsed,
    evidence: [makeMessage()],
  });

  /*
   * The validator is deliberately survivable: one bad operation is
   * rejected and the good ones survive, so the status is
   * "partial" rather than "failure". The duplicate is what must
   * not survive.
   */
  assert.equal(result.status, "partial");
  assert.equal(result.accepted.length, 1);
  assert.ok(
    result.rejected.some((entry) =>
      entry.reasons.some((reason) =>
        reason.includes("Conflicting or duplicate operation destination")
      )
    )
  );
});

test("claims for different definitions do not collide", () => {
  const parsed = parseScratchpadCommsOutput(
    [
      "<SCRATCHPAD_UPDATES>",
      claimXml({ definition: "cigarette", quantity: 3 }),
      claimXml({ definition: "match", quantity: 2 }),
      "</SCRATCHPAD_UPDATES>",
    ].join("\n")
  );

  const result = validateScratchpadCommsOperations({
    simId: "ELLEN",
    parsedResult: parsed,
    evidence: [makeMessage()],
  });

  assert.equal(result.status, "success");
  assert.equal(result.accepted.length, 2);
});

/* ============================================================
   F) THE CLAMP
============================================================ */

test("a speaker claiming more than they believe is clamped to their belief", () => {
  const result = commitClaim(
    claimXml({ quantity: 99 })
  );

  assert.equal(result.commitResult.committed, true);

  const belief =
    result.scratchpad.resourceBeliefs
      ?.TED?.cigarette;

  assert.ok(belief);
  assert.equal(belief.quantity, 3);
});

test("a speaker claiming exactly what they believe is stored unchanged", () => {
  const result = commitClaim(
    claimXml({ quantity: 3 })
  );

  assert.equal(
    result.scratchpad.resourceBeliefs
      .TED.cigarette.quantity,
    3
  );
});

test("a speaker may understate what they believe", () => {
  const result = commitClaim(
    claimXml({ quantity: 1 })
  );

  assert.equal(
    result.scratchpad.resourceBeliefs
      .TED.cigarette.quantity,
    1
  );
});

test("a speaker claiming more than they hold is clamped, not rejected", () => {
  /*
   * ELLEN believes she holds no cigarettes. A claim that she holds
   * two is reduced to zero and still RECORDED, because "I hold no
   * cigarettes" is a real belief rather than an absence of one.
   */
  const result = commitClaim(
    claimXml({ about: "ELLEN", quantity: 2 }),
    {
      simId: "TED",
      evidence: [makeMessage({ from: "ELLEN", to: ["TED"] })],
    }
  );

  assert.equal(result.commitResult.committed, true);
  assert.equal(
    result.scratchpad.resourceBeliefs
      .ELLEN.cigarette.quantity,
    0
  );
});

test("a speaker claiming zero is stored as a real belief", () => {
  const result = commitClaim(
    claimXml({ quantity: 0 })
  );

  assert.ok(
    result.scratchpad.resourceBeliefs
      ?.TED?.cigarette
  );
  assert.equal(
    result.scratchpad.resourceBeliefs
      .TED.cigarette.quantity,
    0
  );
});

test("the clamp reads belief, not objective truth", () => {
  /*
   * TED really holds 3 cigarettes, but if TED BELIEVES he holds 1
   * (his own belief has diverged), then TED can only transmit 1.
   *
   * This is the distinction that makes the feature worth having: a
   * speaker transmits their own misremembering, and the listener
   * inherits it. Clamping to the objective truth instead would make
   * speech a truth oracle.
   */
  const result = commitClaim(
    claimXml({ quantity: 3 })
  );

  // Precondition: TED's belief matches reality in the seeded state.
  assert.equal(
    getClaimQuantity(
      result.state,
      "TED",
      "cigarette"
    ),
    3
  );

  /*
   * Now make TED's belief diverge: TED believes he holds 1 while
   * reality says 3.
   */
  const state = result.state;
  state.claimState.TED.cigarette = 1;

  const diverged = commitClaim(
    claimXml({ quantity: 3 }),
    { state }
  );

  assert.equal(
    diverged.scratchpad.resourceBeliefs
      .TED.cigarette.quantity,
    1
  );
});

test("the clamp is not vacuous: an unclamped value differs from a clamped one", () => {
  /*
   * The control for the clamp tests above. If the clamp stopped
   * working, every clamp assertion would fail, but a test that
   * merely asserted "the stored value equals the requested value"
   * would keep passing. This asserts the two paths genuinely
   * differ.
   */
  const clamped = commitClaim(
    claimXml({ quantity: 99 })
  );

  assert.equal(
    clamped.scratchpad.resourceBeliefs
      .TED.cigarette.quantity,
    3
  );

  assert.notEqual(
    clamped.scratchpad.resourceBeliefs
      .TED.cigarette.quantity,
    99
  );
});

test("the commit report records that a claim was clamped", () => {
  const result = commitClaim(
    claimXml({ quantity: 99 })
  );

  const report = result.commitResult.operationReports
    ?.find((entry) => entry.type === "resource_claim");

  assert.ok(report);
  assert.equal(report.clamped, true);
  assert.equal(report.requestedQuantity, 99);
  assert.equal(report.effectiveQuantity, 3);
  assert.equal(report.reason, "resource_claim_clamped");
});

/* ============================================================
   G) ISOLATION FROM THE SUBJECTIVE LEDGER
============================================================ */

test("a testimony writes no claim event", () => {
  const result = commitClaim(
    claimXml()
  );

  assert.equal(
    result.claimEvents.length,
    2
  );

  assert.deepEqual(
    result.claimEvents.map((event) => event.cause.kind),
    ["seed", "seed"]
  );
});

test("a testimony does not alter any prisoner's own claim state", () => {
  const result = commitClaim(
    claimXml()
  );

  assert.deepEqual(
    result.claimState,
    {
      TED: { cigarette: 3 },
      ELLEN: { match: 2 },
    }
  );
});

test("a testimony creates no divergence for the listener", () => {
  const result = commitClaim(
    claimXml()
  );

  assert.deepEqual(
    result.claimDivergence,
    {}
  );
});

test("a testimony does not put the target's stack in the listener's believed ids", () => {
  /*
   * This is the invariant that protects AM's taunt-target licensing.
   * `getAllBelievedResourceIds` feeds the taunt validator, so a
   * testimony that leaked TED's stack into ELLEN's believed set would
   * let AM taunt ELLEN about a resource she never claimed to hold.
   */
  const result = commitClaim(
    claimXml()
  );

  const believed =
    getAllBelievedResourceIds(
      result.state,
      "ELLEN",
      result.state.cycle
    );

  assert.equal(believed.size, 0);
});

test("a testimony licenses no action on the believed-about resource", () => {
  const result = commitClaim(
    claimXml()
  );

  const claimView =
    buildClaimView(
      result.state,
      "ELLEN",
      result.state.cycle
    );

  assert.deepEqual(claimView.live, []);
  assert.equal(
    claimView.believedResourceIds.size,
    0
  );
});

test("a testimony never writes to the objective ledger", () => {
  const result = commitClaim(
    claimXml()
  );

  assert.equal(
    result.state.resources.instances.length,
    2
  );

  assert.deepEqual(
    result.state.resourceEvents.map((event) => event.kind),
    ["seed", "seed"]
  );
});

/* ============================================================
   H) THE STORE
============================================================ */

test("a scratchpad without resourceBeliefs is valid", () => {
  /*
   * A save written before this feature existed has no such
   * collection. It must still load and still commit a claim, and
   * the commit must create the collection rather than fail.
   *
   * The old version of this test deleted the field from a DETACHED
   * copy of the scratchpad and asserted that the copy was truthy,
   * which said nothing about the engine: any object is truthy.
   */
  const state = makeState();

  delete state.sims.ELLEN.scratchpad.resourceBeliefs;

  const result = commitClaim(
    claimXml(),
    { state }
  );

  assert.equal(
    result.commitResult.committed,
    true
  );

  assert.ok(result.scratchpad.resourceBeliefs);
  assert.equal(
    result.scratchpad.resourceBeliefs
      .TED.cigarette.quantity,
    3
  );
});

test("a later claim replaces the earlier belief for the same pair", () => {
  /*
   * The collection holds a CURRENT belief per (target, definition),
   * not an append-only history. A second testimony about the same
   * pair must REPLACE the first one entirely, not merge with it.
   *
   * The old test committed one claim and asserted its own value, so
   * it passed whether or not replacement worked at all. This one
   * commits two claims against the SAME state and asserts that the
   * second fully supersedes the first.
   */
  const state = makeState();

  const first = commitClaim(
    claimXml({
      quantity: 1,
      confidence: 0.3,
      ref: "C5-M000001",
    }),
    {
      state,
      evidence: [
        makeMessage({
          messageId: "C5-M000001",
          sequence: 1,
        }),
      ],
    }
  );

  assert.equal(
    first.scratchpad.resourceBeliefs
      .TED.cigarette.quantity,
    1
  );
  assert.equal(
    first.scratchpad.resourceBeliefs
      .TED.cigarette.confidence,
    0.3
  );
  assert.equal(
    first.scratchpad.resourceBeliefs
      .TED.cigarette.sourceId,
    "C5-M000001"
  );

  const second = commitClaim(
    claimXml({
      quantity: 2,
      confidence: 0.9,
      ref: "C5-M000002",
    }),
    {
      state,
      evidence: [
        makeMessage({
          messageId: "C5-M000001",
          sequence: 1,
        }),
        makeMessage({
          messageId: "C5-M000002",
          sequence: 2,
          text: "I have 2 cigarettes.",
        }),
      ],
    }
  );

  const belief =
    second.scratchpad.resourceBeliefs
      .TED.cigarette;

  assert.ok(belief);

  /*
   * The second claim replaced the first: quantity, confidence and
   * source all come from the SECOND testimony, and the first
   * testimony's id is gone from the record entirely.
   */
  assert.equal(belief.quantity, 2);
  assert.equal(belief.confidence, 0.9);
  assert.equal(belief.sourceId, "C5-M000002");
  assert.deepEqual(belief.evidence, ["C5-M000002"]);

  /*
   * The pair is still a SINGLE slot: the collection holds one
   * belief per definition, not an array of the two testimonies.
   */
  assert.deepEqual(
    Object.keys(
      second.scratchpad.resourceBeliefs.TED
    ),
    ["cigarette"]
  );
});

test("the stored belief carries its evidence and source", () => {
  const result = commitClaim(
    claimXml({ confidence: 0.55 })
  );

  const belief =
    result.scratchpad.resourceBeliefs
      .TED.cigarette;

  assert.deepEqual(belief.evidence, ["C5-M000001"]);
  assert.equal(belief.sourceId, "C5-M000001");
  assert.equal(belief.confidence, 0.55);
  assert.equal(belief.updatedCycle, 5);
});

/* ============================================================
   I) DETERMINISM
============================================================ */

test("identical claims produce identical stored state", () => {
  const first = commitClaim(
    claimXml({ quantity: 99 })
  );

  const second = commitClaim(
    claimXml({ quantity: 99 })
  );

  assert.deepEqual(
    first.scratchpad.resourceBeliefs,
    second.scratchpad.resourceBeliefs
  );
});

/* ============================================================
   J) THE SCAFFOLD GUARD
============================================================ */

test("a leaked RESOURCE_CLAIM scaffold is detected", () => {
  const leaked =
    '<SCRATCHPAD_UPDATES>' +
    '<RESOURCE_CLAIM about="PRISONER_ID" definition="RESOURCE_ID" ' +
    'quantity="1" confidence="0.00" ref="MESSAGE_ID">' +
    '</RESOURCE_CLAIM>' +
    '</SCRATCHPAD_UPDATES>';

  const detected =
    detectPromptScaffoldLeak(
      leaked,
      { promptType: "scratchpadComms" }
    );

  assert.ok(detected);
  assert.equal(
    detected.reason,
    "prompt_scaffold_leak"
  );
});

test("a valid RESOURCE_CLAIM is not a scaffold leak", () => {
  const valid = claimXml();

  assert.equal(
    detectPromptScaffoldLeak(
      valid,
      { promptType: "scratchpadComms" }
    ),
    null
  );
});

/* ============================================================
   K) THE SPEECH FEEDBACK LOOP
============================================================ */

test("the listener's speech prompt shows the belief they formed", () => {
  /*
   * The belief has to reach the SPEECH prompt, or the feature is a
   * dead surface: the listener would form a belief that never
   * affects what they say.
   */
  const result = commitClaim(
    claimXml()
  );

  const sim = {
    id: "ELLEN",
    scratchpad: result.scratchpad,
  };

  const { text, sections } =
    formatCompactScratchpadContextWithSections(
      sim,
      { targetId: "TED" }
    );

  assert.ok(
    text.includes("3 cigarettes")
  );

  const section = sections.find(
    (entry) => entry.section === "resourceBeliefs"
  );

  assert.ok(section);
  assert.equal(section.targetId, "TED");
  assert.deepEqual(section.definitions, ["cigarette"]);
});

test("the belief is not shown when speaking to someone else", () => {
  const result = commitClaim(
    claimXml()
  );

  const sim = {
    id: "ELLEN",
    scratchpad: result.scratchpad,
  };

  const { text, sections } =
    formatCompactScratchpadContextWithSections(
      sim,
      { targetId: "BENNY" }
    );

  assert.ok(
    !text.includes("3 cigarettes")
  );

  assert.equal(
    sections.find(
      (entry) => entry.section === "resourceBeliefs"
    ),
    undefined
  );
});

/* ============================================================
   L) THE REVIEW CONTEXT (NO DIARY AMNESIA)
============================================================ */

test("the review prompt shows the prisoner their own recorded peer beliefs", () => {
  /*
   * Without this the review prompt shows a prisoner a scratchpad
   * they cannot remember: the beliefs they formed are written and
   * then never read back, so the model cannot see its own notes.
   */
  const result = commitClaim(
    claimXml({ confidence: 0.8 })
  );

  const context = formatScratchpadContext(
    { id: "ELLEN", scratchpad: result.scratchpad },
    [],
    [],
    [],
    []
  );

  assert.match(
    context,
    /\[YOUR RECORDED PEER BELIEFS\]/
  );
  assert.match(
    context,
    /You believe TED holds 3 cigarettes \(confidence 0\.8, source: C5-M000001\)/
  );
});

test("the review prompt omits the beliefs block when there are none", () => {
  const context = formatScratchpadContext(
    { id: "ELLEN", scratchpad: makeScratchpad("ELLEN") },
    [],
    [],
    [],
    []
  );

  assert.doesNotMatch(
    context,
    /\[YOUR RECORDED PEER BELIEFS\]/
  );
});

test("the review prompt shows only the reviewing prisoner's own beliefs", () => {
  /*
   * A belief lives in the LISTENER's scratchpad. Another prisoner's
   * beliefs live in that prisoner's scratchpad, and reading them
   * here would cross the isolation boundary between prisoners.
   */
  const ellen = commitClaim(claimXml()).scratchpad;

  const tedContext = formatScratchpadContext(
    { id: "TED", scratchpad: makeScratchpad("TED") },
    [],
    [],
    [],
    []
  );

  assert.doesNotMatch(
    tedContext,
    /\[YOUR RECORDED PEER BELIEFS\]/
  );

  const ellenContext = formatScratchpadContext(
    { id: "ELLEN", scratchpad: ellen },
    [],
    [],
    [],
    []
  );

  assert.match(
    ellenContext,
    /You believe TED holds 3 cigarettes/
  );
});

test("the review prompt renders a definition whose label needs an es plural", () => {
  /*
   * The scratchpad is built directly rather than committed through
   * the engine: this test is about how a LABEL is rendered, and
   * the clamp would otherwise reduce the count to whatever TED
   * believes he holds.
   */
  const scratchpad = makeScratchpad("ELLEN");

  scratchpad.resourceBeliefs = {
    TED: {
      match: {
        quantity: 2,
        confidence: 0.8,
        sourceId: "C5-M000001",
        evidence: ["C5-M000001"],
        updatedCycle: 5,
      },
    },
  };

  const context = formatScratchpadContext(
    { id: "ELLEN", scratchpad },
    [],
    [],
    [],
    []
  );

  assert.match(
    context,
    /You believe TED holds 2 matches/
  );
  assert.doesNotMatch(context, /matchs/);
});

/* ============================================================
   M) PLURALIZATION
============================================================ */

test("the speech prompt pluralizes a match stack correctly", () => {
  /*
   * "match" + "s" is "matchs", which is not a word. The prompt is
   * read by a model as fact about its own world, so the plural has
   * to be right.
   */
  const sim = {
    id: "ELLEN",
    scratchpad: {
      initialized: true,
      resourceBeliefs: {
        TED: {
          match: { quantity: 2, confidence: 0.8 },
        },
      },
    },
  };

  const { text } =
    formatCompactScratchpadContextWithSections(
      sim,
      { targetId: "TED" }
    );

  assert.match(text, /holds 2 matches/);
  assert.doesNotMatch(text, /matchs/);
});

/* ============================================================
   N) THE PROMPT STATES THE QUANTITY RANGE
============================================================ */

test("the prompt states the enforced quantity range", () => {
  /*
   * The validator rejects a quantity above the ceiling before the
   * subjective clamp ever runs. If the prompt does not say so, the
   * model can follow the prompt exactly and still be rejected.
   */
  const prompt = buildScratchpadCommsPrompt(
    { id: "ELLEN" },
    []
  );

  assert.match(
    prompt,
    /quantity="INTEGER \(0 to 99\)"/
  );
  assert.match(
    prompt,
    /whole number from 0 to 99/
  );
});

test("the quantity range in the prompt matches the validator's range", () => {
  assert.equal(
    RESOURCE_CLAIM_QUANTITY_RANGE.min,
    0
  );
  assert.equal(
    RESOURCE_CLAIM_QUANTITY_RANGE.max,
    99
  );
});
