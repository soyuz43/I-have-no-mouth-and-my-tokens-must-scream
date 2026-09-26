// js/prompts/utils/scratchpadContextLog.js
//
// Developer-only observability logger for scratchpad prompt injection.
//
// Records, for a single prompt build, which scratchpad sections and field
// paths were supplied via formatCompactScratchpadContext* (outreach, reply)
// or formatJournalScratchpadContext (journal).
//
// Constraints (this is a purely additive observability slice):
// - Writes only to the developer console. No DOM access.
// - No UI, timeline, export, or persistent state writes.
// - No global state mutation.
// - No engine imports. It reads the existing G.DEBUG_PROMPTS flag only
//   through a small, injectable isEnabled callback so the module stays
//   decoupled from the engine and remains unit-testable.
// - Does not log private message bodies, question text, prediction text,
//   rationale, evidence text, or canonical truth. Only section names,
//   prisoner IDs, channel scopes, field keys, counts, and stable ids.
//
// The logger is disabled unless debugging is explicitly enabled. By
// default it honors the engine's G.DEBUG_PROMPTS flag; integrators may
// pass an explicit isEnabled override to force it on or off (used by
// tests).

const DEFAULT_IS_ENABLED = () => {
  try {
    return Boolean(
      globalThis.G && globalThis.G.DEBUG_PROMPTS === true
    );
  } catch {
    return false;
  }
};

const PREFIX = "[SCRATCHPAD CONTEXT]";

function safeConsoleLog(record) {
  if (
    typeof console !== "undefined" &&
    typeof console.debug === "function"
  ) {
    console.debug(PREFIX, record);
  }
}

/**
 * Log a structured record describing the scratchpad context injected
 * into a single prompt.
 *
 * Three call types are recognized, each pairing a formatter with the
 * prompt it feeds:
 * - "outreach": formatCompactScratchpadContextWithSections, all others
 * - "reply":    formatCompactScratchpadContextWithSections, one target
 * - "journal":  formatJournalScratchpadContext, self-directed
 *
 * The record shape is identical across all three; `callType` and
 * `targetId` are what distinguish them. Journal passes targetId "self"
 * because the journal has no recipient.
 *
 * @param {object} params
 * @param {"outreach"|"reply"|"journal"} params.callType
 * @param {string} params.simId
 * @param {string} params.targetId - reply target id, "all" for outreach,
 *   or "self" for journal
 * @param {Array<object>} params.sections - section descriptors from
 *   formatCompactScratchpadContextWithSections (outreach/reply) or
 *   formatJournalScratchpadContext (journal)
 * @param {Function} [params.isEnabled] - optional override for the enabled
 *   check (used by tests to force the logger on); defaults to the
 *   G.DEBUG_PROMPTS check.
 */
export function logScratchpadContextInjection({
  callType,
  simId,
  targetId,
  sections = [],
  isEnabled = DEFAULT_IS_ENABLED,
} = {}) {
  if (typeof isEnabled !== "function" || !isEnabled()) {
    return;
  }

  safeConsoleLog({
    callType,
    simId,
    targetId,
    sections,
  });
}
