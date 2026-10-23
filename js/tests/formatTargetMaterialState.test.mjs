import assert from "node:assert/strict";
import test from "node:test";

import { G } from "../core/state.js";
import { formatTargetMaterialState } from "../prompts/utils/formatTargetMaterialState.js";
import { recordResourceEvent, RESOURCE_EVENT_KINDS } from "../engine/agency/resourceEventLog.js";

function resetState() {
  G.cycle = 10;
  G.resources = { instances: [] };
  G.resourceEvents = [];
  G.resourceEventSequence = { cycle: null, next: 1 };
  G.claimDivergence = {};
}

test("formatTargetMaterialState is concise when target holds nothing", () => {
  resetState();
  const output = formatTargetMaterialState("TED", G);
  assert.equal(output, "Target holds no resources.");
});

test("formatTargetMaterialState returns empty for missing target", () => {
  resetState();
  assert.equal(formatTargetMaterialState(null, G), "");
  assert.equal(formatTargetMaterialState("", G), "");
});

test("formatTargetMaterialState lists concealed and exposed holdings", () => {
  resetState();
  G.resources.instances.push({
    resourceId: "cigarette_stack_01",
    definitionId: "cigarette",
    quantity: 3,
    holderId: "TED",
    accessible: true,
    concealed: true
  });
  G.resources.instances.push({
    resourceId: "match_stack_01",
    definitionId: "match",
    quantity: 1,
    holderId: "TED",
    accessible: true,
    concealed: false
  });
  const output = formatTargetMaterialState("TED", G);
  assert.match(output, /\[TARGET MATERIAL STATE\]/i);
  assert.match(output, /3 cigarettes \(concealed\)/i);
  assert.match(output, /1 match \(exposed\)/i);
});

test("formatTargetMaterialState includes exposure reason from resourceEvents", () => {
  resetState();
  G.resources.instances.push({
    resourceId: "cigarette_stack_01",
    definitionId: "cigarette",
    quantity: 3,
    holderId: "TED",
    accessible: true,
    concealed: false
  });
  recordResourceEvent(G, {
    kind: RESOURCE_EVENT_KINDS.EXPOSURE,
    cycle: 4,
    resourceId: "cigarette_stack_01",
    definitionId: "cigarette",
    quantityBefore: 3,
    quantityAfter: 3,
    fromHolderId: "TED",
    toHolderId: "TED",
    actorId: "ENGINE",
    cause: {
      phase: "agency_phase",
      action: "EXPOSED",
      source: "capability_degradation"
    }
  });
  const output = formatTargetMaterialState("TED", G);
  assert.match(output, /Cycle 4/i);
  assert.match(output, /EXPOSED/i);
  assert.match(output, /capability_degradation/i);
});

test("formatTargetMaterialState excludes exposures of other prisoners", () => {
  resetState();
  recordResourceEvent(G, {
    kind: RESOURCE_EVENT_KINDS.EXPOSURE,
    cycle: 4,
    resourceId: "cigarette_stack_01",
    definitionId: "cigarette",
    quantityBefore: 3,
    quantityAfter: 3,
    fromHolderId: "BENNY",
    toHolderId: "BENNY",
    actorId: "ENGINE",
    cause: { phase: "agency_phase", action: "EXPOSED", source: "capability_degradation" }
  });
  const output = formatTargetMaterialState("TED", G);
  assert.match(output, /Target holds no resources/i);
});

test("formatTargetMaterialState includes belief divergence", () => {
  resetState();
  G.claimDivergence = {
    TED: {
      cigarette: {
        definitionId: "cigarette",
        claimed: 3,
        objective: 2,
        delta: -1,
        onsetCycle: 4,
        claimedResourceId: null
      }
    }
  };
  const output = formatTargetMaterialState("TED", G);
  assert.match(output, /Belief divergence/i);
  assert.match(output, /believes they hold 3 cigarettes \(reality: 2\)/i);
});

test("formatTargetMaterialState combines holdings, exposure, and divergence", () => {
  resetState();
  G.resources.instances.push({
    resourceId: "cigarette_stack_01",
    definitionId: "cigarette",
    quantity: 2,
    holderId: "TED",
    accessible: true,
    concealed: true
  });
  recordResourceEvent(G, {
    kind: RESOURCE_EVENT_KINDS.EXPOSURE,
    cycle: 4,
    resourceId: "cigarette_stack_01",
    definitionId: "cigarette",
    quantityBefore: 2,
    quantityAfter: 2,
    fromHolderId: "TED",
    toHolderId: "TED",
    actorId: "ENGINE",
    cause: { phase: "agency_phase", action: "EXPOSED", source: "capability_degradation" }
  });
  G.claimDivergence = {
    TED: {
      cigarette: {
        definitionId: "cigarette",
        claimed: 3,
        objective: 2,
        delta: -1,
        onsetCycle: null,
        claimedResourceId: null
      }
    }
  };
  const output = formatTargetMaterialState("TED", G);
  assert.match(output, /\[TARGET MATERIAL STATE\]/i);
  assert.match(output, /2 cigarettes \(concealed\)/i);
  assert.match(output, /Cycle 4/i);
  assert.match(output, /Belief divergence/i);
});


