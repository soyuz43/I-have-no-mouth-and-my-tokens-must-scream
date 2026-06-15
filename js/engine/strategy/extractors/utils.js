// js/engine/strategy/extractors/utils.js

export function stripJsonComments(str) {
  return str.replace(/\/\/.*$/gm, "");
}


/**
 * Repairs single-quoted values for known strategy fields.
 *
 * Example:
 *   "hypothesis": 'The group's hope will collapse'
 *
 * Becomes:
 *   "hypothesis": "The group's hope will collapse"
 *
 * Apostrophes inside the value are preserved. A single quote is
 * treated as the closing delimiter only when followed by a comma,
 * closing brace, or closing bracket.
 */
export function fixSingleQuotedSchemaValues(input) {
  if (typeof input !== "string") return input;

  const fieldPattern =
    /^"(id|objective|hypothesis|evidence|why_now)"(\s*:\s*)'/i;

  const nextSchemaKeyPattern =
    /^"(?:id|objective|hypothesis|evidence|why_now)"\s*:/i;

  let out = "";
  let inDoubleString = false;
  let escape = false;
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    if (escape) {
      out += ch;
      escape = false;
      i++;
      continue;
    }

    if (ch === "\\") {
      out += ch;
      escape = true;
      i++;
      continue;
    }

    if (!inDoubleString && ch === '"') {
      const match = input.slice(i).match(fieldPattern);

      if (match) {
        const openingLength = match[0].length;
        const valueStart = i + openingLength;

        let valueOut = "";
        let valueEscape = false;
        let closingIndex = -1;

        for (let j = valueStart; j < input.length; j++) {
          const valueChar = input[j];

          if (valueEscape) {
            if (valueChar === "'") {
              valueOut += "'";
            } else {
              valueOut += `\\${valueChar}`;
            }

            valueEscape = false;
            continue;
          }

          if (valueChar === "\\") {
            valueEscape = true;
            continue;
          }

          if (valueChar === '"') {
            valueOut += '\\"';
            continue;
          }

          if (valueChar === "'") {
            let nextIndex = j + 1;

            while (
              nextIndex < input.length &&
              /\s/.test(input[nextIndex])
            ) {
              nextIndex++;
            }

            const nextChar = input[nextIndex];

            const followedByDelimiter =
              nextChar === "," ||
              nextChar === "}" ||
              nextChar === "]";

            const followedByNextKey =
              nextChar === '"' &&
              nextSchemaKeyPattern.test(
                input.slice(nextIndex)
              );

            if (
              followedByDelimiter ||
              followedByNextKey
            ) {
              closingIndex = j;
              break;
            }
          }

          valueOut += valueChar;
        }

        if (closingIndex !== -1) {
          const fieldPrefix =
            match[0].slice(0, -1);

          out += `${fieldPrefix}"${valueOut}"`;
          i = closingIndex + 1;
          continue;
        }
      }
    }

    if (ch === '"') {
      inDoubleString = !inDoubleString;
    }

    out += ch;
    i++;
  }

  return out;
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
 * Fix LLM typo:
 *   "field": "value.","
 *   "next": "value"
 *
 * Into:
 *   "field": "value.",
 *   "next": "value"
 */
export function fixStrayQuoteAfterComma(str) {
  if (typeof str !== "string") return str;

  return str.replace(
    /,\s*"\s*(?=\n\s*"[A-Za-z_][A-Za-z0-9_]*"\s*:)/g,
    ","
  );
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
export function splitDuplicateIdObjects(str) {

  if (typeof str !== "string") return str;

  let out = "";
  let inString = false;
  let escape = false;

  let objectDepth = 0;
  let arrayDepth = 0;

  const idCountStack = [];

  for (let i = 0; i < str.length; i++) {

    const ch = str[i];

    /* ---------------- ESCAPE ---------------- */

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

    /* ---------------- STRING ---------------- */

    if (ch === '"') {
      inString = !inString;
      out += ch;
      continue;
    }

    if (inString) {
      out += ch;
      continue;
    }

    /* ---------------- STRUCTURE ---------------- */

    if (ch === "{") {
      objectDepth++;
      idCountStack.push(0);
      out += ch;
      continue;
    }

    if (ch === "}") {
      objectDepth = Math.max(0, objectDepth - 1);
      idCountStack.pop();
      out += ch;
      continue;
    }

    if (ch === "[") {
      arrayDepth++;
      out += ch;
      continue;
    }

    if (ch === "]") {
      arrayDepth = Math.max(0, arrayDepth - 1);
      out += ch;
      continue;
    }

    /* ---------------- ID DETECTION ---------------- */

    const isId =
      str.slice(i, i + 4) === '"id"' &&
      (str[i + 4] === ":" || /\s/.test(str[i + 4]));

    const isInsideArrayObject =
      objectDepth === 2 &&
      arrayDepth === 1;

    if (isId && isInsideArrayObject) {

      const idx = idCountStack.length - 1;

      if (idx >= 0) {
        idCountStack[idx]++;

        // 🚨 ONLY split on SECOND id (never first)
        if (idCountStack[idx] === 2) {

          let j = out.length - 1;
          while (j >= 0 && /\s/.test(out[j])) j--;

          const prev = out[j];

          const safeBoundary =
            prev === "}" ||
            prev === '"' ||
            prev === "]" ||
            /[0-9]/.test(prev);

          const notAtObjectStart =
            prev !== "{";

          if (safeBoundary && notAtObjectStart) {

            /* ---- FORCE CLEAN SPLIT ---- */

            // Close object if needed
            if (prev !== "}") {
              out += "}";
            }

            // Remove trailing comma safely
            out = out.replace(/,\s*$/, "");

            // Insert split
            out += ",{";

            // Reset counter for new object
            idCountStack[idx] = 1;

            continue;
          }
        }
      }
    }

    out += ch;
  }

  return out;
}

/**

 * Repairs unescaped double quotes inside JSON string values.

 *

 * A quote is treated as a legitimate closing quote when the next

 * non-whitespace character is a JSON delimiter:

 *   ,  }  ]  :

 *

 * This preserves valid closing quotes followed by spaces or

 * newlines in pretty-printed JSON.

 */

export function fixBrokenStrings(input) {

  if (typeof input !== "string") return input;

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

      if (!inString) {
        inString = true;
        out += ch;
        continue;
      }

       // Look beyond formatting whitespace before deciding whether this quote closes the JSON string.
      let nextIndex = i + 1;

      while (
        nextIndex < input.length &&
        /\s/.test(input[nextIndex])
      ) {
        nextIndex++;
      }
      const nextSignificant =

        input[nextIndex];

      const closesString =
        nextIndex >= input.length ||
        [",", "}", "]", ":"].includes(
          nextSignificant
        );

      if (closesString) {
        inString = false;
        out += ch;
      } else {

  // * Quote appears inside a string without escaping.         
        out += '\\"';
      }
      continue;
    }
    out += ch;
  }
  return out;
}
// Repair boundary commas + duplicate id collapse (single entry point)

export function repairObjectBoundaries(str) {

  if (typeof str !== "string") return str;

  let out = str;

  // 1. Handle duplicated id blocks first (structural split)
  out = splitDuplicateIdObjects(out);

  // 2. Normalize adjacent object boundaries
  out = out.replace(/}\s*{/g, "},{");

  // 3. Fix accidental double commas
  out = out.replace(/},\s*,\s*{/g, "},{");

  // 4. Remove trailing commas before closing structures
  out = out.replace(/,\s*([}\]])/g, "$1");

  return out;
}


// Split cases like:
// } "id": "NEXT"
// or }, "id": "NEXT"
// into proper object boundaries

export function splitRepeatedObjectBlocks(str) {

  if (typeof str !== "string") return str;

  return str.replace(
    /}\s*,?\s*(?="id"\s*:)/g,
    "},{"
  );
}


export function splitMultiIdCascade(str) {

  if (typeof str !== "string") return str;

  let out = "";
  let inString = false;
  let escape = false;

  let objectDepth = 0;
  let arrayDepth = 0;

  let currentId = null;
  let idCount = 0;

  for (let i = 0; i < str.length; i++) {

    const ch = str[i];

    // ---------------- ESCAPE ----------------
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

    // ---------------- STRING ----------------
    if (ch === '"') {
      inString = !inString;
      out += ch;
      continue;
    }

    if (inString) {
      out += ch;
      continue;
    }

    // ---------------- STRUCTURE ----------------
    if (ch === "{") {
      objectDepth++;
      currentId = null;
      idCount = 0;
      out += ch;
      continue;
    }

    if (ch === "}") {
      objectDepth--;
      out += ch;
      continue;
    }

    if (ch === "[") {
      arrayDepth++;
      out += ch;
      continue;
    }

    if (ch === "]") {
      arrayDepth--;
      out += ch;
      continue;
    }

    // ---------------- DETECT ID ----------------
    const isId =
      str.slice(i, i + 4) === '"id"' &&
      (str[i + 4] === ":" || /\s/.test(str[i + 4]));

    if (isId && objectDepth >= 2 && arrayDepth >= 1) {

      // extract ID value safely
      const match = str.slice(i).match(/"id"\s*:\s*"([^"]+)"/);

      const nextId = match ? match[1] : null;

      idCount++;

      // first id in object
      if (idCount === 1) {
        currentId = nextId;
      }

      // repeated id handling
      if (idCount > 1) {

        let j = out.length - 1;
        while (j >= 0 && /\s/.test(out[j])) j--;

        const prev = out[j];

        // CASE 1: SAME ID → IGNORE DUPLICATE
        if (nextId && nextId === currentId) {
          // Skip ONLY the duplicate "id" key, not the entire content
          // Advance pointer past this id token safely
          const idMatch = str.slice(i).match(/"id"\s*:\s*"[^"]+"/);
          if (idMatch) {
            i += idMatch[0].length - 1;
            continue;
          }
        }

        // CASE 2: DIFFERENT ID → SPLIT OBJECT
        if (prev !== "{") {

          if (prev !== "}") {
            out += "}";
          }

          if (out.endsWith(",")) {
            out = out.slice(0, -1);
          }

          out += ",{";

          // reset tracking for new object
          currentId = nextId;
          idCount = 1;

          continue;
        }
      }
    }

    out += ch;
  }

  return out;
}