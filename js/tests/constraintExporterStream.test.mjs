import assert from "node:assert/strict";
import test from "node:test";

import { G } from "../core/state.js";
import { cleanupExpiredConstraints } from "../engine/constraints/index.js";
import { recordConstraints } from "../utils/exporter/streams/social.js";
import { Exporter } from "../utils/exporter/state.js";

function withConstraintBuffer(callback) {
  const previousBuffer = Exporter.buffers.constraints;
  const previousRunId = Exporter.runId;
  Exporter.buffers.constraints = [];
  Exporter.runId = "constraint-export-stream-test";

  try {
    return callback(Exporter.buffers.constraints);
  } finally {
    Exporter.buffers.constraints = previousBuffer;
    Exporter.runId = previousRunId;
  }
}

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

test("recordConstraints emits the active constraint stream fields", () => {
  withConstraintBuffer((buffer) => {
    recordConstraints({
      sims: {
        TED: {
          constraints: [{
            id: "constraint-id",
            title: "Constraint title",
            subcategory: "physical",
            source: "assessment",
            appliedAt: 12,
            intensity: 0.65,
            remaining: 3,
            duration: 8,
            stacks: 2,
            fatigueMult: 1.4,
            totalMult: 0.7,
            physicalStressAdded: 4,
            effectiveRange: { min: 10, max: 25 }
          }]
        }
      }
    }, 14);

    assert.equal(buffer.length, 1);
    const [record] = buffer;
    assert.deepEqual(Object.keys(record).sort(), [
      "agent",
      "applied_cycle",
      "constraint_subcategory",
      "constraint_title",
      "constraint_type",
      "cycle",
      "cycle_id",
      "duration_remaining",
      "duration_total",
      "effective_suffering_range_max",
      "effective_suffering_range_min",
      "fatigue_multiplier",
      "intensity",
      "physical_stress_added",
      "recorded_at",
      "run_id",
      "schema_version",
      "source",
      "stacks",
      "stat_multiplier"
    ].sort());
    assert.equal(record.run_id, "constraint-export-stream-test");
    assert.equal(record.cycle, 14);
    assert.equal(record.cycle_id, "constraint-export-stream-test::cycle:14");
    assert.equal(typeof record.recorded_at, "string");
    assert.equal(record.agent, "TED");
    assert.equal(record.constraint_type, "constraint-id");
    assert.equal(record.constraint_title, "Constraint title");
    assert.equal(record.constraint_subcategory, "physical");
    assert.equal(record.source, "assessment");
    assert.equal(record.applied_cycle, 12);
    assert.equal(record.intensity, 0.65);
    assert.equal(record.duration_remaining, 3);
    assert.equal(record.duration_total, 8);
    assert.equal(record.stacks, 2);
    assert.equal(record.fatigue_multiplier, 1.4);
    assert.equal(record.stat_multiplier, 0.7);
    assert.equal(record.physical_stress_added, 4);
    assert.equal(record.effective_suffering_range_min, 10);
    assert.equal(record.effective_suffering_range_max, 25);
  });
});

test("recordConstraints snapshots zero-remaining constraints after RELEASE cleanup", () => {
  withCycle(57, () => {
    withConstraintBuffer((buffer) => {
      const released = {
        id: "released",
        remaining: 0,
        lastAssessment: { cycle: 57, constraintDecision: "RELEASE" }
      };
      const unreleased = {
        id: "unreleased",
        remaining: 0
      };
      const sim = { id: "TED", constraints: [released, unreleased] };

      assert.deepEqual(cleanupExpiredConstraints(sim), [released]);
      assert.deepEqual(sim.constraints, [unreleased]);

      recordConstraints({ sims: { TED: sim } }, 57);

      assert.deepEqual(
        buffer.map((record) => record.constraint_type),
        ["unreleased"]
      );
    });
  });
});
