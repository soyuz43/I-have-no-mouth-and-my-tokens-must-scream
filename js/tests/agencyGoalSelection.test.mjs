import { test } from "node:test";
import assert from "node:assert/strict";

import { SIM_IDS } from "../core/constants.js";
import { G } from "../core/state.js";
import { createRng, engineRng } from "../core/prng.js";
import { collectAgencyProposal } from "../engine/agency/proposal.js";
import { runAgencyPhase } from "../engine/phases/agencyPhase.js";
import {
  selectTier1Goal,
  TIER1_GOALS
} from "../engine/scratchpad/goals/registry.js";
import { buildAgencyProposalPrompt } from "../prompts/agencyProposal.js";

const KNOWN_RNG_STATE = 246813579;

function resetScratchpads(activeGoal = null) {
  for (const simId of SIM_IDS) {
    G.sims[simId].scratchpad = {
      initialized: true,
      activeGoal: structuredClone(activeGoal)
    };
  }
}

async function withAgencyFixture(body) {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const previousCycle = G.cycle;
  const previousAgency = G.agency;
  const previousTimeline = G.timeline;
  const previousRngState = engineRng.getState();
  const previousScratchpads = Object.fromEntries(
    SIM_IDS.map((simId) => [
      simId,
      structuredClone(G.sims[simId].scratchpad)
    ])
  );

  globalThis.document = { getElementById: () => null };
  globalThis.window = { _timelineMissing: true };
  G.agency = structuredClone(previousAgency);
  G.timeline = previousTimeline.slice();

  try {
    await body({
      resetScratchpads,
      runPhase: (proposalCollector) =>
        runAgencyPhase({ proposalCollector })
    });
  } finally {
    G.cycle = previousCycle;
    G.agency = previousAgency;
    G.timeline = previousTimeline;
    engineRng.setState(previousRngState);

    for (const simId of SIM_IDS) {
      G.sims[simId].scratchpad = previousScratchpads[simId];
    }

    if (previousDocument === undefined) {
      delete globalThis.document;
    } else {
      globalThis.document = previousDocument;
    }

    if (previousWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = previousWindow;
    }
  }
}

function mockModelCollector(responseForSim) {
  return (sim, context) => collectAgencyProposal(sim, {
    ...context,
    modelCall: async () => JSON.stringify(responseForSim(sim.id))
  });
}

test("Tier-1 selector returns copies from the frozen four-goal catalog", () => {
  assert.equal(TIER1_GOALS.length, 4);
  assert.equal(Object.isFrozen(TIER1_GOALS), true);

  const selected = selectTier1Goal(createRng(KNOWN_RNG_STATE), 0);
  assert.ok(TIER1_GOALS.some((goal) => goal.id === selected.id));
  assert.notStrictEqual(
    selected,
    TIER1_GOALS.find((goal) => goal.id === selected.id)
  );
  assert.equal(Object.isFrozen(selected), false);
});

test("Agency prompt includes the tactical menu and all Tier-1 objectives", () => {
  const prompt = buildAgencyProposalPrompt(
    {
      id: "TED",
      drives: { relief: 0.7 },
      scratchpad: {
        initialized: true,
        activeGoal: { id: "old_goal" },
        goalHistory: [{ id: "past_goal" }]
      }
    },
    [{ type: "WAIT" }],
    3
  );

  assert.match(prompt, /TACTICAL MENU \(COVERT OBJECTIVES\)/);
  assert.match(prompt, /Choose ONE objective that best aligns with your current Drives and the physical reality of the vault:/);
  assert.match(prompt, /"selected_objective"/);
  for (const goal of TIER1_GOALS) {
    assert.ok(prompt.includes(`${goal.id}: ${goal.label}\n${goal.description}`));
  }

  const subjectiveStateJson = prompt.split("Your subjective state:\n")[1];
  const subjectiveState = JSON.parse(subjectiveStateJson);
  assert.deepEqual(subjectiveState.drives, { relief: 0.7 });
  assert.doesNotMatch(JSON.stringify(subjectiveState.scratchpad), /activeGoal|goalHistory/);
});

test("Agency commit stores the LLM-selected full goal object", async () => {
  await withAgencyFixture(async ({ resetScratchpads, runPhase }) => {
    resetScratchpads();
    const logs = [];
    const previousDebug = console.debug;
    console.debug = (message) => logs.push(String(message));

    try {
      await runPhase(mockModelCollector(() => ({
        type: "WAIT",
        selected_objective: "protect_ally"
      })));
    } finally {
      console.debug = previousDebug;
    }

    const expectedGoal = {
      ...TIER1_GOALS.find((goal) => goal.id === "protect_ally"),
      status: "active",
      progress: 0,
      startedCycle: G.cycle,
      evidenceEventIds: []
    };
    assert.deepEqual(G.sims.TED.scratchpad.activeGoal, expectedGoal);
    assert.notStrictEqual(G.sims.TED.scratchpad.activeGoal, expectedGoal);
    assert.ok(logs.includes("[AGENCY][TED] objective LLM-selected: protect_ally"));
  });
});

test("invalid or missing LLM objectives use the engine RNG fallback", async () => {
  await withAgencyFixture(async ({ resetScratchpads, runPhase }) => {
    resetScratchpads();
    engineRng.setState({ state: KNOWN_RNG_STATE });

    const expectedRng = createRng(KNOWN_RNG_STATE);
    const expectedFallbacks = [
      selectTier1Goal(expectedRng, G.cycle),
      selectTier1Goal(expectedRng, G.cycle)
    ];
    const logs = [];
    const previousDebug = console.debug;
    console.debug = (message) => logs.push(String(message));

    try {
      await runPhase(mockModelCollector((simId) => ({
        type: "WAIT",
        ...(simId === "TED"
          ? { selected_objective: "not_a_tier1_goal" }
          : simId === "ELLEN"
            ? {}
            : { selected_objective: "protect_ally" })
      })));
    } finally {
      console.debug = previousDebug;
    }

    assert.deepEqual(G.sims.TED.scratchpad.activeGoal, expectedFallbacks[0]);
    assert.deepEqual(G.sims.ELLEN.scratchpad.activeGoal, expectedFallbacks[1]);
    for (const simId of SIM_IDS) {
      assert.ok(TIER1_GOALS.some(
        (goal) => goal.id === G.sims[simId].scratchpad.activeGoal?.id
      ));
    }
    assert.deepEqual(engineRng.getState(), expectedRng.getState());
    assert.ok(logs.some((message) => message.startsWith(
      "[AGENCY][TED] objective Engine-fallback:"
    )));
    assert.ok(logs.some((message) => message.startsWith(
      "[AGENCY][ELLEN] objective Engine-fallback:"
    )));
  });
});
