import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { G } from "../core/state.js";
import { SIM_IDS } from "../core/constants.js";
import { runBeliefContagion } from "../engine/social/beliefContagion.js";

const BELIEF_KEYS = [
  "escape_possible",
  "others_trustworthy",
  "self_worth",
  "reality_reliable",
  "guilt_deserved",
  "resistance_possible",
  "am_has_limits",
];

function makeSim(id, opts = {}) {
  const beliefs = Object.fromEntries(BELIEF_KEYS.map((key) => [key, 0.5]));
  Object.assign(beliefs, opts.beliefs);

  const relationships = Object.fromEntries(
    SIM_IDS.map((other) => [other, other === id ? null : (opts.relationships?.[other] ?? 0)])
  );

  return {
    id,
    suffering: 20,
    hope: 50,
    sanity: 50,
    beliefs,
    relationships,
    constraints: [],
  };
}

function buildSims(map) {
  return Object.fromEntries(
    SIM_IDS.map((id) => [id, map[id] ?? makeSim(id)])
  );
}

let saved;

beforeEach(() => {
  saved = {
    sims: G.sims,
    cycle: G.cycle,
    beliefSnapshots: G.beliefSnapshots,
  };
  G.sims = buildSims({});
  G.cycle = 0;
  G.beliefSnapshots = {};
});

afterEach(() => {
  G.sims = saved.sims;
  G.cycle = saved.cycle;
  G.beliefSnapshots = saved.beliefSnapshots;
});

test("Belief contagion produces a positive escape_possible delta", () => {
  G.sims = buildSims({
    TED: makeSim("TED", {
      beliefs: { escape_possible: 0.20, others_trustworthy: 0.75 },
      relationships: { ELLEN: 0.90 },
    }),
    ELLEN: makeSim("ELLEN", { beliefs: { escape_possible: 0.95 } }),
  });
  G.cycle = 1;

  G.beliefSnapshots.postPsychology = {};
  for (const id of SIM_IDS) {
    G.beliefSnapshots.postPsychology[id] = { beliefs: { ...G.sims[id].beliefs } };
  }

  runBeliefContagion();

  G.beliefSnapshots.final = {};
  for (const id of SIM_IDS) {
    G.beliefSnapshots.final[id] = { beliefs: { ...G.sims[id].beliefs } };
  }

  const baseline = G.beliefSnapshots.postPsychology.TED.beliefs;
  const current = G.beliefSnapshots.final.TED.beliefs;
  const marginal = {};
  for (const key of new Set([...Object.keys(baseline), ...Object.keys(current)])) {
    marginal[key] = (current[key] ?? 0) - (baseline[key] ?? 0);
  }

  const postPsychology = baseline.escape_possible;
  const postContagion = current.escape_possible;
  const expected = postContagion - postPsychology;

  assert.ok(Number.isFinite(marginal.escape_possible), "fixture delta is not numeric");
  assert.ok(postContagion > postPsychology, "contagion did not increase escape_possible");
  assert.ok(expected > 0, "fixture delta is not positive");
});
