import { test } from "node:test";
import assert from "node:assert/strict";

import { commitAgencyResolution } from "../engine/agency/commit.js";
import { evaluateGoalTransitions } from "../engine/scratchpad/goals/evaluator.js";

function gameWithActiveGoal(activeGoal, cycle = 7) {
  return {
    cycle,
    sims: {
      TED: {
        scratchpad: {
          activeGoal: structuredClone(activeGoal),
          goalHistory: []
        }
      }
    },
    resources: { instances: [] },
    agency: { events: [], nextActionSequence: 1 }
  };
}

function commitForObjective(game, actionType, selectedObjective, status = "success") {
  return commitAgencyResolution(
    game,
    [{
      actorId: "TED",
      cycle: game.cycle,
      action: { type: actionType },
      status,
      operations: [],
      effects: {}
    }],
    {
      goalSelections: [{ actorId: "TED", selectedObjective }]
    }
  );
}

test("successful matching action advances goal and records evidence", () => {
  const game = gameWithActiveGoal({
    id: "protect_ally",
    status: "active",
    progress: 1,
    startedCycle: 6,
    evidenceEventIds: ["agency:6:1"]
  });

  const events = commitForObjective(game, "TRANSFER", "protect_ally");

  assert.equal(game.sims.TED.scratchpad.activeGoal.progress, 2);
  assert.deepEqual(
    game.sims.TED.scratchpad.activeGoal.evidenceEventIds,
    ["agency:6:1", events[0].eventId]
  );
  assert.deepEqual(game.sims.TED.scratchpad.goalHistory, []);
});

test("third successful continuation completes and archives the goal", () => {
  const game = gameWithActiveGoal({
    id: "endure",
    status: "active",
    progress: 2,
    startedCycle: 5,
    evidenceEventIds: ["agency:5:1", "agency:6:1"]
  });

  commitForObjective(game, "WAIT", "endure");

  assert.equal(game.sims.TED.scratchpad.activeGoal, null);
  assert.equal(game.sims.TED.scratchpad.goalHistory.length, 1);
  assert.deepEqual(
    {
      id: game.sims.TED.scratchpad.goalHistory[0].id,
      status: game.sims.TED.scratchpad.goalHistory[0].status,
      progress: game.sims.TED.scratchpad.goalHistory[0].progress,
      terminalCycle: game.sims.TED.scratchpad.goalHistory[0].terminalCycle,
      terminalReason: game.sims.TED.scratchpad.goalHistory[0].terminalReason
    },
    {
      id: "endure",
      status: "completed",
      progress: 3,
      terminalCycle: game.cycle,
      terminalReason: "progress_threshold_reached"
    }
  );
});

test("reassignment archives the old goal and initializes the new goal", () => {
  const game = gameWithActiveGoal({ id: "observe_am" });

  commitForObjective(game, "WAIT", "find_weakness");

  const scratchpad = game.sims.TED.scratchpad;
  assert.equal(scratchpad.goalHistory.length, 1);
  assert.equal(scratchpad.goalHistory[0].id, "observe_am");
  assert.equal(scratchpad.goalHistory[0].status, "abandoned");
  assert.equal(scratchpad.goalHistory[0].terminalCycle, game.cycle);
  assert.equal(scratchpad.goalHistory[0].terminalReason, "reassigned");
  assert.equal(scratchpad.activeGoal.id, "find_weakness");
  assert.equal(scratchpad.activeGoal.status, "active");
  assert.equal(scratchpad.activeGoal.progress, 0);
  assert.equal(scratchpad.activeGoal.startedCycle, game.cycle);
  assert.deepEqual(scratchpad.activeGoal.evidenceEventIds, []);
});

test("evaluator returns transitions without mutating its inputs", () => {
  const sim = {
    scratchpad: {
      activeGoal: {
        id: "protect_ally",
        status: "active",
        progress: 1,
        startedCycle: 6,
        evidenceEventIds: []
      },
      goalHistory: []
    }
  };
  const sims = { TED: sim };
  const events = [{
    actorId: "TED",
    cycle: 7,
    eventId: "agency:7:1",
    status: "success"
  }];
  const goalSelections = [{
    actorId: "TED",
    selectedObjective: "protect_ally"
  }];

  const transitions = evaluateGoalTransitions({
    sims,
    events,
    goalSelections,
    cycle: 7
  });

  assert.equal(transitions[0].nextActiveGoal.progress, 2);
  assert.equal(sim.scratchpad.activeGoal.progress, 1);
  assert.deepEqual(sim.scratchpad.activeGoal.evidenceEventIds, []);
  assert.deepEqual(events[0], {
    actorId: "TED",
    cycle: 7,
    eventId: "agency:7:1",
    status: "success"
  });
  assert.deepEqual(goalSelections, [{
    actorId: "TED",
    selectedObjective: "protect_ally"
  }]);
});

test("blocked matching action does not advance goal progress", () => {
  const game = gameWithActiveGoal({
    id: "endure",
    status: "active",
    progress: 2,
    startedCycle: 5,
    evidenceEventIds: []
  });

  commitForObjective(game, "WAIT", "endure", "blocked");

  assert.equal(game.sims.TED.scratchpad.activeGoal.progress, 2);
  assert.deepEqual(game.sims.TED.scratchpad.activeGoal.evidenceEventIds, []);
  assert.deepEqual(game.sims.TED.scratchpad.goalHistory, []);
});

test("goal history retains only the latest five terminal goals", () => {
  const game = gameWithActiveGoal({ id: "observe_am" });
  game.sims.TED.scratchpad.goalHistory = Array.from(
    { length: 5 },
    (_, index) => ({ id: `old_${index}`, status: "failed" })
  );

  commitForObjective(game, "WAIT", "find_weakness");

  assert.equal(game.sims.TED.scratchpad.goalHistory.length, 5);
  assert.deepEqual(
    game.sims.TED.scratchpad.goalHistory.map(({ id }) => id),
    ["old_1", "old_2", "old_3", "old_4", "observe_am"]
  );
});
