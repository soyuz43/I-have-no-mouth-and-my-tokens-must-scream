// js/engine/strategy/extractors/utils.js

export function stripJsonComments(str) {
  return str.replace(/\/\/.*$/gm, "");
}

/**
 * Only insert comma when:
 * - previous line ends with a value
 * - AND next line starts with a key
 * - AND there is NO comma already
 */
export function fixMissingCommas(str) {
  return str.replace(
    /(":\s*"[^"]*")(\s*\n\s*)(")/g,
    (match, val, whitespace, nextQuote) => {

      // already has comma → do nothing
      if (val.trim().endsWith(",")) {
        return match;
      }

      return `${val},${whitespace}${nextQuote}`;
    }
  );
}

/**
 * Fix }{ → },{
 * Only when NOT already comma-separated
 */
export function fixObjectMerges(str) {
  return str.replace(/}\s*{/g, (match) => {

    if (match.includes("},{")) {
      return match; // already correct
    }

    return "},{";
  });
}