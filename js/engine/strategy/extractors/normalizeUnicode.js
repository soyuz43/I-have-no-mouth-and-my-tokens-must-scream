// js/engine/strategy/extractors/normalizeUnicode.js

const SMART_DOUBLE_QUOTES =
  "\u201C\u201D\u201E\u201F\u2033\u2036\uFF02";

const QUOTE_CLASS =
  `["${SMART_DOUBLE_QUOTES}]`;

const SCHEMA_KEY_SOURCE =
  "targets|id|evidence|why_now|objective|hypothesis";

/**
 * Repair Unicode characters that interfere with the known
 * strategy JSON structure.
 *
 * This is intentionally schema-aware. It repairs Unicode
 * quotation marks used as structural delimiters without
 * globally replacing typographic quotes inside prose.
 */
export function normalizeUnicode(input) {
  if (typeof input !== "string") {
    return input;
  }

  let normalized = input
    // Remove a leading byte-order mark.
    .replace(/^\uFEFF/, "")

    // Remove invisible format characters.
    .replace(
      /[\u200B\u200C\u200D\u2060]/g,
      ""
    )

    // JSON does not recognize these as ordinary structural spaces.
    .replace(
      /[\u00A0\u202F]/g,
      " "
    );

  /*
   * Repair known property-name delimiters.
   *
   * Handles all of these:
   *
   *   “why_now”:
   *   "why_now”:
   *   “why_now":
   *   "why_now":
   *
   * Also repairs a fullwidth colon after the key.
   */
  normalized = normalized.replace(
    new RegExp(
      `(^\\s*|[,{]\\s*)` +
      `${QUOTE_CLASS}` +
      `(${SCHEMA_KEY_SOURCE})` +
      `${QUOTE_CLASS}` +
      `\\s*[:\\uFF1A]`,
      "gmi"
    ),
    '$1"$2":'
  );

  /*
   * Repair known string values occupying one line.
   *
   * Handles:
   *
   *   "why_now": “value”
   *   "why_now": “value"
   *   "why_now": "value”
   *
   * Valid straight-quoted values are left untouched.
   */
  normalized = normalized.replace(
    new RegExp(
      `("(?:${SCHEMA_KEY_SOURCE})"` +
      `\\s*:\\s*)` +
      `(${QUOTE_CLASS})` +
      `([^\\r\\n]*?)` +
      `(${QUOTE_CLASS})` +
      `(\\s*,?\\s*$)`,
      "gmi"
    ),
    (
      match,
      prefix,
      openingQuote,
      value,
      closingQuote,
      suffix
    ) => {
      const alreadyValid =
        openingQuote === '"' &&
        closingQuote === '"';

      if (alreadyValid) {
        return match;
      }

      return (
        prefix +
        JSON.stringify(value) +
        suffix
      );
    }
  );

  /*
   * Repair a fullwidth comma only when it appears as structural
   * punctuation at the end of a line.
   */
  normalized = normalized.replace(
    /\uFF0C(?=\s*$)/gm,
    ","
  );

  return normalized;
}