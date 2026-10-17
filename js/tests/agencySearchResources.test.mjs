import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { G } from "../core/state.js";
import { exportState, importState } from "../core/saveLoad.js";
import { engineRng, seedAll } from "../core/prng.js";
import { SIM_IDS } from "../core/constants.js";
import { ACTION_DEFINITIONS, SEARCH_COOLDOWN_CYCLES } from "../engine/agency/actionDefs.js";
import { deriveCapabilities } from "../engine/agency/capabilities.js";
import { commitAgencyResolution } from "../engine/agency/commit.js";
import { enumerateLegalActions } from "../engine/agency/legalActions.js";
import { buildResourceView, maintainResourceDrying } from "../engine/agency/resourceLedger.js";
import { getResourceDefinition } from "../engine/agency/resourceDefs.js";
import {
  createAgencySnapshot,
  resolveAgencyActions
} from "../engine/agency/resolve.js";
import { validateAgencyProposal } from "../engine/agency/proposal.js";
import { createAgencyState } from "../engine/agency/state/createAgencyState.js";
import { buildAgencyProposalPrompt } from "../prompts/agencyProposal.js";

function resource(resourceId, definitionId, quantity, holderId = "TED") {
  return {
    resourceId,
    definitionId,
    quantity,
    holderId,
    locationId: null,
    accessible: true,
    concealed: false,
    provenance: { source: "test" }
  };
}

function createGame(instances = [], cycle = 8) {
  const sims = Object.fromEntries(
    SIM_IDS.map((id) => [id, {
      id,
      hope: 50,
      sanity: 60,
      suffering: 10,
      stability: 0.4,
      drives: {},
      anchors: [],
      beliefs: {},
      constraints: [],
      scratchpad: { initialized: true }
    }])
  );

  return {
    cycle,
    sims,
    resources: { instances },
    agency: createAgencyState(),
    pendingResourceDiscoveries: []
  };
}

function legalActionsFor(game, actorId = "TED") {
  const sim = game.sims[actorId];
  const resourceView = buildResourceView(game.resources, actorId);
  return enumerateLegalActions(
    sim,
    deriveCapabilities(sim).capabilities,
    ACTION_DEFINITIONS,
    resourceView,
    game.cycle
  ).legal;
}

function searchResolution(game) {
  const proposal = {
    actorId: "TED",
    action: { type: "SEARCH" },
    cost: 1,
    accepted: true,
    reason: null
  };
  return resolveAgencyActions({
    proposals: [proposal],
    snapshot: createAgencySnapshot(game),
    cycle: game.cycle
  })[0];
}

test("SEARCH disappears during cooldown and returns at cycle four", () => {
  const game = createGame();
  game.sims.TED.lastSearchCycle = 10;

  assert.equal(SEARCH_COOLDOWN_CYCLES, 4);
  assert.ok(!legalActionsFor({ ...game, cycle: 13 }).some(({ type }) => type === "SEARCH"));
  assert.ok(legalActionsFor({ ...game, cycle: 14 }).some(({ type }) => type === "SEARCH"));
});

test("SEARCH yield probabilities follow the seeded engine RNG stream", () => {
  const originalRngState = engineRng.getState();
  try {
    seedAll("agency-search-yield-distribution");
    const game = createGame([], 20);
    const snapshot = createAgencySnapshot(game);
    const proposal = {
      actorId: "TED",
      action: { type: "SEARCH" },
      cost: 1,
      accepted: true
    };
    const counts = {
      unsuccessful: 0,
      cigarette: 0,
      wet_cigarette: 0,
      match: 0,
      doubleMatch: 0
    };

    for (let index = 0; index < 1000; index += 1) {
      const [resolution] = resolveAgencyActions({
        proposals: [proposal],
        snapshot,
        cycle: game.cycle
      });
      assert.equal(resolution.provenance.searchAttempted, true);
      if (resolution.reason === "environment_unyielding") {
        counts.unsuccessful += 1;
        continue;
      }

      const found = resolution.operations[0];
      counts[found.definitionId] += 1;
      if (found.definitionId === "match" && found.quantity === 2) {
        counts.doubleMatch += 1;
      }
    }

    assert.ok(counts.unsuccessful / 1000 > 0.62 && counts.unsuccessful / 1000 < 0.68);
    assert.ok(counts.cigarette / 1000 > 0.16 && counts.cigarette / 1000 < 0.23);
    assert.ok(counts.wet_cigarette / 1000 > 0.08 && counts.wet_cigarette / 1000 < 0.13);
    assert.ok(counts.match / 1000 > 0.035 && counts.match / 1000 < 0.07);
    assert.ok(counts.doubleMatch / Math.max(1, counts.match) > 0.2);
    assert.ok(counts.doubleMatch / Math.max(1, counts.match) < 0.4);
  } finally {
    engineRng.setState(originalRngState);
  }
});

test("SEARCH commit stores found items and starts cooldown on every attempt", () => {
  const game = createGame([], 11);
  const originalNext = engineRng.next;
  engineRng.next = () => 0.9;
  try {
    const resolution = searchResolution(game);
    assert.equal(resolution.reason, "environment_unyielding");
    assert.equal(resolution.provenance.searchAttempted, true);
    commitAgencyResolution(game, [resolution]);
    assert.equal(game.sims.TED.lastSearchCycle, 11);
    assert.deepEqual(game.resources.instances, []);
  } finally {
    engineRng.next = originalNext;
  }

  const foundGame = createGame([], 12);
  commitAgencyResolution(foundGame, [{
    actorId: "TED",
    action: { type: "SEARCH" },
    status: "success",
    operations: [{ type: "find", definitionId: "wet_cigarette", quantity: 1 }],
    provenance: { searchAttempted: true }
  }]);
  const [found] = foundGame.resources.instances;
  assert.match(found.resourceId, /^wet_cigarette_found_\d+_\d+$/);
  assert.equal(found.definitionId, "wet_cigarette");
  assert.equal(found.quantity, 1);
  assert.equal(found.holderId, "TED");
  assert.equal(found.locationId, null);
  assert.equal(found.accessible, true);
  assert.equal(found.concealed, false);
  assert.deepEqual(found.provenance, {
    source: "environment_search",
    cycle: 12
  });
  assert.equal(found.dryingTurns, 2);
  assert.equal(foundGame.sims.TED.lastSearchCycle, 12);
});

test("wet cigarettes dry on the second cycle start", () => {
  const game = createGame([
    { ...resource("wet-1", "wet_cigarette", 1), dryingTurns: 2 }
  ]);
  const [instance] = game.resources.instances;

  maintainResourceDrying(game);
  assert.equal(instance.definitionId, "wet_cigarette");
  assert.equal(instance.dryingTurns, 1);

  maintainResourceDrying(game);
  assert.equal(instance.definitionId, "cigarette");
  assert.equal(Object.hasOwn(instance, "dryingTurns"), false);
  const dryDefinition = getResourceDefinition(instance.definitionId);
  assert.equal(dryDefinition.consumable, true);
  assert.ok(dryDefinition.affordances.includes("CONSUME"));
  assert.deepEqual(dryDefinition.effects.consume, {
    suffering: -2,
    stability: 1
  });
});

test("CONSUME applies dirty-water effects and clamps stats", () => {
  const game = createGame([resource("water-1", "dirty_water", 1)]);
  game.sims.TED.suffering = 50;
  game.sims.TED.sanity = 60;
  const resourceView = buildResourceView(game.resources, "TED");
  const proposal = validateAgencyProposal({
    proposal: { type: "CONSUME", resourceId: "water-1" },
    actorId: "TED",
    legalActions: legalActionsFor(game),
    budget: 3,
    resourceView
  });
  assert.equal(proposal.accepted, true);

  const resolutions = resolveAgencyActions({
    proposals: [proposal],
    snapshot: createAgencySnapshot(game),
    cycle: game.cycle
  });
  assert.deepEqual(resolutions[0].effects, {
    suffering: -1.5,
    sanity: -0.5
  });
  commitAgencyResolution(game, resolutions);
  assert.equal(game.sims.TED.suffering, 48.5);
  assert.equal(game.sims.TED.sanity, 59.5);
  assert.equal(game.resources.instances[0].quantity, 0);

  game.sims.TED.suffering = 0.5;
  game.sims.TED.sanity = 0.25;
  commitAgencyResolution(game, [{
    actorId: "TED",
    action: { type: "CONSUME" },
    status: "success",
    operations: [],
    effects: { suffering: -1.5, sanity: -0.5 },
    provenance: {}
  }]);
  assert.equal(game.sims.TED.suffering, 0);
  assert.equal(game.sims.TED.sanity, 0);
});

test("CONSUME cannot bypass SMOKE to consume a cigarette", () => {
  const cigarette = resource("cigarette-1", "cigarette", 1);
  const proposal = validateAgencyProposal({
    proposal: { type: "CONSUME", resourceId: "cigarette-1" },
    actorId: "TED",
    legalActions: [{ type: "CONSUME", cost: 1, availableModes: [] }],
    budget: 3,
    resourceView: buildResourceView({ instances: [cigarette] }, "TED")
  });
  assert.equal(proposal.accepted, false);
  assert.equal(proposal.reason, "resource_unavailable");
});

test("agency save/load resumes search with identical ledger and RNG state", async () => {
  const savedOriginal = exportState();
  try {
    G.cycle = 24;
    G.sims.TED.constraints = [];
    G.sims.TED.lastSearchCycle = 20;
    G.resources.instances = [
      { ...resource("wet-1", "wet_cigarette", 1), dryingTurns: 1 }
    ];
    G.agency.events = [];
    G.agency.nextActionSequence = 3;
    G.pendingResourceDiscoveries = [];
    seedAll("agency-search-save-resume");

    const serialized = exportState();
    const envelope = JSON.parse(serialized);
    assert.equal(envelope.G.sims.TED.lastSearchCycle, 20);
    assert.equal(envelope.G.resources.instances[0].dryingTurns, 1);
    assert.deepEqual(envelope.rngStates.engineRng, engineRng.getState());

    const firstResolution = searchResolution(G);
    commitAgencyResolution(G, [firstResolution]);
    const firstContinuation = {
      ledger: structuredClone(G.resources.instances),
      lastSearchCycle: G.sims.TED.lastSearchCycle,
      rngState: engineRng.getState()
    };

    await importState(serialized);
    const resumedResolution = searchResolution(G);
    commitAgencyResolution(G, [resumedResolution]);
    assert.deepEqual(resumedResolution, firstResolution);
    assert.deepEqual({
      ledger: G.resources.instances,
      lastSearchCycle: G.sims.TED.lastSearchCycle,
      rngState: engineRng.getState()
    }, firstContinuation);
  } finally {
    await importState(savedOriginal);
  }
});

test("agency actions contain no nondeterministic random calls", async () => {
  const sourceFiles = [];
  async function collect(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        await collect(fullPath);
      } else if (/\.(?:m?js)$/.test(entry.name)) {
        sourceFiles.push(fullPath);
      }
    }
  }

  await collect(join(process.cwd(), "js", "engine", "agency"));
  const forbiddenCall = `Math.${"random"}(`;
  for (const path of sourceFiles) {
    const contents = await readFile(path, "utf8");
    assert.equal(contents.includes(forbiddenCall), false, `${path} contains a non-engine random call`);
  }
});

test("proposal prompt describes SEARCH scope and cooldown", () => {
  const prompt = buildAgencyProposalPrompt(
    { id: "TED", scratchpad: {} },
    [{ type: "SEARCH", cost: 1, availableModes: [] }],
    3,
    { stacks: [] }
  );
  assert.match(prompt, /SEARCH: Scavenges the immediate area\. 35% success\./);
  assert.match(prompt, /4-cycle cooldown/);
  assert.match(prompt, /does not target other prisoners/i);
});
