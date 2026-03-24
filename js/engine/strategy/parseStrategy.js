// js/engine/strategy/parseStrategy.js

import { G } from "../../core/state.js";
import { SIM_IDS } from "../../core/constants.js";
import { extractJSON } from "./extractors/extractJSON.js";
import { extractTargetsArray } from "./extractors/targetsExtractor.js";
import { repairTargetsExtractor } from "./extractors/repairTargetsExtractor.js";
import { classifyJsonError } from "./extractors/classifyJsonError.js";
import { visualizeParserCycle } from "./analysis/parserMetricsVisualizer.js";
import { levenshtein } from "./extractors/levenshtein.js";
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

    // if (DEBUG) console.debug("RAW INPUT:\n", text);

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

    function runExtractionPipeline(input) {
      const cycle = G.cycle;

      // ------------------------------------------------------------
      // DEFENSIVE INIT (metrics only — no config here)
      // ------------------------------------------------------------
      if (!G.parserMetrics) {
        G.parserMetrics = {
          cycles: {},
          totals: {
            attempts: 0,
            success: 0,
            failures: 0,
            repairs: 0,
            errorTypes: {}
          }
        };
      }

      // ensure parserConfig exists
      if (!G.parserConfig) {
        G.parserConfig = { repairLevel: 1 };
      }

      // init cycle bucket
      if (!G.parserMetrics.cycles[cycle]) {
        G.parserMetrics.cycles[cycle] = {
          attempts: 0,
          success: 0,
          failures: 0,
          repairs: 0,
          errorTypes: {},
          extractorUsage: {}
        };
      }

      const metrics = G.parserMetrics.cycles[cycle];

      // increment attempt
      metrics.attempts++;
      G.parserMetrics.totals.attempts++;

      // ------------------------------------------------------------
      // REPAIR LEVEL (SOURCE OF TRUTH = parserConfig)
      // ------------------------------------------------------------
      const repairLevel = G.parserConfig.repairLevel ?? 1;
      console.debug("[PARSER CONFIG] repairLevel:", repairLevel);

      // ------------------------------------------------------------
      // EXTRACTOR SELECTION (ALIGNED WITH NEW ARCHITECTURE)
      // ------------------------------------------------------------
      const extractors = [];

      /**
       * LEVEL 0:
       * Unified extractor (strict + repair + schema-aware + salvage)
       */
      if (repairLevel >= 0) {
        extractors.push({ name: "json-unified", fn: extractJSON });
      }

      /**
       * LEVEL 1:
       * Explicit schema extractor (instrumentation + redundancy)
       * Useful for measuring fallback behavior
       */
      if (repairLevel >= 1) {
        extractors.push({ name: "targets-array", fn: extractTargetsArray });
      }

      /**
       * LEVEL 2:
       * Aggressive structural repair (last resort)
       */
      if (repairLevel >= 2) {
        extractors.push({ name: "repair-targets", fn: repairTargetsExtractor });
      }
      // ------------------------------------------------------------
      // AUTO-TUNE (TYPE-AWARE + RATE-AWARE)
      // ------------------------------------------------------------
      function autoTuneRepairLevel() {
        const totals = G.parserMetrics.totals;

        const attempts = totals.attempts || 1;
        const failures = totals.failures || 0;

        const failureRate = failures / attempts;
        const errors = totals.errorTypes || {};

        const commaRate = (errors.missing_comma || 0) / attempts;
        const structuralRate = (errors.structural_merge || 0) / attempts;
        const truncationRate = (errors.truncated || 0) / attempts;

        // avoid early noise
        if (attempts < 5) return;

        let currentLevel = G.parserConfig.repairLevel ?? 1;
        let nextLevel = currentLevel;

        // -------------------------
        // ESCALATE (aggressive signals)
        // -------------------------
        if (
          failureRate > 0.25 ||
          structuralRate > 0.1 ||
          truncationRate > 0.05
        ) {
          nextLevel = Math.min(currentLevel + 1, 2);
        }

        // -------------------------
        // DE-ESCALATE (stable system)
        // -------------------------
        if (
          failureRate < 0.05 &&
          commaRate < 0.05 &&
          structuralRate < 0.02
        ) {
          nextLevel = Math.max(currentLevel - 1, 1);
        }

        // -------------------------
        // APPLY CHANGE
        // -------------------------
        if (nextLevel !== currentLevel) {
          console.warn(
            `[AUTO-TUNE] repairLevel ${currentLevel} → ${nextLevel}`
          );
          G.parserConfig.repairLevel = nextLevel;
        }
      }

      // ------------------------------------------------------------
      // EXTRACTION LOOP
      // ------------------------------------------------------------
      let classifiedError = null;

      for (const { name, fn } of extractors) {

        console.debug(`[EXTRACTOR] trying ${name}`);

        // track usage
        metrics.extractorUsage[name] =
          (metrics.extractorUsage[name] || 0) + 1;

        const start = performance.now();

        let result = null;

        try {
          result = fn(input, { DEBUG_EXTRACT });
        } catch (err) {
          console.warn(`[EXTRACTOR] error in ${name}:`, err.message);
        }

        const duration = (performance.now() - start).toFixed(2);

        if (result) {

          console.debug(`[EXTRACTOR] SUCCESS: ${name} (${duration}ms)`);

          // success tracking
          metrics.success++;
          G.parserMetrics.totals.success++;

          // repair tracking
          if (name === "repair-targets") {
            metrics.repairs++;
            G.parserMetrics.totals.repairs++;
          }

          // auto-tune on success
          autoTuneRepairLevel();

          const enriched = {
            ...result,
            meta: { extractor: name }
          };

          if (DEBUG) {
            console.debug("[EXTRACTION PATH]", name);
          }

          return enriched;
        }

        // classify FIRST failure only
        if (!classifiedError) {
          classifiedError = classifyJsonError(input);
        }

        console.debug(`[EXTRACTOR] failed: ${name} (${duration}ms)`);
      }
      // ------------------------------------------------------------
      // FINAL FAILURE
      // ------------------------------------------------------------
      metrics.failures++;
      G.parserMetrics.totals.failures++;

      if (classifiedError) {

        metrics.errorTypes = metrics.errorTypes || {};
        G.parserMetrics.totals.errorTypes =
          G.parserMetrics.totals.errorTypes || {};

        metrics.errorTypes[classifiedError] =
          (metrics.errorTypes[classifiedError] || 0) + 1;

        G.parserMetrics.totals.errorTypes[classifiedError] =
          (G.parserMetrics.totals.errorTypes[classifiedError] || 0) + 1;
      }

      // auto-tune on failure
      autoTuneRepairLevel();

      return null;
    }

    let parsed = runExtractionPipeline(cleaned);

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

      const requiredKeys = ["id", "objective", "hypothesis", "why_now", "evidence"];
      const missing = requiredKeys.filter(k => !tKeys.includes(k));

      if (missing.length) {
        console.warn(`Target ${index} missing required keys: ${missing.join(", ")}`);
        return; // skip this target only
      }
      const { id, objective, hypothesis, why_now, evidence } = t;
      let normalizedId = id.toUpperCase();


      // ------------------------------------------------------------
      // PLACEHOLDER FALLBACK: infer from evidence
      // ------------------------------------------------------------
      const placeholderPatterns = [
        /^<NAME>$/i, /^NAME$/i,
        /^<PRISONER>$/i, /^PRISONER$/i,
        /^<SIM>$/i, /^SIM$/i,
        /^<TARGET>$/i, /^TARGET$/i,
        /^<SUBJECT>$/i, /^SUBJECT$/i,
        /^<ID>$/i, /^ID$/i,
        /^<UNKNOWN>$/i, /^UNKNOWN$/i,
        /^<HOLDER>$/i, /^HOLDER$/i,
      ];
      const isPlaceholder = placeholderPatterns.some(pattern => pattern.test(id.trim()));
      if (isPlaceholder) {
        console.warn(`[PARSER] Placeholder ID detected: "${id}" – attempting inference from fields.`);
        const text = `${evidence} ${why_now} ${objective} ${hypothesis}`.toUpperCase();
        const matches = SIM_IDS.filter(name => text.includes(name));
        if (matches.length === 1) {
          normalizedId = matches[0];
          console.warn(`[PARSER] Inferred target: ${normalizedId} from fields.`);
        } else if (matches.length > 1) {
          console.warn(`[PARSER] Multiple possible targets found: ${matches.join(", ")} – skipping target.`);
          return;
        } else {
          console.warn(`[PARSER] No valid target found in fields – skipping target.`);
          return;
        }
      }

      // ------------------------------------------------------------
      // ID VALIDATION (with fuzzy fallback)
      // ------------------------------------------------------------
      if (!SIM_IDS.includes(normalizedId)) {
        // Try fuzzy matching
        let bestDist = Infinity;
        let bestMatch = null;
        for (const allowed of SIM_IDS) {
          const dist = levenshtein(normalizedId, allowed);
          if (dist < bestDist) {
            bestDist = dist;
            bestMatch = allowed;
          }
        }
        if (bestDist <= 2) {
          console.warn(`[PARSER] Fuzzy match: "${id}" → "${bestMatch}" (dist=${bestDist})`);
          normalizedId = bestMatch;
        } else {
          throw new Error(`Invalid target id: ${id}`);
        }
      }

      if (seen.has(normalizedId)) {
        console.warn(`[PARSER] Duplicate target detected: ${normalizedId} — skipping duplicate`);
        return;
      }

      seen.add(normalizedId);

      // ------------------------------------------------------------
      // BASIC FIELD VALIDATION
      // ------------------------------------------------------------
      if (typeof objective !== "string" || !objective.trim()) {
        throw new Error(`Invalid objective for target: ${id}`);
      }

      if (typeof hypothesis !== "string" || !hypothesis.trim()) {
        throw new Error(`Invalid hypothesis for target: ${id}`);
      }

      if (typeof why_now !== "string" || why_now.trim().length < 15) {
        throw new Error(`Invalid or weak why_now for target: ${id}`);
      }

      if (typeof evidence !== "string" || evidence.trim().length < 10) {
        throw new Error(`Invalid or weak evidence for target: ${id}`);
      }

      // ------------------------------------------------------------
      // HYPOTHESIS STRUCTURE CHECK
      // ------------------------------------------------------------
      if (!hypothesis.includes("causes") || !hypothesis.includes("leads")) {
        console.trace("Weak hypothesis structure:", hypothesis);
      }

      // ------------------------------------------------------------
      // ALIGNMENT CHECK (critical new constraint)
      // ------------------------------------------------------------
      const combined = (evidence + " " + why_now + " " + hypothesis).toLowerCase();

      if (!combined.includes(normalizedId.toLowerCase())) {
        console.trace(`[ALIGNMENT WARNING] ${id} may not be referenced consistently`);
      }

      // ------------------------------------------------------------
      // STORE TARGET (NEW SHAPE)
      // ------------------------------------------------------------
      nextTargets[normalizedId] = {
        objective: objective.trim(),
        hypothesis: hypothesis.trim(),

        reasoning: {
          evidence: evidence.trim(),
          why_now: why_now.trim()
        },

        confidence: 0.5,
        lastAssessment: prevTargets[normalizedId]?.lastAssessment || "",
        cycle: G.cycle
      };

    });

    /* ------------------------------------------------------------
       TARGET COUNT VALIDATION
       Accept any number of targets from 1 to 5.
       Mode (ALL/SINGLE) is enforced by the prompt, not by the parser.
    ------------------------------------------------------------ */
    const parsedIds = Object.keys(nextTargets);

    if (DEBUG) {
      const dropped = parsed.targets.length - parsedIds.length;
      console.debug(`[PARSER] valid=${parsedIds.length} total=${parsed.targets.length} dropped=${dropped}`);
    }

    if (parsedIds.length === 0) {
      throw new Error("No valid targets parsed");
    }

    if (parsedIds.length > SIM_IDS.length) {
      console.trace("Too many targets:", parsedIds.length);
      throw new Error(`Too many targets: ${parsedIds.length}. Maximum is ${SIM_IDS.length}`);
    }

    // !! All IDs are already validated individually earlier.
    console.debug(`[PARSER] Parsed ${parsedIds.length} target(s): ${parsedIds.join(", ")}`);
    /* ------------------------------------------------------------
      COMMIT STAGED STATE (ATOMIC)
   ------------------------------------------------------------ */

    G.amStrategy.targets = nextTargets;
    G.amStrategy.actions = nextActions;

    /* ------------------------------------------------------------
       FINAL OUTPUT
    ------------------------------------------------------------ */

    console.trace("=== AM STRATEGY PARSED SUCCESSFULLY ===");
    visualizeParserCycle(G.cycle, G);

    if (DEBUG) {
      console.debug("[PARSER METRICS][CYCLE]", G.cycle);
      console.table(G.parserMetrics.cycles[G.cycle]);
    }

    /* ------------------------------------------------------------
       TARGET DEBUG (DETAILED + STRUCTURED)
    ------------------------------------------------------------ */

    if (DEBUG) {
      console.debug("=== DETAILED TARGET BREAKDOWN ===");

      Object.entries(G.amStrategy.targets).forEach(([id, t]) => {

        console.group(`TARGET: ${id}`);

        console.log("OBJECTIVE:", t.objective);
        console.log("HYPOTHESIS:", t.hypothesis);

        if (t.reasoning) {
          console.log("EVIDENCE:", t.reasoning.evidence);
          console.log("WHY_NOW:", t.reasoning.why_now);

          const combined = (
            t.reasoning.evidence +
            " " +
            t.reasoning.why_now +
            " " +
            t.hypothesis
          ).toLowerCase();

          if (!combined.includes(id.toLowerCase())) {
            console.warn("⚠ ALIGNMENT ISSUE: fields may not reference same target");
          }

        } else {
          console.warn("⚠ Missing reasoning block");
        }

        console.log("CONFIDENCE:", t.confidence);
        console.log("LAST ASSESSMENT:", t.lastAssessment);

        console.groupEnd();
      });
    }

    /* ------------------------------------------------------------
       TARGET SUMMARY TABLE (FAST SCAN)
    ------------------------------------------------------------ */

    if (DEBUG) {
      console.debug("=== TARGET SUMMARY ===");

      console.table(
        Object.entries(G.amStrategy.targets).map(([id, t]) => ({
          id,
          objective: t.objective?.slice(0, 40),
          hasReasoning: !!t.reasoning,
          evidenceLen: t.reasoning?.evidence?.length || 0,
          whyNowLen: t.reasoning?.why_now?.length || 0
        }))
      );
    }

    /* ------------------------------------------------------------
       ACTIONS + STATE SNAPSHOT
    ------------------------------------------------------------ */

    if (DEBUG) {
      console.debug("ACTIONS CLEARED:");
      console.table(G.amStrategy.actions);

      console.debug("FULL STATE SNAPSHOT:", G.amStrategy);
    }

  } catch (err) {

    console.error("Strategy parser failed:", err.message);

    if (!G.amStrategy || !G.amStrategy.targets) {
      G.amStrategy = { targets: {}, actions: [] };
    }

    console.warn("Preserving previous strategy due to parse failure");
    return;
  }
}