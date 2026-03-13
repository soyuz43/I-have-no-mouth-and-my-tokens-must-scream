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


/* ============================================================
   PARSERS
   Extract structured signals from model responses
============================================================ */

function parseVisibility(raw) {
  const m = raw.match(/VISIBILITY:\s*(PRIVATE|PUBLIC)/i);
  return m ? m[1].toLowerCase() : "private";
}

function parseTarget(raw) {
  const m = raw.match(
    /REACH_OUT:\s*(TED|ELLEN|NIMDOK|GORRISTER|BENNY|NONE)/i
  );
  return m ? m[1].toUpperCase().trim() : null;
}

function parseMessage(raw) {
  const m = raw.match(/MESSAGE:\s*"?([\s\S]+?)"?$/i);
  return m ? m[1].trim().slice(0, 300) : null;
}

function parseReply(raw) {
  const replyMatch = raw.match(/REPLY:\s*"([\s\S]+?)"\s*$/i);
  if (!replyMatch) return null;

  const intentMatch = raw.match(
    /INTENT:\s*(probe_trust|recruit_ally|conceal_information|test_loyalty|manipulate|request_help|other)/i
  );

  return {
    text: replyMatch[1].trim().slice(0, 300),
    intent: intentMatch ? intentMatch[1].toLowerCase() : "other"
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

  const isFragment = text.includes("...");
  const isNotice = text === "(whispering observed)";

  let suspicion = 0.01;

  // Fragment overhears are less certain
  if (isFragment) suspicion = 0.005;

  // Seeing whisper but hearing nothing creates paranoia
  if (isNotice) suspicion = 0.008;

  // Listener distrusts both participants slightly
  adjustRelationship(listener, fromId, -suspicion);
  adjustRelationship(listener, toId, -suspicion);

  // If someone is whispering ABOUT the listener
  // distrust grows more strongly
  if (toId === listener) {

    adjustRelationship(listener, fromId, -suspicion * 2);

  }

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
    full: 0.05,
    fragment: 0.15,
    seen: 0.2
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
============================================================ */

export async function runAutonomousInterSim() {

  timelineEvent("inter-sim phase start");

  const isLog = document.getElementById("is-log");

  const repliedPairs = new Set();

  for (const fromId of SIM_IDS) {

    const fromSim = G.sims[fromId];

    // psychologically incapacitated sims don't communicate
    if (fromSim.sanity < 10 || fromSim.suffering > 95) continue;

    try {

      timelineEvent(`${fromId} outreach decision`);

      const outreachRaw = await callModel(
        fromId,
        buildSimOutreachPrompt(fromSim),
        [{ role: "user", content: "Decide now." }],
        200
      );

      if (!outreachRaw) continue;

      const visibility = parseVisibility(outreachRaw);
      const toId = parseTarget(outreachRaw);

      if (!toId || toId === "NONE") continue;
      if (!SIM_IDS.includes(toId)) continue;
      if (toId === fromId) continue;
      if (G.lastContact[fromId] === toId) continue;

      const message = parseMessage(outreachRaw);
      if (!message) continue;

      timelineEvent(`${fromId} → ${toId} message`);

      const toSim = G.sims[toId];

      /* --------------------------------------------
         RECORD MESSAGE IN ENGINE MEMORY
      -------------------------------------------- */

      G.interSimLog.push({
        from: fromId,
        to: [toId],
        text: message,
        cycle: G.cycle,
        autonomous: true,
        visibility
      });

      G.lastContact[fromId] = toId;

      /* --------------------------------------------
         LOG THE MESSAGE (VISIBLE TO PLAYER)
      -------------------------------------------- */

      logInterSimMessage(
        fromId,
        toId,
        message,
        visibility,
        true
      );
      /* --------------------------------------------
         POSSIBLE OVERHEARING
      -------------------------------------------- */

      if (visibility === "private") {
        maybeOverhear(fromId, toId, message);
      }

      /* --------------------------------------------
         UI PANEL DISPLAY
      -------------------------------------------- */

      if (isLog) {

        const el = document.createElement("div");
        el.className = "is-entry";

        const visText =
          visibility === "public"
            ? "PUBLIC (ALL SIMS SEE)"
            : "PRIVATE";

        el.innerHTML =
          `<span class="is-who">[${visText} ${fromId}→${toId}]:</span>
           <span class="is-what">"${message}"</span>
           <span style="color:#0a0a0a;font-size:.4rem"> · autonomous</span>`;

        isLog.appendChild(el);
        isLog.scrollTop = isLog.scrollHeight;

      }

      /* --------------------------------------------
         PREVENT DUPLICATE REPLIES
      -------------------------------------------- */

      const pairKey = `${toId}->${fromId}`;
      if (repliedPairs.has(pairKey)) continue;

      repliedPairs.add(pairKey);

      /* --------------------------------------------
         REPLY GENERATION
      -------------------------------------------- */

      G.threads[toId].push({
        role: "user",
        content: `${fromId} says to you: "${message}"`
      });

      const replyRaw = await callModel(
        toId,
        buildSimReplyPrompt(
          toSim,
          fromId,
          message,
          visibility,
          G.journals[toId]
        ),
        G.threads[toId],
        200
      );

      if (!replyRaw) continue;

      const replyObj = parseReply(replyRaw);
      if (!replyObj) continue;

      const { text: reply, intent } = replyObj;

      timelineEvent(`${toId} reply → ${fromId}`);

      G.threads[toId].push({
        role: "assistant",
        content: reply
      });

      /* --------------------------------------------
         RECORD REPLY
      -------------------------------------------- */

      G.interSimLog.push({
        from: toId,
        to: [fromId],
        text: reply,
        cycle: G.cycle,
        autonomous: true,
        visibility: "private",
        intent
      });

      /* --------------------------------------------
         SOCIAL EFFECT
      -------------------------------------------- */

      applyCommunicationEffect(toId, fromId, intent);

      addLog(
        `PRIVATE ${toId}→${fromId} [AUTO]`,
        `"${reply}"`,
        "sim"
      );

    }

    catch (e) {

      timelineEvent(`${fromId} communication error`);

      console.warn(
        `[AUTO INTER-SIM] ${fromId} error:`,
        e.message
      );

    }

  }

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
          visibility
        ),
        G.threads[toId],
        200
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