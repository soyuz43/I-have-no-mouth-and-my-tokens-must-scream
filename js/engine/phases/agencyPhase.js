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
// It also runs the Capability-Ledger Entanglement rule: a prisoner
// whose body can no longer conceal what they hold has those items
// exposed, which puts them into AM's attention roll. That rule runs
// AFTER the capability derivation and BEFORE the proposals are
// collected, so an exposed item is already open when the prisoner
// decides what to do with it and when AM later looks at it.
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
import {
  commitConcealmentExposures
} from "../agency/capabilityConcealmentRule.js";
import { enumerateLegalActions } from "../agency/legalActions.js";
import { buildClaimView } from "../agency/claimView.js";
import { ACTION_DEFINITIONS } from "../agency/actionDefs.js";
import {
  buildResourceView
} from "../agency/resourceLedger.js";
import { formatAgencySummary } from "../agency/formatAgencySummary.js";
import { deriveActionBudget } from "../agency/budget.js";
import { collectAgencyProposal } from "../agency/proposal.js";
import { getTier1Goal } from "../scratchpad/goals/registry.js";
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
   * The BELIEF-side view, built here and passed IN for the same
   * reason the objective view is built here: the enumerator and the
   * proposal validator must never read authoritative state directly.
   *
   * The claim view carries the prisoner's own accounting of what they
   * hold, plus the fresh divergences that license an attempt on
   * something the world has taken.
   */
  const claimView = buildClaimView(G, sim.id, G.cycle);

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
    resourceView,
    G.cycle,
    claimView
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
   CAPABILITY-LEDGER ENTANGLEMENT
============================================================ */

/*
 * The capability state a prisoner had at the END of the previous
 * cycle.
 *
 * `beginCycle()` captures `G.prevCycleSnapshot` before the current
 * cycle's strategy phase applies any new restraint, so this
 * reconstruction is exactly what the prisoner was living with when
 * the previous cycle closed. Deriving capabilities over that
 * snapshot reproduces the previous cycle's bands.
 *
 * Returning null when the snapshot is absent or malformed is the
 * fail-closed choice: a world that has not run a cycle yet has no
 * prior capability state, so there is nothing to enforce.
 */
function derivePriorCycleCapabilities(simId) {
  const snapshot = G.prevCycleSnapshot?.[simId];

  if (!snapshot || typeof snapshot !== "object") {
    return null;
  }

  return deriveCapabilities(snapshot);
}

/*
 * Expose whatever this prisoner can no longer hide.
 *
 * Runs at the START of the agency phase, after the current
 * capability derivation and before any proposal is collected, so an
 * exposed item is already open in the world the prisoners are about
 * to act on.
 *
 * The rule reads the PREVIOUS cycle's capability state, which is
 * what gives the milestone its one-cycle latency: a restraint
 * applied in cycle N costs the prisoner their concealment at the
 * start of cycle N+1.
 */
function exposeConcealedResources(sim) {
  const priorCapabilities = derivePriorCycleCapabilities(sim.id);

  if (!priorCapabilities) {
    return [];
  }

  return commitConcealmentExposures(
    G,
    sim,
    priorCapabilities,
    G.resources?.instances ?? []
  );
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
  let totalExposed = 0;

  for (const simId of SIM_IDS) {

    const sim = G.sims?.[simId];

    if (!sim) {
      continue;
    }

    try {
      /*
       * The entanglement rule runs BEFORE the derivation so the
       * resource view the enumerator reads, and therefore the
       * proposal the prisoner makes, already reflect the exposure.
       *
       * It reads the previous cycle's capability state, so the
       * restraint that broke this prisoner's hands in cycle N costs
       * them their concealment at the start of cycle N+1.
       */
      const exposures = exposeConcealedResources(sim);

      totalExposed += exposures.length;

      for (const exposure of exposures) {
        timelineEvent(
          `// EXPOSURE ${exposure.resourceId} → ${sim.id} (${exposure.definitionTitle}) [${exposure.cause}]`
        );
      }

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
        resourceView: G.agency.resources[sim.id],
        /*
         * The belief view is rebuilt here rather than carried over
         * from the derivation loop, so a prisoner whose derivation
         * failed still gets a claim view. It is a pure projection of
         * the claim ledger, and nothing has mutated the ledger
         * between the two reads.
         */
        claimView: buildClaimView(G, sim.id, G.cycle)
      })
    )
  );
  const resolutions = resolveAgencyActions({
    proposals,
    snapshot,
    cycle: G.cycle
  });
  const goalStateBefore = Object.fromEntries(
    activeSims.map((sim) => [
      sim.id,
      {
        activeGoalId: sim.scratchpad?.activeGoal?.id ?? null,
        goalHistory: new Set(
          Array.isArray(sim.scratchpad?.goalHistory)
            ? sim.scratchpad.goalHistory
            : []
        )
      }
    ])
  );
  commitAgencyResolution(G, resolutions, {
    goalSelections: activeSims.map((sim, index) => ({
      actorId: sim.id,
      selectedObjective: proposals[index]?.selectedObjective
    }))
  });

  const proposalsByActor = new Map(
    proposals.map((proposal) => [proposal.actorId, proposal])
  );
  for (const simId of SIM_IDS) {
    const sim = G.sims?.[simId];
    if (!sim) continue;

    const goalState = goalStateBefore[simId];
    const newTerminalGoals = Array.isArray(sim.scratchpad?.goalHistory)
      ? sim.scratchpad.goalHistory.filter(
        (goal) => !goalState?.goalHistory.has(goal)
      )
      : [];

    for (const goal of newTerminalGoals) {
      if (goal.status !== "completed" && goal.status !== "abandoned") continue;
      timelineEvent(
        `>>> GOAL: ${simId} [${goal.status}: ${goal.id}, reason: ${goal.terminalReason ?? "unknown"}] cyc ${G.cycle}`
      );
    }

    const activeGoal = sim.scratchpad?.activeGoal;
    if (activeGoal?.id && activeGoal.id !== goalState?.activeGoalId) {
      const selectedObjective = proposalsByActor.get(simId)?.selectedObjective;
      const origin = getTier1Goal(selectedObjective, G.cycle) ? "LLM" : "fallback";
      timelineEvent(
        `>>> GOAL: ${simId} [new: ${activeGoal.id}, ${origin}] cyc ${G.cycle}`
      );
    }
  }

  for (const simId of SIM_IDS) {
    const event = G.agency.events.filter(
      (agencyEvent) =>
        agencyEvent?.cycle === G.cycle && agencyEvent.actorId === simId
    )[0];
    if (!event) continue;

    const actionType = event.actionType ?? "WAIT";
    const actionLabel = actionType === "WAIT" ? "WAIT (no-op)" : actionType;
    const resources = Array.isArray(event.provenance?.resourceIds)
      ? event.provenance.resourceIds.filter(Boolean).join(", ")
      : event.provenance?.resourceId ?? "";

    addLog(
      `AGENCY // ${simId}`,
      `Chose: ${actionLabel}\nAction type: ${actionType}\nStatus: ${event.status ?? "unknown"}\nReason: ${event.provenance?.resolutionReason ?? "—"}\nTarget: ${event.provenance?.targetId ?? "—"}\nResource: ${resources || "—"}`,
      "agency"
    );
  }

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
    `// AGENCY COMPLETE — ${totalLegal} legal, ${totalBlocked} blocked, ${totalExposed} exposed`
  );
}
