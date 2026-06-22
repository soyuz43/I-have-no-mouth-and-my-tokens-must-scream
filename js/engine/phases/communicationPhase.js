// js/engine/phases/communicationPhase.js

import { G } from "../../core/state.js";
import { addLog } from "../../ui/logs.js";
import { timelineEvent } from "../../ui/timeline.js";

import {
  runCommsCycle,
} from "../comms/orchestrator.js";

import {
  runScratchpadCommsCycle,
} from "../scratchpad/comms/orchestrator.js";
/*
============================================================
COMMUNICATION PHASE

Coordinates the complete prisoner communication lifecycle:

1. Generate and persist canonical inter-sim communications.
2. Let each prisoner privately review their visible communications.
3. Return both subsystem results to the caller.

This phase does not:
- Run belief contagion.
- Expose private scratchpad contents to the timeline.
- Swallow catastrophic subsystem failures.
- Treat individual scratchpad-review failures as phase exceptions.

runScratchpadCommsCycle() already isolates ordinary prisoner-level
failures and reports them through its returned summary. A catastrophic
setup or module failure is logged here and then rethrown to the lifecycle
caller.
============================================================
*/

/* ============================================================
   PHASE ORCHESTRATOR
============================================================ */

export async function runCommunicationPhase() {
  /*
   * Capture the authoritative cycle once. Neither subsystem should
   * change G.cycle during this phase, and the scratchpad review must
   * be attributed to the same cycle that produced the messages.
   */
  const cycle =
    G.cycle;

  /*
   * runCommsCycle() must complete first because it assigns canonical
   * message IDs and persists the new records into G.comms.history.
   *
   * If communication generation throws, scratchpad review must not
   * run against an incomplete or partially persisted cycle.
   */
  const commsState =
    await runCommsCycle();
  /*
   * The scratchpad subsystem reads the complete canonical history,
   * filters it independently for each prisoner, and retries any
   * previously unseen backlog left by an earlier failed review.
   */
  addLog(
    "SYSTEM // SCRATCHPAD START",
    `Private communication review for cycle ${cycle} started.`,
    "scratchpad-start"
  );

  timelineEvent(
    "scratchpad communication review start"
  );

  let scratchpadSummary;

  try {
    scratchpadSummary =
      await runScratchpadCommsCycle({
        cycle,
      });
  } catch (error) {
    addLog(
      "SYSTEM // SCRATCHPAD ERROR",
      `Private communication review for cycle ${cycle} failed: ` +
      `${error?.message ?? "Unknown error"}`,
      "scratchpad-end"
    );

    timelineEvent(
      "!! scratchpad communication review error"
    );

    throw error;
  }

  addLog(
    "SYSTEM // SCRATCHPAD END",
    `Private communication review for cycle ${cycle} complete.`,
    "scratchpad-end"
  );

  timelineEvent(
    "scratchpad communication review complete"
  );

  return {
    cycle,
    commsState,
    scratchpadSummary,
  };
}
