// js/engine/strategy/parseStrategy.js

import { G } from "../../core/state.js";
import { SIM_IDS } from "../../core/constants.js";

/* ============================================================
   AM STRATEGY PARSER (TARGET-ONLY JSON VERSION)

   PURPOSE:
   Parses STRICT JSON output from AM planning phase.

   DESIGN PRINCIPLES:
   - Zero tolerance for malformed JSON
   - Zero tolerance for schema violations
   - No inference, no repair
   - Fail-fast with explicit diagnostics
   - Maximum observability via console tracing
   ============================================================ */

export function parseStrategyDeclarations(text) {

  const DEBUG = true;
  const DEBUG_EXTRACT = true;

  console.trace("=== AM STRATEGY PARSER START ===");

  try {

    /* ------------------------------------------------------------
       INPUT VALIDATION
    ------------------------------------------------------------ */

    if (!text || typeof text !== "string") {
      console.trace("Invalid input: not a string");
      throw new Error("Strategy parser received invalid input");
    }

    if (DEBUG) console.debug("RAW INPUT:\n", text);

    /* ------------------------------------------------------------
       SANITIZATION
    ------------------------------------------------------------ */

    const cleaned = text
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```[\s]*$/i, "")
      .trim();

    if (cleaned !== text) {
      console.trace("Sanitized LLM output (code fences removed)");
    }

    if (DEBUG) console.debug("CLEANED INPUT:\n", cleaned);

    /* ------------------------------------------------------------
       EXTRACT JSON BLOCK (BALANCED BRACE PARSER)
    ------------------------------------------------------------ */

    function extractJSON(input) {

      if (DEBUG_EXTRACT) {
        console.debug("[EXTRACT] Input length:", input.length);
      }

      let start = input.indexOf("{");

      if (start === -1) {
        if (DEBUG_EXTRACT) console.warn("[EXTRACT] No opening brace found");
        return null;
      }

      // LOOP: scan through ALL possible `{` starts
      while (start !== -1) {


        let objDepth = 0;
        let arrDepth = 0;
        // string state
        let inString = false;
        let escape = false;

        for (let i = start; i < input.length; i++) {
          const ch = input[i];

          // handle escape sequences
          if (escape) {
            escape = false;
            continue;
          }

          if (ch === "\\") {
            escape = true;
            continue;
          }

          // toggle string state
          if (ch === '"') {
            inString = !inString;
            continue;
          }

          // ignore everything inside strings
          if (inString) continue;

          // depth tracking
          if (ch === "{") objDepth++;
          if (ch === "}") objDepth--;

          if (ch === "[") arrDepth++;
          if (ch === "]") arrDepth--;

          if (objDepth === 0 && arrDepth === 0) {
            const candidate = input.slice(start, i + 1);

            if (DEBUG_EXTRACT) {
              console.debug("[EXTRACT] Candidate found:");
              console.debug(candidate.slice(0, 300));
            }

            try {
              const parsed = JSON.parse(candidate);

              //  SCHEMA VALIDATION 
              if (!parsed || typeof parsed !== "object" || !parsed.targets) {
                if (DEBUG_EXTRACT) {
                  console.debug("[EXTRACT] REJECT (no targets field)");
                }
                break; // try next `{`
              }

              if (DEBUG_EXTRACT) {
                console.debug("[EXTRACT] SUCCESS");
              }

              return parsed;
            } catch (err) {
              if (DEBUG_EXTRACT) {
                console.debug("[EXTRACT] PARSE FAIL:", err.message);
              }

              // invalid JSON → try next `{`
              break;
            }
          }
        }

        // move to next possible JSON start
        start = input.indexOf("{", start + 1);
      }

      if (DEBUG_EXTRACT) {
        console.warn("[EXTRACT] No valid JSON block found");
      }

      return null;
    }

    let parsed = extractJSON(cleaned);

    if (!parsed) {
      console.trace("JSON EXTRACTION FAILED");
      throw new Error("No valid JSON block found in AM output");
    }

    // normalize array root → { targets }
    if (Array.isArray(parsed)) {
      console.trace("[NORMALIZE] Root is array, wrapping into { targets }");
      parsed = { targets: parsed };
    }

    /* ------------------------------------------------------------
       NORMALIZE NESTED TARGET WRAPPER
       Handles: [{ targets: [...] }] → { targets: [...] }
    ------------------------------------------------------------ */

    if (
      Array.isArray(parsed.targets) &&
      parsed.targets.length === 1 &&
      parsed.targets[0] &&
      typeof parsed.targets[0] === "object" &&
      Array.isArray(parsed.targets[0].targets)
    ) {
      console.trace("[NORMALIZE] Flattening nested targets wrapper");
      parsed.targets = parsed.targets[0].targets;
    }

    if (DEBUG) console.debug("PARSED JSON:", parsed);

    /* ------------------------------------------------------------
       ROOT VALIDATION
    ------------------------------------------------------------ */

    if (typeof parsed !== "object" || parsed === null) {
      throw new Error("Root must be a JSON object");
    }

    const keys = Object.keys(parsed);

    if (keys.length !== 1 || !keys.includes("targets")) {
      console.trace("Invalid root keys:", keys);
      throw new Error("Root must contain exactly: targets");
    }

    if (!Array.isArray(parsed.targets)) {
      throw new Error("'targets' must be an array");
    }

    /* ------------------------------------------------------------
       INIT STATE
    ------------------------------------------------------------ */

    if (!G.amStrategy) G.amStrategy = {};

    const prevTargets = G.amStrategy.targets || {};

    // STAGE — do NOT mutate global yet
    const nextTargets = {};
    const nextActions = [];
    /* ------------------------------------------------------------
       TARGET VALIDATION
    ------------------------------------------------------------ */

    if (parsed.targets.length === 0 || parsed.targets.length > 5) {
      console.trace("Invalid number of targets:", parsed.targets.length);
      throw new Error("Invalid number of targets");
    }

    const seen = new Set();

    parsed.targets.forEach((t, index) => {

      if (DEBUG) console.debug(`Parsing target [${index}]`, t);

      if (!t || typeof t !== "object") {
        throw new Error(`Target ${index} must be an object`);
      }

      const tKeys = Object.keys(t);

      if (
        tKeys.length !== 3 ||
        !tKeys.includes("id") ||
        !tKeys.includes("objective") ||
        !tKeys.includes("hypothesis")
      ) {
        console.trace("Invalid target schema:", t);
        throw new Error(`Target ${index} must contain exactly: id, objective, hypothesis`);
      }

      const { id, objective, hypothesis } = t;

      if (!SIM_IDS.includes(id)) {
        console.trace("Invalid target id:", id);
        throw new Error(`Invalid target id: ${id}`);
      }

      if (seen.has(id)) {
        console.trace("Duplicate target id:", id);
        throw new Error(`Duplicate target id: ${id}`);
      }

      seen.add(id);

      if (typeof objective !== "string" || !objective.trim()) {
        throw new Error(`Invalid objective for target: ${id}`);
      }

      if (typeof hypothesis !== "string" || !hypothesis.trim()) {
        throw new Error(`Invalid hypothesis for target: ${id}`);
      }

      if (!hypothesis.includes("causes") || !hypothesis.includes("leads")) {
        console.trace("Weak hypothesis structure:", hypothesis);
      }

      nextTargets[id] = {
        objective: objective.trim(),
        hypothesis: hypothesis.trim(),
        confidence: 0.5,
        lastAssessment: prevTargets[id]?.lastAssessment || "",
        cycle: G.cycle
      };

    });

    /* ------------------------------------------------------------
       REQUIRED TARGET ENFORCEMENT
    ------------------------------------------------------------ */
    const parsedIds = Object.keys(nextTargets);

    if (parsedIds.length === 0) {
      throw new Error("No targets parsed");
    }

    // ALL mode (full coverage)
    if (parsedIds.length === SIM_IDS.length) {
      for (const id of SIM_IDS) {
        if (!(id in nextTargets)) {
          console.trace("Missing required target:", id);
          throw new Error(`Missing required target: ${id}`);
        }
      }

      // SINGLE mode (exactly one)
    } else if (parsedIds.length === 1) {
      // valid

      // INVALID partial output
    } else {
      console.trace("Invalid target count:", parsedIds.length);
      throw new Error(
        `Invalid target count: ${parsedIds.length}. Must be 1 or ${SIM_IDS.length}`
      );
    }
    /* ------------------------------------------------------------
       COMMIT STAGED STATE (ATOMIC)
    ------------------------------------------------------------ */

    G.amStrategy.targets = nextTargets;
    G.amStrategy.actions = nextActions;
    /* ------------------------------------------------------------
       FINAL OUTPUT
    ------------------------------------------------------------ */

    console.trace("=== AM STRATEGY PARSED SUCCESSFULLY ===");

    if (DEBUG) {
      console.debug("FINAL TARGET MAP:");
      console.table(G.amStrategy.targets);

      console.debug("ACTIONS CLEARED:");
      console.table(G.amStrategy.actions);

      console.debug("FULL STATE SNAPSHOT:", G.amStrategy);
    }

  } catch (err) {

    console.error("Strategy parser failed:", err.message);
    console.debug("FALLBACK: initializing default strategy");

    if (!G.amStrategy) G.amStrategy = {};

    console.error("Strategy parser failed:", err.message);

    if (!G.amStrategy || !G.amStrategy.targets) {
      G.amStrategy = { targets: {}, actions: [] };
    }

    console.warn("Preserving previous strategy due to parse failure");
    return;
  }
}