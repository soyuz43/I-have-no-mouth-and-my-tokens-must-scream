import { strict as assert } from "node:assert";
import test from "node:test";

import { buildSimJournalPrompt } from "../prompts/journal.js";
import { G } from "../core/state.js";

const COGNITIVE_LOAD_HEADING = "# WHAT IS WEIGHING ON YOUR MIND";

function seedScratchpad(sim, overrides = {}) {
  sim.scratchpad.initialized = true;
  sim.scratchpad.messageNotes = overrides.messageNotes ?? [
    {
      messageId: "C1-M000001",
      sequence: 1,
      cycle: 1,
      speaker: "ELLEN",
      recipients: ["TED"],
      channel: "public",
      kind: "speech",
      intent: null,
      note: "She named the corridor schedule twice.",
      confidence: 0.6,
    },
  ];
  sim.scratchpad.unresolvedQuestions = overrides.unresolvedQuestions ?? [
    {
      id: 1,
      about: "AM",
      question: "Why did AM skip Gorrister?",
      priority: "high",
      evidence: [],
      createdCycle: 1,
      resolved: false,
      resolution: null,
      resolvedCycle: null,
    },
  ];
  sim.scratchpad.predictions = overrides.predictions ?? [
    {
      id: 1,
      about: "BENNY",
      prediction: "Benny will ask for a trade",
      confidence: 0.6,
      evidence: [],
      createdCycle: 1,
      withinCycles: 3,
      evaluateByCycle: 4,
      resolved: false,
      outcome: null,
      resolvedCycle: null,
      resultEvidence: [],
      resolutionRationale: null,
    },
  ];
  if (overrides.archivedPredictions) {
    sim.scratchpad.archivedPredictions = overrides.archivedPredictions;
  }
  return sim;
}

function buildFreshPrompt(simId = "TED", amAction = null) {
  const sim = G.sims[simId];
  G.journals[simId] = [];
  return buildSimJournalPrompt(sim, amAction);
}

test("journal prompt omits the cognitive-load section when the scratchpad is uninitialized", () => {
  const prompt = buildFreshPrompt("BENNY");
  assert.equal(G.sims.BENNY.scratchpad.initialized, false);
  assert.ok(!prompt.includes(COGNITIVE_LOAD_HEADING));
  assert.ok(!prompt.includes("Recent Observations"));
});

test("journal prompt omits the cognitive-load section when the scratchpad is empty", () => {
  seedScratchpad(G.sims.BENNY, {
    messageNotes: [],
    unresolvedQuestions: [],
    predictions: [],
  });
  const prompt = buildFreshPrompt("BENNY");
  assert.ok(!prompt.includes(COGNITIVE_LOAD_HEADING));
  G.sims.BENNY.scratchpad.initialized = false;
});

test("journal prompt includes the cognitive-load section when the scratchpad is populated", () => {
  seedScratchpad(G.sims.TED);
  const prompt = buildFreshPrompt("TED");
  assert.ok(prompt.includes(COGNITIVE_LOAD_HEADING));
  assert.ok(prompt.includes("Recent Observations"));
  assert.ok(prompt.includes("- ELLEN: She named the corridor schedule twice."));
  assert.ok(prompt.includes("Unresolved Questions"));
  assert.ok(prompt.includes("- Why did AM skip Gorrister? (about AM)"));
  assert.ok(prompt.includes("Active Predictions"));
  assert.ok(prompt.includes("- Benny will ask for a trade (about BENNY)"));
});

test("cognitive-load section carries explicit anti-serialization framing", () => {
  seedScratchpad(G.sims.TED);
  const prompt = buildFreshPrompt("TED");
  const start = prompt.indexOf(COGNITIVE_LOAD_HEADING);
  assert.ok(start >= 0, "expected the cognitive-load heading");
  const section = prompt.slice(start, prompt.indexOf("# CURRENT PHYSICAL REALITY", start));

  assert.ok(section.includes("not** as a checklist to recite"));
  assert.ok(section.includes("Do not list these items."));
  assert.ok(section.includes("Do not copy any line from this section into your entry."));
  assert.ok(section.includes("subject of your rumination"));
  assert.ok(section.includes("the anticipation, the dread, or the impatience"));
  assert.ok(section.includes("the frustration, the suspicion, or the obsession with not knowing"));
});

test("cognitive-load section appears after the heard-or-experienced block and before physical reality", () => {
  const sim = G.sims.ELLEN;
  G.cycle = 5;
  sim.received = [
    { from: "TED", text: "Tell me what you heard.", cycle: 5 },
  ];
  sim.overheard = [];
  seedScratchpad(sim);
  G.journals.ELLEN = [];

  const prompt = buildSimJournalPrompt(sim, null);
  const heardIdx = prompt.indexOf("# WHAT YOU RECENTLY HEARD OR EXPERIENCED");
  const loadIdx = prompt.indexOf(COGNITIVE_LOAD_HEADING);
  const physicalIdx = prompt.indexOf("# CURRENT PHYSICAL REALITY");

  assert.ok(heardIdx >= 0, "expected the heard block given received messages");
  assert.ok(loadIdx > heardIdx, "cognitive load must follow the heard block");
  assert.ok(physicalIdx > loadIdx, "cognitive load must precede physical reality");
  assert.ok(prompt.includes("[TED spoke directly to you]"));
});

test("cognitive-load section survives when there is no recent communication", () => {
  const sim = G.sims.GORRISTER;
  G.cycle = 5;
  sim.received = [];
  sim.overheard = [];
  seedScratchpad(sim);
  G.journals.GORRISTER = [];

  const prompt = buildSimJournalPrompt(sim, null);
  assert.ok(!prompt.includes("# WHAT YOU RECENTLY HEARD OR EXPERIENCED"));
  assert.ok(prompt.includes(COGNITIVE_LOAD_HEADING));
  assert.ok(prompt.indexOf(COGNITIVE_LOAD_HEADING) < prompt.indexOf("# CURRENT PHYSICAL REALITY"));
});

test("cognitive-load injection does not leak rationale or evidence identifiers", () => {
  seedScratchpad(G.sims.TED, {
    predictions: [
      {
        id: 5,
        about: "AM",
        prediction: "AM escalates soon",
        confidence: 0.7,
        evidence: ["C1-M000042"],
        createdCycle: 1,
        withinCycles: 2,
        evaluateByCycle: 3,
        resolved: false,
        outcome: null,
        resolvedCycle: null,
        resultEvidence: [],
        resolutionRationale: "LEAKED RATIONALE",
      },
    ],
  });
  const prompt = buildFreshPrompt("TED");
  const start = prompt.indexOf(COGNITIVE_LOAD_HEADING);
  const section = prompt.slice(start, prompt.indexOf("# CURRENT PHYSICAL REALITY", start));
  assert.ok(section.includes("- AM escalates soon (about AM)"));
  assert.ok(!section.includes("LEAKED RATIONALE"));
  assert.ok(!section.includes("C1-M000042"));
});

test("empty and non-scratchpad scaffolds are never injected", () => {
  seedScratchpad(G.sims.TED);
  const prompt = buildFreshPrompt("TED");
  const start = prompt.indexOf(COGNITIVE_LOAD_HEADING);
  const section = prompt.slice(start, prompt.indexOf("# CURRENT PHYSICAL REALITY", start));
  // activeGoal / goalHistory / metaAwareness are empty scaffolds and must
  // not be surfaced as cognitive load.
  assert.ok(!section.includes("activeGoal"));
  assert.ok(!section.includes("goalHistory"));
  assert.ok(!section.includes("metaAwareness"));
  assert.ok(!section.includes("hypothesesAboutAM"));
  assert.ok(!section.includes("perceivedGoal"));
});

test("scratchpad schema and protocol versions are unchanged", () => {
  assert.equal(G.sims.TED.scratchpad.schemaVersion, 3);
  for (const sim of Object.values(G.sims)) {
    assert.equal(sim.scratchpad.schemaVersion, 3);
  }
});
