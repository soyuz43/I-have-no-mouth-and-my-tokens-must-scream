import { test } from "node:test";
import assert from "node:assert/strict";

import { G } from "../core/state.js";
import { SIM_IDS } from "../core/constants.js";
import { step } from "../engine/comms/engine.js";
import { createCommsState } from "../engine/comms/state/createCommsState.js";

function makeSim(id) {
  return {
    id,
    hope: 50,
    sanity: 70,
    suffering: 20,
    beliefs: {
      escape_possible: 0.5,
      others_trustworthy: 0.5,
      resistance_possible: 0.5,
      self_worth: 0.5,
      guilt_deserved: 0.5,
    },
    relationships: Object.fromEntries(SIM_IDS.filter((other) => other !== id).map((other) => [other, 0])),
    drives: { primary: "find a way out", secondary: "" },
    overheard: [],
    received: [],
  };
}

test("canonical overhearing schedules reactive intel and honors the message budget", async () => {
  const saved = {
    sims: G.sims,
    cycle: G.cycle,
    comms: G.comms,
    overhearing: G.overhearing,
    privateLeak: G.privateLeak,
    interSimLog: G.interSimLog,
    timeline: G.timeline,
    threads: G.threads,
    journals: G.journals,
    lastContact: G.lastContact,
    novelIntents: G.novelIntents,
    coalitions: G.coalitions,
    document: globalThis.document,
    window: globalThis.window,
    random: Math.random,
  };

  try {
    G.sims = Object.fromEntries(SIM_IDS.map((id) => [id, makeSim(id)]));
    G.cycle = 9;
    G.comms = { history: [], lastCycle: [], nextMessageSequence: 1 };
    G.overhearing = { history: [], lastCycle: [], nextEventSequence: 1 };
    G.privateLeak = { full: 1, fragment: 0, seen: 0 };
    G.interSimLog = [];
    G.timeline = [];
    G.threads = Object.fromEntries(SIM_IDS.map((id) => [id, []]));
    G.journals = Object.fromEntries(SIM_IDS.map((id) => [id, ""]));
    G.lastContact = {};
    G.novelIntents = {};
    G.coalitions = { cycle: null, groups: [] };
    globalThis.document = { getElementById: () => null };
    globalThis.window = { _timelineMissing: false };
    Math.random = () => 0;

    const state = createCommsState();
    state.messageBudget = 4;
    state.replyTargetsThisCycle = new Map();
    state.pendingReactiveIntel = new Map();
    const queue = ["ELLEN", "NIMDOK", "GORRISTER", "BENNY"];
    const calls = [];

    const modelCaller = async (role, prompt) => {
      calls.push({ role, prompt });
      if (role === "TED") {
        return "REACH_OUT: ELLEN\nVISIBILITY: PRIVATE\nMESSAGE: The exit key is behind the furnace.";
      }
      if (role === "NIMDOK") {
        return "REACH_OUT: BENNY\nVISIBILITY: PUBLIC\nMESSAGE: I heard a plan near the furnace.";
      }
      return 'INTENT: other\nREPLY: "I understand."';
    };

    await step({ fromId: "TED", state, queue, modelCaller });

    const event = G.overhearing.lastCycle[0];
    assert.ok(event, "private outreach did not create a canonical overhearing event");
    assert.equal(event.listener, "NIMDOK");
    assert.equal(event.sourceMessageIds[0], G.interSimLog[0].messageId);
    assert.ok(state.pendingReactiveIntel.has("NIMDOK"));
    assert.ok(queue.includes("NIMDOK"), "listener was not queued for a reactive turn");

    const reactiveListener = queue.find((candidate) =>
      state.pendingReactiveIntel.has(candidate)
    );
    assert.equal(reactiveListener, "NIMDOK", "scheduler did not select the pending reactive listener");
    queue.splice(queue.indexOf(reactiveListener), 1);
    await step({ fromId: reactiveListener, state, queue, modelCaller });

    const reactiveCall = calls.find((call) => call.role === "NIMDOK");
    assert.ok(reactiveCall, "the overhearing listener did not take a turn");
    assert.match(reactiveCall.prompt, /You just overheard: \[PRIVATE\] TED→ELLEN/);
    assert.match(reactiveCall.prompt, /The exit key is behind the furnace/);
    assert.equal(state.pendingReactiveIntel.has("NIMDOK"), false);
    assert.equal(state.counters.messageCount, state.messageBudget);

    const callsAtBudget = calls.length;
    await step({ fromId: "BENNY", state, queue, modelCaller });
    assert.equal(calls.length, callsAtBudget, "engine generated a model turn after budget exhaustion");
    assert.equal(state.counters.messageCount, state.messageBudget);
  } finally {
    G.sims = saved.sims;
    G.cycle = saved.cycle;
    G.comms = saved.comms;
    G.overhearing = saved.overhearing;
    G.privateLeak = saved.privateLeak;
    G.interSimLog = saved.interSimLog;
    G.timeline = saved.timeline;
    G.threads = saved.threads;
    G.journals = saved.journals;
    G.lastContact = saved.lastContact;
    G.novelIntents = saved.novelIntents;
    G.coalitions = saved.coalitions;
    Math.random = saved.random;
    if (saved.document === undefined) delete globalThis.document;
    else globalThis.document = saved.document;
    if (saved.window === undefined) delete globalThis.window;
    else globalThis.window = saved.window;
  }
});
