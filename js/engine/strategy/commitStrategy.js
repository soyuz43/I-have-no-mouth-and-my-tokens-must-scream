// js/engine/strategy/commitStrategy.js

import { G } from "../../core/state.js";

/* ============================================================
   STRATEGY COMMIT

   PURPOSE:
   - Apply validated targets to global strategy state
   - Perform atomic state update
   - Preserve previous assessment history

   DESIGN PRINCIPLES:
   - No parsing
   - No validation
   - No inference
   - Pure state application
   - Atomic mutation (no partial writes)
============================================================ */

export function commitStrategy(validTargets, { DEBUG = true } = {}) {

  if (DEBUG) {
    console.debug("[COMMIT] start");
  }

  /* ------------------------------------------------------------
     DEFENSIVE INIT
  ------------------------------------------------------------ */

  if (!G.amStrategy) {
    G.amStrategy = {};
  }

  const prevTargets = G.amStrategy.targets || {};

  const nextTargets = {};
  const nextActions = [];
  const nextGroupTargets = [];

  /* ------------------------------------------------------------
     BUILD NEXT TARGET STATE
  ------------------------------------------------------------ */

  validTargets.forEach((t, index) => {

    const {
      id,
      objective,
      hypothesis,
      why_now,
      evidence,
      _inferenceConfidence
    } = t;

    if (!id) {
      console.warn(`[COMMIT] target[${index}] missing id — skipping`);
      return;
    }

    nextTargets[id] = {
      objective: objective.trim(),
      hypothesis: hypothesis.trim(),

      reasoning: {
        evidence: evidence.trim(),
        why_now: why_now.trim()
      },

      confidence: _inferenceConfidence ?? 0.5,

      lastAssessment: prevTargets[id]?.lastAssessment || "",

      cycle: G.cycle
    };

    if (DEBUG) {
      console.debug(`[COMMIT] stored target: ${id}`);
    }

  });

  /* ------------------------------------------------------------
     ATOMIC STATE COMMIT
  ------------------------------------------------------------ */

  G.amStrategy.targets = nextTargets;
  G.amStrategy.actions = nextActions;

  if (!G.amStrategy.groupTargets) {
    G.amStrategy.groupTargets = [];
  }

  G.amStrategy.groupTargets = nextGroupTargets;

  /* ------------------------------------------------------------
     DEBUG OUTPUT
  ------------------------------------------------------------ */

  if (DEBUG) {
    console.debug("[COMMIT] complete");

    console.debug("=== COMMITTED TARGETS ===");
    console.table(
      Object.entries(G.amStrategy.targets).map(([id, t]) => ({
        id,
        objective: t.objective?.slice(0, 40),
        hasReasoning: !!t.reasoning
      }))
    );
  }

}