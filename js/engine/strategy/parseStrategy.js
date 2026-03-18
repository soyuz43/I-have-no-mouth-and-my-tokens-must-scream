// js\engine\strategy\parseStrategy.js
import { G } from "../../core/state.js";
import { SIM_IDS } from "../../core/constants.js";

/* ============================================================
   AM STRATEGY PARSER (PRODUCTION HARDENED)

   Designed for LLM-generated plans where formatting may drift.

   Features:
   • tolerant of punctuation drift
   • tolerant of markdown formatting
   • tolerant of bullet lists
   • case insensitive parsing
   • block-based parsing (more stable than line state machines)
   • automatic missing-target recovery
   • strong debug output
   ============================================================ */

export function parseStrategyDeclarations(text) {

  if (!text || typeof text !== "string") {
    console.warn("Strategy parser: empty or invalid plan text.");
    return;
  }

  /* ------------------------------------------------------------
     ENSURE GLOBAL STRUCTURE
  ------------------------------------------------------------ */

  if (!G.amStrategy) {
    G.amStrategy = {};
  }

  G.amStrategy.targets = {};
  G.amStrategy.relationships = {};
  G.amStrategy.group = [];

  /* ------------------------------------------------------------
     NORMALIZE TEXT
     Remove formatting artifacts common in LLM output
  ------------------------------------------------------------ */

  const normalized = text
    .replace(/\r/g, "")
    .replace(/\*\*/g, "")          // markdown bold
    .replace(/__/g, "")
    .replace(/`/g, "")
    .replace(/\t/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .trim();

  if (!normalized.length) {
    console.warn("Strategy parser: normalized text empty.");
    return;
  }

  /* ------------------------------------------------------------
     SPLIT INTO TARGET BLOCKS
     More reliable than regex anchors – split on the word TARGET
     and reattach the keyword to each block.
  ------------------------------------------------------------ */

  const rawBlocks = normalized.split(/\bTARGET\b/gi);
  const targetBlocks = rawBlocks
    .slice(1)                     // discard everything before first TARGET
    .map(b => "TARGET " + b);     // restore the keyword for parsing

  for (const block of targetBlocks) {

    /* ------------------------------------------------------------
       TARGET EXTRACTION
    ------------------------------------------------------------ */

    const targetMatch = block.match(
     /TARGET[\s:\-→]*([A-Z0-9_]+)/i
    );
    
    if (!targetMatch) continue;

    const id = targetMatch[1].toUpperCase();

    if (!SIM_IDS.includes(id)) continue;

    /* ------------------------------------------------------------
       OBJECTIVE EXTRACTION (with bullet strip)
    ------------------------------------------------------------ */

    const objectiveMatch = block.match(
      /OBJECTIVE\s*[:=-]?\s*([^\n\r]+)/i
    );

    const objective = objectiveMatch
      ? objectiveMatch[1].trim().replace(/^[-*•]\s*/, '')
      : "";

    /* ------------------------------------------------------------
       HYPOTHESIS EXTRACTION (with bullet strip)
    ------------------------------------------------------------ */

    const hypothesisMatch = block.match(
      /HYPOTHESIS\s*[:=-]?\s*([^\n\r]+)/i
    );

    const hypothesis = hypothesisMatch
      ? hypothesisMatch[1].trim().replace(/^[-*•]\s*/, '')
      : "";

    /* ------------------------------------------------------------
       OPTIONAL CONFIDENCE EXTRACTION
       If a specific confidence is provided, use it; otherwise default to 0.5
    ------------------------------------------------------------ */

    const confidenceMatch = block.match(
      /CONFIDENCE\s*[:=-]?\s*([0-9.]+)/i
    );

    let confidence = 0.5;
    if (confidenceMatch) {
      const parsed = parseFloat(confidenceMatch[1]);
      if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) {
        confidence = parsed;
      }
    }

    /* ------------------------------------------------------------
       CREATE STRATEGY ENTRY
    ------------------------------------------------------------ */

    G.amStrategy.targets[id] = {
      objective,
      hypothesis,
      confidence,
      lastAssessment: "",
      cycle: G.cycle
    };

  }

  /* ------------------------------------------------------------
     RELATIONSHIP STRATEGIES (OPTIONAL)
  ------------------------------------------------------------ */

  const relationshipMatches = normalized.matchAll(
    /RELATIONSHIP\s*[:=-]?\s*([A-Za-z]+)\s*→\s*([A-Za-z]+)/gi
  );

  for (const match of relationshipMatches) {

    const a = match[1].toUpperCase();
    const b = match[2].toUpperCase();

    if (!SIM_IDS.includes(a) || !SIM_IDS.includes(b)) continue;

    const key = `${a}→${b}`;

    G.amStrategy.relationships[key] = {
      objective: "",
      cycle: G.cycle
    };

  }

  /* ------------------------------------------------------------
     GROUP OBJECTIVES
  ------------------------------------------------------------ */

  const groupMatches = normalized.matchAll(
    /GROUP[\s\S]*?OBJECTIVE\s*[:=-]?\s*([^\n\r]+)/gi
  );

  for (const match of groupMatches) {

    const objective = match[1].trim();

    G.amStrategy.group.push({
      objective,
      cycle: G.cycle
    });

  }

  /* ------------------------------------------------------------
     VALIDATION
  ------------------------------------------------------------ */

  const parsedTargets = Object.keys(G.amStrategy.targets);

  if (parsedTargets.length === 0) {

    console.warn(
      "Strategy parser: No TARGET blocks detected.",
      normalized.slice(0, 500)
    );

    return;

  }

  /* ------------------------------------------------------------
     MISSING FIELD WARNINGS
  ------------------------------------------------------------ */

  for (const [id, strat] of Object.entries(G.amStrategy.targets)) {

    if (!strat.objective) {
      console.warn(`Strategy parser: ${id} missing OBJECTIVE`);
    }

    if (!strat.hypothesis) {
      console.warn(`Strategy parser: ${id} missing HYPOTHESIS`);
    }

  }

  /* ------------------------------------------------------------
     OPTIONAL RECOVERY
     If AM forgot a prisoner, create a neutral strategy
  ------------------------------------------------------------ */

  for (const id of SIM_IDS) {

    if (!G.amStrategy.targets[id]) {

      G.amStrategy.targets[id] = {
        objective: "(no objective declared)",
        hypothesis: "(none)",
        confidence: 0.3,
        lastAssessment: "",
        cycle: G.cycle
      };

    }

  }

  /* ------------------------------------------------------------
     DEBUG OUTPUT
  ------------------------------------------------------------ */

  console.log("[STRATEGY PARSED]", {
    targets: G.amStrategy.targets,
    relationships: G.amStrategy.relationships,
    group: G.amStrategy.group
  });

  console.table(G.amStrategy.targets);

}