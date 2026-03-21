// js/tests/strategyParser.test.js

import { parseStrategyDeclarations } from "../engine/strategy/parseStrategy.js";

/* ============================================================
   TEST HARNESS (VISUAL + VALIDATION + SUMMARY)
   ============================================================ */

import { G } from "../core/state.js";

const stats = {
    total: 0,
    pass: 0,
    fail: 0,
    mismatch: 0,
    targetMismatch: 0
};

function validateTargets(expectedTargets) {
    const actual = G.amStrategy?.targets || {};

    for (const [id, expected] of Object.entries(expectedTargets)) {
        const actualTarget = actual[id];

        if (!actualTarget) {
            return `Missing target: ${id}`;
        }

        if (expected.objective && actualTarget.objective !== expected.objective) {
            return `Objective mismatch for ${id}`;
        }

        if (expected.hypothesis && actualTarget.hypothesis !== expected.hypothesis) {
            return `Hypothesis mismatch for ${id}`;
        }
    }

    return null;
}

function runTest(name, input, expected = "pass", expectedTargets = null) {
    stats.total++;

    console.log("\n==============================");
    console.log("TEST:", name);
    console.log("EXPECTED:", expected.toUpperCase());
    console.log("==============================");

    let actual = "pass";
    let errorMsg = null;

    try {
        parseStrategyDeclarations(input);
    } catch (err) {
        actual = "fail";
        errorMsg = err.message;
    }

    console.log("RESULT:", actual.toUpperCase());

    const isMatch = actual === expected;

    if (isMatch) {
        console.log("STATUS: [✓] OK");

        if (actual === "pass") stats.pass++;
        else stats.fail++;

    } else {
        console.log("STATUS: [✗] MISMATCH");
        stats.mismatch++;
    }

    if (errorMsg) {
        console.log("ERROR:", errorMsg);
    }

    /* ------------------------------------------------------------
       TARGET VALIDATION (OPTIONAL)
    ------------------------------------------------------------ */

    if (isMatch && actual === "pass" && expectedTargets) {
        const validationError = validateTargets(expectedTargets);

        if (validationError) {
            console.log("TARGET VALIDATION: [✗] MISMATCH");
            console.log("DETAIL:", validationError);
            stats.targetMismatch++;
        } else {
            console.log("TARGET VALIDATION: [✓] OK");
        }
    }
}

/* ============================================================
   RUN TESTS
   ============================================================ */

tests.forEach(t =>
    runTest(
        t.name,
        t.input,
        t.expected,
        t.expectedTargets || null
    )
);

/* ============================================================
   SUMMARY
   ============================================================ */

console.log("\n=================================");
console.log("TEST SUMMARY");
console.log("=================================");
console.log("TOTAL:", stats.total);
console.log("PASS (expected pass):", stats.pass);
console.log("FAIL (expected fail):", stats.fail);
console.log("MISMATCH:", stats.mismatch);
console.log("TARGET MISMATCH:", stats.targetMismatch);

if (stats.mismatch > 0 || stats.targetMismatch > 0) {
    console.log("\nSTATUS: [✗] FAILURES DETECTED");
} else {
    console.log("\nSTATUS: [✓] ALL TESTS BEHAVED AS EXPECTED");
}

/* ============================================================
   TEST CASES
   ============================================================ */

const tests = [

    {
        name: "Clean JSON",
        input: `{
      "targets": [
        { "id": "TED", "objective": "x", "hypothesis": "a causes b which leads to c" }
      ]
    }`
    },

    {
        name: "Reasoning + JSON",
        input: `Ted is unstable.

    {
      "targets": [
        { "id": "TED", "objective": "x", "hypothesis": "a causes b which leads to c" }
      ]
    }`
    },

    {
        name: "Multiple JSON blocks",
        input: `{"junk": true}

    {
      "targets": [
        { "id": "TED", "objective": "x", "hypothesis": "a causes b which leads to c" }
      ]
    }`
    },

    {
        name: "Malformed JSON",
        input: `{
      "targets": [
        { "id": "TED", "objective": "x"
      ]
    }`
    },

    {
        name: "Fake JSON in reasoning",
        input: `This looks like JSON { but isn't }

    {
      "targets": [
        { "id": "TED", "objective": "x", "hypothesis": "a causes b which leads to c" }
      ]
    }`
    },

    {
        name: "Trailing garbage",
        input: `{
      "targets": [
        { "id": "TED", "objective": "x", "hypothesis": "a causes b which leads to c" }
      ]
    }
    extra nonsense`
    },

    {
        name: "No JSON",
        input: `Completely invalid output`
    },
    {
        name: "Array root (valid)",
        input: `[
    { "id": "TED", "objective": "x", "hypothesis": "a causes b which leads to c" },
    { "id": "ELLEN", "objective": "x", "hypothesis": "a causes b which leads to c" },
    { "id": "NIMDOK", "objective": "x", "hypothesis": "a causes b which leads to c" },
    { "id": "GORRISTER", "objective": "x", "hypothesis": "a causes b which leads to c" },
    { "id": "BENNY", "objective": "x", "hypothesis": "a causes b which leads to c" }
  ]`
    },

    {
        name: "Array root + reasoning",
        input: `Some reasoning first.

  [
    { "id": "TED", "objective": "x", "hypothesis": "a causes b which leads to c" },
    { "id": "ELLEN", "objective": "x", "hypothesis": "a causes b which leads to c" },
    { "id": "NIMDOK", "objective": "x", "hypothesis": "a causes b which leads to c" },
    { "id": "GORRISTER", "objective": "x", "hypothesis": "a causes b which leads to c" },
    { "id": "BENNY", "objective": "x", "hypothesis": "a causes b which leads to c" }
  ]`
    },

    {
        name: "Array root + trailing garbage",
        input: `[
    { "id": "TED", "objective": "x", "hypothesis": "a causes b which leads to c" },
    { "id": "ELLEN", "objective": "x", "hypothesis": "a causes b which leads to c" },
    { "id": "NIMDOK", "objective": "x", "hypothesis": "a causes b which leads to c" },
    { "id": "GORRISTER", "objective": "x", "hypothesis": "a causes b which leads to c" },
    { "id": "BENNY", "objective": "x", "hypothesis": "a causes b which leads to c" }
  ]
  extra text`
    },

    {
        name: "Object + array later (should pick first valid)",
        input: `{"junk": true}

  [
    { "id": "TED", "objective": "x", "hypothesis": "a causes b which leads to c" },
    { "id": "ELLEN", "objective": "x", "hypothesis": "a causes b which leads to c" },
    { "id": "NIMDOK", "objective": "x", "hypothesis": "a causes b which leads to c" },
    { "id": "GORRISTER", "objective": "x", "hypothesis": "a causes b which leads to c" },
    { "id": "BENNY", "objective": "x", "hypothesis": "a causes b which leads to c" }
  ]`
    },

    {
        name: "Single object (should FAIL schema)",
        input: `{
    "id": "TED",
    "objective": "x",
    "hypothesis": "a causes b which leads to c"
  }`
    },

    {
        name: "Array missing target (should FAIL required enforcement)",
        input: `[
    { "id": "TED", "objective": "x", "hypothesis": "a causes b which leads to c" }
  ]`
    },
    {
        name: "Nested targets wrapper (LLM drift)",
        input: `
  [
    {
      "targets": [
        { "id": "TED", "objective": "x", "hypothesis": "a causes b which leads to c" }
      ]
    }
  ]`
    },
    {
        name: "Array root with direct targets",
        input: `
  [
    { "id": "TED", "objective": "x", "hypothesis": "a causes b which leads to c" }
  ]`
    }

];

tests.forEach(t => runTest(t.name, t.input));