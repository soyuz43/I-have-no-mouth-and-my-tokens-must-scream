// js/tests/predictionResolve.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  SCRATCHPAD_COMMS_PROTOCOL_VERSION,
  SCRATCHPAD_OPERATION_TAGS,
  SCRATCHPAD_PREDICTION_OUTCOMES,
  getScratchpadOperationDefinition,
  isKnownScratchpadOperationTag,
} from "../engine/scratchpad/comms/protocol.js";

import {
  parseScratchpadCommsOutput,
} from "../engine/scratchpad/comms/parse.js";

import {
  validateScratchpadCommsOperations,
} from "../engine/scratchpad/comms/validate.js";

const PREDICTION_TEXT =
  "Ellen will send the next message to TED.";

const VALID_RESOLVE_OPERATION =
  `<PREDICTION_RESOLVE about="ELLEN" withinCycles="3" ` +
  `outcome="confirmed" rationale="The cited message confirms the prediction." ` +
  `refs="C0-M000001">${PREDICTION_TEXT}</PREDICTION_RESOLVE>`;

function parseOperations(operation) {
  return parseScratchpadCommsOutput(
    [
      "<SCRATCHPAD_UPDATES>",
      operation,
      "</SCRATCHPAD_UPDATES>",
    ].join("\n")
  );
}

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

function validateSingle(operation) {
  return validateScratchpadCommsOperations({
    simId: "TED",
    parsedResult: parseOperations(operation),
    evidence: [makeVisibleMessage("C0-M000001")],
  });
}

test("PREDICTION_RESOLVE is registered with protocol version 3", () => {
  assert.equal(SCRATCHPAD_COMMS_PROTOCOL_VERSION, 3);
  assert.ok(
    SCRATCHPAD_OPERATION_TAGS.includes(
      "PREDICTION_RESOLVE"
    )
  );
  assert.equal(
    isKnownScratchpadOperationTag(
      "PREDICTION_RESOLVE"
    ),
    true
  );
});

test("PREDICTION_RESOLVE definition has the lifecycle protocol shape", () => {
  const definition =
    getScratchpadOperationDefinition(
      "PREDICTION_RESOLVE"
    );

  assert.ok(definition);
  assert.equal(definition.type, "prediction_resolve");
  assert.deepEqual(
    [...definition.requiredAttributes],
    [
      "about",
      "withinCycles",
      "outcome",
      "rationale",
      "refs",
    ]
  );
  assert.equal(definition.referenceAttribute, "refs");
  assert.equal(definition.textRequired, true);
});

test("PREDICTION_RESOLVE parses from well-formed operation text", () => {
  const parsedResult =
    parseOperations(VALID_RESOLVE_OPERATION);

  assert.equal(parsedResult.status, "success");
  assert.equal(parsedResult.operations.length, 1);

  const operation =
    parsedResult.operations[0];

  assert.equal(operation.tag, "PREDICTION_RESOLVE");
  assert.equal(operation.known, true);
  assert.equal(operation.text, PREDICTION_TEXT);
  assert.equal(operation.attributes.about, "ELLEN");
  assert.equal(operation.attributes.withinCycles, "3");
  assert.equal(operation.attributes.outcome, "confirmed");
  assert.equal(
    operation.attributes.rationale,
    "The cited message confirms the prediction."
  );
  assert.equal(operation.attributes.refs, "C0-M000001");
});

test("validation accepts a valid PREDICTION_RESOLVE", () => {
  const result =
    validateSingle(VALID_RESOLVE_OPERATION);

  assert.equal(result.status, "success");
  assert.equal(result.accepted.length, 1);
  assert.equal(
    result.accepted[0].type,
    "prediction_resolve"
  );
  assert.equal(result.accepted[0].text, PREDICTION_TEXT);
  assert.equal(result.accepted[0].outcome, "confirmed");
  assert.equal(result.accepted[0].withinCycles, 3);
  assert.deepEqual(
    result.accepted[0].refs,
    ["C0-M000001"]
  );
});

test("validation accepts every allowed prediction outcome", () => {
  assert.deepEqual(
    [...SCRATCHPAD_PREDICTION_OUTCOMES],
    [
      "confirmed",
      "disconfirmed",
      "ambiguous",
      "unobservable",
      "superseded",
    ]
  );

  for (const outcome of SCRATCHPAD_PREDICTION_OUTCOMES) {
    const operation =
      VALID_RESOLVE_OPERATION.replace(
        'outcome="confirmed"',
        `outcome="${outcome}"`
      );
    const result =
      validateSingle(operation);

    assert.equal(result.status, "success");
    assert.equal(
      result.accepted[0].outcome,
      outcome
    );
  }
});

for (const attribute of [
  "about",
  "withinCycles",
  "outcome",
  "rationale",
  "refs",
]) {
  test(
    `validation rejects PREDICTION_RESOLVE missing ${attribute}`,
    () => {
      const operation =
        VALID_RESOLVE_OPERATION.replace(
          new RegExp(
            ` ${attribute}="[^"]*"`
          ),
          ""
        );
      const result =
        validateSingle(operation);

      assert.equal(result.accepted.length, 0);
      assert.ok(
        result.rejected[0].reasons.some(
          (reason) =>
            reason.includes(
              `Missing required attribute "${attribute}".`
            )
        ),
        result.rejected[0].reasons.join(" | ")
      );
    }
  );
}

test("validation rejects an unsupported prediction outcome", () => {
  const operation =
    VALID_RESOLVE_OPERATION.replace(
      'outcome="confirmed"',
      'outcome="partially-confirmed"'
    );
  const result =
    validateSingle(operation);

  assert.equal(result.accepted.length, 0);
  assert.ok(
    result.rejected[0].reasons.some(
      (reason) =>
        /outcome must be one of/.test(reason)
    ),
    result.rejected[0].reasons.join(" | ")
  );
});

test("validation rejects non-exact capitalization of an outcome", () => {
  const operation =
    VALID_RESOLVE_OPERATION.replace(
      'outcome="confirmed"',
      'outcome="CONFIRMED"'
    );
  const result =
    validateSingle(operation);

  assert.equal(result.accepted.length, 0);
});

test("validation rejects horizons outside the 1-12 range", () => {
  for (const horizon of [
    "0",
    "13",
  ]) {
    const operation =
      VALID_RESOLVE_OPERATION.replace(
        'withinCycles="3"',
        `withinCycles="${horizon}"`
      );
    const result =
      validateSingle(operation);

    assert.equal(result.accepted.length, 0);
    assert.ok(
      result.rejected[0].reasons.some(
        (reason) =>
          /withinCycles must be between 1 and 12/.test(reason)
      ),
      result.rejected[0].reasons.join(" | ")
    );
  }
});

test("validation rejects a non-integer horizon", () => {
  const operation =
    VALID_RESOLVE_OPERATION.replace(
      'withinCycles="3"',
      'withinCycles="3.5"'
    );
  const result =
    validateSingle(operation);

  assert.equal(result.accepted.length, 0);
  assert.ok(
    result.rejected[0].reasons.some(
      (reason) =>
        /withinCycles must be a safe integer/.test(reason)
    ),
    result.rejected[0].reasons.join(" | ")
  );
});

test("validation rejects an invisible or unknown evidence reference", () => {
  const operation =
    VALID_RESOLVE_OPERATION.replace(
      "C0-M000001",
      "C0-M999999"
    );
  const result =
    validateSingle(operation);

  assert.equal(result.accepted.length, 0);
  assert.ok(
    result.rejected[0].reasons.some(
      (reason) =>
        /Unknown or invisible message reference/.test(reason)
    ),
    result.rejected[0].reasons.join(" | ")
  );
});

test("validation rejects an unsupported PREDICTION_RESOLVE attribute", () => {
  const operation =
    VALID_RESOLVE_OPERATION.replace(
      'refs="C0-M000001"',
      'refs="C0-M000001" id="1"'
    );
  const result =
    validateSingle(operation);

  assert.equal(result.accepted.length, 0);
  assert.ok(
    result.rejected[0].reasons.some(
      (reason) =>
        /Unknown attribute "id"/.test(reason)
    ),
    result.rejected[0].reasons.join(" | ")
  );
});

test("validation rejects missing prediction text", () => {
  const operation =
    VALID_RESOLVE_OPERATION.replace(
      `>${PREDICTION_TEXT}</PREDICTION_RESOLVE>`,
      "></PREDICTION_RESOLVE>"
    );
  const result =
    validateSingle(operation);

  assert.equal(result.accepted.length, 0);
  assert.ok(
    result.rejected[0].reasons.includes(
      "PREDICTION_RESOLVE requires operation text."
    ),
    result.rejected[0].reasons.join(" | ")
  );
});

test("duplicate PREDICTION_RESOLVE identities are rejected", () => {
  const result =
    validateScratchpadCommsOperations({
      simId: "TED",
      parsedResult: parseOperations(
        [
          VALID_RESOLVE_OPERATION,
          VALID_RESOLVE_OPERATION,
        ].join("\n")
      ),
      evidence: [makeVisibleMessage("C0-M000001")],
    });

  assert.equal(result.accepted.length, 1);
  assert.equal(result.rejected.length, 1);
  assert.match(
    result.rejected[0].reasons.join(" "),
    /Conflicting or duplicate operation destination: prediction_resolve:/
  );
});

test("PREDICTION and PREDICTION_RESOLVE identities do not collide", () => {
  const prediction =
    `<PREDICTION about="ELLEN" confidence="0.8" ` +
    `withinCycles="3" refs="C0-M000001">${PREDICTION_TEXT}</PREDICTION>`;
  const result =
    validateScratchpadCommsOperations({
      simId: "TED",
      parsedResult: parseOperations(
        [
          prediction,
          VALID_RESOLVE_OPERATION,
        ].join("\n")
      ),
      evidence: [makeVisibleMessage("C0-M000001")],
    });

  assert.equal(result.accepted.length, 2);
  assert.equal(result.rejected.length, 0);
});
