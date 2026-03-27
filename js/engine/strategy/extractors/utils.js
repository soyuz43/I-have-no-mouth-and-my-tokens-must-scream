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