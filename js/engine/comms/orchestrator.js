// js/engine/comms/orchestrator.js

import { G } from "../../core/state.js";
import { SIM_IDS } from "../../core/constants.js";

import { timelineEvent } from "../../ui/timeline.js";

import { createCommsState } from "./state/createCommsState.js";
import { step } from "./engine.js";

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

  /* ------------------------------------------------------------
     INITIAL QUEUE + TRACKING
  ------------------------------------------------------------ */

  const initialQueue = shuffle(SIM_IDS);
  const queue = [...initialQueue];

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

    console.debug(
      "[COMMS] replyTargetsThisCycle",
      Array.from(state.replyTargetsThisCycle.entries())
    );

    // --- PRIORITY: pending reply continuation ---
    for (const [targetId, perSender] of state.replyTargetsThisCycle.entries()) {
      if (state.firstPassCompleted.size < SIM_IDS.length) continue;

      for (const [senderId, info] of perSender.entries()) {
        if (info.remaining > 0) {
          fromId = senderId;
          info.remaining -= 1;

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
    }

    if (!fromId) break;

    // --- FIX: remove from queue to avoid duplicate turns ---
    const idx = queue.indexOf(fromId);
    if (idx !== -1) queue.splice(idx, 1);

    state.firstPassCompleted.add(fromId);

    await step({
      fromId,
      state,
      queue,
    });
  }

  /* ------------------------------------------------------------
     OPTIONAL BURST PASS
  ------------------------------------------------------------ */

  const SECOND_PASS_CHANCE = 0.75;
  const BURST_BASE = 0.18;

  const burstModifier = 1 + groupStress * 1.4;

  if (
    state.counters.messageCount < state.messageBudget &&
    Math.random() < SECOND_PASS_CHANCE
  ) {
    const burstQueue = shuffle(SIM_IDS);

    for (const fromId of burstQueue) {
      if (state.counters.messageCount >= state.messageBudget) break;

      const burstProb = BURST_BASE * burstModifier;

      if (Math.random() > burstProb) continue;

      await step({
        fromId,
        state,
        queue: burstQueue,
      });
    }
  }

  /* ------------------------------------------------------------
     COMPLETE
  ------------------------------------------------------------ */
  console.debug("[COMMS] cycle complete", {
    messages: state.counters.messageCount,
  });

  /* ============================================================
     🔥 PERSIST TO GLOBAL STATE (CRITICAL FIX)
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

  console.debug("[COMMS][PERSISTED]", {
    lastCycleCount: messages.length,
    totalHistory: G.comms?.history?.length ?? 0,

    // sanity checks (CRITICAL)
    hasComms: !!G.comms,
    hasHistory: Array.isArray(G.comms?.history),
    hasLastCycle: Array.isArray(G.comms?.lastCycle),

    // data visibility (first message sample)
    sample:
      messages.length > 0
        ? {
          from: messages[0].from,
          to: messages[0].to,
          text: String(messages[0].text || "").slice(0, 80)
        }
        : null
  });

  /* ============================================================ */

  timelineEvent("inter-sim phase complete");

  return state;
}