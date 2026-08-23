// js/tests/perceivedCoalitions.test.mjs

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { G } from "../core/state.js";
import { buildPromptContext } from "../prompts/utils/buildPromptContext.js";

function makeSim(id) {
  return {
    id,
    beliefs: {},
    relationships: {}
  };
}

describe("buildPromptContext perceivedCoalitions", () => {
  it("returns empty when coalitions cycle does not match", () => {
    G.cycle = 5;
    G.coalitions = {
      cycle: 4,
      groups: [{ members: ["TED", "ELLEN"], edges: [] }]
    };
    const sim = makeSim("NIMDOK");
    const ctx = buildPromptContext(sim);
    assert.deepEqual(ctx.perceivedCoalitions, []);
  });

  it("returns empty when no coalition groups exist", () => {
    G.cycle = 6;
    G.coalitions = { cycle: 6, groups: [] };
    const sim = makeSim("TED");
    const ctx = buildPromptContext(sim);
    assert.deepEqual(ctx.perceivedCoalitions, []);
  });

  it("perceives coalition when own trust toward a member exceeds threshold", () => {
    G.cycle = 7;
    G.coalitions = {
      cycle: 7,
      groups: [
        { members: ["TED", "ELLEN"], edges: [] },
        { members: ["NIMDOK", "GORRISTER"], edges: [] }
      ]
    };
    const sim = makeSim("BENNY");
    sim.relationships.TED = 0.4;
    sim.relationships.NIMDOK = 0.1;
    const ctx = buildPromptContext(sim);
    // Only the TED+ELLEN coalition qualifies (trust in TED >= 0.3).
    // NIMDOK+GORRISTER does not qualify (trust in NIMDOK < 0.3).
    assert.equal(ctx.perceivedCoalitions.length, 1);
    assert.deepEqual(ctx.perceivedCoalitions[0], ["TED", "ELLEN"]);
  });

  it("excludes self from perceived member list", () => {
    G.cycle = 8;
    G.coalitions = {
      cycle: 8,
      groups: [{ members: ["TED", "ELLEN"], edges: [] }]
    };
    const sim = makeSim("TED");
    sim.relationships.ELLEN = 0.4;
    const ctx = buildPromptContext(sim);
    assert.equal(ctx.perceivedCoalitions.length, 1);
    assert.deepEqual(ctx.perceivedCoalitions[0], ["ELLEN"]);
  });

  it("does not perceive when trust is below threshold", () => {
    G.cycle = 9;
    G.coalitions = {
      cycle: 9,
      groups: [{ members: ["TED", "ELLEN"], edges: [] }]
    };
    const sim = makeSim("NIMDOK");
    sim.relationships.TED = 0.29;
    sim.relationships.ELLEN = 0.1;
    const ctx = buildPromptContext(sim);
    assert.deepEqual(ctx.perceivedCoalitions, []);
  });

  it("does not perceive when trust is missing", () => {
    G.cycle = 10;
    G.coalitions = {
      cycle: 10,
      groups: [{ members: ["TED", "ELLEN"], edges: [] }]
    };
    const sim = makeSim("NIMDOK");
    const ctx = buildPromptContext(sim);
    assert.deepEqual(ctx.perceivedCoalitions, []);
  });
});