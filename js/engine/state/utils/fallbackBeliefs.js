// js/engine/state/utils/fallbackBeliefs.js

export function fallbackExtractBeliefDeltas(text) {
  if (!text) return null;

  let cleaned = text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/\/\/.*$/gm, "");

  const match = cleaned.match(/"belief_deltas"\s*:\s*\{([\s\S]*?)\}/);
  if (!match) return null;

  const block = match[1];

  const result = {};
  const regex = /"([a-zA-Z_]+)"\s*:\s*(-?\d+)/g;

  let m;
  while ((m = regex.exec(block)) !== null) {
    const key = m[1];
    const val = Number(m[2]);

    if (Number.isFinite(val)) {
      result[key] = val;
    }
  }

  return Object.keys(result).length ? result : null;
}