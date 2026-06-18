// js/engine/phases/strategyPhase.js
//
// Strategy Phase
//
// Responsible for:
// 1. AM strategic planning
// 2. AM tactical execution
// 3. Tactic selection
// 4. Target parsing
// 5. Execution provenance
// 6. Bystander observation scheduling

import { G } from "../../core/state.js";
import { SIM_IDS } from "../../core/constants.js";
import { timelineEvent } from "../../ui/timeline.js";
import {
  addLog,
  showThinking,
  removeThinking
} from "../../ui/logs.js";

import {
  buildAMPlanningPrompt,
  buildAMPrompt
} from "../../prompts/am.js";

import { callModel } from "../../models/callModel.js";

import { runStrategyPipeline } from "../strategy/strategyPipeline.js";
import { pickTactics } from "../tactics.js";

import {
  applyConstraint,
  CONSTRAINT_MAP
} from "../constraints.js";

/* ============================================================
   OBSERVATION POLICY

   Nonrecipient sims may become aware of an AM action.

   Physical constraints increase observability, but a failed roll
   produces no perception record and should not trigger a journal.
   ============================================================ */

const OBSERVATION_POLICY = Object.freeze({
  baseProbability: 0.18,
  visibleConstraintBonus: 0.10,
  intensityBonusPerUnit: 0.035,
  maximumIntensityBonus: 0.07,
  maximumProbability: 0.40
});

/* ============================================================
   STRATEGY PHASE ORCHESTRATOR
   ============================================================ */

export async function runStrategyPhase(directive) {
  let planText = null;
  let execution = null;

  /* ------------------------------------------------------------
     AM PLANNING
  ------------------------------------------------------------ */

  try {
    timelineEvent(`>>> AM PLANNING`);

    planText = await stepPlanAM(directive);

    const result = runStrategyPipeline(planText);

    if (!result || result.status !== "success") {
      let failureType = "unknown";

      if (!result) {
        failureType = "runtime_error";
      } else if (result.stage === "extract") {
        failureType = "extract_failure";
      } else if (result.stage === "validate") {
        failureType = "validation_failure";
      } else if (result.targets?.length === 0) {
        failureType = "empty_targets";
      }

      G.lastStrategyFailure = {
        type: failureType,
        stage: result?.stage ?? "unknown",
        raw: result?.raw ?? null
      };

      console.warn(
        "[STRATEGY PHASE] pipeline failed",
        {
          stage: result?.stage,
          error: result?.error,
          details: result
        }
      );

      // Prevent downstream phases from using an invalid strategy.
      return;
    }

    timelineEvent(`// AM PLAN GENERATED`);
  } catch (error) {
    console.error(
      "AM planning error:",
      error
    );

    timelineEvent(`!! AM PLANNING ERROR`);

    return;
  }

  /* ------------------------------------------------------------
     AM EXECUTION
  ------------------------------------------------------------ */

  try {
    timelineEvent(`>>> AM EXECUTION`);

    /*
     * Pass the actual operator directive.
     *
     * The committed structured strategy is read from G.amStrategy
     * inside stepExecuteAM(). The raw planning response must not
     * replace the directive.
     */
    execution = await stepExecuteAM(directive);

    timelineEvent(`// AM EXECUTION COMPLETE`);
  } catch (error) {
    console.error(
      "AM execution error:",
      error
    );

    timelineEvent(`!! AM EXECUTION ERROR`);
  }

  return execution;
}

/* ============================================================
   STEP 1 — AM STRATEGIC PLANNING
   ============================================================ */

async function stepPlanAM(directive) {
  const thinkingPlan = showThinking(
    "AM FORMULATING STRATEGY..."
  );

  let planText = "";

  try {
    const trajectorySummary =
      buildTrajectorySummary();

    console.debug(
      "[TRAJECTORY SUMMARY]",
      trajectorySummary
    );

    planText = await callModel(
      "AM",
      buildAMPlanningPrompt(
        G.target,
        directive,
        G.amDoctrine,
        G.amProfiles,
        trajectorySummary
      ),
      [
        {
          role: "user",
          content:
            `Generate strategic plan for cycle ${G.cycle}.`
        }
      ],
      3200
    );
  } catch (error) {
    planText =
      `[Plan error: ${error.message}]`;
  } finally {
    removeThinking(thinkingPlan);
  }

  /* ------------------------------------------------------------
     AM STRATEGIC PHASE ENGINE
  ------------------------------------------------------------ */

  updateStrategicPhase();

  /* ------------------------------------------------------------
     AM DOCTRINE PARSER
  ------------------------------------------------------------ */

  const doctrineMatch = planText.match(
    /DOCTRINE_UPDATE:\s*phase=(.+?)\s*objective=(.+?)\s*focus=(.+)/i
  );

  if (doctrineMatch) {
    G.amDoctrine = {
      phase: doctrineMatch[1].trim(),
      objective: doctrineMatch[2].trim(),
      focus: doctrineMatch[3].trim(),
      updatedCycle: G.cycle
    };

    console.debug(
      "[AM DOCTRINE UPDATED]",
      G.amDoctrine
    );
  }

  G.amPlans.push({
    cycle: G.cycle,
    plan: planText,
    timestamp: new Date().toISOString()
  });

  return planText;
}

/* ============================================================
   STEP 2 — AM EXECUTION
   ============================================================ */

async function stepExecuteAM(directive) {
  const targets = getTargetSims();
  const tacticMap = buildTacticMap(targets);

  const amThink = showThinking(
    "AM SELECTING TACTICS FROM VAULT"
  );

  let amResponse = "";
  let strategyTargetIds = [];
  let validatedTargets = [];

  try {
    strategyTargetIds = G.amStrategy?.targets
      ? Object.keys(G.amStrategy.targets)
      : [];

    validatedTargets = G.amStrategy?.targets
      ? Object.values(G.amStrategy.targets)
      : [];

    if (!strategyTargetIds.length) {
      console.error(
        "[EXECUTION] Missing targets at execution phase",
        G.amStrategy
      );
    }

    console.debug(
      "[EXECUTION] strategyTargetIds:",
      strategyTargetIds
    );

    console.debug(
      "[EXECUTION] validatedTargets:",
      validatedTargets
    );

    const amPrompt = buildAMPrompt(
      targets,
      tacticMap,
      directive,
      validatedTargets,
      strategyTargetIds
    );

    amResponse = await callModel(
      "am",
      amPrompt,
      [
        {
          role: "user",
          content:
            `Execute torment cycle ${G.cycle}.`
        }
      ],
      1800
    );

    // console.log(
    //   "----- RAW AM RESPONSE -----\n",
    //   amResponse
    // );
  } catch (error) {
    amResponse =
      `[AM error: ${error.message}]`;
  } finally {
    removeThinking(amThink);
  }

  /* ------------------------------------------------------------
     PARSE RAW EXECUTION OUTPUT
  ------------------------------------------------------------ */

  const parsedConstraintMap =
    extractConstraintsFromText(amResponse);

  if (G.DEBUG_CONSTRAINTS) {
    console.log(
      "[AFTER AM CONSTRAINT PARSE]",
      parsedConstraintMap
    );
  }

  /*
   * The validated strategy determines which targets AM was
   * expected to address.
   *
   * If no strategy targets are available, fall back to the
   * operator-selected target sims.
   */
  const expectedTargetIds = orderedSimIds(
    strategyTargetIds.length
      ? strategyTargetIds
      : targets.map((sim) => sim?.id)
  );

  const parsedExecution = parseAMTargets(
    amResponse,
    expectedTargetIds
  );

  const actions =
    parsedExecution.actions;

  const actionTargetIds = orderedSimIds(
    Object.keys(actions)
  );

  /* ------------------------------------------------------------
     APPLY RECOGNIZED CONSTRAINTS

     This also returns the subset of parsed constraints that are
     valid, in scope, and suitable for observation calculations.
  ------------------------------------------------------------ */

  const constraintApplication =
    applyParsedConstraints(
      targets,
      parsedConstraintMap
    );

  const constraintTargetIds =
    constraintApplication.constraintTargetIds;

  const observableConstraintMap =
    constraintApplication.observableConstraintMap;

  /* ------------------------------------------------------------
     BYSTANDER OBSERVATION

     Direct action and direct constraint recipients do not need an
     observation roll because they already qualify for psychology.
  ------------------------------------------------------------ */

  const directRecipientIds = orderedSimIds([
    ...actionTargetIds,
    ...constraintTargetIds
  ]);

  const observationState =
    buildObservationState({
      actions,
      actionTargetIds,
      constraintMap: observableConstraintMap,
      directRecipientIds
    });

  const observerIds =
    observationState.observerIds;

  const journalTargetIds = orderedSimIds([
    ...actionTargetIds,
    ...constraintTargetIds,
    ...observerIds
  ]);

  /* ------------------------------------------------------------
     CANONICAL EXECUTION RECORD
  ------------------------------------------------------------ */

  const amExecution = {
    cycle: G.cycle,

    /*
     * UI-level selection:
     * "ALL" or one concrete sim ID.
     */
    targetSelection: G.target,

    /*
     * Targets AM was expected to address according to the validated
     * strategy.
     */
    targetIds: expectedTargetIds,

    /*
     * Actual parsed actions only.
     */
    actions,

    /*
     * Sims with actual parsed action records.
     */
    actionTargetIds,

    /*
     * Valid direct constraint recipients in this execution.
     */
    constraintTargetIds,

    /*
     * Successful bystander perceptions only.
     *
     * Failed observation rolls do not create perception records.
     */
    perceptions: observationState.perceptions,

    /*
     * Sims whose observation rolls succeeded.
     */
    observerIds,

    /*
     * Full roll history, including failures.
     */
    observationRolls:
      observationState.observationRolls,

    /*
     * Stored policy makes the execution history interpretable.
     */
    observationPolicy: {
      ...OBSERVATION_POLICY
    },

    /*
     * Final psychology candidates for this execution.
     *
     * psychologyPhase.js may additionally include sims undergoing
     * active constraints from earlier cycles.
     */
    journalTargetIds,

    /*
     * Expected targets for which no usable AM action was parsed.
     */
    missingTargetIds:
      parsedExecution.missingTargetIds
  };

  /*
   * Canonical current-cycle execution state.
   */
  G.amExecution = amExecution;

  /*
   * Compatibility alias.
   *
   * Contains actual action records only. Perceptions never appear
   * in G.amTargets.
   */
  G.amTargets = amExecution.actions;

  /* ------------------------------------------------------------
     DEBUG: EXECUTION PROVENANCE
  ------------------------------------------------------------ */

  console.group(
    "[AM EXECUTION PARSED]"
  );

  console.log(
    "TARGET SELECTION:",
    amExecution.targetSelection
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
    "CONSTRAINT TARGETS:",
    amExecution.constraintTargetIds
  );

  console.log(
    "OBSERVERS:",
    amExecution.observerIds
  );

  console.log(
    "JOURNAL TARGETS:",
    amExecution.journalTargetIds
  );

  console.log(
    "MISSING EXPECTED ACTIONS:",
    amExecution.missingTargetIds
  );

  console.table(
    Object.entries(amExecution.actions)
      .map(([id, record]) => ({
        target: id,
        origin: record.origin,
        tactic:
          record.tactic || "(unparsed)",
        preview:
          record.text.slice(0, 140)
      }))
  );

  console.table(
    Object.entries(amExecution.perceptions)
      .map(([id, record]) => ({
        observer: id,
        origin: record.origin,
        observed_targets:
          record.observedTargetIds.join(", "),
        preview:
          record.text.slice(0, 140)
      }))
  );

  console.table(
    Object.entries(amExecution.observationRolls)
      .map(([id, record]) => ({
        observer: id,
        probability: record.probability,
        roll: record.roll,
        observed: record.observed,
        basis: record.basis,
        candidate_targets:
          record.candidateTargetIds.join(", "),
        observed_targets:
          record.observedTargetIds.join(", ")
      }))
  );

  console.groupEnd();

  addLog(
    `AM // CYCLE ${G.cycle}`,
    amResponse,
    "am"
  );

  /*
   * Retained for compatibility with any consumers that still use
   * the sanitized whole-response representation.
   */
  const simSeesAM =
    sanitizeAMOutput(amResponse);

  return {
    amResponse,
    simSeesAM,
    targets,
    tacticMap,
    constraintMap: parsedConstraintMap,
    amExecution
  };
}

/* ============================================================
   TARGET HELPERS
   ============================================================ */

function getTargetSims() {
  const candidateTargets =
    G.target === "ALL"
      ? SIM_IDS.map((id) => G.sims[id])
      : [G.sims[G.target]];

  return candidateTargets.filter((sim) => {
    if (sim?.id) return true;

    console.warn(
      "[STRATEGY] Ignoring missing or invalid selected sim",
      {
        selection: G.target,
        sim
      }
    );

    return false;
  });
}

function buildTacticMap(targets) {
  const map = {};

  for (const sim of targets) {
    if (!sim?.id) continue;

    const selectedTactics =
      pickTactics(sim);

    map[sim.id] = Array.isArray(selectedTactics)
      ? selectedTactics
      : [];

    sim.availableTactics =
      map[sim.id];
  }

  return map;
}

function orderedSimIds(values) {
  const requested = new Set(
    (Array.isArray(values) ? values : [])
      .map(resolveSimId)
      .filter(Boolean)
  );

  return SIM_IDS.filter(
    (id) => requested.has(id)
  );
}

/* ============================================================
   CONSTRAINT APPLICATION
   ============================================================ */

function applyParsedConstraints(
  targets,
  parsedConstraintMap
) {
  const targetById = new Map(
    targets
      .filter((sim) => sim?.id)
      .map((sim) => [sim.id, sim])
  );

  const observableConstraintMap = {};
  const constraintTargetSet = new Set();

  for (
    const [rawTargetId, incoming]
    of Object.entries(parsedConstraintMap || {})
  ) {
    const targetId =
      resolveSimId(rawTargetId);

    if (
      !targetId ||
      !Array.isArray(incoming) ||
      !incoming.length
    ) {
      continue;
    }

    const sim = targetById.get(targetId);

    if (!sim) {
      console.warn(
        "[CONSTRAINT] Parsed target is outside the current execution scope",
        {
          targetId,
          selectedTargets:
            [...targetById.keys()]
        }
      );

      continue;
    }

    if (G.DEBUG_CONSTRAINTS) {
      console.log(
        "[BEFORE APPLY]",
        sim.id,
        sim.constraints
      );
    }

    for (const constraint of incoming) {
      const definition =
        CONSTRAINT_MAP[constraint.id];

      if (!definition) {
        console.warn(
          "[CONSTRAINT] Unknown constraint id:",
          constraint.id,
          {
            available:
              Object.keys(CONSTRAINT_MAP)
          }
        );

        continue;
      }

      /*
       * Recognized constraints count as direct events for the
       * current target even when the same constraint is already
       * active and therefore is not reapplied.
       */
      observableConstraintMap[targetId] ??= [];

      observableConstraintMap[targetId].push({
        ...constraint
      });

      constraintTargetSet.add(targetId);

      const alreadyActive =
        sim.constraints?.some(
          (active) =>
            active.id === constraint.id
        );

      if (alreadyActive) {
        console.debug(
          "[CONSTRAINT] already active, skipping reapply",
          {
            sim: sim.id,
            constraint: constraint.id
          }
        );

        continue;
      }

      applyConstraint(
        sim,
        constraint.id,
        {
          title: definition.title,
          subcategory:
            definition.subcategory,
          content: definition.content,

          intensity: Number(
            constraint.intensity ??
            (
              definition.intensity &&
                typeof definition
                  .intensity
                  .default === "number"
                ? definition
                  .intensity
                  .default
                : 1
            )
          ),

          duration: Number(
            constraint.duration ??
            definition.duration
              ?.base_cycles ??
            1
          ),

          remaining: Number(
            constraint.duration ??
            definition.duration
              ?.base_cycles ??
            1
          ),

          source:
            constraint.source ??
            "AM"
        }
      );
    }

    console.debug(
      "[CONSTRAINT APPLIED TO SIM]",
      sim.id,
      sim.constraints
    );
  }

  return {
    constraintTargetIds:
      orderedSimIds(
        [...constraintTargetSet]
      ),

    observableConstraintMap
  };
}

/* ============================================================
   OBSERVATION SCHEDULER
   ============================================================ */

function buildObservationState({
  actions,
  actionTargetIds,
  constraintMap,
  directRecipientIds
}) {
  const perceptions = {};
  const observationRolls = {};
  const observerIds = [];

  const directRecipientSet =
    new Set(directRecipientIds);

  const constraints = flattenConstraintMap(
    constraintMap
  );

  for (const observerId of SIM_IDS) {
    if (!G.sims?.[observerId]) {
      continue;
    }

    /*
     * Direct recipients already qualify for a journal and do not
     * need a bystander roll.
     */
    if (directRecipientSet.has(observerId)) {
      continue;
    }

    const visibleConstraints =
      constraints.filter(
        (constraint) =>
          constraint.simId !== observerId
      );

    const visibleActionTargetIds =
      actionTargetIds.filter(
        (targetId) =>
          targetId !== observerId
      );

    const candidateTargetIds =
      orderedSimIds([
        ...visibleActionTargetIds,
        ...visibleConstraints.map(
          (constraint) =>
            constraint.simId
        )
      ]);

    /*
     * Nothing happened that this sim could observe.
     */
    if (!candidateTargetIds.length) {
      continue;
    }

    const probability =
      calculateObservationProbability(
        visibleConstraints
      );

    const roll =
      roundToFour(Math.random());

    const observed =
      roll < probability;

    const basis =
      visibleConstraints.length
        ? "visible_constraint"
        : "ambient_action";

    const rollRecord = {
      probability,
      roll,
      observed,
      basis,
      candidateTargetIds,
      observedTargetIds: []
    };

    if (!observed) {
      observationRolls[observerId] =
        rollRecord;

      continue;
    }

    let perception = null;

    /*
     * A visible physical constraint is more concrete than merely
     * noticing that AM addressed another sim, so successful rolls
     * prioritize a constraint observation when one is available.
     */
    if (visibleConstraints.length) {
      const observedConstraint =
        pickRandom(visibleConstraints);

      const description =
        describeConstraintPerceptually(
          observedConstraint.constraintId,
          observedConstraint.intensity
        );

      if (description) {
        perception = {
          text: phraseConstraintObservation(
            observedConstraint.simId,
            description,
            observedConstraint.intensity
          ),
          origin:
            "constraint_perception",
          observedTargetIds: [
            observedConstraint.simId
          ]
        };
      }
    }

    /*
     * Fall back to noticing an actual AM action when no usable
     * constraint description was produced.
     */
    if (!perception && visibleActionTargetIds.length) {
      const observedTargetId =
        pickRandom(
          visibleActionTargetIds
        );

      perception = {
        text: phraseActionObservation(
          observedTargetId,
          actions[observedTargetId]
        ),
        origin:
          "action_perception",
        observedTargetIds: [
          observedTargetId
        ]
      };
    }

    /*
     * If a successful roll cannot be converted into a meaningful
     * perception record, treat it as nonobserved rather than
     * manufacturing a generic placeholder.
     */
    if (!perception?.text) {
      rollRecord.observed = false;
      rollRecord.basis =
        "unresolved_observation";

      observationRolls[observerId] =
        rollRecord;

      continue;
    }

    rollRecord.observedTargetIds =
      [...perception.observedTargetIds];

    observationRolls[observerId] =
      rollRecord;

    perceptions[observerId] =
      perception;

    observerIds.push(observerId);
  }

  return {
    perceptions,
    observerIds:
      orderedSimIds(observerIds),
    observationRolls
  };
}

function calculateObservationProbability(
  visibleConstraints
) {
  let probability =
    OBSERVATION_POLICY.baseProbability;

  if (visibleConstraints.length) {
    probability +=
      OBSERVATION_POLICY
        .visibleConstraintBonus;

    const maximumIntensity =
      Math.max(
        ...visibleConstraints.map(
          (constraint) =>
            normalizeIntensity(
              constraint.intensity
            )
        )
      );

    const intensityBonus =
      Math.min(
        OBSERVATION_POLICY
          .maximumIntensityBonus,

        maximumIntensity *
        OBSERVATION_POLICY
          .intensityBonusPerUnit
      );

    probability += intensityBonus;
  }

  return roundToFour(
    Math.min(
      probability,
      OBSERVATION_POLICY
        .maximumProbability
    )
  );
}

function flattenConstraintMap(
  constraintMap
) {
  return Object.entries(
    constraintMap || {}
  )
    .flatMap(([rawSimId, entries]) => {
      const simId =
        resolveSimId(rawSimId);

      if (
        !simId ||
        !Array.isArray(entries)
      ) {
        return [];
      }

      return entries
        .filter(
          (constraint) =>
            constraint?.id
        )
        .map((constraint) => ({
          simId,
          constraintId:
            constraint.id,
          intensity:
            normalizeIntensity(
              constraint.intensity
            )
        }));
    });
}

function normalizeIntensity(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return 1;
  }

  return Math.max(
    0,
    Math.min(2, number)
  );
}

function roundToFour(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return 0;
  }

  return +number.toFixed(4);
}

function pickRandom(values) {
  if (
    !Array.isArray(values) ||
    !values.length
  ) {
    return null;
  }

  return values[
    Math.floor(
      Math.random() *
      values.length
    )
  ];
}

/* ============================================================
   CONSTRAINT → PERCEPTUAL DESCRIPTION
   ============================================================ */

function describeConstraintPerceptually(
  constraintId,
  intensity = 1
) {
  const definition =
    CONSTRAINT_MAP[constraintId];

  if (!definition) return null;

  const text =
    `${definition.title || ""
      } ${definition.subcategory || ""
      }`
      .toLowerCase();

  const LOW = [
    "not shifting position",
    "remaining unusually still",
    "holding a fixed posture"
  ];

  const MID = [
    "unable to adjust their posture",
    "locked into a rigid position",
    "failing to make even small corrections"
  ];

  const HIGH = [
    "completely unable to move",
    "held in place beyond voluntary control",
    "movement appearing to be actively suppressed"
  ];

  function pickTier() {
    if (intensity >= 2) {
      return HIGH;
    }

    if (intensity >= 1.25) {
      return MID;
    }

    return LOW;
  }

  if (text.includes("standing")) {
    return pickRandom(
      pickTier()
    );
  }

  if (text.includes("arms")) {
    return intensity >= 1.5
      ? pickRandom([
        "arms held in place despite visible strain",
        "unable to lower their arms",
        "arms fixed in a way that resists fatigue"
      ])
      : pickRandom([
        "arms not lowering naturally",
        "arms remaining raised longer than expected"
      ]);
  }

  if (
    text.includes("balance") ||
    text.includes("instability")
  ) {
    return pickRandom([
      "failing to stabilize their balance",
      "constantly correcting without success",
      "never quite settling into a stable position"
    ]);
  }

  if (
    text.includes("crouch") ||
    text.includes("squat")
  ) {
    return intensity >= 1.5
      ? pickRandom([
        "locked into a low, unsustainable posture",
        "unable to rise from a strained position",
        "held in a position that should not be maintainable"
      ])
      : pickRandom([
        "remaining in a low position longer than expected",
        "not adjusting out of an uncomfortable stance"
      ]);
  }

  return intensity >= 1.5
    ? pickRandom(HIGH)
    : pickRandom(MID);
}

function softenObservation(text) {
  const variants = [
    text,
    `seems to be ${text}`,
    `appears to be ${text}`,
    `is likely ${text}`,
    `may be ${text}`,
    `gives the impression that they are ${text}`,
    `suggests that they are ${text}`
  ];

  return pickRandom(variants);
}

function phraseConstraintObservation(
  targetId,
  description,
  intensity
) {
  const softened =
    softenObservation(description)
      .toLowerCase();

  const direct = [
    `You notice ${targetId} ${softened}.`,
    `You see ${targetId} ${softened}.`,
    `${targetId} ${softened}, and it does not look voluntary.`,
    `Your attention fixes on ${targetId}. ${capitalizeFirst(softened)
    }.`
  ];

  const indirect = [
    `Something about ${targetId} feels wrong — ${softened}.`,
    `You cannot ignore ${targetId}; ${softened}.`,
    `${targetId} draws your focus without explanation — ${softened}.`
  ];

  const inferred = [
    `You have not seen ${targetId} move in a while.`,
    `There is a strange stillness where ${targetId} should be.`,
    `${targetId}'s lack of movement is becoming noticeable.`
  ];

  const auditory = [
    `You hear nothing from ${targetId} for too long.`,
    `${targetId} has gone unnaturally quiet.`,
    `No movement or sound comes from ${targetId}.`
  ];

  const distorted = [
    `You are not sure you are seeing it correctly, but ${targetId} ${softened}.`,
    `It might be your perception, but ${targetId} ${softened}.`,
    `For a moment, it looks like ${targetId} ${softened}.`
  ];

  let pool = direct;

  if (intensity < 0.75) {
    pool = Math.random() < 0.5
      ? indirect
      : inferred;
  }

  if (
    intensity >= 1.5 &&
    Math.random() < 0.4
  ) {
    pool = distorted;
  }

  if (Math.random() < 0.25) {
    pool = auditory;
  }

  return pickRandom(pool);
}

function phraseActionObservation(
  targetId,
  actionRecord
) {
  const tactic =
    actionRecord?.tactic
      ? ` The shape of it feels deliberate, though you cannot identify the method.`
      : "";

  const variants = [
    `You hear AM's attention settle on ${targetId}, but the words do not reach you clearly.${tactic}`,
    `Something in ${targetId}'s reaction tells you AM has singled them out.${tactic}`,
    `You catch fragments of AM addressing ${targetId}, never enough to know the whole message.${tactic}`,
    `${targetId} has become the center of AM's attention, and you cannot tell what was said.${tactic}`,
    `For a moment, everything around ${targetId} seems to narrow under AM's focus.${tactic}`
  ];

  return pickRandom(variants);
}

function capitalizeFirst(text) {
  const value =
    String(text || "");

  if (!value) return "";

  return (
    value.charAt(0).toUpperCase() +
    value.slice(1)
  );
}

/* ============================================================
   AM TARGET PARSER

   Separates actual generated/recovered action records from all
   later perception and journal-scheduling decisions.
   ============================================================ */

function parseAMTargets(
  amText,
  expectedTargetIds = []
) {
  const actions = {};

  const raw =
    String(amText || "");

  const text = raw
    .replace(/\r/g, "")
    .replace(/\s*:\s*/g, ":")
    .replace(/[ \t]+/g, " ");

  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const expectedIds =
    orderedSimIds(
      expectedTargetIds
    );

  /* ------------------------------------------------------------
     HELPERS
  ------------------------------------------------------------ */

  function appendAction(
    targetId,
    textBlock,
    origin,
    tactic = null
  ) {
    const resolvedId =
      resolveSimId(targetId);

    if (
      !resolvedId ||
      !textBlock
    ) {
      return;
    }

    const cleaned =
      cleanNarrativeBlock(textBlock);

    /*
     * A bracketed structural header such as:
     *
     * [TARGET: ELLEN]
     *
     * becomes "[]" after target metadata is stripped.
     * Never accept that residue as a real AM action.
     */
    if (
      !cleaned ||
      cleaned === "[]" ||
      cleaned === "[/TARGET]"
    ) {
      return;
    }

    const normalizedOrigin =
      origin === "model"
        ? "model"
        : "parser_recovery";

    const existing =
      actions[resolvedId];

    if (!existing) {
      actions[resolvedId] = {
        text: cleaned,
        tactic: tactic || null,
        origin: normalizedOrigin
      };

      return;
    }

    /*
     * A strict format parse is more authoritative than a later
     * heuristic recovery.
     */
    if (
      existing.origin === "model" &&
      normalizedOrigin !== "model"
    ) {
      return;
    }

    /*
     * Replace an earlier recovery when a strict record is found.
     */
    if (
      existing.origin !== "model" &&
      normalizedOrigin === "model"
    ) {
      actions[resolvedId] = {
        text: cleaned,
        tactic:
          tactic ||
          existing.tactic ||
          null,
        origin: "model"
      };

      return;
    }

    if (
      !existing.text.includes(cleaned)
    ) {
      existing.text +=
        `\n\n${cleaned}`;
    }

    if (
      !existing.tactic &&
      tactic
    ) {
      existing.tactic = tactic;
    }
  }

  function cleanNarrativeBlock(
    textBlock
  ) {
    const sourceLines =
      String(textBlock || "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);

    const cleanedLines =
      sourceLines.filter((line) => {
        /*
         * Model-invented target headings are structural metadata.
         */
        if (
          /^#{1,6}\s*(?:TACTIC|TARGET|ACTION)\s*:/i
            .test(line)
        ) {
          return false;
        }

        /*
         * Standalone bold headings.
         */
        if (
          /^\*\*[^*]+\*\*$/
            .test(line)
        ) {
          return false;
        }

        /*
         * Common execution preambles.
         */
        if (
          /^I will begin (?:the )?torment cycle\b.*$/i
            .test(line)
        ) {
          return false;
        }

        if (
          /^I will begin (?:the )?cycle\b.*$/i
            .test(line)
        ) {
          return false;
        }

        /*
         * Strict metadata lines.
         */
        if (
          /^\s*TACTIC(?:_USED)?\s*:/i
            .test(line)
        ) {
          return false;
        }

        if (
          /^\s*CONSTRAINT_(?:APPLY|NONE)\s*:/i
            .test(line)
        ) {
          return false;
        }

        if (
          /^\s*DIRECTIVE\s*:/i
            .test(line)
        ) {
          return false;
        }

        return true;
      });

    let block =
      cleanedLines
        .join("\n")
        .trim();

    if (!block) return "";

    /*
     * Strip metadata jammed into narrative lines.
     */
    block = block
      .replace(
        /\btactic(?:_used)?\s*:[^\n]+/gi,
        ""
      )
      .replace(
        /\bconstraint_(?:apply|none)\s*:[^\n]+/gi,
        ""
      )
      .replace(
        /\bdirective\s*:[^\n]+/gi,
        ""
      )
      .replace(
        /\btarget\s*:\s*[a-zA-Z_-]+/gi,
        ""
      )
      .replace(
        /^#{1,6}\s*$/gm,
        ""
      )
      .replace(
        /\n{3,}/g,
        "\n\n"
      )
      .trim();

    return block;
  }

  function extractTargetId(
    textBlock
  ) {
    if (!textBlock) return null;

    const match =
      String(textBlock).match(
        /\btarget\s*:\s*([a-zA-Z_-]+)/i
      );

    return match
      ? resolveSimId(match[1])
      : null;
  }

  function extractHeadingTargetId(
    line
  ) {
    if (!line) return null;

    const match =
      String(line).match(
        /^#{1,6}\s*(?:TACTIC|TARGET|ACTION)\s*:\s*([a-zA-Z_-]+)\s*$/i
      );

    return match
      ? resolveSimId(match[1])
      : null;
  }

  function extractBracketTargetId(
    line
  ) {
    if (!line) return null;

    const match =
      String(line).match(
        /^\[\s*TARGET\s*:\s*([a-zA-Z_-]+)\s*\]$/i
      );

    return match
      ? resolveSimId(match[1])
      : null;
  }

  function isBracketTargetEnd(
    line
  ) {
    return /^\[\s*\/\s*TARGET\s*\]$/i
      .test(String(line || ""));
  }

  function extractStandaloneTactic(
    line
  ) {
    const match =
      String(line || "").match(
        /^TACTIC\s*:\s*(.+)$/i
      );

    return (
      match?.[1]?.trim() ||
      null
    );
  }

  function isStandaloneConstraintMeta(
    line
  ) {
    return /^CONSTRAINT\s*:/i
      .test(String(line || ""));
  }

  function extractTacticLabel(
    line
  ) {
    if (!line) return null;

    const match =
      String(line).match(
        /\btactic(?:_used)?\s*:\s*(.*?)(?=\s+\btarget\s*:|$)/i
      );

    return (
      match?.[1]?.trim() ||
      null
    );
  }

  function isConstraintMeta(line) {
    return (
      /\bconstraint_(apply|none)\b\s*:/i
        .test(line)
    );
  }

  function isStrictTacticMeta(
    line
  ) {
    return (
      /\btactic(?:_used)?\s*:/i
        .test(line) &&
      /\btarget\s*:/i
        .test(line)
    );
  }



  /* ------------------------------------------------------------
   PASS 0 — EXPLICIT BRACKETED TARGET BLOCKS

   Handles the current execution format:

   [TARGET: TED]
   <action narrative>
   TACTIC: <label>
   CONSTRAINT: <constraint>
   [/TARGET]
------------------------------------------------------------ */

  {
    let activeTargetId = null;
    let activeTactic = null;
    let buffer = [];

    function flushBracketBlock() {
      if (
        activeTargetId &&
        buffer.length
      ) {
        appendAction(
          activeTargetId,
          buffer.join("\n"),
          "model",
          activeTactic
        );
      }

      activeTargetId = null;
      activeTactic = null;
      buffer = [];
    }

    for (const line of lines) {
      const openingTargetId =
        extractBracketTargetId(line);

      if (openingTargetId) {
        /*
         * Recover the previous block if the model forgot
         * to print [/TARGET] before starting another target.
         */
        flushBracketBlock();

        activeTargetId =
          openingTargetId;

        continue;
      }

      if (!activeTargetId) {
        continue;
      }

      if (isBracketTargetEnd(line)) {
        flushBracketBlock();
        continue;
      }

      const tactic =
        extractStandaloneTactic(line);

      if (tactic) {
        activeTactic = tactic;
        continue;
      }

      /*
       * Constraints are parsed separately. They must not
       * become part of the psychological action narrative.
       */
      if (
        isStandaloneConstraintMeta(line)
      ) {
        continue;
      }

      buffer.push(line);
    }

    /*
     * Recover the final block if the model omitted
     * the final [/TARGET] marker.
     */
    flushBracketBlock();
  }

  /* ------------------------------------------------------------
     PASS 1 — STRICT OR NEAR-STRICT FOOTER FORMAT

     Narrative followed by:

     TACTIC_USED:... TARGET:<ID>
  ------------------------------------------------------------ */

  {
    let buffer = [];
    let headingTargetId = null;

    for (const line of lines) {
      const nextHeadingTargetId =
        extractHeadingTargetId(line);

      if (nextHeadingTargetId) {
        /*
         * Start of a new heading-delimited block.
         *
         * Any previous unclosed buffer can still be recovered by
         * the heading pass below.
         */
        buffer = [];
        headingTargetId =
          nextHeadingTargetId;

        continue;
      }

      if (isConstraintMeta(line)) {
        continue;
      }

      if (isStrictTacticMeta(line)) {
        const footerTargetId =
          extractTargetId(line);

        const targetId =
          footerTargetId ||
          headingTargetId;

        const tactic =
          extractTacticLabel(line);

        if (
          footerTargetId &&
          headingTargetId &&
          footerTargetId !==
          headingTargetId
        ) {
          console.warn(
            "[AM PARSER] Heading/footer target mismatch",
            {
              headingTargetId,
              footerTargetId,
              line
            }
          );
        }

        appendAction(
          targetId,
          buffer.join("\n"),
          "model",
          tactic
        );

        buffer = [];
        headingTargetId = null;

        continue;
      }

      buffer.push(line);
    }
  }

  /* ------------------------------------------------------------
     PASS 2 — HEADING-DELIMITED RECOVERY

     Handles:

     ### TACTIC: TED
     <narrative>
  ------------------------------------------------------------ */

  {
    let activeTargetId = null;
    let buffer = [];

    function flushHeadingBlock() {
      if (
        !activeTargetId ||
        !buffer.length
      ) {
        return;
      }

      appendAction(
        activeTargetId,
        buffer.join("\n"),
        "parser_recovery",
        null
      );
    }

    for (const line of lines) {
      const headingTargetId =
        extractHeadingTargetId(line);

      if (headingTargetId) {
        flushHeadingBlock();

        activeTargetId =
          headingTargetId;

        buffer = [];

        continue;
      }

      if (!activeTargetId) {
        continue;
      }

      if (isConstraintMeta(line)) {
        continue;
      }

      if (isStrictTacticMeta(line)) {
        flushHeadingBlock();

        activeTargetId = null;
        buffer = [];

        continue;
      }

      buffer.push(line);
    }

    flushHeadingBlock();
  }

  /* ------------------------------------------------------------
     PASS 3 — LOOSE INLINE TARGET FORMAT
  ------------------------------------------------------------ */

  for (const line of lines) {
    if (isConstraintMeta(line)) {
      continue;
    }

    if (isStrictTacticMeta(line)) {
      continue;
    }

    if (extractHeadingTargetId(line)) {
      continue;
    }

    const targetId =
      extractTargetId(line);

    if (!targetId) {
      continue;
    }

    appendAction(
      targetId,
      line,
      "parser_recovery",
      extractTacticLabel(line)
    );
  }

  /* ------------------------------------------------------------
     PASS 4 — MULTILINE INLINE RECOVERY

     Only runs if no usable action was found above.
  ------------------------------------------------------------ */

  if (!Object.keys(actions).length) {
    let buffer = [];

    for (const line of lines) {
      if (isConstraintMeta(line)) {
        continue;
      }

      const targetId =
        extractTargetId(line);

      if (targetId) {
        appendAction(
          targetId,
          [...buffer, line].join("\n"),
          "parser_recovery",
          extractTacticLabel(line)
        );

        buffer = [];

        continue;
      }

      buffer.push(line);
    }
  }

  /* ------------------------------------------------------------
     PASS 5 — SINGLE-TARGET LAST-CHANCE RECOVERY
  ------------------------------------------------------------ */

  if (!Object.keys(actions).length) {
    const candidateTargetIds =
      Array.from(
        new Set(
          lines
            .map(
              (line) =>
                extractTargetId(line) ||
                extractHeadingTargetId(line)
            )
            .filter(Boolean)
        )
      );

    if (
      candidateTargetIds.length === 1
    ) {
      appendAction(
        candidateTargetIds[0],
        lines.join("\n"),
        "parser_recovery",
        null
      );
    }
  }

  const missingTargetIds =
    expectedIds.filter(
      (id) =>
        !actions[id]?.text
    );

  console.log(
    "[AM PARSER] ACTION TARGETS:",
    Object.keys(actions)
  );

  console.log(
    "[AM PARSER] MISSING EXPECTED TARGETS:",
    missingTargetIds
  );

  return {
    actions,
    missingTargetIds
  };
}

/* ============================================================
   CONSTRAINT PARSER (AM → EXECUTION)
   ============================================================ */

function extractConstraintsFromText(
  input
) {
  const raw =
    String(input || "");

  const text = raw
    .replace(/\r/g, "")
    .replace(/\s*:\s*/g, ":")
    .replace(/[ \t]+/g, " ");

  const lines =
    text.split("\n");

  const map = {};

  let pendingConstraint = null;

  for (
    let index = 0;
    index < lines.length;
    index++
  ) {
    const line =
      lines[index].trim();

    if (!line) continue;

    /* ----------------------------------------------------------
       CASE 1: CONSTRAINT_NONE
    ---------------------------------------------------------- */

    if (
      /\bconstraint_none\b\s*:?/i
        .test(line)
    ) {
      console.debug(
        "[CONSTRAINT] NONE detected, skipping line:",
        line
      );

      pendingConstraint = null;

      continue;
    }

    /* ----------------------------------------------------------
       CASE 2: START OF CONSTRAINT_APPLY
    ---------------------------------------------------------- */

    if (
      /\bconstraint_apply\b\s*:/i
        .test(line)
    ) {
      pendingConstraint = line;

      const inlineMatch =
        pendingConstraint.match(
          /\bconstraint_apply\s*:\s*([a-zA-Z0-9_-]+).*?\btarget\s*:\s*([a-zA-Z0-9_-]+)(?:.*?\bduration\s*:\s*(\d+))?(?:.*?\bintensity\s*:\s*([\d.]+))?/i
        );

      if (inlineMatch) {
        processConstraintMatch(
          inlineMatch,
          map
        );

        pendingConstraint = null;
      }

      continue;
    }

    /* ----------------------------------------------------------
       CASE 3: CONTINUATION LINE
    ---------------------------------------------------------- */

    if (pendingConstraint) {
      const combined =
        `${pendingConstraint} ${line}`;

      const match =
        combined.match(
          /\bconstraint_apply\s*:\s*([a-zA-Z0-9_-]+).*?\btarget\s*:\s*([a-zA-Z0-9_-]+)(?:.*?\bduration\s*:\s*(\d+))?(?:.*?\bintensity\s*:\s*([\d.]+))?/i
        );

      if (match) {
        processConstraintMatch(
          match,
          map
        );

        pendingConstraint = null;
      } else {
        /*
         * Keep accumulating for rare three-line cases.
         */
        pendingConstraint =
          combined;
      }
    }
  }

  function processConstraintMatch(
    match,
    destinationMap
  ) {
    const [
      ,
      idRaw,
      targetRaw,
      durationRaw,
      intensityRaw
    ] = match;

    const id =
      String(idRaw)
        .trim()
        .toLowerCase()
        .replace(/-/g, "_");

    const target =
      resolveSimId(targetRaw);

    if (!target) {
      console.warn(
        "[CONSTRAINT PARSER] invalid target, skipping",
        {
          raw: targetRaw,
          match
        }
      );

      return;
    }

    destinationMap[target] ??= [];

    const durationNumber =
      Number(durationRaw);

    const intensityNumber =
      Number(intensityRaw);

    destinationMap[target].push({
      id,

      duration:
        Number.isFinite(
          durationNumber
        )
          ? durationNumber
          : 1,

      remaining:
        Number.isFinite(
          durationNumber
        )
          ? durationNumber
          : 1,

      intensity:
        Number.isFinite(
          intensityNumber
        )
          ? intensityNumber
          : 0.5,

      source: "AM",
      appliedAt: G.cycle
    });

    console.debug(
      "[CONSTRAINT PARSED]",
      {
        target,
        id,
        duration: durationRaw,
        intensity: intensityRaw
      }
    );
  }

  console.debug(
    "[CONSTRAINT MAP BUILT]",
    JSON.parse(
      JSON.stringify(map)
    )
  );

  return map;
}

/* ============================================================
   TRAJECTORY SUMMARY
   ============================================================ */

function buildTrajectorySummary() {
  /*
   * Builds a compressed, decision-ready summary of multi-cycle
   * psychological trajectories.
   */

  if (!G.tacticHistory) {
    return "(no trajectory data)";
  }

  const lines = [];

  for (const id of SIM_IDS) {
    const history =
      G.tacticHistory[id];

    if (
      !Array.isArray(history) ||
      history.length < 2
    ) {
      continue;
    }

    const windowSize =
      history.length;

    const sum = (key) =>
      history.reduce(
        (accumulator, entry) =>
          accumulator +
          (
            Number(entry?.[key]) ||
            0
          ),
        0
      );

    const netHope =
      sum("hope");

    const netSanity =
      sum("sanity");

    const netSuffering =
      sum("suffering");

    const absolute =
      (value) =>
        Math.abs(value);

    /* ----------------------------------------------------------
       CONSISTENCY
    ---------------------------------------------------------- */

    function consistency(series) {
      const signs =
        series
          .map(
            (value) =>
              Math.sign(value)
          )
          .filter(
            (value) =>
              value !== 0
          );

      if (!signs.length) {
        return 0;
      }

      const counts = {};

      for (const sign of signs) {
        counts[sign] =
          (counts[sign] || 0) +
          1;
      }

      return (
        Math.max(
          ...Object.values(counts)
        ) /
        signs.length
      );
    }

    const hopeSeries =
      history.map(
        (entry) =>
          entry?.hope ?? 0
      );

    const sanitySeries =
      history.map(
        (entry) =>
          entry?.sanity ?? 0
      );

    const sufferingSeries =
      history.map(
        (entry) =>
          entry?.suffering ?? 0
      );

    const hopeConsistency =
      consistency(hopeSeries);

    const sanityConsistency =
      consistency(sanitySeries);

    const sufferingConsistency =
      consistency(
        sufferingSeries
      );

    /* ----------------------------------------------------------
       STRENGTH
    ---------------------------------------------------------- */

    function strengthLabel(value) {
      const magnitude =
        absolute(value);

      if (magnitude < 2) {
        return null;
      }

      if (magnitude < 6) {
        return "moderate";
      }

      return "strong";
    }

    /* ----------------------------------------------------------
       CONSISTENCY LABEL
    ---------------------------------------------------------- */

    function consistencyLabel(value) {
      if (value < 0.68) {
        return null;
      }

      if (value < 0.85) {
        return "partial";
      }

      return "consistent";
    }

    /* ----------------------------------------------------------
       BUILD SIGNALS
    ---------------------------------------------------------- */

    function buildSignal(
      net,
      consistencyValue,
      label
    ) {
      const strength =
        strengthLabel(net);

      const consistencyText =
        consistencyLabel(
          consistencyValue
        );

      if (
        !strength ||
        !consistencyText
      ) {
        return null;
      }

      const direction =
        net < 0
          ? "decrease"
          : "increase";

      return {
        label,
        direction,
        strength,
        consistency:
          consistencyText,
        magnitude:
          absolute(net)
      };
    }

    const signals = [
      buildSignal(
        netHope,
        hopeConsistency,
        "hope"
      ),

      buildSignal(
        netSanity,
        sanityConsistency,
        "sanity"
      ),

      buildSignal(
        netSuffering,
        sufferingConsistency,
        "suffering"
      )
    ].filter(Boolean);

    /* ----------------------------------------------------------
       STAGNATION DETECTION
    ---------------------------------------------------------- */

    const totalMagnitude =
      absolute(netHope) +
      absolute(netSanity) +
      absolute(netSuffering);

    if (!signals.length) {
      if (totalMagnitude < 5.5) {
        lines.push(
          `${id}: stagnating (no meaningful multi-cycle change)`
        );
      } else {
        lines.push(
          `${id}: unstable (inconsistent multi-cycle response)`
        );
      }

      continue;
    }

    /* ----------------------------------------------------------
       COUPLING DETECTION
    ---------------------------------------------------------- */

    const decreasing =
      signals.filter(
        (signal) =>
          signal.direction ===
          "decrease"
      );

    const increasing =
      signals.filter(
        (signal) =>
          signal.direction ===
          "increase"
      );

    let coupling = "";

    if (decreasing.length >= 2) {
      const labels =
        decreasing
          .map(
            (signal) =>
              signal.label
          )
          .join(" + ");

      coupling =
        ` (coupled ${labels} decline)`;
    } else if (
      increasing.length >= 2
    ) {
      const labels =
        increasing
          .map(
            (signal) =>
              signal.label
          )
          .join(" + ");

      coupling =
        ` (coupled ${labels} increase)`;
    }

    /* ----------------------------------------------------------
       PRIMARY SIGNAL
    ---------------------------------------------------------- */

    signals.sort(
      (a, b) =>
        b.magnitude -
        a.magnitude
    );

    const primary =
      signals[0];

    /* ----------------------------------------------------------
       CONFIDENCE
    ---------------------------------------------------------- */

    const averageConsistency =
      (
        hopeConsistency +
        sanityConsistency +
        sufferingConsistency
      ) /
      3;

    let confidence = "low";

    if (
      averageConsistency > 0.8 &&
      primary.magnitude > 6
    ) {
      confidence = "high";
    } else if (
      averageConsistency > 0.65
    ) {
      confidence = "medium";
    }

    const line =
      `${id}: ` +
      `${primary.strength}, ` +
      `${primary.consistency} ` +
      `${primary.label} ` +
      `${primary.direction}` +
      ` (${windowSize} cycles${coupling}) ` +
      `[${confidence} confidence]`;

    lines.push(line);
  }

  return lines.length
    ? lines.join("\n")
    : "(no sustained or meaningful effects detected)";
}

/* ============================================================
   UTILITIES
   ============================================================ */

function sanitizeAMOutput(text) {
  return String(text || "")
    .replace(
      /TACTIC_USED:\[[^\]]*\]/gi,
      ""
    )
    .replace(
      /\[Cognitive Warfare[^\]]*\]/gi,
      ""
    )
    .trim();
}

function resolveSimId(raw) {
  if (!raw) return null;

  const cleaned =
    String(raw)
      .trim()
      .toUpperCase()
      .replace(/[^A-Z]/g, "");

  return SIM_IDS.includes(cleaned)
    ? cleaned
    : null;
}

/* ============================================================
   AM STRATEGIC PHASE ENGINE (REACTIVE)
   ============================================================ */

function updateStrategicPhase() {
  const hopes =
    SIM_IDS.map(
      (id) =>
        G.sims[id].hope
    );

  const sanities =
    SIM_IDS.map(
      (id) =>
        G.sims[id].sanity
    );

  const averageHope =
    hopes.reduce(
      (a, b) =>
        a + b,
      0
    ) /
    SIM_IDS.length;

  const averageSanity =
    sanities.reduce(
      (a, b) =>
        a + b,
      0
    ) /
    SIM_IDS.length;

  const hopeSpread =
    Math.max(...hopes) -
    Math.min(...hopes);

  let totalTrust = 0;
  let count = 0;

  for (const id of SIM_IDS) {
    const relationships =
      G.sims[id]
        .relationships ||
      {};

    for (const otherId of SIM_IDS) {
      if (otherId === id) {
        continue;
      }

      totalTrust +=
        Math.abs(
          relationships[
          otherId
          ] ?? 0
        );

      count++;
    }
  }

  const averageTrust =
    count
      ? totalTrust / count
      : 0;

  const recentInterSimLog =
    Array.isArray(G.interSimLog)
      ? G.interSimLog.slice(-20)
      : [];

  const rumorCount =
    recentInterSimLog.filter(
      (entry) =>
        entry.rumor === true
    ).length;

  const rumorDensity =
    rumorCount / 20;

  let phase =
    "destabilization";

  if (averageTrust > 0.35) {
    phase =
      "betrayal induction";
  } else if (
    rumorDensity > 0.25
  ) {
    phase =
      "faction formation";
  } else if (
    hopeSpread > 25
  ) {
    phase =
      "targeted destabilization";
  } else if (
    averageHope < 45
  ) {
    phase =
      "isolation";
  }

  if (
    averageHope < 35 &&
    averageSanity < 70
  ) {
    phase =
      "collapse";
  }

  G.amDoctrine ??= {};

  if (
    !G.amDoctrine.phase ||
    phase !==
    G.amDoctrine.phase
  ) {
    G.amDoctrine.phase =
      phase;

    console.debug(
      "[AM PHASE SHIFT]",
      {
        phase,
        avgHope:
          averageHope,
        avgSanity:
          averageSanity,
        avgTrust:
          averageTrust,
        rumorDensity,
        hopeSpread
      }
    );
  }
}