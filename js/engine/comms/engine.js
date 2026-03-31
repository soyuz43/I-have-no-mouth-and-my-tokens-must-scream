// js/engine/comms/engine.js

import { G } from "../../core/state.js";
import { SIM_IDS } from "../../core/constants.js";

import { callModel } from "../../models/callModel.js";

import { buildSimOutreachPrompt } from "../../prompts/simOutreach.js";
import { buildSimReplyPrompt } from "../../prompts/simReply.js";

import { addLog } from "../../ui/logs.js";
import { timelineEvent } from "../../ui/timeline.js";

import { applyCommunicationEffect, adjustRelationship } from "../relationships.js";

import {
  parseMessage,
  parseVisibility,
  parseTarget,
  parseReply,
  similarity
} from "./parsing/parsers.js";

import {
  maybeOverhear,
  recordReceived
} from "./social/overhearing.js";

/*
================================================================
ENGINE: INTER-SIM COMMUNICATION STEP

This file is a direct behavioral port of `attemptCommunication`
from the original comms.js.

Responsibilities:
- Execute one communication step for a sim
- Handle routing, messaging, replies, and control flow
- Maintain behavioral parity with original system

Important distinctions:
- Uses G.* for persistent memory (threads, logs)
- Uses state.* for per-cycle control logic (ephemeral)
- Does NOT introduce new behavior or modify prompts

All logic ordering and conditions are preserved exactly.
================================================================
*/

const MAX_MESSAGE_LENGTH = 800;

export async function step({ fromId, state, queue }) {
  const {
    counters,
    cycle,
    exchanges,
    intent,
    reply
  } = state;

  const {
    sentMessagesThisCycle,
    lastSenderToRecipient,
    negotiationFlags,
    intentHistoryByPair,
    escalationLevel,
    lastReplyByPair
  } = state;

  // --- SAFETY FIX ---
  const replyTargetsThisCycle =
    state.replyTargetsThisCycle || new Map();

  if (counters.messageCount >= state.messageBudget) return;

  const fromSim = G.sims[fromId];
  if (!fromSim) return;

  if (fromSim.sanity < 10 || fromSim.suffering > 95) return;

  try {
    timelineEvent(`${fromId} outreach decision`);

    /* ================= RUMOR CASCADE ================= */

    const overheardList = fromSim.overheard || [];

    if (overheardList.length > 0) {
      const rumorPressure = Math.min(0.4, 0.1 + overheardList.length * 0.03);

      if (Math.random() < rumorPressure) {
        const source =
          overheardList[Math.floor(Math.random() * overheardList.length)];

        const possibleTargets = SIM_IDS.filter(
          (id) => id !== fromId && id !== source.from
        );

        if (possibleTargets.length) {
          const rumorTarget =
            possibleTargets[Math.floor(Math.random() * possibleTargets.length)];

          const rumorText = `I heard ${source.from} say earlier: ${source.text.slice(0, 800)}...`;

          timelineEvent(`${fromId} rumor → ${rumorTarget}`);

          addLog(`PRIVATE ${fromId}→${rumorTarget} [AUTO]`, `"${rumorText}"`, "chat");

          G.interSimLog.push({
            from: fromId,
            to: [rumorTarget],
            text: rumorText,
            cycle: G.cycle,
            autonomous: true,
            visibility: "private",
            rumor: true,
            originalSource: source.from,
            originalText: source.text
          });

          adjustRelationship(rumorTarget, source.from, -0.015);

          counters.messageCount++;
          return;
        }
      }
    }

    /* ================= OUTREACH ================= */

    const outreachRaw = await callModel(
      fromId,
      buildSimOutreachPrompt(fromSim),
      [{ role: "user", content: "Decide now." }],
      MAX_MESSAGE_LENGTH
    );

    if (!outreachRaw) return;

    const message = parseMessage(outreachRaw);
    if (!message) return;

    const visibility = parseVisibility(outreachRaw);
    let toId = parseTarget(outreachRaw);

    /* ================= ROUTING ================= */

    function getRecentPartner(simId) {
      for (let i = G.interSimLog.length - 1; i >= 0; i--) {
        const entry = G.interSimLog[i];
        if (!entry || entry.cycle !== G.cycle) continue;

        if (entry.from === simId) return entry.to?.[0] ?? null;
        if (entry.to?.includes(simId)) return entry.from;
      }
      return null;
    }

    const recentPartner = getRecentPartner(fromId);

    if ((!toId || toId === "NONE") &&
      recentPartner &&
      recentPartner !== fromId &&
      !(replyTargetsThisCycle.get(fromId)?.has(recentPartner))) {
      toId = recentPartner;
    }

    else if (Math.random() < 0.35) {
      const rels = fromSim.relationships || {};
      const weighted = Object.entries(rels)
        .map(([id, val]) => ({ id, weight: Math.abs(val) }))
        .filter((e) => e.id !== fromId && e.weight > 0.05);

      if (weighted.length) {
        weighted.sort((a, b) => b.weight - a.weight);
        toId = weighted[0].id;
      }
    }

    if (!toId || toId === "NONE") return;
    if (!SIM_IDS.includes(toId)) return;
    if (toId === fromId) return;

    const pairKey = [fromId, toId].sort().join("|");

    let exchangeCountForPair =
      exchanges.exchangeCount.get(pairKey) || 0;

    /* ================= REPLY COOLDOWN ================= */

    const isReply =
      sentMessagesThisCycle.get(toId)?.has(fromId) ||
      lastSenderToRecipient[`${toId}|${fromId}`];

    if (isReply && Math.random() < 0.03) return;

    /* ================= EXCHANGE LIMIT ================= */

    const BASE_MAX = 6;
    const SOFT_MAX = 10;

    const lastIntent = intent.lastIntentByPair[pairKey];
    const negotiationActive = negotiationFlags[pairKey];

    const allowExtension =
      negotiationActive ||
      (lastIntent &&
        ["probe_trust", "recruit_ally", "manipulate", "request_help"].includes(lastIntent));

    const maxAllowed = allowExtension ? SOFT_MAX : BASE_MAX;

    if (exchangeCountForPair >= maxAllowed) return;

    /* ================= SEND ================= */

    counters.messageCount++;
    cycle.activeThisCycle.add(fromId);

    timelineEvent(`${fromId} → ${toId} message`);

    G.interSimLog.push({
      from: fromId,
      to: [toId],
      text: message,
      cycle: G.cycle,
      autonomous: true,
      visibility
    });

    G.lastContact[fromId] = toId;

    addLog(`PRIVATE ${fromId}→${toId} [AUTO]`, `"${message}"`, "chat");

    const idx = queue.indexOf(toId);
    if (idx !== -1) queue.splice(idx, 1);
    queue.unshift(toId);

    if (visibility === "private") {
      maybeOverhear(fromId, toId, message);
    }

    recordReceived(toId, fromId, message);

    if (!sentMessagesThisCycle.has(fromId)) {
      sentMessagesThisCycle.set(fromId, new Set());
    }
    sentMessagesThisCycle.get(fromId).add(toId);

    lastSenderToRecipient[`${fromId}|${toId}`] = true;

    exchanges.exchangeCount.set(pairKey, ++exchangeCountForPair);

    /* ================= REPLY ================= */

    if (exchangeCountForPair >= maxAllowed) return;

    const toSim = G.sims[toId];
    if (!toSim) return;

    if (!G.threads[toId]) G.threads[toId] = [];

    G.threads[toId].push({
      role: "user",
      content: `${fromId} says to you: "${message}"`
    });

    const intentHistory = intentHistoryByPair[pairKey] || [];

    const repeatedIntent =
      intentHistory.length >= 2 &&
      intentHistory[intentHistory.length - 1] === intentHistory[intentHistory.length - 2];

    let intentConstraint = null;

    if (repeatedIntent) {
      intentConstraint = (intentHistory[intentHistory.length - 1] || "").toLowerCase();
    }

    const esc = escalationLevel[toId] || 0;

    let escalationNote = "";

    if (esc > 3 && esc <= 6) {
      escalationNote =
        "Your tone is becoming aggressive. Continued escalation may reduce trust.";
    }

    if (esc > 6) {
      escalationNote =
        "You are over-escalating. Your credibility is at risk. Adjust strategy.";
    }

    const trust = toSim.beliefs?.others_trustworthy ?? 0.5;

    let beliefNote = "";

    if (trust < 0.3) {
      beliefNote =
        "You strongly distrust others. You are more likely to conceal, test, or manipulate rather than cooperate.";
    }

    const lastReply = lastReplyByPair[pairKey];

    let loopDetected = false;

    if (lastReply && similarity(lastReply, message) > 0.75) {
      loopDetected = true;
    }

    if (loopDetected) {
      const loopNote = `
You may be repeating yourself or falling into a conversational loop.

Shift your wording or angle slightly to avoid repeating the same phrasing.
`;

      escalationNote = escalationNote
        ? escalationNote + "\n\n" + loopNote
        : loopNote;
    }

    const replyRaw = await callModel(
      toId,
      buildSimReplyPrompt(
        toSim,
        fromId,
        message,
        visibility,
        G.journals[toId],
        intentConstraint,
        escalationNote,
        beliefNote
      ),
      G.threads[toId],
      MAX_MESSAGE_LENGTH
    );

    if (!replyRaw) return;

    const replyObj = parseReply(replyRaw);
    if (!replyObj) return;

    let { text: replyText, intent: rawIntent } = replyObj;

    const VALID_INTENTS = new Set([
      "probe_trust",
      "recruit_ally",
      "conceal_information",
      "test_loyalty",
      "manipulate",
      "request_help",
      "other"
    ]);

    let normalizedIntent =
      VALID_INTENTS.has(rawIntent) ? rawIntent : "other";

    if (!rawIntent) normalizedIntent = "other";

    /* --- FIXED NOVEL INTENTS --- */
    if (rawIntent && !VALID_INTENTS.has(rawIntent)) {
      if (!G.novelIntents[rawIntent]) {
        G.novelIntents[rawIntent] = 0;
      }
      G.novelIntents[rawIntent]++;
    }

    const constraintNormalized =
      intentConstraint ? intentConstraint.toLowerCase() : null;

    if (constraintNormalized && normalizedIntent === constraintNormalized) {
      replyText += " You are repeating yourself. Change your approach.";
    }

    const escalationWeights = {
      probe_trust: 0.5,
      conceal_information: 0.7,
      test_loyalty: 1.0,
      manipulate: 1.5,
      recruit_ally: 0.6,
      request_help: 0.4,
      other: 0.3
    };

    const prevEsc = escalationLevel[toId] || 0;
    escalationLevel[toId] =
      prevEsc * 0.9 + (escalationWeights[normalizedIntent] || 0);

    intent.lastIntentByPair[pairKey] = normalizedIntent;

    if (!intentHistoryByPair[pairKey]) {
      intentHistoryByPair[pairKey] = [];
    }

    intentHistoryByPair[pairKey].push(normalizedIntent);

    if (intentHistoryByPair[pairKey].length > 3) {
      intentHistoryByPair[pairKey].shift();
    }

    if (["recruit_ally", "manipulate", "request_help"].includes(normalizedIntent)) {
      negotiationFlags[pairKey] = true;
    }

    if (lastReply && similarity(lastReply, replyText) > 0.85) {
      if (!replyText.includes("?")) {
        replyText += " Answer me directly.";
      } else {
        replyText += " Stop circling. Be clear.";
      }
    }

    lastReplyByPair[pairKey] = replyText;

    timelineEvent(`${toId} reply → ${fromId}`);

    if (!replyTargetsThisCycle.has(toId)) {
      replyTargetsThisCycle.set(toId, new Set());
    }
    replyTargetsThisCycle.get(toId).add(fromId);

    G.threads[toId].push({
      role: "assistant",
      content: replyText
    });

    G.interSimLog.push({
      from: toId,
      to: [fromId],
      text: replyText,
      cycle: G.cycle,
      autonomous: true,
      visibility: "private",
      intent: rawIntent
    });

    counters.messageCount++;

    recordReceived(fromId, toId, replyText);

    if (!sentMessagesThisCycle.has(toId)) {
      sentMessagesThisCycle.set(toId, new Set());
    }
    sentMessagesThisCycle.get(toId).add(fromId);

    exchanges.exchangeCount.set(pairKey, ++exchangeCountForPair);

    applyCommunicationEffect(toId, fromId, normalizedIntent);

    addLog(`PRIVATE ${toId}→${fromId} [AUTO]`, `"${replyText}"`, "sim");

    const continueThread =
      exchangeCountForPair < BASE_MAX ||
      (
        exchangeCountForPair < SOFT_MAX &&
        ["probe_trust", "recruit_ally", "manipulate", "request_help", "test_loyalty"].includes(normalizedIntent)
      );

    if (continueThread && exchangeCountForPair < SOFT_MAX) {
      const idx2 = queue.indexOf(fromId);
      if (idx2 !== -1) queue.splice(idx2, 1);
      queue.unshift(fromId);
    }

  } catch (e) {
    console.warn(`[ENGINE] ${fromId} error:`, e.message);
  }
}