import assert from "node:assert/strict";
import test from "node:test";

import { G } from "../core/state.js";
import {
  parseScratchpadCommsOutput
} from "../engine/scratchpad/comms/parse.js";
import {
  validateScratchpadCommsOperations
} from "../engine/scratchpad/comms/validate.js";
import {
  applyTacticRuntimeTransitions
} from "../engine/execution/tacticRuntime.js";
import {
  extractStrategy
} from "../engine/strategy/extractStrategy.js";
import {
  inspectAssessmentScaffold
} from "../engine/analysis/assessment.js";
import {
  guardJournalOutput
} from "../engine/phases/psychologyPhase.js";
import {
  detectPromptScaffoldLeak
} from "../utils/scaffoldLeakDetector.js";

function captureConsoleWarning(action) {
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args);

  try {
    return {
      result: action(),
      warnings
    };
  } finally {
    console.warn = originalWarn;
  }
}

function withSavedGlobalState(keys, action) {
  const saved = Object.fromEntries(
    keys.map((key) => [key, G[key]])
  );

  try {
    return action();
  } finally {
    Object.assign(G, saved);
  }
}

test("prompt-specific marker sets reject scaffold and accept valid outputs", () => {
  const validOutputs = [
    [
      "scratchpadComms",
      "<SCRATCHPAD_UPDATES><NO_UPDATE/></SCRATCHPAD_UPDATES>"
    ],
    [
      "assessment",
      "PHASE_RESULT: PARTIAL\nADVANCE_CRITERIA: UNCERTAIN\nTACTIC_RESULT: ONGOING\nEXPLANATION: The evidence is incomplete."
    ],
    [
      "amPlan",
      JSON.stringify({
        targets: [{
          id: "TED",
          objective: "Test a current belief",
          evidence: "Recent statements show uncertainty"
        }]
      })
    ],
    ["journal", "I kept a private account of what changed today."]
  ];

  for (const [promptType, output] of validOutputs) {
    assert.equal(
      detectPromptScaffoldLeak(output, { promptType }),
      null,
      `${promptType} should accept valid output`
    );
  }

  for (const placeholder of ["required target id", "integer", "boolean", "string"]) {
    assert.equal(
      detectPromptScaffoldLeak(
        JSON.stringify({ target: `<${placeholder}>` }),
        { promptType: "amPlan" }
      )?.reason,
      "prompt_scaffold_leak"
    );
  }
});

test("scratchpad scaffold fails validation before state can be committed", () => {
  const validParsed = parseScratchpadCommsOutput(
    "<SCRATCHPAD_UPDATES><NO_UPDATE/></SCRATCHPAD_UPDATES>"
  );
  assert.equal(validParsed.status, "success");

  const leakOutput =
    '<SCRATCHPAD_UPDATES><NOTE ref="MESSAGE_ID" confidence="0.00">' +
    "A note about a prisoner.\n" +
    '<OTHER target="PRISONER_ID" field="perceivedGoal">' +
    "A placeholder goal.\n" +
    "</OTHER></NOTE></SCRATCHPAD_UPDATES>";

  const { result: parsed, warnings } = captureConsoleWarning(() =>
    parseScratchpadCommsOutput(leakOutput, {
      simId: "TED",
      cycle: 41
    })
  );

  assert.equal(parsed.status, "failure");
  assert.equal(parsed.failureReason, "prompt_scaffold_leak");
  assert.deepEqual(parsed.operations, []);
  assert.equal(parsed.hasOperations, false);
  assert.equal(parsed.scaffoldLeak.detected, true);
  assert.equal(warnings[0][1].cycle, 41);
  assert.equal(warnings[0][1].simId, "TED");
  assert.equal(warnings[0][1].reason, "prompt_scaffold_leak");

  const validation = validateScratchpadCommsOperations({
    parsedResult: parsed,
    simId: "TED",
    evidence: []
  });

  assert.equal(validation.status, "failure");
  assert.equal(validation.errors.includes("prompt_scaffold_leak"), true);
  assert.deepEqual(validation.accepted, []);
  assert.equal(parsed.operations.length, 0);
});

test("assessment scaffold is degraded, logged, and excluded from tactic transitions", () => {
  withSavedGlobalState(["cycle", "timeline", "amTacticRuntime"], () => {
    G.cycle = 42;
    G.timeline = [];
    G.amTacticRuntime = { sentinel: "unchanged" };

    const { result: leak, warnings } = captureConsoleWarning(() =>
      inspectAssessmentScaffold(
        "PHASE_RESULT: PARTIAL\n" +
        "ADVANCE_CRITERIA: UNCERTAIN\n" +
        "TACTIC_RESULT: ONGOING\n" +
        "EXPLANATION: <one concise evidence-based sentence>",
        "TED"
      )
    );

    assert.equal(leak.reason, "prompt_scaffold_leak");
    assert.equal(warnings[0][1].simId, "TED");
    assert.equal(
      G.timeline.some(
        (event) =>
          event.label ===
          "!! ASSESSMENT REJECTED cycle=42 reason=prompt_scaffold_leak"
      ),
      true
    );

    assert.deepEqual(
      applyTacticRuntimeTransitions([
        {
          targetId: "TED",
          degraded: true,
          phaseResult: "ACHIEVED",
          advanceCriteria: "SATISFIED",
          tacticResult: "FINISHED"
        }
      ]),
      []
    );
    assert.deepEqual(G.amTacticRuntime, { sentinel: "unchanged" });
  });
});

test("AM plan scaffold fails extraction without publishing targets", () => {
  withSavedGlobalState(
    [
      "cycle",
      "sims",
      "executionMode",
      "parserMetrics",
      "parserConfig",
      "lastExtractedTargets",
      "amStrategy",
      "timeline"
    ],
    () => {
      G.cycle = 43;
      G.sims = { TED: { id: "TED" } };
      G.executionMode = "SINGLE";
      G.parserMetrics = null;
      G.parserConfig = { repairLevel: 1 };
      G.lastExtractedTargets = ["existing"];
      G.amStrategy = { targets: { TED: { objective: "existing" } } };
      G.timeline = [];

      const valid = extractStrategy(
        JSON.stringify({
          targets: [{
            id: "TED",
            evidence: "Recent behavior shows uncertainty.",
            why_now: "The current interaction can test it.",
            objective: "Test whether trust is stable.",
            hypothesis: "A clear question will reveal the belief."
          }]
        }),
        { DEBUG: false }
      );
      assert.equal(valid.status, "success");

      const invalid = extractStrategy(
        JSON.stringify({
          targets: [{
            id: "TED",
            evidence: "Recent behavior shows uncertainty.",
            why_now: "The current interaction can test it.",
            objective: "Test whether trust is stable.",
            hypothesis: "A clear question will reveal the belief.",
            target_placeholder: "<required target id>"
          }]
        }),
        { DEBUG: false }
      );

      assert.equal(invalid.status, "failure");
      assert.equal(invalid.errorType, "prompt_scaffold_leak");
      assert.deepEqual(G.lastExtractedTargets, []);
      assert.deepEqual(G.amStrategy, {
        targets: { TED: { objective: "existing" } }
      });
      assert.equal(
        G.timeline.some(
          (event) =>
            event.label ===
            "!! AM PLAN REJECTED cycle=43 reason=prompt_scaffold_leak"
        ),
        true
      );
    }
  );
});

test("journal scaffold falls back before reaching downstream text consumers", () => {
  withSavedGlobalState(["cycle", "timeline"], () => {
    G.cycle = 44;
    G.timeline = [];

    const valid = guardJournalOutput(
      "I kept a private account of today's conversation.",
      "The previous entry remains available.",
      "TED"
    );
    assert.equal(valid.rejected, false);
    assert.equal(
      valid.text,
      "I kept a private account of today's conversation."
    );

    const { result: rejected, warnings } = captureConsoleWarning(() =>
      guardJournalOutput(
        "<AM_INTERVENTION>\nA template block.\n</AM_INTERVENTION>",
        "The previous entry remains available.",
        "TED"
      )
    );

    assert.equal(rejected.rejected, true);
    assert.equal(rejected.scaffoldLeak.reason, "prompt_scaffold_leak");
    assert.equal(rejected.text, "The previous entry remains available.");
    assert.equal(warnings[0][1].simId, "TED");
    assert.equal(
      G.timeline.some(
        (event) =>
          event.label ===
          "!! JOURNAL REJECTED cycle=44 simId=TED reason=prompt_scaffold_leak"
      ),
      true
    );

    const noTrustedFallback = guardJournalOutput(
      "<AM_INTERVENTION>template</AM_INTERVENTION>",
      "<AM_INTERVENTION>also leaked</AM_INTERVENTION>",
      "TED"
    );
    assert.equal(noTrustedFallback.text, "");
  });
});
