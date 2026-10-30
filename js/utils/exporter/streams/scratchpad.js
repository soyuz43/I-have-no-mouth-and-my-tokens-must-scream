// js/utils/exporter/streams/scratchpad.js
//
// The Scratchpad Review export stream.
//
// WHAT THIS STREAM IS
// -------------------
// A per-prisoner, per-cycle audit of scratchpad review outcomes. One
// record describes the review invocation: the evidence window, the
// model request when one was made, every accepted and rejected
// operation, the committed paths, and the revision movement.
//
// WHY IT IS PER-CYCLE
// -------------------
// The review results are produced during the communication phase and
// cannot otherwise survive to finalizeCycle(). They are carried in
// G.pendingEvidence.scratchpadReviewLog for exactly one cycle and are
// reset with the other pending-evidence channels. This stream writes
// only records whose cycle matches the cycle being exported, so a
// stale carrier cannot leak into the wrong export file.

import { Exporter } from "../state.js";
import { attachRecordMeta } from "../metadata.js";
import { cloneValue } from "../format.js";

/*
 * The review audit log for one cycle, in prisoner review order.
 */
export function recordScratchpadReviews(G, cycle) {
  const reviews = Array.isArray(
    G?.pendingEvidence?.scratchpadReviewLog
  )
    ? G.pendingEvidence.scratchpadReviewLog
    : [];

  for (const review of reviews) {
    if (!review || review.cycle !== cycle) continue;

    Exporter.buffers.scratchpad.push(attachRecordMeta({
      sim_id: review.simId ?? null,
      cycle: review.cycle ?? null,
      status: review.status ?? null,
      stage: review.stage ?? null,
      reason: review.reason ?? null,
      model_invoked: Boolean(review.modelInvoked),
      model_id: review.modelId ?? null,
      model_request: cloneValue(review.modelRequest ?? {}),
      visible_message_count: review.visibleMessageCount ?? 0,
      evidence_message_ids: cloneValue(review.messageIds ?? []),

      /*
       * The agency events the accepted operations actually cited.
       *
       * A researcher can compare this against
       * `evidence_message_ids` to tell a scratchpad update that was
       * driven by an engine-resolved action outcome apart from one
       * that was driven by a conversation.
       */
      referenced_agency_event_ids: cloneValue(
        review.referencedAgencyEventIds ?? []
      ),

      cursor_before: review.cursorBefore ?? null,
      cursor_after: review.cursorAfter ?? null,
      parsed_operation_count: review.parsedOperationCount ?? 0,
      accepted_operation_count: review.acceptedOperationCount ?? 0,
      rejected_operation_count: review.rejectedOperationCount ?? 0,
      substantive_changed: Boolean(review.substantiveChanged),
      revision_before: review.revisionBefore ?? null,
      revision_after: review.revisionAfter ?? null,
      changed_paths: cloneValue(review.changedPaths ?? []),
      operation_reports: cloneValue(review.operationReports ?? []),
      accepted_operations: cloneValue(review.acceptedOperations ?? []),
      rejected_operations: cloneValue(review.rejectedOperations ?? []),
      evidence: cloneValue(
        review.evidence == null
          ? {}
          : Object.fromEntries(
            Object.entries(review.evidence).filter(
              ([key]) => key !== "messageIdSet"
            )
          )
      ),
      repair_result: cloneValue(review.repairResult ?? {}),
      parsed_result: cloneValue(review.parsedResult ?? {}),
      validation_result: cloneValue(review.validationResult ?? {}),
      commit_result: cloneValue(review.commitResult ?? {}),
      duration_ms: review.durationMs ?? null,
      error: cloneValue(review.error ?? {})
    }, cycle));
  }
}
