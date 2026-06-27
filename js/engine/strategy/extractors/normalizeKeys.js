// js/engine/strategy/extractors/normalizeKeys.js

import { levenshtein } from "./levenshtein.js";

import {
  CANONICAL_TARGET_KEYS,
  KEY_ALIAS_ENTRIES,
} from "./keyAliases.js";

const MAX_DISTANCE = 2;

/**
 * Normalize mechanical formatting differences.
 *
 * Examples:
 *   "Why_ Now"    → "why_now"
 *   "why__now"    → "why_now"
 *   "why-now"     → "why_now"
 *   "tactic path" → "tactic_path"
 */
function normalizeKeyToken(key) {
  return String(key)
    .normalize("NFKC")
    .toLowerCase()
    .trim()
    .replace(/[‐-‒–—―-]+/g, "_")
    .replace(/[./\\\s]+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function buildAliasMap(entries) {
  const aliases = new Map();

  for (const entry of entries) {
    if (
      !Array.isArray(entry) ||
      entry.length !== 2
    ) {
      throw new TypeError(
        "Each key alias entry must be an [alias, canonicalKey] pair."
      );
    }

    const [rawAlias, rawCanonical] = entry;

    const alias =
      normalizeKeyToken(rawAlias);

    const canonical =
      normalizeKeyToken(rawCanonical);

    if (!CANONICAL_TARGET_KEYS.includes(canonical)) {
      throw new Error(
        `Invalid canonical strategy key: "${rawCanonical}"`
      );
    }

    const existing =
      aliases.get(alias);

    if (
      existing &&
      existing !== canonical
    ) {
      throw new Error(
        `Conflicting key alias "${rawAlias}": ` +
        `"${existing}" versus "${canonical}"`
      );
    }

    aliases.set(alias, canonical);
  }

  return aliases;
}

const KEY_ALIASES =
  buildAliasMap(KEY_ALIAS_ENTRIES);

function fuzzyMatchKey(rawKey) {
  const normalized =
    normalizeKeyToken(rawKey);

  const explicitAlias =
    KEY_ALIASES.get(normalized);

  if (explicitAlias) {
    if (normalized !== explicitAlias) {
      console.warn(
        `[KEY ALIAS] "${rawKey}" → "${explicitAlias}"`
      );
    }

    return explicitAlias;
  }

  let bestKey = null;
  let bestDistance = Infinity;

  for (const canonical of CANONICAL_TARGET_KEYS) {
    const distance =
      levenshtein(normalized, canonical);

    if (distance < bestDistance) {
      bestDistance = distance;
      bestKey = canonical;
    }
  }

  if (
    bestKey &&
    bestDistance <= MAX_DISTANCE
  ) {
    console.warn(
      `[KEY REPAIR] "${rawKey}" → "${bestKey}" ` +
      `(distance=${bestDistance})`
    );

    return bestKey;
  }

  return null;
}

export function normalizeTargetKeys(target) {
  if (
    !target ||
    typeof target !== "object" ||
    Array.isArray(target)
  ) {
    return target;
  }

  const normalizedTarget = {};

  for (const [rawKey, value] of Object.entries(target)) {
    const canonicalKey =
      fuzzyMatchKey(rawKey);

    if (!canonicalKey) {
      /*
       * Preserve unknown fields for diagnosis rather than silently
       * discarding model output.
       */
      normalizedTarget[rawKey] = value;
      continue;
    }

    /*
     * Prefer a correctly named field over an alias when both appear.
     */
    const rawKeyIsCanonical =
      normalizeKeyToken(rawKey) === canonicalKey;

    if (
      !(canonicalKey in normalizedTarget) ||
      rawKeyIsCanonical
    ) {
      normalizedTarget[canonicalKey] = value;
    }
  }

  return normalizedTarget;
}