// js/engine/state/extract.js
//
// State Extraction Layer
//
// Responsibilities:
// 1. Parse structured data from LLM output
// 2. Normalize harmless formatting and spelling errors
// 3. Recover critical fields from partially malformed JSON
// 4. Convert raw model output into sanitized state updates
//
// This layer performs NO state mutation.
// It only extracts, normalizes, sanitizes, and returns data.

import {
  signedDeltaFromDirectionMagnitude,
  coerceLegacyDelta
} from "../../core/utils.js";

import { levenshtein } from "../strategy/extractors/levenshtein.js";

import { safeExtractJSON } from "./utils/safeExtract.js";
import { fallbackExtractBeliefDeltas } from "./utils/fallbackBeliefs.js";
import { safeExtractFields } from "./utils/fieldExtract.js";
import { G } from "../../core/state.js";
import {
  sanitizeBeliefDeltas,
  sanitizeDrives,
  sanitizeAnchors
} from "./sanitize.js";
import { createExtractionTrace } from "./utils/extractionTrace.js";
/* ============================================================
   CONSTANTS
   ============================================================ */

const MAX_STAT_DELTA = 8;
const BELIEF_EVIDENCE_SCALE = 0.85;

// ------------------------------------------------------------------
// Module‑level variable to communicate the parse method used inside
// parseBeliefUpdates.  Set by parseBeliefUpdates; read by the wrapper.
// ------------------------------------------------------------------
let _lastBeliefParseMethod = "none";

const CANONICAL_STAT_FIELDS = Object.freeze([
  "suffering_direction",
  "suffering_magnitude",
  "hope_direction",
  "hope_magnitude",
  "sanity_direction",
  "sanity_magnitude",
  "suffering_delta",
  "hope_delta",
  "sanity_delta"
]);

const CANONICAL_STAT_FIELD_SET = new Set(
  CANONICAL_STAT_FIELDS
);

const EXPLICIT_STAT_FIELD_ALIASES = new Map([
  ["suffer_direction", "suffering_direction"],
  ["suffer_magnitude", "suffering_magnitude"],
  ["suffer_delta", "suffering_delta"]
]);

const VALID_STAT_DIRECTIONS = new Set([
  "increased",
  "decreased",
  "unchanged"
]);

const STAT_DIRECTION_ALIASES = new Map([
  ["increase", "increased"],
  ["increases", "increased"],
  ["increasing", "increased"],
  ["up", "increased"],
  ["higher", "increased"],

  ["decrease", "decreased"],
  ["decreases", "decreased"],
  ["decreasing", "decreased"],
  ["down", "decreased"],
  ["lower", "decreased"],

  ["same", "unchanged"],
  ["stable", "unchanged"],
  ["no change", "unchanged"],
  ["unchanged", "unchanged"],
  ["unobserved", "unchanged"],
  ["unclear", "unchanged"],
  ["unknown", "unchanged"],
  ["none", "unchanged"]
]);

const FIELD_MATCH_RANK = Object.freeze({
  exact: 0,
  alias: 1,
  fuzzy: 2
});

/* ============================================================
   GENERIC HELPERS
   ============================================================ */

function hasOwn(object, key) {
  return Boolean(
    object &&
    Object.prototype.hasOwnProperty.call(object, key)
  );
}

function getDebugBeliefForensics() {
  return Boolean(
    globalThis?.G?.DEBUG_BELIEF_FORENSICS
  );
}

function parseExplicitFiniteNumber(raw) {
  if (typeof raw === "number") {
    return Number.isFinite(raw)
      ? raw
      : null;
  }

  if (typeof raw !== "string") {
    return null;
  }

  const normalized = raw.trim();

  if (
    !/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(
      normalized
    )
  ) {
    return null;
  }

  const value = Number(normalized);

  return Number.isFinite(value)
    ? value
    : null;
}

function parseAbsoluteBeliefValue(raw) {
  if (
    typeof raw !== "number" &&
    typeof raw !== "string"
  ) {
    return null;
  }

  let normalized = String(raw).trim();
  let explicitPercent = false;

  if (normalized.endsWith("%")) {
    explicitPercent = true;
    normalized = normalized.slice(0, -1).trim();
  }

  const numeric = parseExplicitFiniteNumber(normalized);

  if (numeric === null) {
    return null;
  }

  let value = numeric;

  if (explicitPercent || Math.abs(value) > 1) {
    value /= 100;
  }

  if (
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  ) {
    return null;
  }

  return value;
}

/* ============================================================
   STAT FIELD KEY NORMALIZATION
   ============================================================ */

function normalizeStatFieldShape(rawKey) {
  if (typeof rawKey !== "string") {
    return null;
  }

  return rawKey
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

/**
 * Resolve a stat field against the closed set of supported fields.
 *
 * Resolution order:
 * 1. Exact normalized key
 * 2. Explicit known alias
 * 3. Unique Levenshtein match within two edits
 *
 * The function returns null rather than guessing when a match is
 * insufficiently close or ambiguous.
 */
function resolveStatFieldKey(rawKey) {
  const normalized = normalizeStatFieldShape(rawKey);

  if (!normalized) {
    return null;
  }

  if (CANONICAL_STAT_FIELD_SET.has(normalized)) {
    return {
      canonicalKey: normalized,
      normalizedKey: normalized,
      matchType: "exact",
      distance: 0
    };
  }

  const explicitAlias =
    EXPLICIT_STAT_FIELD_ALIASES.get(normalized);

  if (explicitAlias) {
    return {
      canonicalKey: explicitAlias,
      normalizedKey: normalized,
      matchType: "alias",
      distance: levenshtein(
        normalized,
        explicitAlias
      )
    };
  }

  const candidates = CANONICAL_STAT_FIELDS
    .map((canonicalKey) => ({
      canonicalKey,
      distance: levenshtein(
        normalized,
        canonicalKey
      )
    }))
    .sort((a, b) => a.distance - b.distance);

  const best = candidates[0];
  const secondBest = candidates[1];

  if (!best) {
    return null;
  }

  const MAX_DISTANCE = 2;
  const MIN_WIN_MARGIN = 2;

  const closeEnough =
    best.distance <= MAX_DISTANCE;

  const uniqueEnough =
    !secondBest ||
    secondBest.distance - best.distance >=
    MIN_WIN_MARGIN;

  if (!closeEnough || !uniqueEnough) {
    return null;
  }

  return {
    canonicalKey: best.canonicalKey,
    normalizedKey: normalized,
    matchType: "fuzzy",
    distance: best.distance
  };
}

function compareFieldCandidates(a, b) {
  const rankA =
    FIELD_MATCH_RANK[a.matchType] ?? 99;

  const rankB =
    FIELD_MATCH_RANK[b.matchType] ?? 99;

  if (rankA !== rankB) {
    return rankA - rankB;
  }

  return a.distance - b.distance;
}

/**
 * Normalize only recognized top-level stat fields.
 *
 * Canonical keys always take precedence over malformed aliases.
 * Unknown fields remain untouched and are never guessed.
 */
function normalizeKnownStatFields(
  object,
  simId = "UNKNOWN"
) {
  if (
    !object ||
    typeof object !== "object" ||
    Array.isArray(object)
  ) {
    return object;
  }

  const normalizedObject = { ...object };
  const selected = new Map();
  const repairRows = [];
  const rejectedRows = [];

  for (const [rawKey, value] of Object.entries(object)) {
    const resolved = resolveStatFieldKey(rawKey);

    if (!resolved) {
      continue;
    }

    const candidate = {
      ...resolved,
      rawKey,
      value
    };

    const existing =
      selected.get(resolved.canonicalKey);

    if (
      !existing ||
      compareFieldCandidates(
        candidate,
        existing
      ) < 0
    ) {
      if (existing) {
        rejectedRows.push({
          rawKey: existing.rawKey,
          canonicalKey:
            existing.canonicalKey,
          reason:
            "superseded_by_better_match"
        });
      }

      selected.set(
        resolved.canonicalKey,
        candidate
      );
    } else {
      rejectedRows.push({
        rawKey,
        canonicalKey:
          resolved.canonicalKey,
        reason:
          "conflicting_or_weaker_alias"
      });
    }
  }

  for (const candidate of selected.values()) {
    const {
      rawKey,
      canonicalKey,
      value,
      matchType,
      distance
    } = candidate;

    normalizedObject[canonicalKey] = value;

    if (rawKey !== canonicalKey) {
      repairRows.push({
        rawKey,
        canonicalKey,
        matchType,
        distance
      });
    }
  }

  if (repairRows.length) {
    console.warn(
      `[parseStatDeltas] normalized malformed stat fields for ${simId}`,
      repairRows
    );
  }

  if (
    rejectedRows.length &&
    getDebugBeliefForensics()
  ) {
    console.debug(
      `[parseStatDeltas] ignored conflicting stat aliases for ${simId}`,
      rejectedRows
    );
  }

  return normalizedObject;
}

/* ============================================================
   STAT VALUE NORMALIZATION
   ============================================================ */

function normalizeStatDirection(rawDirection) {
  if (typeof rawDirection !== "string") {
    return null;
  }

  const normalized = rawDirection
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");

  if (VALID_STAT_DIRECTIONS.has(normalized)) {
    return normalized;
  }

  return (
    STAT_DIRECTION_ALIASES.get(normalized) ??
    null
  );
}

function parseStatDeltaPair(object, statName) {
  if (
    !object ||
    typeof object !== "object"
  ) {
    return null;
  }

  const directionKey =
    `${statName}_direction`;

  const magnitudeKey =
    `${statName}_magnitude`;

  if (!hasOwn(object, directionKey)) {
    return null;
  }

  const direction = normalizeStatDirection(
    object[directionKey]
  );

  if (!direction) {
    return null;
  }

  if (
    direction === "unchanged" &&
    !hasOwn(object, magnitudeKey)
  ) {
    return 0;
  }

  if (!hasOwn(object, magnitudeKey)) {
    return null;
  }

  const magnitude = parseExplicitFiniteNumber(
    object[magnitudeKey]
  );

  if (magnitude === null) {
    return null;
  }

  const delta =
    signedDeltaFromDirectionMagnitude(
      direction,
      Math.abs(magnitude)
    );

  return Number.isFinite(delta)
    ? delta
    : null;
}

function parseLegacyStatDelta(object, statName) {
  if (
    !object ||
    typeof object !== "object"
  ) {
    return null;
  }

  const key = `${statName}_delta`;

  if (!hasOwn(object, key)) {
    return null;
  }

  const delta = coerceLegacyDelta(
    object[key]
  );

  return Number.isFinite(delta)
    ? delta
    : null;
}

/* ============================================================
   TEXT-LEVEL STAT FIELD RECOVERY
   ============================================================ */

/**
 * Extract JSON-like scalar key/value pairs from malformed text.
 *
 * Only keys resolving to recognized stat fields are retained.
 * This permits recovery from malformed JSON without accepting
 * arbitrary model-generated fields.
 */
function extractLooseStatFieldsFromText(
  text,
  simId = "UNKNOWN"
) {
  const source = String(text || "");
  const selected = new Map();
  const repairRows = [];

  const pairPattern =
    /(?:^|[,{]\s*|\n\s*)["']?([A-Za-z][A-Za-z0-9 _-]{1,48})["']?\s*:\s*(?:"([^"\r\n}]*)"|'([^'\r\n}]*)'|([+-]?(?:\d+(?:\.\d+)?|\.\d+))|([A-Za-z_ -]{2,32}))(?=\s*(?:,|}|\r?\n|$))/gim;

  let match;

  while (
    (match = pairPattern.exec(source)) !== null
  ) {
    const rawKey = match[1];

    const rawValue =
      match[2] ??
      match[3] ??
      match[4] ??
      match[5];

    const resolved = resolveStatFieldKey(rawKey);

    if (!resolved) {
      continue;
    }

    const candidate = {
      ...resolved,
      rawKey,
      value:
        typeof rawValue === "string"
          ? rawValue.trim()
          : rawValue
    };

    const existing =
      selected.get(resolved.canonicalKey);

    if (
      !existing ||
      compareFieldCandidates(
        candidate,
        existing
      ) < 0
    ) {
      selected.set(
        resolved.canonicalKey,
        candidate
      );
    }
  }

  const fields = {};

  for (const candidate of selected.values()) {
    fields[candidate.canonicalKey] =
      candidate.value;

    if (
      candidate.rawKey !==
      candidate.canonicalKey
    ) {
      repairRows.push({
        rawKey: candidate.rawKey,
        canonicalKey:
          candidate.canonicalKey,
        matchType:
          candidate.matchType,
        distance:
          candidate.distance
      });
    }
  }

  if (repairRows.length) {
    console.warn(
      `[parseStatDeltas] recovered malformed text fields for ${simId}`,
      repairRows
    );
  }

  return fields;
}

function extractStatDeltasFromText(
  text,
  simId = "UNKNOWN"
) {
  const fields =
    extractLooseStatFieldsFromText(
      text,
      simId
    );

  let suffering =
    parseStatDeltaPair(
      fields,
      "suffering"
    );

  let hope =
    parseStatDeltaPair(
      fields,
      "hope"
    );

  let sanity =
    parseStatDeltaPair(
      fields,
      "sanity"
    );

  if (suffering === null) {
    suffering =
      parseLegacyStatDelta(
        fields,
        "suffering"
      );
  }

  if (hope === null) {
    hope =
      parseLegacyStatDelta(
        fields,
        "hope"
      );
  }

  if (sanity === null) {
    sanity =
      parseLegacyStatDelta(
        fields,
        "sanity"
      );
  }

  return {
    suffering,
    hope,
    sanity
  };
}

/* ============================================================
   BELIEF SANITIZATION + SCALING
   ============================================================ */

function sanitizeAndScaleBeliefDeltas(
  raw,
  sim,
  {
    inputScale = "percent_points",
    multiplier = BELIEF_EVIDENCE_SCALE,
    source = "unknown"
  } = {}
) {
  const simId =
    sim?.id ?? "UNKNOWN";

  const sanitized =
    sanitizeBeliefDeltas(raw, {
      simId,
      DEBUG:
        getDebugBeliefForensics(),
      inputScale
    });

  if (!sanitized) {
    return null;
  }

  const scaled = {};

  for (
    const [key, delta] of
    Object.entries(sanitized)
  ) {
    if (!Number.isFinite(delta)) {
      continue;
    }

    const finalDelta =
      delta * multiplier;

    if (!Number.isFinite(finalDelta)) {
      continue;
    }

    scaled[key] = finalDelta;
  }

  if (!Object.keys(scaled).length) {
    return null;
  }

  if (getDebugBeliefForensics()) {
    console.debug(
      `[parseBeliefUpdates] sanitized ${source} belief deltas for ${simId}`,
      {
        inputScale,
        multiplier,
        raw,
        sanitized,
        scaled
      }
    );
  }

  return scaled;
}

/* ============================================================
   STAT DELTA PARSER
   ============================================================ */

export function parseStatDeltas(text, sim) {
  const simId =
    sim?.id ?? "UNKNOWN";

  const extractedObject =
    safeExtractJSON(text);

  const object =
    normalizeKnownStatFields(
      extractedObject,
      simId
    );

  let suffering = null;
  let hope = null;
  let sanity = null;
  let usedFallback = false;   // <-- NEW: track if text-level fallback was used

  if (object) {
    suffering =
      parseStatDeltaPair(
        object,
        "suffering"
      );

    hope =
      parseStatDeltaPair(
        object,
        "hope"
      );

    sanity =
      parseStatDeltaPair(
        object,
        "sanity"
      );

    if (suffering === null) {
      suffering =
        parseLegacyStatDelta(
          object,
          "suffering"
        );
    }

    if (hope === null) {
      hope =
        parseLegacyStatDelta(
          object,
          "hope"
        );
    }

    if (sanity === null) {
      sanity =
        parseLegacyStatDelta(
          object,
          "sanity"
        );
    }
  }

  if (
    suffering === null ||
    hope === null ||
    sanity === null
  ) {
    const fallback =
      extractStatDeltasFromText(
        text,
        simId
      );

    const before = {
      suffering,
      hope,
      sanity
    };

    if (
      suffering === null &&
      fallback.suffering !== null
    ) {
      suffering = fallback.suffering;
      usedFallback = true;
    }

    if (
      hope === null &&
      fallback.hope !== null
    ) {
      hope = fallback.hope;
      usedFallback = true;
    }

    if (
      sanity === null &&
      fallback.sanity !== null
    ) {
      sanity = fallback.sanity;
      usedFallback = true;
    }

    const recovered =
      before.suffering !== suffering ||
      before.hope !== hope ||
      before.sanity !== sanity;

    if (recovered) {
      console.warn(
        `[parseStatDeltas] using safe field fallback for ${simId}`,
        {
          before,
          fallback,
          after: {
            suffering,
            hope,
            sanity
          }
        }
      );
    }
  }

  suffering = Number(
    suffering ?? 0
  );
  hope = Number(
    hope ?? 0
  );
  sanity = Number(
    sanity ?? 0
  );

  if (!Number.isFinite(suffering)) suffering = 0;
  if (!Number.isFinite(hope)) hope = 0;
  if (!Number.isFinite(sanity)) sanity = 0;

  suffering = Math.max(
    -MAX_STAT_DELTA,
    Math.min(MAX_STAT_DELTA, suffering)
  );
  hope = Math.max(
    -MAX_STAT_DELTA,
    Math.min(MAX_STAT_DELTA, hope)
  );
  sanity = Math.max(
    -MAX_STAT_DELTA,
    Math.min(MAX_STAT_DELTA, sanity)
  );

  // Determine parse method for observability
  const method = object
    ? (usedFallback ? "field_fallback" : "direct")
    : "none";

  return {
    suffering,
    hope,
    sanity,
    _parseMethod: method   // <-- NEW: internal flag consumed by the wrapper
  };
}

/* ============================================================
   BELIEF PARSER — WITH FORENSIC LOGGING
   ============================================================ */

export function parseBeliefUpdates(text, sim) {
  const simId =
    sim?.id ?? "UNKNOWN";

  const trace =
    createExtractionTrace(
      simId,
      "belief_deltas"
    );

  let partialFields;

  function getPartialFields() {
    if (partialFields === undefined) {
      trace.enter("FIELD_RECOVERY_READ");

      partialFields =
        safeExtractFields(text) ?? null;

      if (partialFields) {
        trace.success(
          "FIELD_RECOVERY_READ",
          {
            keys: Object.keys(
              partialFields
            ),
            hasBeliefDeltas:
              Boolean(
                partialFields
                  .belief_deltas
              ),
            hasDrives:
              Boolean(
                partialFields.drives
              ),
            hasAnchors:
              Boolean(
                partialFields.anchors
              ),
          }
        );
      } else {
        trace.failure(
          "FIELD_RECOVERY_READ"
        );
      }
    }

    return partialFields;
  }

  trace.enter("FULL_JSON_READ");

  const object =
    safeExtractJSON(text);

  if (object) {
    trace.success(
      "FULL_JSON_READ",
      {
        keys: Object.keys(object),
        hasBeliefDeltas:
          Boolean(
            object.belief_deltas
          ),
        hasBeliefs:
          Boolean(object.beliefs),
        hasDrives:
          Boolean(object.drives),
        hasAnchors:
          Boolean(object.anchors),
      }
    );

    console.debug(
      `[parseBeliefUpdates] Extracted JSON for ${simId}:`,
      object
    );
  } else {
    trace.failure(
      "FULL_JSON_READ"
    );

    console.warn(
      `[parseBeliefUpdates] full JSON extraction failed for ${simId}`
    );
  }

  if (getDebugBeliefForensics()) {
    const partial =
      object ?? getPartialFields() ?? {};

    console.debug(
      "[BELIEF DELTA][FORENSIC]",
      {
        sim: simId,
        cycle: globalThis?.G?.cycle,
        belief_deltas:
          partial.belief_deltas || {},
        reason:
          partial.reason || null,
        anchors:
          sanitizeAnchors(
            partial.anchors
          ) || [],
        drives:
          sanitizeDrives(
            partial.drives,
            simId
          ) || {},
        input_preview:
          String(text || "").slice(0, 200) +
          (
            String(text || "").length > 200
              ? "..."
              : ""
          )
      }
    );
  }

  // ------------------------------------------------------------
  // PRIMARY PATH: parsed belief_deltas from full JSON
  // ------------------------------------------------------------

  trace.enter(
    "PRIMARY_JSON_BELIEF_DELTAS"
  );

  const primaryUpdates =
    sanitizeAndScaleBeliefDeltas(
      object?.belief_deltas,
      sim,
      {
        inputScale: "percent_points",
        multiplier: BELIEF_EVIDENCE_SCALE,
        source: "primary_json"
      }
    );

  if (primaryUpdates) {
    const keys =
      Object.keys(primaryUpdates);

    trace.success(
      "PRIMARY_JSON_BELIEF_DELTAS",
      {
        keysRecovered: keys.length,
        keys
      }
    );

    trace.finish(
      "primary_json",
      {
        keysRecovered: keys.length
      }
    );

    console.debug(
      `[parseBeliefUpdates] Success: got ${keys.length} belief deltas for ${simId}`
    );

    _lastBeliefParseMethod =
      "primary_json";

    return primaryUpdates;
  }

  trace.failure(
    "PRIMARY_JSON_BELIEF_DELTAS"
  );

  // ------------------------------------------------------------
  // FIELD-LEVEL RECOVERY
  // ------------------------------------------------------------

  const partial =
    getPartialFields();

  trace.enter(
    "FIELD_RECOVERY_BELIEF_DELTAS"
  );

  const fieldRecoveredUpdates =
    sanitizeAndScaleBeliefDeltas(
      partial?.belief_deltas,
      sim,
      {
        inputScale: "percent_points",
        multiplier: BELIEF_EVIDENCE_SCALE,
        source: "field_recovery"
      }
    );

  if (fieldRecoveredUpdates) {
    const keys =
      Object.keys(
        fieldRecoveredUpdates
      );

    trace.success(
      "FIELD_RECOVERY_BELIEF_DELTAS",
      {
        keysRecovered: keys.length,
        keys
      }
    );

    trace.finish(
      "field_recovery",
      {
        keysRecovered: keys.length
      }
    );

    console.warn(
      `[parseBeliefUpdates] recovered belief_deltas via field extraction for ${simId}`
    );

    _lastBeliefParseMethod =
      "field_recovery";

    return fieldRecoveredUpdates;
  }

  trace.failure(
    "FIELD_RECOVERY_BELIEF_DELTAS"
  );

  // ------------------------------------------------------------
  // REGEX / BALANCED-BLOCK FALLBACK
  // ------------------------------------------------------------

  trace.enter(
    "BALANCED_BLOCK_FALLBACK_READ"
  );

  const fallback =
    fallbackExtractBeliefDeltas(
      text
    );

  if (fallback) {
    trace.success(
      "BALANCED_BLOCK_FALLBACK_READ",
      {
        keys: Object.keys(fallback)
      }
    );
  } else {
    trace.failure(
      "BALANCED_BLOCK_FALLBACK_READ"
    );
  }

  trace.enter(
    "BALANCED_BLOCK_FALLBACK_SANITIZE"
  );

  const fallbackUpdates =
    sanitizeAndScaleBeliefDeltas(
      fallback,
      sim,
      {
        inputScale: "percent_points",
        multiplier: BELIEF_EVIDENCE_SCALE,
        source: "belief_fallback"
      }
    );

  if (fallbackUpdates) {
    const keys =
      Object.keys(fallbackUpdates);

    trace.success(
      "BALANCED_BLOCK_FALLBACK_SANITIZE",
      {
        keysRecovered: keys.length,
        keys
      }
    );

    trace.finish(
      "belief_fallback",
      {
        keysRecovered: keys.length
      }
    );

    console.warn(
      `[parseBeliefUpdates] fallback extraction succeeded for ${simId}`
    );

    _lastBeliefParseMethod =
      "belief_fallback";

    return fallbackUpdates;
  }

  trace.failure(
    "BALANCED_BLOCK_FALLBACK_SANITIZE"
  );

  // ------------------------------------------------------------
  // LEGACY ABSOLUTE BELIEF FORMAT
  // ------------------------------------------------------------

  trace.enter(
    "ABSOLUTE_BELIEFS_CHECK"
  );

  const hasAbsoluteBeliefs =
    object?.beliefs &&
    typeof object.beliefs === "object" &&
    !Array.isArray(object.beliefs) &&
    sim?.beliefs &&
    typeof sim.beliefs === "object";

  if (hasAbsoluteBeliefs) {
    trace.success(
      "ABSOLUTE_BELIEFS_CHECK",
      {
        keys: Object.keys(
          object.beliefs
        )
      }
    );

    console.debug(
      `[parseBeliefUpdates] trying absolute beliefs for ${simId}`
    );

    const updatesFromAbsolute = {};

    for (
      const key
      of Object.keys(sim.beliefs)
    ) {
      if (
        !hasOwn(
          object.beliefs,
          key
        )
      ) {
        continue;
      }

      const newValue =
        parseAbsoluteBeliefValue(
          object.beliefs[key]
        );

      const currentValue =
        Number(
          sim.beliefs[key]
        );

      if (
        newValue === null ||
        !Number.isFinite(
          currentValue
        )
      ) {
        continue;
      }

      updatesFromAbsolute[key] =
        newValue - currentValue;
    }

    trace.enter(
      "ABSOLUTE_BELIEFS_SANITIZE"
    );

    const absoluteUpdates =
      sanitizeAndScaleBeliefDeltas(
        updatesFromAbsolute,
        sim,
        {
          inputScale: "normalized",
          multiplier: 1,
          source: "absolute_beliefs"
        }
      );

    if (absoluteUpdates) {
      const keys =
        Object.keys(
          absoluteUpdates
        );

      trace.success(
        "ABSOLUTE_BELIEFS_SANITIZE",
        {
          keysRecovered: keys.length,
          keys
        }
      );

      trace.finish(
        "absolute_beliefs",
        {
          keysRecovered: keys.length
        }
      );

      console.debug(
        `[parseBeliefUpdates] Success from absolute beliefs for ${simId}:`,
        absoluteUpdates
      );

      _lastBeliefParseMethod =
        "absolute_beliefs";

      return absoluteUpdates;
    }

    trace.failure(
      "ABSOLUTE_BELIEFS_SANITIZE"
    );
  } else {
    trace.failure(
      "ABSOLUTE_BELIEFS_CHECK"
    );
  }

  // ------------------------------------------------------------
  // EMPTY RESULT
  // ------------------------------------------------------------

  trace.finish(
    "none",
    {
      keysRecovered: 0
    }
  );

  console.warn(
    `[parseBeliefUpdates] no usable belief data for ${simId}; using empty deltas`,
    object ? Object.keys(object) : []
  );

  _lastBeliefParseMethod =
    "none";

  return {};
}

/* ============================================================
   DRIVE PARSER
   ============================================================ */

export function parseDriveUpdate(
  text,
  simId = "UNKNOWN"
) {
  const object =
    safeExtractJSON(text);

  const partial =
    object?.drives
      ? null
      : safeExtractFields(text);

  const structuredCandidate =
    object?.drives ??
    partial?.drives;

  if (structuredCandidate) {
    const sanitized =
      sanitizeDrives(
        structuredCandidate,
        simId
      );

    if (sanitized) {
      return sanitized;
    }
  }

  const primaryMatch =
    String(text || "").match(
      /^\s*Primary\s*:\s*(?:"([^"]*)"|'([^']*)'|([^\r\n]*))\s*$/im
    );

  const secondaryMatch =
    String(text || "").match(
      /^\s*Secondary\s*:\s*(?:"([^"]*)"|'([^']*)'|([^\r\n]*))\s*$/im
    );

  if (
    !primaryMatch &&
    !secondaryMatch
  ) {
    return null;
  }

  const primary =
    primaryMatch
      ? (
        primaryMatch[1] ??
        primaryMatch[2] ??
        primaryMatch[3] ??
        null
      )
      : null;

  const secondary =
    secondaryMatch
      ? (
        secondaryMatch[1] ??
        secondaryMatch[2] ??
        secondaryMatch[3] ??
        null
      )
      : null;

  return sanitizeDrives(
    {
      primary,
      secondary
    },
    simId
  );
}

/* ============================================================
   ANCHOR PARSER
   ============================================================ */

export function parseAnchorUpdate(text) {
  const object =
    safeExtractJSON(text);

  let partial = null;

  const objectHasAnchors =
    object &&
    hasOwn(object, "anchors");

  if (!objectHasAnchors) {
    partial =
      safeExtractFields(text);
  }

  const partialHasAnchors =
    partial &&
    hasOwn(partial, "anchors");

  if (
    objectHasAnchors ||
    partialHasAnchors
  ) {
    const candidate =
      objectHasAnchors
        ? object.anchors
        : partial.anchors;

    return sanitizeAnchors(candidate);
  }

  const anchorBlock =
    String(text || "").match(
      /Anchors(?:\s+After)?\s*:\s*([\s\S]+)$/i
    );

  if (!anchorBlock) {
    return null;
  }

  const anchors =
    anchorBlock[1]
      .split(/\r?\n/)
      .map((line) =>
        line
          .replace(
            /^\s*[-*]\s*/,
            ""
          )
          .trim()
      )
      .filter(Boolean);

  return sanitizeAnchors(anchors);
}

/* ============================================================
   EXTRACTION STATS ACCUMULATOR
   ============================================================ */

/**
 * Record a single extraction outcome for later analysis.
 *
 * @param {string} simId
 * @param {string} fieldType - e.g. "stats", "belief_deltas", "drives", "anchors"
 * @param {object} details
 * @param {string} details.parseMethod - "direct", "repair", "field_recovery", "fallback", "absolute", "none"
 * @param {number} details.durationMs  - wall‑clock time of the full extraction attempt
 * @param {number} details.keysRecovered - number of usable keys extracted
 * @param {number} details.cycle       - cycle number (default G.cycle)
 */
export function recordExtractionOutcome(simId, fieldType, details = {}) {
  if (!G || !G.extractionStats) return;

  const cycle = details.cycle ?? (G.cycle ?? 0);

  if (!G.extractionStats.cycles[cycle]) {
    G.extractionStats.cycles[cycle] = [];
  }

  G.extractionStats.cycles[cycle].push({
    simId,
    fieldType,
    parseMethod: details.parseMethod ?? "unknown",
    durationMs: details.durationMs ?? 0,
    keysRecovered: details.keysRecovered ?? 0,
    timestamp: Date.now()
  });
}

/* ============================================================
   STATS‑RECORDING WRAPPERS
   ============================================================ */

/**
 * Parse stat deltas and record extraction outcome.
 */
export function parseStatDeltasWithStats(text, sim) {
  const start = performance.now();
  const result = parseStatDeltas(text, sim);
  const duration = performance.now() - start;

  const keysRecovered =
    ["suffering", "hope", "sanity"].filter(
      (key) => result._parseMethod !== "none"
    ).length;

  recordExtractionOutcome(sim.id, "stats", {
    parseMethod: result._parseMethod ?? "direct",
    durationMs: Math.round(duration),
    keysRecovered
  });
  return result;
}

/**
 * Parse belief updates and record extraction outcome.
 * Uses the module‑level variable _lastBeliefParseMethod set by parseBeliefUpdates.
 */
export function parseBeliefUpdatesWithStats(text, sim) {
  const start = performance.now();
  const updates = parseBeliefUpdates(text, sim);
  const duration = performance.now() - start;

  recordExtractionOutcome(sim.id, "belief_deltas", {
    parseMethod: _lastBeliefParseMethod,
    durationMs: Math.round(duration),
    keysRecovered: Object.keys(updates).length
  });

  return updates;
}