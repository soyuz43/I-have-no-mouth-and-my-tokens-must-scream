// js/engine/comms/orchestrator.js

import { G } from "../../core/state.js";
import { SIM_IDS } from "../../core/constants.js";

import { timelineEvent } from "../../ui/timeline.js";

import { createCommsState } from "./state/createCommsState.js";
import { step } from "./engine.js";

// ========== GLOBAL LOGGING CONTROL ==========
const LOG_ORCHESTRATOR_FLOW = true;        // High-level: start, budget, phases, complete
const LOG_ORCHESTRATOR_DETAILS = false;    // Queue state, reply targets, burst decisions
const LOG_ORCHESTRATOR_ACTION_ONLY = true; // Show each sim turn without message content
const LOG_ORCHESTRATOR_PERSIST = true;     // Show persistence summary after cycle
// ============================================

function logFlow(message, data = null) {
  if (LOG_ORCHESTRATOR_FLOW) {
    console.log(`[COMMS FLOW] ${message}`);
    if (data && LOG_ORCHESTRATOR_DETAILS) console.debug(data);
  }
}

function logDetail(message, data = null) {
  if (LOG_ORCHESTRATOR_DETAILS) {
    console.debug(`[COMMS DETAIL] ${message}`, data || "");
  }
}

function logAction(simId, turnType) {
  if (LOG_ORCHESTRATOR_ACTION_ONLY) {
    console.log(`[COMMS TURN] ${simId} → ${turnType}`);
  }
}

/*
================================================================
ORCHESTRATOR: INTER-SIM COMMUNICATION CYCLE

This module coordinates a full communication cycle across all sims.

Responsibilities:
- Initialize per-cycle (ephemeral) state
- Compute group stress → message budget
- Schedule execution order (queue)
- Drive the step() engine until limits are reached
- Optionally run a second "burst" pass for additional activity

Important distinctions:
- State created here is ephemeral and reset every cycle
- Persistent memory (threads, logs, relationships) lives in G.*

No behavioral logic is defined here — only orchestration.
================================================================
*/

/* ============================================================
   SHUFFLE (Fisher-Yates)
============================================================ */

function shuffle(list) {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/* ============================================================
   MAIN ORCHESTRATOR
============================================================ */

export async function runCommsCycle() {
  const MAX_MESSAGES = 24;

  logFlow("starting inter-sim communication cycle");

  /* ------------------------------------------------------------
     INIT STATE
  ------------------------------------------------------------ */

  const state = createCommsState();

  // Ensure required per-cycle structures exist
  state.cycle = {
    activeThisCycle: new Set(),
  };

  state.replyTargetsThisCycle = new Map();
  state.pendingReactiveIntel = new Map();

  timelineEvent("inter-sim phase start");

  /* ------------------------------------------------------------
     GROUP STRESS → MESSAGE BUDGET
  ------------------------------------------------------------ */

  let totalStress = 0;

  for (const id of SIM_IDS) {
    const s = G.sims[id];
    if (!s) continue;

    totalStress +=
      (s.suffering / 100) * 0.5 +
      ((100 - s.sanity) / 100) * 0.3 +
      ((1 - (s.beliefs?.others_trustworthy ?? 0.5)) * 0.2);
  }

  const groupStress = totalStress / SIM_IDS.length;

  const messageBudget = Math.min(
    MAX_MESSAGES,
    Math.round(SIM_IDS.length * (1.6 + groupStress))
  );

  state.messageBudget = messageBudget;

  logFlow(`budget: ${messageBudget} messages (groupStress: ${groupStress.toFixed(3)})`);

  /* ------------------------------------------------------------
     INITIAL QUEUE + TRACKING
  ------------------------------------------------------------ */

  const initialQueue = shuffle(SIM_IDS);
  const queue = [...initialQueue];

  logDetail(`initial queue order: ${initialQueue.join(" → ")}`);

  // Track who has had at least one turn
  state.firstPassCompleted = new Set();

  /* ------------------------------------------------------------
     MAIN LOOP
  ------------------------------------------------------------ */

  while (
    queue.length > 0 &&
    state.counters.messageCount < state.messageBudget
  ) {
    let fromId = null;

    logDetail("replyTargetsThisCycle", Array.from(state.replyTargetsThisCycle.entries()));

    // --- PRIORITY: pending reply continuation ---
    for (const [targetId, perSender] of state.replyTargetsThisCycle.entries()) {
      if (state.firstPassCompleted.size < SIM_IDS.length) continue;

      for (const [senderId, info] of perSender.entries()) {
        if (info.remaining > 0) {
          fromId = senderId;
          info.remaining -= 1;

          logDetail(`reply continuation: ${senderId} (remaining: ${info.remaining})`);

          if (info.remaining <= 0) {
            perSender.delete(senderId);
          }

          if (perSender.size === 0) {
            state.replyTargetsThisCycle.delete(targetId);
          }

          break;
        }
      }

      if (fromId) break;
    }

    // --- FALLBACK: normal scheduling ---
    if (!fromId) {
      fromId =
        state.firstPassCompleted.size < SIM_IDS.length
          ? initialQueue.find(id => !state.firstPassCompleted.has(id))
          : queue.shift();

      if (fromId) {
        logDetail(`normal schedule: ${fromId} (firstPass: ${state.firstPassCompleted.size}/${SIM_IDS.length})`);
      }
    }

    if (!fromId) break;

    // --- FIX: remove from queue to avoid duplicate turns ---
    const idx = queue.indexOf(fromId);
    if (idx !== -1) queue.splice(idx, 1);

    state.firstPassCompleted.add(fromId);

    logAction(fromId, "turn");

    await step({
      fromId,
      state,
      queue,
    });
  }

  logFlow(`main loop complete (messages: ${state.counters.messageCount}/${state.messageBudget})`);

  /* ------------------------------------------------------------
     OPTIONAL BURST PASS
  ------------------------------------------------------------ */

  const SECOND_PASS_CHANCE = 0.75;
  const BURST_BASE = 0.18;

  const burstModifier = 1 + groupStress * 1.4;

  const willBurst = state.counters.messageCount < state.messageBudget && Math.random() < SECOND_PASS_CHANCE;

  logDetail(`burst pass: willBurst=${willBurst}, chance=${SECOND_PASS_CHANCE}, modifier=${burstModifier.toFixed(2)}`);

  if (willBurst) {
    const burstQueue = shuffle(SIM_IDS);
    let burstMessages = 0;

    for (const fromId of burstQueue) {
      if (state.counters.messageCount >= state.messageBudget) break;

      const burstProb = BURST_BASE * burstModifier;

      if (Math.random() > burstProb) continue;

      logDetail(`burst turn: ${fromId} (prob=${burstProb.toFixed(3)})`);
      logAction(fromId, "burst");

      await step({
        fromId,
        state,
        queue: burstQueue,
      });

      burstMessages++;
    }

    logFlow(`burst pass complete (${burstMessages} extra messages)`);
  } else {
    logDetail(`burst pass skipped`);
  }

  /* ------------------------------------------------------------
     COMPLETE
  ------------------------------------------------------------ */
  const d = state.debug || {};

  logFlow(
    `cycle complete: ${state.counters.messageCount} messages ` +
    `(budget: ${state.messageBudget}) | ` +
    `outreach=${d.outreach || 0}, reply=${d.reply || 0}, rumor=${d.rumor || 0}`
  );

  /* ============================================================
    PERSIST TO GLOBAL STATE
  ============================================================ */

  if (!G.comms) {
    G.comms = {
      history: [],
      lastCycle: null,
    };
  }

  // Extract messages from state
  const messages = [];

  for (const [fromId, sentList] of state.sentMessagesThisCycle.entries()) {
    for (const msg of sentList) {
      messages.push({
        ...msg,
        from: fromId,
        to: Array.isArray(msg.to)
          ? msg.to
          : (msg.to ? [msg.to] : []),
        cycle: G.cycle ?? 0,
      });
    }
  }

  // Store
  G.comms.lastCycle = messages;
  G.comms.history.push(...messages);

  if (LOG_ORCHESTRATOR_PERSIST) {
    console.groupCollapsed("[COMMS PERSIST]");
    console.debug(`lastCycleCount: ${messages.length}`);
    console.debug(`totalHistory: ${G.comms?.history?.length ?? 0}`);
    console.debug(`hasComms: ${!!G.comms}`);
    console.debug(`hasHistory: ${Array.isArray(G.comms?.history)}`);
    console.debug(`hasLastCycle: ${Array.isArray(G.comms?.lastCycle)}`);
    if (messages.length > 0) {
      console.debug("sample:", {
        from: messages[0].from,
        to: messages[0].to,
        text: String(messages[0].text || "").slice(0, 80)
      });
    }
    console.groupEnd();
  }

  /* ============================================================ */

  timelineEvent("inter-sim phase complete");

  return state;
}