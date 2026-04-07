import { levenshtein } from "./levenshtein.js";

const CANONICAL_KEYS = [
  "objective",
  "hypothesis",
  "why_now",
  "evidence"
];

const MAX_DISTANCE = 2;

function normalizeKey(key) {
  return key
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .trim();
}

function fuzzyMatchKey(rawKey) {
  const normalized = normalizeKey(rawKey);

  // exact match
  if (CANONICAL_KEYS.includes(normalized)) {
    return normalized;
  }

  let best = null;
  let bestDist = Infinity;

  for (const k of CANONICAL_KEYS) {
    const dist = levenshtein(normalized, k);

    if (dist < bestDist) {
      bestDist = dist;
      best = k;
    }
  }

  if (best && bestDist <= MAX_DISTANCE) {
    console.warn(`[KEY REPAIR] "${rawKey}" → "${best}" (dist=${bestDist})`);
    return best;
  }

  return null;
}

export function normalizeTargetKeys(target) {
  if (!target || typeof target !== "object") return target;

  const out = {};

  for (const [rawKey, value] of Object.entries(target)) {

    const mapped = fuzzyMatchKey(rawKey);

    if (mapped) {
      // don't overwrite valid existing field
      if (!(mapped in out)) {
        out[mapped] = value;
      }
      continue;
    }

    // preserve unknown keys (important for debugging)
    out[rawKey] = value;
  }

  return out;
}