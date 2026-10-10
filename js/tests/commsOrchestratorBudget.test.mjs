import { test } from "node:test";
import assert from "node:assert/strict";

import { G } from "../core/state.js";
import { SIM_IDS } from "../core/constants.js";
import { engineRng } from "../core/prng.js";
import { runCommsCycle } from "../engine/comms/orchestrator.js";

function makeSim(id) {
  return {
    id,
    sanity: 100,
    suffering: 0,
    beliefs: { others_trustworthy: 1 },
  };
}

test("orchestrator drains the scheduled queue and stops at its message budget", async () => {
  const saved = {
    sims: G.sims,
    cycle: G.cycle,
    comms: G.comms,
    overhearing: G.overhearing,
    interSimLog: G.interSimLog,
    timeline: G.timeline,
    document: globalThis.document,
    window: globalThis.window,
    nextRandom: engineRng.next,
  };

  try {
    G.sims = Object.fromEntries(SIM_IDS.map((id) => [id, makeSim(id)]));
    G.cycle = 3;
    G.comms = { history: [], lastCycle: [], nextMessageSequence: 1 };
    G.overhearing = { history: [], lastCycle: [], nextEventSequence: 1 };
    G.interSimLog = [];
    G.timeline = [];
    globalThis.document = { getElementById: () => null };
    globalThis.window = { _timelineMissing: false };
    engineRng.next = () => 0;

    let mainQueue;
    let burstTurnCount = 0;
    const turns = [];
    const state = await runCommsCycle({
      stepFn: async ({ fromId, state: cycleState, queue }) => {
        if (!mainQueue) mainQueue = queue;
        else if (queue !== mainQueue) burstTurnCount++;

        assert.ok(
          cycleState.counters.messageCount < cycleState.messageBudget,
          "orchestrator scheduled a turn after budget exhaustion",
        );
        turns.push(fromId);
        cycleState.counters.messageCount++;
      },
    });

    assert.equal(state.messageBudget, 8);
    assert.equal(state.counters.messageCount, state.messageBudget);
    assert.equal(turns.length, state.messageBudget);
    assert.equal(new Set(turns.slice(0, SIM_IDS.length)).size, SIM_IDS.length);
    assert.deepEqual(mainQueue, [], "normal scheduling queue did not drain");
    assert.equal(burstTurnCount, 3, "burst scheduling did not stop at the remaining budget");
  } finally {
    G.sims = saved.sims;
    G.cycle = saved.cycle;
    G.comms = saved.comms;
    G.overhearing = saved.overhearing;
    G.interSimLog = saved.interSimLog;
    G.timeline = saved.timeline;
    engineRng.next = saved.nextRandom;
    if (saved.document === undefined) delete globalThis.document;
    else globalThis.document = saved.document;
    if (saved.window === undefined) delete globalThis.window;
    else globalThis.window = saved.window;
  }
});
