// js/tests/scratchpadCommsRepair.test.js

// >>> NEW: Import the real test function under a different name
import nodeTest from "node:test";
// <<< NEW

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

// >>> NEW: Determine output mode
const IS_JSON = process.argv.includes("--json");
// <<< NEW

// >>> NEW: Custom test recorder (only used when IS_JSON is true)
let recordedTests = [];
function customTest(name, fn) {
  recordedTests.push({ name, fn });
}
// <<< NEW

// >>> NEW: Point `test` to the right function
const test = IS_JSON ? customTest : nodeTest;
// <<< NEW

/* ----------------------------------------------------------------
   ALL EXISTING TESTS REMAIN EXACTLY AS THEY WERE
---------------------------------------------------------------- */

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

test(
  "preserves encoded protocol-looking text inside a fully encoded operation body",
  () => {
    const input =
      "&lt;SCRATCHPAD_UPDATES&gt;" +
      "&lt;NOTE ref=&quot;C0-M000001&quot; confidence=&quot;0.5&quot;&gt;" +
      "Literal &lt;NO_UPDATE/&gt; text." +
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

    assert.deepEqual(
      parsedResult.operations.map(
        (operation) =>
          operation.tag
      ),
      ["NOTE"]
    );

    assert.equal(
      parsedResult.noUpdate,
      false
    );

    assert.equal(
      parsedResult.operations[0].text,
      "Literal <NO_UPDATE/> text."
    );
  }
);

// >>> NEW: JSON runner – only executes when IS_JSON is true
if (IS_JSON) {
  const results = [];

  for (const { name, fn } of recordedTests) {
    const start = process.hrtime.bigint();
    let status = "pass";
    let error = null;

    try {
      await fn();
    } catch (e) {
      status = "fail";
      error = {
        message: e.message,
        stack: e.stack,
        // capture any assert actual/expected if present
        actual: e.actual ?? undefined,
        expected: e.expected ?? undefined,
      };
    }

    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;

    results.push({
      name,
      status,
      duration_ms: Number(durationMs.toFixed(3)),
      error: error || undefined,
    });
  }

  // Print JSON array
  process.stdout.write(JSON.stringify(results, null, 2) + "\n");

  // Exit with non‑zero code if any test failed
  if (results.some(r => r.status === "fail")) {
    process.exitCode = 1;
  }
}
// <<< NEW