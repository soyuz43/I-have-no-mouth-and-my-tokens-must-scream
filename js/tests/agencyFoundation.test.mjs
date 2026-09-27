// js/tests/agencyFoundation.test.mjs
//
// Pure-logic coverage for the Agency Foundation slice:
//
//   - js/engine/agency/actionDefs.js              (registry + accessors)
//   - js/engine/agency/legalActions.js            (availability enumeration)
//   - js/engine/agency/state/createAgencyState.js (envelope factory)
//   - js/engine/phases/agencyPhase.js             (orchestrator, stubbed DOM)
//
// The behaviours most likely to regress silently are:
//
//   1. A partially-open mode ladder producing a legal action with a
//      PAIRED blocked entry. Dropping the blocked half makes the
//      system unable to distinguish "nothing to say" from "unable
//      to say it at length".
//   2. WAIT remaining legal at concentration 0. An empty legal set
//      would leave a fully restrained prisoner unrepresentable.
//   3. The phase passing `derived.capabilities` (the five floats)
//      rather than the whole deriveCapabilities() envelope. The
//      envelope shares no keys with any requirement block, so that
//      error is total and silent: every action blocks.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ACTION_DEFINITIONS,
  getActionDefinition,
  getAllActionTypes
} from "../engine/agency/actionDefs.js";

import {
  enumerateLegalActions
} from "../engine/agency/legalActions.js";

import {
  createAgencyState
} from "../engine/agency/state/createAgencyState.js";

import { deriveCapabilities } from "../engine/agency/capabilities.js";

import { SIM_IDS } from "../core/constants.js";

/* ============================================================
   FIXTURES
============================================================ */

/* Every posture id currently in the constraint library. Enumerated
   here rather than imported from CONSTRAINT_LIBRARY so the test does
   not silently widen if a new position is added without a
   corresponding availability decision. */
const LIBRARY_CONSTRAINT_IDS = [
  "kneeling_grate",
  "arms_extended",
  "wall_sit",
  "squat_hold",
  "overhead_restraint",
  "forward_bend",
  "tiptoe_balance",
  "static_stand",
  "palestinian_chair"
];

function simWith(constraints = []) {
  return {
    id: "TED",
    constraints
  };
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

/*
 * A hand-built capability set. Used where the assertion is about the
 * enumerator's rules rather than about constraint data, so the test
 * does not depend on a posture table that may be re-authored later.
 */
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

function legalByType(result) {
  return new Map(result.legal.map((entry) => [entry.type, entry]));
}

function blockedByType(result) {
  return new Map(result.blocked.map((entry) => [entry.type, entry]));
}

/* ============================================================
   A) ACTION DEFINITION REGISTRY
============================================================ */

test("the registry contains exactly the three initial actions", () => {
  assert.deepEqual(
    getAllActionTypes(),
    ["WAIT", "OBSERVE", "SEND_MESSAGE"]
  );
});

test("every definition carries the full required shape", () => {
  for (const type of getAllActionTypes()) {
    const definition = getActionDefinition(type);

    assert.ok(definition, `${type} is missing`);

    assert.equal(definition.type, type);

    assert.equal(typeof definition.title, "string");
    assert.ok(definition.title.length > 0);

    assert.equal(typeof definition.baseCost, "number");
    assert.ok(definition.baseCost >= 0);

    assert.equal(typeof definition.requirements, "object");
    assert.ok(!Array.isArray(definition.requirements));

    assert.ok(Array.isArray(definition.effortDomains));

    assert.equal(typeof definition.executionModes, "object");
    assert.ok(!Array.isArray(definition.executionModes));
  }
});

test("getActionDefinition returns null for unknown and non-string types", () => {
  assert.equal(getActionDefinition("NOT_AN_ACTION"), null);
  assert.equal(getActionDefinition(""), null);
  assert.equal(getActionDefinition(undefined), null);
  assert.equal(getActionDefinition(null), null);
  assert.equal(getActionDefinition(42), null);
});

test("getActionDefinition does not resolve inherited object keys", () => {
  /*
   * `getActionDefinition("toString")` must not hand back a function
   * from Object.prototype. A registry that answers for keys it does
   * not own would let a caller enumerate phantom actions.
   */
  assert.equal(getActionDefinition("toString"), null);
  assert.equal(getActionDefinition("constructor"), null);
  assert.equal(getActionDefinition("__proto__"), null);
});

test("WAIT is free, unconditional, and mode-less", () => {
  const wait = getActionDefinition("WAIT");

  assert.equal(wait.title, "Wait");
  assert.equal(wait.baseCost, 0);
  assert.deepEqual(wait.requirements, {});
  assert.deepEqual(wait.effortDomains, []);
  assert.deepEqual(wait.executionModes, {});
});

test("OBSERVE is single-form and gated only on concentration", () => {
  const observe = getActionDefinition("OBSERVE");

  assert.equal(observe.title, "Observe");
  assert.equal(observe.baseCost, 1);
  assert.deepEqual(observe.requirements, { concentration: 0.1 });
  assert.deepEqual(observe.effortDomains, ["cognitive"]);
  assert.deepEqual(observe.executionModes, {});
});

test("SEND_MESSAGE declares the four-mode ladder with authored costs", () => {
  const send = getActionDefinition("SEND_MESSAGE");

  assert.equal(send.title, "Send Message");
  assert.equal(send.baseCost, 1);
  assert.deepEqual(send.requirements, { concentration: 0.1 });
  assert.deepEqual(send.effortDomains, ["cognitive"]);

  assert.deepEqual(Object.keys(send.executionModes), [
    "SIGNAL",
    "BRIEF",
    "COHERENT",
    "DETAILED"
  ]);

  assert.deepEqual(send.executionModes.SIGNAL, {
    cost: 1,
    minimums: { concentration: 0.1 }
  });

  assert.deepEqual(send.executionModes.BRIEF, {
    cost: 1,
    minimums: { concentration: 0.2 }
  });

  assert.deepEqual(send.executionModes.COHERENT, {
    cost: 2,
    minimums: { concentration: 0.4 }
  });

  assert.deepEqual(send.executionModes.DETAILED, {
    cost: 2,
    minimums: { concentration: 0.5, stability: 0.2 }
  });
});

test("DETAILED is the only multi-axis mode", () => {
  /*
   * Every other rung is gated on concentration alone. DETAILED alone
   * also requires stability, which is the assertion that a mode
   * ladder can compose two capabilities rather than a single scalar.
   */
  for (const type of getAllActionTypes()) {
    for (const [mode, definition] of Object.entries(
      getActionDefinition(type).executionModes
    )) {
      const keys = Object.keys(definition.minimums);

      if (type === "SEND_MESSAGE" && mode === "DETAILED") {
        assert.deepEqual(keys.sort(), ["concentration", "stability"]);
        continue;
      }

      assert.equal(
        keys.length,
        1,
        `${type}.${mode} unexpectedly requires ${keys.length} capabilities`
      );
    }
  }
});

test("mode minimums never descend as the ladder ascends", () => {
  const modes = getActionDefinition("SEND_MESSAGE").executionModes;
  const order = ["SIGNAL", "BRIEF", "COHERENT", "DETAILED"];

  for (let i = 1; i < order.length; i++) {
    assert.ok(
      modes[order[i]].minimums.concentration >=
        modes[order[i - 1]].minimums.concentration,
      `${order[i]} should not require less concentration than ${order[i - 1]}`
    );
  }
});

test("a more demanding mode never costs less than a cheaper one", () => {
  const modes = getActionDefinition("SEND_MESSAGE").executionModes;
  const order = ["SIGNAL", "BRIEF", "COHERENT", "DETAILED"];

  for (let i = 1; i < order.length; i++) {
    assert.ok(
      modes[order[i]].cost >= modes[order[i - 1]].cost,
      `${order[i]} should not be cheaper than ${order[i - 1]}`
    );
  }
});

test("the shared registry is frozen at every level", () => {
  assert.ok(Object.isFrozen(ACTION_DEFINITIONS));

  for (const type of getAllActionTypes()) {
    const definition = getActionDefinition(type);

    assert.ok(Object.isFrozen(definition));
    assert.ok(Object.isFrozen(definition.requirements));
    assert.ok(Object.isFrozen(definition.effortDomains));
    assert.ok(Object.isFrozen(definition.executionModes));

    for (const mode of Object.values(definition.executionModes)) {
      assert.ok(Object.isFrozen(mode));
      assert.ok(Object.isFrozen(mode.minimums));
    }
  }
});

test("mutating a returned definition cannot widen the action space", () => {
  /*
   * ES modules are always strict, so writing to a frozen property
   * throws rather than failing silently. If this ever stops
   * throwing, the registry is no longer protecting itself.
   */
  const wait = getActionDefinition("WAIT");

  assert.throws(() => {
    wait.baseCost = 999;
  }, TypeError);

  assert.equal(getActionDefinition("WAIT").baseCost, 0);
});

test("getAllActionTypes returns a fresh array each call", () => {
  getAllActionTypes().push("INJECTED");

  assert.deepEqual(
    getAllActionTypes(),
    ["WAIT", "OBSERVE", "SEND_MESSAGE"]
  );
});

/* ============================================================
   B) LEGAL-ACTION ENUMERATOR — UNRESTRAINED
============================================================ */

test("an unconstrained prisoner can take every action and every mode", () => {
  const result = enumerateLegalActions(
    simWith([]),
    caps(),
    ACTION_DEFINITIONS
  );

  assert.equal(result.blocked.length, 0);

  assert.deepEqual(
    result.legal.map((entry) => entry.type),
    ["WAIT", "OBSERVE", "SEND_MESSAGE"]
  );

  const legal = legalByType(result);

  assert.equal(legal.get("WAIT").cost, 0);
  assert.equal(legal.get("WAIT").availableModes.length, 0);

  assert.equal(legal.get("OBSERVE").cost, 1);
  assert.equal(legal.get("OBSERVE").availableModes.length, 0);

  assert.deepEqual(
    legal.get("SEND_MESSAGE").availableModes,
    ["SIGNAL", "BRIEF", "COHERENT", "DETAILED"]
  );
});

test("a fully unconstrained sim agrees with the real deriver", () => {
  const sim = simWith([]);

  const result = enumerateLegalActions(
    sim,
    deriveCapabilities(sim).capabilities,
    ACTION_DEFINITIONS
  );

  assert.equal(result.legal.length, 3);
  assert.equal(result.blocked.length, 0);
});

/* ============================================================
   C) LEGAL-ACTION ENUMERATOR — PARTIALLY OPEN LADDER
============================================================ */

test("concentration 0.3 keeps SEND_MESSAGE legal but caps it at BRIEF", () => {
  /*
   * The load-bearing case. The action must appear in BOTH lists: legal
   * with the two open modes, and blocked with the two closed ones. If
   * either half is dropped, a downstream reader cannot tell that the
   * prisoner is mute-by-restraint rather than silent-by-choice.
   */
  const result = enumerateLegalActions(
    simWith(),
    caps({ concentration: 0.3 }),
    ACTION_DEFINITIONS
  );

  const legal = legalByType(result);
  const blocked = blockedByType(result);

  assert.deepEqual(
    result.legal.map((entry) => entry.type),
    ["WAIT", "OBSERVE", "SEND_MESSAGE"]
  );

  assert.deepEqual(legal.get("SEND_MESSAGE").availableModes, [
    "SIGNAL",
    "BRIEF"
  ]);

  assert.equal(result.blocked.length, 1);

  const refusal = blocked.get("SEND_MESSAGE");

  assert.equal(refusal.reason, "capability_below_minimum");
  assert.deepEqual(refusal.blockedModes, ["COHERENT", "DETAILED"]);

  /*
   * The reported gap is the HIGHEST missed threshold (0.5, from
   * DETAILED), not the lowest (0.4, from COHERENT). Reporting 0.4
   * would understate what the prisoner actually fell short of.
   */
  assert.deepEqual(refusal.missingRequirements, { concentration: 0.5 });
});

test("concentration 0.2 opens BRIEF exactly on its boundary", () => {
  const result = enumerateLegalActions(
    simWith(),
    caps({ concentration: 0.2 }),
    ACTION_DEFINITIONS
  );

  assert.deepEqual(
    legalByType(result).get("SEND_MESSAGE").availableModes,
    ["SIGNAL", "BRIEF"]
  );

  assert.deepEqual(
    blockedByType(result).get("SEND_MESSAGE").blockedModes,
    ["COHERENT", "DETAILED"]
  );
});

test("concentration 0.19 closes BRIEF and leaves only SIGNAL", () => {
  const result = enumerateLegalActions(
    simWith(),
    caps({ concentration: 0.19 }),
    ACTION_DEFINITIONS
  );

  assert.deepEqual(
    legalByType(result).get("SEND_MESSAGE").availableModes,
    ["SIGNAL"]
  );

  assert.deepEqual(
    blockedByType(result).get("SEND_MESSAGE").blockedModes,
    ["BRIEF", "COHERENT", "DETAILED"]
  );
});

test("OBSERVE survives every concentration that keeps SEND_MESSAGE open", () => {
  /*
   * OBSERVE's gate (0.1) equals SIGNAL's gate. If a future edit lowers
   * one and not the other, a prisoner could still signal while being
   * unable to observe. This pins the current relationship rather than
   * the intent behind it.
   */
  for (const concentration of [0.1, 0.19, 0.3, 1]) {
    const result = enumerateLegalActions(
      simWith(),
      caps({ concentration }),
      ACTION_DEFINITIONS
    );

    assert.ok(
      legalByType(result).has("OBSERVE"),
      `OBSERVE should stay legal at concentration ${concentration}`
    );
  }
});

test("stability below 0.2 closes DETAILED even at full concentration", () => {
  const result = enumerateLegalActions(
    simWith(),
    caps({ concentration: 1, stability: 0.19 }),
    ACTION_DEFINITIONS
  );

  assert.deepEqual(
    legalByType(result).get("SEND_MESSAGE").availableModes,
    ["SIGNAL", "BRIEF", "COHERENT"]
  );

  const refusal = blockedByType(result).get("SEND_MESSAGE");

  assert.deepEqual(refusal.blockedModes, ["DETAILED"]);
  assert.deepEqual(refusal.missingRequirements, { stability: 0.2 });
});

test("a blocked mode reports the max missed threshold across modes", () => {
  /*
   * COHERENT misses concentration 0.4 and DETAILED misses 0.5. Only the
   * maximum is reported, because that is the bar that would have had
   * to be cleared for both modes to open.
   */
  const result = enumerateLegalActions(
    simWith(),
    caps({ concentration: 0.1, stability: 0.1 }),
    ACTION_DEFINITIONS
  );

  assert.deepEqual(
    blockedByType(result).get("SEND_MESSAGE").missingRequirements,
    { concentration: 0.5, stability: 0.2 }
  );
});

/* ============================================================
   D) LEGAL-ACTION ENUMERATOR — FULLY BLOCKED
============================================================ */

test("concentration 0.05 leaves only WAIT legal", () => {
  const result = enumerateLegalActions(
    simWith(),
    caps({ concentration: 0.05 }),
    ACTION_DEFINITIONS
  );

  assert.deepEqual(
    result.legal.map((entry) => entry.type),
    ["WAIT"]
  );

  const blocked = blockedByType(result);

  assert.equal(blocked.size, 2);

  assert.deepEqual(
    blocked.get("OBSERVE").missingRequirements,
    { concentration: 0.1 }
  );

  /*
   * When the TOP-LEVEL gate closes, the whole ladder is refused at
   * once. Listing only the individually-failing modes would imply
   * SIGNAL was still reachable, which it is not.
   */
  const send = blocked.get("SEND_MESSAGE");

  assert.equal(send.reason, "capability_below_minimum");
  assert.deepEqual(send.missingRequirements, { concentration: 0.1 });
  assert.deepEqual(send.blockedModes, [
    "SIGNAL",
    "BRIEF",
    "COHERENT",
    "DETAILED"
  ]);

  assert.ok(
    !result.legal.some((entry) => entry.type === "SEND_MESSAGE")
  );
});

test("WAIT is legal at zero on every capability", () => {
  const result = enumerateLegalActions(
    simWith(),
    caps({
      mobility: 0,
      stability: 0,
      handUse: 0,
      concentration: 0,
      interactionReach: 0
    }),
    ACTION_DEFINITIONS
  );

  assert.deepEqual(result.legal, [
    {
      type: "WAIT",
      title: "Wait",
      cost: 0,
      availableModes: []
    }
  ]);
});

test("a blocked entry carries neither cost nor availableModes", () => {
  const result = enumerateLegalActions(
    simWith(),
    caps({ concentration: 0.05 }),
    ACTION_DEFINITIONS
  );

  for (const entry of result.blocked) {
    assert.equal(entry.cost, undefined);
    assert.equal(entry.availableModes, undefined);
    assert.equal(entry.reason, "capability_below_minimum");
    assert.equal(typeof entry.title, "string");
  }
});

/* ============================================================
   E) LEGAL-ACTION ENUMERATOR — REAL POSTURES
============================================================ */

test("palestinian_chair keeps WAIT and OBSERVE but caps SEND_MESSAGE", () => {
  const sim = simWith([restraint("palestinian_chair")]);

  const derived = deriveCapabilities(sim);

  assert.equal(derived.capabilities.handUse, 0);
  assert.equal(derived.capabilities.interactionReach, 0);
  assert.equal(derived.capabilities.concentration, 0.2);

  const result = enumerateLegalActions(
    sim,
    derived.capabilities,
    ACTION_DEFINITIONS
  );

  const legal = legalByType(result);
  const blocked = blockedByType(result);

  assert.ok(legal.has("WAIT"));
  assert.ok(legal.has("OBSERVE"));

  assert.deepEqual(legal.get("SEND_MESSAGE").availableModes, [
    "SIGNAL",
    "BRIEF"
  ]);

  assert.deepEqual(blocked.get("SEND_MESSAGE").blockedModes, [
    "COHERENT",
    "DETAILED"
  ]);
});

test("overhead_restraint leaves the same two open modes", () => {
  const sim = simWith([restraint("overhead_restraint")]);

  const derived = deriveCapabilities(sim);

  assert.equal(derived.capabilities.concentration, 0.3);

  const result = enumerateLegalActions(
    sim,
    derived.capabilities,
    ACTION_DEFINITIONS
  );

  assert.equal(result.legal.length, 3);

  assert.deepEqual(
    legalByType(result).get("SEND_MESSAGE").availableModes,
    ["SIGNAL", "BRIEF"]
  );

  assert.deepEqual(
    blockedByType(result).get("SEND_MESSAGE").blockedModes,
    ["COHERENT", "DETAILED"]
  );
});

test("the enumerator never grants a mode the posture cannot support", () => {
  /*
   * Cross-check across the whole constraint library. Every mode the
   * enumerator reports as available must have its minimums satisfied
   * by the derived capabilities. This is the integration guard for
   * the envelope-vs-map mistake: passing the wrong object fails here
   * for every real posture, not just for a hand-built one.
   */
  for (const constraintId of LIBRARY_CONSTRAINT_IDS) {
    const sim = simWith([restraint(constraintId)]);

    const derived = deriveCapabilities(sim);

    const result = enumerateLegalActions(
      sim,
      derived.capabilities,
      ACTION_DEFINITIONS
    );

    for (const entry of result.legal) {
      const modes = getActionDefinition(entry.type).executionModes;

      for (const modeName of entry.availableModes) {
        for (const [key, minimum] of Object.entries(
          modes[modeName].minimums
        )) {
          assert.ok(
            derived.capabilities[key] >= minimum,
            `${constraintId}: ${entry.type}.${modeName} requires ` +
              `${key} >= ${minimum} but capability is ` +
              `${derived.capabilities[key]}`
          );
        }
      }
    }
  }
});

test("every constrained posture still leaves a non-empty legal set", () => {
  /*
   * An empty legal set has no downstream meaning. Every posture
   * authored in the library is survivable under the current
   * catalogue, and this pins that as an invariant of the pairing
   * (registry x postures) rather than of either alone.
   */
  for (const constraintId of LIBRARY_CONSTRAINT_IDS) {
    const sim = simWith([restraint(constraintId)]);

    const result = enumerateLegalActions(
      sim,
      deriveCapabilities(sim).capabilities,
      ACTION_DEFINITIONS
    );

    assert.ok(
      result.legal.length > 0,
      `${constraintId} produced an empty legal set`
    );
  }
});

test("simultaneous constraints never widen the action set", () => {
  /*
   * deriveCapabilities is max-restriction-wins, so stacking can only
   * close actions. If a stack ever opened one, the enumerator and the
   * deriver would disagree about what a body can do.
   */
  for (const constraintId of LIBRARY_CONSTRAINT_IDS) {
    const single = simWith([restraint(constraintId)]);
    const stacked = simWith([
      restraint(constraintId),
      restraint("palestinian_chair"),
      restraint("overhead_restraint")
    ]);

    const singleResult = enumerateLegalActions(
      single,
      deriveCapabilities(single).capabilities,
      ACTION_DEFINITIONS
    );

    const stackedResult = enumerateLegalActions(
      stacked,
      deriveCapabilities(stacked).capabilities,
      ACTION_DEFINITIONS
    );

    assert.ok(
      stackedResult.legal.length <= singleResult.legal.length,
      `${constraintId}: stacking opened an action`
    );
  }
});

/* ============================================================
   F) LEGAL-ACTION ENUMERATOR — PURITY AND ROBUSTNESS
============================================================ */

test("enumerateLegalActions is pure and repeatable", () => {
  const sim = simWith([
    restraint("palestinian_chair"),
    restraint("overhead_restraint")
  ]);

  const derived = deriveCapabilities(sim);

  const simBefore = JSON.stringify(sim);
  const capabilitiesBefore = JSON.stringify(derived.capabilities);

  const first = enumerateLegalActions(
    sim,
    derived.capabilities,
    ACTION_DEFINITIONS
  );
  const second = enumerateLegalActions(
    sim,
    derived.capabilities,
    ACTION_DEFINITIONS
  );

  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(sim), simBefore);
  assert.equal(
    JSON.stringify(derived.capabilities),
    capabilitiesBefore
  );
});

test("the enumerator does not mutate the registry", () => {
  const before = JSON.stringify(ACTION_DEFINITIONS);

  enumerateLegalActions(
    simWith(),
    caps({ concentration: 0.05 }),
    ACTION_DEFINITIONS
  );

  assert.equal(JSON.stringify(ACTION_DEFINITIONS), before);
});

test("the enumerator reads no prisoner field other than the id", () => {
  /*
   * Availability is a question about the body. If mood ever leaked in
   * here, two physically identical prisoners would report different
   * action sets, and the timeline would show a capability change
   * that no constraint explains.
   */
  const bare = {
    id: "TED",
    constraints: []
  };

  const loaded = {
    id: "TED",
    constraints: [],
    suffering: 99,
    hope: 1,
    sanity: 1,
    relationships: { ELLEN: -1 },
    beliefs: { escape_possible: 0.99 }
  };

  const run = (sim) =>
    enumerateLegalActions(
      sim,
      deriveCapabilities(sim).capabilities,
      ACTION_DEFINITIONS
    );

  assert.deepEqual(run(bare), run(loaded));
});

test("a sim with no id enumerates nothing", () => {
  assert.deepEqual(
    enumerateLegalActions({}, caps(), ACTION_DEFINITIONS),
    { legal: [], blocked: [] }
  );
});

test("a missing capabilities object blocks everything except WAIT", () => {
  const result = enumerateLegalActions(
    simWith(),
    null,
    ACTION_DEFINITIONS
  );

  assert.deepEqual(
    result.legal.map((entry) => entry.type),
    ["WAIT"]
  );

  assert.equal(result.blocked.length, 2);
});

test("an absent capability key is unmet, not full", () => {
  /*
   * Fails closed. A truncated capability map must not silently grant
   * every action, which is what a `?? 1` default would do.
   */
  const partial = caps();

  delete partial.stability;
  delete partial.concentration;

  const result = enumerateLegalActions(
    simWith(),
    partial,
    ACTION_DEFINITIONS
  );

  assert.deepEqual(
    result.legal.map((entry) => entry.type),
    ["WAIT"]
  );
});

test("a non-finite capability is unmet", () => {
  for (const bad of [Number.NaN, Infinity, -Infinity]) {
    const result = enumerateLegalActions(
      simWith(),
      caps({ concentration: bad }),
      ACTION_DEFINITIONS
    );

    assert.deepEqual(
      result.legal.map((entry) => entry.type),
      ["WAIT"]
    );
  }
});

test("a missing or empty registry enumerates nothing", () => {
  const empty = { legal: [], blocked: [] };

  assert.deepEqual(enumerateLegalActions(simWith(), caps(), null), empty);
  assert.deepEqual(enumerateLegalActions(simWith(), caps(), {}), empty);
  assert.deepEqual(enumerateLegalActions(simWith(), caps()), empty);
});

test("an action whose every mode is blocked appears only in blocked", () => {
  /*
   * A custom registry exercises the "all modes closed" branch without
   * contriving a real posture. With no mode-less action alongside it,
   * there is no legal entry that could be paired.
   */
  const registry = {
    ONLY_MODED: {
      type: "ONLY_MODED",
      title: "Only Moded",
      baseCost: 1,
      requirements: {},
      effortDomains: [],
      executionModes: {
        HIGH: { cost: 2, minimums: { concentration: 0.9 } }
      }
    }
  };

  const result = enumerateLegalActions(
    simWith(),
    caps({ concentration: 0.4 }),
    registry
  );

  assert.deepEqual(result.legal, []);

  assert.deepEqual(result.blocked, [
    {
      type: "ONLY_MODED",
      title: "Only Moded",
      reason: "capability_below_minimum",
      missingRequirements: { concentration: 0.9 },
      blockedModes: ["HIGH"]
    }
  ]);
});

test("a mode-less action whose gate closes reports no blockedModes key", () => {
  const registry = {
    FLAT: {
      type: "FLAT",
      title: "Flat",
      baseCost: 1,
      requirements: { concentration: 0.5 },
      effortDomains: [],
      executionModes: {}
    }
  };

  const result = enumerateLegalActions(
    simWith(),
    caps({ concentration: 0.2 }),
    registry
  );

  assert.equal(result.blocked.length, 1);
  assert.equal(result.blocked[0].blockedModes, undefined);
});

test("a null definition in a registry is skipped, not fatal", () => {
  const registry = {
    BROKEN: null,
    GOOD: {
      type: "GOOD",
      title: "Good",
      baseCost: 1,
      requirements: {},
      effortDomains: [],
      executionModes: {}
    }
  };

  const result = enumerateLegalActions(simWith(), caps(), registry);

  assert.deepEqual(result.legal.map((entry) => entry.type), ["GOOD"]);
});

/* ============================================================
   G) STATE ENVELOPE
============================================================ */

test("createAgencyState returns the documented default shape", () => {
  assert.deepEqual(createAgencyState(), {
    cycle: null,
    capabilities: {},
    legalActions: {},
    blockedActions: {},
    lastDerivedCycle: null,
    nextActionSequence: 1
  });
});

test("the envelope has exactly the six documented keys", () => {
  /*
   * A strict key set catches an accidental extra field, which would
   * otherwise sit in G.agency unconsumed.
   */
  assert.deepEqual(Object.keys(createAgencyState()), [
    "cycle",
    "capabilities",
    "legalActions",
    "blockedActions",
    "lastDerivedCycle",
    "nextActionSequence"
  ]);
});

test("every call returns an independent envelope", () => {
  const first = createAgencyState();
  const second = createAgencyState();

  assert.notEqual(first, second);
  assert.notEqual(first.capabilities, second.capabilities);
  assert.notEqual(first.legalActions, second.legalActions);
  assert.notEqual(first.blockedActions, second.blockedActions);

  first.capabilities.TED = { marker: true };
  first.legalActions.TED = [];
  first.nextActionSequence = 99;

  assert.deepEqual(second.capabilities, {});
  assert.deepEqual(second.legalActions, {});
  assert.equal(second.nextActionSequence, 1);
});

/* ============================================================
   H) PHASE ORCHESTRATOR
============================================================ */

/*
 * js/ui/timeline.js and js/ui/logs.js both read `document` at CALL
 * time, not at import time, so a minimal stub is enough to import and
 * run the phase under Node. Every accessor returns null, which drives
 * both functions down their existing early-return paths — the same
 * path the browser takes when a panel is absent.
 *
 * This is an integration check of the phase's own writes, not an
 * independent oracle: it proves the phase reads and writes what it
 * claims, not that the UI renders it.
 */
const domRestorers = [];

function installDom() {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const previousRaf = globalThis.requestAnimationFrame;

  globalThis.document = {
    getElementById: () => null,
    createElement: () => ({
      style: {},
      classList: { add() {} },
      setAttribute() {},
      appendChild() {},
      addEventListener() {}
    }),
    createTextNode: () => ({ textContent: "" })
  };

  if (!globalThis.window) {
    globalThis.window = {};
  }

  if (typeof globalThis.requestAnimationFrame !== "function") {
    globalThis.requestAnimationFrame = (callback) => callback();
  }

  domRestorers.push(() => {
    if (previousDocument === undefined) {
      delete globalThis.document;
    } else {
      globalThis.document = previousDocument;
    }

    if (previousWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = previousWindow;
    }

    if (previousRaf === undefined) {
      delete globalThis.requestAnimationFrame;
    } else {
      globalThis.requestAnimationFrame = previousRaf;
    }
  });
}

function restoreDom() {
  while (domRestorers.length > 0) {
    domRestorers.pop()();
  }
}

/*
 * Run the phase against a temporarily restyled G.sims, restoring
 * every touched field afterwards. The phase is asserted to be
 * read-only with respect to sims, but a failing assertion must not
 * leave a contaminated global for the next test.
 */
async function withPhase(options, body) {
  installDom();

  try {
    const { G } = await import("../core/state.js");
    const { runAgencyPhase } =
      await import("../engine/phases/agencyPhase.js");

    const previousCycle = G.cycle;
    const previousConstraints = {};

    for (const simId of SIM_IDS) {
      previousConstraints[simId] = G.sims[simId].constraints;
      G.sims[simId].constraints = options.constraints ?? [];
    }

    try {
      G.cycle = options.cycle;
      G.agency.cycle = null;
      G.agency.capabilities = {};
      G.agency.legalActions = {};
      G.agency.blockedActions = {};
      G.agency.lastDerivedCycle = null;

      await body({ G, runAgencyPhase });

      assert.equal(
        G.agency.cycle,
        options.cycle,
        "G.agency.cycle should track the cycle just derived"
      );

      assert.equal(
        G.agency.lastDerivedCycle,
        options.cycle
      );
    } finally {
      G.cycle = previousCycle;

      for (const simId of SIM_IDS) {
        G.sims[simId].constraints = previousConstraints[simId];
      }

      restoreDom();
    }
  } finally {
    restoreDom();
  }
}

test("the phase writes one entry per sim into G.agency", async () => {
  await withPhase({ cycle: 12, constraints: [] }, async ({ G, runAgencyPhase }) => {
    await runAgencyPhase();

    for (const simId of SIM_IDS) {
      assert.ok(
        G.agency.capabilities[simId],
        `${simId} has no derived capabilities`
      );

      assert.ok(
        Array.isArray(G.agency.legalActions[simId]),
        `${simId} has no legal action list`
      );

      assert.ok(
        Array.isArray(G.agency.blockedActions[simId]),
        `${simId} has no blocked action list`
      );
    }
  });
});

test("the phase derives against capabilities, not the derive envelope", async () => {
  /*
   * Regression guard. Passing the whole deriveCapabilities() envelope
   * to the enumerator looks plausible but shares no keys with any
   * requirement block, so every action blocks and the phase appears
   * to work while reporting that nobody can do anything.
   */
  await withPhase(
    { cycle: 13, constraints: [restraint("overhead_restraint")] },
    async ({ G, runAgencyPhase }) => {
      await runAgencyPhase();

      const legal = G.agency.legalActions.TED;

      assert.deepEqual(legal.map((entry) => entry.type), [
        "WAIT",
        "OBSERVE",
        "SEND_MESSAGE"
      ]);

      assert.deepEqual(legal[2].availableModes, ["SIGNAL", "BRIEF"]);
    }
  );
});

test("the phase stores the full derive envelope, not just the five floats", () => {
  /*
   * The stored value must keep `bands` and `provenance`. Those are
   * what make a refusal explainable after the fact; storing only
   * `capabilities` would leave the blocked entries unexplained.
   */
  return withPhase(
    { cycle: 14, constraints: [restraint("palestinian_chair")] },
    async ({ G, runAgencyPhase }) => {
      await runAgencyPhase();

      const entry = G.agency.capabilities.TED;

      assert.ok(entry.capabilities, "missing the capability map");
      assert.ok(entry.bands, "missing the band labels");
      assert.deepEqual(entry.activeConstraintIds, ["palestinian_chair"]);
      assert.equal(entry.provenance.length, 1);

      assert.equal(entry.bands.handUse, "unavailable");
    }
  );
});

test("the phase mutates nothing on any sim", async () => {
  return withPhase(
    { cycle: 15, constraints: [restraint("squat_hold")] },
    async ({ G, runAgencyPhase }) => {
      const before = JSON.stringify(G.sims);

      await runAgencyPhase();

      assert.equal(
        JSON.stringify(G.sims),
        before,
        "the agency phase must be read-only with respect to sims"
      );
    }
  );
});

test("the phase does not advance the action id counter", async () => {
  installDom();

  try {
    const { G } = await import("../core/state.js");
    const { runAgencyPhase } =
      await import("../engine/phases/agencyPhase.js");

    const before = G.agency.nextActionSequence;
    const previousCycle = G.cycle;

    G.cycle = 16;
    await runAgencyPhase();

    assert.equal(
      G.agency.nextActionSequence,
      before,
      "deriving is not proposing; no ids should be minted"
    );

    G.cycle = previousCycle;
  } finally {
    restoreDom();
  }
});

test("a failing sim does not stop derivation for the others", async () => {
  installDom();

  try {
    const { G } = await import("../core/state.js");
    const { runAgencyPhase } =
      await import("../engine/phases/agencyPhase.js");

    const previousCycle = G.cycle;
    const previousTed = G.sims.TED.constraints;
    const previousEllen = G.sims.ELLEN.constraints;

    try {
      G.cycle = 17;

      /*
       * Clear first. A sim that throws writes nothing, so any entry
       * still sitting under its key would be residue from an earlier
       * test rather than evidence that the failure was absorbed.
       */
      G.agency.capabilities = {};
      G.agency.legalActions = {};
      G.agency.blockedActions = {};

      G.sims.TED.constraints = [restraint("palestinian_chair")];

      /*
       * A throwing getter is the one failure shape that is not a
       * plausible production state, which makes it the cheapest way
       * to prove the try/catch boundary is real. A well-formed sim
       * cannot make deriveCapabilities throw, so any other injection
       * would exercise a path that does not exist.
       */
      Object.defineProperty(G.sims.ELLEN, "constraints", {
        configurable: true,
        get() {
          throw new Error("injected constraint access failure");
        }
      });

      await runAgencyPhase();

      assert.ok(
        G.agency.legalActions.TED,
        "TED should still have been derived"
      );

      assert.deepEqual(G.agency.legalActions.TED[0].type, "WAIT");

      assert.equal(
        G.agency.legalActions.ELLEN,
        undefined,
        "ELLEN should have produced no entry"
      );

      assert.equal(G.agency.lastDerivedCycle, 17);
    } finally {
      delete G.sims.ELLEN.constraints;
      G.sims.ELLEN.constraints = previousEllen;
      G.sims.TED.constraints = previousTed;
      G.cycle = previousCycle;
    }
  } finally {
    restoreDom();
  }
});

test("a later cycle overwrites rather than accumulating", async () => {
  installDom();

  try {
    const { G } = await import("../core/state.js");
    const { runAgencyPhase } =
      await import("../engine/phases/agencyPhase.js");

    const previousCycle = G.cycle;
    const previousConstraints = G.sims.TED.constraints;

    try {
      G.cycle = 18;
      G.sims.TED.constraints = [restraint("palestinian_chair")];
      await runAgencyPhase();

      const firstBlocked = G.agency.blockedActions.TED.length;

      assert.ok(
        firstBlocked > 0,
        "cycle 18 should have produced at least one refusal"
      );

      G.cycle = 19;
      G.sims.TED.constraints = [];
      await runAgencyPhase();

      assert.equal(
        G.agency.blockedActions.TED.length,
        0,
        "a fresh cycle must not inherit the previous cycle's refusals"
      );

      assert.equal(G.agency.cycle, 19);
      assert.equal(G.agency.lastDerivedCycle, 19);
    } finally {
      G.cycle = previousCycle;
      G.sims.TED.constraints = previousConstraints;
    }
  } finally {
    restoreDom();
  }
});

test("the phase never rejects a sim lacking the capabilities object", async () => {
  /*
   * G.sims entries always carry `constraints`, but the phase must not
   * depend on that: deriveCapabilities already tolerates a missing
   * array, and an entry with `constraints: undefined` should derive
   * to full capability rather than throw.
   */
  installDom();

  try {
    const { G } = await import("../core/state.js");
    const { runAgencyPhase } =
      await import("../engine/phases/agencyPhase.js");

    const previousCycle = G.cycle;
    const previousTed = G.sims.TED.constraints;

    try {
      G.cycle = 20;
      G.sims.TED.constraints = undefined;

      await runAgencyPhase();

      assert.equal(
        G.agency.legalActions.TED.length,
        3,
        "an unconstrained entry should reach the full action set"
      );
    } finally {
      G.cycle = previousCycle;
      G.sims.TED.constraints = previousTed;
    }
  } finally {
    restoreDom();
  }
});

