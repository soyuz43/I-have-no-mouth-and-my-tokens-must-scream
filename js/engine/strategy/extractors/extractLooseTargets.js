// js/engine/strategy/extractors/extractLooseTargets.js

export function extractLooseTargets(input, { DEBUG_EXTRACT = false } = {}) {

  if (typeof input !== "string") return null;

  const SIM_IDS = ["TED","ELLEN","NIMDOK","GORRISTER","BENNY"];

  const targets = [];

  for (const id of SIM_IDS) {

    const regex = new RegExp(`\\b${id}\\b`, "gi");
    const matches = input.match(regex);

    if (!matches) continue;

    // crude field extraction (low confidence)
    const snippetIdx = input.indexOf(matches[0]);
    const snippet = input.slice(Math.max(0, snippetIdx - 200), snippetIdx + 200);

    targets.push({
      id,
      objective: snippet,
      hypothesis: snippet,
      evidence: snippet,
      why_now: snippet,
      _inferenceConfidence: 0.2,
      _loose: true
    });
  }

  if (targets.length === 0) return null;

  if (DEBUG_EXTRACT) {
    console.warn("[EXTRACT][LOOSE] recovered targets:", targets.map(t => t.id));
  }

  return { targets };
}