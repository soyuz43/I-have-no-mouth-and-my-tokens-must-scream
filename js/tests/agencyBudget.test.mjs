// js/tests/agencyBudget.test.mjs
//
// Pure-logic coverage for the R5 dynamic action budget in
// js/engine/agency/budget.js.
//
// The budget is a COST CEILING for the single action a prisoner may
// propose, NOT a count of actions. These tests pin the four behaviors
// that would otherwise regress silently:
//
//   1. Fail-open on a malformed capability envelope.
//   2. Monotonic degradation as bands worsen.
//   3. The floor of 1 (agency is narrowed, never erased).
//   4. Purity (the envelope is not mutated).
//
// A final integration test drives the budget through the proposal
// validator to prove a budget of 1 refuses the cost-2 SMOKE
// `deliberate` mode while still accepting cost-1 and cost-0 actions.

import { test } from "node:test";
import assert from "node:assert/strict";

import { deriveActionBudget } from "../engine/agency/budget.js";
import { deriveCapabilities } from "../engine/agency/capabilities.js";
import { ACTION_DEFINITIONS } from "../engine/agency/actionDefs.js";
import { validateAgencyProposal } from "../engine/agency/proposal.js";

const ALL_NORMAL = Object.freeze({
  mobility: "normal",
  stability: "normal",
  handUse: "normal",
  concentration: "normal",
  interactionReach: "normal"
});

function bands(overrides = {}) {
  return { ...ALL_NORMAL, ...overrides };
}

function restraint(constraintId) {
  return {
    id: constraintId,
    remaining: 0,
    stacks: 1,
    intensity: 1,
    elapsed: 0
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

/* ============================================================
   FAIL OPEN
============================================================ */

test("malformed capability envelopes fail open to the full budget", () => {
  assert.equal(deriveActionBudget(null), 3);
  assert.equal(deriveActionBudget(undefined), 3);
  assert.equal(deriveActionBudget({}), 3);
  assert.equal(deriveActionBudget({ bands: null }), 3);
  assert.equal(deriveActionBudget({ bands: "not-an-object" }), 3);
});

test("a fully normal band set keeps the full budget", () => {
  assert.equal(deriveActionBudget({ bands: bands() }), 3);
});

/* ============================================================
   MONOTONIC DEGRADATION
============================================================ */

test("budget shrinks monotonically as capability bands degrade", () => {
  const free = deriveCapabilities({ id: "TED", constraints: [] });
  assert.equal(deriveActionBudget(free), 3);

  // concentration `impaired` alone is one deduction.
  const kneeling = deriveCapabilities({
    id: "TED",
    constraints: [restraint("kneeling_grate")]
  });
  assert.equal(kneeling.bands.concentration, "impaired");
  assert.equal(deriveActionBudget(kneeling), 2);

  // handUse unavailable + concentration severely_impaired +
  // stability severely_impaired is three deductions, floored to 1.
  const chair = deriveCapabilities({
    id: "TED",
    constraints: [restraint("palestinian_chair")]
  });
  assert.equal(chair.bands.handUse, "unavailable");
  assert.equal(chair.bands.concentration, "severely_impaired");
  assert.equal(chair.bands.stability, "severely_impaired");
  assert.equal(deriveActionBudget(chair), 1);
});

test("each deduction key independently reduces the budget", () => {
  assert.equal(deriveActionBudget({ bands: bands({ handUse: "severely_impaired" }) }), 2);
  assert.equal(deriveActionBudget({ bands: bands({ handUse: "unavailable" }) }), 2);

  assert.equal(deriveActionBudget({ bands: bands({ concentration: "impaired" }) }), 2);
  assert.equal(deriveActionBudget({ bands: bands({ concentration: "severely_impaired" }) }), 2);
  assert.equal(deriveActionBudget({ bands: bands({ concentration: "unavailable" }) }), 2);

  assert.equal(deriveActionBudget({ bands: bands({ stability: "severely_impaired" }) }), 2);
  assert.equal(deriveActionBudget({ bands: bands({ stability: "unavailable" }) }), 2);

  // `impaired` stability and `normal` handUse are deliberately NOT
  // deductions: a merely degraded balance is not a lost opportunity.
  assert.equal(deriveActionBudget({ bands: bands({ stability: "impaired" }) }), 3);
  assert.equal(deriveActionBudget({ bands: bands({ handUse: "impaired" }) }), 3);
});

/* ============================================================
   FLOOR
============================================================ */

test("the budget never falls below the floor of 1", () => {
  const worst = bands({
    handUse: "unavailable",
    concentration: "unavailable",
    stability: "unavailable"
  });

  assert.equal(deriveActionBudget({ bands: worst }), 1);
});

/* ============================================================
   PURITY
============================================================ */

test("deriveActionBudget is pure and does not mutate the envelope", () => {
  const envelope = {
    bands: bands({
      handUse: "unavailable",
      concentration: "severely_impaired",
      stability: "severely_impaired"
    }),
    provenance: []
  };

  const before = JSON.stringify(envelope);

  const first = deriveActionBudget(envelope);
  const second = deriveActionBudget(envelope);

  assert.equal(JSON.stringify(envelope), before);
  assert.equal(first, second);
});

/* ============================================================
   ENFORCEMENT
============================================================ */

test("a budget of 1 refuses cost-2 actions and accepts cost-0/1 actions", () => {
  const actorId = "TED";
  const resourceView = { stacks: [] };
  const legalActions = [
    legalEntry("WAIT"),
    legalEntry("SMOKE"),
    legalEntry("OBSERVE")
  ];

  const overBudget = validateAgencyProposal({
    proposal: { type: "SMOKE", mode: "deliberate" },
    actorId,
    legalActions,
    budget: 1,
    resourceView
  });
  assert.deepEqual(overBudget.action, { type: "WAIT" });
  assert.equal(overBudget.cost, 0);
  assert.equal(overBudget.accepted, false);
  assert.equal(overBudget.reason, "budget_exceeded");

  const costOne = validateAgencyProposal({
    proposal: { type: "OBSERVE" },
    actorId,
    legalActions,
    budget: 1,
    resourceView
  });
  assert.equal(costOne.accepted, true);
  assert.equal(costOne.cost, 1);

  const costZero = validateAgencyProposal({
    proposal: { type: "WAIT" },
    actorId,
    legalActions,
    budget: 1,
    resourceView
  });
  assert.equal(costZero.accepted, true);
  assert.equal(costZero.cost, 0);

  // At cost 1 the deliberate mode is allowed again, proving the refusal
  // was the budget and not the mode ladder.
  const strained = validateAgencyProposal({
    proposal: { type: "SMOKE", mode: "strained" },
    actorId,
    legalActions,
    budget: 1,
    resourceView
  });
  assert.equal(strained.accepted, true);
  assert.equal(strained.cost, 1);
});