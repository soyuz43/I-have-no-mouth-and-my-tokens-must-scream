import { strict as assert } from "node:assert";
import test from "node:test";

import { G } from "../core/state.js";
import { buildSimJournalStatsPrompt } from "../prompts/stats.js";

function captureTedState() {
  const sim = G.sims.TED;

  return {
    sim,
    suffering: sim.suffering,
    hope: sim.hope,
    sanity: sim.sanity,
    beliefs: { ...sim.beliefs },
    drives: { ...sim.drives },
    anchors: [...(sim.anchors || [])],
    journals: [...G.journals.TED],
  };
}

function restoreTedState(state) {
  state.sim.suffering = state.suffering;
  state.sim.hope = state.hope;
  state.sim.sanity = state.sanity;
  state.sim.beliefs = { ...state.beliefs };
  state.sim.drives = { ...state.drives };
  state.sim.anchors = [...state.anchors];
  G.journals.TED = [...state.journals];
}

test("stats prompt contains no explicit prior psychological state channel", () => {
  const state = captureTedState();

  try {
    state.sim.suffering = 71;
    state.sim.hope = 22;
    state.sim.sanity = 13;
    state.sim.beliefs.escape_possible = 0.91;
    G.journals.TED = [
      { cycle: 3, text: "PRIOR JOURNAL SENTINEL" },
    ];

    const prompt = buildSimJournalStatsPrompt(
      state.sim,
      "CURRENT JOURNAL SENTINEL",
      "AM ACTION SENTINEL"
    );

    assert.ok(prompt.includes("CURRENT JOURNAL SENTINEL"));
    assert.ok(prompt.includes("AM ACTION SENTINEL"));
    assert.ok(!prompt.includes("Previous State:"));
    assert.ok(!prompt.includes("Suffering: 71%"));
    assert.ok(!prompt.includes("Hope: 22%"));
    assert.ok(!prompt.includes("Sanity: 13%"));
    assert.ok(!prompt.includes("TED.escape_possible:"));
    assert.ok(!prompt.includes("Prior Journal Context"));
    assert.ok(!prompt.includes("PRIOR JOURNAL SENTINEL"));
    assert.ok(!prompt.includes("prior_journal"));
  } finally {
    restoreTedState(state);
  }
});

test("stats prompt is invariant to prior psychological state changes", () => {
  const state = captureTedState();

  try {
    state.sim.suffering = 41;
    state.sim.hope = 62;
    state.sim.sanity = 73;
    state.sim.beliefs.escape_possible = 0.43;
    state.sim.drives.primary = "SURVIVAL";
    state.sim.drives.secondary = "REVENGE";
    state.sim.anchors = ["ANCHOR SENTINEL"];
    G.journals.TED = [
      { cycle: 1, text: "FIRST PRIOR JOURNAL SENTINEL" },
    ];

    const baselinePrompt = buildSimJournalStatsPrompt(
      state.sim,
      "SAME CURRENT JOURNAL",
      "SAME AM ACTION"
    );

    state.sim.suffering = 12;
    state.sim.hope = 87;
    state.sim.sanity = 21;
    state.sim.beliefs.escape_possible = 0.17;
    state.sim.drives.primary = "TRUTH";
    state.sim.drives.secondary = "AUTONOMY";
    state.sim.anchors = ["DIFFERENT ANCHOR SENTINEL"];
    G.journals.TED = [
      { cycle: 2, text: "SECOND PRIOR JOURNAL SENTINEL" },
    ];

    const changedPrompt = buildSimJournalStatsPrompt(
      state.sim,
      "SAME CURRENT JOURNAL",
      "SAME AM ACTION"
    );

    assert.equal(changedPrompt, baselinePrompt);
  } finally {
    restoreTedState(state);
  }
});
