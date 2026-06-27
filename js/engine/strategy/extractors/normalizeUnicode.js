// js/engine/strategy/extractors/normalizeUnicode.js

const SMART_DOUBLE_QUOTES = new Set([
  "\u201C", // left double quotation mark
  "\u201D", // right double quotation mark
  "\u201E", // double low-9 quotation mark
  "\u201F", // double high-reversed-9 quotation mark
  "\u2033", // double prime
  "\u2036", // reversed double prime
  "\uFF02", // fullwidth quotation mark
]);

function isDoubleQuoteLike(ch) {
  return ch === '"' || SMART_DOUBLE_QUOTES.has(ch);
}

function normalizeUnicodePropertyKeys(input) {
  /*
   * Repair quote-like delimiters around any property key when the
   * token occurs in an unmistakable JSON-property position:
   *
   *   { “key”: value
   *   , “key”: value
   *   { "key”: value
   *   , “key": value
   *
   * This is lexical recovery, not schema validation. Unknown keys
   * remain unknown and can be handled after JSON.parse().
   */
  return input.replace(
    /(^\s*|[,{]\s*)["\u201C\u201D\u201E\u201F\u2033\u2036\uFF02]([^"“”„‟″‶\r\n]+?)["\u201C\u201D\u201E\u201F\u2033\u2036\uFF02]\s*[:\uFF1A]/gmu,
    (match, prefix, rawKey) => {
      const key = rawKey.trim();

      /*
       * Stay conservative. Property names must contain at least one
       * ordinary key character and must not contain JSON structure.
       */
      if (
        !/[A-Za-z0-9_]/.test(key) ||
        /[{}\[\],:]/.test(key)
      ) {
        return match;
      }

      return `${prefix}${JSON.stringify(key)}:`;
    }
  );
}

function normalizeUnicodeStringValues(input) {
  let out = "";
  let i = 0;
  let inStraightString = false;
  let escape = false;

  while (i < input.length) {
    const ch = input[i];

    if (inStraightString) {
      out += ch;

      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inStraightString = false;
      }

      i++;
      continue;
    }

    if (ch === '"') {
      inStraightString = true;
      out += ch;
      i++;
      continue;
    }

    /*
     * A smart quote begins a JSON value only when the previous
     * significant character is a colon.
     */
    if (SMART_DOUBLE_QUOTES.has(ch)) {
      let previousIndex = out.length - 1;

      while (
        previousIndex >= 0 &&
        /\s/.test(out[previousIndex])
      ) {
        previousIndex--;
      }

      if (out[previousIndex] === ":") {
        const valueStart = i + 1;
        let closingIndex = -1;

        for (let j = valueStart; j < input.length; j++) {
          const candidateQuote = input[j];

          if (!isDoubleQuoteLike(candidateQuote)) {
            continue;
          }

          let nextIndex = j + 1;

          while (
            nextIndex < input.length &&
            /\s/.test(input[nextIndex])
          ) {
            nextIndex++;
          }

          const nextSignificant = input[nextIndex];

          const followedByProperty =
            nextIndex < input.length &&
            /^"[^"\r\n]+"\s*:/.test(
              input.slice(nextIndex)
            );

          /*
           * Treat the quote as the closing delimiter when it is
           * followed by either:
           * - a legal JSON value boundary; or
           * - another property key whose separating comma is missing.
           *
           * Property-key delimiters were normalized before this pass,
           * so the missing-comma form can be recognized conservatively.
           */
          if (
            nextIndex >= input.length ||
            nextSignificant === "," ||
            nextSignificant === "}" ||
            nextSignificant === "]" ||
            followedByProperty
          ) {
            closingIndex = j;
            break;
          }
        }

        if (closingIndex !== -1) {
          const value =
            input.slice(valueStart, closingIndex);

          out += JSON.stringify(value);
          i = closingIndex + 1;
          continue;
        }
      }
    }

    out += ch;
    i++;
  }

  return out;
}

/**
 * Repair Unicode characters that interfere with JSON syntax.
 *
 * The function performs lexical normalization only:
 * - invisible structural characters
 * - nonstandard structural spaces
 * - smart-quoted property delimiters
 * - smart-quoted string-value delimiters
 * - fullwidth structural punctuation
 *
 * Field-name normalization remains the responsibility of
 * normalizeTargetKeys() after JSON.parse().
 */
export function normalizeUnicode(input) {
  if (typeof input !== "string") {
    return input;
  }

  let normalized = input
    .replace(/^\uFEFF/, "")
    .replace(/[\u200B\u200C\u200D\u2060]/g, "")
    .replace(/[\u00A0\u202F]/g, " ")
    .replace(/\uFF0C(?=\s*(?:[\r\n]|$))/g, ",");

  normalized =
    normalizeUnicodePropertyKeys(normalized);

  normalized =
    normalizeUnicodeStringValues(normalized);

  return normalized;
}