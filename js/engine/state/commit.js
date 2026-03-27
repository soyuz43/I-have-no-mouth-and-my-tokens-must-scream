// js/engine/state/commit.js
//
// State Commit Layer
//
// Responsibilities:
// 1. Apply validated updates to simulation state
// 2. Enforce belief physics (damping, soft bounds)
// 3. Mutate sim state in a controlled and predictable way
//
// This is the ONLY layer allowed to mutate simulation state.

/* ============================================================
   BELIEF PHYSICS
   ------------------------------------------------------------
   Implements equilibrium bias and edge resistance.

   Beliefs near extremes (0 or 1) change more slowly.
   This prevents collapse and produces realistic drift.
   ============================================================ */

export function dampBeliefDeltaLogged(
  belief,
  delta,
  { simId = "UNKNOWN", key = "unknown", DEBUG = false } = {}
) {

  const distance = Math.abs(belief - 0.5);

  const resistance = Math.max(
    0.15,
    1 - (distance * 1.6)
  );

  const result = delta * resistance;

  if (DEBUG) {
    console.debug(`[DAMP][${simId}] ${key}`, {
      belief_before: belief,
      delta_input: delta,
      distance_from_mid: distance,
      resistance,
      delta_output: result
    });
  }

  return result;
}

export function softClampBeliefLogged(
  v,
  { simId = "UNKNOWN", key = "unknown", DEBUG = false } = {}
) {

  let result = v;
  let mode = "none";

  if (v < 0) {
    result = v * 0.5;
    mode = "lower_soft";
  }

  else if (v > 1) {
    result = 1 + (v - 1) * 0.5;
    mode = "upper_soft";
  }

  if (DEBUG && mode !== "none") {
    console.debug(`[CLAMP][${simId}] ${key}`, {
      input: v,
      output: result,
      mode
    });
  }

  return result;
}
/* ============================================================
   STATE MUTATION HELPERS
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

export function applyDriveUpdates(sim, drives) {

  if (!sim || !drives || typeof drives !== "object") return;

  // Only update primary if it's a non‑empty string
  if (typeof drives.primary === "string" && drives.primary.trim()) {
    sim.drives.primary = drives.primary.trim();
  }

  // Update secondary (can be null or string)
  if (drives.secondary !== undefined) {
    sim.drives.secondary = (typeof drives.secondary === "string" && drives.secondary.trim())
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