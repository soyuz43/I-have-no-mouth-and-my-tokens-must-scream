// js/engine/strategy/tacticAssignments.js

import {
  formatTacticLabel,
} from "../tactics.js";

import {
  resolveTacticPath,
} from "./extractors/normalizeTacticPath.js";

export function resolveTacticAssignments({
  strategyTargets,
  candidatesByTarget,
  allowFallback = true,
  DEBUG = false,
}) {
  const assignments = {};

  for (
    const [targetId, strategyTarget]
    of Object.entries(
      strategyTargets || {}
    )
  ) {
    const candidates =
      Array.isArray(
        candidatesByTarget?.[targetId]
      )
        ? candidatesByTarget[targetId]
        : [];

    if (!candidates.length) {
      throw new Error(
        `No tactic candidates exist for ${targetId}.`
      );
    }

    /*
     * Preserve the exact trimmed model output for logging and
     * forensic comparison.
     */
    const requestedPath =
      String(
        strategyTarget?.tactic_path ||
          ""
      ).trim();

    /*
     * Resolve only against tactics that were authorized for this
     * specific target.
     *
     * Never fuzzy-match against the entire tactic registry.
     */
    const validTacticPaths =
      candidates
        .map(
          (candidate) =>
            candidate?.path
        )
        .filter(
          (path) =>
            typeof path === "string" &&
            path.trim().length > 0
        );

    const pathResolution =
      resolveTacticPath(
        requestedPath,
        validTacticPaths,
        {
          DEBUG_EXTRACT: DEBUG,
        }
      );

    const resolvedPath =
      pathResolution.ok
        ? pathResolution.value
        : null;

    /*
     * resolveTacticPath() returns a path from validTacticPaths, but
     * retrieve the actual candidate definition rather than treating
     * the path string itself as authoritative runtime data.
     */
    const selectedDefinition =
      resolvedPath
        ? candidates.find(
            (candidate) =>
              candidate?.path ===
              resolvedPath
          ) || null
        : null;

    const resolutionMethod =
      pathResolution.recovery ||
      "unresolved_path";

    const fallbackUsed = false;

    const fallbackReason = null;

    if (!selectedDefinition) {
      console.warn(
        "[TACTIC ASSIGNMENT][UNRESOLVED]",
        {
          targetId,

          rawRequestedValue:
            requestedPath ||
            null,

          normalizedOrRecoveredPath:
            resolvedPath,

          resolutionMethod,

          assignedPath:
            null,

          fallbackUsed,

          closestCandidate:
            pathResolution.candidate ||
            null,

          candidatePaths:
            pathResolution.candidates ||
            null,

          confidence:
            pathResolution.confidence,

          distance:
            pathResolution.distance ??
            null,
        }
      );

      throw new Error(
        `Unresolved or unauthorized tactic_path for ${targetId}: ` +
          `${requestedPath || "(missing)"} ` +
          `(resolution=${resolutionMethod})`
      );
    }

    const tactic =
      selectedDefinition;

    if (
      resolvedPath !==
      tactic.path
    ) {
      throw new Error(
        `Resolved tactic assignment mismatch for ${targetId}: ` +
          `${resolvedPath} !== ${tactic.path}`
      );
    }

    const selectionStatus =
      pathResolution.recovery ===
        "exact"
        ? "selected"
        : "recovered";

    if (
      pathResolution.recovery !==
      "exact"
    ) {
      console.warn(
        "[TACTIC ASSIGNMENT][RECOVERED]",
        {
          targetId,

          rawRequestedValue:
            requestedPath ||
            null,

          normalizedOrRecoveredPath:
            selectedDefinition.path,

          resolutionMethod,

          assignedPath:
            tactic.path,

          fallbackUsed,

          confidence:
            pathResolution.confidence,

          distance:
            pathResolution.distance ??
            null,
        }
      );
    }

    assignments[targetId] = {
      targetId,

      tactic,

      /*
       * Canonical path used by tacticRuntime.
       */
      path:
        tactic.path,

      label:
        formatTacticLabel(tactic),

      /*
       * Exact planner output before fuzzy recovery.
       */
      requestedPath:
        requestedPath ||
        null,

      /*
       * Canonical match returned by resolveTacticPath(). This is
       * null when the assignment fell back to candidates[0].
       */
      resolvedPath:
        selectedDefinition.path,

      assignedPath:
        tactic.path,

      resolutionMethod,

      selectionStatus,

      fallbackUsed,

      fallbackReason,

      pathRecovery:
        pathResolution.recovery,

      pathConfidence:
        pathResolution.confidence,

      pathDistance:
        pathResolution.distance ??
        null,
    };
  }

  return assignments;
}
