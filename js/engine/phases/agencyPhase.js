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
import { formatAgencySummary } from "../agency/formatAgencySummary.js";

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
    blockedCount: enumerated.blocked.length,

    /*
     * The derived objects are returned alongside the counts so the
     * caller can format an explanation without re-reading
     * `G.agency`. The writes above are the authoritative state; a
     * re-read there would be equivalent, but passing the values
     * the phase already holds keeps "what was logged" and "what
     * was stored" the same object by construction rather than by
     * coincidence of key naming.
     */
    derived,
    legal: enumerated.legal,
    blocked: enumerated.blocked
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

  /*
   * Run totals for the closing timeline marker.
   *
   * Accumulated across the loop rather than recomputed from
   * `G.agency` afterwards, because the loop can `continue` past a
   * missing sim or swallow a per-sim failure, and a total that
   * silently omitted a failed agent would read as a successful
   * derivation of zero. Counting only what was actually derived
   * keeps the marker honest about a partial run.
   */
  let totalLegal = 0;
  let totalBlocked = 0;

  for (const simId of SIM_IDS) {

    const sim = G.sims?.[simId];

    if (!sim) {
      continue;
    }

    try {
      const {
        legalCount,
        blockedCount,
        derived,
        legal,
        blocked
      } = deriveForSim(sim);

      totalLegal += legalCount;
      totalBlocked += blockedCount;

      console.log(
        `[AGENCY][${sim.id}] ${legalCount} legal, ${blockedCount} blocked`
      );

      addLog(
        `AGENCY // ${sim.id}`,
        formatAgencySummary(
          sim.id,
          derived,
          legal,
          blocked
        ),
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

  /*
   * The marker keeps the `//` prefix on purpose: `timelineEvent()`
   * classifies a label as a MARKER by its leading characters and
   * renders the whole label in yellow. Losing the prefix would drop
   * the marker styling and the event would render as an ordinary,
   * word-colourised line indistinguishable from a phase action.
   *
   * The em dash is the same separator the label columns use, so the
   * row reads consistently with the other phase markers.
   */
  timelineEvent(
    `// AGENCY COMPLETE — ${totalLegal} legal, ${totalBlocked} blocked`
  );
}
