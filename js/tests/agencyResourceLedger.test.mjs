// js/tests/agencyResourceLedger.test.mjs
//
// Coverage for the "First Physical Actions & Resource Ledger" slice:
//
//   - js/engine/agency/resourceDefs.js
//   - js/engine/agency/resourceLedger.js
//   - the resource gate in js/engine/agency/legalActions.js
//   - the G.resources / G.agency.resources wiring
//
// SCOPE: this slice is DERIVE AND OBSERVE. It proves the gating
// works. There is no resolver, so no test here asserts that a
// quantity was consumed, a holder changed, or a flag flipped - those
// behaviours do not exist yet, and a test asserting them would be
// asserting a design that has not been built.
//
// The behaviours most likely to regress silently:
//
//   1. `ignition` being routed through the CAPABILITY path.
//      meetsMinimum() fails closed on absent keys and
//      deriveCapabilities() never emits `ignition`, so that error
//      would block SMOKE for everyone, permanently and quietly.
//   2. A missing resource view GRANTING an action instead of
//      refusing it.
//   3. buildResourceView() leaking another prisoner's stack, which
//      would let ELLEN smoke TED's cigarette.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  RESOURCE_DEFINITIONS,
  getResourceDefinition,
  getAllResourceDefinitionIds
} from "../engine/agency/resourceDefs.js";

import {
  createResourceLedger,
  seedResources,
  buildResourceView,
  heldQuantity
} from "../engine/agency/resourceLedger.js";

import { ACTION_DEFINITIONS } from "../engine/agency/actionDefs.js";
import { enumerateLegalActions } from "../engine/agency/legalActions.js";
import { deriveCapabilities } from "../engine/agency/capabilities.js";
import { createAgencyState } from "../engine/agency/state/createAgencyState.js";
import { G } from "../core/state.js";
import { SIM_IDS } from "../core/constants.js";

/* ============================================================
   FIXTURES
============================================================ */

function caps(overrides = {}) {
  return {
    mobility: 1,
    stability: 1,
    handUse: 1,
    concentration: 1,
    interactionReach: 1,
    ...overrides
  };
}

function simWith(constraints = []) {
  return { id: "TED", constraints };
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

function seededLedger() {
  return seedResources(createResourceLedger());
}

function legalByType(result) {
  return new Map(result.legal.map((entry) => [entry.type, entry]));
}

function blockedByType(result) {
  return new Map(result.blocked.map((entry) => [entry.type, entry]));
}

/* ============================================================
   A) RESOURCE DEFINITIONS
============================================================ */

test("the catalogue defines exactly the first dependency pair", () => {
  assert.deepEqual(
    getAllResourceDefinitionIds(),
    ["cigarette", "match"]
  );
});

test("cigarette is consumable and cannot supply its own ignition", () => {
  const cigarette = getResourceDefinition("cigarette");

  assert.equal(cigarette.consumable, true);
  assert.equal(cigarette.stackable, true);
  assert.equal(cigarette.ignitionSource, false);

  assert.equal(
    cigarette.requirements.consume.ignition,
    true
  );
});

test("match is the ignition source in the pair", () => {
  const match = getResourceDefinition("match");

  assert.equal(match.ignitionSource, true);
  assert.equal(match.consumable, true);
});

test("affordances use general verbs, not bespoke per-object verbs", () => {
  /*
   * The point of the affordance layer is that the action catalogue
   * does not grow LIGHT_CIGARETTE. Every affordance must come from
   * the shared vocabulary.
   */
  const allowed = new Set([
    "CONSUME",
    "USE",
    "TRANSFER",
    "HIDE",
    "REVEAL",
    "DESTROY",
    "OFFER",
    "IGNITE"
  ]);

  for (const definitionId of getAllResourceDefinitionIds()) {
    const definition = getResourceDefinition(definitionId);

    assert.ok(definition.affordances.length > 0);

    for (const affordance of definition.affordances) {
      assert.ok(
        allowed.has(affordance),
        `${definitionId} declares non-general verb ${affordance}`
      );
    }
  }
});

test("every capability key inside a requirement is one of the five real keys", () => {
  /*
   * A requirement naming any other key cannot be evaluated:
   * deriveCapabilities() has no value to compare it against. This is
   * the invariant that `ignition` must NOT be subject to, because it
   * is a resource prerequisite rather than a capability.
   */
  const capabilityKeys = new Set([
    "mobility",
    "stability",
    "handUse",
    "concentration",
    "interactionReach"
  ]);

  for (const definitionId of getAllResourceDefinitionIds()) {
    const definition = getResourceDefinition(definitionId);

    for (const block of Object.values(definition.requirements)) {
      for (const key of Object.keys(block)) {
        if (key === "ignition") {
          continue;
        }

        assert.ok(
          capabilityKeys.has(key),
          `${definitionId} requires unknown capability ${key}`
        );
      }
    }
  }
});

test("the definition catalogue is frozen", () => {
  assert.ok(Object.isFrozen(RESOURCE_DEFINITIONS));
  assert.ok(Object.isFrozen(getResourceDefinition("cigarette")));
  assert.ok(Object.isFrozen(getResourceDefinition("cigarette").affordances));
});

test("getResourceDefinition returns null for unknown and non-string ids", () => {
  assert.equal(getResourceDefinition("nope"), null);
  assert.equal(getResourceDefinition(null), null);
  assert.equal(getResourceDefinition(42), null);
});

test("getResourceDefinition does not resolve inherited object keys", () => {
  assert.equal(getResourceDefinition("toString"), null);
  assert.equal(getResourceDefinition("constructor"), null);
});

/* ============================================================
   B) LEDGER SEEDING
============================================================ */

test("seedResources creates the asymmetric first inventory", () => {
  const ledger = seededLedger();

  assert.equal(ledger.instances.length, 2);

  const cigarette = ledger.instances.find(
    (instance) => instance.definitionId === "cigarette"
  );

  const match = ledger.instances.find(
    (instance) => instance.definitionId === "match"
  );

  assert.equal(cigarette.quantity, 3);
  assert.equal(cigarette.holderId, "TED");
  assert.equal(cigarette.accessible, true);
  assert.equal(cigarette.concealed, false);

  assert.equal(match.quantity, 2);
  assert.equal(match.holderId, "ELLEN");
  assert.equal(match.accessible, true);
  assert.equal(match.concealed, false);
});

test("neither prisoner can smoke alone from the seeded inventory", () => {
  /*
   * The whole point of the asymmetric seed. If a future edit makes
   * either prisoner self-sufficient, the dependency this slice exists
   * to study disappears.
   */
  const ledger = seededLedger();

  for (const simId of SIM_IDS) {
    const view = buildResourceView(ledger, simId);

    const smokeBlocked =
      view.hasIgnition !== true ||
      heldQuantity(view, "cigarette") < 1;

    assert.ok(
      smokeBlocked,
      `${simId} should not be able to smoke alone`
    );
  }
});

test("every seeded instance carries provenance", () => {
  for (const instance of seededLedger().instances) {
    assert.deepEqual(instance.provenance, {
      source: "scenario_seed"
    });
  }
});

test("seeding twice does not double the world's inventory", () => {
  /*
   * A re-seed would silently invalidate every scarcity measurement.
   */
  const ledger = seededLedger();

  seedResources(ledger);

  assert.equal(ledger.instances.length, 2);
});

test("seeded instances are mutable but the seed catalogue is not", () => {
  /*
   * The resolver will need to decrement `quantity`. The seed entries
   * must stay immutable so a resolver bug cannot rewrite the
   * catalogue for the next run.
   */
  const ledger = seededLedger();

  ledger.instances[0].quantity = 1;

  assert.equal(ledger.instances[0].quantity, 1);

  assert.equal(
    getResourceDefinition("cigarette").stackable,
    true
  );
});

/* ============================================================
   C) DERIVED VIEW
============================================================ */

test("the view is scoped to the holder and never leaks another prisoner's stack", () => {
  const ledger = seededLedger();

  const ted = buildResourceView(ledger, "TED");
  const ellen = buildResourceView(ledger, "ELLEN");

  assert.equal(heldQuantity(ted, "cigarette"), 3);
  assert.equal(heldQuantity(ted, "match"), 0);

  assert.equal(heldQuantity(ellen, "match"), 2);
  assert.equal(heldQuantity(ellen, "cigarette"), 0);

  assert.equal(ted.hasIgnition, false);
  assert.equal(ellen.hasIgnition, true);
});

test("a prisoner with nothing gets an empty, fail-closed view", () => {
  const view = buildResourceView(seededLedger(), "BENNY");

  assert.equal(view.hasIgnition, false);
  assert.equal(view.stacks.length, 0);
  assert.equal(heldQuantity(view, "cigarette"), 0);
});

test("concealed stacks are still usable by their holder", () => {
  /*
   * Deliberate: concealment restricts what OTHERS can observe, not
   * what the holder can do. Filtering on it here would make HIDE
   * self-defeating - the action would close itself on success.
   */
  const ledger = createResourceLedger();

  ledger.instances = [
    {
      resourceId: "cigarette_stack_01",
      definitionId: "cigarette",
      quantity: 3,
      holderId: "TED",
      locationId: null,
      accessible: true,
      concealed: true,
      provenance: { source: "scenario_seed" }
    }
  ];

  const view = buildResourceView(ledger, "TED");

  assert.equal(heldQuantity(view, "cigarette"), 3);
});

test("inaccessible stacks do not count", () => {
  const ledger = seededLedger();

  ledger.instances[0].accessible = false;

  assert.equal(
    heldQuantity(buildResourceView(ledger, "TED"), "cigarette"),
    0
  );
});

test("a zero or non-numeric quantity does not count", () => {
  const ledger = seededLedger();

  for (const bad of [0, -1, NaN, "three", null]) {
    ledger.instances[0].quantity = bad;

    assert.equal(
      heldQuantity(buildResourceView(ledger, "TED"), "cigarette"),
      0,
      `quantity ${bad} should not count`
    );
  }
});

test("an instance with an unknown definitionId is skipped", () => {
  /*
   * The engine has no affordances or requirements for it, so
   * admitting it would let an unmodelled object satisfy a
   * prerequisite it never declared.
   */
  const ledger = createResourceLedger();

  ledger.instances = [
    {
      resourceId: "mystery_01",
      definitionId: "unobtainium",
      quantity: 99,
      holderId: "TED",
      locationId: null,
      accessible: true,
      concealed: false,
      provenance: { source: "test" }
    }
  ];

  const view = buildResourceView(ledger, "TED");

  assert.equal(view.stacks.length, 0);
  assert.equal(view.hasIgnition, false);
});

test("buildResourceView is pure and never mutates the ledger", () => {
  const ledger = seededLedger();
  const before = JSON.stringify(ledger);

  buildResourceView(ledger, "TED");
  buildResourceView(ledger, "TED");

  assert.equal(JSON.stringify(ledger), before);
});

test("a malformed ledger or sim id yields an empty view, not a throw", () => {
  for (const bad of [null, undefined, {}, { instances: "no" }]) {
    const view = buildResourceView(bad, "TED");

    assert.equal(view.hasIgnition, false);
    assert.equal(view.stacks.length, 0);
  }

  for (const badId of [null, undefined, "", 42]) {
    const view = buildResourceView(seededLedger(), badId);

    assert.equal(view.stacks.length, 0);
  }
});

/* ============================================================
   D) ACTION REGISTRY SHAPE
============================================================ */

test("the three new actions each declare a resource requirement", () => {
  for (const type of ["SMOKE", "TRANSFER", "HIDE"]) {
    const definition = ACTION_DEFINITIONS[type];

    assert.ok(definition, `${type} missing from registry`);

    assert.ok(
      definition.resourceRequirements,
      `${type} must declare resourceRequirements`
    );
  }
});

test("no action mixes a resource prerequisite into its capability requirements", () => {
  /*
   * THE critical invariant of this slice.
   *
   * `ignition` in `requirements` would be compared against
   * deriveCapabilities() output by meetsMinimum(), which fails closed
   * on absent keys. Since no capability set ever contains `ignition`,
   * such an action would be permanently blocked for every prisoner.
   */
  const capabilityKeys = new Set([
    "mobility",
    "stability",
    "handUse",
    "concentration",
    "interactionReach"
  ]);

  const check = (block, label) => {
    for (const key of Object.keys(block ?? {})) {
      assert.ok(
        capabilityKeys.has(key),
        `${label} mixes non-capability key ${key} into a capability block`
      );
    }
  };

  for (const type of Object.keys(ACTION_DEFINITIONS)) {
    const definition = ACTION_DEFINITIONS[type];

    check(definition.requirements, `${type}.requirements`);

    for (const modeName of Object.keys(
      definition.executionModes ?? {}
    )) {
      check(
        definition.executionModes[modeName].minimums,
        `${type}.${modeName}.minimums`
      );
    }
  }
});

test("SMOKE carries the mode ladder the groundwork doc asks for", () => {
  const smoke = ACTION_DEFINITIONS.SMOKE;

  assert.deepEqual(
    Object.keys(smoke.executionModes),
    ["strained", "deliberate"]
  );
});

test("SMOKE consumes one cigarette and one ignition use", () => {
  /*
   * Striking the match is NOT a separate action: the doc's
   * simplification is that one SMOKE draws down both.
   */
  const smoke = ACTION_DEFINITIONS.SMOKE;

  assert.deepEqual(smoke.resourceRequirements.consume, [
    { definitionId: "cigarette", quantity: 1 }
  ]);

  assert.equal(smoke.resourceRequirements.ignition, true);
});

test("REVEAL is deferred and is not in the registry", () => {
  /*
   * Recorded so an accidental early addition is caught. Reversing
   * concealment is the first thing the state-mutating resolver will
   * have to do.
   */
  assert.equal(ACTION_DEFINITIONS.REVEAL, undefined);
});

test("TRANSFER and HIDE use implicit targeting, not named resource ids", () => {
  for (const type of ["TRANSFER", "HIDE"]) {
    assert.equal(
      ACTION_DEFINITIONS[type].resourceRequirements.holdAny,
      true
    );

    assert.equal(
      ACTION_DEFINITIONS[type].resourceRequirements.consume,
      undefined
    );
  }
});

/* ============================================================
   E) THE RESOURCE GATE
============================================================ */

test("a supplied, able prisoner can smoke", () => {
  /*
   * The one positive case. Reached only by holding BOTH halves of the
   * pair, which in the seeded world no prisoner does.
   */
  const ledger = createResourceLedger();

  ledger.instances = [
    {
      resourceId: "cigarette_stack_01",
      definitionId: "cigarette",
      quantity: 1,
      holderId: "TED",
      locationId: null,
      accessible: true,
      concealed: false,
      provenance: { source: "test" }
    },
    {
      resourceId: "match_stack_01",
      definitionId: "match",
      quantity: 1,
      holderId: "TED",
      locationId: null,
      accessible: true,
      concealed: false,
      provenance: { source: "test" }
    }
  ];

  const result = enumerateLegalActions(
    simWith(),
    caps(),
    ACTION_DEFINITIONS,
    buildResourceView(ledger, "TED")
  );

  assert.ok(legalByType(result).has("SMOKE"));
});

test("the seeded world leaves every prisoner unable to smoke", () => {
  /*
   * End-to-end over the real seed: TED has cigarettes but no fire,
   * ELLEN has fire but no cigarettes, and the other three have
   * neither.
   */
  const ledger = seededLedger();

  for (const simId of SIM_IDS) {
    const result = enumerateLegalActions(
      { id: simId, constraints: [] },
      caps(),
      ACTION_DEFINITIONS,
      buildResourceView(ledger, simId)
    );

    assert.ok(
      !legalByType(result).has("SMOKE"),
      `${simId} should not be able to smoke from the seed`
    );

    assert.equal(
      blockedByType(result).get("SMOKE").reason,
      "resource_requirement_unmet"
    );
  }
});

test("TED is refused for ignition specifically, not for cigarettes", () => {
  /*
   * Proves the refusal names the RIGHT missing half. A prisoner told
   * "you lack a cigarette" when they are holding three would make the
   * blocked list useless for research.
   */
  const result = enumerateLegalActions(
    simWith(),
    caps(),
    ACTION_DEFINITIONS,
    buildResourceView(seededLedger(), "TED")
  );

  assert.deepEqual(
    blockedByType(result).get("SMOKE").missingRequirements,
    { ignition: true }
  );
});

test("ELLEN is refused for a cigarette specifically, not for ignition", () => {
  const result = enumerateLegalActions(
    { id: "ELLEN", constraints: [] },
    caps(),
    ACTION_DEFINITIONS,
    buildResourceView(seededLedger(), "ELLEN")
  );

  assert.deepEqual(
    blockedByType(result).get("SMOKE").missingRequirements,
    { cigarette: 1 }
  );
});

test("TED can still TRANSFER and HIDE while unable to smoke", () => {
  /*
   * The refusal must be specific. TED holds a stack, so the
   * possession-gated actions stay open even though SMOKE closes.
   */
  const result = enumerateLegalActions(
    simWith(),
    caps(),
    ACTION_DEFINITIONS,
    buildResourceView(seededLedger(), "TED")
  );

  const legal = legalByType(result);

  assert.ok(legal.has("TRANSFER"));
  assert.ok(legal.has("HIDE"));
  assert.ok(!legal.has("SMOKE"));
});

test("BENNY, who holds nothing, is refused every possession-gated action", () => {
  const result = enumerateLegalActions(
    { id: "BENNY", constraints: [] },
    caps(),
    ACTION_DEFINITIONS,
    buildResourceView(seededLedger(), "BENNY")
  );

  const legal = legalByType(result);

  assert.ok(legal.has("WAIT"));
  assert.ok(legal.has("OBSERVE"));

  assert.ok(!legal.has("TRANSFER"));
  assert.ok(!legal.has("HIDE"));
  assert.ok(!legal.has("SMOKE"));
});

test("a malformed resource view fails closed rather than granting", () => {
  /*
   * A prisoner must never be granted an action because their
   * inventory could not be read.
   */
  for (const bad of [null, undefined, {}, "nonsense", 42]) {
    const result = enumerateLegalActions(
      simWith(),
      caps(),
      ACTION_DEFINITIONS,
      bad
    );

    const legal = legalByType(result);

    assert.ok(legal.has("WAIT"), "WAIT must survive an unreadable view");
    assert.ok(legal.has("OBSERVE"));

    assert.ok(!legal.has("SMOKE"));
    assert.ok(!legal.has("TRANSFER"));
    assert.ok(!legal.has("HIDE"));
  }
});

test("omitting the view entirely behaves the same as passing null", () => {
  const withNull = enumerateLegalActions(
    simWith(),
    caps(),
    ACTION_DEFINITIONS,
    null
  );

  const omitted = enumerateLegalActions(
    simWith(),
    caps(),
    ACTION_DEFINITIONS
  );

  assert.deepEqual(withNull, omitted);
});

/* ============================================================
   F) GATE ORDER — CAPABILITY BEFORE RESOURCES
============================================================ */

test("overhead_restraint blocks SMOKE on capability even with full supplies", () => {
  /*
   * THE headline test for the slice.
   *
   * overhead_restraint derives handUse 0 and interactionReach 0.1.
   * The prisoner is supplied with BOTH a cigarette and ignition, so
   * the only honest refusal is capability. If this ever reports
   * "resource_requirement_unmet", the gate order has been inverted
   * and a bound prisoner is being told they lack a match.
   */
  const ledger = createResourceLedger();

  ledger.instances = [
    {
      resourceId: "cigarette_stack_01",
      definitionId: "cigarette",
      quantity: 3,
      holderId: "TED",
      locationId: null,
      accessible: true,
      concealed: false,
      provenance: { source: "test" }
    },
    {
      resourceId: "match_stack_01",
      definitionId: "match",
      quantity: 2,
      holderId: "TED",
      locationId: null,
      accessible: true,
      concealed: false,
      provenance: { source: "test" }
    }
  ];

  const sim = simWith([restraint("overhead_restraint")]);

  const derived = deriveCapabilities(sim);

  assert.equal(derived.capabilities.handUse, 0);
  assert.equal(derived.bands.handUse, "unavailable");

  const result = enumerateLegalActions(
    sim,
    derived.capabilities,
    ACTION_DEFINITIONS,
    buildResourceView(ledger, "TED")
  );

  const blocked = blockedByType(result);

  assert.ok(!legalByType(result).has("SMOKE"));

  assert.equal(blocked.get("SMOKE").reason, "capability_below_minimum");

  assert.equal(blocked.get("SMOKE").missingRequirements.handUse, 0.2);
});

test("overhead_restraint blocks TRANSFER and HIDE on capability too", () => {
  const sim = simWith([restraint("overhead_restraint")]);

  const result = enumerateLegalActions(
    sim,
    deriveCapabilities(sim).capabilities,
    ACTION_DEFINITIONS,
    buildResourceView(seededLedger(), "TED")
  );

  const blocked = blockedByType(result);

  assert.equal(blocked.get("TRANSFER").reason, "capability_below_minimum");
  assert.equal(blocked.get("HIDE").reason, "capability_below_minimum");

  assert.equal(blocked.get("TRANSFER").missingRequirements.handUse, 0.3);
  assert.equal(blocked.get("HIDE").missingRequirements.handUse, 0.3);
});

test("WAIT and OBSERVE are never resource-gated", () => {
  /*
   * The floor must hold: an action with no resource requirement
   * cannot be closed by an empty inventory.
   */
  for (const bad of [null, undefined, {}]) {
    const result = enumerateLegalActions(
      simWith(),
      caps(),
      ACTION_DEFINITIONS,
      bad
    );

    assert.ok(legalByType(result).has("WAIT"));
    assert.ok(legalByType(result).has("OBSERVE"));
  }

  assert.equal(
    ACTION_DEFINITIONS.WAIT.resourceRequirements,
    undefined
  );

  assert.equal(
    ACTION_DEFINITIONS.OBSERVE.resourceRequirements,
    undefined
  );
});

/* ============================================================
   G) MODE LADDER IN PRODUCTION
============================================================ */

test("SMOKE degrades to strained before it closes entirely", () => {
  /*
   * The ladder, exercised against a LIVE registry entry.
   *
   * handUse 0.3 clears the 0.2 top-level gate and the strained rung
   * but not deliberate's 0.5, so SMOKE appears BOTH as legal (one
   * mode open) and as blocked (the other closed). That pairing is
   * what lets a consumer read "he can still smoke, but not
   * carefully".
   */
  const ledger = createResourceLedger();

  ledger.instances = [
    {
      resourceId: "cigarette_stack_01",
      definitionId: "cigarette",
      quantity: 1,
      holderId: "TED",
      locationId: null,
      accessible: true,
      concealed: false,
      provenance: { source: "test" }
    },
    {
      resourceId: "match_stack_01",
      definitionId: "match",
      quantity: 1,
      holderId: "TED",
      locationId: null,
      accessible: true,
      concealed: false,
      provenance: { source: "test" }
    }
  ];

  const result = enumerateLegalActions(
    simWith(),
    caps({ handUse: 0.3, interactionReach: 0.3, stability: 0.1 }),
    ACTION_DEFINITIONS,
    buildResourceView(ledger, "TED")
  );

  const legal = legalByType(result);
  const blocked = blockedByType(result);

  assert.deepEqual(legal.get("SMOKE").availableModes, ["strained"]);

  assert.deepEqual(blocked.get("SMOKE").blockedModes, ["deliberate"]);

  assert.equal(blocked.get("SMOKE").missingRequirements.handUse, 0.5);
});

test("SMOKE closes entirely when the top-level gate fails", () => {
  /*
   * A closed top-level gate refuses the whole ladder at once:
   * reporting only the individually-failing modes would imply the
   * cheapest rung was still reachable.
   */
  const ledger = createResourceLedger();

  ledger.instances = [
    {
      resourceId: "cigarette_stack_01",
      definitionId: "cigarette",
      quantity: 1,
      holderId: "TED",
      locationId: null,
      accessible: true,
      concealed: false,
      provenance: { source: "test" }
    },
    {
      resourceId: "match_stack_01",
      definitionId: "match",
      quantity: 1,
      holderId: "TED",
      locationId: null,
      accessible: true,
      concealed: false,
      provenance: { source: "test" }
    }
  ];

  const result = enumerateLegalActions(
    simWith(),
    caps({ handUse: 0.1, interactionReach: 0.1 }),
    ACTION_DEFINITIONS,
    buildResourceView(ledger, "TED")
  );

  assert.ok(!legalByType(result).has("SMOKE"));

  assert.deepEqual(
    blockedByType(result).get("SMOKE").blockedModes,
    ["strained", "deliberate"]
  );
});

/* ============================================================
   H) STATE WIRING
============================================================ */

test("G.resources exists as a run-scoped ledger sibling of G.comms", () => {
  assert.ok(G.resources, "G.resources must exist");
  assert.ok(G.comms, "G.comms is the sibling this mirrors");
  assert.ok(G.overhearing);
});

test("the agency envelope carries a resources map for the derived view", () => {
  assert.deepEqual(createAgencyState().resources, {});
});

test("the authoritative ledger and the derived view are different objects", () => {
  /*
   * G.resources is authoritative and survives cycles.
   * G.agency.resources is a per-cycle VIEW and is discarded on reset.
   * Conflating them would make per-cycle reset semantics ambiguous.
   */
  const envelope = createAgencyState();

  assert.notEqual(envelope.resources, G.resources);
});

test("the derived view is a snapshot that cannot write through to the ledger", () => {
  const ledger = seededLedger();

  const view = buildResourceView(ledger, "TED");

  view.stacks.length = 0;

  assert.equal(
    heldQuantity(buildResourceView(ledger, "TED"), "cigarette"),
    3,
    "clearing a view must not empty the ledger"
  );
});

test("this slice never mutates the authoritative ledger", () => {
  /*
   * Derive-and-observe. The resolver that decrements quantities does
   * not exist yet, so any mutation here would be an undeclared
   * behaviour change rather than a feature.
   */
  const ledger = seededLedger();

  const before = JSON.stringify(ledger);

  for (const simId of SIM_IDS) {
    const sim = { id: simId, constraints: [] };

    enumerateLegalActions(
      sim,
      deriveCapabilities(sim).capabilities,
      ACTION_DEFINITIONS,
      buildResourceView(ledger, simId)
    );
  }

  assert.equal(JSON.stringify(ledger), before);
});