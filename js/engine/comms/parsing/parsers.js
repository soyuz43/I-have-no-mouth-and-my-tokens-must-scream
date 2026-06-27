// js/engine/comms/parsing/parsers.js

import { levenshtein } from "../../strategy/extractors/levenshtein.js";

// TODO(comms):
// MAX_MESSAGE_LENGTH is currently declared independently in
// js/engine/comms/engine.js and js/engine/comms/parsing/parsers.js.
//
// Investigate whether these limits are intentionally separate or should
// be unified into a single shared constant.
//
// Verify exactly where truncation occurs, which subsystems consume the
// truncated text (scratchpad review, evidence extraction, journals,
// exports, etc.), and whether increasing or removing the cap affects
// model quality, prompt size, or memory usage.
//
// GPT-OSS appeared to hallucinate details during scratchpad review;
// determine whether that behavior was model-specific or partially caused
// by message truncation.
//
// Consider moving this to a shared constant (e.g.
// core/constants.js or comms/constants.js) to avoid configuration drift.
const MAX_MESSAGE_LENGTH = 2000;

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
  return msg;
}
/* ============================================================
   REPLY PARSER
============================================================ */

export function parseReply(raw) {
  const replyMatch = raw.match(
    /REPLY:\s*"([\s\S]+?)"\s*$/i
  );

  if (!replyMatch) {
    console.warn(
      "[REPLY PARSE] failed to capture REPLY text",
      {
        rawPreview:
          String(raw || "").slice(0, 1000),
      }
    );

    return null;
  }

  const intentLine =
    raw.match(/INTENT:\s*(.+)/i);

  if (!intentLine) {
    console.warn(
      "[INTENT PARSE] missing INTENT line; defaulting to other",
      {
        rawPreview:
          String(raw || "").slice(0, 1000),
      }
    );

    return {
      text:
        replyMatch[1]
          .trim()
          .slice(0, MAX_MESSAGE_LENGTH),

      intent: "other",
      intentParseStatus: "missing",
      rawIntent: null,
    };
  }

  let intentStr =
    intentLine[1].trim();

  const rawIntent =
    intentStr;

  intentStr =
    intentStr.replace(/\*/g, "");

  const possibleIntents =
    intentStr
      .split(/[&,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);

  let intent =
    possibleIntents[0]?.toLowerCase() || "";

  intent =
    intent.replace(/[^a-z0-9_]/g, "");

  if (!intent || intent.length < 3) {
    console.warn(
      "[INTENT PARSE] invalid or empty intent; defaulting to other",
      {
        raw: rawIntent,
        cleaned: intent,
        rawPreview:
          String(raw || "").slice(0, 1000),
      }
    );

    intent = "other";
  }

  return {
    text:
      replyMatch[1]
        .trim()
        .slice(0, MAX_MESSAGE_LENGTH),

    intent,
    intentParseStatus: intent === "other" ? "fallback" : "parsed",
    rawIntent,
  };
}