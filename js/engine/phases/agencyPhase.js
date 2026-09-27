// js/engine/phases/agencyPhase.js
//
// Agency Phase — DERIVE AND OBSERVE ONLY.
//
// WHAT THIS PHASE DOES
// --------------------
// For each sim it derives what that prisoner's body can currently do
// (`deriveCapabilities`), enumerates which catalogue actions that opens
// (`enumerateLegalActions`), writes both into `G.agency`, and logs a
// one-line summary. That is the whole of it.
//
// WHAT THIS PHASE DELIBERATELY DOES NOT DO
// -----------------------------------------
//   - No model call. Nothing here prompts anything.
//   - No proposal collection. It does not ask a sim what it wants to do.
//   - No resolution. It does not pick, cost, or commit an action.
//   - No prisoner mutation. It writes only to `G.agency` and to the
//     log/timeline. Stats, beliefs, relationships, and constraints are
//     read-only here.
//
// The phase is a sensor, not an actuator. Its output is a description
// of the current physical possibility space, made available before any
// slice is allowed to act on it. Every statement above is a claim
// about THIS file only; nothing downstream is implied to exist.
//
// WHY IT RUNS HERE
// ----------------
// Immediately after the social phase, before prediction expiry. The
// snapshot is a post-social, post-psychology picture of each prisoner's
// body, and it is taken early enough in the remaining engine stages
// that a later slice could consume it without reordering the pipeline.
//
// FAILURE ISOLATION
// -----------------
// Each sim is wrapped independently and a throw is logged and
// swallowed. One malformed sim must not abort derivation for the other
// four, and must not abort the cycle — this phase produces no effect
// that anything else in the pipeline depends on.

import { G } from "../../core/state.js";
import { SIM_IDS } from "../../core/constants.js";

import { timelineEvent } from "../../ui/timeline.js";
import { addLog } from "../../ui/logs.js";

import { deriveCapabilities } from "../agency/capabilities.js";
import { enumerateLegalActions } from "../agency/legalActions.js";
import { ACTION_DEFINITIONS } from "../agency/actionDefs.js";

/* ============================================================
   PER-SIM DERIVATION
============================================================ */

/*
 * Derive and record one prisoner's possibility space.
 *
 * Split out from the loop so the failure boundary is explicit: any
 * throw inside here is contained by the caller and attributed to a
 * single sim id.
 */
function deriveForSim(sim) {
  const derived = deriveCapabilities(sim);

  /*
   * `deriveCapabilities()` returns an envelope; the enumerator
   * compares against the five capability floats inside it. Passing the
   * envelope rather than `derived.capabilities` would make every
   * requirement look unmet, because none of the requirement keys
   * (concentration, stability, ...) exist at the top level.
   */
  const enumerated = enumerateLegalActions(
    sim,
    derived.capabilities,
    ACTION_DEFINITIONS
  );

  G.agency.capabilities[sim.id] = derived;
  G.agency.legalActions[sim.id] = enumerated.legal;
  G.agency.blockedActions[sim.id] = enumerated.blocked;

  return {
    legalCount: enumerated.legal.length,
    blockedCount: enumerated.blocked.length
  };
}

/* ============================================================
   PHASE ORCHESTRATOR
============================================================ */

export async function runAgencyPhase() {

  timelineEvent(`>>> AGENCY PHASE`);

  /*
   * `G.agency` is a live envelope created by createAgencyState(). It
   * is not re-created here: the phase fills in the current cycle's
   * picture and beginCycle() owns the reset. Replacing the object
   * here would break any reference a caller captured earlier in the
   * cycle.
   */
  G.agency.cycle = G.cycle;

  for (const simId of SIM_IDS) {

    const sim = G.sims?.[simId];

    if (!sim) {
      continue;
    }

    try {
      const { legalCount, blockedCount } =
        deriveForSim(sim);

      console.log(
        `[AGENCY][${sim.id}] ${legalCount} legal, ${blockedCount} blocked`
      );

      addLog(
        `AGENCY // ${sim.id}`,
        `Cycle ${G.cycle}: ${legalCount} legal, ${blockedCount} blocked.`,
        "agency"
      );

    } catch (error) {

      console.error(
        `[AGENCY] derivation failed for ${simId}:`,
        error
      );

      try {
        addLog(
          `AGENCY // ${simId}`,
          `Cycle ${G.cycle}: derivation failed — ${error?.message ?? error}`,
          "agency"
        );
      } catch {
        /*
         * The log layer itself can fail if its DOM feed is missing.
         * An unwritable log must not escalate into a cycle abort.
         */
      }
    }
  }

  G.agency.lastDerivedCycle = G.cycle;

  timelineEvent(`// AGENCY PHASE COMPLETE`);
}

