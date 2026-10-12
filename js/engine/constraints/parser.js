import { CONSTRAINT_MAP } from "./definitions.js";
import { levenshtein } from "../strategy/extractors/levenshtein.js";

/* ============================================================
   CONSTRAINT PARSER (AM → EXECUTION)
   ============================================================ */

function normalizeConstraintId(rawId) {
  return String(rawId ?? "")
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

const CONSTRAINT_NONE_VARIANTS = new Set([
  "constraint_none",
  "none",
  "no_constraint",
  "skip",
  "null",
  "empty",
  "default"
]);

function isConstraintNone(text) {
  const normalized =
    normalizeConstraintId(text);

  return CONSTRAINT_NONE_VARIANTS.has(normalized);
}

function parseConstraintRecord(rawLine) {
  const line = String(rawLine ?? "").trim();
  const headerMatch = line.match(
    /^CONSTRAINT(?:\s*[:_]\s*|\s+)(.*)$/i
  );

  if (!headerMatch) {
    return { status: "malformed" };
  }

  const payload = headerMatch[1].trim();

  if (
    isConstraintNone(payload) ||
    isConstraintNone(line)
  ) {
    return { status: "none" };
  }

  const metadataMatch = payload.match(
    /\b(?:DURATION|INTENSITY)(?=\s*:?\s*[+-]?\d|\b)/i
  );
  const rawId = payload
    .slice(0, metadataMatch?.index ?? payload.length)
    .replace(/^(?:CONSTRAINT(?:_|\s*)APPLY|APPLY)\s*:?\s*/i, "")
    .trim();
  const normalizedId = normalizeConstraintId(rawId);

  if (!normalizedId) {
    return {
      status: "malformed",
      rawId
    };
  }

  const knownIds = Object.keys(CONSTRAINT_MAP);
  let matchedId = normalizedId;
  let bestMatch = null;
  let bestDistance = Infinity;
  let fuzzy = false;

  if (!CONSTRAINT_MAP[normalizedId]) {
    for (const candidateId of knownIds) {
      const distance = levenshtein(
        normalizedId,
        candidateId
      );

      if (distance < bestDistance) {
        bestDistance = distance;
        bestMatch = candidateId;
      }
    }

    const omittedIngSuffix =
      bestMatch &&
      normalizedId === bestMatch.replace(/ing(?=_|$)/g, "");

    if (
      bestMatch &&
      (bestDistance <= 2 ||
        (omittedIngSuffix && bestDistance <= 3))
    ) {
      matchedId = bestMatch;
      fuzzy = true;
    } else {
      return {
        status: "malformed",
        rawId,
        bestDistance,
        bestMatch
      };
    }
  }

  function readBoundedInteger(keyword, maximum) {
    const match = line.match(
      new RegExp(`\\b${keyword}\\s*:?\\s*([+-]?\\d+(?:\\.\\d+)?)`, "i")
    );
    const parsed = match ? Number(match[1]) : 1;
    const value = Number.isInteger(parsed) ? parsed : 1;

    return Math.min(maximum, Math.max(1, value));
  }

  return {
    status: "apply",
    id: matchedId,
    rawId,
    fuzzy,
    bestDistance,
    duration: readBoundedInteger("DURATION", 6),
    intensity: readBoundedInteger("INTENSITY", 3)
  };
}

export function extractConstraintsFromText(
  input,
  { cycle, resolveTargetId }
) {
  const lines = String(input || "")
    .replace(/\r/g, "")
    .split("\n");

  const map = {};

  let activeTargetId = null;
  let pendingConstraint = null;
  let constraintSeenForTarget = false;

  function flushPendingConstraint() {
    if (
      !activeTargetId ||
      !pendingConstraint
    ) {
      pendingConstraint = null;
      return;
    }

    const parsed =
      parseConstraintRecord(pendingConstraint);

    if (parsed.status === "none") {
      console.debug(
        "[CONSTRAINT] NONE detected, skipping line:",
        pendingConstraint
      );

      pendingConstraint = null;
      return;
    }

    if (parsed.status !== "apply") {
      console.warn(
        "[CONSTRAINT PARSER] malformed constraint, skipping",
        {
          target: activeTargetId,
          raw: pendingConstraint,
          bestDistance: parsed.bestDistance,
          bestMatch: parsed.bestMatch
        }
      );

      pendingConstraint = null;
      return;
    }

    if (parsed.fuzzy) {
      console.debug(
        "[CONSTRAINT PARSER] fuzzy match: '%s' → '%s' (distance: %d)",
        parsed.rawId,
        parsed.id,
        parsed.bestDistance
      );
    }

    map[activeTargetId] ??= [];

    map[activeTargetId].push({
      id: parsed.id,
      duration: parsed.duration,
      remaining: parsed.duration,
      intensity: parsed.intensity,
      source: "AM",
      appliedAt: cycle
    });

    console.debug(
      "[CONSTRAINT PARSED]",
      {
        target: activeTargetId,
        id: parsed.id,
        duration: parsed.duration,
        intensity: parsed.intensity
      }
    );

    pendingConstraint = null;
  }

  for (const rawLine of lines) {
    const line =
      rawLine.trim();

    if (!line) continue;

    const openingMatch = line.match(
      /^\[\s*TARGET\s*:\s*([a-zA-Z0-9_-]+)\s*\]$/i
    );

    if (openingMatch) {
      /*
       * Recover the preceding block if the model omitted
       * [/TARGET] before beginning another target.
       */
      flushPendingConstraint();

      activeTargetId =
        resolveTargetId(
          openingMatch[1]
        );

      constraintSeenForTarget = false;

      if (!activeTargetId) {
        console.warn(
          "[CONSTRAINT PARSER] invalid target block, skipping",
          {
            raw: openingMatch[1],
            line
          }
        );
      }

      continue;
    }

    if (
      /^\[\s*\/\s*TARGET\s*\]$/i
        .test(line)
    ) {
      flushPendingConstraint();

      activeTargetId = null;
      constraintSeenForTarget = false;

      continue;
    }

    if (!activeTargetId) {
      continue;
    }

    if (
      /^CONSTRAINT(?:\s*[:_]\s*|\s+)/i
        .test(line)
    ) {
      if (constraintSeenForTarget) {
        console.warn(
          "[CONSTRAINT PARSER] duplicate constraint line, skipping",
          {
            target: activeTargetId,
            line
          }
        );

        continue;
      }

      constraintSeenForTarget = true;
      pendingConstraint = line;

      continue;
    }

    /*
     * Permit the model to wrap DURATION and INTENSITY onto
     * separate lines, but never carry them outside the current
     * target block.
     */
    if (
      pendingConstraint &&
      /^(?:DURATION|INTENSITY)\s*:?\s*[+-]?\d/i
        .test(line)
    ) {
      pendingConstraint =
        `${pendingConstraint} ${line}`;
    }
  }

  /*
   * Recover the final block if the model omitted
   * its closing [/TARGET] marker.
   */
  flushPendingConstraint();

  console.debug(
    "[CONSTRAINT MAP BUILT]",
    JSON.parse(
      JSON.stringify(map)
    )
  );

  return map;
}
