// js/engine/relationships.js

import { G } from "../core/state.js";

// ========== GLOBAL LOGGING CONTROL ==========
const LOG_RELATIONSHIP_OPS = true;       // Log when relationships change (summary)
const LOG_RELATIONSHIP_DETAILS = false;  // Log full before/after objects
const LOG_DRIFT = false;                 // Log passive drift application
const LOG_INIT = true;                   // Log initialization
const LOG_OVERHEARD = false;              // Log overheard effects
const LOG_COMM_EFFECTS = false;           // Log communication intent effects
// ============================================

function logRelUpdate(a, b, delta, before, after, source = "direct") {
  if (!LOG_RELATIONSHIP_OPS) return;
  
  const arrow = delta >= 0 ? "↑" : "↓";
  console.log(`[REL] ${a} → ${b} ${arrow} ${Math.abs(delta).toFixed(3)} (${before.toFixed(3)} → ${after.toFixed(3)}) [${source}]`);
  
  if (LOG_RELATIONSHIP_DETAILS) {
    console.debug(`[REL DETAIL] ${source}`, { a, b, delta, before, after });
  }
}

function logDrift() {
  if (LOG_DRIFT) {
    console.debug("[REL DRIFT] applied");
  }
}

function logInit() {
  if (LOG_INIT) {
    console.debug("[REL INIT] relationship graph initialized");
  }
}

function logOverheard(listener, fromId, toId, suspicion, beforeFrom, afterFrom, beforeTo, afterTo) {
  if (!LOG_OVERHEARD) return;
  console.log(`[REL OVERHEARD] ${listener} heard ${fromId}→${toId} → suspicion: -${suspicion.toFixed(3)}`);
  if (LOG_RELATIONSHIP_DETAILS) {
    console.debug(`[REL OVERHEARD DETAIL] ${listener} vs ${fromId}: ${beforeFrom.toFixed(3)} → ${afterFrom.toFixed(3)}`);
    console.debug(`[REL OVERHEARD DETAIL] ${listener} vs ${toId}: ${beforeTo.toFixed(3)} → ${afterTo.toFixed(3)}`);
  }
}

function logCommEffect(from, to, intent, delta) {
  if (!LOG_COMM_EFFECTS) return;
  const arrow = delta >= 0 ? "↑" : "↓";
  console.log(`[REL COMM] ${to} → ${from} ${arrow} ${Math.abs(delta).toFixed(3)} (intent: ${intent})`);
}

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

export function adjustRelationship(a, b, delta, source = "direct") {

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

  logRelUpdate(a, b, delta, current, next, source);

  // Optional: log full relationship map for debugging
  if (LOG_RELATIONSHIP_DETAILS && source === "direct") {
    console.debug(`[REL MAP][${a}]`, JSON.parse(JSON.stringify(simA.relationships)));
  }
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

  let delta = 0;

  switch (intent) {

    case "recruit_ally":
      delta = 0.05;
      break;

    case "request_help":
      delta = 0.03;
      break;

    case "probe_trust":
      delta = 0.01;
      break;

    case "manipulate":
      delta = -0.02;
      break;

    case "test_loyalty":
      delta = -0.01;
      break;

    case "conceal_information":
      delta = -0.03;
      break;

    default:
      console.debug("[REL EFFECT] neutral intent", intent);
      return;
  }

  logCommEffect(from, to, intent, delta);
  adjustRelationship(to, from, delta, `intent:${intent}`);
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

  // Get before values for logging
  const beforeFrom = sim.relationships[fromId] ?? 0;
  const beforeTo = sim.relationships[toId] ?? 0;

  adjustRelationship(listener, fromId, -suspicion, `overheard:${fromId}`);
  adjustRelationship(listener, toId, -suspicion, `overheard:${toId}`);

  const afterFrom = sim.relationships[fromId] ?? 0;
  const afterTo = sim.relationships[toId] ?? 0;

  logOverheard(listener, fromId, toId, suspicion, beforeFrom, afterFrom, beforeTo, afterTo);
}

/* ============================================================
   PASSIVE RELATIONSHIP DRIFT
   ------------------------------------------------------------
   Emotional memory fades slowly over time.

   Prevents relationships from locking permanently.
============================================================ */

export function applyRelationshipDrift() {

  if (!LOG_DRIFT && !LOG_RELATIONSHIP_OPS) {
    // Still need to apply drift, just skip logging
    for (const id of Object.keys(G.sims)) {
      const sim = G.sims[id];
      if (!sim?.relationships) continue;
      for (const other of Object.keys(sim.relationships)) {
        const current = sim.relationships[other];
        if (current == null) continue;
        sim.relationships[other] = clampRel(current * 0.995);
      }
    }
    return;
  }

  // Logging path
  const beforeSnapshots = {};
  
  if (LOG_RELATIONSHIP_DETAILS) {
    for (const id of Object.keys(G.sims)) {
      const sim = G.sims[id];
      if (sim?.relationships) {
        beforeSnapshots[id] = JSON.parse(JSON.stringify(sim.relationships));
      }
    }
  }

  let changeCount = 0;
  let maxChange = 0;

  for (const id of Object.keys(G.sims)) {
    const sim = G.sims[id];
    if (!sim?.relationships) continue;

    for (const other of Object.keys(sim.relationships)) {
      const current = sim.relationships[other];
      if (current == null) continue;

      const next = clampRel(current * 0.995);
      const change = Math.abs(next - current);
      
      if (change > 0.0001) {
        changeCount++;
        if (change > maxChange) maxChange = change;
      }
      
      sim.relationships[other] = next;
    }
  }

  logDrift();
  
  if (LOG_RELATIONSHIP_OPS && changeCount > 0) {
    console.log(`[REL DRIFT] ${changeCount} relationships decayed (max Δ: ${maxChange.toFixed(6)})`);
  }
  
  if (LOG_RELATIONSHIP_DETAILS) {
    for (const id of Object.keys(beforeSnapshots)) {
      const sim = G.sims[id];
      if (!sim?.relationships) continue;
      
      const before = beforeSnapshots[id];
      const after = sim.relationships;
      
      const changes = [];
      for (const other of Object.keys(before)) {
        if (before[other] !== after[other]) {
          changes.push({
            other,
            before: before[other].toFixed(4),
            after: after[other].toFixed(4),
            delta: (after[other] - before[other]).toFixed(6)
          });
        }
      }
      
      if (changes.length) {
        console.debug(`[REL DRIFT DETAIL][${id}]`, changes);
      }
    }
  }
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

  logInit();

  if (LOG_RELATIONSHIP_DETAILS) {
    for (const id of Object.keys(G.sims)) {
      const sim = G.sims[id];
      if (sim?.relationships) {
        console.debug(`[REL INIT MAP][${id}]`, JSON.parse(JSON.stringify(sim.relationships)));
      }
    }
  }
}

/* ============================================================
   DEBUG UTILITY
   ------------------------------------------------------------
   Prints the full relationship matrix to console.table.
============================================================ */

export function logRelationshipMatrix() {
  if (!LOG_RELATIONSHIP_OPS && !LOG_RELATIONSHIP_DETAILS) return;
  
  const matrix = {};
  const simIds = Object.keys(G.sims);
  
  for (const from of simIds) {
    const row = {};
    for (const to of simIds) {
      if (from === to) {
        row[to] = "—";
      } else {
        const val = G.sims[from]?.relationships?.[to] ?? 0;
        row[to] = val.toFixed(3);
      }
    }
    matrix[from] = row;
  }
  
  console.groupCollapsed("[REL MATRIX]");
  console.table(matrix);
  console.groupEnd();
}