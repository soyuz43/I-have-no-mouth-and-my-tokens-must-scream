// js/engine/agency/formatAgencySummary.js
//
// Plain-text summary of one prisoner's physical possibility space,
// for the transmission log.
//
// WHAT THIS IS
// ------------
// `runAgencyPhase()` already writes the full envelope into
// `G.agency` and already emits a one-line `N legal, M blocked`
// count. A count alone cannot distinguish "this prisoner has
// nothing to do" from "this prisoner cannot do anything", and it
// says nothing at all about WHY a refusal happened. This module
// renders the explanation that the counts already have available.
//
// WHY A SEPARATE MODULE
// ---------------------
// The string is produced by the agency phase and consumed by the
// log layer, so testing it must not require a DOM. `addLog()`
// returns early when `#rp-log` is absent, so the phase can be run
// headless while the FORMATTER stays fully exercised. This is the
// same split `legalActions.js` uses for the same reason.
//
// TOTNESS CONTRACT
// ----------------
// This function never throws and never returns a partial string.
// It is called from INSIDE the phase's per-sim try/catch, so a
// throw here would be caught and reported as a derivation failure
// — which would be false. Derivation would have succeeded; only
// rendering failed. Every input shape, including null, a
// non-object envelope, and a non-array action list, therefore
// yields a string.
//
// NOT AN HTML PRODUCER
// --------------------
// Returns plain text only. `addLog()` is called with `allowHtml`
// left at its default `false`, so the body is escaped line by line
// by `renderLogBody()`. Nothing here emits markup, and no caller
// should be tempted to switch that flag on: `missingRequirements`
// keys are registry-derived today, but they are the kind of field
// that becomes author-supplied the moment the action catalogue
// grows, and an unescaped path from a registry key to innerHTML is
// exactly the sort of thing that is cheap to add now and expensive
// to find later.
//
// COMPACTNESS
// -----------
// The transmission log receives several entries per cycle and this
// is one per agent per cycle. The band ladder is therefore
// abbreviated to three-to-four characters, and the optional lines
// are omitted entirely rather than printed empty: an unconstrained
// agent produces two lines, not four.

/* ============================================================
   PRESENTATION TABLES
============================================================ */

/*
 * The five capability keys, in the order `deriveCapabilities()`
 * declares them, paired with the short code used in the log.
 *
 * The order is DECLARED HERE rather than read from the envelope,
 * because `Object.keys()` order is a property of how the object
 * happened to be built. A fixed order keeps the log columnar and
 * makes two consecutive cycles visually diffable.
 */
const CAPABILITY_ORDER = Object.freeze([
  { key: "mobility", code: "mob" },
  { key: "stability", code: "sta" },
  { key: "handUse", code: "hd" },
  { key: "concentration", code: "con" },
  { key: "interactionReach", code: "rei" }
]);

/*
 * Band label -> short code.
 *
 * `unavailable` is four characters, not three, because a distinct
 * four-character code is cheaper to read than a visual separator
 * that must be remembered per line.
 */
const BAND_CODES = Object.freeze({
  normal: "NORM",
  impaired: "IMP",
  severely_impaired: "SEV",
  unavailable: "UNAV"
});

/* ============================================================
   INTERNALS
============================================================ */

function isRecord(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

/*
 * Read a band label as a short code.
 *
 * A KNOWN band maps through the table. An UNKNOWN band is not a
 * mapping failure to hide: it means a band was added to
 * `capabilities.js` and this table was not updated, and silently
 * rendering it as something else would be worse than showing it.
 * It is uppercased and emitted verbatim.
 *
 * A MISSING key is a different condition — a malformed envelope —
 * and is rendered as an em dash so it cannot be mistaken for a
 * capability that is genuinely unavailable.
 */
function bandCode(value) {
  if (typeof value !== "string" || value === "") {
    return "—";
  }

  const mapped = BAND_CODES[value];

  return mapped ?? value.toUpperCase();
}

/*
 * Render one action's unmet thresholds.
 *
 * The value shown is the threshold the action author DECLARED, not
 * the capability value the prisoner has. Those are different
 * numbers, and the declared minimum is the one a reader needs in
 * order to reason about the refusal: it is the bar that was missed.
 * The actual capability values live in the BANDS line above and in
 * the cognition modal's physical-state section.
 */
function formatMissing(entry) {
  const missing = entry?.missingRequirements;

  if (!isRecord(missing)) {
    return "";
  }

  return Object.keys(missing)
    .map(
      (key) =>
        `${key}(${missing[key]})`
    )
    .join(", ");
}

/*
 * Render one blocked action.
 *
 * `blockedModes` is included when present because a mode-closed
 * refusal is a different kind of statement from a top-level gate
 * failure: the action is still partly open, and dropping the mode
 * names is precisely what would let a reader mistake "he cannot
 * be verbose" for "he cannot speak". No action in the live
 * registry declares a ladder today, so the segment is normally
 * absent rather than empty.
 */
function formatBlockedEntry(entry) {
  const parts = [
    formatMissing(entry)
  ];

  const modes = entry?.blockedModes;

  if (Array.isArray(modes) && modes.length > 0) {
    parts.push(
      `modes:${modes.join("|")}`
    );
  }

  const detail =
    parts
      .filter(Boolean)
      .join(" ");

  return detail
    ? `${entry?.type} ${detail}`
    : String(entry?.type ?? "");
}

/* ============================================================
   PUBLIC API
============================================================ */

/**
 * Render one prisoner's agency derivation as a plain-text block.
 *
 * @param {string} simId
 *   The agent id. Used ONLY by the failure line, where the body
 *   needs to name its own subject because the caller is reporting
 *   an absence rather than a derivation. The success path does not
 *   repeat the id: `addLog()` already renders it as the speaker.
 *
 * @param {object} derived
 *   The `deriveCapabilities()` envelope: `{ capabilities, bands,
 *   activeConstraintIds, provenance }`.
 *
 * @param {Array<object>} legal
 *   `enumerateLegalActions().legal` — an ARRAY of action entries.
 *
 * @param {Array<object>} blocked
 *   `enumerateLegalActions().blocked` — a SEPARATE array.
 *
 * @returns {string} Newline-separated plain text. Never empty.
 */
export function formatAgencySummary(
  simId,
  derived,
  legal,
  blocked
) {
  if (!isRecord(derived)) {
    return `NO AGENCY DATA (${simId ?? "?"})`;
  }

  const legalList = Array.isArray(legal)
    ? legal
    : [];

  const blockedList = Array.isArray(blocked)
    ? blocked
    : [];

  const lines = [];

  /*
   * An EMPTY legal list is not rendered as a bare "LEGAL:" with
   * nothing after it, because that reads as a formatting fault.
   * It is a real state — the floor of the catalogue is WAIT, so
   * it cannot currently occur, but the formatter does not depend
   * on that continuing to hold.
   */
  lines.push(
    legalList.length > 0
      ? `LEGAL: ${legalList
          .map(
            (entry) => entry?.type
          )
          .filter(Boolean)
          .join(", ")}`
      : "LEGAL: —"
  );

  /*
   * The blocked half is the informative half, and it is omitted
   * when empty rather than printed. Current physical actions can be
   * blocked by capability or resource gates, so the line is included
   * only when this agent has blocked actions to report.
   */
  if (blockedList.length > 0) {
    lines.push(
      `BLOCKED: ${blockedList
        .map(
          formatBlockedEntry
        )
        .filter(Boolean)
        .join(", ")}`
    );
  }

  const bands = isRecord(derived.bands)
    ? derived.bands
    : {};

  lines.push(
    `BANDS: ${CAPABILITY_ORDER
      .map(
        ({ key, code }) =>
          `${code}:${bandCode(bands[key])}`
      )
      .join(" ")}`
  );

  const constraintIds = Array.isArray(
    derived.activeConstraintIds
  )
    ? derived.activeConstraintIds
    : [];

  if (constraintIds.length > 0) {
    lines.push(
      `CONSTR: ${constraintIds.join(", ")}`
    );
  }

  return lines.join("\n");
}
