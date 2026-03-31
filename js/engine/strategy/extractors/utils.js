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
export function fixMissingCommas(input) {

  /* ------------------------------------------------------------
     PASS 1: MULTILINE FIX (SAFE REGEX)
  ------------------------------------------------------------ */

  let str = input.replace(
    /(":\s*"[^"]*")(\s*\n\s*)(")/g,
    (match, val, whitespace, nextQuote) => {
      if (val.trim().endsWith(",")) return match;
      return `${val},${whitespace}${nextQuote}`;
    }
  );

  /* ------------------------------------------------------------
     PASS 2: STATEFUL STRUCTURE-AWARE FIX
  ------------------------------------------------------------ */

  let out = "";
  let inString = false;
  let escape = false;
  let lastNonWhitespace = null;

  for (let i = 0; i < str.length; i++) {

    const ch = str[i];

    if (escape) {
      out += ch;
      escape = false;
      continue;
    }

    if (ch === "\\") {
      out += ch;
      escape = true;
      continue;
    }

    if (ch === '"') {

      // SAFE LOOKAHEAD: handles escaped quotes inside strings
      let j = i + 1;
      let isEscaped = false;
      let foundEnd = false;

      while (j < str.length) {
        const c = str[j];

        if (isEscaped) {
          isEscaped = false;
        } else if (c === "\\") {
          isEscaped = true;
        } else if (c === '"') {
          foundEnd = true;
          break;
        }

        j++;
      }

      let isKey = false;

      if (foundEnd) {
        let k = j + 1;
        while (k < str.length && /\s/.test(str[k])) k++;
        if (str[k] === ":" && /^[A-Za-z0-9_\-]+$/.test(str.slice(i + 1, j))) {
          isKey = true;
        }
      }

      if (
        isKey &&
        !inString &&
        lastNonWhitespace &&
        ![",", "{", "["].includes(lastNonWhitespace)
      ) {
        out = out.trimEnd();

        if (!out.endsWith(",")) {
          out += ",";
        }
      }

      inString = !inString;
      out += ch;
      continue;
    }

    out += ch;

    if (!/\s/.test(ch)) {
      lastNonWhitespace = ch;
    }
  }

  return out;
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


export function splitMergedObjectsById(input) {
  let out = "";
  let inString = false;
  let escape = false;

  let idCountInObject = 0;
  let braceDepth = 0;

  for (let i = 0; i < input.length; i++) {

    // DETECT "id" BEFORE string toggle
    if (
      !inString &&
      braceDepth === 1 && // ONLY split at top-level object in array
      input.slice(i, i + 4) === '"id"'
    ) {
      idCountInObject++;

      if (idCountInObject > 1) {
        // close previous object if needed before splitting
        if (!out.endsWith("}")) {
          out += "}";
        }
        out += ",{";
        idCountInObject = 1;
        continue;
      }
    }

    const ch = input[i];

    if (escape) {
      out += ch;
      escape = false;
      continue;
    }

    if (ch === "\\") {
      out += ch;
      escape = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      out += ch;
      continue;
    }

    if (!inString) {
      if (ch === "{") {
        braceDepth++;
        idCountInObject = 0;
      }

      if (ch === "}") {
        braceDepth--;
      }
    }

    out += ch;
  }

  return out;
}

export function fixBrokenStrings(input) {
  let out = "";
  let inString = false;
  let escape = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (escape) {
      out += ch;
      escape = false;
      continue;
    }

    if (ch === "\\") {
      out += ch;
      escape = true;
      continue;
    }

    if (ch === '"') {
      const next = input[i + 1];

      if (inString) {
        if (next && ![",", "}", "]", ":"].includes(next)) {
          out += '\\"';
          continue;
        }
      }

      inString = !inString;
      out += ch;
      continue;
    }

    out += ch;
  }

  return out;
}