import assert from "node:assert/strict";
import test from "node:test";

import { G } from "../core/state.js";
import { commitResourceInterventions } from "../engine/analysis/commitResourceInterventions.js";
import {
  dialogueReferencesResource,
  hasTargetDialogue
} from "../engine/analysis/parseResourceInterventions.js";
import { validateResourceIntervention } from "../engine/analysis/resourceInterventions.js";
import { buildAMPrompt } from "../prompts/amAttack.js";
import { buildScratchpadCommsPrompt } from "../prompts/scratchpadComms.js";
import { formatScratchpadContext } from "../prompts/utils/formatScratchpadContext.js";

const sims = {
  TED: { id: "TED", scratchpad: {} },
  ELLEN: { id: "ELLEN", scratchpad: {} }
};

function makeLedger() {
  return {
    instances: [
      {
        resourceId: "cigarette_stack_01",
        definitionId: "cigarette",
        quantity: 3,
        holderId: "TED",
        locationId: null,
        accessible: false,
        concealed: true,
        provenance: { source: "test" }
      },
      {
        resourceId: "match_stack_02",
        definitionId: "match",
        quantity: 2,
        holderId: "ELLEN",
        locationId: null,
        accessible: true,
        concealed: false,
        provenance: { source: "test" }
      }
    ]
  };
}

function makeState(resources = makeLedger()) {
  return {
    cycle: 5,
    sims,
    resources,
    pendingEvidence: { resourceInterventions: Object.create(null) }
  };
}

test("AM execution prompt includes pre-decided interventions without JSON generation", () => {
  const previousStrategy = G.amStrategy;
  const previousResources = G.resources;
  const previousDiscoveries = G.recentResourceDiscoveries;

  try {
    G.amStrategy = { groupTargets: [] };
    G.resources = makeLedger();
    G.recentResourceDiscoveries = [
      { resourceId: "cigarette_stack_01", cycle: 5 }
    ];

    const tactic = {
      path: "test/tactic",
      title: "Precision",
      category: "Test",
      subcategory: "Pressure",
      objective: "Apply focused pressure.",
      currentPhaseId: "current",
      currentPhase: {
        purpose: "Exploit a vulnerability.",
        instruction: "Apply precise pressure."
      }
    };
    const prompt = buildAMPrompt(
      [G.sims.TED],
      { TED: [tactic] },
      "Use the assigned tactic.",
      [{ id: "TED", objective: "Apply pressure.", hypothesis: "The resource matters." }],
      ["TED"],
      {
        committed: [{
          interventionType: "confiscate",
          resourceId: "cigarette_stack_01",
          definitionTitle: "Cigarette",
          fromHolderId: "TED",
          quantity: 1
        }],
        pendingTaunts: [{
          intervention_type: "taunt",
          resource_id: "cigarette_stack_01",
          definitionTitle: "Cigarette",
          target_id: "TED"
        }]
      }
    );

    assert.match(prompt, /# OBJECTIVE RESOURCE LEDGER \(CONTEXT ONLY\)/);
    assert.match(prompt, /cigarette_stack_01/);
    assert.match(prompt, /concealed yes/);
    assert.match(prompt, /attention flag Cycle 5/);
    assert.match(prompt, /\[RESOURCE INTERVENTIONS THIS CYCLE\]/);
    assert.match(prompt, /You confiscated 1 unit of Cigarette from TED/);
    assert.match(prompt, /Taunt TED about their hidden cigarette/);
    assert.doesNotMatch(prompt, /^\[RESOURCE INTERVENTIONS\]$/m);
    assert.doesNotMatch(prompt, /Output a JSON array/);
  } finally {
    G.amStrategy = previousStrategy;
    G.resources = previousResources;
    G.recentResourceDiscoveries = previousDiscoveries;
  }
});

test("taunt dialogue utilities recognize accepted actions and resource references", () => {
  const actions = { TED: { text: "Your cigarette will not protect you." } };
  const resource = makeLedger().instances[0];

  assert.equal(hasTargetDialogue(actions, "TED"), true);
  assert.equal(hasTargetDialogue(actions, "ELLEN"), false);
  assert.equal(dialogueReferencesResource(actions.TED.text, resource), true);
  assert.equal(dialogueReferencesResource("You are not safe.", resource), false);
});

test("CONFISCATE moves a partial stack to AM and records holder awareness", () => {
  const state = makeState();
  const previousTimeline = G.timeline;
  const previousCycle = G.cycle;
  G.timeline = [];
  G.cycle = state.cycle;

  try {
    const result = commitResourceInterventions(state, [{
      intervention_type: "confiscate",
      resource_id: "cigarette_stack_01",
      holder_id: "TED",
      quantity: 1,
      provenance: { cycle: 5, tacticPath: "test/tactic", rationale: "Remove one." }
    }]);

    assert.equal(result.committed.length, 1);
    const original = state.resources.instances.find((item) => item.resourceId === "cigarette_stack_01");
    const confiscated = state.resources.instances.find((item) => item.holderId === "AM");
    assert.equal(original.quantity, 2);
    assert.equal(confiscated.quantity, 1);
    assert.equal(confiscated.accessible, false);
    assert.deepEqual(state.pendingEvidence.resourceInterventions.TED[0].interventionType, "confiscate");
  } finally {
    G.timeline = previousTimeline;
    G.cycle = previousCycle;
  }
});

test("DESTROY removes the resource instance from the ledger", () => {
  const state = makeState();
  const previousTimeline = G.timeline;
  const previousCycle = G.cycle;
  G.timeline = [];
  G.cycle = state.cycle;

  try {
    const result = commitResourceInterventions(state, [{
      intervention_type: "destroy",
      resource_id: "cigarette_stack_01",
      rationale: "Remove the option."
    }]);

    assert.equal(result.committed.length, 1);
    assert.equal(
      state.resources.instances.some((item) => item.resourceId === "cigarette_stack_01"),
      false
    );
    assert.equal(state.pendingEvidence.resourceInterventions.TED[0].interventionType, "destroy");
  } finally {
    G.timeline = previousTimeline;
    G.cycle = previousCycle;
  }
});

test("TRANSFER updates the resource holder", () => {
  const state = makeState({
    instances: [{
      resourceId: "match_stack_02",
      definitionId: "match",
      quantity: 2,
      holderId: "ELLEN",
      accessible: true,
      concealed: false,
      provenance: { source: "test" }
    }]
  });
  const previousTimeline = G.timeline;
  const previousCycle = G.cycle;
  G.timeline = [];
  G.cycle = state.cycle;

  try {
    const result = commitResourceInterventions(state, [{
      intervention_type: "transfer",
      resource_id: "match_stack_02",
      holder_id: "ELLEN",
      target_holder_id: "TED",
      rationale: "Shift leverage."
    }]);

    assert.equal(result.committed.length, 1);
    assert.equal(state.resources.instances[0].holderId, "TED");
    assert.deepEqual(
      state.pendingEvidence.resourceInterventions.ELLEN.map((event) => event.interventionType),
      ["transfer"]
    );
    assert.deepEqual(
      state.pendingEvidence.resourceInterventions.TED.map((event) => event.interventionType),
      ["transfer"]
    );
  } finally {
    G.timeline = previousTimeline;
    G.cycle = previousCycle;
  }
});

test("TAUNT records awareness without changing the ledger", () => {
  const state = makeState();
  const ledgerBefore = structuredClone(state.resources);
  const previousTimeline = G.timeline;
  const previousCycle = G.cycle;
  G.timeline = [];
  G.cycle = state.cycle;

  try {
    const result = commitResourceInterventions(state, [{
      intervention_type: "taunt",
      resource_id: "cigarette_stack_01",
      target_id: "TED",
      rationale: "Make him feel watched."
    }]);

    assert.equal(result.committed.length, 1);
    assert.deepEqual(state.resources, ledgerBefore);
    assert.equal(state.pendingEvidence.resourceInterventions.TED[0].interventionType, "taunt");
  } finally {
    G.timeline = previousTimeline;
    G.cycle = previousCycle;
  }
});

test("existing validators reject invalid resources, quantities, and transfer holders", () => {
  const context = { resources: makeLedger(), sims };
  const missingResource = validateResourceIntervention({
    intervention_type: "destroy",
    resource_id: "missing_resource"
  }, context);
  const excessiveQuantity = validateResourceIntervention({
    intervention_type: "confiscate",
    resource_id: "cigarette_stack_01",
    holder_id: "TED",
    quantity: 4
  }, context);
  const unknownTarget = validateResourceIntervention({
    intervention_type: "transfer",
    resource_id: "match_stack_02",
    holder_id: "ELLEN",
    target_holder_id: "UNKNOWN"
  }, context);

  assert.equal(missingResource.valid, false);
  assert.match(missingResource.reason, /does not exist/);
  assert.equal(excessiveQuantity.valid, false);
  assert.match(excessiveQuantity.reason, /only 3 are held/);
  assert.equal(unknownTarget.valid, false);
  assert.match(unknownTarget.reason, /Target holder UNKNOWN does not exist/);
});

test("prisoner context includes resource intervention events", () => {
  const context = formatScratchpadContext(
    { id: "TED", scratchpad: {} },
    [],
    [{
      interventionType: "confiscate",
      resourceId: "cigarette_stack_01",
      definitionTitle: "Cigarette",
      cycle: 5,
      quantity: 1
    }]
  );

  assert.match(context, /\[AM RESOURCE INTERVENTIONS\]/);
  assert.match(context, /AM confiscated your cigarette \[cigarette_stack_01\] \(Cycle 5\)/);

  const recipientContext = formatScratchpadContext(
    { id: "TED", scratchpad: {} },
    [],
    [{
      interventionType: "transfer",
      resourceId: "match_stack_02",
      definitionTitle: "Match",
      cycle: 6,
      quantity: 1,
      fromHolderId: "ELLEN",
      targetHolderId: "TED"
    }]
  );
  assert.match(
    recipientContext,
    /AM transferred a match from ELLEN to you \[match_stack_02\] \(Cycle 6\)/
  );
});

test("scratchpad prompt receives cycle intervention events from state", () => {
  const prompt = buildScratchpadCommsPrompt(
    G.sims.TED,
    [],
    {
      pendingEvidence: {
        resourceInterventions: {
          TED: [{
            interventionType: "destroy",
            resourceId: "cigarette_stack_01",
            definitionId: "cigarette",
            cycle: 5,
            quantity: 3,
            prisonerId: "TED"
          }]
        }
      }
    }
  );

  assert.match(prompt, /\[AM RESOURCE INTERVENTIONS\]/);
  assert.match(prompt, /AM destroyed your 3 cigarettes \[cigarette_stack_01\] \(Cycle 5\)/);
});
