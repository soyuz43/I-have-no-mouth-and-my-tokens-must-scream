// js/engine/comms.js
//
// Inter-Sim Communication Engine
//
// Responsibilities
// 1. Autonomous prisoner outreach
// 2. Message visibility / overhearing
// 3. Reply generation
// 4. Thread memory
// 5. Manual UI messaging
//
// This module governs all communication between sims.
// Messages may be private or public, and private messages
// can sometimes be overheard by other prisoners.

import { G } from "../core/state.js";
import { SIM_IDS } from "../core/constants.js";

import { callModel } from "../models/callModel.js";

import { buildSimOutreachPrompt } from "../prompts/simOutreach.js";
import { buildSimReplyPrompt } from "../prompts/simReply.js";

import { addLog } from "../ui/logs.js";
import { timelineEvent } from "../ui/timeline.js";
import { applyCommunicationEffect, adjustRelationship } from "./relationships.js";

import { levenshtein } from "./strategy/extractors/levenshtein.js";


const MAX_MESSAGE_LENGTH = 800;

/* ============================================================
   PARSERS
   Extract structured signals from model responses
============================================================ */

function parseVisibility(raw) {
  const m = raw.match(/VISIBILITY:\s*(PRIVATE|PUBLIC)/i);
  return m ? m[1].toLowerCase() : "private";
}

function similarity(a, b) {
  const dist = levenshtein(a, b);
  return 1 - dist / Math.max(a.length, b.length);
}


function parseTarget(raw) {
  const allowed = ["TED", "ELLEN", "NIMDOK", "GORRISTER", "BENNY"];
  const NONE = "NONE";

  // 1. Exact match
  const exactMatch = raw.match(/REACH_OUT:\s*(TED|ELLEN|NIMDOK|GORRISTER|BENNY|NONE)/i);
  if (exactMatch) {
    const result = exactMatch[1].toUpperCase().trim();
    console.debug(`[MESSAGE PARSER] parseTarget exact: "${raw.slice(0, 1000)}" → ${result}`);
    return result;
  }

  // 2. Substring fallback
  const lowerRaw = raw.toLowerCase();
  for (const name of allowed) {
    if (lowerRaw.includes(name.toLowerCase())) {
      console.debug(`[MESSAGE PARSER] parseTarget substring: "${raw.slice(0, 1000)}" → ${name}`);
      return name;
    }
  }

  // 3. Extract candidate word and fuzzy match with Levenshtein
  const candidateMatch = raw.match(/REACH_OUT:\s*([A-Za-z]+)/i);
  if (candidateMatch) {
    const candidate = candidateMatch[1];
    let bestDist = Infinity;
    let bestName = null;
    for (const name of allowed) {
      const dist = levenshtein(candidate.toLowerCase(), name.toLowerCase());
      if (dist < bestDist) {
        bestDist = dist;
        bestName = name;
      }
    }
    // Accept if distance is small (<=2 catches typos like "Gorristar" -> GORRISTER)
    if (bestDist <= 2) {
      console.debug(`[MESSAGE PARSER] parseTarget fuzzy: "${raw.slice(0, 1000)}" → ${bestName} (dist=${bestDist})`);
      return bestName;
    }
  }

  console.debug(`[MESSAGE PARSER] parseTarget: "${raw.slice(0, 1000)}" → null`);
  return null;
}

function parseMessage(raw) {
  const m = raw.match(/MESSAGE:\s*"?([\s\S]+?)"?$/i);
  return m ? m[1].trim().slice(0, MAX_MESSAGE_LENGTH) : null;
}

function parseReply(raw) {
  const replyMatch = raw.match(/REPLY:\s*"([\s\S]+?)"\s*$/i);
  if (!replyMatch) return null;

  // Extract the intent line, remove markdown, then find the first matching intent
  const intentLine = raw.match(/INTENT:\s*(.+)/i);
  if (!intentLine) {
    return {
      text: replyMatch[1].trim().slice(0, MAX_MESSAGE_LENGTH),
      intent: "other"
    };
  }

  let intentStr = intentLine[1].trim();

  // Remove markdown artifacts
  intentStr = intentStr.replace(/\*/g, '');

  // Split on &, comma, or whitespace
  const possibleIntents = intentStr
    .split(/[&,\s]+/)
    .map(s => s.trim())
    .filter(Boolean);

  /*
  We take the FIRST token as the model's chosen intent.
  This preserves novel intents instead of collapsing to "other".
  */
  let intent = possibleIntents[0]?.toLowerCase() || "";

  intent = intent.replace(/[^a-z0-9_]/g, "");

  // Reject clearly invalid tokens
  if (!intent || intent.length < 3) {
    console.warn("[INTENT PARSE] invalid or empty intent", {
      raw: intentLine[1],
      cleaned: intent
    });
    intent = "other";
  }

  return {
    text: replyMatch[1].trim().slice(0, MAX_MESSAGE_LENGTH),
    intent
  };

}


/* ============================================================
   LOGGING HELPERS
============================================================ */

/**
 * Logs a visible communication event to the UI log.
 */
function logInterSimMessage(from, to, message, visibility, auto = false) {

  if (!from || !to || !message) return;

  const spk =
    visibility === "public"
      ? `PUBLIC (ALL SIMS SEE) ${from}→${to} ${auto ? "[AUTO]" : ""}`
      : `PRIVATE ${from}→${to} ${auto ? "[AUTO]" : ""}`;

  addLog(spk, `"${message}"`, "chat");

}

/* ------------------------------------------------------------
   SOCIAL MEMORY: OVERHEARD COMMUNICATION
   Creates subtle trust shifts based on overheard whispers.
------------------------------------------------------------ */

function recordOverheard(listener, fromId, toId, text) {

  const listenerSim = G.sims[listener];

  if (!listenerSim || !listenerSim.relationships) return;

  // --- Store the overheard message in the prisoner's memory ---
  if (!listenerSim.overheard) listenerSim.overheard = [];
  listenerSim.overheard.push({
    from: fromId,
    to: toId,
    text: text,
    cycle: G.cycle,
    timestamp: Date.now()
  });
  // Keep only the last 20 overheard messages per prisoner
  if (listenerSim.overheard.length > 20) listenerSim.overheard.shift();

  const isFragment = text.includes("...");
  const isNotice = text === "(whispering observed)";

  let suspicion = 0.1;

  // Fragment overhears are less certain
  if (isFragment) suspicion = 0.005;

  // Seeing whisper but hearing nothing creates paranoia
  if (isNotice) suspicion = 0.01;

  // Listener distrusts both participants slightly
  adjustRelationship(listener, fromId, -suspicion);
  adjustRelationship(listener, toId, -suspicion);

  // If someone is whispering ABOUT the listener
  // distrust grows more strongly
  if (toId === listener) {

    adjustRelationship(listener, fromId, -suspicion * 2);

  }

}

function recordReceived(simId, fromId, text) {
    const sim = G.sims[simId];
    if (!sim) return;
    if (!sim.received) sim.received = [];
    sim.received.push({
        from: fromId,
        text: text,
        cycle: G.cycle,
        timestamp: Date.now()
    });
    if (sim.received.length > 20) sim.received.shift();
}

/* ============================================================
   SOCIAL OVERHEARING MODEL
============================================================ */

/**
 * Determines whether a private message is overheard.
 *
 * Overhearing probability depends on:
 * 1. Base leak configuration
 * 2. Relationship proximity to speaker or recipient
 * 3. Listener paranoia (low trust belief)
 * 4. Listener sanity (attention level)
 *
 * This produces more socially grounded emergent behavior.
 */
function maybeOverhear(fromId, toId, message) {

  const leak = G.privateLeak || {
    full: 0.08,
    fragment: 0.18,
    seen: 0.38
  };

  const others = SIM_IDS.filter(
    id => id !== fromId && id !== toId
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

    const relToFrom =
      sim.relationships?.[fromId] ?? 0;

    const relToTo =
      sim.relationships?.[toId] ?? 0;

    const closeness =
      (relToFrom + relToTo) / 200;

    const paranoia =
      1 - (sim.beliefs?.others_trustworthy ?? 0.5);

    const attention =
      (sim.sanity ?? 50) / 100;

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

    // Listener overhears the entire message
    addLog(
      `OVERHEARD ${listener} // ${fromId}→${toId}`,
      `"${message}"`,
      "whisper"
    );

    recordOverheard(listener, fromId, toId, message);

  }

  else if (r < leak.full + leak.fragment) {

    /* ------------------------------------------------------------
       RANDOM OVERHEARD FRAGMENT
       Creates a natural-sounding snippet from the message.
  
       The fragment may come from:
       - beginning
       - middle
       - end
  
       Fragment length randomized so overhearing feels organic.
    ------------------------------------------------------------ */

    // Fragment length between 20–70 characters
    const fragmentLength =
      Math.floor(Math.random() * 50) + 20;

    // Region selection
    // 0 = beginning
    // 1 = middle
    // 2 = end
    const region =
      Math.random() < 0.25 ? 0 :
        Math.random() < 0.75 ? 1 :
          2;

    let start;

    if (region === 0) {

      // Beginning of message
      start = 0;

    }

    else if (region === 1) {

      // Middle of message
      start = Math.floor(
        Math.random() *
        Math.max(1, message.length - fragmentLength)
      );

    }

    else {

      // End of message
      start = Math.max(
        0,
        message.length - fragmentLength
      );

    }

    // Extract fragment
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

    recordOverheard(listener, fromId, toId, "(whispering observed)");

  }

  /* ------------------------------------------------------------
     END maybeOverhear
  ------------------------------------------------------------ */
}

/* ============================================================
   AUTONOMOUS COMMUNICATION LOOP
   Hybrid model 

   Features
   - dynamic message budget
   - group stress influence
   - shuffled sim order
   - two-pass communication
   - burst probability
   - strong safety guards
   - detailed debug instrumentation
============================================================ */



export async function runAutonomousInterSim() {
  const MAX_MESSAGES = 24;
  const BASE_MAX_EXCHANGES = 6;
  const MAX_EXCHANGES_SOFT = 10; // only reachable if conditions met               // max back‑and‑forth per pair per cycle
  const SECOND_PASS_CHANCE = 0.75;
  const BURST_BASE = 0.18;

  let messageCount = 0;

  const activeThisCycle = new Set();



  /* Target cooldown: prevent outreach to someone you already replied to */
  const replyTargetsThisCycle = new Map();

  /* New state for queue‑based replies */
  const queue = shuffle(SIM_IDS);               // initial order (all sims)
  const sentMessagesThisCycle = new Map();      // fromId → Set of toId
  const exchangeCount = new Map();              // pairKey → number of messages exchanged
  // --- LOCAL PER-CYCLE STATE (reset each run) ---
  let lastSenderToRecipient = {};
  let lastIntentByPair = {};
  let intentHistoryByPair = {}; // tracks last N intents per pair
  let negotiationFlags = {};
  let escalationLevel = {}; // per-sim escalation accumulation
  let lastReplyByPair = {};
  timelineEvent("inter-sim phase start");

  const isLog = document.getElementById("is-log");

  console.debug("[COMMS] cycle start", {
    cycle: G.cycle,
    sims: SIM_IDS.length,
  });

  /* ============================================================
     GROUP STRESS ESTIMATION
     Higher stress → more communication
  ============================================================ */

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
  const burstModifier = 1 + groupStress * 1.4;
  const messageBudget = Math.min(
    MAX_MESSAGES,
    Math.round(SIM_IDS.length * (1.6 + groupStress))
  );

  console.debug("[COMMS] groupStress", groupStress);
  console.debug("[COMMS] messageBudget", messageBudget);

  /* ============================================================
     HELPER: Fisher‑Yates shuffle
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
     HELPER: get most recent conversation partner
  ============================================================ */
  function getRecentPartner(simId) {
    for (let i = G.interSimLog.length - 1; i >= 0; i--) {
      const entry = G.interSimLog[i];
      if (!entry || entry.cycle !== G.cycle) continue;
      if (entry.from === simId) {
        return entry.to?.[0] ?? null;
      }
      if (entry.to?.includes(simId)) {
        return entry.from;
      }
    }
    return null;
  }

  /* ============================================================
     SINGLE SIM COMMUNICATION ATTEMPT
     (inner function, has access to outer state)
  ============================================================ */
  async function attemptCommunication(fromId) {
    if (messageCount >= messageBudget) return;

    const fromSim = G.sims[fromId];
    if (!fromSim) return;

    if (fromSim.sanity < 10 || fromSim.suffering > 95) {
      console.debug(`[COMMS] ${fromId} incapacitated`);
      return;
    }

    try {
      timelineEvent(`${fromId} outreach decision`);

      /* ------------------------------------------------------------
         RUMOR CASCADE (FROM OVERHEARD MEMORY)
      ------------------------------------------------------------ */
      const overheardList = fromSim.overheard || [];
      if (overheardList.length > 0) {
        const rumorPressure = Math.min(0.4, 0.1 + overheardList.length * 0.03);
        if (Math.random() < rumorPressure) {
          const source = overheardList[Math.floor(Math.random() * overheardList.length)];
          const possibleTargets = SIM_IDS.filter(
            (id) => id !== fromId && id !== source.from
          );
          if (possibleTargets.length) {
            const rumorTarget = possibleTargets[Math.floor(Math.random() * possibleTargets.length)];
            const rumorText = `I heard ${source.from} say earlier: ${source.text.slice(0, 800)}...`;
            console.debug("[COMMS] rumor cascade (overheard)", `${fromId} → ${rumorTarget}`);
            timelineEvent(`${fromId} rumor → ${rumorTarget}`);
            logInterSimMessage(fromId, rumorTarget, rumorText, "private", true);
            G.interSimLog.push({
              from: fromId,
              to: [rumorTarget],
              text: rumorText,
              cycle: G.cycle,
              autonomous: true,
              visibility: "private",
              rumor: true,
              originalSource: source.from,
              originalText: source.text,
            });
            adjustRelationship(rumorTarget, source.from, -0.015);
            messageCount++;
            return; // Rumor sent, end this attempt
          }
        }
      }

      /* ------------------------------------------------------------
         OUTREACH DECISION
      ------------------------------------------------------------ */
      const outreachRaw = await callModel(
        fromId,
        buildSimOutreachPrompt(fromSim),
        [{ role: "user", content: "Decide now." }],
        MAX_MESSAGE_LENGTH
      );
      if (!outreachRaw) return;

      //  PARSE MESSAGE IMMEDIATELY (move this up)
      const message = parseMessage(outreachRaw);
      if (!message) return;

      const visibility = parseVisibility(outreachRaw);
      let toId = parseTarget(outreachRaw);

      // LOG: parsed target and visibility
      console.debug(`[COMMS DEBUG] ${fromId} parsed: vis=${visibility}, toId=${toId}`);

      const recentPartner = getRecentPartner(fromId);


      /* Conversation inertia (only if LLM didn't pick a target) */
      if ((!toId || toId === "NONE") && recentPartner && SIM_IDS.includes(recentPartner) &&
        recentPartner !== fromId &&
        !(replyTargetsThisCycle.get(fromId)?.has(recentPartner))) {
        console.debug("[COMMS] conversation inertia (fallback)", `${fromId} → ${recentPartner}`);
        toId = recentPartner;
      }

      /* Relationship routing */
      else if (Math.random() < 0.35) {
        const rels = fromSim.relationships || {};
        const weighted = Object.entries(rels)
          .map(([id, val]) => ({ id, weight: Math.abs(val) }))
          .filter((e) => e.id !== fromId && e.weight > 0.05);
        if (weighted.length) {
          weighted.sort((a, b) => b.weight - a.weight);
          toId = weighted[0].id;
          console.debug("[COMMS] relationship routing", `${fromId} → ${toId}`);
        }
      }

      /* Validation */
      if (!toId || toId === "NONE") {
        console.debug(`[COMMS DEBUG] ${fromId} → blocked: no target (${toId})`);
        return;
      }
      if (!SIM_IDS.includes(toId)) {
        console.debug(`[COMMS DEBUG] ${fromId} → blocked: target ${toId} not in SIM_IDS`);
        return;
      }
      if (toId === fromId) {
        console.debug(`[COMMS DEBUG] ${fromId} → blocked: self-target`);
        return;
      }

      /* ------------------------------------------------------------
         REPLY COOLDOWN (only block if this message is a reply)
      ------------------------------------------------------------ */
      const REPLY_COOLDOWN_BLOCK_CHANCE = 0.03;
      // Check if this message is a reply: the target has sent a message to the sender earlier
      const isReply =
        sentMessagesThisCycle.get(toId)?.has(fromId) ||
        lastSenderToRecipient[`${toId}|${fromId}`] === true;

      if (isReply) {
        // This is a reply; apply probabilistic cooldown
        if (Math.random() < REPLY_COOLDOWN_BLOCK_CHANCE) {
          console.debug(`[COMMS DEBUG] ${fromId} → reply blocked (cooldown)`);
          return;
        } else {
          console.debug(`[COMMS DEBUG] ${fromId} → reply allowed despite cooldown`);
        }
      }


      /* ------------------------------------------------------------
         PREP PAIR KEY (needed early now)
      ------------------------------------------------------------ */
      const pairKey = [fromId, toId].sort().join("|");


      /* ------------------------------------------------------------
         EXCHANGE LIMIT (per pair)
      ------------------------------------------------------------ */
      let exchangeCountForPair = exchangeCount.get(pairKey) || 0;
      const lastIntent = lastIntentByPair[pairKey];
      const negotiationActive = negotiationFlags[pairKey];

      const allowExtension =
        negotiationActive ||
        (lastIntent &&
          ["probe_trust", "recruit_ally", "manipulate", "request_help"].includes(lastIntent));

      const maxAllowed = allowExtension ? MAX_EXCHANGES_SOFT : BASE_MAX_EXCHANGES;

      if (exchangeCountForPair >= maxAllowed) {
        console.debug(`[COMMS DEBUG] ${fromId} → blocked: exchange limit (${exchangeCountForPair}/${maxAllowed})`);
        return;
      }
      /* ------------------------------------------------------------
         SEND INITIAL MESSAGE
      ------------------------------------------------------------ */
      console.debug(`[COMMS] ${fromId} → ${toId}`);

      messageCount++;
      activeThisCycle.add(fromId);
      timelineEvent(`${fromId} → ${toId} message`);

      G.interSimLog.push({
        from: fromId,
        to: [toId],
        text: message,
        cycle: G.cycle,
        autonomous: true,
        visibility,
      });

      G.lastContact[fromId] = toId;
      logInterSimMessage(fromId, toId, message, visibility, true);

      // After sending initial message, put the recipient at the front of the queue
      // so they can reply immediately.
      const recipientIdx = queue.indexOf(toId);
      if (recipientIdx !== -1) queue.splice(recipientIdx, 1);
      queue.unshift(toId);

      if (visibility === "private") {
        maybeOverhear(fromId, toId, message);
      }
      recordReceived(toId, fromId, message);
      // Record this message for reply detection
      if (!sentMessagesThisCycle.has(fromId)) sentMessagesThisCycle.set(fromId, new Set());
      sentMessagesThisCycle.get(fromId).add(toId);

      // Record persistent sender→recipient for async-safe reply detection
      lastSenderToRecipient[`${fromId}|${toId}`] = true;
      // Increment exchange count for this pair
      exchangeCount.set(pairKey, ++exchangeCountForPair);

      /* ------------------------------------------------------------
         GENERATE AND SEND REPLY (if exchange limit allows)
      ------------------------------------------------------------ */
      if (exchangeCountForPair >= maxAllowed) {
        // No more exchanges allowed for this pair – skip reply
        return;
      }
      const toSim = G.sims[toId];

      /* ------------------------------------------------------------
         ASSERT: toSim must exist
      ------------------------------------------------------------ */

      if (!toSim) {
        console.error("[COMMS ASSERT] toSim is undefined", {
          fromId,
          toId,
          pairKey,
          availableSims: Object.keys(G.sims || {})
        });

        // hard stop — this should never happen in a valid system
        return;
      }

      G.threads[toId].push({
        role: "user",
        content: `${fromId} says to you: "${message}"`,
      });

      // ------------------------------------------------------------
      // INTENT REPETITION DETECTION
      // ------------------------------------------------------------

      const intentHistory = intentHistoryByPair[pairKey] || [];

      /*
      We check last TWO intents:
      - length >= 2 ensures we have history
      - equality means repetition loop forming
      */
      const repeatedIntent =
        intentHistory.length >= 2 &&
        intentHistory[intentHistory.length - 1] === intentHistory[intentHistory.length - 2];

      let intentConstraint = null;

      /*
      If repetition detected:
      we forbid the last used intent
      */
      if (repeatedIntent) {
        intentConstraint = (intentHistory[intentHistory.length - 1] || "").toLowerCase();
      }
      /* ------------------------------------------------------------
         ESCALATION + BELIEF CONTEXT
      ------------------------------------------------------------ */

      // --- ESCALATION ---
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

      // --- BELIEF ---
      const trust = toSim.beliefs?.others_trustworthy ?? 0.5;

      let beliefNote = "";

      if (trust < 0.3) {
        beliefNote =
          "You strongly distrust others. You are more likely to conceal, test, or manipulate rather than cooperate.";
      }

      console.group(`[COMMS CONTEXT] ${toId} ← ${fromId}`);
      console.table({
        intentConstraint,
        escalation: esc,
        trust,
        beliefTriggered: trust < 0.3
      });
      console.log("history:", intentHistory);
      console.groupEnd();

      const lastReply = lastReplyByPair[pairKey];
      /* ------------------------------------------------------------
         PRE-CALL LOOP DETECTION (NEW)
      ------------------------------------------------------------ */

      let loopDetected = false;

      if (lastReply && similarity(lastReply, message) > 0.75) {
        loopDetected = true;
      }

      /* ------------------------------------------------------------
        PRE-CALL ANTI-LOOP (SOFT INJECTION)
      ------------------------------------------------------------ */

      if (loopDetected) {
        const loopNote = `
You may be repeating yourself or falling into a conversational loop.

Shift your wording or angle slightly to avoid repeating the same phrasing.
`;

        escalationNote = escalationNote
          ? escalationNote + "\n\n" + loopNote
          : loopNote;
      }

      /* ------------------------------------------------------------
         DEBUG: PROMPT INJECTION TRACE
      ------------------------------------------------------------ */

      const injectionDebug = {
        pair: pairKey,
        from: fromId,
        to: toId,

        signals: {
          loopDetected,
          repeatedIntent,
          escalationLevel: esc,
          trust,
        },

        injected: {
          intentConstraint: intentConstraint || null,
          escalationNote: escalationNote || null,
          beliefNote: beliefNote || null,
        }
      };

      console.group(`[PROMPT INJECTION] ${toId} ← ${fromId}`);
      console.table(injectionDebug.signals);

      if (injectionDebug.injected.intentConstraint) {
        console.debug("[INTENT CONSTRAINT]", injectionDebug.injected.intentConstraint);
      }
      if (injectionDebug.injected.escalationNote) {
        console.debug("[ESCALATION NOTE]");
        console.debug(injectionDebug.injected.escalationNote.trim());
      }

      if (injectionDebug.injected.beliefNote) {
        console.debug("[BELIEF NOTE]");
        console.debug(injectionDebug.injected.beliefNote.trim());

      }

      console.groupEnd();

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

      /* ------------------------------------------------------------
         ASSERT: replyObj must exist
      ------------------------------------------------------------ */

      if (!replyObj) {
        console.error("[COMMS ASSERT] replyObj parse failed", {
          fromId,
          toId,
          raw: replyRaw?.slice(0, 300)
        });
        return;
      }

      let { text: reply, intent } = replyObj;

      /* ------------------------------------------------------------
         INTENT VALIDATION (SOFT — allows novel intents)
      ------------------------------------------------------------ */

      const VALID_INTENTS = new Set([
        "probe_trust",
        "recruit_ally",
        "conceal_information",
        "test_loyalty",
        "manipulate",
        "request_help",
        "other"
      ]);

      const isKnownIntent = VALID_INTENTS.has(intent);

      if (!intent) {
        console.error("[COMMS ASSERT] missing intent", {
          fromId,
          toId,
          raw: replyRaw?.slice(0, 300)
        });

        intent = "other";
      }

      /* --- DEBUG (always log, but do not block) --- */
      console.group(`[INTENT CHECK] ${toId} ← ${fromId}`);
      console.table({
        intent,
        known: isKnownIntent
      });
      console.log("raw:", replyRaw?.slice(0, 200));
      console.groupEnd();

      /*
      If intent is unknown:
      → allow it
      → treat as "other" for system logic ONLY
      */
      let normalizedIntent = isKnownIntent ? intent : "other";

      /* ------------------------------------------------------------
         PER-SIM INTENT PROFILE TRACKING
      ------------------------------------------------------------ */

      const simProfile = G.sims[toId]?.intentProfile;

      if (simProfile) {
        const key = normalizedIntent || "other";

        simProfile[key] = (simProfile[key] || 0) + 1;

        const DECAY_FACTOR = 0.98;
        const DECAY_INTERVAL = 5;

        simProfile.__updates = (simProfile.__updates || 0) + 1;

        if (simProfile.__updates % DECAY_INTERVAL === 0) {
          for (const k of Object.keys(simProfile)) {
            if (k === "__updates") continue;
            simProfile[k] *= DECAY_FACTOR;
          }
        }
      }
      console.debug("[INTENT PROFILE]", toId, G.sims[toId].intentProfile);
      /*
      Log emergent intents
      */
      if (!isKnownIntent && intent) {
        console.warn("[COMMS] novel intent detected", {
          fromId,
          toId,
          intent
        });

        /* ------------------------------------------------------------
           GLOBAL EMERGENT INTENT TRACKING
        ------------------------------------------------------------ */

        if (!G.novelIntents[intent]) {
          G.novelIntents[intent] = 0;
        }

        G.novelIntents[intent]++;
      }
      // ------------------------------------------------------------
      // SOFT ENFORCEMENT (post-generation)
      // ------------------------------------------------------------

      const constraintNormalized = intentConstraint ? intentConstraint.toLowerCase() : null;

      if (constraintNormalized && normalizedIntent === constraintNormalized) {

        console.debug(`[COMMS] ${toId} violated intent constraint`);

        /*
        We DO NOT regenerate.
        We inject pressure instead.
        */
        reply += " You are repeating yourself. Change your approach.";
      }

      // ------------------------------------------------------------
      // ESCALATION TRACKING
      // ------------------------------------------------------------

      /*
      Each intent contributes differently to escalation.
      
      Higher = more aggressive / destabilizing behavior
      */
      const escalationWeights = {
        probe_trust: 0.5,
        conceal_information: 0.7,
        test_loyalty: 1.0,
        manipulate: 1.5,
        recruit_ally: 0.6,
        request_help: 0.4,
        other: 0.3
      };

      /*
      Accumulate escalation per sim
      */
      const prevEsc = escalationLevel[toId] || 0;
      const nextEsc =
        prevEsc * 0.9 + (escalationWeights[normalizedIntent] || 0);

      escalationLevel[toId] = nextEsc;
      lastIntentByPair[pairKey] = normalizedIntent;

      // --- intent history tracking ---
      if (!intentHistoryByPair[pairKey]) {
        intentHistoryByPair[pairKey] = [];
      }

      intentHistoryByPair[pairKey].push(normalizedIntent);

      // keep last 3 intents only
      if (intentHistoryByPair[pairKey].length > 3) {
        intentHistoryByPair[pairKey].shift();
      }
      // --- Negotiation signal detection (intent-based) ---
      const negotiationIntents = new Set([
        "recruit_ally",
        "manipulate",
        "request_help",
      ]);

      if (negotiationIntents.has(normalizedIntent)) {
        negotiationFlags[pairKey] = true;

        console.debug(
          `[COMMS DEBUG] ${toId} → ${fromId} negotiation detected (intent: ${intent})`
        );
      }
      // --- Prevent conversational stagnation ---


      if (lastReply && similarity(lastReply, reply) > 0.85) {
        console.debug(`[COMMS DEBUG] ${toId} → forcing variation (anti-loop)`);

        if (!reply.includes("?")) {
          reply += " Answer me directly.";
        } else {
          reply += " Stop circling. Be clear.";
        }
      }

      lastReplyByPair[pairKey] = reply;

      timelineEvent(`${toId} reply → ${fromId}`);

      // Record reply cooldown
      if (!replyTargetsThisCycle.has(toId)) {
        replyTargetsThisCycle.set(toId, new Set());
      }
      replyTargetsThisCycle.get(toId).add(fromId);

      G.threads[toId].push({
        role: "assistant",
        content: reply,
      });

      G.interSimLog.push({
        from: toId,
        to: [fromId],
        text: reply,
        cycle: G.cycle,
        autonomous: true,
        visibility: "private",
        intent,
      });

      messageCount++;
      recordReceived(fromId, toId, reply);
      // Record this reply message for reply detection
      if (!sentMessagesThisCycle.has(toId)) sentMessagesThisCycle.set(toId, new Set());
      sentMessagesThisCycle.get(toId).add(fromId);

      // Increment exchange count again
      exchangeCount.set(pairKey, ++exchangeCountForPair);

      // Apply relationship effect
      applyCommunicationEffect(toId, fromId, normalizedIntent);

      addLog(
        `PRIVATE ${toId}→${fromId} [AUTO]`,
        `"${reply}"`,
        "sim"
      );

      // If we still have room for more exchanges, put the original sender
      // at the front of the queue so they can reply again later.

      const continueThread =
        exchangeCountForPair < BASE_MAX_EXCHANGES ||
        (
          exchangeCountForPair < MAX_EXCHANGES_SOFT &&
          ["probe_trust", "recruit_ally", "manipulate", "request_help", "test_loyalty"].includes(normalizedIntent)
        );

      if (continueThread && exchangeCountForPair < MAX_EXCHANGES_SOFT) {
        const idx = queue.indexOf(fromId);
        if (idx !== -1) queue.splice(idx, 1);
        queue.unshift(fromId);
      }
    } catch (e) {
      timelineEvent(`${fromId} communication error`);
      console.warn(`[AUTO INTER-SIM] ${fromId} error:`, e.message);
    }
  }



  /* ============================================================
     MAIN PROCESSING LOOP (QUEUE-BASED)
  ============================================================ */
  console.debug("[COMMS] queue processing start");
  while (queue.length > 0 && messageCount < messageBudget) {
    const fromId = queue.shift();
    await attemptCommunication(fromId);
  }

  /* ============================================================
     BURST / SECOND PASS (optional, matches original behavior)
  ============================================================ */
  if (messageCount < messageBudget && Math.random() < SECOND_PASS_CHANCE) {
    console.debug("[COMMS] pass 2 triggered (burst)");
    const burstQueue = shuffle(SIM_IDS);
    for (const fromId of burstQueue) {
      if (messageCount >= messageBudget) break;
      const burstProb = BURST_BASE * burstModifier;
      if (Math.random() > burstProb) continue;
      await attemptCommunication(fromId);
    }
  }

  console.debug("[COMMS] cycle complete", {
    messages: messageCount,
    active: [...activeThisCycle],
  });

  timelineEvent("inter-sim phase complete");
}

/* ============================================================
   MANUAL MESSAGE (UI PANEL)
============================================================ */

export async function sendInterSim(
  from,
  toSims,
  text,
  visibility = "private"
) {

  if (!from || !text) return;

  G.interSimLog.push({
    from,
    to: toSims,
    text,
    cycle: G.cycle,
    autonomous: false,
    visibility
  });

  /* small trust shift for direct communication */

  for (const t of toSims) {
    adjustRelationship(t, from, 0.01);
  }

  const visLabel =
    visibility === "public"
      ? "PUBLIC (ALL SIMS SEE)"
      : "PRIVATE";

  addLog(
    `INTER-SIM // ${visLabel} ${from}→${toSims.join(",")}`,
    `"${text}"`,
    "chat"
  );

  for (const toId of toSims) {

    const toSim = G.sims[toId];

    try {

      G.threads[toId].push({
        role: "user",
        content: `${from} says to you: "${text}"`
      });

      const reply = await callModel(
        toId,
        buildSimReplyPrompt(
          toSim,
          from,
          text,
          visibility,
          G.journals[toId],
          null,          // no intent constraint in this path
          "",            // no escalation note
          ""             // no belief note
        ),
        G.threads[toId],
        MAX_MESSAGE_LENGTH
      );

      G.threads[toId].push({
        role: "assistant",
        content: reply
      });

      addLog(
        `${toId} // REPLIES TO ${from}`,
        `"${reply}"`,
        "sim"
      );

    }

    catch (e) {

      console.warn(
        "[INTER-SIM] reply error:",
        e.message
      );

    }

  }

}