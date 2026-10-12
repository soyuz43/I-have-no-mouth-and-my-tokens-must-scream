import assert from "node:assert/strict";
import test from "node:test";

import { G } from "../core/state.js";
import {
  CONSTRAINT_MAP,
  applyConstraint,
  cleanupExpiredConstraints,
  tickConstraints
} from "../engine/constraints/index.js";

const makeSim = (id = "TEST") => ({
  id,
  hope: 50,
  sanity: 50,
  suffering: 50,
  physical_stress: 0,
  constraints: []
});

function withCycle(cycle, callback) {
  const previousCycle = G.cycle;
  const previousDebugSetting = G.DEBUG_CONSTRAINTS;
  G.cycle = cycle;
  G.DEBUG_CONSTRAINTS = false;
  try {
    return callback();
  } finally {
    G.cycle = previousCycle;
    G.DEBUG_CONSTRAINTS = previousDebugSetting;
  }
}

function captureWarnings(callback) {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args);
  try {
    return { value: callback(), warnings };
  } finally {
    console.warn = originalWarn;
  }
}

function clamp(value, minimum = 0, maximum = 100) {
  return Math.max(minimum, Math.min(maximum, value));
}

function capStep(value) {
  return clamp(value, -5, 5);
}

function floorResistance(value) {
  if (value < 20) return 0.25;
  if (value < 40) return 0.5;
  return 1;
}

function sufferingResistance(value) {
  if (value > 80) return 0.25;
  if (value > 60) return 0.5;
  return 1;
}

function expectedTick(definition, record, before, cycle) {
  let fatigueMultiplier = 1;
  if (definition.fatigue?.growth_rate) {
    fatigueMultiplier += Number(record.elapsed ?? 0) * definition.fatigue.growth_rate;
  }
  fatigueMultiplier = Math.min(fatigueMultiplier, 3);

  const totalMultiplier = fatigueMultiplier * Number(record.stacks ?? 1) * Number(record.intensity ?? 1);
  const scale = 0.18;
  const requestedDeltas = {
    suffering: capStep((definition.effects.suffering_delta || 0) * totalMultiplier * scale) * sufferingResistance(before.suffering),
    sanity: capStep((definition.effects.sanity_delta || 0) * totalMultiplier * scale) * floorResistance(before.sanity),
    hope: capStep((definition.effects.hope_delta || 0) * totalMultiplier * scale) * floorResistance(before.hope),
    physicalStress: (definition.effects.physical_stress_delta || 0) * totalMultiplier * scale
  };
  const after = {
    suffering: clamp(before.suffering + requestedDeltas.suffering),
    sanity: clamp(before.sanity + requestedDeltas.sanity),
    hope: clamp(before.hope + requestedDeltas.hope),
    physicalStress: clamp(before.physicalStress + requestedDeltas.physicalStress)
  };
  const remainingBefore = Number(record.remaining ?? 0);
  const elapsedBefore = Number(record.elapsed ?? 0);

  return {
    cycle,
    elapsedBefore,
    elapsedAfter: elapsedBefore + 1,
    remainingBefore,
    remainingAfter: Math.max(0, remainingBefore - 1),
    stacks: Number(record.stacks ?? 1),
    intensity: Number(record.intensity ?? 1),
    fatigueMultiplier,
    totalMultiplier,
    requestedDeltas,
    before,
    after,
    deltas: {
      suffering: after.suffering - before.suffering,
      sanity: after.sanity - before.sanity,
      hope: after.hope - before.hope,
      physicalStress: after.physicalStress - before.physicalStress
    }
  };
}

test("applyConstraint creates a complete record with a contextual snapshot", () => {
  withCycle(41, () => {
    const definition = CONSTRAINT_MAP.kneeling_grate;
    const sim = makeSim();
    const strategyEvidence = [{ source: "assessment" }];
    const context = {
      strategyObjective: "maintain control",
      strategyHypothesis: "resistance will continue",
      strategyEvidence,
      tacticPath: "coercion/position",
      phaseId: "strategy"
    };
    const duration = definition.duration.max_cycles + 2;

    applyConstraint(sim, definition.id, {
      duration,
      source: "test-source",
      notes: "initial application",
      initialApplicationContext: context
    });

    const record = sim.constraints[0];
    assert.deepEqual(record, {
      id: definition.id,
      path: definition.path,
      title: definition.title,
      category: definition.category,
      content: definition.content,
      subcategory: definition.subcategory,
      type: definition.type,
      remaining: definition.duration.max_cycles,
      stacks: 1,
      intensity: definition.intensity.default,
      elapsed: 0,
      baseCycles: duration,
      maxCycles: definition.duration.max_cycles,
      extendable: !!definition.duration.extendable,
      metadata: {
        source: "test-source",
        appliedAtCycle: 41,
        notes: "initial application",
        initialApplicationContext: context
      },
      lastAppliedCycle: 41
    });
    assert.notStrictEqual(record.metadata.initialApplicationContext.strategyEvidence, strategyEvidence);
    assert.strictEqual(record.metadata.initialApplicationContext.strategyEvidence[0], strategyEvidence[0]);

    strategyEvidence.push({ source: "later mutation" });
    assert.equal(record.metadata.initialApplicationContext.strategyEvidence.length, 1);
  });
});

test("applyConstraint normalizes missing context fields and preserves non-array evidence", () => {
  withCycle(42, () => {
    const sim = makeSim();
    const evidenceObject = { source: "not-an-array" };

    applyConstraint(sim, "kneeling_grate", {
      initialApplicationContext: { strategyEvidence: evidenceObject }
    });

    assert.deepEqual(sim.constraints[0].metadata.initialApplicationContext, {
      strategyObjective: null,
      strategyHypothesis: null,
      strategyEvidence: evidenceObject,
      tacticPath: null,
      phaseId: null
    });
    assert.strictEqual(sim.constraints[0].metadata.initialApplicationContext.strategyEvidence, evidenceObject);

    const nullEvidenceSim = makeSim("NULL-EVIDENCE");
    applyConstraint(nullEvidenceSim, "kneeling_grate", {
      initialApplicationContext: { strategyEvidence: null }
    });
    assert.equal(nullEvidenceSim.constraints[0].metadata.initialApplicationContext.strategyEvidence, null);
  });
});

test("applyConstraint warns and leaves constraints untouched for invalid sims and unknown ids", () => {
  withCycle(43, () => {
    const existingRecord = { id: "existing" };
    const invalidConstraints = [existingRecord];
    const invalidSim = { id: "", constraints: invalidConstraints };
    const invalid = captureWarnings(() => applyConstraint(invalidSim, "kneeling_grate"));

    assert.equal(invalid.warnings.length, 1);
    assert.match(invalid.warnings[0][0], /invalid sim/);
    assert.strictEqual(invalidSim.constraints, invalidConstraints);
    assert.deepEqual(invalidSim.constraints, [existingRecord]);

    const sim = makeSim();
    sim.constraints.push(existingRecord);
    const originalConstraints = sim.constraints;
    const unknown = captureWarnings(() => applyConstraint(sim, "unknown_constraint"));

    assert.equal(unknown.warnings.length, 1);
    assert.match(unknown.warnings[0][0], /missing definition/);
    assert.strictEqual(sim.constraints, originalConstraints);
    assert.deepEqual(sim.constraints, [existingRecord]);
  });
});

test("applyConstraint applies additive stacking increments, caps, and intensity maxima", () => {
  withCycle(44, () => {
    const definition = CONSTRAINT_MAP.kneeling_grate;
    const sim = makeSim();
    const initialDuration = 2;

    applyConstraint(sim, definition.id, { duration: initialDuration, intensity: 1, source: "first" });
    const record = sim.constraints[0];
    G.cycle = 45;
    applyConstraint(sim, definition.id, {
      duration: 99,
      intensity: definition.intensity.max + 1,
      source: "second"
    });

    assert.equal(record.stacks, Math.min(2, definition.stacking.cap));
    assert.equal(record.remaining, Math.min(
      definition.duration.max_cycles,
      Math.min(initialDuration, definition.duration.max_cycles) + definition.duration.base_cycles
    ));
    assert.equal(record.intensity, definition.intensity.max);
    assert.equal(record.baseCycles, initialDuration);
    assert.equal(record.metadata.reapplied, true);
    assert.equal(record.metadata.source, "second");
    assert.equal(record.metadata.appliedAtCycle, 44);
    assert.equal(record.lastAppliedCycle, 45);

    const remainingBeforeThirdApplication = record.remaining;
    G.cycle = 46;
    applyConstraint(sim, definition.id, { intensity: 0.5 });
    assert.equal(record.stacks, definition.stacking.cap);
    assert.equal(record.remaining, Math.min(
      definition.duration.max_cycles,
      remainingBeforeThirdApplication + definition.duration.base_cycles
    ));
    assert.equal(record.intensity, definition.intensity.max);
    assert.equal(record.lastAppliedCycle, 46);
  });
});

test("applyConstraint replaces duration and intensity without changing stacks", () => {
  withCycle(47, () => {
    const definition = CONSTRAINT_MAP.palestinian_chair;
    const sim = makeSim();

    applyConstraint(sim, definition.id, {
      duration: definition.duration.max_cycles,
      intensity: 1,
      source: "first"
    });
    const record = sim.constraints[0];
    record.stacks = 4;
    record.remaining = 0;
    G.cycle = 48;
    applyConstraint(sim, definition.id, {
      duration: 99,
      intensity: definition.intensity.max + 1,
      source: "replacement"
    });

    assert.equal(record.remaining, definition.duration.base_cycles);
    assert.equal(record.intensity, definition.intensity.max);
    assert.equal(record.stacks, 4);
    assert.equal(record.metadata.reapplied, true);
    assert.equal(record.metadata.source, "replacement");
    assert.equal(record.metadata.appliedAtCycle, 47);
    assert.equal(record.lastAppliedCycle, 48);
  });
});

test("applyConstraint leaves existing records unchanged for unknown or absent stacking modes", () => {
  withCycle(49, () => {
    const definition = CONSTRAINT_MAP.kneeling_grate;
    const originalStacking = definition.stacking;

    try {
      for (const mode of ["unrecognized", undefined]) {
        definition.stacking = mode === undefined ? undefined : { ...originalStacking, mode };
        const sim = makeSim();
        applyConstraint(sim, definition.id);
        const record = sim.constraints[0];
        const beforeReapplication = JSON.parse(JSON.stringify(record));

        applyConstraint(sim, definition.id, { intensity: 2, source: "ignored" });
        assert.deepEqual(record, beforeReapplication);
      }
    } finally {
      definition.stacking = originalStacking;
    }
  });
});

test("applyConstraint caps upper bounds but does not clamp negative duration or intensity", () => {
  withCycle(50, () => {
    const definition = CONSTRAINT_MAP.kneeling_grate;
    const highSim = makeSim("HIGH");
    applyConstraint(highSim, definition.id, {
      duration: definition.duration.max_cycles + 10,
      intensity: definition.intensity.max + 10
    });
    assert.equal(highSim.constraints[0].remaining, definition.duration.max_cycles);
    assert.equal(highSim.constraints[0].baseCycles, definition.duration.max_cycles + 10);
    assert.equal(highSim.constraints[0].intensity, definition.intensity.max);

    const lowSim = makeSim("LOW");
    applyConstraint(lowSim, definition.id, { duration: -2, intensity: -1 });
    assert.equal(lowSim.constraints[0].remaining, -2);
    assert.equal(lowSim.constraints[0].baseCycles, -2);
    assert.equal(lowSim.constraints[0].intensity, -1);
  });
});

test("tickConstraints is a no-op without records and warns without mutating unknown definitions", () => {
  withCycle(51, () => {
    const emptySim = makeSim();
    const emptySnapshot = JSON.parse(JSON.stringify(emptySim));
    tickConstraints(emptySim);
    assert.deepEqual(emptySim, emptySnapshot);

    const unknownRecord = {
      id: "unknown_constraint",
      remaining: 2,
      elapsed: 3,
      stacks: 1,
      intensity: 1
    };
    const sim = makeSim();
    sim.constraints.push(unknownRecord);
    const snapshot = JSON.parse(JSON.stringify(unknownRecord));
    const simSnapshot = JSON.parse(JSON.stringify(sim));
    const result = captureWarnings(() => tickConstraints(sim));

    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0][0], /missing definition/);
    assert.strictEqual(sim.constraints[0], unknownRecord);
    assert.deepEqual(unknownRecord, snapshot);
    assert.deepEqual(sim, simSnapshot);
  });
});

test("tickConstraints preserves expired records without effects or elapsed increments", () => {
  withCycle(52, () => {
    const sim = makeSim();
    sim.constraints.push({
      id: "kneeling_grate",
      remaining: 0,
      elapsed: 7,
      stacks: 2,
      intensity: 3
    });
    const simBefore = JSON.parse(JSON.stringify(sim));

    tickConstraints(sim);

    assert.deepEqual(sim, simBefore);
  });
});

test("tickConstraints records fatigue, capped stat steps, resistance, clamping, and evidence", () => {
  withCycle(53, () => {
    const definition = CONSTRAINT_MAP.kneeling_grate;
    const sim = makeSim();
    sim.suffering = 70;
    sim.sanity = 30;
    sim.hope = 10;
    sim.physical_stress = 90;
    applyConstraint(sim, definition.id);
    const record = sim.constraints[0];
    record.remaining = 2;
    record.elapsed = 20;
    record.stacks = 2;
    record.intensity = 3;
    const before = {
      suffering: sim.suffering,
      sanity: sim.sanity,
      hope: sim.hope,
      physicalStress: sim.physical_stress
    };
    const expected = expectedTick(definition, record, before, 53);

    tickConstraints(sim);

    assert.deepEqual(record.lastTick, expected);
    assert.deepEqual({
      suffering: sim.suffering,
      sanity: sim.sanity,
      hope: sim.hope,
      physicalStress: sim.physical_stress
    }, expected.after);
    assert.equal(record.remaining, 1);
    assert.equal(record.elapsed, 21);
    assert.equal(record.lastTick.fatigueMultiplier, 3);
    assert.equal(record.lastTick.totalMultiplier, 3 * 2 * 3);
    assert.equal(record.lastTick.requestedDeltas.physicalStress, 81);
    assert.equal(record.lastTick.deltas.physicalStress, 10);
  });
});

test("tickConstraints applies resistance thresholds at the pre-tick stat values", () => {
  withCycle(54, () => {
    const definition = CONSTRAINT_MAP.kneeling_grate;
    const cases = [
      { hope: 19, sanity: 20, suffering: 60, factors: [0.25, 0.5, 1] },
      { hope: 20, sanity: 40, suffering: 61, factors: [0.5, 1, 0.5] },
      { hope: 40, sanity: 19, suffering: 80, factors: [1, 0.25, 0.5] },
      { hope: 50, sanity: 50, suffering: 81, factors: [1, 1, 0.25] }
    ];

    for (const [index, scenario] of cases.entries()) {
      const sim = makeSim("RESISTANCE-" + index);
      sim.hope = scenario.hope;
      sim.sanity = scenario.sanity;
      sim.suffering = scenario.suffering;
      applyConstraint(sim, definition.id);
      tickConstraints(sim);

      const scale = 0.18;
      assert.deepEqual(sim.constraints[0].lastTick.requestedDeltas, {
        suffering: definition.effects.suffering_delta * scale * scenario.factors[2],
        sanity: definition.effects.sanity_delta * scale * scenario.factors[1],
        hope: definition.effects.hope_delta * scale * scenario.factors[0],
        physicalStress: definition.effects.physical_stress_delta * scale
      });
    }
  });
});

test("tickConstraints grows fatigue by elapsed cycles and caps it at three", () => {
  withCycle(55, () => {
    const definition = CONSTRAINT_MAP.kneeling_grate;
    const scenarios = [
      { elapsed: 2, expected: 1 + 2 * definition.fatigue.growth_rate },
      { elapsed: 100, expected: 3 }
    ];

    for (const [index, scenario] of scenarios.entries()) {
      const sim = makeSim("FATIGUE-" + index);
      applyConstraint(sim, definition.id);
      sim.constraints[0].elapsed = scenario.elapsed;
      tickConstraints(sim);
      assert.equal(sim.constraints[0].lastTick.fatigueMultiplier, scenario.expected);
    }
  });
});

test("tickConstraints processes constraints sequentially in existing array order", () => {
  withCycle(56, () => {
    const sim = makeSim();
    sim.suffering = 59;
    sim.hope = 20;

    applyConstraint(sim, "kneeling_grate");
    applyConstraint(sim, "palestinian_chair");
    assert.deepEqual(sim.constraints.map((record) => record.id), [
      "kneeling_grate",
      "palestinian_chair"
    ]);

    tickConstraints(sim);

    const [first, second] = sim.constraints;
    assert.deepEqual(second.lastTick.before, first.lastTick.after);
    assert.equal(first.lastTick.after.suffering, 59 + 8 * 0.18);
    assert.equal(second.lastTick.before.suffering, first.lastTick.after.suffering);
    assert.equal(second.lastTick.requestedDeltas.suffering, 2.5);
    assert.equal(second.lastTick.before.hope, first.lastTick.after.hope);
    assert.equal(second.lastTick.requestedDeltas.hope, -0.54);
  });
});

test("cleanupExpiredConstraints removes only current-cycle RELEASE records", () => {
  withCycle(57, () => {
    const sim = makeSim();
    const noAssessment = { id: "no-assessment", remaining: 0 };
    const currentContinue = {
      id: "continue",
      remaining: 0,
      lastAssessment: { cycle: 57, constraintDecision: "CONTINUE" }
    };
    const priorRelease = {
      id: "prior-release",
      remaining: 0,
      lastAssessment: { cycle: 56, constraintDecision: "RELEASE" }
    };
    const currentRelease = {
      id: "current-release",
      remaining: 0,
      lastAssessment: { cycle: 57, constraintDecision: "RELEASE" }
    };
    const unexpiredRelease = {
      id: "unexpired-release",
      remaining: 1,
      lastAssessment: { cycle: 57, constraintDecision: "RELEASE" }
    };
    sim.constraints.push(noAssessment, currentContinue, priorRelease, currentRelease, unexpiredRelease);

    const removed = cleanupExpiredConstraints(sim);

    assert.deepEqual(removed, [currentRelease]);
    assert.strictEqual(removed[0], currentRelease);
    assert.deepEqual(sim.constraints, [noAssessment, currentContinue, priorRelease, unexpiredRelease]);
  });
});
