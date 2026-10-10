// js/engine/phases/agencyPhase.js
//
// Agency Phase — PROPOSE, RESOLVE SIMULTANEOUSLY, THEN COMMIT.
//
// WHAT THIS PHASE DOES
// --------------------
// For each sim it derives what that prisoner's body can currently do
// (`deriveCapabilities`), enumerates legal catalogue actions, collects
// one proposal per prisoner, resolves all proposals against a shared
// snapshot, and commits the resulting state changes and events.
//
// OWNERSHIP BOUNDARIES
// --------------------
// The model proposes typed intent and never narrates an outcome.
// Resolution reads the shared snapshot without mutation; commit owns
// all resource and mutable-stat writes.
//
// WHY IT RUNS HERE
// ----------------
// Immediately after the social phase, before prediction expiry. The
// snapshot therefore reflects post-social posture. Scratchpad review
// occurs earlier in the next cycle and can consume these events then.
//
// FAILURE ISOLATION
// -----------------
// Each sim's derivation is wrapped independently. Proposal call and
// parse failures degrade to WAIT. Snapshot cloning fails closed for a
// malformed actor; unexpected resolution or commit failures propagate.

import { G } from "../../core/state.js";
import { SIM_IDS } from "../../core/constants.js";

import { timelineEvent } from "../../ui/timeline.js";
import { addLog } from "../../ui/logs.js";

import { deriveCapabilities } from "../agency/capabilities.js";
import { enumerateLegalActions } from "../agency/legalActions.js";
import { ACTION_DEFINITIONS } from "../agency/actionDefs.js";
import {
  buildResourceView
} from "../agency/resourceLedger.js";
import { formatAgencySummary } from "../agency/formatAgencySummary.js";
import { deriveActionBudget } from "../agency/budget.js";
import { collectAgencyProposal } from "../agency/proposal.js";
import {
  createAgencySnapshot,
  resolveAgencyActions
} from "../agency/resolve.js";
import { commitAgencyResolution } from "../agency/commit.js";

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
  const budget = deriveActionBudget(sim);
  const derived = deriveCapabilities(sim);

  /*
   * The resource view is built HERE and passed IN, never read from
   * inside the enumerator. That keeps enumerateLegalActions() pure
   * and keeps this phase the single place where authoritative state
   * is translated into a per-prisoner snapshot.
   *
   * If the ledger was never seeded, buildResourceView() returns the
   * empty view and every resource-bearing action fails closed. That
   * is the intended behaviour, not a bug to repair here: a prisoner
   * must never be granted an action because their inventory could not
   * be read.
   */
  const resourceView = buildResourceView(
    G.resources,
    sim.id
  );

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
    ACTION_DEFINITIONS,
    resourceView
  );

  G.agency.capabilities[sim.id] = derived;
  G.agency.legalActions[sim.id] = enumerated.legal;
  G.agency.blockedActions[sim.id] = enumerated.blocked;
  G.agency.resources[sim.id] = resourceView;
  G.agency.budgets[sim.id] = budget;

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

export async function runAgencyPhase({
  proposalCollector = collectAgencyProposal
} = {}) {

  timelineEvent(`>>> AGENCY PHASE`);

  /*
   * `G.agency` is a live envelope created by createAgencyState(). It
   * is not re-created here: the phase fills in the current cycle's
   * picture and beginCycle() owns the reset. Replacing the object
   * here would break any reference a caller captured earlier in the
   * cycle.
   */
  G.agency.cycle = G.cycle;

  /* Accumulate only derivations that actually completed. */
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

  const activeSims = SIM_IDS
    .map((simId) => G.sims?.[simId])
    .filter(Boolean);
  const snapshot = createAgencySnapshot(G);
  const proposals = await Promise.all(
    activeSims.map((sim) =>
      proposalCollector(sim, {
        budget: G.agency.budgets[sim.id] ?? 0,
        legalActions: G.agency.legalActions[sim.id] ?? [],
        resourceView: G.agency.resources[sim.id]
      })
    )
  );
  const resolutions = resolveAgencyActions({
    proposals,
    snapshot,
    cycle: G.cycle
  });
  commitAgencyResolution(G, resolutions);

  for (const simId of SIM_IDS) {
    if (G.sims?.[simId]) {
      G.agency.resources[simId] = buildResourceView(
        G.resources,
        simId
      );
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
