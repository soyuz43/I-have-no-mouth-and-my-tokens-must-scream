import { test } from "node:test";
import assert from "node:assert/strict";

import { G } from "../core/state.js";
import { SIM_IDS } from "../core/constants.js";
import { engineRng } from "../core/prng.js";
import { buildSimOutreachPrompt } from "../prompts/simOutreach.js";
import { buildSimReplyPrompt } from "../prompts/simReply.js";
import { formatResourceSummary } from "../prompts/utils/formatResourceSummary.js";

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
    relationships: Object.fromEntries(
      SIM_IDS.filter((other) => other !== id).map((other) => [other, 0])
    ),
    drives: { primary: "find a way out", secondary: "" },
    overheard: [],
    intentProfile: {},
  };
}

function buildPrompts(sim) {
  return [
    buildSimOutreachPrompt(sim),
    buildSimReplyPrompt(sim, "ELLEN", "Can you help?", "private", []),
  ];
}

test("communication prompts include deterministic holder resource summaries", () => {
  const saved = {
    resources: G.resources,
    claimState: G.claimState,
    interSimLog: G.interSimLog,
    coalitions: G.coalitions,
    cycle: G.cycle,
    nextRandom: engineRng.next,
  };

  try {
    G.resources = {
      instances: [
        {
          definitionId: "match",
          quantity: 2,
          holderId: "TED",
          concealed: true,
          locationId: "test-location-secret",
          provenance: { source: "test-provenance-secret" },
        },
        { definitionId: "cigarette", quantity: 1, holderId: "TED" },
        { definitionId: "cigarette", quantity: 2, holderId: "TED" },
        { definitionId: "water", quantity: 4, holderId: "ELLEN" },
      ],
    };
    /*
     * The BELIEVED ledger, not the objective one.
     *
     * A prisoner whose cigarette was silently confiscated still
     * believes they are carrying it. The social prompt must render
     * the belief, or the divergence collapses at the moment the
     * prisoner states it.
     */
    G.claimState = {
      TED: { cigarette: 3, match: 2 },
      ELLEN: { water: 4 },
    };
    G.interSimLog = [];
    G.coalitions = { cycle: null, groups: [] };
    engineRng.next = () => 0;

    const sim = makeSim("TED");
    const summary = "[YOUR RESOURCES] cigarette: 3, match: 2";
    const guidance = "Each entry is item type: total units you hold. Mention, offer, request, conceal, or ignore this context as you choose.";
    const inventoryBlock = `---\n\nYOUR INVENTORY\n\n${summary}\n${guidance}\n\n---`;
    const promptsWithResources = buildPrompts(sim);

    assert.equal(
      formatResourceSummary(G.resources.instances, sim.id, G.claimState[sim.id]),
      summary
    );
    assert.equal(
      formatResourceSummary(G.resources.instances, sim.id, G.claimState[sim.id]),
      summary
    );
    assert.deepEqual(
      promptsWithResources.map((prompt) => prompt.includes(summary)),
      [true, true]
    );
    assert.deepEqual(
      promptsWithResources.map((prompt) => prompt.includes(guidance)),
      [true, true]
    );
    assert.ok(promptsWithResources.every((prompt) => prompt.includes(inventoryBlock)));
    assert.ok(
      promptsWithResources[0].indexOf("YOUR INVENTORY") >
        promptsWithResources[0].indexOf("RECENT MESSAGES YOU HAVE SEEN")
    );
    assert.ok(
      promptsWithResources[0].indexOf("YOUR INVENTORY") <
        promptsWithResources[0].indexOf("Based on your current state and drives, decide:")
    );
    assert.ok(
      promptsWithResources[1].indexOf("YOUR INVENTORY") >
        promptsWithResources[1].indexOf("CURRENT MESSAGE")
    );
    assert.ok(
      promptsWithResources[1].indexOf("YOUR INVENTORY") <
        promptsWithResources[1].indexOf("## IMMEDIATE COMMUNICATION DECISION")
    );
    assert.ok(promptsWithResources.every((prompt) => !prompt.includes("test-location-secret")));
    assert.ok(promptsWithResources.every((prompt) => !prompt.includes("test-provenance-secret")));

    /*
     * The believed ledger still says the prisoner is carrying three
     * cigarettes, so the prompt must still show them even though the
     * objective ledger is empty. This is the leak the fix prevents.
     */
    G.resources = { instances: [] };
    const promptsWithoutResources = buildPrompts(sim);
    assert.deepEqual(
      promptsWithoutResources.map((prompt) => prompt.includes(summary)),
      [true, true]
    );
    assert.ok(promptsWithoutResources.every((prompt) => prompt.includes(guidance)));
  } finally {
    G.resources = saved.resources;
    G.claimState = saved.claimState;
    G.interSimLog = saved.interSimLog;
    G.coalitions = saved.coalitions;
    G.cycle = saved.cycle;
    engineRng.next = saved.nextRandom;
  }
});
