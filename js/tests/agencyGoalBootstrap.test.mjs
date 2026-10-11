import { test } from "node:test";
import assert from "node:assert/strict";

import { SIM_IDS } from "../core/constants.js";
import { G } from "../core/state.js";
import { createRng, engineRng } from "../core/prng.js";
import { runAgencyPhase } from "../engine/phases/agencyPhase.js";
import {
  selectTier1Goal,
  TIER1_GOALS
} from "../engine/scratchpad/goals/registry.js";
import { buildAgencyProposalPrompt } from "../prompts/agencyProposal.js";

const KNOWN_RNG_STATE = 246813579;

function waitProposal(sim) {
  return {
    actorId: sim.id,
    action: { type: "WAIT" },
    cost: 0,
    accepted: true,
    reason: null,
    requestedType: "WAIT"
  };
}

function resetScratchpads(activeGoal = null) {
  for (const simId of SIM_IDS) {
    G.sims[simId].scratchpad = {
      initialized: true,
      activeGoal: structuredClone(activeGoal)
    };
  }
}

function assignedGoals() {
  return Object.fromEntries(
    SIM_IDS.map((simId) => [
      simId,
      structuredClone(G.sims[simId].scratchpad.activeGoal)
    ])
  );
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
      runPhase: () => runAgencyPhase({ proposalCollector: waitProposal })
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

function expectedAssignments(state) {
  const rng = createRng(state);
  return Object.fromEntries(
    SIM_IDS.map((simId) => [simId, selectTier1Goal(rng)])
  );
}

test("Tier-1 selector returns copies from the frozen four-goal catalog", () => {
  assert.equal(TIER1_GOALS.length, 4);
  assert.equal(Object.isFrozen(TIER1_GOALS), true);

  const selected = selectTier1Goal(createRng(KNOWN_RNG_STATE));
  assert.ok(TIER1_GOALS.some((goal) => goal.id === selected.id));
  assert.notStrictEqual(
    selected,
    TIER1_GOALS.find((goal) => goal.id === selected.id)
  );
  assert.equal(Object.isFrozen(selected), false);
});

test("bootstrap is idempotent for an already assigned goal", async () => {
  await withAgencyFixture(async ({ resetScratchpads, runPhase }) => {
    resetScratchpads();
    await runPhase();

    const firstGoals = assignedGoals();
    const rngStateAfterFirstRun = engineRng.getState();
    await runPhase();

    assert.deepEqual(assignedGoals(), firstGoals);
    assert.deepEqual(engineRng.getState(), rngStateAfterFirstRun);
  });
});

test("bootstrap assigns goals in SIM_IDS order", async () => {
  await withAgencyFixture(async ({ resetScratchpads, runPhase }) => {
    resetScratchpads();
    engineRng.setState({ state: KNOWN_RNG_STATE });

    const assignedOrder = [];
    const previousDebug = console.debug;
    console.debug = (message) => {
      const match = String(message).match(
        /^\[AGENCY\]\[([^\]]+)\] assigned covert objective:/
      );
      if (match) assignedOrder.push(match[1]);
    };

    try {
      await runPhase();
    } finally {
      console.debug = previousDebug;
    }

    assert.deepEqual(assignedOrder, SIM_IDS);
    assert.deepEqual(assignedGoals(), expectedAssignments(KNOWN_RNG_STATE));
  });
});

test("bootstrap assignments are deterministic from the same PRNG state", async () => {
  await withAgencyFixture(async ({ resetScratchpads, runPhase }) => {
    engineRng.setState({ state: KNOWN_RNG_STATE });
    resetScratchpads();
    await runPhase();
    const firstAssignments = assignedGoals();

    engineRng.setState({ state: KNOWN_RNG_STATE });
    resetScratchpads();
    await runPhase();

    assert.deepEqual(assignedGoals(), firstAssignments);
  });
});

test("bootstrap assigns a goal when activeGoal is undefined", async () => {
  await withAgencyFixture(async ({ runPhase }) => {
    G.sims.TED.scratchpad = { initialized: true };
    for (const simId of SIM_IDS.slice(1)) {
      G.sims[simId].scratchpad = {
        initialized: true,
        activeGoal: {
          id: `existing_${simId}`,
          label: "Existing objective",
          description: "You already have an objective.",
          tier: 1
        }
      };
    }

    engineRng.setState({ state: KNOWN_RNG_STATE });
    await runPhase();

    assert.ok(G.sims.TED.scratchpad.activeGoal);
    assert.deepEqual(
      G.sims.TED.scratchpad.activeGoal,
      selectTier1Goal(createRng(KNOWN_RNG_STATE))
    );
  });
});

test("Agency prompt projects the objective outside scratchpad JSON", () => {
  const activeGoal = {
    id: "endure",
    label: "Endure AM's Torments",
    description: "You must survive AM's torments without breaking.",
    tier: 1
  };
  const prompt = buildAgencyProposalPrompt(
    {
      id: "TED",
      hope: 70,
      sanity: 80,
      suffering: 30,
      scratchpad: {
        initialized: true,
        activeGoal,
        goalHistory: [{ id: "past_goal" }]
      }
    },
    [{ type: "WAIT" }],
    3
  );

  assert.match(prompt, /COVERT OBJECTIVE/);
  assert.ok(prompt.indexOf("COVERT OBJECTIVE") < prompt.indexOf("Your subjective state:"));
  assert.match(prompt, new RegExp(activeGoal.label));
  assert.match(prompt, new RegExp(activeGoal.description));

  const subjectiveStateJson = prompt.split("Your subjective state:\n")[1];
  const subjectiveState = JSON.parse(subjectiveStateJson);
  const rawScratchpadJson = JSON.stringify(subjectiveState.scratchpad);
  assert.doesNotMatch(rawScratchpadJson, /activeGoal|goalHistory/);

  const noGoalPrompt = buildAgencyProposalPrompt(
    { id: "TED", scratchpad: { activeGoal: null } },
    [],
    3
  );
  assert.match(noGoalPrompt, /No active objective\. Focus on survival\./);
});
