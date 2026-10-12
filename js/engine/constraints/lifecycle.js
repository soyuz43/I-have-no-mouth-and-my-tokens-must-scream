import { G } from "../../core/state.js";
import { clamp } from "../../core/utils.js";
import { getConstraintDef } from "./definitions.js";

function resolveEffect(base) {
  return base; // deterministic for now
}

function getConstraintDebugEnabled() {
  return !!G.DEBUG_CONSTRAINTS;
}

function logConstraintClamp(sim, statKey, before, delta, rawAfter, clampedAfter, meta = {}) {
  console.warn("[CONSTRAINT][CLAMP]", {
    sim: sim?.id ?? "UNKNOWN",
    stat: statKey,
    before,
    delta,
    rawAfter,
    clampedAfter,
    meta
  });
}

function applyClampedStatDelta(sim, statKey, delta, meta = {}) {
  const before = Number(sim?.[statKey] ?? 0);
  const rawAfter = before + delta;
  const clampedAfter = clamp(rawAfter, 0, 100);

  sim[statKey] = clampedAfter;

  if (rawAfter !== clampedAfter) {
    logConstraintClamp(sim, statKey, before, delta, rawAfter, clampedAfter, meta);
  } else if (getConstraintDebugEnabled()) {
    console.debug("[CONSTRAINT][STAT APPLY]", {
      sim: sim?.id ?? "UNKNOWN",
      stat: statKey,
      before,
      delta,
      after: clampedAfter,
      meta
    });
  }
}

/* ============================================================
   APPLY CONSTRAINT
============================================================ */

export function applyConstraint(sim, constraintId, options = {}) {
  if (!sim || !sim.id) {
    console.warn("[CONSTRAINT] apply skipped: invalid sim", sim);
    return;
  }

  sim.constraints ??= [];

  const def = getConstraintDef(constraintId);
  if (!def) {
    console.warn("[CONSTRAINT] missing definition:", constraintId);
    return;
  }

  const existing =
    sim.constraints.find(
      (constraint) =>
        constraint.id === def.id
    );

  const intensity =
    Math.min(
      options.intensity ??
      def.intensity?.default ??
      1,

      def.intensity?.max ??
      3
    );

  const incomingApplicationContext =
    options.initialApplicationContext &&
      typeof options.initialApplicationContext ===
      "object" &&
      !Array.isArray(
        options.initialApplicationContext
      )
      ? options.initialApplicationContext
      : {};

  /*
   * Store a normalized snapshot rather than retaining references to
   * the mutable current-cycle strategy and tactic-runtime objects.
   */
  const initialApplicationContext = {
    strategyObjective:
      incomingApplicationContext
        .strategyObjective ?? null,

    strategyHypothesis:
      incomingApplicationContext
        .strategyHypothesis ?? null,

    strategyEvidence:
      Array.isArray(
        incomingApplicationContext
          .strategyEvidence
      )
        ? [
          ...incomingApplicationContext
            .strategyEvidence
        ]
        : incomingApplicationContext
          .strategyEvidence ?? null,

    tacticPath:
      incomingApplicationContext
        .tacticPath ?? null,

    phaseId:
      incomingApplicationContext
        .phaseId ?? null
  };

  if (existing) {
    if (def.stacking?.mode === "replace") {
      existing.remaining = def.duration.base_cycles;
      existing.intensity = intensity;
      existing.lastAppliedCycle = G.cycle;
      existing.metadata = {
        ...(existing.metadata || {}),
        reapplied: true,
        source: options.source ?? existing.metadata?.source ?? "AM"
      };

      if (getConstraintDebugEnabled()) {
        console.debug("[CONSTRAINT][REPLACE]", {
          sim: sim.id,
          constraint: def.id,
          remaining: existing.remaining,
          intensity: existing.intensity
        });
      }

      return;
    }

    if (def.stacking?.mode === "additive") {
      const cap = def.stacking?.cap ?? 1;

      if (existing.stacks < cap) {
        existing.stacks += 1;
      }

      existing.remaining = Math.min(
        def.duration.max_cycles,
        existing.remaining + def.duration.base_cycles
      );

      existing.intensity = Math.max(existing.intensity, intensity);
      existing.lastAppliedCycle = G.cycle;
      existing.metadata = {
        ...(existing.metadata || {}),
        reapplied: true,
        source: options.source ?? existing.metadata?.source ?? "AM"
      };

      if (getConstraintDebugEnabled()) {
        console.debug("[CONSTRAINT][STACK]", {
          sim: sim.id,
          constraint: def.id,
          stacks: existing.stacks,
          remaining: existing.remaining,
          intensity: existing.intensity
        });
      }

      return;
    }

    if (getConstraintDebugEnabled()) {
      console.debug("[CONSTRAINT][SKIP EXISTING]", {
        sim: sim.id,
        constraint: def.id,
        mode: def.stacking?.mode ?? "none"
      });
    }

    return;
  }

  sim.constraints.push({
    id: def.id,
    path: def.path,
    title: def.title,
    category: def.category,
    content: def.content,
    subcategory: def.subcategory,
    type: def.type,

    remaining: Math.min(
      Number(options.duration ?? def.duration.base_cycles),
      def.duration.max_cycles
    ),
    stacks: 1,
    intensity,
    elapsed: 0,

    baseCycles: Number(options.duration ?? def.duration.base_cycles),
    maxCycles: def.duration.max_cycles,
    extendable: !!def.duration.extendable,

    metadata: {
      source:
        options.source ?? "AM",

      appliedAtCycle: G.cycle,

      notes: options.notes ?? null,

      /*
       * Immutable contextual snapshot of why this constraint was
       * introduced at its initial application.
       */
      initialApplicationContext
    },

    lastAppliedCycle: G.cycle
  });

  if (getConstraintDebugEnabled()) {
    console.debug("[CONSTRAINT][NEW]", {
      sim: sim.id,
      constraint: def.id,
      title: def.title,
      remaining: Math.min(
        Number(options.duration ?? def.duration.base_cycles),
        def.duration.max_cycles
      ),
      stacks: 1,
      intensity
    });
  }
}

/* ============================================================
   TICK CONSTRAINTS (RUN EACH CYCLE)
   Direct stat mutation model:
   constraints are parallel state forces, separate from journal deltas.
============================================================ */

export function tickConstraints(sim) {
  if (!sim || !sim.id) return;
  if (!sim.constraints || !sim.constraints.length) return;

  for (const c of sim.constraints) {
    const def = getConstraintDef(c.id);
    const elapsed = Number(c.elapsed ?? 0);
    const stacks = Number(c.stacks ?? 1);
    const intensity = Number(c.intensity ?? 1);
    const remaining = Number(c.remaining ?? 0);

    if (!def) {
      console.warn(
        "[CONSTRAINT][TICK] missing definition for active constraint",
        {
          sim: sim.id,
          constraint: c.id
        }
      );

      continue;
    }

    /*
     * A zero-remaining constraint may be waiting for post-cycle
     * assessment. Preserve it, but never apply its effects again.
     */
    // SAFETY: This guard skips STAT EFFECTS for zero-remaining constraints.
    // It does NOT release the prisoner from the physical position.
    // Physical gating (capability derivation) must NOT be added to this function.
    // Capability gating must check array membership in sim.constraints,
    // not the remaining value. See js/engine/agency/capabilities.js.
    if (remaining <= 0) {
      if (getConstraintDebugEnabled()) {
        console.debug(
          "[CONSTRAINT][TICK SKIP EXPIRED]",
          {
            sim: sim.id,
            constraint: c.id,
            remaining
          }
        );
      }

      continue;
    }

    let fatigueMult = 1;

    if (def.fatigue?.growth_rate) {
      fatigueMult += elapsed * def.fatigue.growth_rate;
    }

    fatigueMult = Math.min(fatigueMult, 3);

    const stackMult = stacks;
    const intensityMult = intensity;
    const totalMult = fatigueMult * stackMult * intensityMult;

    const e = def.effects || {};

    const SCALE = 0.18;
    const MAX_CONSTRAINT_STEP = 5;

    function capStep(x) {
      return Math.max(-MAX_CONSTRAINT_STEP, Math.min(MAX_CONSTRAINT_STEP, x));
    }

    // Resistance functions
    function floorResist(v) {
      // For hope/sanity: harder to reduce when already low
      if (v < 20) return 0.25;
      if (v < 40) return 0.5;
      return 1;
    }

    function sufferingResist(v) {
      // For suffering: harder to increase when already high
      if (v > 80) return 0.25;
      if (v > 60) return 0.5;
      return 1;
    }

    const sufferingDeltaRaw =
      resolveEffect(e.suffering_delta || 0) * totalMult * SCALE;

    const sanityDeltaRaw =
      resolveEffect(e.sanity_delta || 0) * totalMult * SCALE;

    const hopeDeltaRaw =
      resolveEffect(e.hope_delta || 0) * totalMult * SCALE;

    const physicalStressDelta =
      (e.physical_stress_delta || 0) * totalMult * SCALE;

    const sufferingDelta =
      capStep(sufferingDeltaRaw) * sufferingResist(sim.suffering);   // ← CHANGED

    const sanityDelta =
      capStep(sanityDeltaRaw) * floorResist(sim.sanity);

    const hopeDelta =
      capStep(hopeDeltaRaw) * floorResist(sim.hope);

    const meta = {
      constraintId: def.id,
      title: def.title,
      elapsed: elapsed,
      remaining: remaining,
      stacks: stacks,
      intensity: intensity,
      fatigueMult,
      totalMult
    };

    if (getConstraintDebugEnabled()) {
      console.debug("[CONSTRAINT][TICK]", {
        sim: sim.id,
        ...meta,
        deltas: {
          suffering: sufferingDelta,
          sanity: sanityDelta,
          hope: hopeDelta,
          physical_stress: physicalStressDelta
        }
      });
    }

    /*
     * Capture state immediately before this individual constraint
     * mutates the sim. This lets assessment distinguish the direct
     * effect of this constraint from tactic and other constraint effects.
     */
    const before = {
      suffering:
        Number(sim.suffering ?? 0),

      sanity:
        Number(sim.sanity ?? 0),

      hope:
        Number(sim.hope ?? 0),

      physicalStress:
        Number(sim.physical_stress ?? 0)
    };

    applyClampedStatDelta(
      sim,
      "suffering",
      sufferingDelta,
      meta
    );

    applyClampedStatDelta(
      sim,
      "sanity",
      sanityDelta,
      meta
    );

    applyClampedStatDelta(
      sim,
      "hope",
      hopeDelta,
      meta
    );

    sim.physical_stress =
      clamp(
        before.physicalStress +
        physicalStressDelta,
        0,
        100
      );

    const after = {
      suffering:
        Number(sim.suffering ?? 0),

      sanity:
        Number(sim.sanity ?? 0),

      hope:
        Number(sim.hope ?? 0),

      physicalStress:
        Number(sim.physical_stress ?? 0)
    };

    c.remaining =
      Math.max(
        0,
        remaining - 1
      );

    c.elapsed =
      elapsed + 1;

    /*
     * Persist both requested and actually applied deltas.
     *
     * Applied deltas may be smaller because state values are clamped
     * and resistance functions weaken effects near their limits.
     */
    c.lastTick = {
      cycle:
        G.cycle,

      elapsedBefore:
        elapsed,

      elapsedAfter:
        c.elapsed,

      remainingBefore:
        remaining,

      remainingAfter:
        c.remaining,

      stacks,
      intensity,

      fatigueMultiplier:
        fatigueMult,

      totalMultiplier:
        totalMult,

      requestedDeltas: {
        suffering:
          sufferingDelta,

        sanity:
          sanityDelta,

        hope:
          hopeDelta,

        physicalStress:
          physicalStressDelta
      },

      before,

      after,

      deltas: {
        suffering:
          after.suffering -
          before.suffering,

        sanity:
          after.sanity -
          before.sanity,

        hope:
          after.hope -
          before.hope,

        physicalStress:
          after.physicalStress -
          before.physicalStress
      }
    };

    if (getConstraintDebugEnabled()) {
      console.debug(
        "[CONSTRAINT][PHYSICAL STRESS]",
        {
          sim: sim.id,
          before:
            before.physicalStress,
          delta:
            c.lastTick.deltas
              .physicalStress,
          after:
            after.physicalStress,
          constraint:
            def.id
        }
      );

      console.debug(
        "[CONSTRAINT][TICK EVIDENCE]",
        {
          sim: sim.id,
          constraint: def.id,
          lastTick:
            c.lastTick
        }
      );
    }
  }

  if (getConstraintDebugEnabled()) {
    console.debug("[CONSTRAINT][AFTER TICK]", {
      sim: sim.id,
      suffering: sim.suffering,
      hope: sim.hope,
      sanity: sim.sanity,
      physical_stress: sim.physical_stress,
      active: sim.constraints.map(c => ({
        id: c.id,
        remaining: c.remaining,
        stacks: c.stacks,
        intensity: c.intensity
      }))
    });
  }

  /*
   * Do not remove zero-remaining constraints here.
   *
   * A constraint that just completed its scheduled duration must remain
   * available through evaluation so constraint assessment can inspect
   * its last tick and choose whether to renew or release it.
   *
   * Post-assessment cleanup is handled separately.
   */

}


/* ============================================================
   CLEAN UP EXPIRED CONSTRAINTS
============================================================ */

export function cleanupExpiredConstraints(
  sim
) {
  if (
    !sim?.constraints ||
    !Array.isArray(sim.constraints)
  ) {
    return [];
  }

  /*
   * A zero-remaining constraint is removable only after the current
   * cycle's assessment explicitly chooses RELEASE.
   *
   * Zero-remaining constraints without a current assessment must remain
   * available so a failed or skipped assessment cannot silently delete
   * them.
   */
  const shouldRemove =
    (constraint) =>
      Number(
        constraint?.remaining ?? 0
      ) <= 0 &&
      constraint?.lastAssessment
        ?.cycle === G.cycle &&
      constraint?.lastAssessment
        ?.constraintDecision ===
        "RELEASE";

  const removed =
    sim.constraints.filter(
      shouldRemove
    );

  sim.constraints =
    sim.constraints.filter(
      (constraint) =>
        !shouldRemove(constraint)
    );

  if (
    removed.length &&
    getConstraintDebugEnabled()
  ) {
    console.debug(
      "[CONSTRAINT][CLEANUP RELEASED]",
      {
        sim:
          sim.id,

        removed:
          removed.map(
            (constraint) => ({
              id:
                constraint.id,

              remaining:
                constraint.remaining,

              lastTickCycle:
                constraint.lastTick
                  ?.cycle ?? null,

              assessmentCycle:
                constraint.lastAssessment
                  ?.cycle ?? null,

              lastConstraintDecision:
                constraint.lastAssessment
                  ?.constraintDecision ??
                null
            })
          )
      }
    );
  }

  return removed;
}

/* ============================================================
   REMOVE CONSTRAINT (MANUAL)
============================================================ */
