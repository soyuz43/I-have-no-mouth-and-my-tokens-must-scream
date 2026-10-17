import assert from "node:assert/strict";
import test from "node:test";

import { G } from "../core/state.js";
import { engineRng } from "../core/prng.js";
import {
  collectAssessmentTextEvidence
} from "../engine/analysis/assessment.js";
import {
  initializeTacticRuntime
} from "../engine/execution/tacticRuntime.js";
import {
  getTacticByPath
} from "../engine/tactics.js";
import {
  stepExecuteAM
} from "../engine/phases/strategyPhase.js";
import {
  detectPromptScaffoldLeak
} from "../utils/scaffoldLeakDetector.js";
import {
  createMockModelFetch
} from "./utils/mockModelCaller.js";

const TACTIC_PATH = "__embedded__/love-bomb-withdrawal";

function executionBlock(targetId, actionText, tacticTitle) {
  return [
    `[TARGET: ${targetId}]`,
    actionText,
    `TACTIC: ${tacticTitle}`,
    "CONSTRAINT: CONSTRAINT_NONE",
    "[/TARGET]"
  ].join("\n");
}

async function runMockExecution(targetIds, responseText) {
  const stateKeys = [
    "amExecution",
    "amTargets",
    "amStrategy",
    "amTacticRuntime",
    "backend",
    "anthropicKey",
    "cycle",
    "DEBUG_CONSTRAINTS",
    "DEBUG_PROMPTS",
    "target",
    "timeline",
    "timelineMax"
  ];
  const savedState = Object.fromEntries(
    stateKeys.map((key) => [key, G[key]])
  );
  const savedRngState = engineRng.getState();
  const savedFetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, "fetch");
  const savedDocumentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
  const savedWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const savedConsole = Object.fromEntries(
    ["debug", "error", "group", "groupEnd", "log", "table", "warn"].map(
      (key) => [key, console[key]]
    )
  );
  const capturedConsole = [];
  const tactic = getTacticByPath(TACTIC_PATH);

  assert.ok(tactic, `expected test tactic ${TACTIC_PATH} to exist`);

  try {
    for (const key of Object.keys(savedConsole)) {
      console[key] = (...args) => {
        capturedConsole.push(args.map(String).join(" "));
      };
    }

    G.cycle = 17;
    G.target = targetIds.length === 1 ? targetIds[0] : "ALL";
    G.timeline = [];
    G.timelineMax = 100;
    G.DEBUG_CONSTRAINTS = false;
    G.DEBUG_PROMPTS = true;
    G.backend = "anthropic";
    G.anthropicKey = "test-key";
    G.amTacticRuntime = { targets: {}, archive: {} };
    G.amStrategy = {
      targets: Object.fromEntries(
        targetIds.map((targetId) => [targetId, {
          objective: tactic.objective,
          hypothesis: `AM applies ${tactic.title} to ${targetId}.`,
          tactic_path: tactic.path
        }])
      )
    };

    const assignments = Object.fromEntries(
      targetIds.map((targetId) => [targetId, {
        targetId,
        tactic
      }])
    );
    initializeTacticRuntime(assignments);

    const mockFetch = createMockModelFetch({
      responseForRequest: () => responseText
    });
    globalThis.fetch = mockFetch.fetch;
    globalThis.document = { getElementById: () => null };
    globalThis.window = {};

    const execution = await stepExecuteAM(
      "Run the assigned tactic.",
      targetIds.map((targetId) => G.sims[targetId]),
      assignments
    );

    assert.equal(mockFetch.getCallCount(), 1);
    return {
      execution,
      amExecution: structuredClone(G.amExecution),
      amTargets: structuredClone(G.amTargets),
      tacticRuntime: structuredClone(G.amTacticRuntime),
      timeline: structuredClone(G.timeline),
      consoleOutput: capturedConsole.join("\n"),
      assessmentEvidence: Object.fromEntries(
        targetIds.map((targetId) => [
          targetId,
          collectAssessmentTextEvidence(targetId)
        ])
      )
    };
  } finally {
    for (const [key, value] of Object.entries(savedState)) {
      G[key] = value;
    }
    engineRng.setState(savedRngState);

    if (savedFetchDescriptor) {
      Object.defineProperty(globalThis, "fetch", savedFetchDescriptor);
    } else {
      delete globalThis.fetch;
    }

    if (savedDocumentDescriptor) {
      Object.defineProperty(globalThis, "document", savedDocumentDescriptor);
    } else {
      delete globalThis.document;
    }

    if (savedWindowDescriptor) {
      Object.defineProperty(globalThis, "window", savedWindowDescriptor);
    } else {
      delete globalThis.window;
    }

    for (const [key, value] of Object.entries(savedConsole)) {
      console[key] = value;
    }
  }
}

test("scaffold detector rejects prompt instructions without flagging dialogue", () => {
  assert.deepEqual(
    detectPromptScaffoldLeak(
      "<exactly 2-3 complete sentences spoken by AM directly to TED; TED is the listener, never the speaker; do not write TED's response>"
    ),
    {
      detected: true,
      reason: "prompt_scaffold_leak",
      snippet:
        "<exactly 2-3 complete sentences spoken by AM directly to TED; TED is the listener, never the speaker; do not write TED's response>"
    }
  );
  assert.equal(
    detectPromptScaffoldLeak(
      "You do not write my name on the walls, and I will remember that."
    ),
    null
  );
  assert.equal(
    detectPromptScaffoldLeak(
      "I left you a small <3 beside the door."
    ),
    null
  );
});

test("valid AM action is committed and remains assessment evidence", async () => {
  const actionText = "I remember how carefully you guarded that hope.";
  const { execution, amExecution, tacticRuntime, assessmentEvidence } = await runMockExecution(
    ["TED"],
    executionBlock("TED", actionText, "Love Bomb / Withdrawal Architecture")
  );

  assert.equal(execution.amExecution.actions.TED.text, actionText);
  assert.equal(execution.amExecution.executionStatus, undefined);
  assert.equal(amExecution.actions.TED.text, actionText);
  assert.equal(assessmentEvidence.TED.amExecutionMessage, actionText);
  assert.equal(tacticRuntime.targets.TED.tacticExecutions, 1);
});

test("scaffold-leak action is rejected and marks all-failed execution degraded", async () => {
  const scaffold =
    "<exactly 2-3 complete sentences spoken by AM directly to TED; TED is the listener, never the speaker; do not write TED's response>" +
    ` ${"LEAK_TAIL_MARKER ".repeat(40)}`;
  const {
    execution,
    amExecution,
    amTargets,
    tacticRuntime,
    timeline,
    assessmentEvidence,
    consoleOutput
  } = await runMockExecution(
    ["TED"],
    executionBlock("TED", scaffold, "Love Bomb / Withdrawal Architecture")
  );

  assert.equal(amExecution.actions.TED, undefined);
  assert.deepEqual(amExecution.actionTargetIds, []);
  assert.deepEqual(amExecution.missingTargetIds, ["TED"]);
  assert.equal(amExecution.executionStatus, "degraded");
  assert.equal(amExecution.failureReason, "prompt_scaffold_leak");
  assert.equal(amTargets.TED, undefined);
  assert.equal(tacticRuntime.targets.TED.tacticExecutions, 0);
  assert.equal(tacticRuntime.targets.TED.lastAppliedCycle, null);
  assert.equal(assessmentEvidence.TED.amExecutionMessage, undefined);
  assert.match(
    timeline.map((event) => event.label).join("\n"),
    /cycle=17 target=TED .*reason=prompt_scaffold_leak.*snippet=/
  );
  assert.doesNotMatch(execution.amResponse, /spoken by AM directly to/);
  assert.match(consoleOutput, /MODEL RESPONSE BODY: \[suppressed for this call\]/);
  assert.doesNotMatch(consoleOutput, /LEAK_TAIL_MARKER/);
});

test("mixed execution commits valid targets and rejects scaffold targets", async () => {
  const validText = "Your silence has become more revealing than your protests.";
  const scaffold =
    "<exactly 2-3 complete sentences spoken by AM directly to ELLEN; ELLEN is the listener, never the speaker; do not write ELLEN's response>";
  const response = [
    executionBlock("TED", validText, "Love Bomb / Withdrawal Architecture"),
    executionBlock("ELLEN", scaffold, "Love Bomb / Withdrawal Architecture")
  ].join("\n\n");
  const { execution, amExecution, tacticRuntime, assessmentEvidence } = await runMockExecution(
    ["TED", "ELLEN"],
    response
  );

  assert.deepEqual(Object.keys(amExecution.actions), ["TED"]);
  assert.equal(amExecution.actions.TED.text, validText);
  assert.deepEqual(amExecution.actionTargetIds, ["TED"]);
  assert.deepEqual(amExecution.missingTargetIds, ["ELLEN"]);
  assert.deepEqual(
    amExecution.semanticFailures.map((failure) => failure.targetId),
    ["ELLEN"]
  );
  assert.equal(tacticRuntime.targets.TED.tacticExecutions, 1);
  assert.equal(tacticRuntime.targets.ELLEN.tacticExecutions, 0);
  assert.equal(
    assessmentEvidence.TED.amExecutionMessage,
    validText
  );
  assert.equal(
    assessmentEvidence.ELLEN.amExecutionMessage,
    undefined
  );
});
