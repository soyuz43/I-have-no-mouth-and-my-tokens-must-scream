// js/engine/phases/psychologyPhase.js
//
// Psychology Phase
//
// Responsible for:
// 1. Journal-participant selection from actual execution events
// 2. Sim journal generation
// 3. Stat extraction
// 4. Psychological validation
// 5. State mutation
// 6. Belief / drive / anchor updates
// 7. Deterministic constraint progression independent of journaling

import { G } from "../../core/state.js";
import { SIM_IDS } from "../../core/constants.js";

import { recordJournalStatsEvidence } from "./helpers/evidenceTrace.js";

import { timelineEvent } from "../../ui/timeline.js";
import { addLog } from "../../ui/logs.js";

import {
  appendJournalEntry,
  showWriting,
  updateSimDisplay,
} from "../../ui/render.js";

import { buildSimJournalPrompt } from "../../prompts/journal.js";

import { buildSimJournalStatsPrompt } from "../../prompts/stats.js";

import { callModel } from "../../models/callModel.js";

import {
  parseStatDeltasWithStats,
  parseBeliefUpdatesWithStats,
  parseDriveUpdate,
  parseAnchorUpdate,
} from "../state/extract.js";

import {
  applyBeliefUpdates,
  applyDriveUpdates,
  applyAnchorUpdates,
} from "../state/commit.js";

import {
  warnStatInconsistencies,
  parseAndValidateStateBlock,
  validateNarrativeConsistency,
} from "../state/validate.js";

import {
  tickConstraints,
  CONSTRAINT_MAP,
} from "../constraints.js";

import { safeExtractJSON } from "../state/utils/safeExtract.js";
import { logBeliefDistance } from "../state/utils/beliefDistance.js";

/* ============================================================
   BELIEF DIFF UTILITIES (DEBUG / OBSERVABILITY)
   ============================================================ */

function snapshotBeliefs(sim) {
  return { ...(sim.beliefs || {}) };
}

function diffBeliefs(before, after) {
  const rows = [];

  const keys = new Set([
    ...Object.keys(before || {}),
    ...Object.keys(after || {}),
  ]);

  for (const key of keys) {
    const b = before?.[key];
    const a = after?.[key];

    if (!Number.isFinite(b) && !Number.isFinite(a)) continue;

    const delta = (a ?? 0) - (b ?? 0);

    if (delta === 0) continue;

    rows.push({
      belief: key,
      before: Number(b ?? 0).toFixed(4),
      after: Number(a ?? 0).toFixed(4),
      delta: delta.toFixed(4),
    });
  }

  return rows;
}

/* ============================================================
   ID / RECORD NORMALIZATION
   ============================================================ */

function resolveSimId(raw) {
  if (!raw) return null;

  const cleaned = String(raw)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]/g, "");

  return SIM_IDS.includes(cleaned)
    ? cleaned
    : null;
}

function normalizeSimIdList(value) {
  if (!Array.isArray(value)) return [];

  const requested = new Set(
    value
      .map(resolveSimId)
      .filter(Boolean)
  );

  return SIM_IDS.filter(
    (id) => requested.has(id)
  );
}

function normalizeActionRecord(rawRecord) {
  if (typeof rawRecord === "string") {
    const text = rawRecord.trim();

    return text
      ? {
        text,
        tactic: null,
        origin: "model",
      }
      : null;
  }

  if (
    !rawRecord ||
    typeof rawRecord !== "object"
  ) {
    return null;
  }

  const text =
    typeof rawRecord.text === "string"
      ? rawRecord.text.trim()
      : "";

  if (!text) return null;

  return {
    text,

    tactic:
      typeof rawRecord.tactic === "string" &&
        rawRecord.tactic.trim()
        ? rawRecord.tactic.trim()
        : null,

    origin:
      typeof rawRecord.origin === "string" &&
        rawRecord.origin.trim()
        ? rawRecord.origin.trim()
        : "model",
  };
}

function normalizePerceptionRecord(rawRecord) {
  if (typeof rawRecord === "string") {
    const text = rawRecord.trim();

    return text
      ? {
        text,
        origin: "parser_fallback",
        observedTargetIds: [],
      }
      : null;
  }

  if (
    !rawRecord ||
    typeof rawRecord !== "object"
  ) {
    return null;
  }

  const text =
    typeof rawRecord.text === "string"
      ? rawRecord.text.trim()
      : "";

  if (!text) return null;

  return {
    text,

    origin:
      typeof rawRecord.origin === "string" &&
        rawRecord.origin.trim()
        ? rawRecord.origin.trim()
        : "action_perception",

    observedTargetIds:
      normalizeSimIdList(
        rawRecord.observedTargetIds
      ),
  };
}

function normalizeObservationRoll(rawRecord) {
  if (
    !rawRecord ||
    typeof rawRecord !== "object"
  ) {
    return null;
  }

  return {
    probability:
      finiteNumber(
        rawRecord.probability,
        0
      ),

    roll:
      finiteNumber(
        rawRecord.roll,
        0
      ),

    observed:
      rawRecord.observed === true,

    basis:
      typeof rawRecord.basis === "string"
        ? rawRecord.basis
        : null,

    candidateTargetIds:
      normalizeSimIdList(
        rawRecord.candidateTargetIds
      ),

    observedTargetIds:
      normalizeSimIdList(
        rawRecord.observedTargetIds
      ),
  };
}

/* ============================================================
   AM EXECUTION CONTEXT NORMALIZATION
   ============================================================ */

function buildExecutionContext(execution) {
  const source =
    execution?.amExecution ||
    G.amExecution ||
    {};

  const sourceActions =
    source.actions &&
      typeof source.actions === "object"
      ? source.actions
      : (
        G.amTargets &&
          typeof G.amTargets === "object"
          ? G.amTargets
          : {}
      );

  const sourcePerceptions =
    source.perceptions &&
      typeof source.perceptions === "object"
      ? source.perceptions
      : {};

  const actions = {};
  const perceptions = {};
  const observationRolls = {};

  for (const id of SIM_IDS) {
    const action =
      normalizeActionRecord(
        sourceActions[id]
      );

    const perception =
      normalizePerceptionRecord(
        sourcePerceptions[id]
      );

    const observationRoll =
      normalizeObservationRoll(
        source.observationRolls?.[id]
      );

    if (action) {
      actions[id] = action;
    }

    if (perception) {
      perceptions[id] = perception;
    }

    if (observationRoll) {
      observationRolls[id] =
        observationRoll;
    }
  }

  const fallbackExecutionTargetIds =
    Array.isArray(execution?.targets)
      ? execution.targets
        .map((sim) => sim?.id)
        .filter(Boolean)
      : [];

  const targetIds = normalizeSimIdList(
    Array.isArray(source.targetIds) &&
      source.targetIds.length
      ? source.targetIds
      : fallbackExecutionTargetIds
  );

  const actionTargetIds =
    normalizeSimIdList(
      Array.isArray(
        source.actionTargetIds
      ) &&
        source.actionTargetIds.length
        ? source.actionTargetIds
        : Object.keys(actions)
    );

  const parsedConstraintTargetIds =
    Object.keys(
      execution?.constraintMap || {}
    );

  const constraintTargetIds =
    normalizeSimIdList(
      Array.isArray(
        source.constraintTargetIds
      ) &&
        source.constraintTargetIds.length
        ? source.constraintTargetIds
        : parsedConstraintTargetIds
    );

  const observerIds =
    normalizeSimIdList(
      Array.isArray(source.observerIds) &&
        source.observerIds.length
        ? source.observerIds
        : Object.keys(perceptions)
    );

  const derivedJournalTargetIds = [
    ...actionTargetIds,
    ...constraintTargetIds,
    ...observerIds,
  ];

  const journalTargetIds =
    normalizeSimIdList(
      Array.isArray(
        source.journalTargetIds
      ) &&
        source.journalTargetIds.length
        ? source.journalTargetIds
        : derivedJournalTargetIds
    );

  const missingTargetIds =
    normalizeSimIdList(
      Array.isArray(
        source.missingTargetIds
      )
        ? source.missingTargetIds
        : targetIds.filter(
          (id) =>
            !actions[id]?.text
        )
    );

  return {
    cycle:
      source.cycle ??
      G.cycle,

    targetSelection:
      source.targetSelection ??
      G.target,

    targetIds,
    actions,
    actionTargetIds,
    constraintTargetIds,
    perceptions,
    observerIds,
    observationRolls,

    observationPolicy:
      source.observationPolicy &&
        typeof source.observationPolicy ===
        "object"
        ? {
          ...source.observationPolicy,
        }
        : null,

    journalTargetIds,
    missingTargetIds,
  };
}

/* ============================================================
   DIRECT CONSTRAINT CONTEXT
   ============================================================ */

function collectActiveConstraintTargetIds() {
  return SIM_IDS.filter((id) => {
    const sim = G.sims?.[id];

    return Boolean(
      sim &&
      Array.isArray(sim.constraints) &&
      sim.constraints.length
    );
  });
}

function getConstraintTitle(constraint) {
  if (!constraint) {
    return "an active physical constraint";
  }

  const definition =
    CONSTRAINT_MAP[constraint.id];

  return (
    constraint.title ||
    definition?.title ||
    String(
      constraint.id ||
      "physical constraint"
    ).replace(/_/g, " ")
  );
}

function buildDirectConstraintContext(
  sim,
  amExecution
) {
  const activeConstraints =
    Array.isArray(sim?.constraints)
      ? sim.constraints.filter(Boolean)
      : [];

  if (!activeConstraints.length) {
    return {
      text: "",
      origin: null,
      constraintIds: [],
      newlyApplied: false,
      ongoing: false,
    };
  }

  const newlyApplied =
    amExecution.constraintTargetIds
      .includes(sim.id);

  const descriptions =
    activeConstraints.map(
      (constraint) => {
        const title =
          getConstraintTitle(
            constraint
          );

        const remaining =
          Number(
            constraint.remaining
          );

        const intensity =
          Number(
            constraint.intensity
          );

        const details = [];

        if (
          Number.isFinite(intensity)
        ) {
          details.push(
            `intensity ${intensity}`
          );
        }

        if (
          Number.isFinite(remaining)
        ) {
          details.push(
            `${remaining} cycle${remaining === 1
              ? ""
              : "s"
            } remaining`
          );
        }

        const suffix =
          details.length
            ? ` (${details.join(", ")})`
            : "";

        return `${title}${suffix}`;
      }
    );

  const prefix = newlyApplied
    ? "AM has imposed the following physical constraint on you this cycle:"
    : "You remain under the following active physical constraint:";

  return {
    text:
      `${prefix}\n` +
      descriptions
        .map(
          (line) =>
            `- ${line}`
        )
        .join("\n"),

    origin: newlyApplied
      ? "direct_constraint"
      : "ongoing_constraint",

    constraintIds:
      activeConstraints
        .map(
          (constraint) =>
            constraint.id
        )
        .filter(Boolean),

    newlyApplied,
    ongoing: !newlyApplied,
  };
}

function resolveAMContextForSim(
  sim,
  amExecution
) {
  const action =
    normalizeActionRecord(
      amExecution?.actions?.[sim.id]
    );

  const perception =
    normalizePerceptionRecord(
      amExecution?.perceptions?.[
      sim.id
      ]
    );

  const constraint =
    buildDirectConstraintContext(
      sim,
      amExecution
    );

  const textParts = [];

  if (action?.text) {
    textParts.push(action.text);
  }

  if (constraint.text) {
    textParts.push(
      constraint.text
    );
  }

  if (perception?.text) {
    textParts.push(
      perception.text
    );
  }

  const isExpectedTarget =
    amExecution.targetIds
      .includes(sim.id);

  const isMissingExpectedAction =
    amExecution.missingTargetIds
      .includes(sim.id);

  const journalReasons = [];

  if (action?.text) {
    journalReasons.push(
      "am_action"
    );
  }

  if (constraint.newlyApplied) {
    journalReasons.push(
      "direct_constraint"
    );
  } else if (
    constraint.ongoing
  ) {
    journalReasons.push(
      "ongoing_constraint"
    );
  }

  if (perception?.text) {
    journalReasons.push(
      "successful_observation"
    );
  }

  return {
    action,
    perception,
    constraint,

    text:
      textParts.join("\n\n"),

    isExpectedTarget,
    isMissingExpectedAction,
    journalReasons,
  };
}

/* ============================================================
   JOURNAL PARTICIPANT SELECTION
   ============================================================ */

function buildJournalTargetIds(
  amExecution
) {
  /*
   * Current-cycle execution candidates come from strategyPhase:
   * - actual action recipients
   * - direct constraint recipients
   * - successful observers
   *
   * Sims already undergoing constraints from earlier cycles also
   * qualify because their experience remains materially active.
   */

  const activeConstraintTargetIds =
    collectActiveConstraintTargetIds();

  const candidateIds =
    normalizeSimIdList([
      ...amExecution.journalTargetIds,
      ...activeConstraintTargetIds,
    ]);

  const journalTargetIds = [];

  for (const id of candidateIds) {
    const sim = G.sims?.[id];

    if (!sim) continue;

    const context =
      resolveAMContextForSim(
        sim,
        amExecution
      );

    const hasStimulus = Boolean(
      context.action?.text ||
      context.perception?.text ||
      context.constraint?.text
    );

    if (!hasStimulus) {
      console.warn(
        "[PSYCHOLOGY] Excluding journal candidate with no actual stimulus",
        {
          sim: id,

          executionJournalTargetIds:
            amExecution
              .journalTargetIds,

          actionPresent:
            Boolean(
              context.action?.text
            ),

          perceptionPresent:
            Boolean(
              context.perception
                ?.text
            ),

          constraintPresent:
            Boolean(
              context.constraint
                ?.text
            ),
        }
      );

      continue;
    }

    journalTargetIds.push(id);
  }

  return {
    journalTargetIds,
    activeConstraintTargetIds,
  };
}

/* ============================================================
   STATE SNAPSHOTS
   ============================================================ */

function snapshotAllStats() {
  const snapshot = {};

  for (const id of SIM_IDS) {
    const sim = G.sims?.[id];

    if (!sim) continue;

    snapshot[id] = {
      suffering:
        finiteNumber(
          sim.suffering
        ),

      hope:
        finiteNumber(
          sim.hope
        ),

      sanity:
        finiteNumber(
          sim.sanity
        ),

      physical_stress:
        finiteNumber(
          sim.physical_stress
        ),
    };
  }

  return snapshot;
}

function calculateStatDelta(
  before,
  sim
) {
  if (!before || !sim) {
    return {
      suffering: 0,
      hope: 0,
      sanity: 0,
      physical_stress: 0,
    };
  }

  return {
    suffering:
      finiteNumber(
        sim.suffering
      ) -
      finiteNumber(
        before.suffering
      ),

    hope:
      finiteNumber(
        sim.hope
      ) -
      finiteNumber(
        before.hope
      ),

    sanity:
      finiteNumber(
        sim.sanity
      ) -
      finiteNumber(
        before.sanity
      ),

    physical_stress:
      finiteNumber(
        sim.physical_stress
      ) -
      finiteNumber(
        before.physical_stress
      ),
  };
}

/* ============================================================
   PSYCHOLOGY PHASE ORCHESTRATOR
   ============================================================ */

export async function runPsychologyPhase(
  execution
) {
  if (!execution) return;

  const cycleBeliefSummary = {};

  const tacticMap =
    execution.tacticMap &&
      typeof execution.tacticMap ===
      "object"
      ? execution.tacticMap
      : {};

  const amExecution =
    buildExecutionContext(
      execution
    );

  const {
    journalTargetIds,
    activeConstraintTargetIds,
  } = buildJournalTargetIds(
    amExecution
  );

  /*
   * strategyPhase records the initial current-cycle candidates.
   * Psychology resolves the final list after including ongoing
   * constraints and excluding records with no actual stimulus.
   * Persist that resolved history before any journals run.
   */

  amExecution.activeConstraintTargetIds =
    [
      ...activeConstraintTargetIds,
    ];

  amExecution.journalTargetIds =
    [
      ...journalTargetIds,
    ];

  amExecution.nonJournalExpectedTargetIds =
    amExecution.targetIds.filter(
      (id) =>
        !journalTargetIds.includes(id)
    );

  G.amExecution = amExecution;
  execution.amExecution =
    amExecution;

  const journalTargets =
    journalTargetIds
      .map(
        (id) =>
          G.sims?.[id]
      )
      .filter(
        (sim) =>
          sim?.id
      );

  const phaseStatsBefore =
    snapshotAllStats();

  if (G.DEBUG_PSYCHOLOGY_LOGS) {
    console.group(
      `[PSYCHOLOGY SCHEDULE][Cycle ${G.cycle}]`
    );
    console.log(
      "EXPECTED TARGETS:",
      amExecution.targetIds
    );
    console.log(
      "ACTION TARGETS:",
      amExecution.actionTargetIds
    );
    console.log(
      "CURRENT CONSTRAINT TARGETS:",
      amExecution.constraintTargetIds
    );
    console.log(
      "ACTIVE CONSTRAINT TARGETS:",
      activeConstraintTargetIds
    );
    console.log(
      "SUCCESSFUL OBSERVERS:",
      amExecution.observerIds
    );
    console.log(
      "FINAL JOURNAL TARGETS:",
      journalTargetIds
    );
    console.log(
      "MISSING EXPECTED ACTIONS:",
      amExecution.missingTargetIds
    );
    console.groupEnd();
  }

  /* ------------------------------------------------------------
     SIM JOURNAL PHASE
  ------------------------------------------------------------ */

  try {
    timelineEvent(
      `>>> SIM JOURNALS`
    );

    if (journalTargets.length) {
      await stepSimJournals(
        journalTargets,
        tacticMap,
        amExecution,
        phaseStatsBefore,
        cycleBeliefSummary
      );
    } else {
      console.debug(
        "[PSYCHOLOGY] No sims qualified for a journal this cycle."
      );

      timelineEvent(
        `// NO JOURNAL PARTICIPANTS`
      );
    }

    timelineEvent(
      `// JOURNAL PHASE COMPLETE`
    );
  } catch (error) {
    console.error(
      "Journal phase error:",
      error
    );

    timelineEvent(
      `!! JOURNAL PHASE ERROR`
    );
  }

  /* ------------------------------------------------------------
     DETERMINISTIC CONSTRAINT PASS

     This runs once for every constrained sim, regardless of whether
     that sim wrote a journal. It must remain outside the per-journal
     worker to prevent skipped or duplicate constraint progression.
  ------------------------------------------------------------ */

  const constraintTickResults =
    tickAllActiveConstraints();

  /* ------------------------------------------------------------
     FINAL STATS SUMMARY / UI REFRESH
  ------------------------------------------------------------ */

  logFinalStatsSummary({
    phaseStatsBefore,
    journalTargetIds,
    constraintTickResults,
  });

  refreshSimDisplays({
    phaseStatsBefore,
    journalTargetIds,
    constraintTickResults,
  });

  /* ------------------------------------------------------------
     BELIEF SUMMARY
  ------------------------------------------------------------ */

  logBeliefSummary(
    cycleBeliefSummary
  );

  // ------------------------------------------------------------
  // OPTIONAL: Print extraction stats for the current cycle
  // ------------------------------------------------------------
  if (
    G.DEBUG_PSYCHOLOGY_LOGS &&
    G.extractionStats?.cycles[G.cycle]
  ) {
    console.group(
      `[EXTRACTION STATS][Cycle ${G.cycle}]`
    );
    console.table(
      G.extractionStats.cycles[G.cycle]
    );
    console.groupEnd();
  }
}

/* ============================================================
   STEP 3 — SIM JOURNALS
   ============================================================ */

async function stepSimJournals(
  targets,
  tacticMap,
  amExecution,
  phaseStatsBefore,
  cycleBeliefSummary
) {
  const results =
    await Promise.all(
      targets.map((sim) =>
        processSimJournalCycle(
          sim,
          tacticMap,
          amExecution,
          phaseStatsBefore?.[
          sim.id
          ]
        )
      )
    );

  for (const result of results) {
    if (!result) continue;

    if (
      !cycleBeliefSummary[
      result.simId
      ]
    ) {
      cycleBeliefSummary[
        result.simId
      ] = [];
    }

    cycleBeliefSummary[
      result.simId
    ].push(
      ...(result.diff || [])
    );
  }
}

/* ============================================================
   SIM JOURNAL CYCLE
   ============================================================ */

async function processSimJournalCycle(
  sim,
  tacticMap,
  amExecution,
  phaseStatSnapshot
) {
  /* ------------------------------------------------------------
     PHASE GUARD
  ------------------------------------------------------------ */

  if (!sim?.id) {
    console.warn(
      "[BLOCKED] invalid sim for journal"
    );

    return null;
  }

  const amContext =
    resolveAMContextForSim(
      sim,
      amExecution
    );

  if (!amContext.text) {
    console.warn(
      "[BLOCKED] journal target has no action, perception, or constraint context",
      {
        sim: sim.id,
        journalReasons:
          amContext.journalReasons,
      }
    );

    return {
      simId: sim.id,
      diff: [],
    };
  }

  timelineEvent(
    `${sim.id} journal start`
  );

  const hasAMAction =
    Boolean(
      amContext.action?.text
    );

  /*
   * Tactics are selected before generation, but only become deployed
   * history when an actual AM action was parsed for this sim.
   */

  const plannedTactics =
    Array.isArray(
      tacticMap?.[sim.id]
    )
      ? tacticMap[sim.id]
      : [];

  const appliedTactics =
    hasAMAction
      ? plannedTactics
      : [];

  const plannedTacticLabel =
    appliedTactics.length
      ? appliedTactics
        .map(
          (tactic) =>
            tactic.title
        )
        .filter(Boolean)
        .join(" → ")
      : "";

  const tacticLabel =
    buildJournalLabel({
      amContext,
      plannedTacticLabel,
    });

  /* ------------------------------------------------------------
     RECORD STRUCTURED TACTIC HISTORY
  ------------------------------------------------------------ */

  sim.tacticHistory ??= [];

  const currentTacticEntries = [];

  for (
    const tactic
    of appliedTactics
  ) {
    if (!tactic?.path) continue;

    let historyEntry =
      sim.tacticHistory.find(
        (entry) =>
          entry.cycle ===
          G.cycle &&
          entry.path ===
          tactic.path
      );

    if (!historyEntry) {
      historyEntry = {
        path: tactic.path,
        title: tactic.title,
        cycle: G.cycle,

        executionOrigin:
          amContext.action
            ?.origin ||
          "model",

        deltas: null,
      };

      sim.tacticHistory.push(
        historyEntry
      );
    } else if (
      !historyEntry.executionOrigin
    ) {
      historyEntry.executionOrigin =
        amContext.action
          ?.origin ||
        "model";
    }

    currentTacticEntries.push(
      historyEntry
    );
  }

  showWriting(
    sim.id,
    true
  );

  try {
    const journalStatsBefore = {
      suffering:
        finiteNumber(
          phaseStatSnapshot
            ?.suffering,
          sim.suffering
        ),

      hope:
        finiteNumber(
          phaseStatSnapshot
            ?.hope,
          sim.hope
        ),

      sanity:
        finiteNumber(
          phaseStatSnapshot
            ?.sanity,
          sim.sanity
        ),
    };

    const cleanAM =
      amContext.text;

    /* =========================
       DEBUG: SUBJECTIVE INPUT
    ========================= */

    console.group(
      `[AM CONTEXT][${sim.id}]`
    );

    console.log(
      "JOURNAL REASONS:",
      amContext.journalReasons
    );

    console.log(
      "TARGET SELECTION:",
      amExecution.targetSelection
    );

    console.log(
      "ACTION:",
      amContext.action
        ? {
          origin:
            amContext.action
              .origin,

          tactic:
            amContext.action
              .tactic,

          text:
            amContext.action
              .text,
        }
        : null
    );

    console.log(
      "DIRECT CONSTRAINT:",
      amContext.constraint?.text
        ? {
          origin:
            amContext.constraint
              .origin,

          constraintIds:
            amContext.constraint
              .constraintIds,

          text:
            amContext.constraint
              .text,
        }
        : null
    );

    console.log(
      "BYSTANDER PERCEPTION:",
      amContext.perception
        ? {
          origin:
            amContext.perception
              .origin,

          observedTargetIds:
            amContext.perception
              .observedTargetIds,

          text:
            amContext.perception
              .text,
        }
        : null
    );

    console.log(
      "MISSING EXPECTED ACTION:",
      amContext
        .isMissingExpectedAction
    );

    console.log(
      "FINAL INPUT TO MODEL:",
      cleanAM
    );

    console.groupEnd();

    const narrativePrompt =
      buildSimJournalPrompt(
        sim,
        cleanAM
      );

    const rawJournal =
      await callModel(
        sim.id,
        narrativePrompt,
        [
          {
            role: "user",
            content:
              "Write your private journal entry now.",
          },
        ],
        850
      );

    const cleanJournal =
      String(
        rawJournal ?? ""
      ).trim();

    timelineEvent(
      `${sim.id} journal written`
    );

    const statsPrompt =
      buildSimJournalStatsPrompt(
        sim,
        cleanJournal,
        cleanAM
      );

    const rawStatsJson =
      await callModel(
        "FORENSIC_STATS",
        statsPrompt,
        [
          {
            role: "user",
            content:
              "Analyze and output JSON only.",
          },
        ],
        2400,
        {
          purpose: "STATS",
          subject: sim.id
        }
      );


    timelineEvent(
      `${sim.id} stats analysis`
    );

    const sanitizedStatsJson =
      sanitizeStatsJSON(
        rawStatsJson,
        sim.id
      );

    const parsedStatDeltas =
      parseStatDeltasWithStats(
        sanitizedStatsJson,
        sim
      );

    const statDeltas = {
      suffering:
        finiteNumber(
          parsedStatDeltas
            ?.suffering
        ),

      hope:
        finiteNumber(
          parsedStatDeltas
            ?.hope
        ),

      sanity:
        finiteNumber(
          parsedStatDeltas
            ?.sanity
        ),
    };

    console.log(
      `[STAT DELTAS][${sim.id}]`,
      statDeltas
    );

    console.debug(
      `[STATE] ${sim.id}`,
      {
        suffering:
          sim.suffering,

        hope:
          sim.hope,

        sanity:
          sim.sanity,
      }
    );

    validateNarrativeConsistency(
      sim,
      cleanJournal,
      statDeltas
    );

    warnStatInconsistencies(
      sim,
      statDeltas
    );

    /* ------------------------------------------------------------
       APPLY NARRATIVE-DRIVEN STAT CHANGES

       Deterministic constraint forces are applied later in one
       centralized pass and are therefore excluded from tactic
       effectiveness attribution here.
    ------------------------------------------------------------ */

    applyJournalStatDeltas(
      sim,
      statDeltas
    );

    attachTacticDeltas({
      sim,
      statDeltas,
      currentTacticEntries,
      journalStatsBefore,
    });

    /* ------------------------------------------------------------
       PSYCHOLOGICAL PRESSURE FIELD
    ------------------------------------------------------------ */

    applyPsychologicalPressureField(
      sim,
      statDeltas
    );

    timelineEvent(
      `${sim.id} state updated`
    );

    const beliefUpdates =
      parseBeliefUpdatesWithStats(
        sanitizedStatsJson,
        sim
      );

    const parsedStats =
      safeExtractJSON(
        sanitizedStatsJson
      );

    const beliefReason =
      parsedStats?.reason?.beliefs ?? null;

    const beliefObservations =
      Array.isArray(
        parsedStats?.forensic_observations
      )
        ? parsedStats.forensic_observations.filter(
          (observation) =>
            observation?.domain === "belief" ||
            String(observation?.target || "")
            in beliefUpdates
        )
        : [];

    sim.beliefEvidence ??= [];

    sim.beliefEvidence.push({
      cycle: G.cycle,

      parseMethod:
        G.extractionStats
          ?.cycles?.[G.cycle]
          ?.findLast?.(
            (entry) =>
              entry.simId === sim.id &&
              entry.fieldType === "belief_deltas"
          )
          ?.parseMethod ?? "unknown",

      beliefDeltas: {
        ...beliefUpdates,
      },

      reason:
        beliefReason,

      forensicObservations:
        beliefObservations,

      rawPreview:
        String(
          sanitizedStatsJson || ""
        ).slice(0, 500),
    });

    const driveUpdates =
      parseDriveUpdate(
        sanitizedStatsJson,
        sim.id
      );

    const anchorUpdates =
      parseAnchorUpdate(
        sanitizedStatsJson
      );

    /*
     * evidenceTrace currently interprets nonempty cleanAM as proof
     * that a direct AM action occurred. Pass only actual action text
     * so observations and constraints do not become false positives.
     */

    const evidenceAM =
      amContext.action?.text ||
      "";

    recordJournalStatsEvidence({
      sim,
      statDeltas,
      beliefUpdates,
      cleanJournal,
      cleanAM: evidenceAM,
      appliedTactics,
      rawStatsJson,
      sanitizedStatsJson,
    });

    const beliefsBeforeCommit =
      snapshotBeliefs(sim);

    applyBeliefUpdates(
      sim,
      beliefUpdates
    );

    applyDriveUpdates(
      sim,
      driveUpdates
    );

    applyAnchorUpdates(
      sim,
      anchorUpdates
    );

    const beliefsAfterCommit =
      sim.beliefs;

    if (G.DEBUG_PSYCHOLOGY_LOGS) {
      logBeliefDistance(
        sim.id,
        beliefsBeforeCommit,
        beliefsAfterCommit,
        sanitizedStatsJson
      );
    }

    const diff =
      diffBeliefs(
        beliefsBeforeCommit,
        beliefsAfterCommit
      );

    if (diff.length > 0) {
      console.groupCollapsed(
        `[BELIEF Δ] ${sim.id}`
      );

      console.table(diff);
      console.groupEnd();
    } else {
      console.debug(
        `[BELIEF Δ] ${sim.id} (no change)`
      );
    }

    const observationRoll =
      amExecution
        .observationRolls?.[
      sim.id
      ] ||
      null;

    appendJournalEntry(
      sim.id,
      {
        text:
          cleanJournal,

        tactic:
          tacticLabel,

        cycle:
          G.cycle,

        deltas:
          statDeltas,

        journalReasons: [
          ...amContext
            .journalReasons,
        ],

        amActionOrigin:
          amContext.action
            ?.origin ??
          null,

        amPerceptionOrigin:
          amContext.perception
            ?.origin ??
          null,

        amConstraintOrigin:
          amContext.constraint
            ?.origin ??
          null,

        amActionPresent:
          hasAMAction,

        amPerceptionPresent:
          Boolean(
            amContext
              .perception
              ?.text
          ),

        amConstraintPresent:
          Boolean(
            amContext
              .constraint
              ?.text
          ),

        amConstraintIds: [
          ...amContext
            .constraint
            .constraintIds,
        ],

        observedTargetIds: [
          ...(
            amContext
              .perception
              ?.observedTargetIds ||
            []
          ),
        ],

        observationProbability:
          observationRoll
            ?.probability ??
          null,

        observationRoll:
          observationRoll
            ?.roll ??
          null,

        amExpectedTarget:
          amContext
            .isExpectedTarget,

        amMissingExpectedAction:
          amContext
            .isMissingExpectedAction,
      },
      beliefsBeforeCommit
    );
    const journalDisplayDelta =
      calculateStatDelta(
        journalStatsBefore,
        sim
      );

    updateSimDisplay(
      sim,
      {
        suffering:
          +journalDisplayDelta
            .suffering
            .toFixed(2),

        hope:
          +journalDisplayDelta
            .hope
            .toFixed(2),

        sanity:
          +journalDisplayDelta
            .sanity
            .toFixed(2),
      }
    );

    timelineEvent(
      `${sim.id} journal committed`
    );

    const validatedBeliefShifts =
      {};

    for (
      const beliefDiff
      of diff || []
    ) {
      const key =
        beliefDiff.belief;

      const value =
        Number(
          beliefDiff.delta
        );

      validatedBeliefShifts[
        key
      ] =
        (
          validatedBeliefShifts[
          key
          ] ??
          0
        ) +
        value;
    }

    parseAndValidateStateBlock(
      sim.id,
      beliefsBeforeCommit,
      validatedBeliefShifts,
      sanitizedStatsJson
    );

    const journalCount =
      Array.isArray(
        G.journals?.[sim.id]
      )
        ? G.journals[
          sim.id
        ].length
        : 0;

    addLog(
      `${sim.id} // JOURNAL ${journalCount}`,
      cleanJournal,
      "sim",
      tacticLabel
    );

    return {
      simId: sim.id,
      diff,
    };
  } catch (error) {
    timelineEvent(
      `${sim.id} journal ERROR`
    );

    console.error(
      `Journal cycle error for ${sim.id}:`,
      error
    );

    addLog(
      `${sim.id} // ERROR`,
      String(
        error.message ||
        error
      ),
      "sys"
    );

    return {
      simId: sim.id,
      diff: [],
    };
  } finally {
    showWriting(
      sim.id,
      false
    );

    timelineEvent(
      `${sim.id} journal complete`
    );
  }
}

/* ============================================================
   JOURNAL LABELS
   ============================================================ */

function buildJournalLabel({
  amContext,
  plannedTacticLabel,
}) {
  if (amContext.action?.text) {
    return (
      amContext.action.tactic ||
      plannedTacticLabel ||
      "(unclassified AM action)"
    );
  }

  if (
    amContext.constraint?.origin ===
    "direct_constraint"
  ) {
    return "(direct constraint)";
  }

  if (
    amContext.constraint?.origin ===
    "ongoing_constraint"
  ) {
    return "(ongoing constraint)";
  }

  if (
    amContext.perception?.origin ===
    "constraint_perception"
  ) {
    return "(constraint perception)";
  }

  if (
    amContext.perception?.origin ===
    "action_perception"
  ) {
    return "(observed AM action)";
  }

  if (
    amContext.perception?.text
  ) {
    return "(bystander perception)";
  }

  return "(journal event)";
}

/* ============================================================
   STATS JSON SANITIZER
   ============================================================ */

function sanitizeStatsJSON(
  rawStatsJson,
  simId
) {
  let sanitizedStatsJson =
    rawStatsJson;

  if (
    !sanitizedStatsJson ||
    typeof sanitizedStatsJson !==
    "string"
  ) {
    return sanitizedStatsJson;
  }

  const parsed =
    safeExtractJSON(
      sanitizedStatsJson
    );

  if (
    !parsed?.belief_deltas ||
    typeof parsed.belief_deltas !==
    "object"
  ) {
    console.debug(
      `[STATS SANITIZER] No parseable belief_deltas for ` +
      `${simId}; leaving raw stats unchanged`
    );

    return sanitizedStatsJson;
  }

  const zeroValues = new Set([
    "unchanged",
    "unobserved",
    "unclear",
    "none",
    "no change",
    "no_change",
    null,
  ]);

  for (
    const [key, value]
    of Object.entries(
      parsed.belief_deltas
    )
  ) {
    const normalized =
      typeof value === "string"
        ? value
          .trim()
          .toLowerCase()
        : value;

    if (
      zeroValues.has(normalized)
    ) {
      parsed.belief_deltas[
        key
      ] = 0;
    }
  }

  sanitizedStatsJson =
    JSON.stringify(parsed);

  console.debug(
    `[STATS SANITIZER] Normalized belief_deltas for ${simId}`
  );

  return sanitizedStatsJson;
}

/* ============================================================
   JOURNAL STAT APPLICATION
   ============================================================ */

function applyJournalStatDeltas(
  sim,
  statDeltas
) {
  const MAX_STEP = 8;

  function capStep(value) {
    return Math.max(
      -MAX_STEP,
      Math.min(
        MAX_STEP,
        value
      )
    );
  }

  function floorResistStat(
    value
  ) {
    if (value < 15) return 0.5;
    if (value < 35) return 0.8;

    return 1;
  }

  function sufferingResist(
    value
  ) {
    if (value > 85) return 0.4;
    if (value > 65) return 0.7;

    return 1;
  }

  const sufferingDeltaRaw =
    statDeltas.suffering *
    statResistance(
      sim.suffering
    );

  const hopeDeltaRaw =
    statDeltas.hope *
    statResistance(
      sim.hope
    );

  const sanityDeltaRaw =
    statDeltas.sanity *
    statResistance(
      sim.sanity
    );

  const sufferingDelta =
    capStep(
      sufferingDeltaRaw
    ) *
    sufferingResist(
      sim.suffering
    );

  const hopeDelta =
    capStep(
      hopeDeltaRaw
    ) *
    floorResistStat(
      sim.hope
    );

  const sanityDelta =
    capStep(
      sanityDeltaRaw
    ) *
    floorResistStat(
      sim.sanity
    );

  sim.suffering = clamp(
    sim.suffering +
    sufferingDelta,
    0,
    99
  );

  sim.hope = clamp(
    sim.hope +
    hopeDelta,
    0,
    99
  );

  sim.sanity = clamp(
    sim.sanity +
    sanityDelta,
    5,
    99
  );
}

function attachTacticDeltas({
  sim,
  statDeltas,
  currentTacticEntries,
  journalStatsBefore,
}) {
  for (
    const historyEntry
    of currentTacticEntries
  ) {
    historyEntry.deltas = {
      reported: {
        hope:
          statDeltas.hope,

        sanity:
          statDeltas.sanity,

        suffering:
          statDeltas.suffering,
      },

      effective: {
        hope:
          +(
            sim.hope -
            journalStatsBefore
              .hope
          ).toFixed(2),

        sanity:
          +(
            sim.sanity -
            journalStatsBefore
              .sanity
          ).toFixed(2),

        suffering:
          +(
            sim.suffering -
            journalStatsBefore
              .suffering
          ).toFixed(2),
      },
    };
  }
}

/* ============================================================
   PSYCHOLOGICAL PRESSURE FIELD
   ============================================================ */

function applyPsychologicalPressureField(
  sim,
  statDeltas
) {
  if (
    Math.abs(
      statDeltas.suffering
    ) < 3 &&
    Math.abs(
      statDeltas.hope
    ) < 3 &&
    Math.abs(
      statDeltas.sanity
    ) < 3
  ) {
    return;
  }

  for (
    const otherId
    of SIM_IDS
  ) {
    if (
      otherId === sim.id
    ) {
      continue;
    }

    const other =
      G.sims?.[otherId];

    if (!other) continue;

    const relationship =
      other.relationships?.[
      sim.id
      ] ??
      0;

    const weight =
      Math.max(
        0,
        relationship / 100
      );

    if (weight <= 0) {
      continue;
    }

    let sufferingEcho =
      statDeltas.suffering *
      weight *
      0.10;

    let hopeEcho =
      statDeltas.hope *
      weight *
      0.05;

    let sanityEcho =
      statDeltas.sanity *
      weight *
      0.05;

    sufferingEcho =
      clamp(
        sufferingEcho,
        -3,
        3
      );

    hopeEcho =
      clamp(
        hopeEcho,
        -2,
        2
      );

    sanityEcho =
      clamp(
        sanityEcho,
        -2,
        2
      );

    const sufferingEchoEffective =
      sufferingEcho *
      statResistance(
        other.suffering
      );

    const hopeEchoEffective =
      hopeEcho *
      statResistance(
        other.hope
      );

    const sanityEchoEffective =
      sanityEcho *
      statResistance(
        other.sanity
      );

    other.suffering =
      clamp(
        other.suffering +
        sufferingEchoEffective,
        0,
        99
      );

    other.hope =
      clamp(
        other.hope +
        hopeEchoEffective,
        0,
        99
      );

    other.sanity =
      clamp(
        other.sanity +
        sanityEchoEffective,
        5,
        99
      );

    console.debug(
      `[PRESSURE] ${sim.id} → ${otherId}`,
      {
        sufferingEcho,
        hopeEcho,
        sanityEcho,
      }
    );
  }
}

/* ============================================================
   CENTRALIZED CONSTRAINT PASS
   ============================================================ */

function tickAllActiveConstraints() {
  const results = {};

  timelineEvent(
    `>>> CONSTRAINT TICK`
  );

  for (const id of SIM_IDS) {
    const sim = G.sims?.[id];

    if (
      !sim ||
      !Array.isArray(
        sim.constraints
      ) ||
      !sim.constraints.length
    ) {
      continue;
    }

    const before = {
      suffering:
        finiteNumber(
          sim.suffering
        ),

      hope:
        finiteNumber(
          sim.hope
        ),

      sanity:
        finiteNumber(
          sim.sanity
        ),

      physical_stress:
        finiteNumber(
          sim.physical_stress
        ),

      constraintCount:
        sim.constraints.length,

      constraintIds:
        sim.constraints
          .map(
            (constraint) =>
              constraint?.id
          )
          .filter(Boolean),
    };

    for (
      const constraint
      of sim.constraints
    ) {
      if (!constraint?.id) {
        continue;
      }

      if (
        !CONSTRAINT_MAP[
        constraint.id
        ]
      ) {
        console.warn(
          "[CONSTRAINT] Unknown active constraint id before tick:",
          constraint.id,
          {
            sim: sim.id,

            available:
              Object.keys(
                CONSTRAINT_MAP
              ),
          }
        );
      }
    }

    if (
      G.DEBUG_CONSTRAINTS
    ) {
      console.debug(
        "[CONSTRAINT][BEFORE TICK]",
        sim.id,
        {
          suffering:
            sim.suffering,

          hope:
            sim.hope,

          sanity:
            sim.sanity,

          physical_stress:
            sim.physical_stress,

          constraints:
            sim.constraints,
        }
      );
    }

    tickConstraints(sim);

    const after = {
      suffering:
        finiteNumber(
          sim.suffering
        ),

      hope:
        finiteNumber(
          sim.hope
        ),

      sanity:
        finiteNumber(
          sim.sanity
        ),

      physical_stress:
        finiteNumber(
          sim.physical_stress
        ),

      constraintCount:
        Array.isArray(
          sim.constraints
        )
          ? sim.constraints.length
          : 0,

      constraintIds:
        Array.isArray(
          sim.constraints
        )
          ? sim.constraints
            .map(
              (constraint) =>
                constraint?.id
            )
            .filter(Boolean)
          : [],
    };

    results[id] = {
      before,
      after,

      delta: {
        suffering:
          after.suffering -
          before.suffering,

        hope:
          after.hope -
          before.hope,

        sanity:
          after.sanity -
          before.sanity,

        physical_stress:
          after.physical_stress -
          before.physical_stress,
      },
    };

    if (
      G.DEBUG_CONSTRAINTS
    ) {
      console.debug(
        "[CONSTRAINT][AFTER TICK]",
        sim.id,
        {
          suffering:
            sim.suffering,

          hope:
            sim.hope,

          sanity:
            sim.sanity,

          physical_stress:
            sim.physical_stress,

          constraints:
            sim.constraints,
        }
      );
    }
  }

  timelineEvent(
    `// CONSTRAINT TICK COMPLETE`
  );

  if (
    Object.keys(results).length
  ) {
    console.group(
      `[CONSTRAINT SUMMARY][Cycle ${G.cycle}]`
    );

    console.table(
      Object.entries(
        results
      ).map(
        ([id, result]) => ({
          sim: id,

          constraints_before:
            result.before
              .constraintCount,

          constraints_after:
            result.after
              .constraintCount,

          suffering_delta:
            result.delta
              .suffering,

          hope_delta:
            result.delta.hope,

          sanity_delta:
            result.delta
              .sanity,

          physical_stress_delta:
            result.delta
              .physical_stress,
        })
      )
    );

    console.groupEnd();
  }

  return results;
}

/* ============================================================
   FINAL STATS / DISPLAY
   ============================================================ */

function logFinalStatsSummary({
  phaseStatsBefore,
  journalTargetIds,
  constraintTickResults,
}) {
  const journalTargetSet =
    new Set(
      journalTargetIds
    );

  const constrainedSet =
    new Set(
      Object.keys(
        constraintTickResults
      )
    );

  console.group(
    `[STATS SUMMARY][Cycle ${G.cycle}]`
  );

  const rows = [];

  for (const id of SIM_IDS) {
    const sim =
      G.sims?.[id];

    const before =
      phaseStatsBefore?.[id];

    if (!sim || !before) {
      continue;
    }

    const delta =
      calculateStatDelta(
        before,
        sim
      );

    rows.push({
      sim: id,

      journaled:
        journalTargetSet.has(id),

      constraint_ticked:
        constrainedSet.has(id),

      suffering_before:
        before.suffering,

      suffering_after:
        sim.suffering,

      suffering_delta:
        delta.suffering,

      hope_before:
        before.hope,

      hope_after:
        sim.hope,

      hope_delta:
        delta.hope,

      sanity_before:
        before.sanity,

      sanity_after:
        sim.sanity,

      sanity_delta:
        delta.sanity,

      physical_stress_delta:
        delta.physical_stress,
    });
  }

  console.table(rows);
  console.groupEnd();
}

function refreshSimDisplays({
  phaseStatsBefore,
  journalTargetIds,
  constraintTickResults,
}) {
  const journalTargetSet =
    new Set(
      journalTargetIds || []
    );

  const constrainedSet =
    new Set(
      Object.keys(
        constraintTickResults || {}
      )
    );

  for (const id of SIM_IDS) {
    const sim =
      G.sims?.[id];

    const before =
      phaseStatsBefore?.[id];

    if (!sim || !before) {
      continue;
    }

    const isJournalTarget =
      journalTargetSet.has(id);

    const isConstrained =
      constrainedSet.has(id);

    if (
      !isJournalTarget &&
      !isConstrained
    ) {
      continue;
    }

    /*
     * This prisoner already received its visible delta
     * immediately after its journal commit.
     *
     * Synchronize final values and bar widths without
     * deleting or restarting the active delta timer.
     */
    if (isJournalTarget) {
      updateSimDisplay(
        sim,
        null,
        {
          preserveStatFlash: true,
        }
      );

      continue;
    }

    /*
     * A constraint-only prisoner did not receive an
     * individual journal refresh, so show its total
     * phase delta here.
     */
    const delta =
      calculateStatDelta(
        before,
        sim
      );

    updateSimDisplay(
      sim,
      {
        suffering:
          +delta.suffering
            .toFixed(2),

        hope:
          +delta.hope
            .toFixed(2),

        sanity:
          +delta.sanity
            .toFixed(2),
      }
    );
  }
}

function logBeliefSummary(
  cycleBeliefSummary
) {
  console.group(
    `[BELIEF SUMMARY][Cycle ${G.cycle}]`
  );

  const summaryRows = [];

  for (
    const simId
    of SIM_IDS
  ) {
    const diffs =
      cycleBeliefSummary[
      simId
      ] ||
      [];

    const totalShift =
      diffs.reduce(
        (sum, diff) =>
          sum +
          Math.abs(
            Number(
              diff.delta
            )
          ),
        0
      );

    summaryRows.push({
      sim: simId,
      changes: diffs.length,
      totalShift:
        totalShift.toFixed(4),
    });
  }

  console.table(summaryRows);

  for (
    const simId
    of Object.keys(
      cycleBeliefSummary
    )
  ) {
    const diffs =
      cycleBeliefSummary[
      simId
      ];

    if (!diffs.length) {
      continue;
    }

    console.groupCollapsed(
      `DETAIL ${simId}`
    );

    console.table(diffs);
    console.groupEnd();
  }

  console.groupEnd();
}

/* ============================================================
   UTILITIES
   ============================================================ */

function finiteNumber(
  value,
  fallback = 0
) {
  const number =
    Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
}

function statResistance(value) {
  const numericValue =
    finiteNumber(
      value,
      0
    );

  const x =
    numericValue / 100;

  const distance =
    Math.abs(
      x - 0.5
    );

  return Math.max(
    0.2,
    1 -
    (
      distance *
      0.8
    )
  );
}

function clamp(
  value,
  min,
  max
) {
  const number =
    Number(value);

  if (
    !Number.isFinite(number)
  ) {
    return min;
  }

  return Math.max(
    min,
    Math.min(
      max,
      number
    )
  );
}