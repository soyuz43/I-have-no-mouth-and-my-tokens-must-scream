// js/ui/agencyFormatter.js
//
// Physical-state section for the cognition modal.
//
// WHAT THIS IS
// ------------
// `runAgencyPhase()` derives what each prisoner's body can do and
// which actions that opens, and writes it to `G.agency`. The
// transmission log shows it as one compact line. The cognition
// modal currently shows only the SCRATCHPAD, so the body a mind is
// trapped in is invisible in the one view a reader opens to
// understand an agent.
//
// This module renders the derivation as a collapsible PHYSICAL
// STATE section using the same `cog-*` vocabulary as
// `cognitionFormatter.js`, so it sits inside that view without
// looking like a foreign widget.
//
// WHY THE BINDING CONSTRAINT IS COMPUTED HERE
// -------------------------------------------
// `blocked[]` entries say WHAT was missing: `missingRequirements`
// is `{ capability: threshold }`. They do not say WHICH restraint
// caused it. That link exists only in `provenance[]`, which records
// each active constraint's `contributedCapabilities`.
//
// Attributing a refusal to a constraint is therefore a join, and it
// is the single most useful fact in this section: "OBSERVE closed
// because concentration 0.2 < 0.5" is a statistic, whereas "it
// closed because he is in the chair" is a cause. The join is
// derived, never stored, so it is recomputed on every render from
// the two structures the phase already produced.
//
// WHY THE ATTRIBUTION CAN FAIL, AND WHAT IT DOES THEN
// ----------------------------------------------------
// `contributedCapabilities[key]` is the value ONE constraint
// contributes. The envelope's `capabilities[key]` is the MINIMUM
// across all of them (max-restriction-wins in
// `capabilities.js`). The constraint that actually binds is
// therefore the one whose contribution EQUALS the envelope value.
//
// `missingRequirements` holds a THRESHOLD, not the capability
// value, so the envelope's own value is the only comparable number
// and the join key is `capabilities[key]`. That is exact float
// equality, which is safe here for a specific reason: the envelope
// value is assigned BY REFERENCE from one of the contributions
// (`if (candidate < capabilities[key]) capabilities[key] = candidate`),
// so the winning value is the identical number, not a recomputation
// of it. A tolerance would introduce its own ambiguity for no gain.
//
// The join can legitimately fail — an unknown constraint id
// contributes no restriction but still appears in
// `activeConstraintIds`, and an unrestrained capability has no
// contributing constraint at all. In that case the section reports
// the refusal WITHOUT a cause rather than attributing it to a
// constraint that did not cause it. A wrong cause is worse than an
// absent one.
//
// STRICTLY READ-ONLY
// -----------------
// Reads `G.agency` and returns a string. Never mutates the
// envelope, and never reads anything that is not already public.

import { G } from "../core/state.js";
import { escapeHtml } from "../core/utils.js";

/* ============================================================
   PRESENTATION TABLES
============================================================ */

/*
 * The five capability keys, in the order `deriveCapabilities()`
 * declares them, with the display label used here.
 *
 * `camelCase` becomes a human label rather than snake_case: this
 * section is read by a person, not parsed, and the surrounding
 * `cog-*` components are human-facing too. The raw key is
 * preserved in the BINDING line, because that line is a technical
 * claim and must be greppable against the action registry.
 */
const CAPABILITY_ROWS = Object.freeze([
  { key: "mobility", label: "Mobility" },
  { key: "stability", label: "Stability" },
  { key: "handUse", label: "Hand Use" },
  { key: "concentration", label: "Concentration" },
  {
    key: "interactionReach",
    label: "Interaction Reach"
  }
]);

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

function asArray(value) {
  return Array.isArray(value)
    ? value
    : [];
}

/*
 * Format a capability float for display.
 *
 * Two decimals, matching `cognitionOverview.js`'s
 * `formatNumber(value, 1)` convention closely enough to sit beside
 * it without a visible mismatch, and narrow enough that the
 * difference between 0.2 and 0.1 is still legible.
 */
function formatCapability(value) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return "—";
  }

  return numeric.toFixed(2);
}

/*
 * Render a band label with underscores replaced by spaces.
 *
 * The band vocabulary is fixed and machine-authored; the
 * underscores are a serialization artifact, not something a
 * reader should have to translate.
 */
function formatBand(value) {
  if (typeof value !== "string" || value === "") {
    return "—";
  }

  return escapeHtml(
    value.replace(/_/g, " ")
  );
}

/*
 * A width percentage for the capability meter.
 *
 * Clamped rather than trusted: the value originates in
 * `capabilities.js`, but this is a rendering path and a negative
 * or over-100 width would be a layout fault rather than a
 * legible degradation.
 */
function meterWidth(value) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return 0;
  }

  return Math.max(
    0,
    Math.min(100, numeric * 100)
  );
}

/*
 * Find the active constraint responsible for a capability being at
 * its current value.
 *
 * Returns the matching `provenance` entry, or `null` when no
 * single constraint can be named. See the module header for why
 * the join is exact and why returning `null` is the honest
 * failure.
 */
function bindingConstraintFor(
  capabilityKey,
  derived
) {
  const capabilities = isRecord(
    derived?.capabilities
  )
    ? derived.capabilities
    : {};

  const provenance = asArray(derived?.provenance);

  const current = capabilities[capabilityKey];

  if (!Number.isFinite(Number(current))) {
    return null;
  }

  for (const entry of provenance) {
    const contributed = entry?.contributedCapabilities;

    if (!isRecord(contributed)) {
      continue;
    }

    const value = contributed[capabilityKey];

    /*
     * Reference/value equality, not a tolerance. See the module
     * header: the envelope value IS the winning contribution, so
     * any tolerance here would only ever match a near-miss.
     */
    if (value === current) {
      return entry;
    }
  }

  return null;
}

/*
 * Render one blocked action and, where nameable, the constraint
 * that closed it.
 */
function blockedRow(entry, derived) {
  const type = entry?.type ?? "?";

  const missing = isRecord(entry?.missingRequirements)
    ? entry.missingRequirements
    : {};

  const reasons = Object.keys(missing).map(
    (key) => {
      const required = missing[key];
      const actual =
        derived?.capabilities?.[key];

      const binding =
        bindingConstraintFor(
          key,
          derived
        );

      const threshold =
        `<span class="cog-number">${escapeHtml(required)}</span>`;

      const observed =
        Number.isFinite(Number(actual))
          ? (
            " (has " +
            escapeHtml(
              formatCapability(actual)
            ) +
            ")"
          )
          : "";

      const cause =
        binding?.constraintId
          ? (
            " → " +
            escapeHtml(binding.constraintId)
          )
          : "";

      return (
        escapeHtml(key) +
        " needs " +
        threshold +
        observed +
        cause
      );
    }
  );

  const modes = asArray(entry?.blockedModes);

  const modeNote =
    modes.length > 0
      ? (
        '<div class="cog-list">' +
        "closed modes: " +
        escapeHtml(
          modes.join(", ")
        ) +
        "</div>"
      )
      : "";

  const reasonLine =
    reasons.length > 0
      ? (
        '<div class="cog-text">' +
        reasons.join("<br>") +
        "</div>"
      )
      : (
        '<div class="cog-null">' +
        "no unmet requirement recorded" +
        "</div>"
      );

  return `
    <div class="cog-record">
      <div class="cog-evidence-key">${escapeHtml(type)}</div>
      ${reasonLine}
      ${modeNote}
    </div>
  `;
}

function legalRow(entry) {
  const modes = asArray(entry?.availableModes);

  const modeNote =
    modes.length > 0
      ? (
        " (" +
        escapeHtml(modes.join(", ")) +
        ")"
      )
      : "";

  return `
    <div class="cog-record">
      <div class="cog-evidence-key">${escapeHtml(
    entry?.type ?? "?"
  )}</div>
      <div class="cog-text">cost ${escapeHtml(entry?.cost ?? 0)}${modeNote}</div>
    </div>
  `;
}

function constraintRow(entry) {
  return `
    <div class="cog-record">
      <div class="cog-evidence-key">${escapeHtml(
    entry?.constraintId ?? "?"
  )}</div>
      <div class="cog-text">${escapeHtml(
    entry?.title ?? "untitled restraint"
  )}</div>
    </div>
  `;
}

/* ============================================================
   PUBLIC API
============================================================ */

/**
 * Render one agent's physical possibility space.
 *
 * @param {string} simId
 * @returns {string} HTML. Empty string when the agent has no
 *   derivation for this cycle.
 */
export function formatAgencyStateForDisplay(
  simId
) {
  const derived = G?.agency?.capabilities?.[simId];

  if (!isRecord(derived)) {
    /*
     * An explicit "no data" state rather than an empty string.
     * Silence in this panel would be indistinguishable from a
     * rendering failure, and a reader who cannot tell those apart
     * will conclude the prisoner is unconstrained.
     */
    return `
      <div class="cog-empty">
        NO PHYSICAL STATE DERIVED FOR ${escapeHtml(simId ?? "?")} THIS CYCLE
      </div>
    `;
  }

  const capabilities = isRecord(derived.capabilities)
    ? derived.capabilities
    : {};

  const bands = isRecord(derived.bands)
    ? derived.bands
    : {};

  const legal = asArray(G?.agency?.legalActions?.[simId]);
  const blocked = asArray(
    G?.agency?.blockedActions?.[simId]
  );
  const provenance = asArray(derived.provenance);

  const capabilityRows =
    CAPABILITY_ROWS.map(
      ({ key, label }) => {
        const value = capabilities[key];
        const width = meterWidth(value);

        return `
          <div class="cog-field">
            <div class="cog-field-label">${escapeHtml(label)}</div>
            <div class="cog-field-value">
              <span class="cog-number">${escapeHtml(
          formatCapability(value)
        )}</span>
              — ${formatBand(bands[key])}
              <div class="sb-bar">
                <div class="sb-fill" style="width:${width}%"></div>
              </div>
            </div>
          </div>
        `;
      }
    ).join("");

  const actionSection = `
    <div class="cog-subsection">
      <div class="cog-subsection-summary">
        <span class="cog-tag cog-tag--sub">actions</span>
      </div>
      <div class="cog-subsection-body">
        <div class="cog-field">
          <div class="cog-field-label">legal (${legal.length})</div>
          <div class="cog-field-value">
            ${
      legal.length > 0
        ? legal.map(legalRow).join("")
        : '<div class="cog-null">NONE</div>'
    }
          </div>
        </div>

        <div class="cog-field">
          <div class="cog-field-label">blocked (${blocked.length})</div>
          <div class="cog-field-value">
            ${
      blocked.length > 0
        ? blocked
            .map(
              (entry) =>
                blockedRow(entry, derived)
            )
            .join("")
        : '<div class="cog-null">NONE</div>'
    }
          </div>
        </div>
      </div>
    </div>
  `;

  const constraintSection =
    provenance.length > 0
      ? `
        <div class="cog-subsection">
          <div class="cog-subsection-summary">
            <span class="cog-tag cog-tag--sub">active_constraints</span>
          </div>
          <div class="cog-subsection-body">
            ${provenance
              .map(constraintRow)
              .join("")}
          </div>
        </div>
      `
      : '<div class="cog-null">NO ACTIVE RESTRAINTS</div>';

  return `
    <details class="cog-section" open>
      <summary class="cog-section-summary">
        <span class="cog-tag">physical_state</span>
      </summary>
      <div class="cog-section-body">
        <div class="cog-field-grid">
          ${capabilityRows}
        </div>

        ${actionSection}
        ${constraintSection}

        <div class="cog-close-tag">&lt;/physical_state&gt;</div>
      </div>
    </details>
  `;
}
