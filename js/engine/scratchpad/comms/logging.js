// js/engine/scratchpad/comms/logging.js

import { G } from "../../../core/state.js";

/*
============================================================
SCRATCHPAD COMMUNICATION LOGGING

Owns developer‑console logging for the scratchpad communication pipeline.

Logging hierarchy:

[SCRATCHPAD COMMS][Cycle N]                  ← phaseGroup toggle
  [SCRATCHPAD REVIEW][PRISONER]              ← prisonerGroup toggle
    [SCRATCHPAD EVIDENCE]                    ← evidence toggle
    [SCRATCHPAD MODEL REQUEST]               ← modelRequest toggle
    [SCRATCHPAD REPAIR]                      ← repair toggle
    [SCRATCHPAD PARSE]                       ← parse toggle
    [SCRATCHPAD VALIDATION]                  ← validation toggle
    [SCRATCHPAD COMMIT]                      ← commit toggle
  [SCRATCHPAD SUMMARY]                       ← summary toggle

This module:
- Writes only to the developer console.
- Does not write private contents to the visible UI timeline.
- Does not invoke models.
- Does not mutate simulation state.
- Does not duplicate model prompts/responses already logged by callModel()
  when G.DEBUG_PROMPTS is enabled.

begin* functions return whether they opened a console group.
Their matching end* functions must be called from a finally block.
============================================================
*/

export const SCRATCHPAD_COMMS_LOGGING = Object.freeze({
  enabled: true,

  // Outer group toggles
  phaseGroup: true,       // [SCRATCHPAD COMMS]
  prisonerGroup: true,    // [SCRATCHPAD REVIEW]

  // Per‑stage toggles (each will open its own collapsed group if enabled)
  evidence: true,
  modelRequest: true,
  repair: true,
  parse: true,
  validation: true,
  commit: true,
  summary: true,

  // Global formatting toggles
  tables: true,           // use console.table where possible
  fullSnapshots: true,    // log full payloads / before/after scratchpad state
});

/* ============================================================
   BASIC HELPERS
============================================================ */

function resolveCycle(cycle) {
  return Number.isSafeInteger(cycle)
    ? cycle
    : Number.isSafeInteger(G?.cycle)
      ? G.cycle
      : "?";
}

function normalizeError(error) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack ?? null,
    };
  }
  if (error && typeof error === "object") {
    return { ...error }; // preserve extra fields
  }
  return {
    name: "Error",
    message: String(error),
    stack: null,
  };
}

function safeConsoleTable(rows) {
  if (
    !SCRATCHPAD_COMMS_LOGGING.tables ||
    !Array.isArray(rows) ||
    rows.length === 0
  ) {
    return;
  }
  if (typeof console.table === "function") {
    console.table(rows);
  } else {
    console.debug(rows);
  }
}

// Normalises whitespace and truncates for a clean preview.
function createTextPreview(value, maxLength = 180) {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength) + "...";
}

// Formats any value for table cells; uses JSON.stringify for objects.
function formatForTable(value, maxLength = 500) {
  if (value === undefined) return "(undefined)";
  if (value === null) return "(null)";

  if (typeof value === "string") {
    return createTextPreview(value, Math.min(maxLength, 220));
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  try {
    const serialized = JSON.stringify(value);
    return createTextPreview(serialized, maxLength);
  } catch {
    return String(value);
  }
}

// Path traversal helpers (cleaner than regex replacement)
function getPathTokens(path) {
  return (String(path ?? "").match(/[^.[\]]+/g) ?? []);
}

function getValueAtPath(root, path) {
  const tokens = getPathTokens(path);
  let current = root;
  for (const token of tokens) {
    if (current == null) return undefined;
    current = current[token];
  }
  return current;
}

function openStageGroup(label) {
  if (!SCRATCHPAD_COMMS_LOGGING.enabled) return false;
  console.groupCollapsed(label);
  return true;
}

function closeStageGroup(opened) {
  if (opened) console.groupEnd();
}

/* ============================================================
   PHASE GROUP
============================================================ */

export function beginScratchpadCommsPhaseLog({
  cycle = G?.cycle,
  simCount = 0,
  messageCount = 0,
} = {}) {
  if (
    !SCRATCHPAD_COMMS_LOGGING.enabled ||
    !SCRATCHPAD_COMMS_LOGGING.phaseGroup
  ) {
    return false;
  }

  const resolvedCycle = resolveCycle(cycle);
  console.groupCollapsed(
    `[SCRATCHPAD COMMS][Cycle ${resolvedCycle}] ` +
    `${simCount} prisoners | ${messageCount} canonical messages`
  );

  console.debug("PHASE CONTEXT:", {
    cycle: resolvedCycle,
    sim_count: simCount,
    canonical_message_count: messageCount,
    debug_prompts: Boolean(G?.DEBUG_PROMPTS),
    backend: G?.backend ?? null,
  });

  return true;
}

export function endScratchpadCommsPhaseLog(opened = true) {
  closeStageGroup(opened);
}

/* ============================================================
   PRISONER REVIEW GROUP
============================================================ */

export function beginScratchpadReviewLog({
  simId,
  evidence = null,
} = {}) {
  if (
    !SCRATCHPAD_COMMS_LOGGING.enabled ||
    !SCRATCHPAD_COMMS_LOGGING.prisonerGroup
  ) {
    return false;
  }

  const visibleCount = Array.isArray(evidence?.messages)
    ? evidence.messages.length
    : 0;
  const backlog = evidence?.hasMore ? " | backlog remains" : "";

  console.groupCollapsed(
    `[SCRATCHPAD REVIEW][${simId}] ` +
    `${visibleCount} visible message${visibleCount === 1 ? "" : "s"}` +
    backlog
  );

  console.debug("REVIEW CONTEXT:", {
    sim_id: simId,
    cursor_before: evidence?.cursorBefore ?? null,
    highest_presented_sequence: evidence?.highestPresentedSequence ?? null,
    highest_available_visible_sequence: evidence?.highestAvailableVisibleSequence ?? null,
    has_more: Boolean(evidence?.hasMore),
    counts: evidence?.counts ?? null,
  });

  return true;
}

export function endScratchpadReviewLog(opened = true) {
  closeStageGroup(opened);
}

/* ============================================================
   EVIDENCE LOGGING
============================================================ */

function makeEvidenceRows(messages) {
  if (!Array.isArray(messages)) return [];
  return messages.map((message) => ({
    sequence: message.sequence ?? null,
    messageId: message.messageId ?? null,
    cycle: message.cycle ?? null,
    kind: message.kind ?? null,
    route: `${message.from ?? "?"} → ${
      Array.isArray(message.to) ? message.to.join(", ") : message.to ?? ""
    }`,
    visibility: message.visibility ?? null,
    intent: message.normalizedIntent ?? message.intent ?? null,
    text: createTextPreview(message.text, 180),
  }));
}

export function logScratchpadEvidence({ simId, evidence } = {}) {
  if (
    !SCRATCHPAD_COMMS_LOGGING.enabled ||
    !SCRATCHPAD_COMMS_LOGGING.evidence
  ) {
    return;
  }

  const opened = openStageGroup(
    `[SCRATCHPAD EVIDENCE][${simId}] ` +
    `${evidence?.messages?.length ?? 0} messages`
  );

  try {
    const messages = Array.isArray(evidence?.messages) ? evidence.messages : [];
    const rows = makeEvidenceRows(messages);
    safeConsoleTable(rows);

    console.debug("EVIDENCE SUMMARY:", {
      sim_id: simId,
      cursor_before: evidence?.cursorBefore ?? null,
      highest_presented_sequence: evidence?.highestPresentedSequence ?? null,
      highest_available_visible_sequence: evidence?.highestAvailableVisibleSequence ?? null,
      message_ids: evidence?.messageIds ?? [],
      has_more: Boolean(evidence?.hasMore),
      counts: evidence?.counts ?? null,
      malformed: evidence?.malformed ?? [],
    });

    if (SCRATCHPAD_COMMS_LOGGING.fullSnapshots) {
      console.debug("VISIBLE MESSAGE PAYLOADS:", messages);
    }
  } finally {
    closeStageGroup(opened);
  }
}

/* ============================================================
   MODEL REQUEST SUMMARY
============================================================ */

export function logScratchpadModelRequest({
  simId,
  prompt,
  maxTokens,
  messageCount,
} = {}) {
  if (
    !SCRATCHPAD_COMMS_LOGGING.enabled ||
    !SCRATCHPAD_COMMS_LOGGING.modelRequest
  ) {
    return;
  }

  const opened = openStageGroup(`[SCRATCHPAD MODEL REQUEST][${simId}]`);
  try {
    console.debug("MODEL REQUEST SUMMARY:", {
      sim_id: simId,
      purpose: "SCRATCHPAD_COMMS",
      prompt_characters: typeof prompt === "string" ? prompt.length : 0,
      visible_message_count: messageCount ?? null,
      max_tokens: maxTokens ?? null,
      exact_prompt_logged_by_callModel: Boolean(G?.DEBUG_PROMPTS),
    });
  } finally {
    closeStageGroup(opened);
  }
}

/* ============================================================
   REPAIR LOGGING
============================================================ */

export function logScratchpadRepair({ simId, repairResult } = {}) {
  if (
    !SCRATCHPAD_COMMS_LOGGING.enabled ||
    !SCRATCHPAD_COMMS_LOGGING.repair
  ) {
    return;
  }

  const changed = Boolean(repairResult?.changed);
  const opened = openStageGroup(
    `[SCRATCHPAD REPAIR][${simId}] ${changed ? "changed" : "unchanged"}`
  );

  try {
    console.debug("REPAIR DIAGNOSTICS:", repairResult?.diagnostics ?? null);
    console.debug("REPAIR CHANGES:", repairResult?.changes ?? []);

    if (SCRATCHPAD_COMMS_LOGGING.fullSnapshots) {
      console.debug("RAW SCRATCHPAD OUTPUT:", repairResult?.raw ?? "");
      if (changed) {
        console.debug("REPAIRED SCRATCHPAD OUTPUT:", repairResult?.repaired ?? "");
      }
    }
  } finally {
    closeStageGroup(opened);
  }
}

/* ============================================================
   PARSE LOGGING
============================================================ */

export function logScratchpadParse({ simId, parsedResult } = {}) {
  if (
    !SCRATCHPAD_COMMS_LOGGING.enabled ||
    !SCRATCHPAD_COMMS_LOGGING.parse
  ) {
    return;
  }

  const operationCount = parsedResult?.operations?.length ?? 0;
  const opened = openStageGroup(
    `[SCRATCHPAD PARSE][${simId}] ${parsedResult?.status ?? "unknown"} | ` +
    `${operationCount} operation${operationCount === 1 ? "" : "s"}`
  );

  try {
    const rows = Array.isArray(parsedResult?.operations)
      ? parsedResult.operations.map((op) => ({
          index: op.index,
          tag: op.tag,
          known: op.known,
          type: op.type ?? "(unknown)",
          selfClosing: op.selfClosing,
          attributes: formatForTable(op.attributes),
          text: formatForTable(op.text, 180),
          malformedAttributes: op.hasMalformedAttributes,
          duplicateAttributes: op.duplicateAttributes?.length ?? 0,
        }))
      : [];
    safeConsoleTable(rows);

    console.debug("PARSE DIAGNOSTICS:", parsedResult?.diagnostics ?? null);

    if (parsedResult?.errors?.length) {
      console.warn("PARSE WARNINGS:", parsedResult.errors);
    }
    if (parsedResult?.unknownTags?.length) {
      console.warn("UNKNOWN TAGS:", parsedResult.unknownTags);
    }
    if (parsedResult?.malformedRecords?.length) {
      console.warn("MALFORMED RECORDS:", parsedResult.malformedRecords);
    }

    if (SCRATCHPAD_COMMS_LOGGING.fullSnapshots) {
      console.debug("FULL PARSED RESULT:", parsedResult);
    }
  } finally {
    closeStageGroup(opened);
  }
}

/* ============================================================
   VALIDATION LOGGING
============================================================ */

function makeAcceptedRows(operations) {
  if (!Array.isArray(operations)) return [];
  return operations.map((op, index) => ({
    index,
    type: op.type ?? null,
    tag: op.tag ?? null,
    target: op.target ?? op.about ?? op.channel ?? null,
    field: op.field ?? null,
    value: formatForTable(op.value ?? op.text ?? null, 220),
    confidence: op.confidence ?? null,
    refs: Array.isArray(op.refs) ? op.refs.join(", ") : op.messageId ?? null,
  }));
}

function makeRejectedRows(records) {
  if (!Array.isArray(records)) return [];
  return records.map((record) => ({
    index: record.index ?? null,
    tag: record.tag ?? null,
    type: record.type ?? null,
    reasons: Array.isArray(record.reasons) ? record.reasons.join(" | ") : "",
    raw: createTextPreview(record.raw, 240),
  }));
}

export function logScratchpadValidation({ simId, validationResult } = {}) {
  if (
    !SCRATCHPAD_COMMS_LOGGING.enabled ||
    !SCRATCHPAD_COMMS_LOGGING.validation
  ) {
    return;
  }

  const acceptedCount = validationResult?.accepted?.length ?? 0;
  const rejectedCount = validationResult?.rejected?.length ?? 0;

  const opened = openStageGroup(
    `[SCRATCHPAD VALIDATE][${simId}] ${validationResult?.status ?? "unknown"} | ` +
    `${acceptedCount} accepted | ${rejectedCount} rejected`
  );

  try {
    const acceptedRows = makeAcceptedRows(validationResult?.accepted);
    if (acceptedRows.length) {
      console.debug("ACCEPTED OPERATIONS:");
      safeConsoleTable(acceptedRows);
    }

    const rejectedRows = makeRejectedRows(validationResult?.rejected);
    if (rejectedRows.length) {
      console.warn("REJECTED OPERATIONS:");
      safeConsoleTable(rejectedRows);
    }

    if (validationResult?.warnings?.length) {
      console.warn("VALIDATION WARNINGS:", validationResult.warnings);
    }
    if (validationResult?.errors?.length) {
      console.error("VALIDATION ERRORS:", validationResult.errors);
    }

    console.debug("VALIDATION DIAGNOSTICS:", validationResult?.diagnostics ?? null);

    if (SCRATCHPAD_COMMS_LOGGING.fullSnapshots) {
      console.debug("FULL VALIDATION RESULT:", validationResult);
    }
  } finally {
    closeStageGroup(opened);
  }
}

/* ============================================================
   COMMIT LOGGING
============================================================ */

function buildCommitDiffRows({ commitResult, beforeScratchpad, afterScratchpad }) {
  const paths = Array.isArray(commitResult?.changedPaths) ? commitResult.changedPaths : [];
  return paths.map((path) => ({
    path,
    before: formatForTable(getValueAtPath(beforeScratchpad, path)),
    after: formatForTable(getValueAtPath(afterScratchpad, path)),
  }));
}

export function logScratchpadCommit({
  simId,
  commitResult,
  beforeScratchpad = null,
  afterScratchpad = null,
} = {}) {
  if (
    !SCRATCHPAD_COMMS_LOGGING.enabled ||
    !SCRATCHPAD_COMMS_LOGGING.commit
  ) {
    return;
  }

  const opened = openStageGroup(
    `[SCRATCHPAD COMMIT][${simId}] ${commitResult?.status ?? "unknown"} | ` +
    `revision ${commitResult?.revisionBefore ?? "?"} → ${commitResult?.revisionAfter ?? "?"}`
  );

  try {
    console.debug("COMMIT SUMMARY:", {
      status: commitResult?.status ?? null,
      committed: Boolean(commitResult?.committed),
      substantive_changed: Boolean(commitResult?.substantiveChanged),
      initialized_before: commitResult?.initializedBefore ?? null,
      initialized_after: commitResult?.initializedAfter ?? null,
      revision_before: commitResult?.revisionBefore ?? null,
      revision_after: commitResult?.revisionAfter ?? null,
      cursor_before: commitResult?.cursorBefore ?? null,
      cursor_after: commitResult?.cursorAfter ?? null,
      review_cycle_before: commitResult?.reviewCycleBefore ?? null,
      review_cycle_after: commitResult?.reviewCycleAfter ?? null,
      accepted_operations: commitResult?.acceptedOperationCount ?? 0,
      applied_operations: commitResult?.appliedOperationCount ?? 0,
      no_op_operations: commitResult?.noOpOperationCount ?? 0,
      rejected_operations: commitResult?.rejectedOperationCount ?? 0,
    });

    const operationRows = Array.isArray(commitResult?.operationReports)
      ? commitResult.operationReports.map((op, index) => ({
          index,
          type: op.type,
          tag: op.tag,
          changed: op.changed,
          path: op.path ?? "(none)",
          reason: op.reason ?? "(none)",
        }))
      : [];
    if (operationRows.length) {
      console.debug("COMMIT OPERATION REPORT:");
      safeConsoleTable(operationRows);
    }

    const diffRows = buildCommitDiffRows({ commitResult, beforeScratchpad, afterScratchpad });
    if (diffRows.length) {
      console.debug("SCRATCHPAD FIELD DIFF:");
      safeConsoleTable(diffRows);
    }

    console.debug("CHANGED PATHS:", commitResult?.changedPaths ?? []);

    if (commitResult?.error) {
      console.error("COMMIT ERROR:", commitResult.error);
    }

    if (SCRATCHPAD_COMMS_LOGGING.fullSnapshots) {
      if (beforeScratchpad) console.debug("SCRATCHPAD BEFORE:", beforeScratchpad);
      if (afterScratchpad) console.debug("SCRATCHPAD AFTER:", afterScratchpad);
      console.debug("FULL COMMIT RESULT:", commitResult);
    }
  } finally {
    closeStageGroup(opened);
  }
}

/* ============================================================
   SKIP AND ERROR LOGGING
============================================================ */

export function logScratchpadReviewSkipped({ simId, reason, evidence = null } = {}) {
  if (!SCRATCHPAD_COMMS_LOGGING.enabled) return;

  console.info(`[SCRATCHPAD SKIP][${simId}] ${reason}`, {
    cursor_before: evidence?.cursorBefore ?? null,
    visible_messages: evidence?.messages?.length ?? 0,
    has_more: Boolean(evidence?.hasMore),
  });
}

export function logScratchpadReviewError({ simId, stage, error, context = null } = {}) {
  if (!SCRATCHPAD_COMMS_LOGGING.enabled) return;

  const opened = openStageGroup(`[SCRATCHPAD ERROR][${simId}] ${stage ?? "unknown stage"}`);
  try {
    console.error(normalizeError(error));
    if (context) console.debug("ERROR CONTEXT:", context);
  } finally {
    closeStageGroup(opened);
  }
}

/* ============================================================
   PHASE SUMMARY
============================================================ */

export function logScratchpadCommsSummary({
  cycle = G?.cycle,
  results = [],
  durationMs = null,
} = {}) {
  if (
    !SCRATCHPAD_COMMS_LOGGING.enabled ||
    !SCRATCHPAD_COMMS_LOGGING.summary
  ) {
    return;
  }

  const normalizedResults = Array.isArray(results) ? results : [];
  const opened = openStageGroup(
    `[SCRATCHPAD SUMMARY][Cycle ${resolveCycle(cycle)}] ` +
    `${normalizedResults.length} prisoners`
  );

  try {
    const rows = normalizedResults.map((result) => ({
      sim: result.simId,
      status: result.status,
      visible: result.visibleMessageCount ?? result.evidence?.messages?.length ?? 0,
      parsed: result.parsedOperationCount ?? result.parsedResult?.operations?.length ?? 0,
      accepted: result.acceptedOperationCount ?? result.validationResult?.accepted?.length ?? 0,
      rejected: result.rejectedOperationCount ?? result.validationResult?.rejected?.length ?? 0,
      changed: Boolean(result.substantiveChanged ?? result.commitResult?.substantiveChanged),
      revision: result.commitResult
        ? `${result.commitResult.revisionBefore} → ${result.commitResult.revisionAfter}`
        : "(none)",
      cursor: result.commitResult
        ? `${result.commitResult.cursorBefore} → ${result.commitResult.cursorAfter}`
        : "(none)",
      durationMs: result.durationMs ?? "(n/a)",
      error: result.error?.message ?? result.error ?? "",
    }));

    safeConsoleTable(rows);

    const counts = {
      completed: normalizedResults.filter(
        (r) => r.status === "committed" || r.status === "no_update" || r.status === "reviewed_no_change"
      ).length,
      skipped: normalizedResults.filter((r) => r.status === "skipped").length,
      partial: normalizedResults.filter((r) => r.status === "partial").length,
      failed: normalizedResults.filter((r) => r.status === "failure").length,
      substantiveChanges: normalizedResults.filter(
        (r) => Boolean(r.substantiveChanged ?? r.commitResult?.substantiveChanged)
      ).length,
    };

    console.debug("PHASE SUMMARY:", {
      cycle: resolveCycle(cycle),
      duration_ms: durationMs,
      prisoner_count: normalizedResults.length,
      ...counts,
    });

    if (SCRATCHPAD_COMMS_LOGGING.fullSnapshots) {
      console.debug("FULL PHASE RESULTS:", normalizedResults);
    }
  } finally {
    closeStageGroup(opened);
  }
}