// js/tests/agencyPhaseCallOrder.test.mjs
//
// REGRESSION: THE DERIVATION CALL ORDER INSIDE THE AGENCY PHASE.
//
// js/engine/phases/agencyPhase.js derives a prisoner's budget in two
// ordered steps:
//
//   const derived = deriveCapabilities(sim);
//   const budget  = deriveActionBudget(derived);
//
// `deriveActionBudget()` reads `envelope.bands` and FAILS OPEN to the
// full budget of 3 when that field is absent (see
// js/engine/agency/budget.js and agencyBudget.test.mjs). `sim` has no
// `bands` field, so if a future refactor ever swapped the two lines
// so that `deriveActionBudget(sim)` ran first, the phase would STOP
// consulting physical capability and every prisoner would silently
// regain the full budget of 3. Nothing else would break: the phase
// would still run, still store a number, and still log success.
//
// This test pins the OBSERVABLE CONSEQUENCE of the correct order by
// driving the real phase over a prisoner whose posture is a single
// deduction. `kneeling_grate` drives concentration to `impaired`,
// which is exactly one deduction from the ceiling of 3.

import assert from "node:assert/strict";
import test from "node:test";

import { G } from "../core/state.js";
import { SIM_IDS } from "../core/constants.js";
import { createAgencyState } from "../engine/agency/state/createAgencyState.js";
import { deriveCapabilities } from "../engine/agency/capabilities.js";
import { TIER1_GOALS } from "../engine/scratchpad/goals/registry.js";
import { runAgencyPhase } from "../engine/phases/agencyPhase.js";

/*
 * One physical restraint instance. `remaining` is deliberately 0:
 * deriveCapabilities() gates on constraint ARRAY MEMBERSHIP, not on
 * `remaining` (a freshly applied constraint is already at 0 by the
 * time the agency phase runs).
 */
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
 * A WAIT-only proposal keeps the assertion about the phase's own
 * derivation rather than about the proposer.
 */
function waitProposal(sim) {
  return {
    actorId: sim.id,
    action: { type: "WAIT" },
    cost: 0,
    accepted: true,
    reason: null,
    requestedType: "WAIT",
    selectedObjective: sim.scratchpad?.activeGoal?.id
  };
}

/*
 * js/ui/timeline.js and js/ui/logs.js read `document` at CALL time,
 * not import time, so a minimal stub is enough to run the phase under
 * Node. Every accessor returns null, driving both modules down their
 * existing early-return paths.
 */
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

  return () => {
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
  };
}

/*
 * Run the real agency phase against the global state with a controlled
 * constraint set, restoring every touched field afterwards so this
 * file cannot leak state into another test in the same process.
 */
async function withPhase({ cycle, constraints }, body) {
  const restoreDom = installDom();

  const previousCycle = G.cycle;
  const previousAgency = G.agency;
  const previousTimeline = G.timeline;
  const previousSims = {};

  for (const simId of SIM_IDS) {
    /*
     * Snapshot the ENTIRE sim, not just the two fields the phase reads.
     *
     * Running the phase mutates more than the derived views. An
     * accepted WAIT increments `sim.waitStreak` in commit.js, and a
     * second consecutive wait additionally applies a hope/suffering
     * penalty. Restoring only `constraints` and `scratchpad` would
     * leave `waitStreak` (and any stat deltas) behind, so a later
     * `withPhase` case would start from a non-zero streak and diverge
     * on its very first wait.
     *
     * The whole sim is cloned and the entry is REPLACED on restore.
     * Replacement rather than field-by-field re-assignment matters:
     * `waitStreak` is absent on a fresh sim and ADDED by the phase, so
     * an Object.assign-style restore would leave the added key behind.
     */
    previousSims[simId] = structuredClone(G.sims[simId]);

    if (!G.sims[simId].scratchpad.activeGoal) {
      G.sims[simId].scratchpad.activeGoal = { ...TIER1_GOALS[0] };
    }

    G.sims[simId].constraints = constraints;
  }

  G.cycle = cycle;
  G.agency = createAgencyState();
  G.timeline = [];

  try {
    await body();
  } finally {
    G.cycle = previousCycle;
    G.agency = previousAgency;
    G.timeline = previousTimeline;

    for (const simId of SIM_IDS) {
      G.sims[simId] = previousSims[simId];
    }

    restoreDom();
  }
}

test("the phase derives the budget from capability bands, not the raw sim", async () => {
  /*
   * The premise, asserted independently of the phase: kneeling_grate
   * costs exactly one capability deduction.
   */
  const probe = deriveCapabilities({
    id: "TED",
    constraints: [restraint("kneeling_grate")]
  });
  assert.equal(probe.bands.concentration, "impaired");

  await withPhase(
    { cycle: 16, constraints: [restraint("kneeling_grate")] },
    async () => {
      await runAgencyPhase({ proposalCollector: waitProposal });

      for (const simId of SIM_IDS) {
        /*
         * The phase read a real capability envelope: concentration is
         * `impaired`, not the fail-open default.
         *
         * If this test fails with a budget of 3, the call order in
         * agencyPhase.js was accidentally swapped: `deriveActionBudget`
         * was handed the raw `sim` object instead of `deriveCapabilities(sim)`,
         * it found no `bands`, and it failed open to the full budget of
         * 3. That is a silent regression: the phase still runs and still
         * stores a number, so only the value reveals the fault.
         */
        assert.equal(
          G.agency.capabilities[simId].bands.concentration,
          "impaired",
          `${simId} should be concentration-impaired under kneeling_grate`
        );

        assert.equal(
          G.agency.budgets[simId],
          2,
          `${simId} should have a budget of 2 under kneeling_grate; ` +
            "a budget of 3 means the deriveCapabilities/deriveActionBudget " +
            "call order in agencyPhase.js was swapped and the budget " +
            "failed open"
        );
      }
    }
  );
});
