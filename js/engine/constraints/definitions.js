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

      hand_use: 0.8,
      concentration: 0.5,
      interaction_reach: 0.4,

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

      hand_use: 0.2,
      concentration: 0.5,
      interaction_reach: 0.3,

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

      hand_use: 0.7,
      concentration: 0.4,
      interaction_reach: 0.5,

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

      hand_use: 0.4,
      concentration: 0.3,
      interaction_reach: 0.3,

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

      hand_use: 0.0,
      concentration: 0.3,
      interaction_reach: 0.1,

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

      hand_use: 0.5,
      concentration: 0.4,
      interaction_reach: 0.4,

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

      hand_use: 0.5,
      concentration: 0.4,
      interaction_reach: 0.3,

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

      hand_use: 0.6,
      concentration: 0.5,
      interaction_reach: 0.4,

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

      hand_use: 0.0,
      concentration: 0.2,
      interaction_reach: 0.0,

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
