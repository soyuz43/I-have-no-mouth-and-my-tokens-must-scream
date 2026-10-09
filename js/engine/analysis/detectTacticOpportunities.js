// js/engine/analysis/detectTacticOpportunities.js
//
// PURE STATE ANALYSIS for the tactic evolution engine.
//
// This module owns:
//   - the canonical tactic-evolution thresholds
//   - derived-tactic expiry sweeping + schema purging
//   - per-sim trajectory history tracking, consistency, net magnitude,
//     and relationship-shift detection
//   - the Global Signal Gate calculation
//
// It performs NO LLM calls and commits NO derived tactics. It returns the
// computed discoveries and the global-gate result so the orchestrator can
// decide whether to synthesize tactics via the model.

import { purgeInvalidDerivedTactics } from "../tactics/validateDerivedTactic.js";
import {
  logThresholds,
  logHistoryGate,
  logConsistencyGate,
  logTrajectoryGate,
  logTrajectoryPassed,
} from "./tacticEvolution/logging.js";

const TACTIC_EVOLUTION_THRESHOLDS = Object.freeze({
  historySamples: 2,
  consistency: 0.7,
  relationshipShift: 0.25,
  netMagnitude: 12,
  multiStatDelta: 2,
  totalSignal: 8,
  modelSignal: 6,
});

// Fraction of same-signed samples required for a metric to be judged
// "consistent" across the retained trajectory history.
function consistency(values) {
  const signs = values
    .map((value) => Math.sign(value))
    .filter((value) => value !== 0);

  if (signs.length === 0) {
    return 0;
  }

  const counts = {};

  for (const sign of signs) {
    counts[sign] = (counts[sign] || 0) + 1;
  }

  return (
    Math.max(...Object.values(counts)) /
    signs.length
  );
}

/**
 * Scan simulation state for sustained psychological transformations and
 * compute the Global Signal Gate.
 *
 * @param {Object} G  global engine state (mutated: tacticHistory, derivedTactics)
 * @param {string[]} SIM_IDS  sim identifiers to scan
 * @param {Object} [thresholds]  override thresholds (defaults to canonical)
 * @returns {{ discoveries: Array, globalSignalPassed: boolean, totalSignal: number }}
 */
export function detectTacticOpportunities(
  G,
  SIM_IDS,
  thresholds = TACTIC_EVOLUTION_THRESHOLDS
) {
  logThresholds(thresholds);

  G.tacticHistory ??= {};
  G.tactics.derivedTactics ??= [];

  /* ------------------------------------------------------------
     Remove expired derived tactics
  ------------------------------------------------------------ */

  G.tactics.derivedTactics =
    G.tactics.derivedTactics.filter(
      (tactic) => tactic.expiresCycle >= G.cycle
    );

  // Defense-in-depth: drop any derived tactic that does not conform to the
  // canonical phased schema (e.g. legacy old-format entries), so a
  // malformed tactic can never reach strategy-phase ranking/selection.
  purgeInvalidDerivedTactics(G);

  const discoveries = [];

  /* ------------------------------------------------------------
     SCAN FOR TRAJECTORY-BASED EFFECTS
  ------------------------------------------------------------ */

  for (const id of SIM_IDS) {
    const prev = G.prevCycleSnapshot[id];
    const curr = G.sims[id];

    if (!prev || !curr) {
      continue;
    }

    const deltaHope = curr.hope - prev.hope;
    const deltaSanity = curr.sanity - prev.sanity;
    const deltaSuffering = curr.suffering - prev.suffering;

    G.tacticHistory[id] ??= [];

    G.tacticHistory[id].push({
      cycle: G.cycle,
      hope: deltaHope,
      sanity: deltaSanity,
      suffering: deltaSuffering,
    });

    if (G.tacticHistory[id].length > 4) {
      G.tacticHistory[id].shift();
    }

    const history = G.tacticHistory[id];

    if (history.length < thresholds.historySamples) {
      logHistoryGate({
        thresholds,
        simId: id,
        historyLength: history.length,
        deltaHope,
        deltaSanity,
        deltaSuffering,
      });

      continue;
    }

    const relationshipShifts = [];
    let maxRelationshipDelta = 0;

    for (const other of SIM_IDS) {
      if (other === id) {
        continue;
      }

      const before = prev.relationships?.[other] ?? 0;
      const after = curr.relationships?.[other] ?? 0;
      const delta = after - before;
      const absoluteDelta = Math.abs(delta);

      maxRelationshipDelta = Math.max(
        maxRelationshipDelta,
        absoluteDelta
      );

      if (absoluteDelta >= thresholds.relationshipShift) {
        relationshipShifts.push(
          `${id}→${other}: ` +
            `${before.toFixed(2)} → ` +
            `${after.toFixed(2)} ` +
            `(|Δ| ${absoluteDelta.toFixed(2)})`
        );
      }
    }

    const hopeSeries = history.map((entry) => entry.hope);
    const sanitySeries = history.map((entry) => entry.sanity);
    const sufferingSeries = history.map((entry) => entry.suffering);

    const hopeConsistency = consistency(hopeSeries);
    const sanityConsistency = consistency(sanitySeries);
    const sufferingConsistency = consistency(sufferingSeries);

    const bestConsistency = Math.max(
      hopeConsistency,
      sanityConsistency,
      sufferingConsistency
    );

    if (bestConsistency < thresholds.consistency) {
      logConsistencyGate({
        thresholds,
        simId: id,
        hopeConsistency,
        sanityConsistency,
        sufferingConsistency,
      });

      continue;
    }

    const netHope = history.reduce(
      (sum, entry) => sum + entry.hope,
      0
    );
    const netSanity = history.reduce(
      (sum, entry) => sum + entry.sanity,
      0
    );
    const netSuffering = history.reduce(
      (sum, entry) => sum + entry.suffering,
      0
    );

    const netMagnitude =
      Math.abs(netHope) * 0.6 +
      Math.abs(netSanity) * 0.7 +
      Math.abs(netSuffering) * 0.5;

    const absoluteDeltaHope = Math.abs(deltaHope);
    const absoluteDeltaSanity = Math.abs(deltaSanity);

    const multiStat =
      absoluteDeltaHope > thresholds.multiStatDelta &&
      absoluteDeltaSanity > thresholds.multiStatDelta;

    const relationshipSignal = relationshipShifts.length > 0;
    const structuralSignal = relationshipSignal || multiStat;

    const netMagnitudePassed =
      netMagnitude >= thresholds.netMagnitude;

    if (!netMagnitudePassed || !structuralSignal) {
      logTrajectoryGate({
        thresholds,
        simId: id,
        bestConsistency,
        netMagnitude,
        maxRelationshipDelta,
        absoluteDeltaHope,
        absoluteDeltaSanity,
        relationshipSignal,
        multiStat,
      });

      continue;
    }

    logTrajectoryPassed({
      thresholds,
      simId: id,
      bestConsistency,
      netHope,
      netSanity,
      netSuffering,
      netMagnitude,
      maxRelationshipDelta,
      relationshipSignal,
      multiStat,
    });

    discoveries.push({
      sim: id,
      deltaHope,
      deltaSanity,
      deltaSuffering,
      relationshipShifts,
      netHope,
      netSanity,
      netSuffering,
      netMagnitude,
      bestConsistency,
      maxRelationshipDelta,
      multiStat,
    });
  }

  /* ------------------------------------------------------------
     GLOBAL SIGNAL GATE
  ------------------------------------------------------------ */

  const totalSignal = discoveries.reduce(
    (sum, discovery) =>
      sum +
      Math.abs(discovery.deltaHope) +
      Math.abs(discovery.deltaSanity) +
      Math.abs(discovery.deltaSuffering),
    0
  );

  const globalSignalPassed =
    totalSignal >= thresholds.totalSignal;

  return {
    discoveries,
    globalSignalPassed,
    totalSignal,
  };
}

export { TACTIC_EVOLUTION_THRESHOLDS };