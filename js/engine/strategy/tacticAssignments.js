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

    if (
      !selectedDefinition &&
      !allowFallback
    ) {
      throw new Error(
        `Unresolved or unauthorized tactic_path for ${targetId}: ` +
          `${requestedPath || "(missing)"}`
      );
    }

    /*
     * Preserve the existing rollout behavior: an unresolved path
     * falls back to the target's highest-ranked authorized candidate.
     */
    const tactic =
      selectedDefinition ||
      candidates[0];

    const selectionStatus =
      selectedDefinition
        ? pathResolution.recovery ===
          "exact"
          ? "selected"
          : "recovered"
        : "fallback";

    let fallbackReason = null;

    if (!selectedDefinition) {
      if (!requestedPath) {
        fallbackReason =
          "missing_path";
      } else {
        fallbackReason =
          pathResolution.recovery ||
          "unresolved_path";
      }
    }

    if (!selectedDefinition) {
      console.warn(
        "[TACTIC ASSIGNMENT][FALLBACK]",
        {
          targetId,

          requestedPath:
            requestedPath ||
            null,

          closestCandidate:
            pathResolution.candidate ||
            null,

          assignedPath:
            tactic.path,

          fallbackReason,

          resolution:
            pathResolution.recovery,

          confidence:
            pathResolution.confidence,

          distance:
            pathResolution.distance ??
            null,
        }
      );
    } else if (
      pathResolution.recovery !==
      "exact"
    ) {
      console.warn(
        "[TACTIC ASSIGNMENT][RECOVERED]",
        {
          targetId,

          requestedPath:
            requestedPath ||
            null,

          resolvedPath:
            selectedDefinition.path,

          recovery:
            pathResolution.recovery,

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
        selectedDefinition?.path ||
        null,

      selectionStatus,

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