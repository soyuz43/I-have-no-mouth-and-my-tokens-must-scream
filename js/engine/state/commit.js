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

function dampBeliefDelta(belief, delta) {

  const distance = Math.abs(belief - 0.5);

  const resistance = Math.max(
    0.15,
    1 - (distance * 1.6)
  );

  return delta * resistance;

}

function softClampBelief(v) {

  if (v < 0) return v * 0.5;

  if (v > 1) return 1 + (v - 1) * 0.5;

  return v;

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

  if (typeof drives.primary === "string" && drives.primary.trim()) {

    sim.drives.primary = drives.primary.trim();

  }

  sim.drives.secondary =
    typeof drives.secondary === "string" && drives.secondary.trim()
      ? drives.secondary.trim()
      : null;

}

export function applyAnchorUpdates(sim, anchors) {

  if (!sim || !Array.isArray(anchors)) return;

  if (!anchors.every((a) => typeof a === "string")) return;

  sim.anchors = anchors
    .map((a) => a.trim())
    .filter((a) => a.length > 0)
    .slice(0, 5);

}