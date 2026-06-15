// js/tests/strategyExtractionRegression.test.mjs

import assert from "node:assert/strict";

import {
  classifyJsonError
} from "../engine/strategy/extractors/classifyJsonError.js";

import {
  fixSingleQuotedSchemaValues
} from "../engine/strategy/extractors/utils.js";

import {
  extractJSON
} from "../engine/strategy/extractors/extractJSON.js";

import {
  extractTargetsArray
} from "../engine/strategy/extractors/targetsExtractor.js";

import {
  repairTargetsExtractor
} from "../engine/strategy/extractors/repairTargetsExtractor.js";

/* ============================================================
   MINIMAL TEST HARNESS
============================================================ */

const results = {
  passed: 0,
  failed: 0
};

function test(name, fn) {
  try {
    fn();

    results.passed++;

    console.log(`✓ ${name}`);
  } catch (error) {
    results.failed++;

    console.error(`✗ ${name}`);
    console.error(`  ${error.message}`);
  }
}

/* ============================================================
   FIXTURES
============================================================ */

const malformedSingleQuoteStrategy = `
{
  "targets": [
    {
      "id": "TED",
      "evidence": "TED says: 'We cannot stay here.'",
      "why_now": "Hope remains high",
      "objective": "Decrease escape_possible",
      "hypothesis": 'If Ted's confidence weakens, escape_possible will decrease'
    },
    {
      "id": "ELLEN",
      "evidence": "Ellen says: 'I do not trust this.'",
      "why_now": 'Her group's trust is unstable',
      "objective": "Decrease others_trustworthy",
      "hypothesis": "Isolation will decrease others_trustworthy"
    }
  ]
}
`;

const validStrategy = `
{
  "targets": [
    {
      "id": "TED",
      "evidence": "Ted's statements indicate resistance.",
      "why_now": "Resistance is currently observable.",
      "objective": "Decrease escape_possible.",
      "hypothesis": "Pressure will decrease escape_possible."
    }
  ]
}
`;

/* ============================================================
   CLASSIFICATION TESTS
============================================================ */

test(
  "classifies known single-quoted schema values",
  () => {
    assert.equal(
      classifyJsonError(
        malformedSingleQuoteStrategy
      ),
      "single_quoted_value"
    );
  }
);

test(
  "does not classify valid JSON as single-quoted",
  () => {
    assert.notEqual(
      classifyJsonError(
        validStrategy
      ),
      "single_quoted_value"
    );
  }
);

/* ============================================================
   REPAIR FUNCTION TESTS
============================================================ */

test(
  "converts single-quoted schema values into valid JSON strings",
  () => {
    const repaired =
      fixSingleQuotedSchemaValues(
        malformedSingleQuoteStrategy
      );

    const parsed =
      JSON.parse(repaired);

    assert.equal(
      parsed.targets[0].hypothesis,
      "If Ted's confidence weakens, escape_possible will decrease"
    );

    assert.equal(
      parsed.targets[1].why_now,
      "Her group's trust is unstable"
    );
  }
);

test(
  "preserves apostrophes inside repaired values",
  () => {
    const input = `
{
  "targets": [
    {
      "id": "TED",
      "hypothesis": 'Ted's belief doesn't change unless AM's pressure rises'
    }
  ]
}
`;

    const repaired =
      fixSingleQuotedSchemaValues(
        input
      );

    const parsed =
      JSON.parse(repaired);

    assert.equal(
      parsed.targets[0].hypothesis,
      "Ted's belief doesn't change unless AM's pressure rises"
    );
  }
);

test(
  "does not alter valid double-quoted JSON strings",
  () => {
    const repaired =
      fixSingleQuotedSchemaValues(
        validStrategy
      );

    assert.equal(
      repaired,
      validStrategy
    );

    assert.doesNotThrow(
      () => JSON.parse(repaired)
    );
  }
);

test(
  "leaves an unclosed single-quoted value untouched",
  () => {
    const input = `
{
  "targets": [
    {
      "id": "TED",
      "hypothesis": 'This value never closes
    }
  ]
}
`;

    const repaired =
      fixSingleQuotedSchemaValues(
        input
      );

    assert.equal(
      repaired,
      input
    );
  }
);

/* ============================================================
   EXTRACTOR INTEGRATION TESTS
============================================================ */

test(
  "extractJSON recovers malformed single-quoted values",
  () => {
    const result =
      extractJSON(
        malformedSingleQuoteStrategy,
        {
          DEBUG_EXTRACT: false
        }
      );

    assert.ok(result);
    assert.ok(
      Array.isArray(result.targets)
    );

    assert.equal(
      result.targets.length,
      2
    );

    assert.equal(
      result.targets[0].id,
      "TED"
    );

    assert.equal(
      result.targets[0].hypothesis,
      "If Ted's confidence weakens, escape_possible will decrease"
    );

    assert.equal(
      result.targets[1].why_now,
      "Her group's trust is unstable"
    );
  }
);

test(
  "targets-array extractor recovers malformed values",
  () => {
    const result =
      extractTargetsArray(
        malformedSingleQuoteStrategy,
        {
          DEBUG_EXTRACT: false
        }
      );

    assert.ok(result);
    assert.equal(
      result.targets.length,
      2
    );

    assert.equal(
      result.targets[0].id,
      "TED"
    );

    assert.equal(
      result.targets[1].id,
      "ELLEN"
    );
  }
);

test(
  "repair-targets extractor recovers malformed values",
  () => {
    const result =
      repairTargetsExtractor(
        malformedSingleQuoteStrategy,
        {
          DEBUG_EXTRACT: false
        }
      );

    assert.ok(result);
    assert.equal(
      result.targets.length,
      2
    );

    assert.equal(
      result.targets[0].hypothesis,
      "If Ted's confidence weakens, escape_possible will decrease"
    );
  }
);

test(
  "array extractors preserve terminal possessive apostrophes",
  () => {
    const input = `
{
  "targets": [
    {
      "id": "TED",
      "hypothesis": 'The prisoners' trust will collapse'
    }
  ]
}
`;

    for (const extractor of [
      extractTargetsArray,
      repairTargetsExtractor
    ]) {
      const result = extractor(input, {
        DEBUG_EXTRACT: false
      });

      assert.ok(result);

      assert.equal(
        result.targets[0].hypothesis,
        "The prisoners' trust will collapse"
      );
    }
  }
);

test(
  "repairs a single-quoted value followed by a missing comma",
  () => {
    const input = `
{
  "targets": [
    {
      "id": "TED",
      "hypothesis": 'Pressure will reduce hope'
      "objective": "Reduce hope"
    }
  ]
}
`;

    for (const extractor of [
      extractJSON,
      extractTargetsArray,
      repairTargetsExtractor
    ]) {
      const result = extractor(input, {
        DEBUG_EXTRACT: false
      });

      assert.ok(result);

      assert.equal(
        result.targets[0].hypothesis,
        "Pressure will reduce hope"
      );

      assert.equal(
        result.targets[0].objective,
        "Reduce hope"
      );
    }
  }
);

/* ============================================================
   SUMMARY
============================================================ */

console.log("\n=================================");
console.log("STRATEGY EXTRACTION TEST SUMMARY");
console.log("=================================");
console.log("Passed:", results.passed);
console.log("Failed:", results.failed);

if (results.failed > 0) {
  console.error("\nSTATUS: FAIL");
  process.exitCode = 1;
} else {
  console.log("\nSTATUS: PASS");
}

