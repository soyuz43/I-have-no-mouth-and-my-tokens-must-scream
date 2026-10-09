// js/engine/analysis/tacticEvolution.js
//
// ORCHESTRATOR for the tactic evolution engine.
//
// Responsibilities:
//   - gate the run on the presence of a previous cycle snapshot
//   - delegate pure state analysis to detectTacticOpportunities
//   - evaluate the Global Signal Gate
//   - delegate per-effect LLM synthesis to synthesizeDerivedTactic
//
// All trajectory math, thresholds, the model prompt, validation, and the
// tactic-commit mutation live in the two dedicated modules.

import { G } from "../../core/state.js";
import { SIM_IDS } from "../../core/constants.js";
import {
  logRunStart,
  logRunComplete,
  logStatus,
  logNumericComparison,
} from "./tacticEvolution/logging.js";
import {
  detectTacticOpportunities,
  TACTIC_EVOLUTION_THRESHOLDS,
} from "./detectTacticOpportunities.js";
import { synthesizeDerivedTactic } from "./synthesizeDerivedTactic.js";

export async function runTacticEvolution() {
  logRunStart();

  if (!G.prevCycleSnapshot) {
    logStatus({
      status: "SKIPPED",
      message: "no previous cycle snapshot is available.",
    });

    logRunComplete();

    return;
  }

  const { discoveries, globalSignalPassed, totalSignal } =
    detectTacticOpportunities(G, SIM_IDS);

  if (discoveries.length === 0) {
    logStatus({
      status: "SKIPPED",
      message:
        "global gate not reached; 0 trajectory candidates passed and no model calls will run.",
    });

    logRunComplete();

    return;
  }

  logStatus({
    status: globalSignalPassed ? "PASSED" : "SKIPPED",
    message:
      `global signal gate; ${discoveries.length} candidate` +
      `${discoveries.length === 1 ? "" : "s"}.`,
    passed: globalSignalPassed,
  });

  logNumericComparison({
    label: "Global signal",
    actual: totalSignal,
    required: TACTIC_EVOLUTION_THRESHOLDS.totalSignal,
  });

  if (!globalSignalPassed) {
    logRunComplete();

    return;
  }

  const sample = discoveries.slice(0, 3);

  for (const effect of sample) {
    await synthesizeDerivedTactic(
      G,
      effect,
      TACTIC_EVOLUTION_THRESHOLDS
    );
  }

  logRunComplete();
}