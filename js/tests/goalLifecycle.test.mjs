import { test } from "node:test";
import assert from "node:assert/strict";

import { commitAgencyResolution } from "../engine/agency/commit.js";
import { evaluateGoalTransitions } from "../engine/scratchpad/goals/evaluator.js";
import { recordGoalEvent } from "../engine/agency/goalEventLog.js";

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

test("reassignment records the abandonment and the replacement start separately", () => {
  const game = gameWithActiveGoal({
    id: "observe_am",
    status: "active",
    progress: 2,
    startedCycle: 5,
    evidenceEventIds: ["agency:5:1"],
  });

  commitForObjective(game, "WAIT", "find_weakness");

  assert.equal(game.goalEvents.length, 2);

  const [abandon, initialize] = game.goalEvents;

  /*
   * The abandonment describes the OLD goal: its own progress, its own
   * start cycle, and the reason it ended.
   */
  assert.equal(abandon.kind, "abandon");
  assert.equal(abandon.goalId, "observe_am");
  assert.equal(abandon.progress, 2);
  assert.equal(abandon.startedCycle, 5);
  assert.equal(abandon.terminalCycle, game.cycle);
  assert.equal(abandon.terminalReason, "reassigned");
  assert.deepEqual(abandon.evidenceEventIds, ["agency:5:1"]);

  /*
   * The start describes the NEW goal: it has not ended, so it has no
   * terminal cycle and no terminal reason.
   */
  assert.equal(initialize.kind, "initialize");
  assert.equal(initialize.goalId, "find_weakness");
  assert.equal(initialize.progress, 0);
  assert.equal(initialize.startedCycle, game.cycle);
  assert.equal(initialize.terminalCycle, null);
  assert.equal(initialize.terminalReason, null);
  assert.deepEqual(initialize.evidenceEventIds, []);
});

test("active goals export no terminal cycle", () => {
  const game = gameWithActiveGoal({ id: "observe_am" });

  commitForObjective(game, "WAIT", "observe_am");

  const [continuation] = game.goalEvents;

  assert.equal(continuation.kind, "continue");
  assert.equal(continuation.terminalCycle, null);
  assert.equal(continuation.terminalReason, null);
});

test("a completed goal exports its terminal cycle", () => {
  const game = gameWithActiveGoal({
    id: "endure",
    status: "active",
    progress: 2,
    startedCycle: 5,
    evidenceEventIds: [],
  });

  commitForObjective(game, "WAIT", "endure");

  const [completion] = game.goalEvents;

  assert.equal(completion.kind, "complete");
  assert.equal(completion.terminalCycle, game.cycle);
  assert.equal(completion.terminalReason, "progress_threshold_reached");
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

test("an explicit null terminal cycle stays null", () => {
  const state = { cycle: 4, goalEvents: [] };

  const event = recordGoalEvent(state, {
    kind: "initialize",
    cycle: 4,
    actorId: "TED",
    goalId: "endure",
    progress: 0,
    startedCycle: 4,
    terminalCycle: null,
    terminalReason: null,
  });

  /*
   * `Number(null)` is 0, so a null terminal cycle would otherwise be
   * recorded as cycle zero and make an active goal look like it had
   * already ended.
   */
  assert.equal(event.terminalCycle, null);
  assert.equal(event.terminalReason, null);
  assert.equal(state.goalEvents[0].terminalCycle, null);
});

test("a missing terminal cycle falls back to null rather than zero", () => {
  const state = { cycle: 4, goalEvents: [] };

  const event = recordGoalEvent(state, {
    kind: "continue",
    cycle: 4,
    actorId: "TED",
    goalId: "endure",
    progress: 1,
    startedCycle: 4,
  });

  assert.equal(event.terminalCycle, null);
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
