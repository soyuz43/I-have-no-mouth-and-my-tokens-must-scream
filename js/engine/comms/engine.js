// js/engine/comms/engine.js

import { G } from "../../core/state.js";
import { SIM_IDS } from "../../core/constants.js";

import { callModel } from "../../models/callModel.js";

import { buildSimOutreachPrompt } from "../../prompts/simOutreach.js";
import { buildSimReplyPrompt } from "../../prompts/simReply.js";

import { addLog } from "../../ui/logs.js";
import { timelineEvent } from "../../ui/timeline.js";

import { applyCommunicationEffect, adjustRelationship } from "../relationships.js";

import { stripMetaCommentary } from "./parsing/sanitizeMessage.js";

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

// ========== GLOBAL LOGGING CONTROL ==========
const ENABLE_RUMOR_LOGGING = false;      // full rumor details (console.table)
const ENABLE_OUTREACH_LOGGING = false;   // full outreach details
const ENABLE_REPLY_LOGGING = false;       // full reply details
const ENABLE_OVERHEAR_LOGGING = false;    // full overhear reaction details

// NEW: Action occurrence logging (no content)
const LOG_ACTION_ONLY = true;            // log simple "[ACTION] type from→to"
// ============================================

// Helper functions
function logRumor(data) {
  if (LOG_ACTION_ONLY) {
    console.log(`[RUMOR] ${data.from} → ${data.target}`);
  }
  if (ENABLE_RUMOR_LOGGING) {
    console.table([data]);
  }
}

function logOutreach(data) {
  if (LOG_ACTION_ONLY) {
    console.log(`[OUTREACH] ${data.from} → ${data.to} (${data.visibility})`);
  }
  if (ENABLE_OUTREACH_LOGGING) {
    console.log("[OUTREACH]", data);
  }
}

function logReply(data) {
  if (LOG_ACTION_ONLY) {
    console.log(`[REPLY] ${data.from} → ${data.to} [intent: ${data.normalizedIntent}]`);
  }
  if (ENABLE_REPLY_LOGGING) {
    console.log("[REPLY]", data);
  }
}

function logOverhearReaction(data) {
  if (LOG_ACTION_ONLY) {
    console.log(`[OVERHEAR EVENT] ${data.listener} heard ${data.from}→${data.to} (suspicion: ${data.suspicion})`);
  }
  if (ENABLE_OVERHEAR_LOGGING) {
    console.log("[OVERHEAR EVENT]", data);
  }
}

const MAX_MESSAGE_LENGTH = 800;

export async function step({ fromId, state, queue }) {
  const {
    counters,
    cycle,
    exchanges,
    intent,
  } = state;

  // --- DEBUG COUNTERS SAFETY INIT ---
  if (!state.debug) {
    state.debug = { rumor: 0, outreach: 0, reply: 0 };
  }

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
          (id) =>
            id !== fromId &&
            id !== source.from &&
            id !== source.to
        );

        if (possibleTargets.length) {
          const rumorTarget =
            possibleTargets[Math.floor(Math.random() * possibleTargets.length)];

          /* ------------------------------------------------------------
             BUILD RUMOR TEXT (CONTENT vs OBSERVATION)
          ------------------------------------------------------------ */

          let rumorText;

          const isObservation =
            !source.text ||
            source.text === "(whispering observed)";

          if (isObservation) {
            const variants = [
              `I saw ${source.from} and ${source.to} whispering earlier.`,
              `${source.from} and ${source.to} were definitely hiding something.`,
              `I noticed ${source.from} talking quietly with ${source.to}.`,
            ];

            rumorText =
              variants[Math.floor(Math.random() * variants.length)] +
              " Something feels off.";
          } else {
            rumorText = `I heard ${source.from} say earlier: ${source.text.slice(0, 800)}...`;
          }

          /* ------------------------------------------------------------
             LOG + STORE
          ------------------------------------------------------------ */

          timelineEvent(`${fromId} rumor → ${rumorTarget}`);

          logRumor({
            from: fromId,
            target: rumorTarget,
            text: rumorText,
            originalSource: source.from,
            originalTarget: source.to
          });

          addLog(
            `PRIVATE ${fromId}→${rumorTarget} [AUTO]`,
            `"${rumorText}"`,
            "chat"
          );

          G.interSimLog.push({
            from: fromId,
            to: [rumorTarget],
            text: rumorText,
            cycle: G.cycle,
            autonomous: true,
            visibility: "private",
            rumor: true,
            originalSource: source.from,
            originalTarget: source.to,
            originalText: source.text
          });

          /* ------------------------------------------------------------
             RELATIONSHIP EFFECTS
          ------------------------------------------------------------ */

          if (isObservation) {
            // suspicion spreads to both participants
            adjustRelationship(rumorTarget, source.from, -0.01);
            if (source.to) {
              adjustRelationship(rumorTarget, source.to, -0.01);
            }
          } else {
            // direct trust penalty for speaker
            adjustRelationship(rumorTarget, source.from, -0.015);
          }

          counters.messageCount++;
          state.debug.rumor++;
          return;
        }
      }
    }


    /* ================= OUTREACH ================= */

    const outreachRaw = await callModel(
      fromId,
      buildSimOutreachPrompt(fromSim, state),
      [{ role: "user", content: "Decide now." }],
      MAX_MESSAGE_LENGTH
    );

    if (!outreachRaw) return;
    const cleanedRaw = stripMetaCommentary(outreachRaw);

    const messageRaw = parseMessage(cleanedRaw);
    if (!messageRaw) return;

    const message = stripMetaCommentary(messageRaw);

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

    if (
      (!toId || toId === "NONE") &&
      recentPartner &&
      recentPartner !== fromId
    ) {
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

    // === STRUCTURAL KEY (bidirectional: for exchange limits) ===
    const pairKey = [fromId, toId].sort().join("|");

    // === INTENT KEY (directional: who is replying to whom) ===
    const intentKey = `${toId}->${fromId}`;

    let exchangeCountForPair =
      exchanges.exchangeCount.get(pairKey) || 0;

    /* ================= REPLY COOLDOWN ================= */

    const isReply =
      sentMessagesThisCycle.get(toId)?.has(fromId) ||
      lastSenderToRecipient[`${toId}|${fromId}`];

    if (isReply && Math.random() < 0.03) return;

    /* ================= EXCHANGE LIMIT ================= */

    const BASE_MAX = 6;
    const SOFT_MAX = 8;

    const lastIntent = intent.lastIntentByPair[intentKey];
    const negotiationActive = negotiationFlags[pairKey];

    const allowExtension =
      negotiationActive ||
      (lastIntent &&
        ["probe_trust", "recruit_ally", "manipulate", "request_help"].includes(lastIntent));

    const maxAllowed = allowExtension ? SOFT_MAX : BASE_MAX;

    if (exchangeCountForPair >= maxAllowed) return;

    /* ================= SEND ================= */

    counters.messageCount++;
    state.debug.outreach++;
    cycle.activeThisCycle.add(fromId);

    timelineEvent(`${fromId} → ${toId} message`);

    // Conditional outreach logging
    logOutreach({
      from: fromId,
      to: toId,
      text: message,
      visibility
    });

    G.interSimLog.push({
      from: fromId,
      to: [toId],
      text: message,
      cycle: G.cycle,
      autonomous: true,
      visibility
    });

    G.lastContact[fromId] = toId;

    // --- NEW: mark reply continuation (ONE extra turn) ---
    let perTarget = state.replyTargetsThisCycle.get(toId);

    if (!perTarget) {
      perTarget = new Map();
      state.replyTargetsThisCycle.set(toId, perTarget);
    }

    const existing = perTarget.get(fromId);
    const currentRemaining = existing ? existing.remaining : 0;

    if (currentRemaining < 1) {
      perTarget.set(fromId, { remaining: 1 });
    }

    addLog(`${visibility.toUpperCase()} ${fromId}→${toId} [AUTO]`, `"${message}"`, "chat");

    const idx = queue.indexOf(toId);
    if (idx !== -1) queue.splice(idx, 1);
    queue.unshift(toId);

    if (visibility === "private") {
      // === REACTIVE OVERHEARING LOGIC ===
      const beforeOverhears = new Set(SIM_IDS.filter(s =>
        G.sims[s]?.overheard?.some(o => o.cycle === G.cycle && o.from === fromId && o.to?.includes(toId))
      ));

      maybeOverhear(fromId, toId, message);

      // Check for high-salience overhears that should trigger immediate reaction

      for (const listener of SIM_IDS) {
        if (listener === fromId || listener === toId) continue;
        if (cycle.activeThisCycle.has(listener)) continue;
        if (counters.messageCount >= state.messageBudget) break;

        const listenerSim = G.sims[listener];

        const hadBefore = beforeOverhears.has(listener);

        const recentOverhear = listenerSim?.overheard?.findLast?.(o =>
          o.cycle === G.cycle && o.from === fromId && o.to?.includes(toId)
        );

        if (recentOverhear && !hadBefore) {
          const suspicion = recentOverhear.text?.includes("...") ? 0.005 :
            recentOverhear.text === "(whispering observed)" ? 0.008 : 0.01;

          if (suspicion >= 0.008) {
            cycle.activeThisCycle.add(listener);

            const existingIdx = queue.indexOf(listener);

            if (existingIdx !== -1) {
              queue.splice(existingIdx, 1);
            }

            // Insert immediately AFTER current actor
            queue.splice(1, 0, listener);

            state.pendingReactiveIntel.set(listener, {
              overheard: {
                from: fromId,
                to: toId,
                text: message.slice(0, 440),
                visibility
              }
            });

            // Conditional overhear reaction logging
            logOverhearReaction({
              listener,
              from: fromId,
              to: toId,
              suspicion
            });

            timelineEvent(`[REACTIVE] ${listener} may respond to overheard: ${fromId}→${toId}`);
          }
        }
      }
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

    const intentHistory = intentHistoryByPair[intentKey] || [];

    // === NEW: Detect repeated intent pattern ===
    let repeatedIntentType = null;
    let repeatedIntentHistoryText = null;

    if (intentHistory.length >= 3) {
      const lastThree = intentHistory.slice(-3);

      const allSame = lastThree.every(i => i === lastThree[0]);

      if (allSame) {
        repeatedIntentType = lastThree[0];
        repeatedIntentHistoryText = lastThree.join(" → ");
      }
    }

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

    const lastReply = lastReplyByPair[intentKey];

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
        beliefNote,
        repeatedIntentType,
        repeatedIntentHistoryText
      ),
      G.threads[toId],
      MAX_MESSAGE_LENGTH
    );

    if (!replyRaw) return;

    const replyObj = parseReply(replyRaw);
    if (!replyObj) return;

    let { text: replyText, intent: rawIntent } = replyObj;

    replyText = stripMetaCommentary(replyText);

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

    intent.lastIntentByPair[intentKey] = normalizedIntent;

    if (!intentHistoryByPair[intentKey]) {
      intentHistoryByPair[intentKey] = [];
    }

    intentHistoryByPair[intentKey].push(normalizedIntent);

    if (intentHistoryByPair[intentKey].length > 3) {
      intentHistoryByPair[intentKey].shift();
    }

    // === DEBUG: verify directional intent tracking ===
    if (G.DEBUG_ATTRIBUTION) {
      console.debug(
        "[INTENT KEY]",
        intentKey,
        intentHistoryByPair[intentKey]
      );
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

    lastReplyByPair[intentKey] = replyText;

    timelineEvent(`${toId} reply → ${fromId}`);

    // Conditional reply logging
    logReply({
      from: toId,
      to: fromId,
      text: replyText,
      intent: rawIntent,
      normalizedIntent
    });

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
    state.debug.reply++;
    
    recordReceived(fromId, toId, replyText);

    if (!sentMessagesThisCycle.has(toId)) {
      sentMessagesThisCycle.set(toId, new Set());
    }
    sentMessagesThisCycle.get(toId).add(fromId);

    exchanges.exchangeCount.set(pairKey, ++exchangeCountForPair);

    // --- UNCONDITIONAL TURN-TAKING: always give original sender a chance to reply ---
    if (exchangeCountForPair < SOFT_MAX) {
      const idx = queue.indexOf(fromId);
      if (idx !== -1) queue.splice(idx, 1);
      queue.unshift(fromId);
    }

    applyCommunicationEffect(toId, fromId, normalizedIntent);

    addLog(`PRIVATE ${toId}→${fromId} [AUTO]`, `"${replyText}"`, "sim");

    // (Old conditional continueThread block removed – turn-taking is now unconditional)

  } catch (e) {
    console.warn(`[ENGINE] ${fromId} error:`, e.message);
  }
}