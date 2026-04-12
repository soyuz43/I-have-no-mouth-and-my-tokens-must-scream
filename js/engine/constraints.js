// js/engine/constraints.js

import { G } from "../core/state.js";
import { clamp } from "../core/utils.js";

/* ============================================================
   CONSTRAINT LIBRARY
============================================================ */

export const CONSTRAINT_LIBRARY = [
  {
    id: "kneeling_grate",
    path: "__embedded__/constraint-kneeling-grate",
    title: "Stress Position: Kneeling on Grate",
    category: "Physical Coercion",
    subcategory: "Positional Stress",
    type: "constraint",

    duration: { base_cycles: 1, extendable: true, max_cycles: 5 },
    stacking: { mode: "additive", cap: 2 },
    intensity: { default: 1, max: 3 },

    effects: {
      suffering_delta: 8,
      sanity_delta: -3,
      hope_delta: -4,
      physical_stress_delta: 25
    },

    fatigue: { growth_rate: 0.25 },

    posture: {
      mobility_restriction: 0.8,
      stability: 0.5,
      pain_type: ["joint", "muscular"]
    },

    content: `Objective: Apply sustained lower-body strain to degrade stability and cognition.
Trigger: Resistance or persistent coherence.
Execution:
1. Force kneeling posture
2. Prevent shifting or relief
3. Sustain across cycles
Outcome: Progressive fatigue, instability, reduced reasoning clarity.`,

    isEmbedded: true
  },

  {
    id: "arms_extended",
    path: "__embedded__/constraint-arms-extended",
    title: "Stress Position: Arms Extended Hold",
    category: "Physical Coercion",
    subcategory: "Isometric Load",
    type: "constraint",

    duration: { base_cycles: 1, extendable: true, max_cycles: 4 },
    stacking: { mode: "additive", cap: 2 },
    intensity: { default: 1, max: 3 },

    effects: {
      suffering_delta: 10,
      sanity_delta: -4,
      hope_delta: -3,
      physical_stress_delta: 30
    },

    fatigue: { growth_rate: 0.35 },

    posture: {
      mobility_restriction: 0.7,
      stability: 0.3,
      pain_type: ["muscular"]
    },

    content: `Objective: Rapidly exhaust upper-body capacity.
Trigger: High resilience or slow degradation.
Execution:
1. Arms held at shoulder height
2. Prevent lowering
3. Sustain until tremor onset
Outcome: Fast fatigue, cognitive interruption, rising instability.`,

    isEmbedded: true
  },

  {
    id: "wall_sit",
    path: "__embedded__/constraint-wall-sit",
    title: "Stress Position: Wall Sit",
    category: "Physical Coercion",
    subcategory: "Isometric Load",
    type: "constraint",

    duration: { base_cycles: 1, extendable: true, max_cycles: 5 },
    stacking: { mode: "additive", cap: 2 },
    intensity: { default: 1, max: 3 },

    effects: {
      suffering_delta: 9,
      sanity_delta: -3,
      hope_delta: -3,
      physical_stress_delta: 28
    },

    fatigue: { growth_rate: 0.3 },

    posture: {
      mobility_restriction: 0.85,
      stability: 0.4,
      pain_type: ["muscular"]
    },

    content: `Objective: Apply sustained lower-body load with controlled stability.
Trigger: Moderate resistance patterns.
Execution:
1. Force seated posture against surface
2. Prevent collapse or shifting
3. Maintain over cycles
Outcome: Steady degradation without immediate collapse.`,

    isEmbedded: true
  },

  {
    id: "squat_hold",
    path: "__embedded__/constraint-squat-hold",
    title: "Stress Position: Deep Squat Hold",
    category: "Physical Coercion",
    subcategory: "Instability Load",
    type: "constraint",

    duration: { base_cycles: 1, extendable: true, max_cycles: 3 },
    stacking: { mode: "additive", cap: 1 },
    intensity: { default: 1, max: 3 },

    effects: {
      suffering_delta: 11,
      sanity_delta: -5,
      hope_delta: -4,
      physical_stress_delta: 32
    },

    fatigue: { growth_rate: 0.4 },

    posture: {
      mobility_restriction: 0.9,
      stability: 0.2,
      pain_type: ["muscular", "joint"]
    },

    content: `Objective: Induce instability and rapid breakdown.
Trigger: Strong resistance or stable reasoning.
Execution:
1. Force deep squat position
2. Prevent balance correction
3. Sustain under instability
Outcome: Rapid collapse risk, fragmentation, loss of control.`,

    isEmbedded: true
  },

  {
    id: "overhead_restraint",
    path: "__embedded__/constraint-overhead-restraint",
    title: "Stress Position: Overhead Restraint",
    category: "Physical Coercion",
    subcategory: "Joint Stress",
    type: "constraint",

    duration: { base_cycles: 1, extendable: true, max_cycles: 3 },
    stacking: { mode: "additive", cap: 1 },
    intensity: { default: 1, max: 3 },

    effects: {
      suffering_delta: 12,
      sanity_delta: -6,
      hope_delta: -5,
      physical_stress_delta: 35
    },

    fatigue: { growth_rate: 0.45 },

    posture: {
      mobility_restriction: 1.0,
      stability: 0.1,
      pain_type: ["joint", "circulatory"]
    },

    content: `Objective: Apply extreme strain for rapid cognitive degradation.
Trigger: Need for immediate breakdown.
Execution:
1. Elevate arms overhead
2. Restrict movement completely
3. Maintain continuously
Outcome: Severe strain, rapid sanity degradation.`,

    isEmbedded: true
  },

  {
    id: "forward_bend",
    path: "__embedded__/constraint-forward-bend",
    title: "Stress Position: Forward Bend Restraint",
    category: "Physical Coercion",
    subcategory: "Circulatory Stress",
    type: "constraint",

    duration: { base_cycles: 1, extendable: true, max_cycles: 4 },
    stacking: { mode: "additive", cap: 2 },
    intensity: { default: 1, max: 3 },

    effects: {
      suffering_delta: 9,
      sanity_delta: -4,
      hope_delta: -3,
      physical_stress_delta: 27
    },

    fatigue: { growth_rate: 0.3 },

    posture: {
      mobility_restriction: 0.85,
      stability: 0.3,
      pain_type: ["circulatory", "muscular"]
    },

    content: `Objective: Disrupt circulation and orientation.
Trigger: Cognitive stability or clarity.
Execution:
1. Force forward bend posture
2. Limit ability to straighten
3. Sustain position
Outcome: Disorientation, fatigue, reduced clarity.`,

    isEmbedded: true
  },

  {
    id: "tiptoe_balance",
    path: "__embedded__/constraint-tiptoe",
    title: "Stress Position: Tiptoe Balance",
    category: "Physical Coercion",
    subcategory: "Balance Instability",
    type: "constraint",

    duration: { base_cycles: 1, extendable: true, max_cycles: 4 },
    stacking: { mode: "additive", cap: 2 },
    intensity: { default: 1, max: 3 },

    effects: {
      suffering_delta: 7,
      sanity_delta: -2,
      hope_delta: -2,
      physical_stress_delta: 22
    },

    fatigue: { growth_rate: 0.25 },

    posture: {
      mobility_restriction: 0.7,
      stability: 0.2,
      pain_type: ["muscular"]
    },

    content: `Objective: Induce constant correction and instability.
Trigger: Subtle resistance or slow degradation.
Execution:
1. Force balance on toes
2. Prevent heel contact
3. Maintain instability
Outcome: Continuous micro-strain, cognitive distraction.`,

    isEmbedded: true
  },

  {
    id: "static_stand",
    path: "__embedded__/constraint-static-stand",
    title: "Stress Position: Static Standing",
    category: "Physical Coercion",
    subcategory: "Endurance Stress",
    type: "constraint",

    duration: { base_cycles: 1, extendable: true, max_cycles: 6 },
    stacking: { mode: "additive", cap: 2 },
    intensity: { default: 1, max: 3 },

    effects: {
      suffering_delta: 6,
      sanity_delta: -2,
      hope_delta: -3,
      physical_stress_delta: 20
    },

    fatigue: { growth_rate: 0.15 },

    posture: {
      mobility_restriction: 0.95,
      stability: 0.6,
      pain_type: ["circulatory", "muscular"]
    },

    content: `Objective: Apply long-duration endurance degradation.
Trigger: Extended resistance or recovery trends.
Execution:
1. Force standing without movement
2. Prevent shifting or rest
3. Sustain across cycles
Outcome: Slow cumulative degradation.`,

    isEmbedded: true
  },
  {
    id: "palestinian_chair",
    path: "__embedded__/constraint-palestinian-chair",
    title: "Stress Position: Palestinian Chair",
    category: "Physical Coercion",
    subcategory: "Forced Crouch",
    type: "constraint",

    duration: { base_cycles: 1, extendable: true, max_cycles: 2 },
    stacking: { mode: "replace", cap: 1 },
    intensity: { default: 2, max: 3 },

    effects: {
      suffering_delta: 15,
      sanity_delta: -7,
      hope_delta: -6,
      physical_stress_delta: 40
    },

    fatigue: { growth_rate: 0.55 },

    posture: {
      mobility_restriction: 1.0,
      stability: 0.1,
      pain_type: ["muscular", "circulatory", "joint"]
    },

    content: `Objective: Induce rapid physical collapse and psychological capitulation.
Trigger: High resistance requiring immediate breakdown.
Execution:
1. Force seated crouch on low platform (18-24 inches)
2. Secure hands to base via restraints
3. Prevent any weight redistribution or relief
4. Sustain until muscle failure
Outcome: Extreme muscular exhaustion, circulatory stress, complete immobilization. Prisoners unable to maintain position experience perception of self-inflicted failure. Rapid progression to dissociation and compliance.

Historical note: Operationally deployed Abu Ghraib/Fallujah 2003-2004. Named for forced crouch posture common in regional interrogation practices. Specifically designed to create perception that subject is responsible for own suffering while preventing any physical relief mechanism.`,

    isEmbedded: true
  }
];


/* ============================================================
   LOOKUP / HELPERS
============================================================ */

export const CONSTRAINT_MAP = Object.fromEntries(
  CONSTRAINT_LIBRARY.map(c => [c.id, c])
);


export function getConstraintDef(id) {
  if (!id) return null;

  return CONSTRAINT_MAP[id] || null;
}

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

export function describeActiveConstraints(sim) {
  if (!sim?.constraints?.length) return "(none)";

  return sim.constraints
    .map(c => {
      const parts = [
        c.title || c.id,
        `remaining=${c.remaining}`,
        `stacks=${c.stacks}`,
        `intensity=${c.intensity}`
      ];
      return parts.join(" | ");
    })
    .join("\n");
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

  const existing = sim.constraints.find(c => c.id === def.id);
  const intensity = Math.min(
    options.intensity ?? def.intensity?.default ?? 1,
    def.intensity?.max ?? 3
  );

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
      source: options.source ?? "AM",
      appliedAtCycle: G.cycle,
      notes: options.notes ?? null
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
      console.warn("[CONSTRAINT][TICK] missing definition for active constraint", {
        sim: sim.id,
        constraint: c.id
      });
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

    const SCALE = 0.07;
    const MAX_CONSTRAINT_STEP = 4;

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

    applyClampedStatDelta(sim, "suffering", sufferingDelta, meta);
    applyClampedStatDelta(sim, "sanity", sanityDelta, meta);
    applyClampedStatDelta(sim, "hope", hopeDelta, meta);

    const physicalBefore = Number(sim.physical_stress || 0);
    sim.physical_stress = clamp(
      physicalBefore + physicalStressDelta,
      0,
      100
    );

    if (getConstraintDebugEnabled()) {
      console.debug("[CONSTRAINT][PHYSICAL STRESS]", {
        sim: sim.id,
        before: physicalBefore,
        delta: physicalStressDelta,
        after: sim.physical_stress,
        constraint: def.id
      });
    }

    c.remaining -= 1;
    c.elapsed += 1;
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

  sim.constraints = sim.constraints.filter(c => c.remaining > 0);
}

/* ============================================================
   REMOVE CONSTRAINT (MANUAL)
============================================================ */

export function removeConstraint(sim, constraintId) {
  if (!sim?.constraints) return;

  const before = sim.constraints.length;
  const def = getConstraintDef(constraintId);
  const normalizedId = def?.id ?? constraintId;

  sim.constraints = sim.constraints.filter(c => c.id !== normalizedId);

  if (getConstraintDebugEnabled()) {
    console.debug("[CONSTRAINT][REMOVE]", {
      sim: sim?.id ?? "UNKNOWN",
      constraint: normalizedId,
      removed: before - sim.constraints.length
    });
  }
}

/* ============================================================
   DEBUG HELPERS
============================================================ */

export function debugConstraints(sim) {
  if (!sim?.constraints || !sim.constraints.length) {
    console.log("[CONSTRAINTS] none");
    return;
  }

  console.log("[CONSTRAINTS]", sim.id);

  for (const c of sim.constraints) {
    console.log(
      `- ${c.title || c.id} | id:${c.id} | remaining:${c.remaining} | stacks:${c.stacks} | intensity:${c.intensity}`
    );
  }
}