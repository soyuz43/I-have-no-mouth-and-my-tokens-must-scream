// js/engine/strategy/extractors/extractJSON.js

import {
  stripJsonComments,
  fixMissingCommas,
  splitMergedObjectsById,
  splitDuplicateIdObjects,
  fixBrokenStrings
} from "./utils.js";

import { classifyJsonError } from "./classifyJsonError.js";

import { normalizeTargetKeys } from "./normalizeKeys.js";
/* ============================================================
   SCHEMA-AWARE TARGETS EXTRACTION
============================================================ */

function extractTargetsArray(source) {
  if (typeof source !== "string") return null;

  const key = '"targets"';
  const idx = source.indexOf(key);

  if (idx === -1) return null;

  const startBracket = source.indexOf("[", idx);
  if (startBracket === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = startBracket; i < source.length; i++) {
    const ch = source[i];

    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === "[") depth++;
    if (ch === "]") depth--;

    if (depth === 0) {
      const candidate = source.slice(startBracket, i + 1);

      try {
        return JSON.parse(fixBrokenStrings(candidate));
      } catch {
        return null;
      }
    }
  }

  return null;
}

/* ============================================================
   REPAIR PIPELINE
============================================================ */

function attemptRepairs(candidate, DEBUG_EXTRACT) {
  let repaired = candidate;

  // Strip trailing commas 
  repaired = repaired.trim().replace(/,\s*$/, "");

  let errorType = "unknown";

  try {
    errorType = classifyJsonError(candidate);
  } catch (err) {
    if (DEBUG_EXTRACT) {
      console.warn("[REPAIR] classifyJsonError failed:", err.message);
    }
  }

  if (DEBUG_EXTRACT) {
    console.debug("[REPAIR] classified as:", errorType);
  }

  repaired = stripJsonComments(repaired);
  repaired = fixMissingCommas(repaired);

  // Fix duplicate id object collapse FIRST
  repaired = splitDuplicateIdObjects(repaired);
  repaired = splitMergedObjectsById(repaired);

  if (errorType === "structural_merge") {
    repaired = fixObjectMerges(repaired);
  }

  if (errorType === "truncated") {
    return candidate;
  }

  if (errorType === "trailing_comma" && DEBUG_EXTRACT) {
    console.debug("[REPAIR] handling trailing comma case");
  }

  //  Remove trailing garbage after string values (safe trim) s
  repaired = repaired.replace(
    /(":\s*"[^"]*")\s+([A-Za-z][^",}\]\n]*)/g,
    (match, fullString, garbage) => {
      // Only trim if clearly narrative (multiple words AND no JSON delimiters ahead)
      if (/^[A-Za-z]+\s+[a-z]/.test(garbage) && !/[{}[\]":]/.test(garbage)) {
        return `${fullString},`;
      }
      return match;
    }
  );

  repaired = fixBrokenStrings(repaired);

  return repaired;
}

/* ============================================================
   MAIN EXTRACTION
============================================================ */
export function extractJSON(input, { DEBUG_EXTRACT = false } = {}) {
  const candidates = [];

  /* ------------------------------------------------------------
     HARD GUARD: must contain JSON root somewhere
  ------------------------------------------------------------ */

  const firstBrace = input.indexOf("{");
  const firstBracket = input.indexOf("[");

  if (firstBrace === -1 && firstBracket === -1) {
    if (DEBUG_EXTRACT) {
      console.warn("[EXTRACT] no JSON root detected");
    }
    return null;
  }

  /* ------------------------------------------------------------
     STRIP LOG CONTAMINATION (CRITICAL)
  ------------------------------------------------------------ */

  let cleanedInput = input
    .replace(/^\s*\[(PRIV|PUBLIC)\][^\n]*\n?/gm, "")
    .replace(/^\s*(PRIVATE|PUBLIC)[^\n]*\n?/gm, "")
    .replace(/^\s*NOTICE[^\n]*\n?/gm, "");


  /* ------------------------------------------------------------
   FAST PATH: FULL OBJECT FIRST 
------------------------------------------------------------ */

  try {
    const start = cleanedInput.indexOf("{");
    if (start !== -1) {
      const full = cleanedInput.slice(start).trim();

      const parsed = JSON.parse(full);

      if (parsed?.targets && Array.isArray(parsed.targets)) {

        // Detect merged-object corruption
        if (parsed.targets.length === 1) {
          const raw = full;

          const idMatches = raw.match(/"id"\s*:/g) || [];

          if (idMatches.length > 1) {
            if (DEBUG_EXTRACT) {
              console.warn("[REPAIR] detected merged target object in FAST PATH");
            }

            // force repair pipeline
            const repaired = attemptRepairs(full, DEBUG_EXTRACT);

            try {
              const reparsed = JSON.parse(repaired);

              if (reparsed?.targets && Array.isArray(reparsed.targets)) {
                if (DEBUG_EXTRACT) {
                  console.warn("[REPAIR] FAST PATH repair success");
                }

                reparsed.targets = reparsed.targets.map(t => normalizeTargetKeys(t));
                return reparsed;
              }
            } catch (e) {
              if (DEBUG_EXTRACT) {
                console.warn("[REPAIR] FAST PATH repair failed");
              }
            }
          }
        }

        if (DEBUG_EXTRACT) {
          console.debug("[EXTRACT] full JSON success");
        }

        parsed.targets = parsed.targets.map(t => normalizeTargetKeys(t));
        return parsed;
      }
    }
  } catch (e) {
    if (DEBUG_EXTRACT) {
      console.debug("[EXTRACT] full JSON failed");
    }
  }

  if (DEBUG_EXTRACT) {
    console.debug("[EXTRACT][JSON] Input length:", cleanedInput.length);
  }

  /* ------------------------------------------------------------
   TARGETS-FIRST EXTRACTION 
   Finds "targets" key, then expands to balanced JSON boundaries
------------------------------------------------------------ */

  const targetsIdx = cleanedInput.indexOf('"targets"');
  if (targetsIdx !== -1) {
    // Scan backward to find opening brace of containing object
    let objStart = targetsIdx;
    let depth = 0;
    let inString = false;
    let escape = false;

    for (let i = targetsIdx; i >= 0; i--) {
      const ch = cleanedInput[i];
      if (escape) { escape = false; continue; }
      if (ch === "\\") { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;

      if (ch === "}") depth--;
      if (ch === "{") {
        depth++;
        if (depth === 1) { objStart = i; break; }
      }
    }

    // Scan forward to find matching closing brace
    depth = 0;
    inString = false;
    escape = false;

    for (let i = objStart; i < cleanedInput.length; i++) {
      const ch = cleanedInput[i];
      if (escape) { escape = false; continue; }
      if (ch === "\\") { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;

      if (ch === "{") depth++;
      if (ch === "}") {
        depth--;
        if (depth === 0) {
          const candidate = cleanedInput.slice(objStart, i + 1).trim();

          // Try direct parse
          try {
            const parsed = JSON.parse(candidate);
            if (parsed?.targets && Array.isArray(parsed.targets)) {
              if (DEBUG_EXTRACT) console.debug("[EXTRACT] targets-first success");
              parsed.targets = parsed.targets.map(t => normalizeTargetKeys(t));
              return parsed;
            }
          } catch (_) { }

          // Try with repairs
          let repaired = attemptRepairs(candidate, DEBUG_EXTRACT);
          try {
            const reparsed = JSON.parse(repaired);
            if (reparsed?.targets && Array.isArray(reparsed.targets)) {
              if (DEBUG_EXTRACT) console.debug("[EXTRACT] targets-first + repair success");
              reparsed.targets = reparsed.targets.map(t => normalizeTargetKeys(t));
              return reparsed;
            }
          } catch (_) { }

          break;
        }
      }
    }
  }

  /* ------------------------------------------------------------
     STEP 1: FIND ROOT STARTS
  ------------------------------------------------------------ */

  const starts = [];

  for (let i = 0; i < cleanedInput.length; i++) {
    if (cleanedInput[i] === "{") starts.push({ index: i, type: "{" });
    if (cleanedInput[i] === "[") starts.push({ index: i, type: "[" });
  }

  starts.sort((a, b) => (a.type === "[" ? -1 : 1));

  /* ------------------------------------------------------------
     STEP 2: ROOT-AWARE SCAN
  ------------------------------------------------------------ */

  for (const { index: start, type } of starts) {

    let objDepth = 0;
    let arrDepth = 0;
    let inString = false;
    let escape = false;

    for (let i = start; i < cleanedInput.length; i++) {
      const ch = cleanedInput[i];

      if (escape) { escape = false; continue; }
      if (ch === "\\") { escape = true; continue; }

      if (ch === '"') {
        inString = !inString;
        continue;
      }

      if (inString) continue;

      if (ch === "{") objDepth++;
      if (ch === "}") objDepth--;
      if (ch === "[") arrDepth++;
      if (ch === "]") arrDepth--;

      const complete =
        (type === "{" && objDepth === 0) ||
        (type === "[" && objDepth === 0 && arrDepth === 0);

      if (complete) {

        const candidate = cleanedInput.slice(start, i + 1).trim();

        /* ----------------------------
           CONTAMINATION GUARD (CRITICAL)
        ---------------------------- */

        // find where JSON actually begins
        const firstJsonIdx = Math.min(
          ...[candidate.indexOf("{"), candidate.indexOf("[")].filter(i => i !== -1)
        );

        // check prefix only (before JSON)
        const prefix = firstJsonIdx > 0 ? candidate.slice(0, firstJsonIdx) : "";

        /* ------------------------------------------------------------
           CONTAMINATION GUARD (STRUCTURAL, NOT CONTENT-BASED)
        ------------------------------------------------------------ */

        if (
          prefix.includes("[PRIV]") ||
          prefix.includes("[PUBLIC]")
        ) {
          if (DEBUG_EXTRACT) {
            console.warn("[EXTRACT] rejecting contaminated candidate (prefix)");
          }
          continue;
        }


        /* ------------------------------------------------------------
           HARD FILTER
        ------------------------------------------------------------ */

        if (
          candidate.length < 20 ||
          !candidate.includes(":") ||
          !/[{\[]/.test(candidate[0])
        ) {
          continue;
        }

        const openBraces = (candidate.match(/{/g) || []).length;
        const closeBraces = (candidate.match(/}/g) || []).length;

        if (openBraces !== closeBraces) {
          if (DEBUG_EXTRACT) {
            console.debug("[EXTRACT] skipping unbalanced candidate");
          }
          continue;
        }
        const hasTargetsKey = candidate.includes('"targets"');

        // Only skip fragments that clearly cannot be repaired into targets
        if (!hasTargetsKey && candidate.includes('"id"') && !candidate.includes("{")) {
          continue;
        }

        if (DEBUG_EXTRACT) {
          console.debug("[EXTRACT] candidate:", candidate);
        }

        /* ------------------------------------------------------------
           SCORING FUNCTION
        ------------------------------------------------------------ */

        function computeScore(base, parsedTargets, raw) {
          let score = base;

          // size
          score += parsedTargets.length * 10;

          // proximity
          const idx = raw.indexOf('"targets"');
          if (idx !== -1 && idx < 80) score += 30;

          // noise (GroupLayout etc.)
          if (/[A-Za-z_]+\s*:\s*\[[^\]]*\]/.test(raw)) {
            score -= 50;
          }

          // duplicate IDs
          const ids = parsedTargets.map(t => t?.id).filter(Boolean);
          const unique = new Set(ids);
          if (ids.length !== unique.size) {
            score -= 40;
          }

          // impossible size
          if (parsedTargets.length > 5) {
            score -= 100;
          }

          return score;
        }

        /* --------------------------
           DIRECT PARSE
        -------------------------- */

        try {
          if (hasDuplicateKeys(candidate)) {
            if (DEBUG_EXTRACT) {
              console.warn("[EXTRACT] duplicate keys detected → forcing repair path");
            }

            let repaired = attemptRepairs(candidate, DEBUG_EXTRACT);

            try {
              const reparsed = JSON.parse(repaired);

              if (reparsed?.targets && Array.isArray(reparsed.targets)) {
                candidates.push({
                  parsed: reparsed,
                  score: computeScore(120, reparsed.targets, repaired),
                  source: "duplicate-repair"
                });
                continue;
              }
            } catch (_) { }

            throw new Error("duplicate_keys");

          }

          const parsed = JSON.parse(candidate);

          if (parsed && parsed.targets && Array.isArray(parsed.targets)) {
            candidates.push({
              parsed,
              score: computeScore(100, parsed.targets, candidate),
              source: "direct"
            });
          }

          if (!hasTargetsKey && Array.isArray(parsed)) {
            candidates.push({
              parsed: { targets: parsed },
              score: computeScore(10, parsed, candidate) - 50,
              source: "array"
            });
          }

        } catch (err) {

          if (DEBUG_EXTRACT) {
            console.debug("[EXTRACT] parse fail:", err.message);
          }

          /* --------------------------
             REPAIR
          -------------------------- */

          let repaired = attemptRepairs(candidate, DEBUG_EXTRACT);

          if (DEBUG_EXTRACT) {
            console.debug("[REPAIR] after (full):", repaired);
          }

          try {
            const reparsed = JSON.parse(repaired);

            if (reparsed && reparsed.targets && Array.isArray(reparsed.targets)) {
              candidates.push({
                parsed: reparsed,
                score: computeScore(80, reparsed.targets, repaired),
                source: "repair"
              });
            }

            if (!hasTargetsKey && Array.isArray(reparsed)) {
              candidates.push({
                parsed: { targets: reparsed },
                score: computeScore(30, reparsed, repaired),
                source: "repair-array"
              });
            }

          } catch (e2) {
            if (DEBUG_EXTRACT) {
              console.debug("[REPAIR] failed:", e2.message);
            }
          }
        }

        continue;
      }
    }
  }

  /* ------------------------------------------------------------
     BEST CANDIDATE
  ------------------------------------------------------------ */

  if (candidates.length > 0) {

    candidates.sort((a, b) => b.score - a.score);

    if (DEBUG_EXTRACT) {
      console.table(candidates.map(c => ({
        source: c.source,
        score: c.score,
        targets: c.parsed.targets?.length || 0
      })));
    }

    return candidates[0].parsed;
  }

  /* ------------------------------------------------------------
     FALLBACK: SCHEMA-AWARE (UNCHANGED)
  ------------------------------------------------------------ */

  const extractedTargets = extractTargetsArray(cleanedInput);

  if (extractedTargets) {
    return { targets: extractedTargets };
  }

  if (DEBUG_EXTRACT) {
    console.warn("[EXTRACT] no valid JSON");
  }

  return null;
}

function hasDuplicateKeys(str) {
  let inString = false;
  let escape = false;
  let depth = 0;

  const stack = [];

  for (let i = 0; i < str.length; i++) {
    const ch = str[i];

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

    if (ch === "{") {
      stack.push(new Set());
      depth++;
      continue;
    }

    if (ch === "}") {
      stack.pop();
      depth--;
      continue;
    }

    // detect keys ONLY at current object level
    if (ch === '"' && stack.length > 0) {
      let j = i + 1;
      while (j < str.length && str[j] !== '"') j++;

      const key = str.slice(i + 1, j);

      let k = j + 1;
      while (k < str.length && /\s/.test(str[k])) k++;

      if (str[k] === ":") {
        const current = stack[stack.length - 1];

        if (current.has(key)) {
          return true;
        }

        current.add(key);
      }

      i = j;
    }
  }

  return false;
}

function splitDuplicateIdObjects(str) {

  // Safety guard
  if (typeof str !== "string") return str;

  let out = "";
  let inString = false;
  let escape = false;

  let objectDepth = 0;
  let arrayDepth = 0;

  // Track how many "id" fields we’ve seen per object
  const idCountStack = [];

  for (let i = 0; i < str.length; i++) {

    const ch = str[i];

    /* ---------------- ESCAPE HANDLING ---------------- */

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

    /* ---------------- STRING HANDLING ---------------- */

    if (ch === '"') {
      inString = !inString;
      out += ch;
      continue;
    }

    if (inString) {
      out += ch;
      continue;
    }

    /* ---------------- STRUCTURE TRACKING ---------------- */

    if (ch === "{") {
      objectDepth++;
      idCountStack.push(0);
      out += ch;
      continue;
    }

    if (ch === "}") {
      objectDepth--;
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
      arrayDepth--;
      out += ch;
      continue;
    }

    /* ---------------- DUPLICATE "id" DETECTION ---------------- */

    const isTopLevelTargetObject =
      objectDepth === 2 &&   // inside object within array
      arrayDepth === 1;      // inside targets[]

    if (
      isTopLevelTargetObject &&
      str.slice(i, i + 4) === '"id"' &&
      (str[i + 4] === ":" || /\s/.test(str[i + 4]))
    ) {
      const idx = idCountStack.length - 1;

      if (idx >= 0) {
        idCountStack[idx]++;

        if (idCountStack[idx] > 1) {

          // Walk backwards to find safe split boundary
          let j = out.length - 1;
          while (j >= 0 && /\s/.test(out[j])) j--;

          const prev = out[j];

          // Only split if we're at a structurally safe point
          if (
            prev === "}" ||
            prev === '"' ||
            prev === "]" ||
            /[0-9]/.test(prev)
          ) {
            // ensure previous object is closed before splitting
            if (prev !== "}") {
              out += "}";
            }

            out += ",{";
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