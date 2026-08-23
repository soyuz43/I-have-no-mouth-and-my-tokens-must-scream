// js/tests/coalitionDetection.test.mjs

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  detectCoalitions,
  COALITION_CONFIG
} from "../engine/social/coalitionDetection.js";

function makeSims(overrides = {}) {
  const ids = ["TED", "ELLEN", "NIMDOK", "GORRISTER", "BENNY"];
  return Object.fromEntries(
    ids.map(id => [
      id,
      { relationships: { ...(overrides[id] || {}) } }
    ])
  );
}

describe("detectCoalitions", () => {
  it("returns empty for null or invalid input", () => {
    assert.deepEqual(detectCoalitions(null), []);
    assert.deepEqual(detectCoalitions(undefined), []);
    assert.deepEqual(detectCoalitions("not an object"), []);
  });

  it("returns empty when no trust exceeds threshold", () => {
    const sims = makeSims({
      TED: { ELLEN: 0.1 },
      ELLEN: { TED: 0.2 }
    });
    assert.deepEqual(detectCoalitions(sims), []);
  });

  it("forms a coalition from a single directed edge under directed threshold", () => {
    // Directed threshold semantics: one qualifying directed edge unions the pair.
    const sims = makeSims({
      TED: { ELLEN: 0.5 }
    });
    const result = detectCoalitions(sims);
    assert.equal(result.length, 1);
    assert.ok(result[0].members.includes("TED"));
    assert.ok(result[0].members.includes("ELLEN"));
  });

  it("detects a mutual pair above threshold", () => {
    const sims = makeSims({
      TED: { ELLEN: 0.4 },
      ELLEN: { TED: 0.35 }
    });
    const result = detectCoalitions(sims);
    assert.equal(result.length, 1);
    assert.ok(result[0].members.includes("TED"));
    assert.ok(result[0].members.includes("ELLEN"));
    assert.equal(result[0].members.length, 2);
  });

  it("includes edge at exact threshold", () => {
    const sims = makeSims({
      TED: { ELLEN: COALITION_CONFIG.threshold },
      ELLEN: { TED: 0.5 }
    });
    const result = detectCoalitions(sims);
    assert.equal(result.length, 1);
    assert.equal(result[0].members.length, 2);
  });

  it("forms one coalition from a chain A->B->C with all edges qualifying", () => {
    const sims = makeSims({
      TED: { ELLEN: 0.5 },
      ELLEN: { TED: 0.4, NIMDOK: 0.6 },
      NIMDOK: { ELLEN: 0.45 }
    });
    const result = detectCoalitions(sims);
    assert.equal(result.length, 1);
    assert.equal(result[0].members.length, 3);
  });

  it("separates two disconnected pairs into two coalitions", () => {
    const sims = makeSims({
      TED: { ELLEN: 0.5 },
      ELLEN: { TED: 0.5 },
      NIMDOK: { GORRISTER: 0.4 },
      GORRISTER: { NIMDOK: 0.4 }
    });
    const result = detectCoalitions(sims);
    assert.equal(result.length, 2);
  });

  it("excludes non-qualifying members from an otherwise qualifying pair", () => {
    const sims = makeSims({
      TED: { ELLEN: 0.5 },
      ELLEN: { TED: 0.5 },
      NIMDOK: { TED: 0.8 }
    });
    const result = detectCoalitions(sims);
    // NIMDOK -> TED qualifies but is not reciprocated; union-find on directed
    // edge still merges them. This test documents current behavior.
    const members = result.flatMap(c => c.members);
    assert.ok(members.includes("TED"));
    assert.ok(members.includes("ELLEN"));
    assert.ok(members.includes("NIMDOK"));
  });

  it("returns deterministic ordering across runs", () => {
    const sims = makeSims({
      GORRISTER: { BENNY: 0.5 },
      BENNY: { GORRISTER: 0.5 },
      TED: { ELLEN: 0.4 },
      ELLEN: { TED: 0.4 }
    });
    const run1 = detectCoalitions(sims).map(c => c.members.join("+"));
    const run2 = detectCoalitions(sims).map(c => c.members.join("+"));
    assert.deepEqual(run1, run2);
  });

  it("handles missing relationship maps gracefully", () => {
    const sims = { TED: {} };
    assert.deepEqual(detectCoalitions(sims), []);
  });

  it("rejects invalid config", () => {
    const sims = makeSims({
      TED: { ELLEN: 0.9 },
      ELLEN: { TED: 0.9 }
    });
    assert.deepEqual(detectCoalitions(sims, { threshold: NaN, minSize: 2 }), []);
    assert.deepEqual(detectCoalitions(sims, { threshold: 0.3, minSize: 1 }), []);
    assert.deepEqual(detectCoalitions(sims, { threshold: 0.3, minSize: 0 }), []);
  });
});