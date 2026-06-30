// Example: js/engine/strategy/extractors/normalizeTacticPath.js

import { levenshtein } from "./levenshtein.js";

/**
 * Mechanical normalization only.
 *
 * This repairs formatting differences without guessing which tactic
 * the model intended.
 */
function normalizeTacticPathToken(value) {
  if (typeof value !== "string") {
    return "";
  }

  let normalized = value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\\/g, "/")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\/+/g, "/")
    .replace(/[‐-‒–—―_ ]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^\/+|\/+$/g, "");

  /*
   * Recover a missing embedded namespace only when the value is
   * otherwise shaped like a single tactic slug.
   */
  if (
    normalized &&
    !normalized.includes("/") &&
    !normalized.startsWith("__embedded__")
  ) {
    normalized = `__embedded__/${normalized}`;
  }

  /*
   * Normalize likely variants of the embedded namespace.
   */
  normalized = normalized.replace(
    /^_*-?embedded-?_*\/?/,
    "__embedded__/"
  );

  return normalized;
}

/**
 * Explicit aliases cover known naming substitutions that are not
 * simple spelling errors.
 *
 * This should remain small. Canonical tactic paths should ideally be
 * taken directly from the embedded tactic registry.
 */
const TACTIC_PATH_ALIASES = new Map([
  [
    "__embedded__/false-hope",
    "__embedded__/false-hope-architecture",
  ],
  [
    "__embedded__/love-bomb-withdrawal-architecture",
    "__embedded__/love-bomb-withdrawal",
  ],
]);

function getMaximumDistance(candidateLength) {
  /*
   * Permit:
   * - up to 2 edits for short identifiers
   * - roughly 10% of the slug length for longer identifiers
   *
   * Cap the result so fuzzy recovery never becomes semantic guessing.
   */
  return Math.min(
    4,
    Math.max(
      1,
      Math.floor(candidateLength * 0.1)
    )
  );
}

function findExactAuthorizedOccurrences(
  rawPath,
  validTacticPaths
) {
  const text =
    String(rawPath ?? "");

  if (!text) {
    return [];
  }

  return validTacticPaths.filter(
    (path) =>
      typeof path === "string" &&
      path.trim() &&
      text.includes(path)
  );
}

/**
 * Recover a tactic path against the authoritative list of embedded
 * tactic paths.
 *
 * Returns structured metadata so callers can log exactly what
 * happened instead of silently changing the model output.
 */
export function resolveTacticPath(
  rawPath,
  validTacticPaths,
  { DEBUG_EXTRACT = false } = {}
) {
  if (
    !Array.isArray(validTacticPaths) ||
    validTacticPaths.length === 0
  ) {
    return {
      ok: false,
      value: null,
      original: rawPath,
      recovery: "registry_unavailable",
      confidence: 0,
    };
  }

  const canonicalByNormalized = new Map();

  for (const path of validTacticPaths) {
    if (typeof path !== "string" || !path.trim()) {
      continue;
    }

    canonicalByNormalized.set(
      normalizeTacticPathToken(path),
      path
    );
  }

  const normalized =
    normalizeTacticPathToken(rawPath);

  if (!normalized) {
    return {
      ok: false,
      value: null,
      original: rawPath,
      recovery: "invalid_input",
      confidence: 0,
    };
  }

  /* ============================================================
     1. EXACT AUTHORIZED PATH OCCURRENCE
  ============================================================ */

  const exactOccurrences =
    findExactAuthorizedOccurrences(
      rawPath,
      validTacticPaths
    );

  if (exactOccurrences.length === 1) {
    return {
      ok: true,
      value: exactOccurrences[0],
      original: rawPath,
      recovery:
        validTacticPaths.includes(rawPath)
          ? "exact"
          : "embedded_exact",
      confidence: 1,
    };
  }

  if (exactOccurrences.length > 1) {
    return {
      ok: false,
      value: null,
      original: rawPath,
      recovery: "ambiguous_embedded_exact",
      confidence: 0,
      candidates: exactOccurrences,
    };
  }

  /* ============================================================
     2. EXACT CANONICAL MATCH
  ============================================================ */

  if (validTacticPaths.includes(rawPath)) {
    return {
      ok: true,
      value: rawPath,
      original: rawPath,
      recovery: "exact",
      confidence: 1,
    };
  }

  /* ============================================================
     3. MECHANICAL NORMALIZATION MATCH
  ============================================================ */

  const mechanicallyMatched =
    canonicalByNormalized.get(normalized);

  if (mechanicallyMatched) {
    if (DEBUG_EXTRACT) {
      console.warn(
        `[TACTIC PATH NORMALIZED] "${rawPath}" → ` +
        `"${mechanicallyMatched}"`
      );
    }

    return {
      ok: true,
      value: mechanicallyMatched,
      original: rawPath,
      recovery: "mechanical_normalization",
      confidence: 0.98,
    };
  }

  /* ============================================================
     4. EXPLICIT ALIAS MATCH
  ============================================================ */

  const aliasTarget =
    TACTIC_PATH_ALIASES.get(normalized);

  if (
    aliasTarget &&
    validTacticPaths.includes(aliasTarget)
  ) {
    if (DEBUG_EXTRACT) {
      console.warn(
        `[TACTIC PATH ALIAS] "${rawPath}" → "${aliasTarget}"`
      );
    }

    return {
      ok: true,
      value: aliasTarget,
      original: rawPath,
      recovery: "explicit_alias",
      confidence: 0.9,
    };
  }

  /* ============================================================
     5. LEVENSHTEIN TYPO RECOVERY
  ============================================================ */

  const scored = [];

  for (const [
    normalizedCanonical,
    canonicalPath,
  ] of canonicalByNormalized.entries()) {
    const distance =
      levenshtein(
        normalized,
        normalizedCanonical
      );

    const longestLength =
      Math.max(
        normalized.length,
        normalizedCanonical.length
      );

    const similarity =
      longestLength === 0
        ? 1
        : 1 - distance / longestLength;

    scored.push({
      canonicalPath,
      normalizedCanonical,
      distance,
      similarity,
    });
  }

  scored.sort(
    (a, b) =>
      a.distance - b.distance ||
      b.similarity - a.similarity
  );

  const best = scored[0];
  const secondBest = scored[1] ?? null;

  if (!best) {
    return {
      ok: false,
      value: null,
      original: rawPath,
      recovery: "no_candidates",
      confidence: 0,
    };
  }

  const maximumDistance =
    getMaximumDistance(
      Math.max(
        normalized.length,
        best.normalizedCanonical.length
      )
    );

  const runnerUpMargin =
    secondBest
      ? secondBest.distance - best.distance
      : Infinity;

  /*
   * Accept only a close, uniquely superior result.
   *
   * Examples accepted:
   *   false-hope-architecure
   *   love-bomb-withdrawl
   *
   * Examples rejected:
   *   hope
   *   attachment-tactic
   *   a value equally close to two canonical paths
   */
  const acceptable =
    best.distance <= maximumDistance &&
    best.similarity >= 0.88 &&
    runnerUpMargin >= 2;

  if (!acceptable) {
    if (DEBUG_EXTRACT) {
      console.warn(
        `[TACTIC PATH UNRESOLVED] "${rawPath}" ` +
        `closest="${best.canonicalPath}" ` +
        `distance=${best.distance} ` +
        `similarity=${best.similarity.toFixed(3)} ` +
        `runnerUpMargin=${runnerUpMargin}`
      );
    }

    return {
      ok: false,
      value: null,
      original: rawPath,
      recovery: "ambiguous_or_distant",
      confidence: best.similarity,
      candidate: best.canonicalPath,
      distance: best.distance,
    };
  }

  if (DEBUG_EXTRACT) {
    console.warn(
      `[TACTIC PATH FUZZY REPAIR] "${rawPath}" → ` +
      `"${best.canonicalPath}" ` +
      `(distance=${best.distance}, ` +
      `similarity=${best.similarity.toFixed(3)})`
    );
  }

  return {
    ok: true,
    value: best.canonicalPath,
    original: rawPath,
    recovery: "levenshtein",
    confidence: best.similarity,
    distance: best.distance,
  };
}
