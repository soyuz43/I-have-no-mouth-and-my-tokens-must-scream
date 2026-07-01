// js/engine/strategy/hypothesis/normalizeBelief.js
//
// Canonical belief recognition for natural-language and arrow-formatted
// hypotheses. Canonical keys and aliases come from the shared registry.

import {
  BELIEF_KEYS,
  BELIEF_ALIASES
} from "../../../core/beliefs.js";

import {
  levenshtein
} from "../extractors/levenshtein.js";

// Arrow-format belief patterns:
//
//   TED.others_trustworthy
//   TED's others_trustworthy belief
//
const ARROW_BELIEF_REGEX =
  /(?:\.([a-z_]+)\b|'s\s+([a-z_]+)\s+belief\b)/i;

/**
 * Escape text before embedding it in a regular expression.
 */
function escapeRegExp(value) {
  return String(value).replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
}

/**
 * Normalize belief text into a space-separated comparison form.
 *
 * Examples:
 *
 *   self_worth  -> self worth
 *   self_ worth -> self worth
 *   self _worth -> self worth
 *   self__worth -> self worth
 *   self-worth  -> self worth
 *
 * Unicode dash characters are represented with escape sequences so this
 * source file remains ASCII-safe.
 */
function normalizeNaturalBeliefText(text) {
  return String(text)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[_\u2010-\u2015-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Normalize malformed separators inside dot-notation or possessive belief
 * tokens.
 *
 * Examples:
 *
 *   TED.self_ worth          -> TED.self_worth
 *   TED.self _worth          -> TED.self_worth
 *   TED.self__worth          -> TED.self_worth
 *   TED.self-worth           -> TED.self_worth
 *   TED's self_ worth belief -> TED's self_worth belief
 */
function normalizeArrowBeliefText(text) {
  return String(text)
    .normalize("NFKC")
    .replace(
      /([A-Za-z0-9])\s*[_\u2010-\u2015-]+\s*(?=[A-Za-z0-9])/g,
      "$1_"
    );
}

/**
 * Convert a registered alias into the normalized natural-language form used
 * for matching.
 */
function normalizeAlias(alias) {
  return normalizeNaturalBeliefText(alias);
}

/**
 * Precompute normalized aliases once at module load.
 */
const NORMALIZED_ALIAS_ENTRIES =
  Object.entries(BELIEF_ALIASES).map(
    ([alias, canonical]) => ({
      alias,
      canonical,
      normalizedAlias: normalizeAlias(alias)
    })
  );

const MULTI_WORD_ALIAS_ENTRIES =
  NORMALIZED_ALIAS_ENTRIES.filter(
    ({ normalizedAlias }) =>
      normalizedAlias.includes(" ")
  );

const SINGLE_WORD_ALIAS_ENTRIES =
  NORMALIZED_ALIAS_ENTRIES.filter(
    ({ normalizedAlias }) =>
      !normalizedAlias.includes(" ")
  );

/**
 * Search fixed-size word windows for a conservative fuzzy match.
 *
 * Separator errors have already been repaired before this function runs.
 * This fallback is intended for genuine spelling drift such as:
 *
 *   self wroth
 *   reality relaible
 *   escape posible
 *   others trustworty
 */
function findFuzzyBelief(
  normalizedText,
  canonicalBelief
) {
  const wordMatches = [
    ...normalizedText.matchAll(/[a-z0-9]+/g)
  ];

  const expectedWords =
    canonicalBelief.split("_");

  const windowSize =
    expectedWords.length;

  const expected =
    expectedWords.join(" ");

  if (
    !expected ||
    wordMatches.length < windowSize
  ) {
    return null;
  }

  let bestMatch = null;

  for (
    let index = 0;
    index <= wordMatches.length - windowSize;
    index++
  ) {
    const candidateMatches =
      wordMatches.slice(
        index,
        index + windowSize
      );

    const candidate =
      candidateMatches
        .map((match) => match[0])
        .join(" ");

    const distance =
      levenshtein(
        candidate,
        expected
      );

    const relativeDistance =
      distance / expected.length;

    if (
      distance <= 2 &&
      relativeDistance < 0.25
    ) {
      if (
        !bestMatch ||
        distance < bestMatch.distance
      ) {
        bestMatch = {
          distance,
          matchIndex:
            candidateMatches[0].index ?? -1
        };
      }
    }
  }

  return bestMatch;
}

/**
 * Match a normalized natural-language alias.
 */
function matchAlias(
  normalizedText,
  aliasEntries
) {
  for (
    const {
      canonical,
      normalizedAlias
    } of aliasEntries
  ) {
    const regex =
      new RegExp(
        `\\b${escapeRegExp(normalizedAlias)}\\b`,
        "i"
      );

    const match =
      normalizedText.match(regex);

    if (match) {
      return {
        belief: canonical,
        matchIndex:
          match.index ?? -1,
        confidence: 0.9,
        method: "alias"
      };
    }
  }

  return null;
}

/**
 * Normalize a belief reference found in hypothesis text.
 *
 * Resolution order:
 *
 *   1. Exact arrow or dot notation
 *   2. Arrow aliases
 *   3. Exact canonical natural-language names
 *   4. Specific multi-word aliases
 *   5. Conservative fuzzy spelling recovery
 *   6. Broad single-word aliases
 *
 * Single-word aliases run last so words such as "escape", "reality", and
 * "worth" cannot hide a more specific misspelled canonical phrase.
 *
 * @param {string} text
 * @returns {{
 *   belief: string|null,
 *   matchIndex: number,
 *   confidence: number,
 *   method: string|null
 * }}
 */
export function normalizeBelief(text) {
  if (
    typeof text !== "string" ||
    !text.trim()
  ) {
    return {
      belief: null,
      matchIndex: -1,
      confidence: 0.1,
      method: null
    };
  }

  const arrowText =
    normalizeArrowBeliefText(text);

  const naturalText =
    normalizeNaturalBeliefText(text);

  // --------------------------------------------------------------------------
  // FORMAT 1: ARROW OR DOT NOTATION
  // --------------------------------------------------------------------------

  const arrowMatch =
    arrowText.match(
      ARROW_BELIEF_REGEX
    );

  if (arrowMatch) {
    const rawBelief =
      (arrowMatch[1] || arrowMatch[2])
        ?.toLowerCase();

    if (
      rawBelief &&
      BELIEF_KEYS.includes(rawBelief)
    ) {
      return {
        belief: rawBelief,
        matchIndex:
          arrowMatch.index ?? -1,
        confidence: 1.0,
        method: "arrow_exact"
      };
    }

    for (
      const {
        canonical,
        normalizedAlias
      } of NORMALIZED_ALIAS_ENTRIES
    ) {
      const arrowAlias =
        normalizedAlias.replace(
          /\s+/g,
          "_"
        );

      if (arrowAlias === rawBelief) {
        return {
          belief: canonical,
          matchIndex:
            arrowMatch.index ?? -1,
          confidence: 0.9,
          method: "arrow_alias"
        };
      }
    }
  }

  // --------------------------------------------------------------------------
  // FORMAT 2: EXACT CANONICAL NATURAL-LANGUAGE NAMES
  // --------------------------------------------------------------------------

  for (const belief of BELIEF_KEYS) {
    const naturalBelief =
      belief.replace(/_/g, " ");

    const regex =
      new RegExp(
        `\\b${escapeRegExp(naturalBelief)}\\b`,
        "i"
      );

    const match =
      naturalText.match(regex);

    if (match) {
      return {
        belief,
        matchIndex:
          match.index ?? -1,
        confidence: 1.0,
        method: "exact"
      };
    }
  }

  // --------------------------------------------------------------------------
  // FORMAT 3: REGISTERED MULTI-WORD ALIASES
  // --------------------------------------------------------------------------

  const multiWordAliasMatch =
    matchAlias(
      naturalText,
      MULTI_WORD_ALIAS_ENTRIES
    );

  if (multiWordAliasMatch) {
    return multiWordAliasMatch;
  }

  // --------------------------------------------------------------------------
  // FORMAT 4: CONSERVATIVE FUZZY SPELLING RECOVERY
  // --------------------------------------------------------------------------

  for (const belief of BELIEF_KEYS) {
    const fuzzyMatch =
      findFuzzyBelief(
        naturalText,
        belief
      );

    if (fuzzyMatch) {
      return {
        belief,
        matchIndex:
          fuzzyMatch.matchIndex,
        confidence: 0.6,
        method: "fuzzy"
      };
    }
  }

  // --------------------------------------------------------------------------
  // FORMAT 5: REGISTERED SINGLE-WORD ALIASES
  // --------------------------------------------------------------------------

  const singleWordAliasMatch =
    matchAlias(
      naturalText,
      SINGLE_WORD_ALIAS_ENTRIES
    );

  if (singleWordAliasMatch) {
    return singleWordAliasMatch;
  }

  return {
    belief: null,
    matchIndex: -1,
    confidence: 0.1,
    method: null
  };
}