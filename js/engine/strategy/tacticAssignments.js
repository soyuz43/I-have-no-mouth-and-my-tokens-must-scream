import {
  formatTacticLabel,
} from "../tactics.js";

export function resolveTacticAssignments({
  strategyTargets,
  candidatesByTarget,
  allowFallback = true,
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

    const requestedPath =
      String(
        strategyTarget?.tactic_path ||
          ""
      ).trim();

    const selectedDefinition =
      candidates.find(
        (candidate) =>
          candidate?.path ===
          requestedPath
      ) || null;

    if (
      !selectedDefinition &&
      !allowFallback
    ) {
      throw new Error(
        `Unauthorized tactic_path for ${targetId}: ` +
          `${requestedPath || "(missing)"}`
      );
    }

    const tactic =
      selectedDefinition ||
      candidates[0];

    const selectionStatus =
      selectedDefinition
        ? "selected"
        : "fallback";

    const fallbackReason =
      selectedDefinition
        ? null
        : requestedPath
          ? "unauthorized_path"
          : "missing_path";

    if (!selectedDefinition) {
      console.warn(
        "[TACTIC ASSIGNMENT][FALLBACK]",
        {
          targetId,
          requestedPath:
            requestedPath || null,
          assignedPath:
            tactic.path,
          fallbackReason,
        }
      );
    }

    assignments[targetId] = {
      targetId,

      tactic,

      path: tactic.path,

      label:
        formatTacticLabel(tactic),

      requestedPath:
        requestedPath || null,

      selectionStatus,

      fallbackReason,
    };
  }

  return assignments;
}