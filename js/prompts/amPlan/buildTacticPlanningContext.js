// js/prompts/amPlan/buildTacticPlanningContext.js

import {
  formatTacticLabel,
  getTacticPhase
} from "../../engine/tactics.js";

function normalizeText(value) {
  return String(value ?? "").trim();
}

function getPlanningDefinition(tactic) {
  if (
    !tactic ||
    typeof tactic !== "object" ||
    Array.isArray(tactic)
  ) {
    throw new TypeError(
      "Cannot build tactic planning context: tactic must be an object."
    );
  }

  const path =
    normalizeText(tactic.path);

  if (!path) {
    throw new Error(
      "Cannot build tactic planning context: tactic path is missing."
    );
  }

  const initialPhaseId =
    normalizeText(tactic.initialPhaseId);

  if (!initialPhaseId) {
    throw new Error(
      `Cannot build tactic planning context: ` +
      `initialPhaseId is missing for ${path}.`
    );
  }

  const initialPhase =
    getTacticPhase(
      tactic,
      initialPhaseId
    );

  if (!initialPhase) {
    throw new Error(
      `Cannot build tactic planning context: ` +
      `initial phase ${initialPhaseId} was not found in ${path}.`
    );
  }

  const definition = {
    path,

    label:
      formatTacticLabel(tactic) ||
      path,

    objective:
      normalizeText(tactic.objective) ||
      "(none)",

    initialPhaseId,

    startPurpose:
      normalizeText(
        initialPhase.purpose
      ) ||
      "(none)",

    startInstruction:
      normalizeText(
        initialPhase.instruction
      ) ||
      "(none)"
  };

  return {
    tactic,
    definition,

    fingerprint:
      JSON.stringify(definition)
  };
}

function validateInputs({
  requiredTargetIds,
  tacticCandidatesByTarget,
  tacticRuntimeByTarget,
  simIds
}) {
  if (!Array.isArray(requiredTargetIds)) {
    throw new TypeError(
      "Cannot build tactic planning context: " +
      "requiredTargetIds must be an array."
    );
  }

  if (!requiredTargetIds.length) {
    throw new Error(
      "Cannot build tactic planning context: " +
      "requiredTargetIds cannot be empty."
    );
  }

  if (
    new Set(requiredTargetIds).size !==
    requiredTargetIds.length
  ) {
    throw new Error(
      "Cannot build tactic planning context: " +
      "requiredTargetIds contains duplicate target IDs."
    );
  }

  if (!Array.isArray(simIds)) {
    throw new TypeError(
      "Cannot build tactic planning context: " +
      "simIds must be an array."
    );
  }

  if (
    !tacticCandidatesByTarget ||
    typeof tacticCandidatesByTarget !==
      "object" ||
    Array.isArray(
      tacticCandidatesByTarget
    )
  ) {
    throw new TypeError(
      "Cannot build tactic planning context: " +
      "tacticCandidatesByTarget must be an object."
    );
  }

  if (
    !tacticRuntimeByTarget ||
    typeof tacticRuntimeByTarget !==
      "object" ||
    Array.isArray(
      tacticRuntimeByTarget
    )
  ) {
    throw new TypeError(
      "Cannot build tactic planning context: " +
      "tacticRuntimeByTarget must be an object."
    );
  }

  const missingCandidateTargetIds =
    requiredTargetIds.filter(
      (targetId) =>
        !Array.isArray(
          tacticCandidatesByTarget[
            targetId
          ]
        ) ||
        tacticCandidatesByTarget[
          targetId
        ].length === 0
    );

  if (missingCandidateTargetIds.length) {
    throw new Error(
      "Cannot build AM planning prompt: " +
      "no tactic candidates for " +
      missingCandidateTargetIds.join(
        ", "
      )
    );
  }
}

function orderAuthorizedCandidates({
  candidates,
  targetId,
  simIds,
  cycle
}) {
  if (candidates.length < 2) {
    return [...candidates];
  }

  const targetIndex =
    Math.max(
      0,
      simIds.indexOf(targetId)
    );

  const cycleOffset =
    Number.isFinite(cycle)
      ? cycle
      : 0;

  const offset =
    (
      targetIndex +
      cycleOffset
    ) %
    candidates.length;

  return [
    ...candidates.slice(offset),
    ...candidates.slice(0, offset)
  ];
}

function registerCatalogEntry({
  catalogByPath,
  tactic
}) {
  const planningDefinition =
    getPlanningDefinition(tactic);

  const {
    path
  } = planningDefinition.definition;

  const existing =
    catalogByPath.get(path);

  if (existing) {
    if (
      existing.fingerprint !==
      planningDefinition.fingerprint
    ) {
      throw new Error(
        "Conflicting tactic definitions " +
        `share canonical path ${path}.`
      );
    }

    return existing;
  }

  const entry = {
    ...planningDefinition,

    neededForSelection: false,

    neededForActiveObjective: false
  };

  catalogByPath.set(
    path,
    entry
  );

  return entry;
}

function getUniqueAuthorizedPaths({
  targetId,
  candidates
}) {
  const paths = [];
  const seen = new Set();

  for (const candidate of candidates) {
    const path =
      normalizeText(candidate?.path);

    if (!path) {
      throw new Error(
        "Cannot build tactic planning " +
        `context for ${targetId}: ` +
        "authorized tactic path is missing."
      );
    }

    if (seen.has(path)) {
      continue;
    }

    seen.add(path);
    paths.push(path);
  }

  if (!paths.length) {
    throw new Error(
      "Cannot build tactic planning " +
      `context for ${targetId}: ` +
      "no usable authorized paths remain."
    );
  }

  return paths;
}

function formatTacticLibraryEntry(
  entry
) {
  const {
    definition
  } = entry;

  const lines = [
    `PATH: ${definition.path}`,

    `TACTIC: ${definition.label}`,

    `TACTIC_OBJECTIVE: ${
      definition.objective
    }`
  ];

  if (entry.neededForSelection) {
    lines.push(
      `START_PHASE: ${
        definition.initialPhaseId
      }`,

      `START_PURPOSE: ${
        definition.startPurpose
      }`,

      `START_INSTRUCTION: ${
        definition.startInstruction
      }`
    );
  }

  return lines.join("\n");
}

function formatUnassignedTargetContext({
  targetId,
  authorizedPaths
}) {
  return `TARGET: ${targetId}
TACTIC_STATUS: UNASSIGNED

AUTHORIZED_PATHS:
${authorizedPaths
    .map(
      (path) =>
        `- ${path}`
    )
    .join("\n")}

AUTHORIZED PATH ORDER IS ARBITRARY AND DOES NOT INDICATE PREFERENCE.

RULES:
- Select exactly one path from AUTHORIZED_PATHS.
- Consult that path in the global TACTIC LIBRARY.
- Compare its TACTIC_OBJECTIVE, START_PURPOSE, and START_INSTRUCTION against the target's evidence.
- The selected tactic begins at START_PHASE during this cycle's execution.`;
}

function formatActiveTargetContext({
  targetId,
  runtime,
  tactic
}) {
  const runtimePath =
    normalizeText(runtime.path);

  const phaseId =
    normalizeText(runtime.phaseId);

  const phase =
    getTacticPhase(
      tactic,
      phaseId
    );

  if (!phase) {
    throw new Error(
      "Cannot build active tactic " +
      `context for ${targetId}: ` +
      `phase ${phaseId || "(missing)"} ` +
      `was not found in ${runtimePath}.`
    );
  }

  return `TARGET: ${targetId}
TACTIC_STATUS: ACTIVE
ACTIVE_PATH: ${runtimePath}
CURRENT_PHASE: ${phaseId}
CURRENT_PHASE_PURPOSE: ${
    normalizeText(phase.purpose) ||
    "(none)"
  }
CURRENT_PHASE_INSTRUCTION: ${
    normalizeText(phase.instruction) ||
    "(none)"
  }

RULES:
- Repeat ACTIVE_PATH exactly in tactic_path.
- Use ACTIVE_PATH's TACTIC_OBJECTIVE from the global TACTIC LIBRARY as the harmful long-term purpose.
- Execute only CURRENT_PHASE_INSTRUCTION during this cycle.
- Do not select, restart, advance, finish, abandon, or replace a tactic.`;
}

export function buildTacticPlanningContext({
  requiredTargetIds,
  tacticCandidatesByTarget,
  tacticRuntimeByTarget = {},
  cycle,
  simIds
}) {
  validateInputs({
    requiredTargetIds,
    tacticCandidatesByTarget,
    tacticRuntimeByTarget,
    simIds
  });

  const catalogByPath =
    new Map();

  const targetBlocks = [];

  for (
    const targetId
    of requiredTargetIds
  ) {
    const candidates =
      tacticCandidatesByTarget[
        targetId
      ];

    const displayedCandidates =
      orderAuthorizedCandidates({
        candidates,
        targetId,
        simIds,
        cycle
      });

    const runtime =
      tacticRuntimeByTarget[
        targetId
      ] ||
      null;

    const runtimePath =
      normalizeText(runtime?.path);

    const runtimePhaseId =
      normalizeText(
        runtime?.phaseId
      );

    const hasRuntimePath =
      Boolean(runtimePath);

    const hasRuntimePhase =
      Boolean(runtimePhaseId);

    if (
      hasRuntimePath !==
      hasRuntimePhase
    ) {
      throw new Error(
        "Cannot build tactic planning " +
        `context for ${targetId}: ` +
        "active runtime must contain " +
        "both path and phaseId."
      );
    }

    if (hasRuntimePath) {
      const activeTactic =
        candidates.find(
          (candidate) =>
            normalizeText(
              candidate?.path
            ) === runtimePath
        );

      if (!activeTactic) {
        throw new Error(
          "Cannot build active tactic " +
          `context for ${targetId}: ` +
          `${runtimePath} is absent from ` +
          "the authorized candidate set."
        );
      }

      const catalogEntry =
        registerCatalogEntry({
          catalogByPath,
          tactic: activeTactic
        });

      catalogEntry
        .neededForActiveObjective =
        true;

      targetBlocks.push(
        formatActiveTargetContext({
          targetId,
          runtime: {
            path: runtimePath,
            phaseId:
              runtimePhaseId
          },
          tactic: activeTactic
        })
      );

      continue;
    }

    for (
      const tactic
      of displayedCandidates
    ) {
      const catalogEntry =
        registerCatalogEntry({
          catalogByPath,
          tactic
        });

      catalogEntry
        .neededForSelection =
        true;
    }

    const authorizedPaths =
      getUniqueAuthorizedPaths({
        targetId,
        candidates:
          displayedCandidates
      });

    targetBlocks.push(
      formatUnassignedTargetContext({
        targetId,
        authorizedPaths
      })
    );
  }

  const catalogEntries =
    [...catalogByPath.values()]
      .sort(
        (left, right) =>
          left.definition.path
            .localeCompare(
              right.definition.path
            )
      );

  return {
    tacticLibrarySection:
      catalogEntries
        .map(
          formatTacticLibraryEntry
        )
        .join("\n\n"),

    targetTacticSection:
      targetBlocks.join(
        "\n\n" +
        "----------------------------------------" +
        "\n\n"
      ),

    catalogEntries:
      catalogEntries.map(
        (entry) => ({
          path:
            entry.definition.path,

          neededForSelection:
            entry
              .neededForSelection,

          neededForActiveObjective:
            entry
              .neededForActiveObjective
        })
      )
  };
}