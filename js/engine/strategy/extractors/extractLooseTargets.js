// js/engine/strategy/extractors/extractLooseTargets.js

export function extractLooseTargets(input, { DEBUG_EXTRACT = false } = {}) {

  if (typeof input !== "string") return null;

  const targets = [];

  const targetBlockRegex =
    /(?:^|\n)\s*(?:#{1,4}\s*)?(?:\*\*)?\s*Target\s*:\s*(TED|ELLEN|NIMDOK|GORRISTER|BENNY)\s*(?:\*\*)?\s*\n([\s\S]*?)(?=\n\s*(?:#{1,4}\s*)?(?:\*\*)?\s*Target\s*:\s*(?:TED|ELLEN|NIMDOK|GORRISTER|BENNY)\s*(?:\*\*)?\s*\n|$)/gi;

  for (const match of input.matchAll(targetBlockRegex)) {
    const id = match[1].toUpperCase();
    const block = String(match[2] || "").trim();

    if (!block) continue;

    targets.push({
      id,
      objective: block,
      hypothesis: block,
      evidence: block,
      why_now: block,
      _inferenceConfidence: 0.25,
      _loose: true,
      _recovery: "target_block_boundary"
    });
  }

  if (targets.length === 0) return null;

  if (DEBUG_EXTRACT) {
    console.warn("[EXTRACT][LOOSE] recovered targets:", targets.map(t => t.id));
  }

  return { targets };
}