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

import {
  commitScratchpadCommsOperations,
} from "../engine/scratchpad/comms/commit.js";

import { G } from "../core/state.js";
import { makeScratchpad } from "../core/utils.js";
import { consolidateScratchpad } from "../engine/scratchpad/consolidate.js";

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

/* ============================================================
   COMMIT BEHAVIOR
   ============================================================ */

function makeOpenPrediction(overrides = {}) {
  return {
    id: 1,
    about: "ELLEN",
    prediction: PREDICTION_TEXT,
    confidence: 0.8,
    evidence: ["C0-M000001"],
    createdCycle: 0,
    withinCycles: 3,
    evaluateByCycle: 3,
    resolved: false,
    outcome: null,
    resolvedCycle: null,
    resultEvidence: [],
    resolutionRationale: null,
    ...overrides,
  };
}

function makeSimWithPrediction({
  prediction = makeOpenPrediction(),
  revision = 0,
} = {}) {
  const sim = {
    id: "TED",
    scratchpad: makeScratchpad("TED"),
  };
  sim.scratchpad.initialized = true;
  sim.scratchpad.revision = revision;
  sim.scratchpad.predictions = [prediction];
  return sim;
}

function makeSimWithoutPredictions() {
  const sim = {
    id: "TED",
    scratchpad: makeScratchpad("TED"),
  };
  sim.scratchpad.initialized = true;
  return sim;
}

const NEW_PREDICTION =
  `<PREDICTION about="ELLEN" confidence="0.8" ` +
  `withinCycles="3" refs="C0-M000001">${PREDICTION_TEXT}</PREDICTION>`;

function commitBatch(
  operations,
  { sim = makeSimWithPrediction() } = {}
) {
  G.cycle = 5;
  G.sims = { [sim.id]: sim };

  const parsedResult =
    parseOperations(
      Array.isArray(operations)
        ? operations.join("\n")
        : operations
    );
  const evidence = [
    makeVisibleMessage("C0-M000001"),
  ];
  const validationResult =
    validateScratchpadCommsOperations({
      simId: sim.id,
      parsedResult,
      evidence,
    });
  const commitResult =
    commitScratchpadCommsOperations({
      simId: sim.id,
      validationResult,
      evidence,
      cycle: 5,
    });

  return {
    sim,
    validationResult,
    commitResult,
  };
}

test("new prediction ID exceeds archived prediction IDs", () => {
  const sim = makeSimWithoutPredictions();
  sim.scratchpad.archivedPredictions = [
    {
      ...makeOpenPrediction({ id: 4 }),
      resolved: true,
    },
  ];
  sim.scratchpad.predictions = [
    makeOpenPrediction({
      id: 2,
      about: "NIMDOK",
      prediction: "NIMDOK will send the next message.",
    }),
  ];

  const { validationResult, commitResult } =
    commitBatch(NEW_PREDICTION, { sim });

  assert.equal(validationResult.accepted.length, 1);
  assert.equal(commitResult.status, "committed");
  assert.equal(sim.scratchpad.predictions[1].id, 5);
});

test("new prediction ID works when legacy scratchpad lacks archivedPredictions", () => {
  const sim = makeSimWithoutPredictions();
  delete sim.scratchpad.archivedPredictions;

  const { validationResult, commitResult } =
    commitBatch(NEW_PREDICTION, { sim });

  assert.equal(validationResult.accepted.length, 1);
  assert.equal(commitResult.status, "committed");
  assert.equal(sim.scratchpad.predictions[0].id, 1);
});

test("prediction archived after resolution does not release its ID for reuse", () => {
  const created = commitBatch(
    NEW_PREDICTION,
    { sim: makeSimWithoutPredictions() }
  );
  assert.equal(
    created.sim.scratchpad.predictions[0].id,
    1
  );

  const resolved = commitBatch(
    VALID_RESOLVE_OPERATION,
    { sim: created.sim }
  );
  assert.equal(
    resolved.sim.scratchpad.predictions[0].resolved,
    true
  );

  consolidateScratchpad(
    resolved.sim.scratchpad,
    5,
    1
  );
  assert.equal(
    resolved.sim.scratchpad.archivedPredictions[0].id,
    1
  );
  assert.equal(
    resolved.sim.scratchpad.predictions.length,
    0
  );

  const recreated = commitBatch(
    NEW_PREDICTION,
    { sim: resolved.sim }
  );
  assert.equal(recreated.commitResult.status, "committed");
  assert.equal(
    recreated.sim.scratchpad.predictions[0].id,
    2
  );
});

test("PREDICTION_RESOLVE sets all lifecycle fields and preserves prediction fields", () => {
  const original = makeOpenPrediction();
  const { sim, validationResult, commitResult } =
    commitBatch(
      VALID_RESOLVE_OPERATION,
      {
        sim: makeSimWithPrediction({
          prediction: original,
        }),
      }
    );

  assert.equal(validationResult.accepted.length, 1);
  assert.equal(commitResult.status, "committed");
  assert.equal(commitResult.substantiveChanged, true);
  assert.deepEqual(
    commitResult.operationReports,
    [
      {
        type: "prediction_resolve",
        tag: "PREDICTION_RESOLVE",
        changed: true,
        path: "predictions[0]",
        reason: null,
      },
    ]
  );

  const resolved =
    sim.scratchpad.predictions[0];
  assert.equal(resolved.resolved, true);
  assert.equal(resolved.outcome, "confirmed");
  assert.equal(
    resolved.resolutionRationale,
    "The cited message confirms the prediction."
  );
  assert.deepEqual(
    resolved.resultEvidence,
    ["C0-M000001"]
  );
  assert.equal(resolved.resolvedCycle, 5);

  assert.deepEqual(
    {
      id: resolved.id,
      about: resolved.about,
      prediction: resolved.prediction,
      confidence: resolved.confidence,
      evidence: resolved.evidence,
      createdCycle: resolved.createdCycle,
      withinCycles: resolved.withinCycles,
      evaluateByCycle: resolved.evaluateByCycle,
    },
    {
      id: original.id,
      about: original.about,
      prediction: original.prediction,
      confidence: original.confidence,
      evidence: original.evidence,
      createdCycle: original.createdCycle,
      withinCycles: original.withinCycles,
      evaluateByCycle: original.evaluateByCycle,
    }
  );
});

test("PREDICTION_RESOLVE increments scratchpad revision exactly once", () => {
  const { sim, commitResult } =
    commitBatch(
      VALID_RESOLVE_OPERATION,
      {
        sim: makeSimWithPrediction({
          revision: 4,
        }),
      }
    );

  assert.equal(commitResult.revisionBefore, 4);
  assert.equal(commitResult.revisionAfter, 5);
  assert.equal(sim.scratchpad.revision, 5);
  assert.equal(sim.scratchpad.lastUpdatedCycle, 5);
});

test("PREDICTION_RESOLVE no-ops when target is absent from the pre-batch snapshot", () => {
  const { sim, commitResult } =
    commitBatch(
      VALID_RESOLVE_OPERATION,
      { sim: makeSimWithoutPredictions() }
    );

  assert.equal(commitResult.status, "reviewed_no_change");
  assert.equal(commitResult.substantiveChanged, false);
  assert.equal(commitResult.revisionBefore, 0);
  assert.equal(commitResult.revisionAfter, 0);
  assert.equal(sim.scratchpad.revision, 0);
  assert.deepEqual(sim.scratchpad.predictions, []);
  assert.equal(
    commitResult.operationReports[0].reason,
    "prediction_resolve_target_not_found"
  );
});

test("PREDICTION_RESOLVE no-ops without overwriting an already-resolved prediction", () => {
  const prediction =
    makeOpenPrediction({
      resolved: true,
      outcome: "refuted",
      resolvedCycle: 2,
      resultEvidence: ["C0-M000002"],
      resolutionRationale: "Existing result.",
    });
  const { sim, commitResult } =
    commitBatch(
      VALID_RESOLVE_OPERATION,
      {
        sim: makeSimWithPrediction({
          prediction,
        }),
      }
    );

  assert.equal(commitResult.status, "reviewed_no_change");
  assert.equal(commitResult.substantiveChanged, false);
  assert.equal(commitResult.revisionAfter, 0);
  assert.equal(
    commitResult.operationReports[0].reason,
    "prediction_already_resolved"
  );
  assert.deepEqual(
    sim.scratchpad.predictions[0],
    prediction
  );
});

test("same-batch PREDICTION plus PREDICTION_RESOLVE does not resolve the new prediction", () => {
  const predictionOperation =
    `<PREDICTION about="ELLEN" confidence="0.8" ` +
    `withinCycles="3" refs="C0-M000001">${PREDICTION_TEXT}</PREDICTION>`;
  const { sim, validationResult, commitResult } =
    commitBatch(
      [
        predictionOperation,
        VALID_RESOLVE_OPERATION,
      ],
      { sim: makeSimWithoutPredictions() }
    );

  assert.equal(validationResult.accepted.length, 2);
  assert.equal(commitResult.status, "committed");
  assert.equal(
    commitResult.operationReports[1].reason,
    "prediction_resolve_target_not_prebatch"
  );
  assert.equal(
    sim.scratchpad.predictions[0].resolved,
    false
  );
  assert.equal(sim.scratchpad.revision, 1);
});

test("multiple PREDICTION_RESOLVE operations route non-target operations as no-ops", () => {
  const firstOperation =
    VALID_RESOLVE_OPERATION;
  const secondOperation =
    VALID_RESOLVE_OPERATION.replace(
      'withinCycles="3"',
      'withinCycles="4"'
    );
  const simFixture =
    makeSimWithPrediction();
  simFixture.scratchpad.predictions.push(
    makeOpenPrediction({
      id: 2,
      withinCycles: 4,
      evaluateByCycle: 4,
      resolved: true,
      outcome: "refuted",
      resolvedCycle: 2,
      resultEvidence: ["C0-M000002"],
      resolutionRationale: "Already resolved.",
    })
  );
  const { sim, validationResult, commitResult } =
    commitBatch(
      [
        firstOperation,
        secondOperation,
      ],
      {
        sim: simFixture,
      }
    );

  assert.equal(validationResult.accepted.length, 2);
  assert.equal(validationResult.rejected.length, 0);
  assert.equal(commitResult.status, "committed");
  assert.equal(commitResult.appliedOperationCount, 1);
  assert.equal(commitResult.noOpOperationCount, 1);
  assert.equal(commitResult.revisionAfter, 1);
  assert.equal(
    commitResult.operationReports[0].changed,
    true
  );
  assert.equal(
    commitResult.operationReports[1].changed,
    false
  );
  assert.equal(
    commitResult.operationReports[1].reason,
    "prediction_already_resolved"
  );
  assert.equal(
    sim.scratchpad.predictions[0].resolved,
    true
  );
});
