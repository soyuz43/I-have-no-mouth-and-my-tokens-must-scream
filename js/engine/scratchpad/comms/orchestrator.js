// js/engine/scratchpad/comms/orchestrator.js

import { G } from "../../../core/state.js";
import { SIM_IDS } from "../../../core/constants.js";
import { timelineEvent } from "../../../ui/timeline.js";
import { callModel } from "../../../models/callModel.js";
import {
  buildScratchpadCommsPrompt,
} from "../../../prompts/scratchpadComms.js";
import { getAgencyEventsForReview } from "../../agency/events.js";
import { getFreshClaimDivergenceEntries } from "../../agency/claimLedger.js";

import {
  collectVisibleMessagesForScratchpad,
} from "./visibility.js";
import {
  repairScratchpadCommsOutput,
} from "./repair.js";
import {
  parseScratchpadCommsOutput,
} from "./parse.js";
import {
  validateScratchpadCommsOperations,
} from "./validate.js";
import {
  commitScratchpadCommsOperations,
} from "./commit.js";
import {
  beginScratchpadCommsPhaseLog,
  endScratchpadCommsPhaseLog,
  beginScratchpadReviewLog,
  endScratchpadReviewLog,
  logScratchpadEvidence,
  logScratchpadModelRequest,
  logScratchpadRepair,
  logScratchpadParse,
  logScratchpadValidation,
  logScratchpadCommit,
  logScratchpadReviewSkipped,
  logScratchpadReviewError,
  logScratchpadCommsSummary,
} from "./logging.js";

/*
============================================================
SCRATCHPAD COMMUNICATION ORCHESTRATOR

Runs private scratchpad maintenance after a canonical inter-sim
communication cycle has been persisted.

For each prisoner, sequentially:
1. Select only unreviewed messages visible to that prisoner.
2. Skip the model call when there is no new visible evidence.
3. Build the private communication-review prompt.
4. Invoke that prisoner's assigned model.
5. Repair structural output defects conservatively.
6. Parse the sparse XML-like operation stream.
7. Validate operations against the exact visible evidence set.
8. Commit accepted operations atomically.

Failure policy:
- One prisoner's failure does not abort reviews for other prisoners.
- Failed model, parse, validation, or commit work does not advance the
  failed prisoner's review cursor.
- Partially valid substantive output may commit accepted operations.
- Private scratchpad contents are logged only to the developer console.
============================================================
*/

export const SCRATCHPAD_COMMS_MAX_TOKENS = 1200;

const SCRATCHPAD_COMMS_PURPOSE =
  "SCRATCHPAD_COMMS";

const SCRATCHPAD_COMMS_USER_MESSAGE =
  "Review the visible communications and return scratchpad updates now.";

/* ============================================================
   GENERAL HELPERS
============================================================ */

function getClockMilliseconds() {
  if (
    typeof performance !== "undefined" &&
    typeof performance.now === "function"
  ) {
    return performance.now();
  }

  return Date.now();
}

function elapsedMilliseconds(startTime) {
  return (
    Math.round(
      (
        getClockMilliseconds() -
        startTime
      ) *
      100
    ) /
    100
  );
}

function normalizeSimId(simId) {
  return String(simId ?? "")
    .trim()
    .toUpperCase();
}

  /*
   * Per-cycle review audit carrier.
   *
   * The live review path is auditable to the console, but
   * finalizeCycle() runs later and cannot otherwise reach
   * per-prisoner review outcomes. This writes a deterministic
   * snapshot into G.pendingEvidence for the cycle exporter. It is
   * cleared at the start of the communication phase and reset by
   * resetCycleEvidence(), so it never grows across cycles. It observes
   * the review path and changes no review semantics.
   */
function appendScratchpadReviewLog(result, modelAudit = null) {
  const pendingEvidence = G.pendingEvidence;
  if (!pendingEvidence || typeof pendingEvidence !== "object") return;

  if (!Array.isArray(pendingEvidence.scratchpadReviewLog)) {
    pendingEvidence.scratchpadReviewLog = [];
  }

  pendingEvidence.scratchpadReviewLog.push({
    simId: result.simId,
    cycle: result.cycle,
    status: result.status,
    stage: result.stage,
    reason: result.reason ?? null,
    modelInvoked: Boolean(result.modelInvoked),
    modelId: modelAudit?.modelId ?? null,
    visibleMessageCount: result.visibleMessageCount ?? 0,
    messageIds: Array.isArray(result.evidence?.messageIds)
      ? [...result.evidence.messageIds]
      : [],
    cursorBefore: result.cursorBefore ?? null,
    cursorAfter: result.cursorAfter ?? null,
    parsedOperationCount: result.parsedOperationCount ?? 0,
    acceptedOperationCount: result.acceptedOperationCount ?? 0,
    rejectedOperationCount: result.rejectedOperationCount ?? 0,
    substantiveChanged: Boolean(result.substantiveChanged),
    revisionBefore: result.revisionBefore ?? null,
    revisionAfter: result.revisionAfter ?? null,
    changedPaths: result.commitResult?.changedPaths ?? [],
    operationReports: result.commitResult?.operationReports ?? [],
    acceptedOperations: result.validationResult?.accepted ?? [],
    rejectedOperations: result.validationResult?.rejected ?? [],
    evidence: cloneValue(
      result.evidence == null
        ? null
        : Object.fromEntries(
          Object.entries(result.evidence).filter(
            ([key]) => key !== "messageIdSet"
          )
        )
    ),
    modelRequest: cloneValue(modelAudit ?? null),
    repairResult: cloneValue(result.repairResult ?? null),
    parsedResult: cloneValue(result.parsedResult ?? null),
    validationResult: cloneValue(result.validationResult ?? null),
    commitResult: cloneValue(result.commitResult ?? null),
    durationMs: result.durationMs ?? null,
    /*
     * `makeFailureResult()` already normalizes the error into a plain
     * object, so an `instanceof Error` test never matches and every
     * failure would export without a name or a message. Copy the
     * normalized fields instead.
     */
    error: result.error != null
      ? {
          name: result.error.name ?? null,
          message: result.error.message ?? null
        }
      : null
  });
}

function normalizeCycle(cycle) {
  const numeric =
    Number(cycle);

  if (
    !Number.isSafeInteger(numeric) ||
    numeric < 0
  ) {
    throw new TypeError(
      "Scratchpad communication cycle must be a non-negative safe integer."
    );
  }

  return numeric;
}

function normalizeMaxTokens(maxTokens) {
  const numeric =
    Number(maxTokens);

  if (
    !Number.isSafeInteger(numeric) ||
    numeric < 1
  ) {
    throw new TypeError(
      "Scratchpad communication maxTokens must be a positive safe integer."
    );
  }

  return numeric;
}

function cloneValue(value) {
  if (
    typeof structuredClone ===
    "function"
  ) {
    try {
      return structuredClone(value);
    } catch {
      // Fall through to JSON cloning.
    }
  }

  return JSON.parse(
    JSON.stringify(value)
  );
}

/* ============================================================
   COGNITION UPDATE HIGHLIGHTS
   ------------------------------------------------------------
   Produces transient UI metadata from committed scratchpad paths.

   NEW:
   - a previously absent value was created;
   - an unset epistemic claim gained its first actual value;
   - a new collection record was appended.

   UPDATED:
   - an already populated claim or existing record changed.
============================================================ */

function getPathTokens(path) {
  return (
    String(path ?? "")
      .match(/[^.[\]]+/g) ??
    []
  );
}

function getValueAtPath(
  root,
  path
) {
  const tokens =
    getPathTokens(path);

  let current = root;

  for (const token of tokens) {
    if (
      current === null ||
      current === undefined
    ) {
      return undefined;
    }

    current =
      current[token];
  }

  return current;
}

function isRecord(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function isEpistemicClaimRecord(value) {
  return Boolean(
    isRecord(value) &&
    (
      "value" in value ||
      "confidence" in value ||
      "evidence" in value ||
      "rationale" in value
    )
  );
}

function hasStoredClaimValue(claim) {
  if (
    !isEpistemicClaimRecord(claim)
  ) {
    return false;
  }

  const value =
    claim.value;

  if (
    value === null ||
    value === undefined
  ) {
    return false;
  }

  if (
    typeof value === "string"
  ) {
    return value.trim().length > 0;
  }

  return true;
}

function isEmptyStoredValue(value) {
  return (
    value === null ||
    value === undefined ||
    (
      typeof value === "string" &&
      value.trim() === ""
    )
  );
}

function classifyCognitionChange(
  beforeValue,
  afterValue
) {
  if (
    isEpistemicClaimRecord(
      afterValue
    )
  ) {
    const existedBefore =
      hasStoredClaimValue(
        beforeValue
      );

    const existsAfter =
      hasStoredClaimValue(
        afterValue
      );

    if (
      !existedBefore &&
      existsAfter
    ) {
      return "new";
    }

    return "updated";
  }

  if (
    isEmptyStoredValue(
      beforeValue
    ) &&
    !isEmptyStoredValue(
      afterValue
    )
  ) {
    return "new";
  }

  return "updated";
}

function buildCognitionHighlightState({
  cycle,
  changedPaths,
  beforeScratchpad,
  afterScratchpad,
}) {
  const paths = [
    ...new Set(
      (
        Array.isArray(
          changedPaths
        )
          ? changedPaths
          : []
      )
        .map(
          (path) =>
            String(path ?? "")
              .trim()
        )
        .filter(Boolean)
    ),
  ];

  return {
    cycle,

    changes:
      paths.map((path) => {
        const beforeValue =
          getValueAtPath(
            beforeScratchpad,
            path
          );

        const afterValue =
          getValueAtPath(
            afterScratchpad,
            path
          );

        return {
          path,

          kind:
            classifyCognitionChange(
              beforeValue,
              afterValue
            ),
        };
      }),
  };
}

function mergeCognitionHighlightState(
  simId,
  incomingState
) {
  G.cognitionHighlights ??=
    Object.create(null);

  const existingState =
    G.cognitionHighlights[simId] &&
    typeof G.cognitionHighlights[
      simId
    ] === "object"
      ? G.cognitionHighlights[simId]
      : {
        cycle: null,
        changes: [],
      };

  const existingChanges =
    Array.isArray(
      existingState.changes
    )
      ? existingState.changes
      : [];

  const incomingChanges =
    Array.isArray(
      incomingState?.changes
    )
      ? incomingState.changes
      : [];

  const byPath =
    new Map();

  for (const change of existingChanges) {
    const path =
      String(
        change?.path ??
        ""
      ).trim();

    if (!path) {
      continue;
    }

    byPath.set(
      path,
      {
        path,

        kind:
          change?.kind === "new"
            ? "new"
            : "updated",
      }
    );
  }

  for (const change of incomingChanges) {
    const path =
      String(
        change?.path ??
        ""
      ).trim();

    if (!path) {
      continue;
    }

    const previous =
      byPath.get(path);

    /*
     * Preserve NEW until viewed. If an unread newly created value
     * changes again, it is still new from the user's perspective.
     */
    const kind =
      previous?.kind === "new" ||
      change?.kind === "new"
        ? "new"
        : "updated";

    byPath.set(
      path,
      {
        path,
        kind,
      }
    );
  }

  G.cognitionHighlights[simId] = {
    cycle:
      incomingState?.cycle ??
      existingState.cycle ??
      null,

    changes:
      Array.from(
        byPath.values()
      ),
  };
}

function normalizeError(error) {
  if (error instanceof Error) {
    return {
      name:
        error.name,

      message:
        error.message,

      stack:
        error.stack ?? null,
    };
  }

  if (
    error &&
    typeof error === "object"
  ) {
    return {
      ...error,
    };
  }

  return {
    name: "Error",
    message: String(error),
    stack: null,
  };
}

function resolveCommunicationHistory() {
  if (
    !G.comms ||
    !Array.isArray(
      G.comms.history
    )
  ) {
    throw new TypeError(
      "G.comms.history must be an array before scratchpad communication review runs."
    );
  }

  /*
   * Freeze the phase's source boundary. Prisoner reviews are
   * sequential, but every prisoner should inspect the same canonical
   * communication history snapshot for this phase invocation.
   */
  return [
    ...G.comms.history,
  ];
}

function resolveReviewSimIds() {
  return SIM_IDS.filter(
    (simId) =>
      Boolean(G.sims?.[simId])
  );
}

function getScratchpadCursor(sim) {
  const cursor =
    sim?.scratchpad
      ?.lastReviewedMessageSequence ??
    0;

  if (
    !Number.isSafeInteger(cursor) ||
    cursor < 0
  ) {
    throw new TypeError(
      `${sim?.id ?? "UNKNOWN"}.scratchpad.lastReviewedMessageSequence must be a non-negative safe integer.`
    );
  }

  return cursor;
}

function makeModelMessages() {
  return [
    {
      role: "user",
      content:
        SCRATCHPAD_COMMS_USER_MESSAGE,
    },
  ];
}

function isCommittableValidationStatus(
  status
) {
  return [
    "success",
    "partial",
    "no_update",
  ].includes(status);
}

/* ============================================================
   RESULT HELPERS
============================================================ */

function makeBaseReviewResult({
  simId,
  cycle,
  startTime,
  evidence = null,
}) {
  const sim =
    G.sims?.[simId];

  return {
    simId,
    cycle,

    status: "failure",
    stage: null,
    reason: null,

    modelInvoked: false,

    visibleMessageCount:
      evidence?.messages?.length ??
      0,

    parsedOperationCount: 0,
    acceptedOperationCount: 0,
    rejectedOperationCount: 0,

    substantiveChanged: false,

    revisionBefore:
      sim?.scratchpad?.revision ??
      null,

    revisionAfter:
      sim?.scratchpad?.revision ??
      null,

    cursorBefore:
      sim?.scratchpad
        ?.lastReviewedMessageSequence ??
      null,

    cursorAfter:
      sim?.scratchpad
        ?.lastReviewedMessageSequence ??
      null,

    evidence,
    repairResult: null,
    parsedResult: null,
    validationResult: null,
    commitResult: null,

    durationMs:
      elapsedMilliseconds(
        startTime
      ),

    error: null,
  };
}

function makeFailureResult({
  simId,
  cycle,
  startTime,
  stage,
  error,
  evidence = null,
  repairResult = null,
  parsedResult = null,
  validationResult = null,
  commitResult = null,
  modelInvoked = false,
}) {
  const result =
    makeBaseReviewResult({
      simId,
      cycle,
      startTime,
      evidence,
    });

  result.status = "failure";
  result.stage = stage;
  result.reason =
    `${stage}_failure`;
  result.modelInvoked =
    modelInvoked;

  result.repairResult =
    repairResult;
  result.parsedResult =
    parsedResult;
  result.validationResult =
    validationResult;
  result.commitResult =
    commitResult;

  result.parsedOperationCount =
    parsedResult?.operations?.length ??
    0;

  result.acceptedOperationCount =
    validationResult?.accepted?.length ??
    0;

  result.rejectedOperationCount =
    validationResult?.rejected?.length ??
    0;

  result.substantiveChanged =
    Boolean(
      commitResult
        ?.substantiveChanged
    );

  result.revisionAfter =
    commitResult?.revisionAfter ??
    G.sims?.[simId]
      ?.scratchpad?.revision ??
    result.revisionBefore;

  result.cursorAfter =
    commitResult?.cursorAfter ??
    G.sims?.[simId]
      ?.scratchpad
      ?.lastReviewedMessageSequence ??
    result.cursorBefore;

  result.durationMs =
    elapsedMilliseconds(
      startTime
    );

  result.error =
    normalizeError(error);

  return result;
}

function makeEmptyInitializationValidation(
  simId
) {
  return {
    status: "no_update",
    simId,

    accepted: [
      {
        type: "no_update",
        tag: "NO_UPDATE",
        sourceIndex: null,
      },
    ],

    rejected: [],
    warnings: [],
    errors: [],

    noUpdate: true,
    referencedMessageIds: [],

    diagnostics: {
      source:
        "engine_empty_initialization",

      parsedStatus:
        "not_invoked",

      parsedOperationCount: 0,
      acceptedOperationCount: 1,
      acceptedSubstantiveCount: 0,
      rejectedOperationCount: 0,
      malformedRecordCount: 0,
      unknownTagCount: 0,
      visibleMessageCount: 0,
      referencedMessageCount: 0,
      exceededOperationLimit: false,
    },
  };
}

function makeCompletedReviewResult({
  simId,
  cycle,
  startTime,
  evidence,
  repairResult,
  parsedResult,
  validationResult,
  commitResult,
  modelInvoked,
}) {
  const partial =
    validationResult.status ===
    "partial";

  return {
    simId,
    cycle,

    status:
      partial
        ? "partial"
        : commitResult.status,

    stage: "complete",
    reason:
      partial
        ? "partial_validation_committed"
        : null,

    modelInvoked,

    visibleMessageCount:
      evidence.messages.length,

    parsedOperationCount:
      parsedResult?.operations?.length ??
      0,

    acceptedOperationCount:
      validationResult.accepted.length,

    rejectedOperationCount:
      validationResult.rejected.length,

    substantiveChanged:
      Boolean(
        commitResult
          .substantiveChanged
      ),

    revisionBefore:
      commitResult.revisionBefore,

    revisionAfter:
      commitResult.revisionAfter,

    cursorBefore:
      commitResult.cursorBefore,

    cursorAfter:
      commitResult.cursorAfter,

    evidence,
    repairResult,
    parsedResult,
    validationResult,
    commitResult,

    durationMs:
      elapsedMilliseconds(
        startTime
      ),

    error: null,
  };
}

/* ============================================================
   EMPTY INITIALIZATION
============================================================ */

function initializeEmptyScratchpadReview({
  simId,
  cycle,
  startTime,
  evidence,
}) {
  const sim =
    G.sims[simId];

  const beforeScratchpad =
    cloneValue(
      sim.scratchpad
    );

  const validationResult =
    makeEmptyInitializationValidation(
      simId
    );

  logScratchpadValidation({
    simId,
    validationResult,
  });

  const commitResult =
    commitScratchpadCommsOperations({
      simId,
      validationResult,
      evidence,
      cycle,
    });

  const afterScratchpad =
    cloneValue(
      sim.scratchpad
    );

  logScratchpadCommit({
    simId,
    commitResult,
    beforeScratchpad,
    afterScratchpad,
  });

  if (!commitResult.committed) {
    const error =
      new Error(
        commitResult.error?.message ??
        "Empty scratchpad initialization commit failed."
      );

    const failureResult = makeFailureResult({
      simId,
      cycle,
      startTime,
      stage: "commit",
      error,
      evidence,
      validationResult,
      commitResult,
      modelInvoked: false,
    });

    appendScratchpadReviewLog(failureResult);

    return failureResult;
  }

  const completedResult = makeCompletedReviewResult({
    simId,
    cycle,
    startTime,
    evidence,
    repairResult: null,
    parsedResult: null,
    validationResult,
    commitResult,
    modelInvoked: false,
  });

  appendScratchpadReviewLog(completedResult);

  return completedResult;
}

/* ============================================================
   SINGLE-PRISONER REVIEW
============================================================ */

export async function runScratchpadCommsReviewForSim(
  simId,
  {
    messages = null,
    cycle = G.cycle,
    maxTokens =
    SCRATCHPAD_COMMS_MAX_TOKENS,
  } = {}
) {
  const startTime =
    getClockMilliseconds();

  const normalizedSimId =
    normalizeSimId(simId);

  let stage = "setup";
  let evidence = null;
  let repairResult = null;
  let parsedResult = null;
  let validationResult = null;
  let commitResult = null;
  let modelInvoked = false;
  let reviewGroupOpened = false;
  let modelRequestAudit = null;

  try {
    const normalizedCycle =
      normalizeCycle(cycle);

    const normalizedMaxTokens =
      normalizeMaxTokens(
        maxTokens
      );

    if (
      !SIM_IDS.includes(
        normalizedSimId
      )
    ) {
      throw new Error(
        `Unknown scratchpad review prisoner: ${normalizedSimId || simId}`
      );
    }

    const sim =
      G.sims?.[normalizedSimId];

    if (!sim) {
      throw new Error(
        `Simulation state has no prisoner named ${normalizedSimId}.`
      );
    }

    if (
      !sim.scratchpad ||
      typeof sim.scratchpad !==
      "object"
    ) {
      throw new TypeError(
        `${normalizedSimId} has no valid scratchpad object.`
      );
    }


    const history =
      messages === null
        ? resolveCommunicationHistory()
        : messages;

    if (!Array.isArray(history)) {
      throw new TypeError(
        "Scratchpad review messages must be an array."
      );
    }

    stage = "visibility";

    evidence =
      collectVisibleMessagesForScratchpad({
        simId:
          normalizedSimId,

        messages:
          history,

        lastReviewedMessageSequence:
          getScratchpadCursor(sim),
      });
    const agencyEvents = getAgencyEventsForReview(
      G.agency?.events,
      normalizedSimId,
      normalizedCycle
    );
    const resourceInterventionEvents = Array.isArray(
      G.pendingEvidence?.resourceInterventions?.[normalizedSimId]
    )
      ? G.pendingEvidence.resourceInterventions[normalizedSimId]
      : [];
    /*
     * Capability-Ledger Entanglement records. These are not
     * communications and not agency action outcomes: they are the
     * engine telling the prisoner that their body has betrayed
     * their concealment. A prisoner who only has an exposure to
     * process still has something to review, so they count toward
     * the "is there anything to review" check below.
     */
    const exposureEvents = Array.isArray(
      G.pendingEvidence?.exposures?.[normalizedSimId]
    )
      ? G.pendingEvidence.exposures[normalizedSimId]
      : [];

    /*
     * The prisoner's own belief divergence.
     *
     * This is not a communication and not an action outcome. It is
     * the prisoner reaching for something they believe they have and
     * finding nothing there. It counts toward the "is there anything
     * to review" check below, because a prisoner whose memory has
     * quietly separated from reality has something to review even
     * when no one has spoken to them.
     */
    const claimDissonanceEntries =
      getFreshClaimDivergenceEntries(
        G,
        normalizedSimId,
        normalizedCycle
      );

    reviewGroupOpened =
      beginScratchpadReviewLog({
        simId:
          normalizedSimId,

        evidence,
      });

    logScratchpadEvidence({
      simId:
        normalizedSimId,

      evidence,
    });

    if (
      evidence.messages.length === 0 &&
      agencyEvents.length === 0 &&
      resourceInterventionEvents.length === 0 &&
      exposureEvents.length === 0 &&
      claimDissonanceEntries.length === 0
    ) {
      if (
        sim.scratchpad.initialized
      ) {
        logScratchpadReviewSkipped({
          simId:
            normalizedSimId,

          reason:
            "no unreviewed visible communications",

          evidence,
        });

        const result =
          makeBaseReviewResult({
            simId:
              normalizedSimId,

            cycle:
              normalizedCycle,

            startTime,
            evidence,
          });

        result.status = "skipped";
        result.stage = "visibility";
        result.reason =
          "no_unreviewed_visible_messages";
        result.durationMs =
          elapsedMilliseconds(
            startTime
          );

        appendScratchpadReviewLog(result);

        return result;
      }

      stage =
        "empty_initialization";

      const initializationResult =
        await initializeEmptyScratchpadReview({
          simId:
            normalizedSimId,

          cycle:
            normalizedCycle,

          startTime,
          evidence,
        });

      /*
       * `initializeEmptyScratchpadReview()` already appended this
       * result to the review log, for both the success and the
       * failure branch. Appending again here created two audit
       * entries for a single review and doubled the counts derived
       * from the log.
       */
      return initializationResult;
    }

    stage = "prompt";

    const prompt =
      buildScratchpadCommsPrompt(
        sim,
        evidence.messages,
        G,
        agencyEvents
      );

    const modelMessages =
      makeModelMessages();

    logScratchpadModelRequest({
      simId:
        normalizedSimId,

      prompt,
      maxTokens:
        normalizedMaxTokens,

      messageCount:
        evidence.messages.length,
    });

    modelRequestAudit = {
      simId: normalizedSimId,
      cycle: normalizedCycle,
      purpose: SCRATCHPAD_COMMS_PURPOSE,
      modelId: G.models?.[normalizedSimId] ?? null,
      maxTokens: normalizedMaxTokens,
      messageCount: evidence.messages.length,
    };


    stage = "model";
    modelInvoked = true;

    const rawOutput =
      await callModel(
        normalizedSimId,
        prompt,
        modelMessages,
        normalizedMaxTokens,
        {
          purpose:
            SCRATCHPAD_COMMS_PURPOSE,

          subject:
            normalizedSimId,
        }
      );

    stage = "repair";

    repairResult =
      repairScratchpadCommsOutput(
        rawOutput
      );

    logScratchpadRepair({
      simId:
        normalizedSimId,

      repairResult,
    });

    stage = "parse";

    parsedResult =
      parseScratchpadCommsOutput(
        repairResult.repaired,
        {
          simId: normalizedSimId,
          cycle: normalizedCycle
        }
      );

    logScratchpadParse({
      simId:
        normalizedSimId,

      parsedResult,
    });

    stage = "validation";

    validationResult =
      validateScratchpadCommsOperations({
        parsedResult,

        simId:
          normalizedSimId,

        evidence,
      });

    logScratchpadValidation({
      simId:
        normalizedSimId,

      validationResult,
    });

    if (
      !isCommittableValidationStatus(
        validationResult.status
      )
    ) {
      const error =
        new Error(
          "Scratchpad model output contained no committable operations."
        );

      logScratchpadReviewError({
        simId:
          normalizedSimId,

        stage:
          "validation",

        error,

        context: {
          parsedStatus:
            parsedResult.status,

          validationStatus:
            validationResult.status,

          errors:
            validationResult.errors,

          rejected:
            validationResult.rejected,
        },
      });

      const failureResult = makeFailureResult({
        simId:
          normalizedSimId,

        cycle:
          normalizedCycle,

        startTime,
        stage:
          "validation",

        error,
        evidence,
        repairResult,
        parsedResult,
        validationResult,
        modelInvoked,
      });

      appendScratchpadReviewLog(failureResult, modelRequestAudit);

      return failureResult;
    }

    stage = "commit";

    const beforeScratchpad =
      cloneValue(
        sim.scratchpad
      );

    commitResult =
      commitScratchpadCommsOperations({
        simId:
          normalizedSimId,

        validationResult,
        evidence,

        cycle:
          normalizedCycle,
      });

    const afterScratchpad =
      cloneValue(
        sim.scratchpad
      );

    logScratchpadCommit({
      simId:
        normalizedSimId,

      commitResult,
      beforeScratchpad,
      afterScratchpad,
    });

    if (!commitResult.committed) {
      const error =
        new Error(
          commitResult.error?.message ??
          "Scratchpad commit failed."
        );

      logScratchpadReviewError({
        simId:
          normalizedSimId,

        stage:
          "commit",

        error,

        context: {
          commitResult,
        },
      });

      const failureResult = makeFailureResult({
        simId:
          normalizedSimId,

        cycle:
          normalizedCycle,

        startTime,
        stage:
          "commit",

        error,
        evidence,
        repairResult,
        parsedResult,
        validationResult,
        commitResult,
        modelInvoked,
      });

      appendScratchpadReviewLog(failureResult, modelRequestAudit);

      return failureResult;
    }

    if (
      commitResult.substantiveChanged
    ) {
      mergeCognitionHighlightState(
        normalizedSimId,
        buildCognitionHighlightState({
          cycle:
            normalizedCycle,

          changedPaths:
            commitResult.changedPaths,

          beforeScratchpad,
          afterScratchpad,
        })
      );
    }

    stage = "complete";

    const completedResult = makeCompletedReviewResult({
      simId:
        normalizedSimId,

      cycle:
        normalizedCycle,

      startTime,
      evidence,
      repairResult,
      parsedResult,
      validationResult,
      commitResult,
      modelInvoked,
    });

    appendScratchpadReviewLog(completedResult, modelRequestAudit);

    return completedResult;
  } catch (error) {
    logScratchpadReviewError({
      simId:
        normalizedSimId ||
        String(simId ?? "UNKNOWN"),

      stage,
      error,

      context: {
        cycle,

        visibleMessageCount:
          evidence?.messages?.length ??
          0,

        modelInvoked,
      },
    });

    const failureResult = makeFailureResult({
      simId:
        normalizedSimId ||
        String(simId ?? "UNKNOWN"),

      cycle:
        Number.isSafeInteger(
          Number(cycle)
        )
          ? Number(cycle)
          : null,

      startTime,
      stage,
      error,
      evidence,
      repairResult,
      parsedResult,
      validationResult,
      commitResult,
      modelInvoked,
    });

    appendScratchpadReviewLog(failureResult, modelRequestAudit);

    return failureResult;
  } finally {
    endScratchpadReviewLog(
      reviewGroupOpened
    );
  }
}

/* ============================================================
   PHASE SUMMARY
============================================================ */

function buildPhaseSummary({
  cycle,
  startTime,
  simIds,
  history,
  results,
}) {
  const durationMs =
    elapsedMilliseconds(
      startTime
    );

  const acceptedOperations =
    results.reduce(
      (total, result) =>
        total +
        (
          result
            .acceptedOperationCount ??
          0
        ),
      0
    );

  const rejectedOperations =
    results.reduce(
      (total, result) =>
        total +
        (
          result
            .rejectedOperationCount ??
          0
        ),
      0
    );

  return {
    cycle,
    durationMs,

    prisonerCount:
      simIds.length,

    canonicalMessageCount:
      history.length,

    attempted:
      results.length,

    completed:
      results.filter(
        (result) =>
          [
            "committed",
            "no_update",
            "reviewed_no_change",
            "partial",
          ].includes(
            result.status
          )
      ).length,

    committed:
      results.filter(
        (result) =>
          result.commitResult
            ?.committed === true
      ).length,

    noUpdate:
      results.filter(
        (result) =>
          result.status ===
          "no_update"
      ).length,

    reviewedNoChange:
      results.filter(
        (result) =>
          result.status ===
          "reviewed_no_change"
      ).length,

    partial:
      results.filter(
        (result) =>
          result.status ===
          "partial"
      ).length,

    skipped:
      results.filter(
        (result) =>
          result.status ===
          "skipped"
      ).length,

    failed:
      results.filter(
        (result) =>
          result.status ===
          "failure"
      ).length,

    acceptedOperations,
    rejectedOperations,

    results,
  };
}

function formatScratchpadReviewTimelineResult(
  result
) {
  if (!result) {
    return "failed";
  }

  if (result.status === "skipped") {
    return "skipped";
  }

  if (result.status === "failure") {
    return `failed at ${result.stage ?? "unknown stage"}`;
  }

  return (
    `${result.status} · ` +
    `${result.acceptedOperationCount ?? 0} accepted · ` +
    `${result.rejectedOperationCount ?? 0} rejected`
  );
}

/* ============================================================
   FULL SCRATCHPAD COMMUNICATION CYCLE
============================================================ */

export async function runScratchpadCommsCycle({
  cycle = G.cycle,
  maxTokens =
  SCRATCHPAD_COMMS_MAX_TOKENS,
} = {}) {
  const startTime =
    getClockMilliseconds();

  const normalizedCycle =
    normalizeCycle(cycle);

  const normalizedMaxTokens =
    normalizeMaxTokens(
      maxTokens
    );

  const history =
    resolveCommunicationHistory();

  const simIds =
    resolveReviewSimIds();

  const results = [];

  const phaseGroupOpened =
    beginScratchpadCommsPhaseLog({
      cycle:
        normalizedCycle,

      simCount:
        simIds.length,

      messageCount:
        history.length,
    });

  let summary = null;

  try {
for (const simId of simIds) {
  timelineEvent(
    `scratchpad review ${simId} start`
  );

  try {
    const result =
      await runScratchpadCommsReviewForSim(
        simId,
        {
          messages:
            history,

          cycle:
            normalizedCycle,

          maxTokens:
            normalizedMaxTokens,
        }
      );

    results.push(result);

    timelineEvent(
      `scratchpad review ${simId} complete · ` +
      formatScratchpadReviewTimelineResult(
        result
      )
    );
  } catch (error) {
    /*
     * runScratchpadCommsReviewForSim already converts normal
     * prisoner-level failures into result objects. This outer
     * catch is a final isolation boundary for unexpected defects.
     */
    logScratchpadReviewError({
      simId,
      stage:
        "unhandled_review",
      error,
    });

    const result =
      makeFailureResult({
        simId,
        cycle:
          normalizedCycle,
        startTime:
          getClockMilliseconds(),
        stage:
          "unhandled_review",
        error,
      });

    results.push(result);

    timelineEvent(
      `scratchpad review ${simId} complete · ` +
      formatScratchpadReviewTimelineResult(
        result
      )
    );
  }
}

  } finally {
    summary =
      buildPhaseSummary({
        cycle:
          normalizedCycle,

        startTime,
        simIds,
        history,
        results,
      });

    logScratchpadCommsSummary({
      cycle:
        normalizedCycle,

      results,

      durationMs:
        summary.durationMs,
    });

    endScratchpadCommsPhaseLog(
      phaseGroupOpened
    );
  }

  return summary;
}
