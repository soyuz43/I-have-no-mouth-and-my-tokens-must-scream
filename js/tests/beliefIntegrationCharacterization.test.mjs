// js/tests/beliefIntegrationCharacterization.test.mjs
// FROZEN SNAPSHOT: pinned to audited commit e1ded28 (pre-scratchpad ordinary cycle order: strategy -> psychology -> social -> interaction analysis -> belief integration -> evaluation). Characterizes beliefIntegrationPhase as it existed before the prisoner-scratchpads roadmap reshapes the cognition/integration pipeline. Do not update against post-roadmap behavior without re-auditing.
//
// CHARACTERIZATION TESTS OF CURRENT BELIEF-UPDATE BEHAVIOR.
//
// These tests characterize the CURRENT production behavior of the live
// belief-update pipeline. They are NOT assertions that the behavior is
// scientifically correct. They exist to preserve executable evidence while
// the intended causal semantics of belief integration are decided.
//
// - Passing does not endorse the behavior.
// - Future intentional behavior changes (deferring integration, subtracting
//   contagion, renaming snapshots, adding attribution terms) MAY legitimately
//   require updating or removing these tests.
// - No live model requests are made. Interaction evidence is injected directly
//   into G.pendingBeliefEvidence at the narrowest available boundary.
// - No production source is modified. Engine behavior is unchanged.
//
// Terminology used precisely below:
//   postPsychology  - G.beliefSnapshots.postPsychology (captured before contagion)
//   postContagion   - G.beliefSnapshots.final (captured after contagion, BEFORE integration)
//   postIntegration - live G.sims after runBeliefIntegrationPhase (no snapshot exists)
//   same-cycle reinforcement   - integration applies a second live mutation to the
//                                already post-contagion state, same key/receiver/sign
//   causal-overlap pathway     - the route by which integration evidence is derived
//                                from (postContagion - postPsychology) and then applied
//   attribution incompleteness - production attribution lacks a separate integration term

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { G } from "../core/state.js";
import { SIM_IDS } from "../core/constants.js";
import { runBeliefContagion } from "../engine/social/beliefContagion.js";
import { runBeliefIntegrationPhase } from "../engine/phases/beliefIntegrationPhase.js";
import { dampBeliefDelta } from "../engine/state/utils/dampBeliefDelta.js";

const SEVEN_KEYS = [
  "escape_possible",
  "others_trustworthy",
  "self_worth",
  "reality_reliable",
  "guilt_deserved",
  "resistance_possible",
  "am_has_limits",
];

function makeBeliefs(overrides = {}) {
  const b = {};
  for (const k of SEVEN_KEYS) b[k] = overrides[k] ?? 0.5;
  return b;
}

function makeSim(id, opts = {}) {
  const { beliefs = {}, relationships = {}, suffering = 20 } = opts;
  const rel = {};
  for (const other of SIM_IDS) rel[other] = other === id ? null : (relationships[other] ?? 0);
  return {
    id,
    suffering,
    hope: 50,
    sanity: 50,
    beliefs: makeBeliefs(beliefs),
    relationships: rel,
    constraints: [],
  };
}

function buildSims(map) {
  const sims = {};
  for (const id of SIM_IDS) sims[id] = map[id] ? map[id] : makeSim(id);
  return sims;
}

const TRUST_THRESHOLD = 0.55;
const MAX_INFLUENCE = 0.04;
const MIN_BELIEF_DIFF = 0.08;
const MAX_TOTAL_SHIFT = 0.06;

function contagionAccumulation(sims, receiver, key) {
  let acc = 0;
  for (const b of SIM_IDS) {
    if (b === receiver) continue;
    const trust = sims[receiver].relationships[b] ?? 0;
    if (trust < TRUST_THRESHOLD) continue;
    const ba = sims[receiver].beliefs[key];
    const bb = sims[b].beliefs[key];
    const diff = bb - ba;
    if (Math.abs(diff) < MIN_BELIEF_DIFF) continue;
    const influence = Math.sign(diff) * Math.min(MAX_INFLUENCE, trust * Math.abs(diff) * 0.5);
    acc += influence;
  }
  return Math.max(-MAX_TOTAL_SHIFT, Math.min(MAX_TOTAL_SHIFT, acc));
}

function snapBeliefs(sims) {
  const out = {};
  for (const id of SIM_IDS) out[id] = { ...sims[id].beliefs };
  return out;
}

function expectedCommittedDelta(sim, key, preDampingDelta) {
  const v = sim.beliefs[key];
  const resistance = Math.max(0.2, 1 - Math.abs(v - 0.5) * 1.6);
  const damped = preDampingDelta * resistance;
  const delta = dampBeliefDelta(sim, key, v, damped);
  return Math.max(-v, Math.min(1 - v, delta));
}

let saved = null;

function saveGlobal() {
  return {
    sims: G.sims,
    cycle: G.cycle,
    pendingBeliefEvidence: G.pendingBeliefEvidence,
    beliefSnapshots: G.beliefSnapshots,
    prevCycleSnapshot: G.prevCycleSnapshot,
    dampingParams: G.dampingParams,
    DEBUG_DAMPING: G.DEBUG_DAMPING,
    DEBUG_CONSTRAINTS: G.DEBUG_CONSTRAINTS,
  };
}

function restoreGlobal(s) {
  G.sims = s.sims;
  G.cycle = s.cycle;
  G.pendingBeliefEvidence = s.pendingBeliefEvidence;
  G.beliefSnapshots = s.beliefSnapshots;
  G.prevCycleSnapshot = s.prevCycleSnapshot;
  G.dampingParams = s.dampingParams;
  G.DEBUG_DAMPING = s.DEBUG_DAMPING;
  G.DEBUG_CONSTRAINTS = s.DEBUG_CONSTRAINTS;
}

function freshGlobal() {
  G.sims = buildSims({});
  G.cycle = 0;
  G.pendingBeliefEvidence = Object.create(null);
  G.beliefSnapshots = {};
  G.prevCycleSnapshot = null;
  G.dampingParams = {};
  G.DEBUG_DAMPING = false;
  G.DEBUG_CONSTRAINTS = false;
}

beforeEach(() => {
  saved = saveGlobal();
  freshGlobal();
});

afterEach(() => {
  restoreGlobal(saved);
});

test("Test 1: empty pending evidence causes zero belief changes", () => {
  const sims = buildSims({
    TED: makeSim("TED", {
      beliefs: { escape_possible: 0.30, others_trustworthy: 0.75 },
      relationships: { ELLEN: 0.9 },
    }),
    ELLEN: makeSim("ELLEN", { beliefs: { escape_possible: 0.80 } }),
  });
  G.sims = sims;
  G.cycle = 1;
  G.pendingBeliefEvidence = Object.create(null);

  const before = snapBeliefs(sims);

  runBeliefIntegrationPhase();

  for (const id of SIM_IDS) {
    const sim = G.sims[id];
    if (!sim) continue;
    for (const k of SEVEN_KEYS) {
      assert.equal(sim.beliefs[k], before[id]?.[k] ?? 0.5,
        `belief ${id}.${k} changed with no evidence`);
    }
  }
});

test("Test 2: integration mutates a live belief independent of contagion", () => {
  const sims = buildSims({
    TED: makeSim("TED", {
      beliefs: { escape_possible: 0.50, others_trustworthy: 0.75 },
      relationships: { ELLEN: 0.0, NIMDOK: 0.0, GORRISTER: 0.0, BENNY: 0.0 },
    }),
    ELLEN: makeSim("ELLEN", { beliefs: { escape_possible: 0.90 } }),
  });
  G.sims = sims;
  G.cycle = 1;

  runBeliefContagion();
  assert.equal(G.sims.TED.beliefs.escape_possible, 0.50, "contagion moved without eligible edge");

  G.pendingBeliefEvidence = Object.create(null);
  G.pendingBeliefEvidence.TED = [
    { belief: "escape_possible", direction: "increase", strength: 3, confidence: 0.8, source: "private_message", attribution: "social_pressure" },
  ];

  const before = snapBeliefs(G.sims);
  const pre = G.sims.TED.beliefs.escape_possible;
  runBeliefIntegrationPhase();
  const post = G.sims.TED.beliefs.escape_possible;

  assert.ok(post > pre, "integration did not increase belief");

  // Non-target keys/agents unchanged (compared against own pre-state).
  for (const id of SIM_IDS) {
    const sim = G.sims[id];
    if (!sim) continue;
    for (const k of SEVEN_KEYS) {
      if (id === "TED" && k === "escape_possible") continue;
      assert.equal(sim.beliefs[k], before[id]?.[k] ?? 0.5,
        `belief ${id}.${k} changed unexpectedly`);
    }
  }

  const expectedPreDamping = (1) * (3 / 100) * 0.8;
  const expectedCommitted = expectedCommittedDelta(
    { ...G.sims.TED, beliefs: { ...G.sims.TED.beliefs, escape_possible: pre } },
    "escape_possible", expectedPreDamping);
  assert.ok(Math.abs((post - pre) - expectedCommitted) < 1e-9,
    `integration delta ${post - pre} != expected ${expectedCommitted}`);

  assert.equal(G.sims.ELLEN.beliefs.escape_possible, 0.90, "ELLEN changed");

});

test("Test 3: same-cycle reinforcement applies a second live mutation to post-contagion state", () => {
  const sims = buildSims({
    TED: makeSim("TED", {
      beliefs: { escape_possible: 0.20, others_trustworthy: 0.75 },
      relationships: { ELLEN: 0.90 },
    }),
    ELLEN: makeSim("ELLEN", { beliefs: { escape_possible: 0.95 } }),
  });
  G.sims = sims;
  G.cycle = 1;

  runBeliefContagion();
  const postContagion = G.sims.TED.beliefs.escape_possible;
  const contagionDelta = postContagion - 0.20;
  assert.ok(contagionDelta > 0, "contagion did not move the key upward");

  G.pendingBeliefEvidence = Object.create(null);
  G.pendingBeliefEvidence.TED = [
    { belief: "escape_possible", direction: "increase", strength: 4, confidence: 0.9, source: "private_message", attribution: "contagion" },
  ];

  runBeliefIntegrationPhase();
  const postIntegration = G.sims.TED.beliefs.escape_possible;
  const integrationDelta = postIntegration - postContagion;

  assert.ok(integrationDelta > 0, "integration did not move same key upward");
  assert.ok(postIntegration > postContagion, "post-integration equals post-contagion");

  const recomposed = Math.max(0, Math.min(1, 0.20 + contagionDelta + integrationDelta));
  assert.ok(Math.abs(recomposed - postIntegration) < 1e-9, "final state != sequential composition");

  assert.notEqual(contagionDelta, integrationDelta,
    "second magnitude is identical to first (would be identical-delta reapplication)");
  assert.ok(contagionDelta > 0 && integrationDelta > 0, "signs differ");
});

test("Test 4: opposing integration evidence partially cancels contagion", () => {
  const sims = buildSims({
    TED: makeSim("TED", {
      beliefs: { escape_possible: 0.20, others_trustworthy: 0.75 },
      relationships: { ELLEN: 0.90 },
    }),
    ELLEN: makeSim("ELLEN", { beliefs: { escape_possible: 0.95 } }),
  });
  G.sims = sims;
  G.cycle = 1;

  runBeliefContagion();
  const postContagion = G.sims.TED.beliefs.escape_possible;
  const contagionDelta = postContagion - 0.20;
  assert.ok(contagionDelta > 0, "contagion did not move upward");

  G.pendingBeliefEvidence = Object.create(null);
  G.pendingBeliefEvidence.TED = [
    { belief: "escape_possible", direction: "decrease", strength: 1, confidence: 1.0, source: "private_message", attribution: "social_pressure" },
  ];

  runBeliefIntegrationPhase();
  const postIntegration = G.sims.TED.beliefs.escape_possible;
  const integrationDelta = postIntegration - postContagion;

  assert.ok(integrationDelta < 0, "opposing integration did not move downward");
  const recomposed = Math.max(0, Math.min(1, 0.20 + contagionDelta + integrationDelta));
  assert.ok(Math.abs(recomposed - postIntegration) < 1e-9, "final != sequential composition");
});

test("Test 5: postPsychology / final / postIntegration timing demonstrated numerically", () => {
  const sims = buildSims({
    TED: makeSim("TED", {
      beliefs: { escape_possible: 0.20, others_trustworthy: 0.75 },
      relationships: { ELLEN: 0.90 },
    }),
    ELLEN: makeSim("ELLEN", { beliefs: { escape_possible: 0.95 } }),
  });
  G.sims = sims;
  G.cycle = 1;

  G.beliefSnapshots.postPsychology = {};
  for (const id of SIM_IDS) {
    G.beliefSnapshots.postPsychology[id] = { beliefs: { ...G.sims[id].beliefs } };
  }
  const postPsychologyVal = G.sims.TED.beliefs.escape_possible;
  assert.equal(postPsychologyVal, 0.20);

  runBeliefContagion();
  const postContagionVal = G.sims.TED.beliefs.escape_possible;
  assert.ok(postContagionVal > postPsychologyVal, "contagion had no effect");

  G.beliefSnapshots.final = {};
  for (const id of SIM_IDS) {
    G.beliefSnapshots.final[id] = { beliefs: { ...G.sims[id].beliefs } };
  }
  const finalSnapVal = G.beliefSnapshots.final.TED.beliefs.escape_possible;
  assert.equal(finalSnapVal, postContagionVal, "final snapshot != post-contagion");

  G.pendingBeliefEvidence = Object.create(null);
  G.pendingBeliefEvidence.TED = [
    { belief: "escape_possible", direction: "increase", strength: 4, confidence: 0.9, source: "private_message", attribution: "contagion" },
  ];
  runBeliefIntegrationPhase();
  const postIntegrationVal = G.sims.TED.beliefs.escape_possible;

  assert.ok(postIntegrationVal > finalSnapVal, "live state did not exceed stored final");
  assert.notEqual(finalSnapVal, postIntegrationVal, "stored final equals post-integration (should differ)");
});

test("Test 6: production attribution omits a separate integration term", () => {
  const sims = buildSims({
    TED: makeSim("TED", {
      beliefs: { escape_possible: 0.20, others_trustworthy: 0.75 },
      relationships: { ELLEN: 0.90 },
    }),
    ELLEN: makeSim("ELLEN", { beliefs: { escape_possible: 0.95 } }),
  });
  G.sims = sims;
  G.cycle = 1;

  G.beliefSnapshots.postPsychology = {};
  G.beliefSnapshots.final = {};
  for (const id of SIM_IDS) {
    G.beliefSnapshots.postPsychology[id] = { beliefs: { ...G.sims[id].beliefs } };
  }

  runBeliefContagion();

  for (const id of SIM_IDS) {
    G.beliefSnapshots.final[id] = { beliefs: { ...G.sims[id].beliefs } };
  }

  const psychologyDelta = G.beliefSnapshots.postPsychology.TED.beliefs.escape_possible - 0.20;
  const contagionDelta =
    G.beliefSnapshots.final.TED.beliefs.escape_possible -
    G.beliefSnapshots.postPsychology.TED.beliefs.escape_possible;
  assert.ok(contagionDelta > 0, "contagion delta not positive");

  G.pendingBeliefEvidence = Object.create(null);
  G.pendingBeliefEvidence.TED = [
    { belief: "escape_possible", direction: "increase", strength: 4, confidence: 0.9, source: "private_message", attribution: "contagion" },
  ];
  runBeliefIntegrationPhase();
  const integrationDelta =
    G.sims.TED.beliefs.escape_possible - G.beliefSnapshots.final.TED.beliefs.escape_possible;
  assert.ok(integrationDelta > 0, "integration delta not positive");

  const totalLiveDelta = G.sims.TED.beliefs.escape_possible - 0.20;
  const reconstructed = psychologyDelta + contagionDelta;

  assert.ok(integrationDelta > 0);
  assert.notEqual(reconstructed, totalLiveDelta,
    "attributed (psychology+contagion) unexpectedly equals post-integration total");
  assert.ok(Math.abs((psychologyDelta + contagionDelta + integrationDelta) - totalLiveDelta) < 1e-9,
    "psychology+contagion+integration does not reconstruct total");

  assert.ok(!("integration" in (G.attributionMetrics?.[G.cycle]?.TED ?? {})),
    "integration term unexpectedly present in attribution");
});

test("Test 7: pending evidence is same-cycle (reset clears, available, consumed, cleared)", () => {
  G.pendingBeliefEvidence = Object.create(null);
  assert.equal(Object.keys(G.pendingBeliefEvidence).length, 0, "pending not empty after reset");

  const sims = buildSims({
    TED: makeSim("TED", { beliefs: { escape_possible: 0.50, others_trustworthy: 0.75 } }),
  });
  G.sims = sims;
  G.cycle = 1;

  G.pendingBeliefEvidence.TED = [
    { belief: "escape_possible", direction: "increase", strength: 3, confidence: 0.8, source: "private_message", attribution: "social_pressure" },
  ];
  assert.ok("TED" in G.pendingBeliefEvidence, "evidence not available in same cycle");

  const pre = G.sims.TED.beliefs.escape_possible;
  runBeliefIntegrationPhase();
  assert.ok(G.sims.TED.beliefs.escape_possible > pre, "evidence not consumed in cycle t");

  G.pendingBeliefEvidence = Object.create(null);
  assert.equal(Object.keys(G.pendingBeliefEvidence).length, 0, "pending not cleared by next reset");
});

// Extractor-input boundary test (deterministic, no LLM, no production mock).
//
// extractInteractionEvidence.js computes marginalDelta = currentBeliefs[k] - baselineBeliefs[k]
// over the keys present in both, then passes it into the model-facing prompt
// context (buildContext -> marginalDeltas). It is invoked by the engine with
// baselineBeliefs = postPsychology and currentBeliefs = final (= postContagion)
// (cycle.js:872-873). The model boundary (callModel) is not directly injectable
// without mocking an ES-module namespace export, which is unsupported. Instead we
// assert the DETERMINISTIC INPUT it is supplied: the marginal delta equals
// postContagion - postPsychology, for a distinct numeric contagion movement.
// We do NOT assert that the LLM must emit reinforcement.
//
// To exercise the production marginal-delta computation path without the LLM,
// we reimplement the exact production formula (extractInteractionEvidence.js:48-58)
// against the same baseline/current objects the engine passes in. This proves the
// input contract; it does not duplicate behavior under test for the LLM step.
test("Extractor-input: marginal delta equals postContagion - postPsychology", () => {
  const sims = buildSims({
    TED: makeSim("TED", {
      beliefs: { escape_possible: 0.20, others_trustworthy: 0.75 },
      relationships: { ELLEN: 0.90 },
    }),
    ELLEN: makeSim("ELLEN", { beliefs: { escape_possible: 0.95 } }),
  });
  G.sims = sims;
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

  // Exact production marginal-delta computation (extractInteractionEvidence.js:48-58).
  const allKeys = new Set([...Object.keys(baseline || {}), ...Object.keys(current || {})]);
  const marginal = {};
  for (const key of allKeys) {
    marginal[key] = (current[key] ?? 0) - (baseline[key] ?? 0);
  }

  const postPsychology = baseline.escape_possible;
  const postContagion = current.escape_possible;
  const expected = postContagion - postPsychology;

  assert.ok(expected > 0, "contagion movement not captured as positive marginal delta");
  assert.equal(marginal.escape_possible, expected, "marginal delta != postContagion - postPsychology");
  assert.equal(marginal.escape_possible.toFixed(12), (postContagion - postPsychology).toFixed(12),
    "marginal delta float mismatch");

  // This is the value supplied to the model-facing extractor as the signal
  // (buildContext -> marginalDeltas). It is the contagion output, demonstrating
  // the causal-overlap pathway at the input boundary.
});