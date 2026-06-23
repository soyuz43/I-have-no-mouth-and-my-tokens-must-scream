// js/tests/scratchpadCommsRepair.test.js

import test from "node:test";
import assert from "node:assert/strict";

import {
  hasRecognizableScratchpadOperations,
  repairScratchpadCommsOutput,
} from "../engine/scratchpad/comms/repair.js";

import {
  parseScratchpadCommsOutput,
} from "../engine/scratchpad/comms/parse.js";

function repairAndParse(input) {
  const repairResult =
    repairScratchpadCommsOutput(input);

  const parsedResult =
    parseScratchpadCommsOutput(
      repairResult.repaired
    );

  return {
    repairResult,
    parsedResult,
  };
}

test(
  "repairs a fully entity-encoded NO_UPDATE response",
  () => {
    const input =
      "&lt;SCRATCHPAD_UPDATES&gt;" +
      "&lt;NO_UPDATE/&gt;" +
      "&lt;/SCRATCHPAD_UPDATES&gt;";

    const {
      repairResult,
      parsedResult,
    } = repairAndParse(input);

    assert.equal(
      repairResult.changed,
      true
    );

    assert.deepEqual(
      repairResult.changes,
      [
        "decoded_entity_encoded_protocol_tags",
      ]
    );

    assert.equal(
      repairResult.diagnostics
        .decodedEntityTagCount,
      3
    );

    assert.equal(
      repairResult.diagnostics
        .hasUsableWrapper,
      true
    );

    assert.equal(
      parsedResult.status,
      "success"
    );

    assert.deepEqual(
      parsedResult.operations.map(
        (operation) =>
          operation.tag
      ),
      ["NO_UPDATE"]
    );

    assert.equal(
      parsedResult.noUpdate,
      true
    );
  }
);

test(
  "repairs encoded protocol tags and encoded attribute quotes",
  () => {
    const input =
      "&lt;SCRATCHPAD_UPDATES&gt;" +
      "&lt;NOTE ref=&quot;C0-M000001&quot; confidence=&quot;0.5&quot;&gt;" +
      "Provisional interpretation." +
      "&lt;/NOTE&gt;" +
      "&lt;/SCRATCHPAD_UPDATES&gt;";

    const {
      repairResult,
      parsedResult,
    } = repairAndParse(input);

    assert.equal(
      repairResult.diagnostics
        .decodedEntityTagCount,
      4
    );

    assert.equal(
      parsedResult.status,
      "success"
    );

    assert.equal(
      parsedResult.operations.length,
      1
    );

    const [operation] =
      parsedResult.operations;

    assert.equal(
      operation.tag,
      "NOTE"
    );

    assert.equal(
      operation.attributes.ref,
      "C0-M000001"
    );

    assert.equal(
      operation.attributes.confidence,
      "0.5"
    );

    assert.equal(
      operation.text,
      "Provisional interpretation."
    );
  }
);

test(
  "does not reinterpret encoded tag-like text inside a real wrapper",
  () => {
    const input =
      '<SCRATCHPAD_UPDATES>' +
      '<NOTE ref="C0-M000001" confidence="0.5">' +
      'Literal &lt;NO_UPDATE/&gt; text.' +
      "</NOTE>" +
      "</SCRATCHPAD_UPDATES>";

    const {
      repairResult,
      parsedResult,
    } = repairAndParse(input);

    assert.equal(
      repairResult.changed,
      false
    );

    assert.equal(
      repairResult.diagnostics
        .decodedEntityTagCount,
      0
    );

    assert.equal(
      parsedResult.status,
      "success"
    );

    assert.deepEqual(
      parsedResult.operations.map(
        (operation) =>
          operation.tag
      ),
      ["NOTE"]
    );

    assert.equal(
      parsedResult.operations[0].text,
      "Literal <NO_UPDATE/> text."
    );
  }
);

test(
  "recognizes operations inside a fully entity-encoded wrapper",
  () => {
    const input =
      "&lt;SCRATCHPAD_UPDATES&gt;" +
      "&lt;NO_UPDATE/&gt;" +
      "&lt;/SCRATCHPAD_UPDATES&gt;";

    assert.equal(
      hasRecognizableScratchpadOperations(
        input
      ),
      true
    );
  }
);