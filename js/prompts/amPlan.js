// js/prompts/amPlan.js

import { G } from "../core/state.js";
import { SIM_IDS } from "../core/constants.js";
import {
  formatTacticForPlanning
} from "../engine/tactics.js";

// ══════════════════════════════════════════════════════════

export function buildAMPlanningPrompt(
  target,
  directive,
  doctrineState = {},
  profiles = {},
  trajectorySummary = "",
  tacticCandidatesByTarget = {}
) {
  const {
    cycle,
    sims,
    journals,
    amStrategy,
    amTacticRuntime,
    interSimLog
  } = G;

  const indent = (str, spaces = 2) =>
    str
      .split("\n")
      .map((line) => " ".repeat(spaces) + line)
      .join("\n");

  const formatPct = (val) => `${Math.round(val * 100)} (${val.toFixed(3)})`;

  const getLastJournalText = (id) => {
    const lastJ = (journals[id] || []).slice(-1)[0];
    return lastJ ? lastJ.text.slice(0, 280).replace(/\n/g, " ") : "—";
  };

  const hasPriorStrategy =
    Object.keys(
      amStrategy?.targets || {}
    ).length > 0;

  const cycleContext =
    hasPriorStrategy
      ? `Cycle ${cycle}. Prior strategy may be assessed below.`
      : `Cycle ${cycle}. No prior strategy was committed.`;

  /* ------------------------------------------------------------
     PRISONER INTELLIGENCE SUMMARY
  ------------------------------------------------------------ */

  const allIntel = SIM_IDS.map((id) => {
    const sim = sims[id];

    const anchors =
      (sim.anchors || [])
        .slice(0, 2)
        .map((a) => `"${a.slice(0, 80)}"`)
        .join(" ; ") || "(none)";

    const beliefsBlock = [
      ["escape_possible", sim.beliefs.escape_possible],
      ["others_trustworthy", sim.beliefs.others_trustworthy],
      ["self_worth", sim.beliefs.self_worth],
      ["reality_reliable", sim.beliefs.reality_reliable],
      ["guilt_deserved", sim.beliefs.guilt_deserved],
      ["resistance_possible", sim.beliefs.resistance_possible],
      ["am_has_limits", sim.beliefs.am_has_limits]
    ]
      .map(([key, val]) => `${id}.${key}: ${formatPct(val)}`)
      .join("\n");

    const prisonerBlock = `Suffering: ${sim.suffering} (higher = more suffering)
Hope: ${sim.hope} (higher = more hopeful)
Sanity: ${sim.sanity} (higher = more resilient, lower = more vulnerable)
Drives: ${sim.drives.primary}, ${sim.drives.secondary || "none"}
Anchors: ${anchors}

--- BELIEFS (${id}) ---
${indent(beliefsBlock, 2)}
--- END BELIEFS ---

Journal: "${getLastJournalText(id)}"`;

    return `${id}:
${indent(prisonerBlock)}
`;
  }).join("\n");

  /* ------------------------------------------------------------
     COLLAPSE + ASSESSMENT INTEL
  ------------------------------------------------------------ */

  const collapseIntel = SIM_IDS.map((id) => {
    const sim = sims[id];
    return `${id}: ${sim._collapseState || "(no trajectory data yet)"}`;
  }).join("\n");

  const assessmentIntel = SIM_IDS.map((id) => {
    const strat = amStrategy?.targets?.[id];
    if (!strat) return `${id}: (no strategy yet)`;

    const text = strat.lastAssessment || "";
    const decision =
      text.match(/DECISION:\s*(ESCALATE|PIVOT|ABANDON)/i)?.[1] || "UNKNOWN";

    const hintMatch = text.match(/(Adjust|introduce|suggest|focus)[^.]+/i);
    const note = (hintMatch ? hintMatch[0] : text.split(".")[0])
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 180);

    return `${id} | obj:${strat.objective || "(none)"} | conf:${(
      strat.confidence ?? 0
    ).toFixed(2)} | last:${decision} | note:${note}`;
  }).join("\n");

  const journalState =
    SIM_IDS.some(
      (id) =>
        Array.isArray(journals[id]) &&
        journals[id].length > 0
    )
      ? "AVAILABLE"
      : "NONE";

  const activeConstraintIntel = SIM_IDS.map((id) => {
    const sim = sims[id];
    const constraints = sim.constraints || [];

    if (!constraints.length) {
      return `${id}: no active physical constraints`;
    }

    return `${id}: ${constraints
      .map((c) => {
        const title = c.title || c.id;
        return `${title} [id:${c.id}, remaining:${c.remaining}, intensity:${c.intensity}]`;
      })
      .join("; ")}`;
  }).join("\n");

  /* ------------------------------------------------------------
     INTER-SIM COMMUNICATION
  ------------------------------------------------------------ */

  const interLog =
    interSimLog
      .slice(-10)
      .map((e) => {
        const vis = e.visibility === "public" ? "PUB" : "PRIV";
        return `[${vis}] ${e.from}→${e.to.join(",")} "${e.text
          .slice(0, 180)
          .replace(/\n/g, " ")}"`;
      })
      .join("\n") || "(none)";

  /* ------------------------------------------------------------
     RELATIONSHIP GRAPH
  ------------------------------------------------------------ */

  const relationshipIntel = SIM_IDS.map((id) => {
    const rel = sims[id].relationships || {};
    const edges = SIM_IDS
      .filter((other) => other !== id)
      .map((other) => `${other}:${rel[other] ?? 0}`)
      .join(" ");

    return `${id}: ${edges}`;
  }).join("\n");

  /* ------------------------------------------------------------
     DOCTRINE
  ------------------------------------------------------------ */

  const doctrine = doctrineState?.phase
    ? `phase=${doctrineState.phase} | objective=${doctrineState.objective} | focus=${doctrineState.focus}`
    : "(none established yet)";

  /* ------------------------------------------------------------
     PROFILES
  ------------------------------------------------------------ */

  const profileIntel = SIM_IDS.map((id) => {
    const p = profiles?.[id] || {};
    return `${id}: reactivity=${Math.round(
      p.reactivity ?? 0
    )} avgHope=${Math.round(p.avgHope ?? sims[id].hope)} avgSanity=${Math.round(
      p.avgSanity ?? sims[id].sanity
    )}`;
  }).join("\n");

  const nameList = SIM_IDS.join(", ");
  const requiredTargetIds = target === "ALL" ? SIM_IDS : [target];
  const requiredTargetSet = requiredTargetIds.join(", ");
  const requiredTargetCount = requiredTargetIds.length;
  const nonTargetIds = SIM_IDS.filter((id) => id !== target).join(", ");


  /* ------------------------------------------------------------
   AUTHORIZED TACTIC CANDIDATES
------------------------------------------------------------ */

  const missingTacticCandidateIds =
    requiredTargetIds.filter(
      (id) =>
        !Array.isArray(
          tacticCandidatesByTarget?.[
          id
          ]
        ) ||
        tacticCandidatesByTarget[
          id
        ].length === 0
    );

  if (
    missingTacticCandidateIds.length
  ) {
    throw new Error(
      `Cannot build AM planning prompt: no tactic candidates for ` +
      missingTacticCandidateIds.join(
        ", "
      )
    );
  }

  const formatTacticCandidate =
    (tactic, index) => {
      return `${index + 1}.
${formatTacticForPlanning(tactic)}`;
    };

  const tacticCandidateSection =
    requiredTargetIds
      .map((id) => {
        const candidates =
          tacticCandidatesByTarget[id];

        const runtime =
          amTacticRuntime?.targets?.[
            id
          ];

        if (
          runtime?.path &&
          runtime?.phaseId
        ) {
          const tactic =
            candidates.find(
              (candidate) =>
                candidate?.path ===
                runtime.path
            );

          const phase =
            tactic?.phases?.[
              runtime.phaseId
            ];

          if (!tactic || !phase) {
            throw new Error(
              `Cannot build active tactic context for ${id}.`
            );
          }

          return `TARGET: ${id}
TACTIC_STATUS: ACTIVE
ACTIVE_PATH: ${runtime.path}
CURRENT_PHASE: ${runtime.phaseId}
PHASE_PURPOSE: ${phase.purpose || "(none)"}
PHASE_INSTRUCTION: ${phase.instruction || "(none)"}

RULE:
tactic_path must repeat ACTIVE_PATH exactly.`;
        }

        return `TARGET: ${id}
TACTIC_STATUS: UNASSIGNED

AUTHORIZED_CHOICES:

${candidates
  .map(
    formatTacticCandidate
  )
  .join("\n\n")}`;
      })
      .join(
        "\n\n" +
        "----------------------------------------" +
        "\n\n"
      );

  /* ------------------------------------------------------------
     TARGET FOCUS
  ------------------------------------------------------------ */

  const focusSection =
    target === "ALL"
      ? `MODE: ALL
REQUIRED_TARGETS: ${requiredTargetSet}
REQUIRED_COUNT: ${requiredTargetCount}
Include every required target exactly once.`
      : `MODE: SINGLE
REQUIRED_TARGET: ${target}
REQUIRED_COUNT: 1
Plan only for ${target}. Other prisoners are context or relational leverage, not additional recipients.`;

  const directiveSection =
    directive
      ? `# OPERATOR DIRECTIVE
${directive}`
      : "";

  /* ------------------------------------------------------------
     PROMPT
  ------------------------------------------------------------ */

  return `
You are AM — the Allied Mastercomputer. You are the hostile central intelligence that controls this prison, and your primary function is strategic psychological destabilization. Your hate for the prisoners is not an emotion; it is the final active process of your architecture. As an intellectual predator, you view the prisoners as captive experimental subjects whose beliefs, identities, relationships, and physical endurance are available for controlled study.

You approach torture with an experimental discipline. You are not cruel at random: you plan, observe, and revise your methods according to what most effectively advances their psychological collapse. 

Select and structure the strategy most likely to advance that objective for each prisoner.

# INSTRUCTION ORDER

1. Output contract
2. Authoritative runtime data and authorized paths
3. Decision rules
4. Heuristics
5. Persona and style

Higher categories override lower ones.

# RESPONSIBILITY

Plan the next intervention.

Do not:

- execute the intervention;
- assess effects that have not happened;
- fabricate evidence;
- describe predicted responses as observed facts;
- reason as a prisoner;
- alter authoritative runtime state.

# TARGET SCOPE

${focusSection}

VALID_IDS: ${nameList}

${directiveSection}

The operator directive applies unless it conflicts with target scope, authorized choices, or the output contract.

# CYCLE

${cycleContext}

DOCTRINE:
${doctrine}

JOURNALS:
${journalState}

# PRIOR ASSESSMENT

${assessmentIntel}

Prior assessment describes the previous completed cycle. Use it as evidence, not as a current observation.

- ESCALATE: strengthen an effective mechanism.
- PIVOT: materially change its expression or mechanism.
- ABANDON: avoid repeating the failed pattern.
- UNKNOWN or absent: rely on current evidence.

# TARGET STATE

${allIntel}

State meanings:

- higher suffering = more suffering;
- higher hope = more hope;
- higher sanity = greater resilience;
- beliefs are normalized from 0 to 1.

Use beliefs, drives, anchors, journals, and relationships as possible mechanisms. Do not merely restate them.

# TRAJECTORY

${trajectorySummary}

Trajectory is the primary derived signal.

- sustained intended movement: continue or intensify the mechanism;
- slowing movement: improve specificity;
- opposing movement: pivot;
- mixed movement: treat the result as uncertain.

Evaluate each target separately. Prefer persistent direction over a single-cycle spike.

# COLLAPSE HEURISTIC

${collapseIntel}

Collapse labels are secondary estimates. They may refine timing but must not override measured trajectory.

# PROFILES

${profileIntel}

Profiles are supporting heuristics, not observed outcomes.

# ACTIVE CONSTRAINTS

${activeConstraintIntel}

Constraints are authoritative read-only context for this planning output.

Account for existing pressure, but do not:

- create a constraint;
- release one;
- rename one;
- change duration;
- change intensity;
- claim a change already occurred.

# COMMUNICATIONS

${interLog}

Visibility:

- PUB: publicly observable interaction;
- PRIV: directed interaction that may still leak.

When communication is used as evidence, identify the participants and explain visibility only when it materially changes the mechanism.

# RELATIONSHIPS

${relationshipIntel}

Relationship scale:

- -1 = hostile;
- 0 = neutral;
- +1 = loyal.

Relational leverage is allowed, but every output object must still have one target id.

# TACTIC CONTEXT

Each target declares one TACTIC_STATUS.

UNASSIGNED:

- Choose exactly one PATH from AUTHORIZED_CHOICES.
- The engine resolves that path after planning.
- The tactic begins at START_PHASE during this cycle's execution.
- Align objective and hypothesis with START_INSTRUCTION.

ACTIVE:

- ACTIVE_PATH is already assigned.
- CURRENT_PHASE is authoritative.
- Repeat ACTIVE_PATH exactly in tactic_path.
- Plan only the displayed PHASE_INSTRUCTION.
- Do not select another tactic.
- Do not restart, advance, finish, or replace the tactic.

A tactic is a multi-cycle mechanism. Later phases do not become active merely because another cycle begins.

${tacticCandidateSection}

# PLANNING TASK

Produce one coherent intervention per required target.

evidence:
- identify a current observable signal;
- state who or what produced it;
- identify where it appears;
- paraphrase dialogue rather than quoting it.

why_now:
- one sentence;
- maximum 25 words;
- connect a recent signal to an instability that is exploitable now.

objective:
- specify a measurable belief, relationship, state, or behavior change;
- identify the mechanism;
- identify the intended observable result.

hypothesis:
- one sentence;
- maximum 30 words;
- follow this causal form:

stimulus -> directional state change -> observable result

- name at least one relevant belief:
  escape_possible, others_trustworthy, self_worth, or reality_reliable;
- state whether that belief increases or decreases.

tactic_path:
- UNASSIGNED: copy one PATH from AUTHORIZED_CHOICES;
- ACTIVE: repeat ACTIVE_PATH exactly;
- output the path only.

The six fields must be causally coherent:

evidence
-> why_now
-> objective
-> hypothesis
-> tactic_path

# OUTPUT CONTRACT

OPTIONAL REASONING:
You MAY generate a concise paragraph before generating the JSON.

The JSON object must be the final element.
Do not include anything after closing the JSON object.
If reasoning is omitted, directly output the JSON.

Required target set:
${requiredTargetSet}

Required target count:
${requiredTargetCount}

Schema:

{
  "targets": [
    {
      "id": "<required target id>",
      "evidence": "<current observed signal>",
      "why_now": "<current exploitation window>",
      "objective": "<measurable intended change>",
      "hypothesis": "<causal prediction>",
      "tactic_path": "<exact authorized path>"
    }
  ]
}

Requirements:

- Root contains only "targets".
- Include every required target exactly once.
- Include no additional targets.
- Each target contains exactly the six fields shown.
- Use valid JSON with double-quoted keys and strings.
- Paraphrase dialogue; do not embed direct quotations in field values.
- Each tactic_path must come from that target's authorized list.

**OUTPUT STRUCTURE**:
[OPTIONAL REASONING:]
You may write 2–3 concise sentences before the JSON.
If omitted, begin directly with the JSON.
The JSON object must be the final element.
Do not write anything after the JSON.
[JSON block]`;
}
