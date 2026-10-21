import { strict as assert } from "node:assert";
import test from "node:test";

import { G } from "../core/state.js";
import { buildSimJournalPrompt } from "../prompts/journal.js";
import { buildSimJournalStatsPrompt } from "../prompts/stats.js";
import { formatGoalHistoryContext } from "../prompts/utils/formatGoalHistoryContext.js";
import { parseStatDeltas } from "../engine/state/extract.js";

function makeSim(goalHistory = [], activeGoal = null) {
  return {
    id: "TED",
    scratchpad: { goalHistory, activeGoal },
  };
}

test("goal history context keeps the three most recent terminal outcomes", () => {
  const sim = makeSim([
    { label: "First", status: "completed", terminalCycle: 1, terminalReason: "done", progress: 100 },
    { label: "Second", status: "abandoned", terminalCycle: 2, terminalReason: "reassigned", progress: 40 },
    { label: "Active", status: "active", terminalCycle: 8, terminalReason: "ongoing", progress: 20 },
    { label: "Third", status: "failed", terminalCycle: 3, terminalReason: "blocked", progress: 70 },
    { label: "Fourth", status: "completed", terminalCycle: 4, terminalReason: "done", progress: 100 },
    { label: "Fifth", status: "abandoned", terminalCycle: 5, terminalReason: "reassigned", progress: 10 },
  ], { label: "Current", status: "active", terminalCycle: 9 });

  assert.equal(
    formatGoalHistoryContext(sim),
    "[Cycle 5] [Fifth]: [abandoned] ([reassigned]) - Progress: [10]\n" +
      "[Cycle 4] [Fourth]: [completed] ([done]) - Progress: [100]\n" +
      "[Cycle 3] [Third]: [failed] ([blocked]) - Progress: [70]"
  );
  assert.ok(!formatGoalHistoryContext(sim).includes("Current"));
  assert.ok(!formatGoalHistoryContext(sim).includes("Active"));
});

test("goal history context renders exactly none when history is absent or non-terminal", () => {
  assert.equal(formatGoalHistoryContext(undefined), "(none)");
  assert.equal(formatGoalHistoryContext(makeSim()), "(none)");
  assert.equal(
    formatGoalHistoryContext(makeSim([{ label: "Ongoing", status: "active" }])),
    "(none)"
  );
});

test("goal history context ordering and rendering are deterministic", () => {
  const sim = makeSim([
    { label: "Earlier tie", status: "completed", terminalCycle: 7, terminalReason: "done", progress: 100 },
    { label: "Later tie", status: "abandoned", terminalCycle: 7, terminalReason: "reassigned", progress: 25 },
    { label: "Newest", status: "failed", terminalCycle: 8, terminalReason: "blocked", progress: 60 },
  ]);

  const first = formatGoalHistoryContext(sim);
  assert.equal(formatGoalHistoryContext(sim), first);
  assert.deepEqual(
    first.split("\n").map((line) => line.match(/^\[Cycle \d+\] \[(.*?)\]:/)[1]),
    ["Newest", "Later tie", "Earlier tie"]
  );
});

test("stats prompt injects goal history as secondary forensic context", () => {
  const sim = {
    ...G.sims.TED,
    scratchpad: {
      goalHistory: [
        { label: "Study AM's Patterns", status: "completed", terminalCycle: 3, terminalReason: "progress_threshold_reached", progress: 100 },
        { label: "Protect an Ally", status: "abandoned", terminalCycle: 4, terminalReason: "reassigned", progress: 25 },
      ],
    },
  };
  const prompt = buildSimJournalStatsPrompt(sim, "I still don't know what it means.", "(none)");

  assert.ok(prompt.includes("COVERT OBJECTIVE OUTCOMES (SECONDARY CONTEXT)"));
  assert.ok(prompt.includes("goal_history"));
  assert.ok(prompt.includes("whose *only* source is `goal_history` may support direction and magnitudes 1–3 only"));
  assert.ok(prompt.includes("magnitudes >=4 and all 7+ shifts still require current-journal textual support"));
  assert.ok(prompt.includes("A terminal outcome alone never implies a psychological change."));
});

test("stats prompt schema contains only engine-consumed evidence fields", () => {
  const prompt = buildSimJournalStatsPrompt(
    G.sims.TED,
    "I still don't know what it means.",
    "(none)"
  );
  const schemaStart = prompt.indexOf("**Output Schema**");
  const schemaEnd = prompt.indexOf(
    "**Observation Direction Semantics**",
    schemaStart
  );
  const outputSchema = prompt.slice(schemaStart, schemaEnd);

  assert.ok(schemaStart >= 0);
  assert.ok(schemaEnd > schemaStart);
  assert.ok(!outputSchema.includes('"domain"'));
  assert.doesNotMatch(outputSchema, /"reason":\s*\{\s*"suffering"/);
  assert.match(outputSchema, /"reason": \{\s*"beliefs"/);
  assert.ok(
    outputSchema.includes(
      '"target": "escape_possible | others_trustworthy | self_worth | reality_reliable | guilt_deserved | resistance_possible | am_has_limits"'
    )
  );
});

test("stat parser accepts the trimmed forensic stats schema", () => {
  const statsOutput = JSON.stringify({
    forensic_observations: [
      {
        source: "current_journal",
        signal: "No plan for escape was described.",
        target: "escape_possible",
        direction: "decrease",
        confidence: 0.8,
        rationale: "The journal describes resignation."
      }
    ],
    suffering_direction: "increased",
    suffering_magnitude: 3,
    hope_direction: "decreased",
    hope_magnitude: 2,
    sanity_direction: "unchanged",
    sanity_magnitude: 0,
    belief_deltas: {
      escape_possible: -1,
      others_trustworthy: 0,
      self_worth: 0,
      reality_reliable: 0,
      guilt_deserved: 0,
      resistance_possible: 0,
      am_has_limits: 0
    },
    drives: { primary: null, secondary: null },
    anchors: [],
    reason: { beliefs: "The journal conveys resignation." }
  });

  assert.deepEqual(
    parseStatDeltas(statsOutput, { id: "TED" }),
    {
      suffering: 3,
      hope: -2,
      sanity: 0,
      _parseMethod: "direct"
    }
  );
});

test("journal prompt includes only the most recent terminal objective outcome", () => {
  const sim = G.sims.TED;
  const originalHistory = sim.scratchpad.goalHistory;
  const originalActiveGoal = sim.scratchpad.activeGoal;
  const originalJournals = G.journals.TED;
  sim.scratchpad.goalHistory = [
    { label: "Study AM's Patterns", status: "completed", terminalCycle: 3, terminalReason: "progress_threshold_reached", progress: 100 },
    { label: "Protect an Ally", status: "abandoned", terminalCycle: 4, terminalReason: "reassigned", progress: 25 },
  ];
  sim.scratchpad.activeGoal = { label: "Find a Weakness", status: "active", progress: 10 };
  G.journals.TED = [];

  try {
    const prompt = buildSimJournalPrompt(sim, null);
    assert.ok(prompt.includes(
      "Recent Objective Outcome: Your attempt to Protect an Ally was abandoned in Cycle 4 (reassigned)."
    ));
    assert.ok(!prompt.includes("Your attempt to Find a Weakness"));
    assert.ok(!prompt.includes("Your attempt to Study AM's Patterns"));
  } finally {
    sim.scratchpad.goalHistory = originalHistory;
    sim.scratchpad.activeGoal = originalActiveGoal;
    G.journals.TED = originalJournals;
  }
});
