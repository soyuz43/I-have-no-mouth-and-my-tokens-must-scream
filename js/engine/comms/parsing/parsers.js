// js/engine/comms/parsing/parsers.js

import { levenshtein } from "../../strategy/extractors/levenshtein.js";

const MAX_MESSAGE_LENGTH = 800;

/* ============================================================
   VISIBILITY PARSER
============================================================ */

export function parseVisibility(raw) {
  const m = raw.match(/VISIBILITY:\s*(PRIVATE|PUBLIC)/i);
  return m ? m[1].toLowerCase() : "private";
}

/* ============================================================
   SIMILARITY (LEVENSHTEIN-BASED)
============================================================ */

export function similarity(a, b) {
  const dist = levenshtein(a, b);
  return 1 - dist / Math.max(a.length, b.length);
}

/* ============================================================
   TARGET PARSER
============================================================ */

export function parseTarget(raw) {
  const allowed = ["TED", "ELLEN", "NIMDOK", "GORRISTER", "BENNY"];

  // 1. Exact match
  const exactMatch = raw.match(
    /REACH_OUT:\s*(TED|ELLEN|NIMDOK|GORRISTER|BENNY|NONE)/i
  );

  if (exactMatch) {
    const result = exactMatch[1].toUpperCase().trim();
    console.debug(
      `[MESSAGE PARSER] parseTarget exact: "${raw.slice(0, 1000)}" → ${result}`
    );
    return result;
  }

  // 2. Substring fallback
  const lowerRaw = raw.toLowerCase();
  for (const name of allowed) {
    if (lowerRaw.includes(name.toLowerCase())) {
      console.debug(
        `[MESSAGE PARSER] parseTarget substring: "${raw.slice(0, 1000)}" → ${name}`
      );
      return name;
    }
  }

  // 3. Fuzzy match
  const candidateMatch = raw.match(/REACH_OUT:\s*([A-Za-z]+)/i);

  if (candidateMatch) {
    const candidate = candidateMatch[1];

    let bestDist = Infinity;
    let bestName = null;

    for (const name of allowed) {
      const dist = levenshtein(
        candidate.toLowerCase(),
        name.toLowerCase()
      );

      if (dist < bestDist) {
        bestDist = dist;
        bestName = name;
      }
    }

    if (bestDist <= 2) {
      console.debug(
        `[MESSAGE PARSER] parseTarget fuzzy: "${raw.slice(0, 1000)}" → ${bestName} (dist=${bestDist})`
      );
      return bestName;
    }
  }

  console.debug(
    `[MESSAGE PARSER] parseTarget: "${raw.slice(0, 1000)}" → null`
  );

  return null;
}

/*=============================================================
    HELPERS
==============================================================*/

function cleanMessageText(text) {
  if (!text) return text;

  // Remove trailing visibility markers (case‑insensitive)
  let cleaned = text.replace(/\s*\((PRIVATE|PUBLIC)\)\s*$/i, '');
  cleaned = cleaned.replace(/\s*VISIBILITY:\s*(PRIVATE|PUBLIC)\s*$/i, '');
  
  // Remove any leftover trailing quotes (if unbalanced)
  cleaned = cleaned.replace(/"\s*$/, '');
  
  return cleaned.trim();
}

/* ============================================================
   MESSAGE PARSER
============================================================ */

export function parseMessage(raw) {
  const m = raw.match(/MESSAGE:\s*"?([\s\S]+?)"?$/i);
  if (!m) return null;
  
  let msg = m[1].trim();
  msg = cleanMessageText(msg);
  return msg.slice(0, MAX_MESSAGE_LENGTH);
}
/* ============================================================
   REPLY PARSER
============================================================ */

export function parseReply(raw) {
  const replyMatch = raw.match(
    /REPLY:\s*"([\s\S]+?)"\s*$/i
  );

  if (!replyMatch) return null;

  const intentLine = raw.match(/INTENT:\s*(.+)/i);

  if (!intentLine) {
    return {
      text: replyMatch[1]
        .trim()
        .slice(0, MAX_MESSAGE_LENGTH),
      intent: "other",
    };
  }

  let intentStr = intentLine[1].trim();

  // Remove markdown artifacts
  intentStr = intentStr.replace(/\*/g, "");

  const possibleIntents = intentStr
    .split(/[&,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  let intent =
    possibleIntents[0]?.toLowerCase() || "";

  intent = intent.replace(/[^a-z0-9_]/g, "");

  if (!intent || intent.length < 3) {
    console.warn("[INTENT PARSE] invalid or empty intent", {
      raw: intentLine[1],
      cleaned: intent,
    });

    intent = "other";
  }

  return {
    text: replyMatch[1]
      .trim()
      .slice(0, MAX_MESSAGE_LENGTH),
    intent,
  };
}