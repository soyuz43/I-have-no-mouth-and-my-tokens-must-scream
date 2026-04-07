// js/engine/comms/social/overhearing.js

import { G } from "../../../core/state.js";
import { SIM_IDS } from "../../../core/constants.js";
import { addLog } from "../../../ui/logs.js";

import { applyOverheardEffect } from "../../relationships.js";

/* ============================================================
   SOCIAL MEMORY: OVERHEARD COMMUNICATION
============================================================ */

export function recordOverheard(listener, fromId, toId, text) {
  const listenerSim = G.sims[listener];
  if (!listenerSim) return;

  // --- Store overheard memory ---
  if (!listenerSim.overheard) listenerSim.overheard = [];

  listenerSim.overheard.push({
    from: fromId,
    to: toId,
    text,
    cycle: G.cycle,
    timestamp: Date.now(),
  });

  if (listenerSim.overheard.length > 20) {
    listenerSim.overheard.shift();
  }

  // --- Delegate trust effects to relationship system ---
  applyOverheardEffect(listener, fromId, toId, text);
}

/* ============================================================
   RECEIVED MESSAGE MEMORY
============================================================ */

export function recordReceived(simId, fromId, text) {
  const sim = G.sims[simId];
  if (!sim) return;

  if (!sim.received) sim.received = [];

  sim.received.push({
    from: fromId,
    text,
    cycle: G.cycle,
    timestamp: Date.now(),
  });

  if (sim.received.length > 20) {
    sim.received.shift();
  }
}

/* ============================================================
   SOCIAL OVERHEARING MODEL
============================================================ */

export function maybeOverhear(fromId, toId, message) {
  const leak = G.privateLeak || {
    full: 0.04,
    fragment: 0.12,
    seen: 0.32,
  };

  const others = SIM_IDS.filter(
    (id) => id !== fromId && id !== toId
  );

  if (!others.length) return;

  /* ------------------------------------------------------------
     SELECT MOST LIKELY LISTENER
  ------------------------------------------------------------ */

  let bestListener = null;
  let bestScore = -Infinity;

  for (const id of others) {
    const sim = G.sims[id];
    if (!sim) continue;

    const relToFrom = sim.relationships?.[fromId] ?? 0;
    const relToTo = sim.relationships?.[toId] ?? 0;

    const closeness = (relToFrom + relToTo) / 200;
    const paranoia = 1 - (sim.beliefs?.others_trustworthy ?? 0.5);
    const attention = (sim.sanity ?? 50) / 100;

    const score =
      closeness * 0.5 +
      paranoia * 0.3 +
      attention * 0.2 +
      Math.random() * 0.2;

    if (score > bestScore) {
      bestScore = score;
      bestListener = id;
    }
  }

  if (!bestListener) return;

  const listener = bestListener;

  /* ------------------------------------------------------------
     ADJUSTED PROBABILITY
  ------------------------------------------------------------ */

  const sim = G.sims[listener];

  const paranoia =
    1 - (sim.beliefs?.others_trustworthy ?? 0.5);

  const attention =
    (sim.sanity ?? 50) / 100;

  const modifier =
    0.6 + paranoia * 0.3 + attention * 0.1;

  const r = Math.random() / modifier;

  /* ------------------------------------------------------------
     OVERHEARING OUTCOMES
  ------------------------------------------------------------ */

  if (r < leak.full) {
    addLog(
      `OVERHEARD ${listener} // ${fromId}→${toId}`,
      `"${message}"`,
      "whisper"
    );

    recordOverheard(listener, fromId, toId, message);
  }

  else if (r < leak.full + leak.fragment) {
    const fragmentLength =
      Math.floor(Math.random() * 50) + 20;

    const region =
      Math.random() < 0.25 ? 0 :
      Math.random() < 0.75 ? 1 :
      2;

    let start;

    if (region === 0) {
      start = 0;
    } else if (region === 1) {
      start = Math.floor(
        Math.random() *
        Math.max(1, message.length - fragmentLength)
      );
    } else {
      start = Math.max(
        0,
        message.length - fragmentLength
      );
    }

    const fragment = message
      .slice(start, start + fragmentLength)
      .trim()
      .replace(/^[^a-zA-Z0-9]+/, "") + "...";

    addLog(
      `OVERHEARD ${listener} // ${fromId}→${toId}`,
      `"${fragment}"`,
      "whisper"
    );

    recordOverheard(listener, fromId, toId, fragment);
  }

  else if (r < leak.full + leak.fragment + leak.seen) {
    addLog(
      `NOTICE ${listener}`,
      `${fromId} and ${toId} were seen whispering.`,
      "whisper"
    );

    recordOverheard(
      listener,
      fromId,
      toId,
      "(whispering observed)"
    );
  }
}