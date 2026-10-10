import { test } from "node:test";
import assert from "node:assert/strict";

import { SIM_IDS } from "../core/constants.js";
import { ACTION_DEFINITIONS } from "../engine/agency/actionDefs.js";
import { deriveActionBudget } from "../engine/agency/budget.js";
import { commitAgencyResolution } from "../engine/agency/commit.js";
import {
  getAgencyEventsForReview
} from "../engine/agency/events.js";
import {
  createAgencySnapshot,
  resolveAgencyActions
} from "../engine/agency/resolve.js";
import {
  collectAgencyProposal,
  validateAgencyProposal
} from "../engine/agency/proposal.js";
import { createAgencyState } from "../engine/agency/state/createAgencyState.js";
import {
  buildResourceView
} from "../engine/agency/resourceLedger.js";
import { buildAgencyProposalPrompt } from "../prompts/agencyProposal.js";
import { buildScratchpadCommsPrompt } from "../prompts/scratchpadComms.js";
import {
  Exporter,
  EXPORT_SCHEMA_VERSION
} from "../utils/exporter/state.js";
import {
  recordAgencyEvents
} from "../utils/exporter/streams/agencyEvents.js";

function resource(resourceId, definitionId, quantity, holderId) {
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

function createGame(instances, cycle = 7) {
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
      scratchpad: { initialized: true }
    }])
  );

  return {
    cycle,
    sims,
    resources: { instances },
    agency: createAgencyState()
  };
}

function legalEntry(type) {
  const definition = ACTION_DEFINITIONS[type];
  return {
    type,
    title: definition.title,
    cost: definition.baseCost,
    availableModes: Object.keys(definition.executionModes ?? {})
  };
}

function transferProposal(game, actorId, resourceId, targetId) {
  return validateAgencyProposal({
    proposal: { type: "TRANSFER", resourceId, targetId },
    actorId,
    legalActions: [legalEntry("TRANSFER")],
    budget: 3,
    resourceView: buildResourceView(game.resources, actorId)
  });
}

test("budget and proposal validation enforce one legal in-budget action", async () => {
  assert.equal(deriveActionBudget({ id: "TED" }), 3);

  const sim = {
    id: "TED",
    hope: 54,
    sanity: 80,
    suffering: 22,
    drives: { relief: 0.7 },
    anchors: ["routine"],
    beliefs: { match: "useful" },
    scratchpad: { initialized: true }
  };
  const legalActions = [legalEntry("WAIT"), legalEntry("SMOKE")];
  const prompt = buildAgencyProposalPrompt(sim, legalActions, 3, {
    stacks: []
  });

  assert.match(prompt, /Remaining action budget: 3/);
  assert.match(prompt, /"suffering": 22/);
  assert.match(prompt, /"type": "SMOKE"/);

  const resourceView = { stacks: [] };
  const overBudget = validateAgencyProposal({
    proposal: { type: "SMOKE", mode: "deliberate" },
    actorId: "TED",
    legalActions,
    budget: 1,
    resourceView
  });
  assert.deepEqual(overBudget.action, { type: "WAIT" });
  assert.equal(overBudget.cost, 0);
  assert.equal(overBudget.reason, "budget_exceeded");

  const notLegal = validateAgencyProposal({
    proposal: { type: "DESTROY" },
    actorId: "TED",
    legalActions,
    budget: 3,
    resourceView
  });
  assert.deepEqual(notLegal.action, { type: "WAIT" });
  assert.equal(notLegal.cost, 0);
  assert.equal(notLegal.reason, "action_not_legal");

  const extraNarration = validateAgencyProposal({
    proposal: { type: "WAIT", explanation: "I smoke anyway" },
    actorId: "TED",
    legalActions,
    budget: 3,
    resourceView
  });
  assert.deepEqual(extraNarration.action, { type: "WAIT" });
  assert.equal(extraNarration.accepted, false);
  assert.equal(extraNarration.reason, "invalid_proposal_shape");

  const modelFallback = await collectAgencyProposal(sim, {
    budget: 3,
    legalActions,
    resourceView,
    modelCall: async () => JSON.stringify({ type: "TELEPORT" })
  });
  assert.deepEqual(modelFallback.action, { type: "WAIT" });
  assert.equal(modelFallback.cost, 0);
  assert.equal(modelFallback.reason, "action_not_legal");
});

test("simultaneous resource contention uses stable actor priority", () => {
  const sharedId = "shared-collision-cigarette";
  const game = createGame([
    resource(sharedId, "cigarette", 1, "TED"),
    resource(sharedId, "cigarette", 1, "ELLEN"),
    resource("ted-match", "match", 1, "TED"),
    resource("ellen-match", "match", 1, "ELLEN")
  ]);
  const snapshot = createAgencySnapshot(game);
  const proposals = ["TED", "ELLEN"].map((actorId) => ({
    actorId,
    action: { type: "SMOKE", mode: "strained" },
    cost: 1,
    accepted: true
  }));

  const forward = resolveAgencyActions({
    proposals,
    snapshot,
    cycle: game.cycle
  });
  const reverse = resolveAgencyActions({
    proposals: [...proposals].reverse(),
    snapshot,
    cycle: game.cycle
  });

  assert.deepEqual(reverse, forward);
  assert.deepEqual(
    forward.map(({ actorId, status, reason }) => ({
      actorId,
      status,
      reason
    })),
    [
      { actorId: "ELLEN", status: "success", reason: null },
      { actorId: "TED", status: "blocked", reason: "conflict" }
    ]
  );
});

test("reciprocal transfers both resolve from the start-of-cycle snapshot", () => {
  const game = createGame([
    resource("cigarette-1", "cigarette", 1, "TED"),
    resource("match-1", "match", 1, "ELLEN")
  ]);
  const snapshot = createAgencySnapshot(game);
  const proposals = [
    transferProposal(game, "TED", "cigarette-1", "ELLEN"),
    transferProposal(game, "ELLEN", "match-1", "TED")
  ];
  const forward = resolveAgencyActions({
    proposals,
    snapshot,
    cycle: game.cycle
  });
  const reverse = resolveAgencyActions({
    proposals: [...proposals].reverse(),
    snapshot,
    cycle: game.cycle
  });

  assert.deepEqual(reverse, forward);
  assert.ok(forward.every((resolution) => resolution.status === "success"));
  assert.deepEqual(
    snapshot.resources.instances.map(({ resourceId, holderId }) => ({
      resourceId,
      holderId
    })),
    [
      { resourceId: "cigarette-1", holderId: "TED" },
      { resourceId: "match-1", holderId: "ELLEN" }
    ]
  );

  commitAgencyResolution(game, forward);
  assert.equal(
    game.resources.instances.find((item) => item.resourceId === "cigarette-1").holderId,
    "ELLEN"
  );
  assert.equal(
    game.resources.instances.find((item) => item.resourceId === "match-1").holderId,
    "TED"
  );
});

test("SMOKE consumes cigarette and match and applies only mutable effects", () => {
  const game = createGame([
    resource("cigarette-1", "cigarette", 1, "TED"),
    resource("match-1", "match", 1, "TED")
  ], 9);
  const proposal = validateAgencyProposal({
    proposal: { type: "SMOKE", mode: "strained" },
    actorId: "TED",
    legalActions: [legalEntry("SMOKE")],
    budget: 3,
    resourceView: buildResourceView(game.resources, "TED")
  });
  const resolutions = resolveAgencyActions({
    proposals: [proposal],
    snapshot: createAgencySnapshot(game),
    cycle: game.cycle
  });

  commitAgencyResolution(game, resolutions);

  assert.equal(game.resources.instances[0].quantity, 0);
  assert.equal(game.resources.instances[1].quantity, 0);
  assert.equal(game.sims.TED.suffering, 8);
  assert.equal(game.sims.TED.stability, 0.4);
});

test("commit creates canonical events and exporter records them separately", () => {
  const game = createGame([
    resource("cigarette-1", "cigarette", 1, "TED"),
    resource("match-1", "match", 1, "TED")
  ], 11);
  const proposal = validateAgencyProposal({
    proposal: { type: "SMOKE", mode: "strained" },
    actorId: "TED",
    legalActions: [legalEntry("SMOKE")],
    budget: 3,
    resourceView: buildResourceView(game.resources, "TED")
  });
  const resolutions = resolveAgencyActions({
    proposals: [proposal],
    snapshot: createAgencySnapshot(game),
    cycle: game.cycle
  });
  const priorRunId = Exporter.runId;
  const priorBuffer = Exporter.buffers.agency_events;

  try {
    Exporter.runId = "agency-test";
    Exporter.buffers.agency_events = [];
    commitAgencyResolution(game, resolutions);

    const [event] = game.agency.events;
    assert.deepEqual(event, {
      eventId: "agency:11:1",
      cycle: 11,
      actorId: "TED",
      actionType: "SMOKE",
      status: "success",
      provenance: {
        source: "agency_resolver",
        proposalAccepted: true,
        requestedType: "SMOKE",
        validationReason: null,
        resolutionReason: null,
        resourceIds: ["cigarette-1", "match-1"],
        targetId: null
      }
    });
    assert.equal(game.agency.nextActionSequence, 2);

    recordAgencyEvents(game, 11);
    recordAgencyEvents(game, 12);
    assert.equal(Exporter.buffers.agency_events.length, 1);
    assert.deepEqual(Exporter.buffers.agency_events[0], {
      schema_version: EXPORT_SCHEMA_VERSION,
      run_id: "agency-test",
      cycle: 11,
      cycle_id: "agency-test::cycle:11",
      recorded_at: Exporter.buffers.agency_events[0].recorded_at,
      event_id: event.eventId,
      actor_id: "TED",
      action_type: "SMOKE",
      status: "success",
      provenance: event.provenance
    });
  } finally {
    Exporter.runId = priorRunId;
    Exporter.buffers.agency_events = priorBuffer;
  }
});

test("Scratchpad review receives only prior-cycle actor or recipient events", () => {
  const priorCycleTransfer = {
    eventId: "agency:4:1",
    cycle: 4,
    actorId: "TED",
    actionType: "TRANSFER",
    status: "success",
    provenance: { targetId: "ELLEN", resourceIds: ["cigarette-1"] }
  };
  const sameCycle = {
    ...priorCycleTransfer,
    eventId: "agency:5:1",
    cycle: 5,
    actorId: "BENNY"
  };
  const events = [priorCycleTransfer, sameCycle];

  assert.deepEqual(
    getAgencyEventsForReview(events, "ELLEN", 5),
    [priorCycleTransfer]
  );
  assert.deepEqual(getAgencyEventsForReview(events, "ELLEN", 4), []);

  const prompt = buildScratchpadCommsPrompt(
    { id: "ELLEN", scratchpad: { initialized: true } },
    [],
    {},
    getAgencyEventsForReview(events, "ELLEN", 5)
  );
  assert.match(prompt, /AUTHORITATIVE AGENCY OUTCOMES FROM THE PREVIOUS CYCLE/);
  assert.match(prompt, /"actionType":"TRANSFER"/);
  assert.match(prompt, /"targetId":"ELLEN"/);
});
