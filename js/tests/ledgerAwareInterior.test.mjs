import { strict as assert } from "node:assert";
import test from "node:test";

import { G } from "../core/state.js";
import { buildSimJournalPrompt } from "../prompts/journal.js";
import { buildSimJournalStatsPrompt } from "../prompts/stats.js";
import {
  formatInventoryContext,
  getObjectiveInventory,
  inventoriesDiffer,
} from "../prompts/utils/formatInventoryContext.js";

function withInventoryState(claimState, instances, callback) {
  const previousClaimState = G.claimState;
  const previousResources = G.resources;

  try {
    G.claimState = claimState;
    G.resources = { instances };
    return callback();
  } finally {
    G.claimState = previousClaimState;
    G.resources = previousResources;
  }
}

test("inventory context formats multiple believed resources naturally", () => {
  assert.equal(
    formatInventoryContext({ match: 1, cigarette: 3 }),
    "You believe you are carrying: 3 cigarettes, 1 match."
  );
});

test("inventory context omits empty, zero, and invalid holdings", () => {
  assert.equal(formatInventoryContext(undefined), "");
  assert.equal(formatInventoryContext({}), "");
  assert.equal(formatInventoryContext({ cigarette: 0, match: Number.NaN }), "");
});

test("objective inventory sums only accessible positive holdings", () => {
  const objective = getObjectiveInventory([
    { definitionId: "cigarette", quantity: 1, holderId: "TED", accessible: true },
    { definitionId: "cigarette", quantity: 2, holderId: "TED", accessible: true },
    { definitionId: "match", quantity: 1, holderId: "TED", accessible: false },
    { definitionId: "water", quantity: 4, holderId: "ELLEN", accessible: true },
    { definitionId: "match", quantity: 0, holderId: "TED", accessible: true },
  ], "TED");

  assert.deepEqual(objective, { cigarette: 3 });
  assert.equal(inventoriesDiffer({ cigarette: 3 }, objective), false);
  assert.equal(inventoriesDiffer({ cigarette: 4 }, objective), true);
});

test("journal prompt includes believed inventory without exposing objective holdings", () => {
  const prompt = withInventoryState(
    { TED: { cigarette: 2 } },
    [{ definitionId: "cigarette", quantity: 1, holderId: "TED", accessible: true }],
    () => buildSimJournalPrompt(G.sims.TED, null)
  );

  assert.ok(prompt.includes("[WHAT YOU BELIEVE YOU ARE CARRYING]"));
  assert.ok(prompt.includes("You believe you are carrying: 2 cigarettes."));
  assert.ok(prompt.includes("If what you believe you have differs from what you actually have access to"));
  assert.ok(!prompt.includes("Objective reality:"));
});

test("journal prompt omits inventory section when no holdings are believed", () => {
  const prompt = withInventoryState(
    { TED: {} },
    [],
    () => buildSimJournalPrompt(G.sims.TED, null)
  );

  assert.ok(!prompt.includes("[WHAT YOU BELIEVE YOU ARE CARRYING]"));
});

test("stats prompt includes resource evidence only for divergent inventory", () => {
  const divergentPrompt = withInventoryState(
    { TED: { cigarette: 3 } },
    [{ definitionId: "cigarette", quantity: 1, holderId: "TED", accessible: true }],
    () => buildSimJournalStatsPrompt(G.sims.TED, "I reached for the missing cigarettes.", "(none)")
  );

  assert.ok(divergentPrompt.includes("[RESOURCE BELIEF EVIDENCE]"));
  assert.ok(divergentPrompt.includes("Source: resource_belief"));
  assert.ok(divergentPrompt.includes("The prisoner believes they hold: 3 cigarettes."));
  assert.ok(divergentPrompt.includes("Objective reality: 1 cigarette."));
  assert.ok(divergentPrompt.includes("especially on reality_reliable"));

  const matchingPrompt = withInventoryState(
    { TED: { cigarette: 1 } },
    [{ definitionId: "cigarette", quantity: 1, holderId: "TED", accessible: true }],
    () => buildSimJournalStatsPrompt(G.sims.TED, "I remember my cigarette.", "(none)")
  );

  assert.ok(!matchingPrompt.includes("[RESOURCE BELIEF EVIDENCE]"));
  assert.ok(!matchingPrompt.includes("Source: resource_belief"));

  const underclaimPrompt = withInventoryState(
    { TED: {} },
    [{ definitionId: "cigarette", quantity: 1, holderId: "TED", accessible: true }],
    () => buildSimJournalStatsPrompt(G.sims.TED, "I did not expect to find it.", "(none)")
  );

  assert.ok(underclaimPrompt.includes("[RESOURCE BELIEF EVIDENCE]"));
  assert.ok(underclaimPrompt.includes("The prisoner believes they hold nothing."));
  assert.ok(underclaimPrompt.includes("Objective reality: 1 cigarette."));
});

test("forensic observation schema accepts resource_belief source", () => {
  const prompt = buildSimJournalStatsPrompt(
    G.sims.TED,
    "No change.",
    "(none)"
  );
  const schemaStart = prompt.indexOf("**Output Schema**");
  const schemaEnd = prompt.indexOf("**Observation Direction Semantics**", schemaStart);
  const schema = prompt.slice(schemaStart, schemaEnd);

  assert.ok(schema.includes("resource_belief"));
});
