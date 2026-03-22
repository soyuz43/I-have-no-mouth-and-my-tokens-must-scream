// filepath: js/engine/strategy/extractors/targetsExtractor.js

export function extractTargetsArray(input, { DEBUG_EXTRACT = false } = {}) {

  if (DEBUG_EXTRACT) {
    console.debug("[EXTRACT][TARGETS] scanning for targets array");
  }

  let inString = false;
  let escape = false;

  for (let i = 0; i < input.length; i++) {

    const ch = input[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (ch === "\\") {
      escape = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (input.slice(i, i + 9) === '"targets"') {

      let j = i + 9;

      while (/\s/.test(input[j])) j++;

      if (input[j] !== ":") continue;
      j++;

      while (/\s/.test(input[j])) j++;

      if (input[j] !== "[") continue;

      const start = j;
      let depth = 0;

      for (; j < input.length; j++) {

        const c = input[j];

        if (c === "[" && !inString) depth++;
        if (c === "]" && !inString) depth--;

        if (depth === 0) {

          const arrayStr = input.slice(start, j + 1);

          if (DEBUG_EXTRACT) {
            console.debug("[EXTRACT][TARGETS] candidate found");
          }

          try {

            const parsedArray = JSON.parse(arrayStr);

            if (!Array.isArray(parsedArray)) continue;

            if (DEBUG_EXTRACT) {
              console.debug("[EXTRACT][TARGETS] SUCCESS");
            }

            return { targets: parsedArray };

          } catch (err) {

            if (DEBUG_EXTRACT) {
              console.debug("[EXTRACT][TARGETS] parse fail:", err.message);
            }
          }

          break;
        }
      }
    }
  }

  if (DEBUG_EXTRACT) {
    console.warn("[EXTRACT][TARGETS] no valid array found");
  }

  return null;
}