// js/engine/relationships.js

import { G } from "../core/state.js";

/* ============================================================
   RELATIONSHIP SYSTEM
   ------------------------------------------------------------
   Directed trust graph between prisoners.

   A → B means:
   "A's trust or suspicion toward B"

   Range:
     -1 = extreme hostility
      0 = neutral
      1 = extreme trust

   Relationship values evolve through:
   • direct communication
   • overheard whispers
   • passive emotional drift
============================================================ */

const REL_MIN = -1;
const REL_MAX = 1;

/* ============================================================
   INTERNAL UTILITIES
============================================================ */

function clampRel(v) {
  return Math.max(REL_MIN, Math.min(REL_MAX, v));
}

/**
 * Ensures relationship objects exist for all sims.
 * This prevents undefined access errors and guarantees
 * matrix consistency for debugging and rendering.
 */
function ensureRelationshipMap(simId) {

  const sim = G.sims[simId];
  if (!sim) return;

  if (!sim.relationships) {
    sim.relationships = {};
  }

  for (const other of Object.keys(G.sims)) {

    if (other === simId) continue;

    if (sim.relationships[other] == null) {
      sim.relationships[other] = 0;
    }

  }

}

/* ============================================================
   CORE RELATIONSHIP MUTATION
============================================================ */

export function adjustRelationship(a, b, delta) {

  const simA = G.sims[a];
  const simB = G.sims[b];

  if (!simA || !simB) {

    console.warn("[REL] invalid sim reference", { a, b });
    return;

  }

  if (a === b) return;

  ensureRelationshipMap(a);

  const current = simA.relationships[b] ?? 0;

  const next = clampRel(current + delta);

  simA.relationships[b] = next;

  console.debug(
    "[REL UPDATE]",
    `${a} → ${b}`,
    {
      delta,
      before: Number(current.toFixed(3)),
      after: Number(next.toFixed(3))
    }
  );

}

/* ============================================================
   MESSAGE INTERACTION EFFECTS
   ------------------------------------------------------------
   Applies trust shifts based on message intent.
============================================================ */

export function applyCommunicationEffect(from, to, intent) {

  if (!intent) {
    console.debug("[REL EFFECT] missing intent", { from, to });
    return;
  }

  console.debug("[REL EFFECT]", { from, to, intent });

  switch (intent) {

    case "recruit_ally":
      adjustRelationship(to, from, 0.05);
      break;

    case "request_help":
      adjustRelationship(to, from, 0.03);
      break;

    case "probe_trust":
      adjustRelationship(to, from, 0.01);
      break;

    case "manipulate":
      adjustRelationship(to, from, -0.02);
      break;

    case "test_loyalty":
      adjustRelationship(to, from, -0.01);
      break;

    case "conceal_information":
      adjustRelationship(to, from, -0.03);
      break;

    default:

      console.debug("[REL EFFECT] neutral intent", intent);

      break;

  }

}

/* ============================================================
   OVERHEARD MESSAGE EFFECT
   ------------------------------------------------------------
   Whispered conversations influence trust indirectly.

   Listener becomes slightly suspicious of both participants.
============================================================ */

export function applyOverheardEffect(listener, fromId, toId, fragment) {

  if (!listener || !fromId || !toId) return;

  const sim = G.sims[listener];
  if (!sim) return;

  ensureRelationshipMap(listener);

  let suspicion = 0.01;

  if (fragment?.includes("...")) {
    suspicion = 0.005; // uncertain fragment
  }

  if (fragment === "(whispering observed)") {
    suspicion = 0.008; // paranoia trigger
  }

  console.debug(
    "[REL OVERHEARD]",
    `${listener} overheard ${fromId}→${toId}`,
    {
      suspicion
    }
  );

  adjustRelationship(listener, fromId, -suspicion);
  adjustRelationship(listener, toId, -suspicion);

}

/* ============================================================
   PASSIVE RELATIONSHIP DRIFT
   ------------------------------------------------------------
   Emotional memory fades slowly over time.

   Prevents relationships from locking permanently.
============================================================ */

export function applyRelationshipDrift() {

  for (const id of Object.keys(G.sims)) {

    const sim = G.sims[id];

    if (!sim?.relationships) continue;

    for (const other of Object.keys(sim.relationships)) {

      const current = sim.relationships[other];

      if (current == null) continue;

      const next = clampRel(current * 0.995);

      sim.relationships[other] = next;

    }

  }

  console.debug("[REL DRIFT] applied");

}

/* ============================================================
   RELATIONSHIP INITIALIZATION
   ------------------------------------------------------------
   Ensures all sims start with a complete trust map.
   Useful during boot or state reset.
============================================================ */

export function initializeRelationships() {

  if (!G?.sims) return;

  for (const id of Object.keys(G.sims)) {
    ensureRelationshipMap(id);
  }

  console.debug("[REL INIT] relationship graph initialized");

}