// js/engine/comms/analysis/extractInteractionEvidence.js

import { callModel } from "../../../models/callModel.js";

/*
============================================================
EXTRACT PERTURBATIONS FROM EPISODES

IMPORTANT:
- sparse output
- no full belief vector
- uses current belief state as baseline (NEW)
============================================================
*/

export async function extractInteractionEvidence({
  simId,
  episodes,
  trajectory,
  currentBeliefs   
}) {
  if (!episodes?.length) return null;

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
  const trimmed = episodes.slice(-2); // keep it tight

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
PROMPT (UPDATED WITH CURRENT STATE AWARENESS)
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

- Only report beliefs with CLEAR evidence of change
- Maximum 3 beliefs
- If no strong evidence exists, return an empty array
- Use intents when available
- Prioritize:
  - repeated claims across interactions
  - contradiction between agents
  - externally imposed labels ("you are X")
  - perception conflicts ("you saw X / I did not")
- Deprioritize:
  - isolated poetic language
  - single weak signals
  - metaphor without reinforcement

------------------------------------------------------------
HOW TO INTERPRET STATE
------------------------------------------------------------

- Current beliefs are your baseline
- You are estimating perturbations FROM that baseline
- Do NOT restate or recompute beliefs
- Do NOT fill missing beliefs
- Only output changes supported by interaction evidence

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
SAFE PARSE
============================================================
*/

function safeParse(raw, simId) {

  /* ------------------------------------------------------------
     DEBUG: PARSE ENTRY
  ------------------------------------------------------------ */

  if (typeof raw !== "string") {
    console.warn(`[COMMS PARSE] ${simId} non-string input`, raw);
    return [];
  }

  try {
    const json = JSON.parse(raw);

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

  } catch (err) {

    console.warn(`[COMMS PARSE] ${simId} JSON.parse failed`);
    console.warn("raw:", raw);

    return [];
  }
}