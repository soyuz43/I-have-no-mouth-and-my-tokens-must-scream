// js/engine/state/commit.js

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
   BELIEF DAMPING (CORE)
   ============================================================ */

export function dampBeliefDelta(belief, delta) {

  const distance = Math.abs(belief - 0.5);
  const d = distance / 0.5;

  let resistance;

  switch (BELIEF_DYNAMICS.dampingMode) {

    case "linear":
      resistance = 1 - d;
      break;

    case "logistic":
      resistance =
        1 / (1 + Math.exp(
          BELIEF_DYNAMICS.logisticK * (d - BELIEF_DYNAMICS.logisticMid)
        ));
      break;

    case "quadratic":
    default:
      resistance = Math.pow(1 - d, 2);
      break;
  }

  resistance = Math.max(BELIEF_DYNAMICS.minResistance, resistance);

  return delta * resistance;
}

export function dampBeliefDeltaLogged(
  belief,
  delta,
  { simId = "UNKNOWN", key = "unknown", DEBUG = false } = {}
) {

  const result = dampBeliefDelta(belief, delta);

  if (DEBUG) {
    const distance = Math.abs(belief - 0.5);
    const d = distance / 0.5;
    const resistance = delta !== 0 ? result / delta : 0;

    console.debug(`[DAMP][${simId}] ${key}`, {
      belief_before: belief,
      delta_input: delta,
      normalized_distance: d,
      resistance,
      delta_output: result,
      mode: BELIEF_DYNAMICS.dampingMode
    });
  }

  return result;
}

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

export function applyBeliefUpdates(sim, updates) {

  if (!updates || !sim?.beliefs) return;

  Object.entries(updates).forEach(([key, delta]) => {

    if (!Object.prototype.hasOwnProperty.call(sim.beliefs, key)) return;

    let belief = Number(sim.beliefs[key]);
    if (!Number.isFinite(belief)) return;

    delta = dampBeliefDelta(belief, delta);

    let newVal = belief + delta;
    newVal = softClampBelief(newVal);

    sim.beliefs[key] = newVal;

  });

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
   BELIEF METRICS (NEW)
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