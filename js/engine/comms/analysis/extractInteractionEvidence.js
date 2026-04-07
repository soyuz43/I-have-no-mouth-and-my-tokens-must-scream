// js/engine/comms/analysis/extractInteractionEvidence.js

import { callModel } from "../../../models/callModel.js";

/*
============================================================
EXTRACT PERTURBATIONS FROM EPISODES

IMPORTANT:
- sparse output
- no full belief vector
- uses current belief state as baseline
- robust against minor JSON corruption
============================================================
*/

export async function extractInteractionEvidence({
  simId,
  episodes,
  trajectory,
  currentBeliefs
}) {
  if (!episodes?.length) return [];

  const context = buildContext(simId, episodes, trajectory, currentBeliefs);

  const response = await callModel(
    "SYSTEM",
    buildPrompt(context),
    [{ role: "user", content: "Analyze interaction effects." }],
    600
  );

  /* ------------------------------------------------------------
     DEBUG: RAW MODEL OUTPUT
  ------------------------------------------------------------ */

  console.groupCollapsed(`[COMMS RAW] ${simId}`);
  console.log("type:", typeof response);

  if (typeof response === "string") {
    console.log("full:", response);
    console.log("preview:", response.slice(0, 500));
  } else {
    console.log("non-string response:", response);
  }

  console.groupEnd();

  return safeParse(response, simId);
}

/*
============================================================
CONTEXT BUILDER
============================================================
*/

function buildContext(simId, episodes, trajectory, currentBeliefs) {
  const trimmed = episodes.slice(-6); // increased window

  return {
    simId,
    episodes: trimmed.map(ep =>
      ep.map(m => ({
        from: m.from,
        to: m.to?.[0],
        text: m.text,
        intent: m.intent || null,
        overheard: m.rumor || false
      }))
    ),
    trajectory,
    currentBeliefs
  };
}

/*
============================================================
PROMPT
============================================================
*/

function buildPrompt(ctx) {
  return `
You are a forensic psychological measurement system.

Your job:
Detect ONLY interaction-induced perturbations in belief state.

Target: ${ctx.simId}

------------------------------------------------------------
CURRENT BELIEF STATE (BASELINE)
------------------------------------------------------------
${JSON.stringify(ctx.currentBeliefs)}

------------------------------------------------------------
RECENT TRAJECTORY (CONTEXT)
------------------------------------------------------------
${JSON.stringify(ctx.trajectory)}

------------------------------------------------------------
INTERACTION EPISODES
------------------------------------------------------------
${JSON.stringify(ctx.episodes)}

------------------------------------------------------------
INSTRUCTIONS
------------------------------------------------------------

You are NOT generating beliefs.

You are detecting CHANGES relative to the current belief state.

Rules:

- Report beliefs with PLAUSIBLE evidence of change
- You MUST extract at least one perturbation if interactions contain tension, conflict, or pressure
- Only return empty if there are truly NO meaningful interactions

- Use intents when available

Prioritize:
- repeated claims across interactions
- contradiction between agents
- externally imposed labels ("you are X")
- perception conflicts ("you saw X / I did not")
- accusations or hostility
- destabilization attempts

Deprioritize:
- isolated poetic language
- metaphor without reinforcement

------------------------------------------------------------
INTERPRETATION RULES
------------------------------------------------------------

Interpersonal signals ARE valid evidence.

Map interaction patterns to beliefs:

- attacks on perception → reality_reliable ↓
- accusations / hostility → others_trustworthy ↓
- destabilizing identity → self_worth ↓
- hopeless framing → escape_possible ↓
- pressure / inevitability → resistance_possible ↓

If multiple weak signals exist:
→ infer the MOST LIKELY dominant direction

Do NOT require explicit belief statements.

---

Each perturbation MUST reference a SINGLE belief key.

You are NOT allowed to combine beliefs or say "all beliefs".

If multiple beliefs are affected, list them as separate entries.

------------------------------------------------------------
OUTPUT FORMAT (JSON ONLY)
------------------------------------------------------------

{
  "perturbations": [
    {
      "belief": "escape_possible | others_trustworthy | self_worth | reality_reliable | guilt_deserved | resistance_possible | am_has_limits",
      "direction": "increase | decrease",
      "strength": 1-5,
      "confidence": 0.0-1.0
    }
  ]
}
`;
}

/*
============================================================
SAFE PARSE (ROBUST)
============================================================
*/

function safeParse(raw, simId) {
  if (typeof raw !== "string") {
    console.warn(`[COMMS PARSE] ${simId} non-string input`, raw);
    return [];
  }

  let cleaned = raw.trim();

  // -----------------------------
  // PASS 1: Direct parse
  // -----------------------------
  try {
    return validate(JSON.parse(cleaned), simId);
  } catch {}

  // -----------------------------
  // PASS 2: Extract JSON block
  // -----------------------------
  const match = cleaned.match(/\{[\s\S]*\}/);

  if (match) {
    try {
      return validate(JSON.parse(match[0]), simId);
    } catch {}
  }

  // -----------------------------
  // PASS 3: Last-resort repair
  // -----------------------------
  try {
    const repaired = cleaned
      .replace(/^[^{]*/, "")     // strip leading junk
      .replace(/[^}]*$/, "");    // strip trailing junk

    return validate(JSON.parse(repaired), simId);
  } catch {}

  console.warn(`[COMMS PARSE] ${simId} failed all parse attempts`);
  console.warn("raw:", raw);

  return [];
}

function validate(json, simId) {
  if (!Array.isArray(json?.perturbations)) {
    console.warn(`[COMMS PARSE] ${simId} no perturbations array`, json);
    return [];
  }

  const filtered = json.perturbations.filter(p =>
    p &&
    typeof p.belief === "string" &&
    (p.direction === "increase" || p.direction === "decrease") &&
    typeof p.strength === "number"
  );

  console.debug(`[COMMS PARSE] ${simId} parsed`, filtered);

  return filtered;
}
