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

  const namePattern = SIM_IDS.join("|");

  const normalized = text

    // --- normalize arrow + name → TARGET ---
    .replace(
      new RegExp(`→\\s*(?:TARGET\\s*)?(${namePattern})\\s*:`, "gi"),
      (_, name) => `→ TARGET: ${name.toUpperCase()}`
    )

    // --- normalize "TARGET name" → "TARGET: NAME" ---
    .replace(
      new RegExp(`TARGET\\s+(${namePattern})`, "gi"),
      (_, name) => `TARGET: ${name.toUpperCase()}`
    )

    // --- normalize label casing ---
    .replace(/target:/gi, "TARGET:")
    .replace(/objective:/gi, "OBJECTIVE:")
    .replace(/hypothesis:/gi, "HYPOTHESIS:")

    // --- normalize arrow variants (optional but useful) ---
    .replace(/->/g, "→")

    // --- existing cleanup ---
    .replace(/\r/g, "")
    .replace(/\*\*/g, "")
    .replace(/__/g, "")
    .replace(/`/g, "")
    .replace(/\t/g, " ")
    .replace(/[ ]{2,}/g, " ")

    .replace(/\u00A0/g, " ")
    .replace(/：/g, ":")
    .replace(/–|—/g, "-")
    .replace(/[^\x20-\x7E\n]/g, "")
    .replace(/^[\-\*\•]\s*/gm, "")

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
const targetBlocks =
  normalized.match(/(?:^|\n)\s*TARGET[\s\S]*?(?=(?:\n\s*TARGET)|$)/gi) || [];

  for (const rawBlock of targetBlocks) {

    // HARD NORMALIZE PER BLOCK (critical)
    const block = rawBlock
      .replace(/\u00A0/g, " ")
      .replace(/：/g, ":")
      .replace(/–|—/g, "-")
      .replace(/[^\x20-\x7E\n]/g, "")
      .trim();

    /* ------------------------------------------------------------
       STRUCTURE GATE (production-grade)
       Reject blocks that are not actual strategy declarations
    ------------------------------------------------------------ */

    const hasStructure =
      /OBJECTIVE/i.test(block) ||
      /HYPOTHESIS/i.test(block);

    if (!hasStructure) continue;

    /* ------------------------------------------------------------
       TARGET EXTRACTION (very tolerant)
    ------------------------------------------------------------ */

    const targetMatch = block.match(
      /TARGET[^A-Z0-9]*([A-Z0-9_]+(?:\s*,\s*[A-Z0-9_]+)*)/i
    );

    if (!targetMatch) continue;
    const rawIds = targetMatch[1]
      .split(",")
      .map(x => x.trim().toUpperCase())
      .filter(Boolean);

    // --- HANDLE GROUP TARGET ---
    if (rawIds.includes("ALL")) {
      for (const simId of SIM_IDS) {
        G.amStrategy.targets[simId] ??= {
          objective: "(group-derived)",
          hypothesis: "(group-derived)",
          confidence: 0.4,
          lastAssessment: "",
          cycle: G.cycle
        };
      }
      continue;
    }

    // --- FILTER VALID TARGETS ---
    const validIds = rawIds.filter(id => SIM_IDS.includes(id));

    if (validIds.length === 0) continue;


    const objectiveMatch = block.match(
      /OBJECTIVE[^A-Z0-9]*([\s\S]*?)(?=HYPOTHESIS|TARGET|$)/i
    );

    const hypothesisMatch = block.match(
      /HYPOTHESIS[^A-Z0-9]*([\s\S]*?)(?=TARGET|GROUP|$)/i
    );
    // VECTOR (optional extraction)
    const vectorMatch = block.match(
      /VECTOR[^A-Z0-9]*([^\n\r]+)/i
    );

    let vector = "";

    if (vectorMatch) {
      vector = vectorMatch[1].trim();
    }

    // OBJECTIVE
    let objective = "";

    if (objectiveMatch) {
      const lines = objectiveMatch[1]
        .split("\n")
        .map(l => l.trim())
        .filter(Boolean);

      objective = (lines[0] || "")
        .replace(/^[-*•\s>]+/, "")
        .trim();
    }

    // HYPOTHESIS
    let hypothesis = "";

    if (hypothesisMatch) {
      const lines = hypothesisMatch[1]
        .split("\n")
        .map(l => l.trim())
        .filter(Boolean);

      hypothesis = (lines[0] || "")
        .replace(/^[-*•\s>]+/, "")
        .trim();
    }

    // --- FALLBACK: infer hypothesis from OBJECTIVE block ---
    if (!hypothesis && objectiveMatch) {
      const lines = objectiveMatch[1]
        .split("\n")
        .map(l => l.trim())
        .filter(Boolean);

     
      const remainder = lines
        .slice(1)
        .filter(l =>
          !/^(ACTION|VECTOR|TARGET|EFFECT|RESULT)/i.test(l)
        )
        .join(" ");

      if (remainder.length > 10) {
        hypothesis = remainder.slice(0, 120);
      }
    }
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

    for (const id of validIds) {

      if (!objective) {
        console.warn(`[STRATEGY PARSE] ${id} missing OBJECTIVE`, block);
      }

      if (!hypothesis) {
        console.warn(`[STRATEGY PARSE] ${id} missing HYPOTHESIS`, block);
      }

      G.amStrategy.targets[id] = {
        ...G.amStrategy.targets[id],
        objective,
        hypothesis,
        confidence,
        lastAssessment: G.amStrategy.targets[id]?.lastAssessment || "",
        cycle: G.cycle
      };

    }

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