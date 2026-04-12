// js/engine/state/commit.js
import { dampBeliefDelta } from "./utils/dampBeliefDelta.js";
/* ============================================================
   CONFIG (UI HOOK READY)
   ============================================================ */

export const BELIEF_DYNAMICS = {
  dampingMode: "quadratic", // "linear" | "quadratic" | "logistic"
  minResistance: 0.2,
  logisticK: 5,
  logisticMid: 0.3
};

/* ============================================================
   INTERNAL METRICS STATE
   ============================================================ */

const BELIEF_METRICS = {
  history: [] // per-cycle snapshots
};



/* ============================================================
   SOFT CLAMP
   ============================================================ */

export function softClampBelief(v) {
  if (v < 0) return v * 0.5;
  if (v > 1) return 1 + (v - 1) * 0.5;
  return v;
}

/* ============================================================
   STATE MUTATION
   ============================================================ */

export function applyBeliefUpdates(sim, updates, options = {}) {

  for (const [k, v] of Object.entries(sim.beliefs)) {
    if (v < 0 || v > 1) {
      console.error(`[PRE-COMMIT CORRUPTION][${sim.id}.${k}]`, v);
    }
  }

  const {
    DEBUG = true,
    MIN_DELTA = 0,
    NORMALIZE_KEYS = true,
    SKIP_DAMPING = false
  } = options;

  if (!updates || !sim?.beliefs) {
    if (DEBUG) {
      console.warn("[COMMIT] skipped: invalid sim or updates", { sim, updates });
    }
    return;
  }

  const originalKeys = Object.keys(updates);
  const applied = [];
  const skipped = [];
  const errors = [];

  if (DEBUG) {
    console.groupCollapsed(`[COMMIT] applyBeliefUpdates → ${sim.id ?? "UNKNOWN"}`);
    console.debug("[COMMIT] incoming updates:", updates);
  }

  // --- helper: normalize key (handles fallback artifacts) ---
  const normalizeKey = (key) => {
    if (!NORMALIZE_KEYS || typeof key !== "string") return key;

    return key
      .trim()
      .replace(/[\n\r\t]/g, "")
      .replace(/[,\s]+$/g, ""); // strip trailing commas / spaces
  };

  for (const [rawKey, deltaInitial] of Object.entries(updates)) {

    const key = normalizeKey(rawKey);
    let delta = Number(deltaInitial);

    if (DEBUG) {
      console.log("[DELTA PIPELINE][RAW]", {
        sim: sim.id,
        key,
        input: deltaInitial,
        afterScaling: delta
      });
    }

    // --- key validation ---
    if (!Object.prototype.hasOwnProperty.call(sim.beliefs, key)) {
      skipped.push({ key: rawKey, reason: "unknown_key" });
      if (DEBUG) {
        console.warn(`[COMMIT] skipping unknown belief key`, { rawKey, normalized: key });
      }
      continue;
    }

    // --- delta validation ---
    if (!Number.isFinite(delta)) {
      skipped.push({ key, reason: "non_finite_delta", value: deltaInitial });
      if (DEBUG) {
        console.warn(`[COMMIT] skipping non-finite delta`, key, deltaInitial);
      }
      continue;
    }

    // --- current belief ---
    let belief = Number(sim.beliefs[key]);
    if (!Number.isFinite(belief)) {
      errors.push({ key, reason: "invalid_current_belief", value: sim.beliefs[key] });
      if (DEBUG) {
        console.error(`[COMMIT] invalid belief value`, key, sim.beliefs[key]);
      }
      continue;
    }

    // --- damping ---
    const deltaBeforeDamping = delta;

    if (!SKIP_DAMPING) {
      try {
        delta = dampBeliefDelta(sim, key, belief, delta);
      } catch (err) {
        errors.push({ key, reason: "damping_error", err });
        if (DEBUG) {
          console.error(`[COMMIT] damping error`, key, err);
        }
        continue;
      }
    }


    if (DEBUG) {
      console.log("[DELTA PIPELINE][DAMPED]", {
        sim: sim.id,
        key,
        beforeDamping: deltaBeforeDamping,
        afterDamping: delta
      });
    }

    // --- tiny delta filter (optional) ---
    if (Math.abs(delta) <= MIN_DELTA) {
      skipped.push({
        key,
        reason: "below_threshold",
        before: deltaBeforeDamping,
        after: delta
      });
      if (DEBUG) {
        console.debug(`[COMMIT] skipped tiny delta`, key, delta);
      }
      continue;
    }


    // --- boundary-aware scaling BEFORE apply ---
    let adjustedDelta = delta;

    // --- STRICT boundary enforcement ---
    const maxUp = 1 - belief;
    const maxDown = -belief;

    adjustedDelta = Math.max(
      maxDown,
      Math.min(maxUp, adjustedDelta)
    );

    let newVal = belief + adjustedDelta;

    if (newVal > 1 || newVal < 0) {
      console.error(`[OVERFLOW BEFORE CLAMP][${sim.id}.${key}]`, {
        belief,
        adjustedDelta,
        attempted: newVal
      });
    }

    if (!Number.isFinite(newVal)) {
      errors.push({ key, reason: "non_finite_result", value: newVal });
      if (DEBUG) {
        console.error(`[COMMIT] non-finite result`, key, newVal);
      }
      continue;
    }

    // FINAL SAFETY CLAMP (must always hold invariant)
    if (!Number.isFinite(newVal)) {
      console.warn(`[COMMIT] invalid belief value for ${sim.id}.${key}`, newVal);
      return;
    }

    if (newVal < 0 || newVal > 1) {
      console.warn(`[COMMIT] clamping ${sim.id}.${key}`, {
        before: newVal,
        clamped: Math.max(0, Math.min(1, newVal))
      });
    }

    newVal = Math.max(0, Math.min(1, newVal));

    sim.beliefs[key] = newVal;


    if (sim.beliefs[key] < 0 || sim.beliefs[key] > 1) {
      console.error(`[POST-COMMIT WRITE CORRUPTION][${sim.id}.${key}]`, sim.beliefs[key]);
    }

    applied.push({
      key,
      before: belief,
      deltaBefore: deltaBeforeDamping,
      deltaAfter: delta,
      after: newVal
    });
    const theoretical = belief + deltaBeforeDamping;
    const damped = belief + delta;

    const hitUpper = damped > 1;
    const hitLower = damped < 0;
    const wasClamped = hitUpper || hitLower;

    if (DEBUG) {
      console.groupCollapsed(`[BELIEF FLOW][${sim.id}] ${key}`);

      console.table({
        before: belief,
        raw_delta: deltaBeforeDamping,
        damped_delta: delta,
        adjusted_delta: adjustedDelta,
        theoretical_after: theoretical,
        damped_after: damped,
        final_after: newVal,
        hit_upper_bound: hitUpper,
        hit_lower_bound: hitLower,
        was_clamped: wasClamped
      });

      console.groupEnd();
    }
  }

  // --- summary ---
  if (DEBUG) {
    console.log(`[COMMIT] summary`, {
      sim: sim.id,
      totalKeys: originalKeys.length,
      applied: applied.length,
      skipped: skipped.length,
      errors: errors.length
    });

    if (skipped.length) {
      console.table(skipped);
    }

    if (errors.length) {
      console.table(errors);
    }

    console.groupEnd();
  }
}

/* ============================================================
   DRIVE + ANCHOR
   ============================================================ */

export function applyDriveUpdates(sim, drives) {

  if (!sim || !drives || typeof drives !== "object") return;

  if (typeof drives.primary === "string" && drives.primary.trim()) {
    sim.drives.primary = drives.primary.trim();
  }

  if (drives.secondary !== undefined) {
    sim.drives.secondary =
      (typeof drives.secondary === "string" && drives.secondary.trim())
        ? drives.secondary.trim()
        : null;
  }

}

export function applyAnchorUpdates(sim, anchors) {

  if (!sim || !Array.isArray(anchors)) return;
  if (!anchors.every((a) => typeof a === "string")) return;

  sim.anchors = anchors
    .map((a) => a.trim())
    .filter((a) => a.length > 0)
    .slice(0, 5);

}

/* ============================================================
   BELIEF METRICS 
   ============================================================ */

export function computeBeliefMetrics(G) {

  const allBeliefs = [];

  for (const sim of Object.values(G.sims || {})) {
    for (const v of Object.values(sim.beliefs || {})) {
      if (Number.isFinite(v)) {
        allBeliefs.push(v);
      }
    }
  }

  if (allBeliefs.length === 0) return null;

  const n = allBeliefs.length;

  const mean =
    allBeliefs.reduce((a, b) => a + b, 0) / n;

  const variance =
    allBeliefs.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / n;

  // entropy approximation (binning)
  const bins = 10;
  const hist = Array(bins).fill(0);

  for (const v of allBeliefs) {
    const idx = Math.min(bins - 1, Math.floor(v * bins));
    hist[idx]++;
  }

  let entropy = 0;

  for (const count of hist) {
    if (count === 0) continue;
    const p = count / n;
    entropy -= p * Math.log2(p);
  }

  return {
    n,
    mean,
    variance,
    entropy
  };
}

/*=============================================================
LOG BELIEF DYNAMICS
===============================================================*/

export function logBeliefDynamics(G) {

  if (!G?.sims) return;

  const sims = Object.values(G.sims);

  const snapshot = {
    cycle: G.cycle,
    divergence: {},
    variance: {},
    delta: {},
    accel: {}
  };

  const statKeys = ["hope", "sanity", "suffering"];

  // -----------------------------
  // 1. Compute normalized stats
  // -----------------------------
  const normalizedStats = {};
  const beliefs = {};

  sims.forEach(sim => {

    normalizedStats[sim.id] = {
      hope: sim.hope / 100,
      sanity: sim.sanity / 100,
      suffering: sim.suffering / 100
    };

    beliefs[sim.id] = sim.beliefs || {};

  });

  // -----------------------------
  // 2. Divergence (stat vs belief)
  // -----------------------------
  sims.forEach(sim => {

    const simId = sim.id;
    const div = {};

    Object.keys(sim.beliefs).forEach(key => {

      // map beliefs to closest stat proxy (basic heuristic)
      const statMap = {
        escape_possible: "hope",
        resistance_possible: "hope",
        reality_reliable: "sanity",
        self_worth: "sanity",
        guilt_deserved: "suffering",
        am_has_limits: "hope"
      };

      const statKey = statMap[key] || "hope";
      const statVal = normalizedStats[simId][statKey];

      const beliefVal = sim.beliefs[key];

      if (!Number.isFinite(beliefVal)) return;

      div[key] = Math.abs(beliefVal - statVal);

    });

    snapshot.divergence[simId] = div;

  });

  // -----------------------------
  // 3. Variance across sims
  // -----------------------------
  statKeys.forEach(k => {

    const values = sims.map(s => s[k]);

    const mean = values.reduce((a, b) => a + b, 0) / values.length;

    const variance =
      values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;

    snapshot.variance[k] = variance;

  });

  // -----------------------------
  // 4. First derivative (delta)
  // -----------------------------
  if (G.beliefDynamics.last) {

    const prev = G.beliefDynamics.last;

    statKeys.forEach(k => {

      snapshot.delta[k] =
        (snapshot.variance[k] ?? 0) - (prev.variance?.[k] ?? 0);

    });

  }

  // -----------------------------
  // 5. Second derivative (acceleration)
  // -----------------------------
  if (G.beliefDynamics.history.length > 1) {

    const prev = G.beliefDynamics.last;

    statKeys.forEach(k => {

      const d1 = prev.delta?.[k] ?? 0;
      const d2 = snapshot.delta?.[k] ?? 0;

      snapshot.accel[k] = d2 - d1;

    });

  }

  // -----------------------------
  // 6. Store
  // -----------------------------
  G.beliefDynamics.history.push(snapshot);
  G.beliefDynamics.last = snapshot;

  // -----------------------------
  // 7. Debug output
  // -----------------------------
  console.groupCollapsed(`[DYNAMICS] Cycle ${G.cycle}`);

  console.log("Variance:", snapshot.variance);
  console.log("Delta:", snapshot.delta);
  console.log("Accel:", snapshot.accel);

  console.log("Divergence:", snapshot.divergence);

  console.groupEnd();

}

/* ============================================================
   PER-CYCLE LOGGING
   ============================================================ */

export function logBeliefMetrics(G) {

  const current = computeBeliefMetrics(G);
  if (!current) return;

  const prev = BELIEF_METRICS.history.at(-1);

  let delta = null;

  if (prev) {
    delta = {
      mean: current.mean - prev.mean,
      variance: current.variance - prev.variance,
      entropy: current.entropy - prev.entropy
    };
  }

  BELIEF_METRICS.history.push(current);

  console.group(`[BELIEF METRICS][Cycle ${G.cycle}]`);

  console.table(current);

  if (delta) {
    console.log("Δ vs prev:", delta);
  }

  console.log("mode:", BELIEF_DYNAMICS.dampingMode);

  console.groupEnd();

}