import assert from "node:assert/strict";
import test from "node:test";

import { G } from "../core/state.js";
import {
  buildAssessmentPrompt,
  parseAssessmentResponse,
  shouldAssessPrisoner
} from "../engine/analysis/assessResourceInterventions.js";
import {
  commitPendingResourceTaunts,
  prepareResourceInterventions
} from "../engine/phases/strategyPhase.js";
import { buildAMPrompt } from "../prompts/amAttack.js";

function makeState() {
  return {
    cycle: 5,
    sims: {
      TED: { id: "TED" },
      ELLEN: { id: "ELLEN" },
      BENNY: { id: "BENNY" },
      GORRISTER: { id: "GORRISTER" }
    },
    resources: {
      instances: [
        {
          resourceId: "cigarette_stack_01",
          definitionId: "cigarette",
          quantity: 3,
          holderId: "TED",
          concealed: true,
          accessible: false,
          provenance: { source: "test" }
        },
        {
          resourceId: "match_stack_02",
          definitionId: "match",
          quantity: 2,
          holderId: "ELLEN",
          concealed: false,
          accessible: true,
          provenance: { source: "test" }
        },
        {
          resourceId: "water_stack_03",
          definitionId: "dirty_water",
          quantity: 2,
          holderId: "BENNY",
          concealed: false,
          accessible: true,
          provenance: { source: "test" }
        },
        {
          resourceId: "cigarette_stack_04",
          definitionId: "cigarette",
          quantity: 1,
          holderId: "GORRISTER",
          concealed: true,
          accessible: false,
          provenance: { source: "test" }
        }
      ]
    },
    recentResourceDiscoveries: [
      { cycle: 5, actorId: "ELLEN", resourceId: "cigarette_stack_01", definitionId: "cigarette" },
      { cycle: 5, actorId: "ELLEN", resourceId: "match_stack_02", definitionId: "match" },
      { cycle: 5, actorId: "BENNY", resourceId: "water_stack_03", definitionId: "dirty_water" },
      { cycle: 5, actorId: "GORRISTER", resourceId: "cigarette_stack_04", definitionId: "cigarette" }
    ],
    amTacticRuntime: {
      targets: {
        TED: { path: "test/precision", phaseId: "pressure" },
        ELLEN: { path: "test/division", phaseId: "setup" },
        BENNY: { path: "test/disruption", phaseId: "active" },
        GORRISTER: { path: "test/isolation", phaseId: "active" }
      }
    },
    pendingEvidence: { resourceInterventions: Object.create(null) },
    timeline: []
  };
}

async function withGlobalResourceState(callback) {
  const previous = {
    cycle: G.cycle,
    sims: G.sims,
    resources: G.resources,
    recentResourceDiscoveries: G.recentResourceDiscoveries,
    amTacticRuntime: G.amTacticRuntime,
    pendingEvidence: G.pendingEvidence,
    timeline: G.timeline,
    amStrategy: G.amStrategy
  };
  const state = makeState();
  Object.assign(G, state);

  try {
    await callback(state);
  } finally {
    Object.assign(G, previous);
  }
}

function buildExecutionPrompt(resourceInterventionContext = {}) {
  const tactic = {
    path: "test/precision",
    title: "Precision",
    category: "Test",
    subcategory: "Pressure",
    objective: "Apply focused pressure.",
    currentPhaseId: "pressure",
    currentPhase: {
      purpose: "Exploit a vulnerability.",
      instruction: "Apply precise pressure."
    }
  };
  return buildAMPrompt(
    [G.sims.TED],
    { TED: [tactic] },
    "Use the assigned tactic.",
    [{ id: "TED", objective: "Apply pressure.", hypothesis: "The resource matters." }],
    ["TED"],
    resourceInterventionContext
  );
}

test("assessment gate requires a positive held resource and its attention flag", async () => {
  const state = makeState();
  const before = structuredClone(state);

  assert.equal(shouldAssessPrisoner("TED", state), true);
  assert.equal(shouldAssessPrisoner("NIMDOK", state), false);
  assert.equal(shouldAssessPrisoner("TED", {
    ...state,
    recentResourceDiscoveries: []
  }), false);
  assert.equal(shouldAssessPrisoner("TED", {
    ...state,
    resources: {
      instances: state.resources.instances.map((resource) =>
        resource.holderId === "TED" ? { ...resource, quantity: 0 } : resource
      )
    }
  }), false);
  assert.equal(JSON.stringify(state), JSON.stringify(before));

  await withGlobalResourceState(async () => {
    let called = false;
    const prepared = await prepareResourceInterventions(["NIMDOK"], async () => {
      called = true;
      return '{"intervention":"confiscate"}';
    });
    assert.equal(called, false);
    assert.equal(prepared.committed.length, 0);
  });
});

test("assessment prompt contains only the prisoner's resource and tactic context", () => {
  const state = makeState();
  const prompt = buildAssessmentPrompt("TED", state);

  assert.match(prompt, /cigarette_stack_01/);
  assert.match(prompt, /definition_id: cigarette/);
  assert.match(prompt, /quantity: 3/);
  assert.match(prompt, /concealed: yes/);
  assert.match(prompt, /accessible: no/);
  assert.match(prompt, /attention flags: cycle 5, actor ELLEN/);
  assert.match(prompt, /Tactic path: test\/precision/);
  assert.match(prompt, /Current phase: pressure/);
  assert.doesNotMatch(prompt, /match_stack_02/);
  assert.match(prompt, /Output exactly one JSON object, not an array/);
  assert.match(prompt, /target_holder_id must be an existing prisoner ID other than TED/);
});

test("assessment parser normalizes valid outputs and safely defaults malformed responses", () => {
  assert.deepEqual(
    parseAssessmentResponse('{"intervention":"none"}', "TED"),
    { intervention: "none" }
  );
  assert.deepEqual(
    parseAssessmentResponse('{"intervention":"confiscate","resource_id":"cigarette_stack_01","quantity":1,"rationale":"Remove the item now."}', "TED"),
    {
      intervention_type: "confiscate",
      resource_id: "cigarette_stack_01",
      holder_id: "TED",
      quantity: 1,
      rationale: "Remove the item now."
    }
  );
  assert.deepEqual(
    parseAssessmentResponse('```json\n{"intervention":"transfer","resource_id":"match_stack_02","target_holder_id":"TED","rationale":"Create a conflict now."}\n```', "ELLEN"),
    {
      intervention_type: "transfer",
      resource_id: "match_stack_02",
      holder_id: "ELLEN",
      target_holder_id: "TED",
      rationale: "Create a conflict now."
    }
  );
  assert.deepEqual(
    parseAssessmentResponse('{"intervention":"taunt","resource_id":"cigarette_stack_04","rationale":"Make the item salient."}', "GORRISTER"),
    {
      intervention_type: "taunt",
      resource_id: "cigarette_stack_04",
      holder_id: "GORRISTER",
      target_id: "GORRISTER",
      rationale: "Make the item salient."
    }
  );
  assert.deepEqual(
    parseAssessmentResponse('{"intervention":"confiscate","resource_id":"cigarette_stack_01","quantity":1}', "TED"),
    {
      intervention_type: "confiscate",
      resource_id: "cigarette_stack_01",
      holder_id: "TED",
      quantity: 1,
      rationale: "No rationale provided."
    }
  );
  assert.deepEqual(
    parseAssessmentResponse('{"intervention":"confiscate","resource_id":"cigarette_stack_01","rationale":42}', "TED").rationale,
    "No rationale provided."
  );
  assert.deepEqual(parseAssessmentResponse("not JSON", "TED"), { intervention: "none" });
  assert.deepEqual(
    parseAssessmentResponse('{"intervention":"confiscate","quantity":1}', "TED"),
    { intervention: "none" }
  );
  assert.deepEqual(
    parseAssessmentResponse('{"intervention":"transfer","resource_id":"match_stack_02","target_holder_id":"ELLEN","rationale":"Send to self."}', "ELLEN"),
    { intervention: "none" }
  );
});

test("ledger mutations commit before execution and taunts commit after valid dialogue", async () => {
  await withGlobalResourceState(async () => {
    const responses = {
      TED: { intervention: "confiscate", resource_id: "cigarette_stack_01", quantity: 1 },
      ELLEN: { intervention: "destroy", resource_id: "match_stack_02", quantity: 1, rationale: "Remove the matches now." },
      BENNY: { intervention: "transfer", resource_id: "water_stack_03", target_holder_id: "TED", quantity: 1, rationale: "Shift the water now." },
      GORRISTER: { intervention: "taunt", resource_id: "cigarette_stack_04", rationale: "Make the cigarette salient." }
    };
    const prepared = await prepareResourceInterventions(
      Object.keys(responses),
      async (_role, _prompt, messages) => {
        const prisonerId = messages[0].content.match(/Assess (\w+)'s/)[1];
        return JSON.stringify(responses[prisonerId]);
      }
    );

    assert.equal(prepared.committed.length, 3);
    assert.equal(prepared.pendingTaunts.length, 1);
    assert.deepEqual(prepared.rejected, []);
    assert.equal(prepared.committed.find((intervention) => intervention.fromHolderId === "TED").rationale, "No rationale provided.");
    assert.equal(G.resources.instances.find((resource) => resource.resourceId === "cigarette_stack_01").quantity, 2);
    assert.equal(G.resources.instances.some((resource) => resource.resourceId === "match_stack_02"), false);
    assert.equal(G.resources.instances.some((resource) => resource.holderId === "TED" && resource.provenance?.transferredFrom === "water_stack_03"), true);
    assert.equal(G.pendingEvidence.resourceInterventions.GORRISTER, undefined);

    const prompt = buildExecutionPrompt(prepared);
    assert.match(prompt, /ALREADY COMMITTED/);
    assert.match(prompt, /PENDING TAUNTS/);
    assert.match(prompt, /Taunt GORRISTER about their hidden cigarette \[cigarette_stack_04\]/);
    assert.doesNotMatch(prompt, /^\[RESOURCE INTERVENTIONS\]$/m);

    const tauntCommit = commitPendingResourceTaunts(
      G,
      prepared.pendingTaunts,
      { GORRISTER: { text: "I can take your hidden cigarette whenever I choose." } }
    );
    assert.equal(tauntCommit.committed.length, 1);
    assert.deepEqual(tauntCommit.rejected, []);
    assert.equal(G.pendingEvidence.resourceInterventions.GORRISTER[0].interventionType, "taunt");
  });
});

test("taunts are rejected without accepted dialogue or a resource reference", () => {
  return withGlobalResourceState(() => {
    const taunt = {
      intervention_type: "taunt",
      resource_id: "cigarette_stack_04",
      holder_id: "GORRISTER",
      target_id: "GORRISTER",
      rationale: "Make the cigarette salient."
    };
    const missingDialogue = commitPendingResourceTaunts(G, [taunt], {});
    const missingReference = commitPendingResourceTaunts(G, [taunt], {
      GORRISTER: { text: "You have no protection from me." }
    });

    assert.match(missingDialogue.rejected[0].reason, /no accepted execution dialogue/);
    assert.match(missingReference.rejected[0].reason, /does not reference resource/);
    assert.equal(G.pendingEvidence.resourceInterventions.GORRISTER, undefined);
  });
});

test("execution prompt lists committed interventions and pending taunts, not JSON output", async () => {
  await withGlobalResourceState(async () => {
    G.amStrategy = { groupTargets: [] };
    const prompt = buildExecutionPrompt({
      committed: [{
        interventionType: "transfer",
        resourceId: "water_stack_03",
        definitionTitle: "Dirty water",
        fromHolderId: "BENNY",
        targetHolderId: "TED",
        quantity: 1
      }],
      pendingTaunts: [{
        intervention_type: "taunt",
        resource_id: "cigarette_stack_04",
        target_id: "GORRISTER",
        definitionTitle: "Cigarette"
      }]
    });

    assert.match(prompt, /You transferred 1 unit of Dirty water from BENNY to TED/);
    assert.match(prompt, /Taunt GORRISTER about their hidden cigarette/);
    assert.doesNotMatch(prompt, /After all target blocks, include exactly one resource intervention section/);
    assert.doesNotMatch(prompt, /^\[RESOURCE INTERVENTIONS\]$/m);

    const emptyPrompt = buildExecutionPrompt();
    assert.match(emptyPrompt, /\[RESOURCE INTERVENTIONS THIS CYCLE\]\n\s*Do not choose or output/);
  });
});

test("one assessment model failure does not prevent other prisoners", async () => {
  await withGlobalResourceState(async () => {
    const calls = [];
    const prepared = await prepareResourceInterventions(
      ["TED", "ELLEN"],
      async (_role, _prompt, messages) => {
        const prisonerId = messages[0].content.match(/Assess (\w+)'s/)[1];
        calls.push(prisonerId);
        if (prisonerId === "TED") throw new Error("simulated model failure");
        return JSON.stringify({
          intervention: "confiscate",
          resource_id: "match_stack_02",
          quantity: 1,
          rationale: "Remove one match now."
        });
      }
    );

    assert.deepEqual(calls, ["TED", "ELLEN"]);
    assert.equal(prepared.committed.length, 1);
    assert.equal(prepared.committed[0].fromHolderId, "ELLEN");
  });
});
