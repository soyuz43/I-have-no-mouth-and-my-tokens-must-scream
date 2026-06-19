// js/tests/strategyExtractionRegression.test.mjs

import assert from "node:assert/strict";
import { format } from "node:util";

import {
  classifyJsonError,
} from "../engine/strategy/extractors/classifyJsonError.js";

import {
  normalizeUnicode,
} from "../engine/strategy/extractors/normalizeUnicode.js";

import {
  normalizeJsonShape,
} from "../engine/strategy/extractors/normalizeJsonShape.js";

import {
  normalizeTargetKeys,
} from "../engine/strategy/extractors/normalizeKeys.js";

import {
  stripJsonComments,
  fixSingleQuotedSchemaValues,
  fixMissingCommas,
  fixBrokenStrings,
  fixStrayQuoteAfterComma,
  repairObjectBoundaries,
  splitRepeatedObjectBlocks,
} from "../engine/strategy/extractors/utils.js";

import {
  extractJSON,
} from "../engine/strategy/extractors/extractJSON.js";

import {
  extractTargetsArray,
} from "../engine/strategy/extractors/targetsExtractor.js";

import {
  repairTargetsExtractor,
} from "../engine/strategy/extractors/repairTargetsExtractor.js";

import {
  extractLabeledTargets,
} from "../engine/strategy/extractors/extractLabeledTargets.js";

import {
  extractLooseTargets,
} from "../engine/strategy/extractors/extractLooseTargets.js";

/* ============================================================
   OUTPUT MODES

   Human-readable, colored when stdout is a terminal:
     node js/tests/strategyExtractionRegression.test.mjs

   JSONL only:
     node js/tests/strategyExtractionRegression.test.mjs --json

   Human-readable plus prefixed JSONL records:
     node js/tests/strategyExtractionRegression.test.mjs --machine

   Show extractor console diagnostics for passing tests:
     node js/tests/strategyExtractionRegression.test.mjs --verbose

   Stop after the first failure:
     node js/tests/strategyExtractionRegression.test.mjs --fail-fast

   Run tests whose group/name contains text:
     node js/tests/strategyExtractionRegression.test.mjs --filter unicode

   List selected tests without running them:
     node js/tests/strategyExtractionRegression.test.mjs --list
============================================================ */

const SUITE_NAME =
  "strategy-extraction-regression";

const MACHINE_PREFIX =
  "@@STRATEGY_TEST@@";

function getArgValue(flag) {
  const directIndex =
    process.argv.indexOf(flag);

  if (
    directIndex !== -1 &&
    directIndex + 1 < process.argv.length
  ) {
    return process.argv[directIndex + 1];
  }

  const prefix = `${flag}=`;

  const inline =
    process.argv.find(
      (arg) =>
        arg.startsWith(prefix)
    );

  return inline
    ? inline.slice(prefix.length)
    : null;
}

const OUTPUT_MODE =
  process.argv.includes("--json") ||
  process.env.TEST_OUTPUT === "json"
    ? "json"
    : process.argv.includes("--machine") ||
        process.env.TEST_OUTPUT === "both"
      ? "both"
      : "human";

const JSON_ONLY =
  OUTPUT_MODE === "json";

const EMIT_MACHINE =
  OUTPUT_MODE !== "human";

const VERBOSE =
  process.argv.includes("--verbose") ||
  process.env.TEST_VERBOSE === "1";

const FAIL_FAST =
  process.argv.includes("--fail-fast") ||
  process.env.TEST_FAIL_FAST === "1";

const LIST_ONLY =
  process.argv.includes("--list");

const FILTER =
  String(
    getArgValue("--filter") ||
    process.env.TEST_FILTER ||
    ""
  )
    .trim()
    .toLowerCase();

const COLOR_ENABLED =
  !JSON_ONLY &&
  !process.env.NO_COLOR &&
  process.env.FORCE_COLOR !== "0" &&
  (
    Boolean(process.env.FORCE_COLOR) ||
    Boolean(process.stdout.isTTY)
  );

const ANSI = Object.freeze({
  reset: "\u001b[0m",
  bold: "\u001b[1m",
  dim: "\u001b[2m",
  red: "\u001b[31m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  blue: "\u001b[34m",
  magenta: "\u001b[35m",
  cyan: "\u001b[36m",
  gray: "\u001b[90m",
});

function paint(code, value) {
  const text =
    String(value);

  return COLOR_ENABLED
    ? `${code}${text}${ANSI.reset}`
    : text;
}

function humanLine(value = "") {
  if (JSON_ONLY) return;

  process.stdout.write(
    `${value}\n`
  );
}

function toSerializable(value) {
  if (value === undefined) {
    return null;
  }

  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  const seen =
    new WeakSet();

  try {
    const json =
      JSON.stringify(
        value,
        (_key, current) => {
          if (
            typeof current === "bigint"
          ) {
            return current.toString();
          }

          if (
            current &&
            typeof current === "object"
          ) {
            if (
              seen.has(current)
            ) {
              return "[Circular]";
            }

            seen.add(current);
          }

          return current;
        }
      );

    return json === undefined
      ? String(value)
      : JSON.parse(json);
  } catch {
    return String(value);
  }
}

function serializeError(error) {
  if (!error) return null;

  return {
    name:
      error.name ||
      "Error",

    message:
      error.message ||
      String(error),

    operator:
      error.operator ||
      null,

    actual:
      toSerializable(
        error.actual
      ),

    expected:
      toSerializable(
        error.expected
      ),

    stack:
      typeof error.stack === "string"
        ? error.stack
        : null,
  };
}

function emitMachine(payload) {
  if (!EMIT_MACHINE) return;

  const record = {
    suite: SUITE_NAME,
    timestamp:
      new Date().toISOString(),
    ...payload,
  };

  const line =
    JSON.stringify(record);

  process.stdout.write(
    JSON_ONLY
      ? `${line}\n`
      : `${MACHINE_PREFIX} ${line}\n`
  );
}

function captureConsole() {
  const diagnostics = [];

  const methods = [
    "log",
    "info",
    "debug",
    "warn",
    "error",
    "table",
    "group",
    "groupCollapsed",
    "groupEnd",
    "trace",
  ];

  const originals =
    new Map();

  for (const method of methods) {
    originals.set(
      method,
      console[method]
    );

    console[method] =
      (...args) => {
        diagnostics.push({
          level: method,
          message:
            format(...args),
        });
      };
  }

  return {
    diagnostics,

    restore() {
      for (
        const [
          method,
          original,
        ] of originals
      ) {
        console[method] =
          original;
      }
    },
  };
}

/* ============================================================
   TEST REGISTRATION
============================================================ */

const tests = [];

function test(
  group,
  name,
  fn
) {
  tests.push({
    group,
    name,
    fn,
  });
}

function testCases(
  group,
  cases,
  fn
) {
  for (
    const testCase of cases
  ) {
    test(
      group,
      testCase.name,
      () => fn(testCase)
    );
  }
}

/* ============================================================
   ASSERTION HELPERS
============================================================ */

const strategyExtractors =
  Object.freeze([
    {
      name:
        "extractJSON",

      run(input) {
        return extractJSON(
          input,
          {
            DEBUG_EXTRACT: false,
          }
        );
      },
    },

    {
      name:
        "extractTargetsArray",

      run(input) {
        return extractTargetsArray(
          input,
          {
            DEBUG_EXTRACT: false,
          }
        );
      },
    },

    {
      name:
        "repairTargetsExtractor",

      run(input) {
        return repairTargetsExtractor(
          input,
          {
            DEBUG_EXTRACT: false,
          }
        );
      },
    },
  ]);

function parseStrict(input) {
  return JSON.parse(input);
}

function assertTargetIds(
  result,
  expectedIds,
  label = "extractor"
) {
  assert.ok(
    result,
    `${label} returned null`
  );

  assert.ok(
    Array.isArray(
      result.targets
    ),
    `${label} did not return a targets array`
  );

  assert.deepEqual(
    result.targets.map(
      (target) =>
        target.id
    ),
    expectedIds,
    `${label} returned unexpected target IDs`
  );
}

function assertCompleteTarget(
  target,
  label = "target"
) {
  for (const key of [
    "id",
    "evidence",
    "why_now",
    "objective",
    "hypothesis",
  ]) {
    assert.equal(
      typeof target?.[key],
      "string",
      `${label}.${key} is not a string`
    );

    assert.ok(
      target[key]
        .trim()
        .length > 0,
      `${label}.${key} is empty`
    );
  }
}

function assertAcrossStrategyExtractors(
  input,
  verify
) {
  for (
    const extractor
    of strategyExtractors
  ) {
    const result =
      extractor.run(input);

    verify(
      result,
      extractor.name
    );
  }
}

/* ============================================================
   FIXTURES
============================================================ */

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

const validTwoTargetStrategy = `
{
  "targets": [
    {
      "id": "TED",
      "evidence": "TED remains defiant.",
      "why_now": "His confidence is exposed.",
      "objective": "Reduce hope.",
      "hypothesis": "Pressure will reduce hope."
    },
    {
      "id": "ELLEN",
      "evidence": "ELLEN remains observant.",
      "why_now": "Her certainty is exposed.",
      "objective": "Reduce confidence.",
      "hypothesis": "Contradiction will reduce confidence."
    }
  ]
}
`;

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

const exactBennyFailure = `
{
  "targets": [
    {
      "id": "BENNY",
      "evidence": "Benny is constantly queried by Ellen about hidden knowledge; his self_worth is low (45%).",
      “why_now”: “Low self-worth combined with high guilt makes Benny primed to defend his intelligence at any cost, making him a prime target for contradictory validation that will increase paranoia and isolation.",
      "objective": “Force Benny into a public declaration of truth vs. perception error by presenting an apparently incontrovertible fact that contradicts his recollection; this will isolate Benny as the skeptic whose word must be trusted or doubted.”
      "hypothesis”: “Provoking a stark self-doubt confrontation will intensify Benny’s need to prove himself right, creating intra-group conflict.”
    }
  ]
}
`;

const malformedSingleQuoteAndCommaStrategy = `
{
  "targets": [
    {
      "id": "TED",
      "evidence": "TED remains defiant.",
      "why_now": "Resistance is exposed.",
      "hypothesis": 'Pressure will reduce hope'
      "objective": "Reduce hope."
    }
  ]
}
`;

const commentedStrategy = `
{
  // The model added an illegal line comment.
  "targets": [
    {
      "id": "TED",
      "evidence": "The URL https://example.test/a//b remains literal.",
      /* The model also added a block comment. */
      "why_now": "Resistance is visible.",
      "objective": "Reduce hope.",
      "hypothesis": "Pressure will reduce hope."
    }
  ]
}
`;

const brokenInteriorQuoteStrategy = `
{
  "targets": [
    {
      "id": "TED",
      "evidence": "TED remains verbally defiant.",
      "why_now": "His confidence is exposed.",
      "objective": "Make him say "I surrender" publicly.",
      "hypothesis": "Public humiliation will reduce hope."
    }
  ]
}
`;

const trailingCommaStrategy = `
{
  "targets": [
    {
      "id": "TED",
      "evidence": "TED remains defiant.",
      "why_now": "His resistance is exposed.",
      "objective": "Reduce hope.",
      "hypothesis": "Pressure will reduce hope."
    },
  ]
}
`;

const adjacentObjectStrategy = `
{
  "targets": [
    {
      "id": "TED",
      "evidence": "TED remains defiant.",
      "why_now": "His resistance is exposed.",
      "objective": "Reduce hope.",
      "hypothesis": "Pressure will reduce hope."
    }
    {
      "id": "ELLEN",
      "evidence": "ELLEN remains observant.",
      "why_now": "Her certainty is exposed.",
      "objective": "Reduce confidence.",
      "hypothesis": "Contradiction will reduce confidence."
    }
  ]
}
`;

const repeatedIdBlockStrategy = `
{
  "targets": [
    {
      "id": "TED",
      "evidence": "TED remains defiant.",
      "why_now": "His resistance is exposed.",
      "objective": "Reduce hope.",
      "hypothesis": "Pressure will reduce hope."
      "id": "ELLEN",
      "evidence": "ELLEN remains observant.",
      "why_now": "Her certainty is exposed.",
      "objective": "Reduce confidence.",
      "hypothesis": "Contradiction will reduce confidence."
    }
  ]
}
`;

const fuzzyKeyStrategy = `
{
  "targets": [
    {
      "id": "TED",
      "evidence": "TED remains defiant.",
      "why now": "His resistance is exposed.",
      "objective": "Reduce hope.",
      "hypothsis": "Pressure will reduce hope."
    }
  ]
}
`;

const invisibleUnicodeStrategy =
  `\uFEFF\u200B${validStrategy}`;

const fullwidthStructuralStrategy = `
{
  "targets"： [
    {
      "id"： "TED"，
      "evidence"： "TED remains defiant."，
      "why_now"： "His resistance is exposed."，
      "objective"： "Reduce hope."，
      "hypothesis"： "Pressure will reduce hope."
    }
  ]
}
`;

const fencedStrategy = `
AM reasoning appears before the data.

\`\`\`json
${validStrategy.trim()}
\`\`\`

Narrative appears after the data.
`;

const bareTargetsArray = `
[
  {
    "id": "TED",
    "evidence": "TED remains defiant.",
    "why_now": "His resistance is exposed.",
    "objective": "Reduce hope.",
    "hypothesis": "Pressure will reduce hope."
  }
]
`;

/* ============================================================
   CLASSIFICATION TESTS
============================================================ */

const classificationCases = [
  {
    name:
      "classifies non-string input",

    input:
      null,

    expected:
      "invalid_input",
  },

  {
    name:
      "classifies an unescaped newline inside a string",

    input:
      `{"objective":"line one
line two"}`,

    expected:
      "unescaped_newline_in_string",
  },

  {
    name:
      "classifies a trailing comma",

    input:
      `{"id":"TED",}`,

    expected:
      "trailing_comma",
  },

  {
    name:
      "classifies leading invisible characters",

    input:
      `\uFEFF{"id":"TED"}`,

    expected:
      "invisible_leading_characters",
  },

  {
    name:
      "classifies single-quoted object delimiters",

    input:
      `{'id':'TED'}`,

    expected:
      "single_quoted_delimiter",
  },

  {
    name:
      "classifies known single-quoted schema values",

    input:
      malformedSingleQuoteStrategy,

    expected:
      "single_quoted_value",
  },

  {
    name:
      "classifies Unicode quotation marks",

    input:
      exactBennyFailure,

    expected:
      "unicode_quotes",
  },

  {
    name:
      "classifies a missing property comma",

    input:
      `{"objective":"a"
"hypothesis":"b"}`,

    expected:
      "missing_comma",
  },

  {
    name:
      "classifies adjacent object structures",

    input:
      `[{"id":"TED"}{"id":"ELLEN"}]`,

    expected:
      "structural_merge",
  },

  {
    name:
      "classifies foreign structured output",

    input:
      `GroupLayout: [TED, ELLEN]`,

    expected:
      "foreign_structure",
  },

  {
    name:
      "classifies unbalanced object truncation",

    input:
      `{"targets":[{"id":"TED"}]`,

    expected:
      "truncated",
  },

  {
    name:
      "returns unknown for valid ordinary JSON",

    input:
      validStrategy,

    expected:
      "unknown",
  },
];

testCases(
  "classification",
  classificationCases,
  ({
    input,
    expected,
  }) => {
    assert.equal(
      classifyJsonError(input),
      expected
    );
  }
);

/* ============================================================
   UNICODE NORMALIZATION TESTS
============================================================ */

test(
  "unicode-normalization",
  "removes a BOM and invisible format characters",
  () => {
    const normalized =
      normalizeUnicode(
        invisibleUnicodeStrategy
      );

    assert.ok(
      normalized.startsWith("\n{") ||
      normalized.startsWith("{")
    );

    assert.doesNotThrow(
      () =>
        parseStrict(normalized)
    );
  }
);

test(
  "unicode-normalization",
  "normalizes nonbreaking structural whitespace",
  () => {
    const input =
      `{\u00A0"targets"\u202F:\u00A0[]}`;

    assert.deepEqual(
      parseStrict(
        normalizeUnicode(input)
      ),
      {
        targets: [],
      }
    );
  }
);

test(
  "unicode-normalization",
  "repairs mixed straight and smart key/value delimiters",
  () => {
    const repaired =
      fixMissingCommas(
        normalizeUnicode(
          exactBennyFailure
        )
      );

    const parsed =
      parseStrict(repaired);

    assert.equal(
      parsed.targets[0].id,
      "BENNY"
    );

    assert.match(
      parsed.targets[0].why_now,
      /Low self-worth/
    );

    assert.match(
      parsed.targets[0].hypothesis,
      /intra-group conflict/
    );
  }
);

test(
  "unicode-normalization",
  "repairs fullwidth structural colons and commas",
  () => {
    const parsed =
      parseStrict(
        normalizeUnicode(
          fullwidthStructuralStrategy
        )
      );

    assert.equal(
      parsed.targets[0].id,
      "TED"
    );
  }
);

test(
  "unicode-normalization",
  "preserves smart quotes, apostrophes, and dashes inside valid prose",
  () => {
    const input = `
{
  "targets": [
    {
      "id": "TED",
      "evidence": "He said “no”—then Benny’s confidence broke.",
      "why_now": "Now.",
      "objective": "Apply pressure.",
      "hypothesis": "The prisoners’ trust will fracture."
    }
  ]
}
`;

    const normalized =
      normalizeUnicode(input);

    assert.equal(
      normalized,
      input
    );

    assert.doesNotThrow(
      () =>
        parseStrict(normalized)
    );
  }
);

/* ============================================================
   SINGLE-QUOTED VALUE TESTS
============================================================ */

test(
  "single-quoted-values",
  "converts known single-quoted schema values",
  () => {
    const parsed =
      parseStrict(
        fixSingleQuotedSchemaValues(
          malformedSingleQuoteStrategy
        )
      );

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
  "single-quoted-values",
  "preserves multiple apostrophes inside a repaired value",
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

    const parsed =
      parseStrict(
        fixSingleQuotedSchemaValues(
          input
        )
      );

    assert.equal(
      parsed.targets[0].hypothesis,
      "Ted's belief doesn't change unless AM's pressure rises"
    );
  }
);

test(
  "single-quoted-values",
  "preserves a terminal possessive apostrophe",
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

    const parsed =
      parseStrict(
        fixSingleQuotedSchemaValues(
          input
        )
      );

    assert.equal(
      parsed.targets[0].hypothesis,
      "The prisoners' trust will collapse"
    );
  }
);

test(
  "single-quoted-values",
  "escapes double quotes embedded in a repaired value",
  () => {
    const input = `
{
  "targets": [
    {
      "id": "TED",
      "objective": 'Make TED say "I surrender" publicly'
    }
  ]
}
`;

    const parsed =
      parseStrict(
        fixSingleQuotedSchemaValues(
          input
        )
      );

    assert.equal(
      parsed.targets[0].objective,
      'Make TED say "I surrender" publicly'
    );
  }
);

test(
  "single-quoted-values",
  "does not alter valid double-quoted JSON",
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
      () =>
        parseStrict(repaired)
    );
  }
);

test(
  "single-quoted-values",
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

    assert.equal(
      fixSingleQuotedSchemaValues(
        input
      ),
      input
    );
  }
);

/* ============================================================
   COMMENT TESTS
============================================================ */

test(
  "comment-repair",
  "removes line and block comments outside strings",
  () => {
    const repaired =
      stripJsonComments(
        commentedStrategy
      );

    const parsed =
      parseStrict(repaired);

    assert.equal(
      parsed.targets[0].id,
      "TED"
    );
  }
);

test(
  "comment-repair",
  "preserves URLs and comment-like sequences inside strings",
  () => {
    const input = `
{
  "url": "https://example.test/a//b",
  "literal": "/* not a comment */"
}
`;

    const parsed =
      parseStrict(
        stripJsonComments(input)
      );

    assert.equal(
      parsed.url,
      "https://example.test/a//b"
    );

    assert.equal(
      parsed.literal,
      "/* not a comment */"
    );
  }
);

test(
  "comment-repair",
  "preserves line count while removing block comments",
  () => {
    const input =
      `{"a":1,/* first
second */"b":2}`;

    const repaired =
      stripJsonComments(input);

    assert.equal(
      repaired
        .split("\n")
        .length,
      input
        .split("\n")
        .length
    );

    assert.deepEqual(
      parseStrict(repaired),
      {
        a: 1,
        b: 2,
      }
    );
  }
);

/* ============================================================
   MISSING-COMMA TESTS
============================================================ */

const missingCommaCases = [
  {
    name:
      "inserts a comma after a string value",

    input:
      `{"a":"one"
"b":"two"}`,

    expected: {
      a: "one",
      b: "two",
    },
  },

  {
    name:
      "inserts a comma after a number",

    input:
      `{"a":1
"b":2}`,

    expected: {
      a: 1,
      b: 2,
    },
  },

  {
    name:
      "inserts a comma after a boolean",

    input:
      `{"a":true
"b":false}`,

    expected: {
      a: true,
      b: false,
    },
  },

  {
    name:
      "inserts a comma after null",

    input:
      `{"a":null
"b":"two"}`,

    expected: {
      a: null,
      b: "two",
    },
  },

  {
    name:
      "inserts a comma after an object value",

    input:
      `{"a":{}
"b":"two"}`,

    expected: {
      a: {},
      b: "two",
    },
  },

  {
    name:
      "inserts a comma after an array value",

    input:
      `{"a":[]
"b":"two"}`,

    expected: {
      a: [],
      b: "two",
    },
  },
];

testCases(
  "missing-commas",
  missingCommaCases,
  ({
    input,
    expected,
  }) => {
    assert.deepEqual(
      parseStrict(
        fixMissingCommas(input)
      ),
      expected
    );
  }
);

test(
  "missing-commas",
  "does not modify valid comma-separated JSON",
  () => {
    const input = `{
  "a": 1,
  "b": 2
}`;

    assert.equal(
      fixMissingCommas(input),
      input
    );
  }
);

test(
  "missing-commas",
  "does not insert a comma before key-like text inside a string",
  () => {
    const input =
      `{"a":"text containing \\"key\\": syntax"}`;

    const repaired =
      fixMissingCommas(input);

    assert.equal(
      repaired,
      input
    );

    assert.doesNotThrow(
      () =>
        parseStrict(repaired)
    );
  }
);

/* ============================================================
   STRING / BOUNDARY / SHAPE TESTS
============================================================ */

test(
  "string-repair",
  "escapes unescaped quotes inside a string value",
  () => {
    const parsed =
      parseStrict(
        fixBrokenStrings(
          `{"objective":"Make him say "I surrender" publicly."}`
        )
      );

    assert.equal(
      parsed.objective,
      'Make him say "I surrender" publicly.'
    );
  }
);

test(
  "string-repair",
  "preserves already escaped interior quotes",
  () => {
    const input =
      `{"objective":"Make him say \\"I surrender\\" publicly."}`;

    const repaired =
      fixBrokenStrings(input);

    assert.equal(
      repaired,
      input
    );

    assert.doesNotThrow(
      () =>
        parseStrict(repaired)
    );
  }
);

test(
  "string-repair",
  "removes a stray quote after a comma",
  () => {
    const input = `{
  "objective": "Reduce hope.","
  "hypothesis": "Pressure works."
}`;

    const parsed =
      parseStrict(
        fixStrayQuoteAfterComma(
          input
        )
      );

    assert.equal(
      parsed.hypothesis,
      "Pressure works."
    );
  }
);

test(
  "boundary-repair",
  "inserts a comma between adjacent objects",
  () => {
    const parsed =
      parseStrict(
        repairObjectBoundaries(
          `[{"id":"TED"}{"id":"ELLEN"}]`
        )
      );

    assert.deepEqual(
      parsed.map(
        (target) =>
          target.id
      ),
      [
        "TED",
        "ELLEN",
      ]
    );
  }
);

test(
  "boundary-repair",
  "repairs a repeated id block boundary",
  () => {
    const input =
      `[{"id":"TED","objective":"a"}"id":"ELLEN","objective":"b"}]`;

    const repaired =
      splitRepeatedObjectBlocks(
        input
      );

    assert.match(
      repaired,
      /},\{"id":"ELLEN"/
    );
  }
);

test(
  "shape-normalization",
  "wraps multiple top-level objects in an array",
  () => {
    const parsed =
      parseStrict(
        normalizeJsonShape(
          `{"id":"TED"},{"id":"ELLEN"}`
        )
      );

    assert.deepEqual(
      parsed.map(
        (target) =>
          target.id
      ),
      [
        "TED",
        "ELLEN",
      ]
    );
  }
);

test(
  "shape-normalization",
  "does not count braces embedded inside strings",
  () => {
    const input =
      `{"text":"literal { brace }"}`;

    assert.equal(
      normalizeJsonShape(input),
      input
    );
  }
);

test(
  "shape-normalization",
  "leaves one root object unchanged",
  () => {
    assert.equal(
      normalizeJsonShape(
        validStrategy
      ),
      validStrategy
    );
  }
);

/* ============================================================
   KEY NORMALIZATION TESTS
============================================================ */

test(
  "key-normalization",
  "normalizes close schema-key variants",
  () => {
    const normalized =
      normalizeTargetKeys({
        id: "TED",
        "why now":
          "Current window",
        hypothsis:
          "Pressure works",
      });

    assert.equal(
      normalized.why_now,
      "Current window"
    );

    assert.equal(
      normalized.hypothesis,
      "Pressure works"
    );
  }
);

test(
  "key-normalization",
  "preserves unknown keys for diagnostics",
  () => {
    const normalized =
      normalizeTargetKeys({
        id: "TED",
        custom_debug_field: 7,
      });

    assert.equal(
      normalized.custom_debug_field,
      7
    );
  }
);

test(
  "key-normalization",
  "does not overwrite an earlier canonical field",
  () => {
    const normalized =
      normalizeTargetKeys({
        objective:
          "canonical",
        objectiv:
          "fuzzy duplicate",
      });

    assert.equal(
      normalized.objective,
      "canonical"
    );
  }
);

/* ============================================================
   EXTRACTOR INTEGRATION TESTS
============================================================ */

test(
  "extractor-integration",
  "all strategy extractors parse valid JSON",
  () => {
    assertAcrossStrategyExtractors(
      validTwoTargetStrategy,
      (
        result,
        label
      ) => {
        assertTargetIds(
          result,
          [
            "TED",
            "ELLEN",
          ],
          label
        );

        for (
          const [
            index,
            target,
          ] of result.targets.entries()
        ) {
          assertCompleteTarget(
            target,
            `${label}.targets[${index}]`
          );
        }
      }
    );
  }
);

test(
  "extractor-integration",
  "all strategy extractors recover single-quoted values",
  () => {
    assertAcrossStrategyExtractors(
      malformedSingleQuoteStrategy,
      (
        result,
        label
      ) => {
        assertTargetIds(
          result,
          [
            "TED",
            "ELLEN",
          ],
          label
        );

        assert.equal(
          result.targets[0]
            .hypothesis,
          "If Ted's confidence weakens, escape_possible will decrease",
          label
        );

        assert.equal(
          result.targets[1]
            .why_now,
          "Her group's trust is unstable",
          label
        );
      }
    );
  }
);

test(
  "extractor-integration",
  "all strategy extractors recover a single-quoted value followed by a missing comma",
  () => {
    assertAcrossStrategyExtractors(
      malformedSingleQuoteAndCommaStrategy,
      (
        result,
        label
      ) => {
        assertTargetIds(
          result,
          ["TED"],
          label
        );

        assert.equal(
          result.targets[0]
            .hypothesis,
          "Pressure will reduce hope",
          label
        );

        assert.equal(
          result.targets[0]
            .objective,
          "Reduce hope.",
          label
        );
      }
    );
  }
);

test(
  "extractor-integration",
  "all strategy extractors recover the exact mixed-Unicode BENNY failure",
  () => {
    assertAcrossStrategyExtractors(
      exactBennyFailure,
      (
        result,
        label
      ) => {
        assertTargetIds(
          result,
          ["BENNY"],
          label
        );

        assert.match(
          result.targets[0]
            .why_now,
          /Low self-worth/,
          label
        );

        assert.match(
          result.targets[0]
            .objective,
          /public declaration/,
          label
        );

        assert.match(
          result.targets[0]
            .hypothesis,
          /intra-group conflict/,
          label
        );
      }
    );
  }
);

test(
  "extractor-integration",
  "all strategy extractors strip comments without damaging URLs",
  () => {
    assertAcrossStrategyExtractors(
      commentedStrategy,
      (
        result,
        label
      ) => {
        assertTargetIds(
          result,
          ["TED"],
          label
        );

        assert.equal(
          result.targets[0]
            .evidence,
          "The URL https://example.test/a//b remains literal.",
          label
        );
      }
    );
  }
);

test(
  "extractor-integration",
  "all strategy extractors recover unescaped interior quotes",
  () => {
    assertAcrossStrategyExtractors(
      brokenInteriorQuoteStrategy,
      (
        result,
        label
      ) => {
        assertTargetIds(
          result,
          ["TED"],
          label
        );

        assert.equal(
          result.targets[0]
            .objective,
          'Make him say "I surrender" publicly.',
          label
        );
      }
    );
  }
);

test(
  "extractor-integration",
  "all strategy extractors remove trailing commas before array closure",
  () => {
    assertAcrossStrategyExtractors(
      trailingCommaStrategy,
      (
        result,
        label
      ) => {
        assertTargetIds(
          result,
          ["TED"],
          label
        );
      }
    );
  }
);

test(
  "extractor-integration",
  "all strategy extractors split adjacent target objects",
  () => {
    assertAcrossStrategyExtractors(
      adjacentObjectStrategy,
      (
        result,
        label
      ) => {
        assertTargetIds(
          result,
          [
            "TED",
            "ELLEN",
          ],
          label
        );
      }
    );
  }
);

test(
  "extractor-integration",
  "repair-capable extractors split a repeated id cascade",
  () => {
    const repairCapable =
      [
        {
          name:
            "extractJSON",

          run(input) {
            return extractJSON(
              input,
              {
                DEBUG_EXTRACT:
                  false,
              }
            );
          },
        },

        {
          name:
            "repairTargetsExtractor",

          run(input) {
            return repairTargetsExtractor(
              input,
              {
                DEBUG_EXTRACT:
                  false,
              }
            );
          },
        },
      ];

    for (
      const extractor
      of repairCapable
    ) {
      const result =
        extractor.run(
          repeatedIdBlockStrategy
        );

      assertTargetIds(
        result,
        [
          "TED",
          "ELLEN",
        ],
        extractor.name
      );
    }
  }
);

test(
  "extractor-integration",
  "all strategy extractors normalize fuzzy target keys",
  () => {
    assertAcrossStrategyExtractors(
      fuzzyKeyStrategy,
      (
        result,
        label
      ) => {
        assertTargetIds(
          result,
          ["TED"],
          label
        );

        assert.equal(
          result.targets[0]
            .why_now,
          "His resistance is exposed.",
          label
        );

        assert.equal(
          result.targets[0]
            .hypothesis,
          "Pressure will reduce hope.",
          label
        );
      }
    );
  }
);

test(
  "extractor-integration",
  "all strategy extractors recover leading invisible Unicode",
  () => {
    assertAcrossStrategyExtractors(
      invisibleUnicodeStrategy,
      (
        result,
        label
      ) => {
        assertTargetIds(
          result,
          ["TED"],
          label
        );
      }
    );
  }
);

test(
  "extractor-integration",
  "all strategy extractors recover fullwidth structural punctuation",
  () => {
    assertAcrossStrategyExtractors(
      fullwidthStructuralStrategy,
      (
        result,
        label
      ) => {
        assertTargetIds(
          result,
          ["TED"],
          label
        );
      }
    );
  }
);

test(
  "extractor-integration",
  "extractJSON recovers JSON from fenced output with surrounding prose",
  () => {
    const result =
      extractJSON(
        fencedStrategy,
        {
          DEBUG_EXTRACT: false,
        }
      );

    assertTargetIds(
      result,
      ["TED"],
      "extractJSON"
    );
  }
);

test(
  "extractor-integration",
  "extractJSON accepts a bare targets array",
  () => {
    const result =
      extractJSON(
        bareTargetsArray,
        {
          DEBUG_EXTRACT: false,
        }
      );

    assertTargetIds(
      result,
      ["TED"],
      "extractJSON"
    );
  }
);

test(
  "extractor-integration",
  "strategy extractors return null when no target structure exists",
  () => {
    const input =
      "No structured strategy was produced.";

    for (
      const extractor
      of strategyExtractors
    ) {
      assert.equal(
        extractor.run(input),
        null,
        extractor.name
      );
    }
  }
);

/* ============================================================
   LABELED / LOOSE FALLBACK TESTS
============================================================ */

test(
  "fallback-extractors",
  "extractLabeledTargets parses JSON-style Target blocks",
  () => {
    const input = `
Target TED:
{
  "evidence": "TED remains defiant.",
  "why_now": "His resistance is exposed.",
  "objective": "Reduce hope.",
  "hypothesis": "Pressure will reduce hope."
}

Target ELLEN:
{
  "evidence": "ELLEN remains observant.",
  "why_now": "Her certainty is exposed.",
  "objective": "Reduce confidence.",
  "hypothesis": "Contradiction will reduce confidence."
}
`;

    const result =
      extractLabeledTargets(
        input
      );

    assertTargetIds(
      result,
      [
        "TED",
        "ELLEN",
      ],
      "extractLabeledTargets"
    );
  }
);

test(
  "fallback-extractors",
  "extractLabeledTargets parses structured non-JSON Target blocks",
  () => {
    const input = `
Target BENNY:
Evidence: Benny doubts his own intelligence.
Why Now: His self-worth is exposed.
Objective: Force a defensive assertion.
Hypothesis: Defensive overcommitment will isolate him.
`;

    const result =
      extractLabeledTargets(
        input
      );

    assertTargetIds(
      result,
      ["BENNY"],
      "extractLabeledTargets"
    );

    assert.equal(
      result.targets[0]
        .why_now,
      "His self-worth is exposed."
    );
  }
);

test(
  "fallback-extractors",
  "extractLabeledTargets quotes unquoted JSON-style keys",
  () => {
    const input = `
Target TED:
{
  evidence: "TED remains defiant.",
  why_now: "His resistance is exposed.",
  objective: "Reduce hope.",
  hypothesis: "Pressure will reduce hope."
}
`;

    const result =
      extractLabeledTargets(
        input
      );

    assertTargetIds(
      result,
      ["TED"],
      "extractLabeledTargets"
    );
  }
);

test(
  "fallback-extractors",
  "extractLooseTargets recovers plain Target headings",
  () => {
    const input = `
Target: TED
Pressure TED until his confidence fractures.

Target: ELLEN
Contradict ELLEN's memory until she doubts herself.
`;

    const result =
      extractLooseTargets(
        input,
        {
          DEBUG_EXTRACT:
            false,
        }
      );

    assertTargetIds(
      result,
      [
        "TED",
        "ELLEN",
      ],
      "extractLooseTargets"
    );

    assert.equal(
      result.targets[0]
        ._loose,
      true
    );

    assert.equal(
      result.targets[0]
        ._recovery,
      "target_block_boundary"
    );

    assert.equal(
      result.targets[0]
        ._inferenceConfidence,
      0.25
    );
  }
);

test(
  "fallback-extractors",
  "fallback extractors return null when their expected headings are absent",
  () => {
    const input =
      "No target headings are present.";

    assert.equal(
      extractLabeledTargets(
        input
      ),
      null
    );

    assert.equal(
      extractLooseTargets(
        input,
        {
          DEBUG_EXTRACT:
            false,
        }
      ),
      null
    );
  }
);

/* ============================================================
   TEST RUNNER
============================================================ */

function selectedTests() {
  if (!FILTER) {
    return [...tests];
  }

  return tests.filter(
    ({
      group,
      name,
    }) =>
      `${group} ${name}`
        .toLowerCase()
        .includes(FILTER)
  );
}

function getGroupStats(
  results,
  group
) {
  if (
    !results.groups.has(group)
  ) {
    results.groups.set(
      group,
      {
        passed: 0,
        failed: 0,
        total: 0,
        durationMs: 0,
      }
    );
  }

  return results.groups.get(
    group
  );
}

function printDiagnostics(
  diagnostics
) {
  for (
    const diagnostic
    of diagnostics
  ) {
    humanLine(
      paint(
        diagnostic.level === "warn"
          ? ANSI.yellow
          : diagnostic.level ===
              "error"
            ? ANSI.red
            : ANSI.dim,
        `      [${diagnostic.level}] ${diagnostic.message}`
      )
    );
  }
}

function printFailure(
  error,
  diagnostics
) {
  humanLine(
    paint(
      ANSI.red,
      `    ${error?.name || "Error"}: ${error?.message || String(error)}`
    )
  );

  if (
    error &&
    (
      Object.prototype
        .hasOwnProperty
        .call(
          error,
          "actual"
        ) ||
      Object.prototype
        .hasOwnProperty
        .call(
          error,
          "expected"
        )
    )
  ) {
    humanLine(
      paint(
        ANSI.dim,
        `    actual:   ${format(error.actual)}`
      )
    );

    humanLine(
      paint(
        ANSI.dim,
        `    expected: ${format(error.expected)}`
      )
    );
  }

  if (
    diagnostics.length > 0
  ) {
    humanLine(
      paint(
        ANSI.yellow,
        "    captured diagnostics:"
      )
    );

    printDiagnostics(
      diagnostics
    );
  }
}

function printList(cases) {
  for (
    let index = 0;
    index < cases.length;
    index++
  ) {
    const item =
      cases[index];

    const id =
      `T${String(index + 1).padStart(3, "0")}`;

    humanLine(
      `${paint(ANSI.gray, id)} ` +
      `${paint(ANSI.magenta, item.group)} :: ` +
      item.name
    );

    emitMachine({
      event:
        "test_list_item",

      id,

      group:
        item.group,

      name:
        item.name,
    });
  }

  emitMachine({
    event:
      "test_list_summary",

    total:
      cases.length,

    filter:
      FILTER || null,
  });
}

async function runSuite() {
  const cases =
    selectedTests();

  if (LIST_ONLY) {
    printList(cases);
    return;
  }

  const results = {
    passed: 0,
    failed: 0,
    total:
      cases.length,
    durationMs: 0,
    groups:
      new Map(),
  };

  const suiteStarted =
    process.hrtime.bigint();

  humanLine();

  humanLine(
    paint(
      ANSI.bold +
      ANSI.cyan,
      "STRATEGY EXTRACTION REGRESSION SUITE"
    )
  );

  humanLine(
    paint(
      ANSI.dim,
      `${cases.length} selected / ${tests.length} total tests · Node ${process.version} · ${process.platform}`
    )
  );

  if (FILTER) {
    humanLine(
      paint(
        ANSI.yellow,
        `Filter: ${FILTER}`
      )
    );
  }

  emitMachine({
    event:
      "suite_start",

    selected:
      cases.length,

    total_registered:
      tests.length,

    node:
      process.version,

    platform:
      process.platform,

    arch:
      process.arch,

    output_mode:
      OUTPUT_MODE,

    color_enabled:
      COLOR_ENABLED,

    verbose:
      VERBOSE,

    fail_fast:
      FAIL_FAST,

    filter:
      FILTER || null,
  });

  let currentGroup =
    null;

  for (
    let index = 0;
    index < cases.length;
    index++
  ) {
    const testCase =
      cases[index];

    const id =
      `T${String(index + 1).padStart(3, "0")}`;

    if (
      !JSON_ONLY &&
      testCase.group !==
        currentGroup
    ) {
      currentGroup =
        testCase.group;

      humanLine();

      humanLine(
        paint(
          ANSI.bold +
          ANSI.magenta,
          `▶ ${currentGroup.toUpperCase()}`
        )
      );
    }

    const groupStats =
      getGroupStats(
        results,
        testCase.group
      );

    groupStats.total++;

    const capture =
      captureConsole();

    const started =
      process.hrtime.bigint();

    let error =
      null;

    try {
      await testCase.fn();
    } catch (caught) {
      error =
        caught;
    } finally {
      capture.restore();
    }

    const durationMs =
      Number(
        process.hrtime.bigint() -
        started
      ) /
      1_000_000;

    groupStats.durationMs +=
      durationMs;

    const passed =
      error === null;

    if (passed) {
      results.passed++;
      groupStats.passed++;

      humanLine(
        `${paint(ANSI.green, "  ✓")} ` +
        `${paint(ANSI.gray, id)} ` +
        `${testCase.name} ` +
        paint(
          ANSI.dim,
          `(${durationMs.toFixed(2)} ms)`
        )
      );

      if (
        VERBOSE &&
        capture.diagnostics.length >
          0
      ) {
        printDiagnostics(
          capture.diagnostics
        );
      }
    } else {
      results.failed++;
      groupStats.failed++;

      humanLine(
        `${paint(ANSI.red, "  ✗")} ` +
        `${paint(ANSI.gray, id)} ` +
        `${testCase.name} ` +
        paint(
          ANSI.dim,
          `(${durationMs.toFixed(2)} ms)`
        )
      );

      printFailure(
        error,
        capture.diagnostics
      );
    }

    emitMachine({
      event:
        "test_result",

      id,

      group:
        testCase.group,

      name:
        testCase.name,

      status:
        passed
          ? "pass"
          : "fail",

      duration_ms:
        Number(
          durationMs.toFixed(3)
        ),

      diagnostics:
        capture.diagnostics,

      error:
        serializeError(error),
    });

    if (
      !passed &&
      FAIL_FAST
    ) {
      break;
    }
  }

  results.durationMs =
    Number(
      process.hrtime.bigint() -
      suiteStarted
    ) /
    1_000_000;

  const groupSummary =
    Object.fromEntries(
      [
        ...results.groups.entries(),
      ].map(
        ([
          group,
          stats,
        ]) => [
          group,
          {
            passed:
              stats.passed,

            failed:
              stats.failed,

            total:
              stats.total,

            duration_ms:
              Number(
                stats.durationMs
                  .toFixed(3)
              ),
          },
        ]
      )
    );

  const status =
    results.failed > 0
      ? "fail"
      : "pass";

  humanLine();

  humanLine(
    paint(
      ANSI.bold +
      ANSI.cyan,
      "STRATEGY EXTRACTION TEST SUMMARY"
    )
  );

  humanLine(
    `${paint(ANSI.green, "Passed:")} ${results.passed}`
  );

  humanLine(
    `${paint(ANSI.red, "Failed:")} ${results.failed}`
  );

  humanLine(
    `${paint(ANSI.blue, "Run:")}    ${results.passed + results.failed}`
  );

  humanLine(
    `${paint(ANSI.blue, "Selected:")} ${results.total}`
  );

  humanLine(
    `${paint(ANSI.magenta, "Time:")}   ${results.durationMs.toFixed(2)} ms`
  );

  humanLine();

  humanLine(
    status === "pass"
      ? paint(
        ANSI.bold +
        ANSI.green,
        "STATUS: PASS"
      )
      : paint(
        ANSI.bold +
        ANSI.red,
        "STATUS: FAIL"
      )
  );

  emitMachine({
    event:
      "suite_summary",

    status,

    passed:
      results.passed,

    failed:
      results.failed,

    run:
      results.passed +
      results.failed,

    selected:
      results.total,

    total_registered:
      tests.length,

    duration_ms:
      Number(
        results.durationMs
          .toFixed(3)
      ),

    groups:
      groupSummary,
  });

  if (
    results.failed > 0
  ) {
    process.exitCode = 1;
  }
}

await runSuite();