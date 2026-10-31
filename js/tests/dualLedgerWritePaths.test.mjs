// js/tests/dualLedgerWritePaths.test.mjs
//
// CHARACTERIZATION: THE TWO WRITE PATHS INTO THE SUBJECTIVE LEDGER.
//
// Objective mutations reach the world through two independent commit
// paths, and both must project the SAME belief into `claimState` and
// `claimDivergence`:
//
//   1. commit.js                       -- a prisoner acting on their
//                                         own turn, recorded as a
//                                         PRISONER_ACTION.
//   2. commitResourceInterventions.js  -- AM acting on the prisoner,
//                                         recorded as an AM_INTERVENTION.
//
// The two paths are INTENTIONALLY different at the objective layer: a
// prisoner's own action projects as an `own_action` (giver) plus a
// `received` (taker), while AM's revealed intervention projects as
// `informed` for everyone it touched. What must NOT differ is the
// projection: a one-unit transfer of the same stack from TED to ELLEN
// has to leave every prisoner believing exactly the same thing no
// matter which path carried it out.
//
// This test CHARACTERIZES the equivalence that already holds today so
// a future refactor of either projector cannot silently make the two
// paths disagree. It does not assert new behaviour.
//
// The claim EVENT LOGS are deliberately excluded from the equality
// assertions. They must differ in `cause.kind` (own_action/received vs
// informed), so comparing them would fail for the wrong reason. Only
// the DERIVED views (`claimState`, `claimDivergence`) are compared.

import assert from "node:assert/strict";
import test from "node:test";

import { G } from "../core/state.js";
import { SIM_IDS } from "../core/constants.js";
import { createAgencyState } from "../engine/agency/state/createAgencyState.js";
import {
  createResourceLedger,
  seedResources
} from "../engine/agency/resourceLedger.js";
import {
  CLAIM_DISCLOSURES,
  CLAIM_EVENT_KINDS
} from "../engine/agency/claimLedger.js";
import { commitAgencyResolution } from "../engine/agency/commit.js";
import {
  commitResourceInterventions
} from "../engine/analysis/commitResourceInterventions.js";

/* ============================================================
   FIXTURES
============================================================ */

function makeSim(id) {
  return {
    id,
    name: id,
    scratchpad: {
      initialized: true,
      activeGoal: null,
      goalHistory: []
    }
  };
}

/*
 * A complete, minimally-populated game state.
 *
 * The fields mirror js/core/state.js closely enough that BOTH commit
 * paths can run against it without reaching for the real global G:
 * every ledger, sequence counter and derived view the two projectors
 * read or write is present, so two such states differ ONLY by the
 * mutation under test.
 */
function makeState() {
  return {
    cycle: 5,
    sims: Object.fromEntries(SIM_IDS.map((id) => [id, makeSim(id)])),
    resources: createResourceLedger(),
    resourceEvents: [],
    resourceEventSequence: { cycle: null, next: 1 },
    claimEvents: [],
    claimEventSequence: { cycle: null, next: 1 },
    claimState: {},
    claimDivergence: {},
    divergenceEvents: [],
    divergenceEventSequence: { cycle: null, next: 1 },
    pendingEvidence: {
      resourceInterventions: Object.create(null),
      exposures: Object.create(null)
    },
    recentResourceDiscoveries: [],
    pendingResourceDiscoveries: [],
    agency: createAgencyState()
  };
}

/*
 * Seed the frozen first-slice inventory (TED: 3 cigarettes, ELLEN: 2
 * matches) AND write the matching seed history, so every prisoner's
 * belief starts equal to reality and no divergence exists.
 */
function seededState() {
  const state = makeState();
  seedResources(state.resources, state);
  return state;
}

/*
 * Drive AM's 1-unit cigarette transfer from TED to ELLEN through
 * commitResourceInterventions.js.
 *
 * That path emits timeline events through the GLOBAL G and logs to
 * the console, exactly as its existing test file does, so both are
 * stubbed for the duration and restored after.
 */
function runAmTransfer(state, { disclosure } = {}) {
  const previousTimeline = G.timeline;
  const previousCycle = G.cycle;
  const previousDebug = console.debug;
  const previousWarn = console.warn;

  G.timeline = [];
  G.cycle = state.cycle;
  console.debug = () => {};
  console.warn = () => {};

  try {
    return commitResourceInterventions(state, [{
      intervention_type: "transfer",
      resource_id: "cigarette_stack_01",
      holder_id: "TED",
      target_holder_id: "ELLEN",
      quantity: 1,
      ...(disclosure ? { disclosure } : {}),
      provenance: { cycle: state.cycle, rationale: "test transfer" }
    }]);
  } finally {
    G.timeline = previousTimeline;
    G.cycle = previousCycle;
    console.debug = previousDebug;
    console.warn = previousWarn;
  }
}

/* ============================================================
   THE TWO WRITE PATHS
============================================================ */

test("a prisoner transfer and an AM transfer project identical claims", () => {
  const state1 = seededState();
  const state2 = seededState();

  // Premise: identical starting beliefs and no divergence.
  assert.deepEqual(state1.claimState, state2.claimState);
  assert.equal(state1.claimState.TED.cigarette, 3);
  assert.deepEqual(state1.claimDivergence, {});

  // ---- Path A: prisoner TRANSFER via commit.js -----------------------
  commitAgencyResolution(state1, [{
    actorId: "TED",
    action: {
      type: "TRANSFER",
      resourceId: "cigarette_stack_01",
      targetId: "ELLEN"
    },
    status: "success",
    operations: [{
      kind: "transfer",
      resourceId: "cigarette_stack_01",
      definitionId: "cigarette",
      quantity: 1,
      targetId: "ELLEN"
    }]
  }]);

  // ---- Path B: AM transfer via commitResourceInterventions.js --------
  runAmTransfer(state2);

  // Both paths moved exactly 1 cigarette from TED to ELLEN.
  assert.equal(state1.claimState.TED.cigarette, 2);
  assert.equal(state1.claimState.ELLEN.cigarette, 1);
  assert.equal(state2.claimState.TED.cigarette, 2);
  assert.equal(state2.claimState.ELLEN.cigarette, 1);

  // The SEAM: the same world change is an own_action/received through
  // one path and an informed through the other. This is what makes the
  // convergence below non-trivial.
  const kindsA = new Set(
    state1.claimEvents.slice(-2).map((event) => event.cause.kind)
  );
  const kindsB = new Set(
    state2.claimEvents.slice(-2).map((event) => event.cause.kind)
  );
  assert.ok(kindsA.has(CLAIM_EVENT_KINDS.OWN_ACTION));
  assert.ok(kindsA.has(CLAIM_EVENT_KINDS.RECEIVED));
  assert.ok(kindsB.has(CLAIM_EVENT_KINDS.INFORMED));

  // The projection must be identical regardless of which path wrote it.
  assert.deepEqual(state1.claimState, state2.claimState);
  assert.deepEqual(state1.claimDivergence, state2.claimDivergence);

  // Byte-identical, not merely deep-equal: the claim views are consumed
  // as serialized JSON in the export stream, so key order matters too.
  assert.equal(
    JSON.stringify(state1.claimState),
    JSON.stringify(state2.claimState)
  );
  assert.equal(
    JSON.stringify(state1.claimDivergence),
    JSON.stringify(state2.claimDivergence)
  );

  // Neither path is a silent disclosure, so neither leaves a divergence.
  assert.deepEqual(state1.claimDivergence, {});
  assert.deepEqual(state2.claimDivergence, {});
});

test("the divergence comparison is not vacuous: a silent AM transfer diverges", () => {
  /*
   * The equivalence test above asserts that claimDivergence is equal
   * (and empty) on both sides. Two empty objects are always equal, so
   * if the divergence computation ever broke, that assertion would
   * keep passing for the wrong reason.
   *
   * This control proves the machinery is live: the SAME transfer, run
   * silently (the victim is not told), must move the objective world
   * while leaving the victim's belief untouched, which is exactly a
   * divergence.
   */
  const control = seededState();

  runAmTransfer(control, { disclosure: CLAIM_DISCLOSURES.SILENT });

  // TED believes he still holds all 3; he actually holds 2.
  assert.equal(control.claimState.TED.cigarette, 3);
  assert.deepEqual(control.claimDivergence.TED.cigarette, {
    definitionId: "cigarette",
    claimed: 3,
    objective: 2,
    delta: -1,
    onsetCycle: control.cycle,
    claimedResourceId: "cigarette_stack_01"
  });

  // ELLEN, the recipient, is still told even when the victim is not.
  assert.equal(control.claimState.ELLEN.cigarette, 1);

  const silentKinds = new Set(
    control.claimEvents.slice(-2).map((event) => event.cause.kind)
  );
  assert.ok(silentKinds.has(CLAIM_EVENT_KINDS.SILENT));
});
