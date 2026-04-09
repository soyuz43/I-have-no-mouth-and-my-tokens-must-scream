// js/engine/comms/analysis/extractInteractionEvidence.js

import { callModel } from "../../../models/callModel.js";

/*
============================================================
EXTRACT PERTURBATIONS FROM EPISODES

IMPORTANT:
- sparse output
- no full belief vector
- uses marginal deltas (currentBeliefs - baselineBeliefs) to isolate
  contagion-attributed belief shifts from comms episodes
- robust against minor JSON corruption
============================================================
*/

export async function extractInteractionEvidence({
  simId,
  episodes,
  trajectory,
  baselineBeliefs,
  currentBeliefs
}) {

  if (!Array.isArray(episodes) || episodes.length === 0) return [];

  /* ------------------------------------------------------------
     COMPUTE MARGINAL DELTAS (WITH SIGNAL FILTER)
  ------------------------------------------------------------ */

  const marginalDeltas = {};
  const significantDeltas = {};

  if (baselineBeliefs && currentBeliefs) {
    const allKeys = new Set([
      ...Object.keys(baselineBeliefs || {}),
      ...Object.keys(currentBeliefs || {})
    ]);

    for (const key of allKeys) {
      const before = baselineBeliefs?.[key] ?? 0;
      const after = currentBeliefs?.[key] ?? 0;
      const delta = after - before;

      marginalDeltas[key] = delta;

      // Noise filter
      if (Math.abs(delta) >= 0.02) {
        significantDeltas[key] = delta;
      }
    }
  }

  /* ------------------------------------------------------------
     BUILD CONTEXT (REUSE EXISTING PROMPT PIPELINE)
  ------------------------------------------------------------ */

  const context = buildContext(
    simId,
    episodes,
    trajectory,
    currentBeliefs,
    significantDeltas  
  );

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

  /* ------------------------------------------------------------
     SAFE PARSE + NORMALIZATION
  ------------------------------------------------------------ */

  const parsed = safeParse(response, simId);

  if (!Array.isArray(parsed)) return [];

  // Normalize output to prevent downstream instability
  return parsed.map(p => ({
    belief: p.belief,
    direction: p.direction === "increase" ? "increase" : "decrease",
    strength: Math.min(5, Math.max(1, Number(p.strength) || 1)),
    confidence: Math.min(1, Math.max(0, Number(p.confidence) || 0.5)),
    attribution: p.attribution || "contagion"
  }));
}

/*
============================================================
CONTEXT BUILDER
============================================================
*/

function buildContext(simId, episodes, trajectory, currentBeliefs, marginalDeltas) {
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
    currentBeliefs,
    marginalDeltas  // NEW: for attribution-aware analysis
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
CURRENT BELIEF STATE (POST-CONTAGION)
------------------------------------------------------------
${JSON.stringify(ctx.currentBeliefs)}

------------------------------------------------------------
MARGINAL DELTAS (CONTAGION-ATTRIBUTED CHANGE ONLY)
------------------------------------------------------------
${JSON.stringify(ctx.marginalDeltas || {})}

NOTE: Use marginalDeltas to identify which belief shifts are 
directly attributable to the interaction episodes below. 
Ignore shifts that likely stem from prior AM input (psychology phase).

If a belief has a non-zero marginalDelta AND appears in the 
interaction episodes with relevant tension/pressure/contradiction,
it is a strong candidate for a comms-attributed perturbation.

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

You are detecting CHANGES relative to the baseline belief state.

Rules:

- Report beliefs with PLAUSIBLE evidence of change
- You MUST extract at least one perturbation if interactions contain tension, conflict, or pressure
- Only return empty if there are truly NO meaningful interactions
- Use intents when available
- PRIORITIZE beliefs with non-zero marginalDeltas as comms-attributed

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
      "confidence": 0.0-1.0,
      "attribution": "contagion"
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
    typeof p.strength === "number" &&
    (!p.attribution || typeof p.attribution === "string")  // attribution is optional but validated if present
  );

  console.debug(`[COMMS PARSE] ${simId} parsed`, filtered);

  return filtered;
}