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
   PASS 1.5: ARRAY ELEMENT COMMA FIX (CRITICAL)
  ------------------------------------------------------------ */

  str = str.replace(
    /(")(\s*\n\s*)(")/g,
    (match, endQuote, whitespace, startQuote, offset, full) => {

      const before = full.slice(0, offset);
      const quoteCount = (before.match(/"/g) || []).length;
      if (quoteCount % 2 !== 0) return match;

      const trimmed = before.trimEnd();
      const lastChar = trimmed.slice(-1);

      if (!['"', '}', ']'].includes(lastChar)) {
        return match;
      }

      return `${endQuote},${whitespace}${startQuote}`;
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
      return match;
    }

    return "},{";
  });
}


/**
 * Split objects when multiple "id" keys appear inside the same object.
 *
 * Designed specifically for LLM corruption like:
 * { "id":"A", ..., "id":"B", ... }
 *
 * Safety rules:
 * - Only split when inside an array
 * - Never split inside strings
 * - Never rewrite tokens manually
 * - No fake stack mutations
 */

export function splitMergedObjectsById(input) {

  let out = "";
  let inString = false;
  let escape = false;

  const stack = [];
  let arrayDepth = 0;

  for (let i = 0; i < input.length; i++) {

    const ch = input[i];

    /* ---------------- escape handling ---------------- */

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

    /* ---------------- string toggle ---------------- */

    if (ch === '"') {
      inString = !inString;
      out += ch;
      continue;
    }

    /* ---------------- array tracking ---------------- */

    if (!inString && ch === "[") {
      arrayDepth++;
      out += ch;
      continue;
    }

    if (!inString && ch === "]") {
      if (arrayDepth > 0) arrayDepth--;
      out += ch;
      continue;
    }

    /* ---------------- object tracking ---------------- */

    if (!inString && ch === "{") {
      stack.push({ idCount: 0 });
      out += ch;
      continue;
    }

    if (!inString && ch === "}") {
      if (stack.length > 0) stack.pop();
      out += ch;
      continue;
    }

    /* ---------------- detect "id" ---------------- */

    if (
      !inString &&
      stack.length === 1 &&     // only inside object
      arrayDepth === 1 &&       // only inside top-level array
      input.slice(i, i + 4) === '"id"' &&
      (input[i + 4] === ":" || /\s/.test(input[i + 4]))
    ) {

      const current = stack[stack.length - 1];
      current.idCount++;

      if (current.idCount > 1) {

        // Look backwards safely
        let j = out.length - 1;
        while (j >= 0 && /\s/.test(out[j])) j--;

        const prevChar = out[j];

        // Only split if we're at a safe boundary
        if (
          prevChar === '"' ||   // string ended
          prevChar === '}' ||   // object ended
          prevChar === ']' ||   // array ended
          /[0-9]/.test(prevChar)
        ) {
          out += ",{";
          current.idCount = 1;
          continue;
        }
      }
    }

    out += ch;
  }

  return out;
}

/**
 * Repair broken string boundaries
 */
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