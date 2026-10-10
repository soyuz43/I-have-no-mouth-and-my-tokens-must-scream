import { test } from "node:test";
import assert from "node:assert/strict";

import { G } from "../core/state.js";
import { SIM_IDS } from "../core/constants.js";
import { makeScratchpad } from "../core/utils.js";
import { beginCycle } from "../engine/cycle.js";
import { commitAgencyResolution } from "../engine/agency/commit.js";
import { createAgencyState } from "../engine/agency/state/createAgencyState.js";
import { runSocialPhase } from "../engine/phases/socialPhase.js";
import { Exporter } from "../utils/exporter/state.js";

test("prior-cycle agency outcomes reach actor and recipient through Social review", async () => {
  const saved = {
    cycle: G.cycle,
    sims: G.sims,
    agency: G.agency,
    comms: G.comms,
    interSimLog: G.interSimLog,
    timeline: G.timeline,
    coalitions: G.coalitions,
    beliefSnapshots: G.beliefSnapshots,
    prevCycleSnapshot: G.prevCycleSnapshot,
    pendingBeliefEvidence: G.pendingBeliefEvidence,
    pendingPsychEvidence: G.pendingPsychEvidence,
    pendingEvidence: G.pendingEvidence,
    backend: G.backend,
    ollamaEndpoint: G.ollamaEndpoint,
    debugPrompts: G.DEBUG_PROMPTS,
    exporterPrevState: Exporter.prevState,
    document: globalThis.document,
    window: globalThis.window,
    fetch: globalThis.fetch,
    consoleMethods: Object.fromEntries(
      ["debug", "info", "log", "warn", "group", "groupCollapsed", "groupEnd", "table"]
        .map((method) => [method, console[method]]),
    ),
  };
  const requests = [];
  const agencyGame = {
    cycle: 4,
    sims: { TED: {}, NIMDOK: {}, BENNY: {} },
    resources: { instances: [] },
    agency: createAgencyState(),
  };
  const events = agencyGame.agency.events;
  agencyGame.agency.capabilities.TED = {
    bands: { handUse: "unavailable" },
  };
  commitAgencyResolution(agencyGame, [
    {
      cycle: 4,
      actorId: "TED",
      action: { type: "TRANSFER" },
      status: "success",
      provenance: { targetId: "ELLEN" },
    },
    {
      cycle: 4,
      actorId: "NIMDOK",
      action: { type: "TRANSFER" },
      status: "success",
      provenance: { targetId: "GORRISTER" },
    },
    {
      cycle: 4,
      actorId: "BENNY",
      action: { type: "TRANSFER" },
      status: "blocked",
      provenance: { targetId: "TED" },
    },
  ]);
  const priorCycleGame = {
    cycle: 3,
    sims: { TED: {} },
    resources: { instances: [] },
    agency: createAgencyState(),
  };
  events.push(...commitAgencyResolution(priorCycleGame, [
    {
      cycle: 3,
      actorId: "TED",
      action: { type: "OBSERVE" },
      status: "success",
    },
  ]));

  try {
    G.cycle = 4;
    G.sims = structuredClone(saved.sims);
    for (const simId of SIM_IDS) {
      G.sims[simId].scratchpad = makeScratchpad(simId);
      G.sims[simId].scratchpad.initialized = true;
    }
    G.sims.TED.scratchpad.physicalLimitations = ["hands_bound"];
    G.agency = agencyGame.agency;
    G.comms = { history: [], lastCycle: [], nextMessageSequence: 1 };
    G.interSimLog = [];
    G.timeline = [];
    G.coalitions = { cycle: null, groups: [] };
    G.beliefSnapshots = {};
    G.pendingBeliefEvidence = {};
    G.pendingPsychEvidence = {};
    G.pendingEvidence = {
      journal: {},
      comms: {},
      constraints: {},
      am: {},
      system: {},
    };
    G.backend = "ollama";
    G.ollamaEndpoint = "http://localhost:11434";
    G.DEBUG_PROMPTS = false;
    for (const method of Object.keys(saved.consoleMethods)) {
      console[method] = () => {};
    }
    globalThis.document = { getElementById: () => null };
    globalThis.window = {};
    globalThis.fetch = async (_url, init) => {
      const prompt = JSON.parse(init.body).messages
        .map((message) => message.content)
        .join("\n");
      requests.push(prompt);
      const content = prompt.includes(
        "AUTHORITATIVE AGENCY OUTCOMES FROM THE PREVIOUS CYCLE",
      )
        ? "<SCRATCHPAD_UPDATES><NO_UPDATE/></SCRATCHPAD_UPDATES>"
        : "REACH_OUT:NONE";
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ message: { content } }),
      };
    };

    beginCycle();
    assert.equal(G.cycle, 5);
    assert.strictEqual(G.agency.events, events);
    assert.deepEqual(G.agency.capabilities, {});
    await runSocialPhase();
    assert.deepEqual(G.sims.TED.scratchpad.physicalLimitations, []);

    const reviewPrompts = requests.filter((prompt) =>
      prompt.includes("AUTHORITATIVE AGENCY OUTCOMES FROM THE PREVIOUS CYCLE"),
    );
    assert.equal(reviewPrompts.length, 5);
    assert.equal(
      reviewPrompts.filter((prompt) => prompt.includes("agency:4:1")).length,
      2,
    );
    assert.equal(
      reviewPrompts.filter((prompt) => prompt.includes("agency:4:2")).length,
      2,
    );
    assert.equal(
      reviewPrompts.filter((prompt) => prompt.includes("agency:4:3")).length,
      1,
    );
    for (const prompt of reviewPrompts) {
      const eligibleEvents = ["agency:4:1", "agency:4:2", "agency:4:3"]
        .filter((eventId) => prompt.includes(eventId));
      assert.equal(eligibleEvents.length, 1);
      assert.ok(!prompt.includes("agency:3:1"));
    }
  } finally {
    G.cycle = saved.cycle;
    G.sims = saved.sims;
    G.agency = saved.agency;
    G.comms = saved.comms;
    G.interSimLog = saved.interSimLog;
    G.timeline = saved.timeline;
    G.coalitions = saved.coalitions;
    G.beliefSnapshots = saved.beliefSnapshots;
    G.prevCycleSnapshot = saved.prevCycleSnapshot;
    G.pendingBeliefEvidence = saved.pendingBeliefEvidence;
    G.pendingPsychEvidence = saved.pendingPsychEvidence;
    G.pendingEvidence = saved.pendingEvidence;
    G.backend = saved.backend;
    G.ollamaEndpoint = saved.ollamaEndpoint;
    G.DEBUG_PROMPTS = saved.debugPrompts;
    for (const [method, implementation] of Object.entries(saved.consoleMethods)) {
      console[method] = implementation;
    }
    Exporter.prevState = saved.exporterPrevState;
    if (saved.document === undefined) delete globalThis.document;
    else globalThis.document = saved.document;
    if (saved.window === undefined) delete globalThis.window;
    else globalThis.window = saved.window;
    if (saved.fetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = saved.fetch;
  }
});
