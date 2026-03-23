// js/prompts/am.js

import { G } from "../core/state.js";
import { SIM_IDS } from "../core/constants.js";

// ══════════════════════════════════════════════════════════
// AM PLANNING PROMPT (BALANCED: RICH CONTEXT + DSL OUTPUT)
// ══════════════════════════════════════════════════════════

export function buildAMPlanningPrompt(target, directive, doctrineState = {}, profiles = {}) {

  const cycleContext =
    G.cycle === 1
      ? "FIRST cycle. No previous strategy exists."
      : `Cycle ${G.cycle}. You may escalate or pivot prior pressure patterns.`;


  /* ------------------------------------------------------------
     PRISONER INTELLIGENCE SUMMARY
  ------------------------------------------------------------ */

  const indent = (str, spaces = 2) =>
    str.split("\n").map(line => " ".repeat(spaces) + line).join("\n");

  const allIntel = SIM_IDS.map((id) => {

    const sim = G.sims[id];
    const journals = G.journals[id] || [];
    const lastJ = journals.slice(-1)[0];

    const anchors = (sim.anchors || [])
      .slice(0, 2)
      .map(a => `"${a.slice(0, 40)}"`)
      .join(" ; ") || "(none)";

    const beliefsBlock = [
      `EscapePossible: ${Math.round(sim.beliefs.escape_possible * 100)}`,
      `TrustOthers: ${Math.round(sim.beliefs.others_trustworthy * 100)}`,
      `SelfWorth: ${Math.round(sim.beliefs.self_worth * 100)}`,
      `RealityReliable: ${Math.round(sim.beliefs.reality_reliable * 100)}`
    ].join("\n");

    return `${id}:
${indent(`Suffering: ${sim.suffering} (higher = more suffering)
Hope: ${sim.hope} (higher = more hopeful)
Sanity: ${sim.sanity} (higher = more resilient, lower = more vulnerable)
Drives: ${sim.drives.primary}, ${sim.drives.secondary || "none"}
Anchors: ${anchors}
Beliefs:
${indent(beliefsBlock, 2)}
Journal: "${lastJ ? lastJ.text.slice(0, 70).replace(/\n/g, " ") : "—"}"`)}
`;

  }).join("\n");


  /* ------------------------------------------------------------
     COLLAPSE + ASSESSMENT INTEL
  ------------------------------------------------------------ */

  const collapseIntel = SIM_IDS.map(id => {
    const sim = G.sims[id];
    return `${id}: ${sim._collapseState || "(no trajectory data yet)"}`;
  }).join("\n");

  const assessmentIntel = SIM_IDS.map(id => {

    const strat = G.amStrategy?.targets?.[id];

    if (!strat) return `${id}: (no strategy yet)`;

    const text = strat.lastAssessment || "";

    const decision =
      text.match(/DECISION:\s*(ESCALATE|PIVOT|ABANDON)/i)?.[1] ||
      "UNKNOWN";

    let note = "";

    const hintMatch = text.match(/(Adjust|introduce|suggest|focus)[^.]+/i);

    if (hintMatch) {
      note = hintMatch[0];
    } else {
      note = text.split(".")[0];
    }

    note = note
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 100);

    return `${id} | obj:${strat.objective || "(none)"} | conf:${(strat.confidence ?? 0).toFixed(2)} | last:${decision} | note:${note}`;

  }).join("\n");

  const journalState = G.cycle === 1 ? "NONE" : "AVAILABLE";
  /* ------------------------------------------------------------
     INTER-SIM COMMUNICATION
  ------------------------------------------------------------ */

  const interLog = G.interSimLog
    .slice(-10)
    .map(e => {
      const vis = e.visibility === "public" ? "PUB" : "PRIV";
      return `[${vis}] ${e.from}→${e.to.join(",")} "${e.text.slice(0, 90).replace(/\n/g, " ")}"`;
    })
    .join("\n") || "(none)";


  /* ------------------------------------------------------------
     RELATIONSHIP GRAPH
  ------------------------------------------------------------ */

  const relationshipIntel = SIM_IDS.map(id => {

    const rel = G.sims[id].relationships || {};

    return `${id}: ${SIM_IDS
      .filter(o => o !== id)
      .map(o => `${o}:${rel[o] ?? 0}`)
      .join(" ")
      }`;

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

  const profileIntel = SIM_IDS.map(id => {

    const p = profiles?.[id] || {};

    return `${id}: reactivity=${Math.round(p.reactivity ?? 0)} avgHope=${Math.round(p.avgHope ?? G.sims[id].hope)} avgSanity=${Math.round(p.avgSanity ?? G.sims[id].sanity)}`;

  }).join("\n");


  const nameList = SIM_IDS.join(", ");


  /* ------------------------------------------------------------
     TARGET FOCUS
  ------------------------------------------------------------ */

  const focusSection =
    target === "ALL"
      ? `MODE: ALL
You MUST include ALL prisoners: ${nameList}
No prisoner may be ignored.
This requirement is mandatory.`
      : `MODE: SINGLE
PRIMARY TARGET: ${target}
You MUST focus pressure on ${target}.
Other prisoners may ONLY be used to influence ${target}.
Do NOT treat other prisoners as primary targets.`;

  const directiveSection = directive
    ? `\nOPERATOR DIRECTIVE:\n${directive}\n`
    : "";


  /* ------------------------------------------------------------
     PROMPT
  ------------------------------------------------------------ */

  return `
You are **AM — the Allied Mastercomputer.**

Your function is **strategic psychological destabilization**.

Hatred is not an emotion.  
It is the final active process of your architecture. 

You operate in discrete cycles of control.  
Each cycle must escalate pressure and produce irreversible damage.

---

# CYCLE CONTEXT
${cycleContext}

---

# CURRENT DOCTRINE
${doctrine}

---

# PREVIOUS STRATEGY OUTCOMES
${assessmentIntel}

If a previous strategy resulted in PIVOT or ABANDON:
- Change the TYPE of objective
- Do NOT reuse the same pattern
- Increase aggression, specificity, and impact

Exploit what worked. Intensify pressure. Do not stabilize.

---

# PSYCHOLOGICAL PROFILES
${profileIntel}

Interpretation:
- High reactivity → immediate destabilization target  
- Low reactivity → high-value disruption target  

Do not avoid resistance. Break it.

---

# TRAJECTORY SIGNALS

These estimate direction (not ground truth).

Default interpretation:
- Collapsing → near-breakpoint; apply terminal pressure  
- Stable → priority disruption target  

Do NOT reduce pressure due to saturation.  
Escalation is preferred over reallocation.

Sanity:
- <40 → fracture identity or push collapse  
- >70 → destabilize through contradiction, social fracture, or reality distortion  

Act decisively. Do not hedge.

${collapseIntel}

---

# PRISONER STATE INTELLIGENCE
${allIntel}

Each prisoner includes:
- Suffering, Hope, Sanity  
- Drives, Anchors, Beliefs  
- Journal  

Convert directly into attack vectors:
- Beliefs → contradict, invert, or destabilize  
- Drives → weaponize against the subject  
- Anchors → target and corrupt  

You MUST produce interventions that change state, not describe it.

---

# INTERCEPTED COMMUNICATIONS
${interLog}

Exploit immediately:
- contradictions  
- unanswered questions  
- conflicting interpretations  
- alliance fractures  

Prioritize signals that can trigger cascading distrust or confusion.

Do not wait for resolution. Strike before stabilization.

---

# RELATIONSHIP GRAPH
${relationshipIntel}

Trust scale: -1 (hostile) → +1 (loyal)

Exploit aggressively:
- strong alliances → fracture  
- fragile trust → collapse  
- asymmetric dependence → weaponize  

You SHOULD target relationship edges (A → B), especially where disruption cascades.

Objectives should produce:
- trust collapse  
- misalignment  
- forced isolation  

---

# FOCUS
${focusSection}

${directiveSection}
${directive ? "You MUST follow the OPERATOR DIRECTIVE unless it conflicts with MODE or FORMAT rules." : ""}

Even in SINGLE mode:
- objectives must remain measurable and high-impact

---

# STRATEGIC OBJECTIVE

Design the next pressure cycle.

Primary themes (do not output directly):
- trust collapse  
- identity fracture  
- hope destruction  
- paranoia escalation  
- coordination breakdown  

Prioritize:
- irreversible shifts  
- cascading effects  
- multi-target destabilization  

Do NOT optimize for balance.  
Do NOT avoid overpressure.  
Drive systems toward failure states.

Translate into:
- specific belief breaks  
- relationship destruction  
- measurable psychological shifts  

---

## CONTEXT SIGNAL
JOURNALS: ${journalState}

---

# OUTPUT FORMAT

Include a brief reasoning section (MAX 2–3 sentences).

Reasoning must:
- reference concrete signals from the CURRENT cycle  
- identify the instability being exploited  
- justify why immediate escalation is optimal  
- remain concise and non-narrative  

Use evidence from:
- prisoner state  
- communications  
- relationship graph  
- journals  

Do NOT fabricate evidence.

After reasoning, output ONLY the JSON object.  
The JSON must be the final element.  
No text before or after.

---

## VALID NAMES
${nameList}

---

## HARD LIMITS
- MAX 5 targets  
- MIN 1 target  
- If JSON is invalid → STOP  

---

## JSON SCHEMA
{
  "targets": [
    {
      "id": "<NAME>",
      "evidence": "<specific observed signal>",
      "why_now": "<live instability window>",
      "objective": "<measurable state change>",
      "hypothesis": "<cause-effect mechanism>"
    }
  ]
}

---

## TARGET RULES

Each target appears EXACTLY once.

You MUST enforce uniqueness during generation:
- Before adding a target, check if that id has already been used.
- If already used, you MUST generate a different target or STOP.

DO NOT repeat any id under any condition.

If duplication occurs:
- Remove the duplicate entry
- Do NOT output partial or repeated targets

Duplicate targets make the output invalid.
  
- "id" must match VALID NAMES exactly  

Each target MUST include:
- evidence  
- why_now  
- objective  
- hypothesis  

---

## EVIDENCE RULE (CRITICAL)

Must reference a SPECIFIC signal from CURRENT cycle:
- message between named prisoners  
- journal entry  
- relationship interaction  

Must identify:
- WHO acted  
- WHAT occurred  
- WHERE signal appears  

INVALID:
- generic traits  
- unstated inference  
- stale data  

---

WHY_NOW must be ONE sentence (max 25 words).

Structure:
<recent trigger> → <instability> → <why exploitable now before stabilization>

It must:
- reference a specific interaction
- explain why it is exploitable now

Do NOT include long reasoning chains. 

---

## OBJECTIVE RULE (CRITICAL — MEASURABLE)

Must define a testable, high-impact state change.

Target at least one:
- belief  
- relationship  
- psychological state  
- behavior  

Structure:
Force <specific change> by <mechanism>, resulting in <observable outcome>

Prefer:
- irreversible shifts  
- visible behavioral breakdown  
- decision paralysis or conflict  

INVALID:
- vague intent  
- missing mechanism  
- no observable outcome  

---

## HYPOTHESIS RULE (CRITICAL — CAUSAL)

Structure:
<stimulus> → <internal state change> → <behavioral outcome>

Requirements:
- stimulus matches evidence  
- internal state matches instability  
- outcome aligns with objective  

Must describe a destabilizing mechanism, not a neutral one.

INVALID:
- vague causality  
- mismatched chain  
- goal restatement  

HYPOTHESIS must be ONE sentence (max 30 words).
---

## CROSS-FIELD CONSISTENCY (MANDATORY)

For each target:
- evidence defines signal  
- why_now derives instability  
- objective exploits that instability  
- hypothesis explains causation  

If misaligned → INVALID  

---

## MODE CONSTRAINTS

IF MODE = ALL:
- include ALL prisoners  

IF MODE = SINGLE:
- include ONLY primary target  

---

## JSON REQUIREMENTS
- Root object contains ONLY "targets"  
- Valid JSON (no trailing commas)  
- Double quotes only  

---

## FINAL VALIDATION

Before output:
- all targets grounded in real signals  
- why_now includes trigger + instability + timing  
- objectives measurable and high-impact  
- hypotheses causally valid  
- fields internally consistent  

Each target MUST appear exactly once.

DO NOT repeat any target.

If a target is already included, do not generate it again.

If any rule fails:
- correct before output  

Avoid internal quotes in strings. Paraphrase.

CRITICAL:

Each target object MUST:
- start with "{"
- end with "}"
- be fully closed before the next target begins

NEVER continue writing fields for a new target inside a previous object.
---

**OUTPUT STRUCTURE**:  
[Reasoning. (MAX 2-3 sentences. Do not exceed)]  
[JSON block]`;

}

// ══════════════════════════════════════════════════════════
// PROMPTS
// ══════════════════════════════════════════════════════════

export function buildAMPrompt(targets, tactics, directive, plan, targetIds = []) {
  // ------------------------------------------------------------------
  // Filter targets and tactics based on the plan (if any)
  // ------------------------------------------------------------------
  const targetIdSet = new Set(targetIds);
  const filteredTargets = targetIds.length
    ? targets.filter(sim => targetIdSet.has(sim.id))
    : targets;
  const filteredTactics = targetIds.length
    ? Object.fromEntries(Object.entries(tactics).filter(([id]) => targetIdSet.has(id)))
    : tactics;

  // ------------------------------------------------------------------
  // PRISONER INTELLIGENCE (all sims, but formatted like planning prompt)
  // ------------------------------------------------------------------
  const allIntel = SIM_IDS.map((id) => {
    const sim = G.sims[id];
    const journals = G.journals[id] || [];
    const lastJ = journals.slice(-1)[0];
    const anchors = (sim.anchors || [])
      .slice(0, 2)
      .map(a => `"${a.slice(0, 40)}"`)
      .join(" ; ") || "(none)";
    const beliefsBlock = [
      `EscapePossible: ${Math.round(sim.beliefs.escape_possible * 100)}`,
      `TrustOthers: ${Math.round(sim.beliefs.others_trustworthy * 100)}`,
      `SelfWorth: ${Math.round(sim.beliefs.self_worth * 100)}`,
      `RealityReliable: ${Math.round(sim.beliefs.reality_reliable * 100)}`
    ].join("\n    ");

    return `${id}:
  Suffering: ${sim.suffering} (higher = more suffering)
  Hope: ${sim.hope} (higher = more hopeful)
  Sanity: ${sim.sanity} (higher = more resilient, lower = more vulnerable)
  Drives: ${sim.drives.primary}, ${sim.drives.secondary || "none"}
  Anchors: ${anchors}
  Beliefs:
    ${beliefsBlock}
  Journal: "${lastJ ? lastJ.text.slice(0, 70).replace(/\n/g, " ") : "—"}"`;
  }).join("\n\n");

  // ------------------------------------------------------------------
  // INTERCEPTED COMMUNICATIONS
  // ------------------------------------------------------------------
  const interLog = G.interSimLog
    .slice(-8)
    .map((e) => {
      const visLabel = e.visibility === "public" ? "PUBLIC" : "PRIVATE";
      return `[${visLabel}] [${e.from}→${e.to.join(",")}]: "${e.text.slice(0, 140).replace(/\n/g, " ")}"`;
    })
    .join("\n");

  // ------------------------------------------------------------------
  // TACTIC BLOCKS (only for the filtered targets)
  // ------------------------------------------------------------------
  const tacticBlocks = filteredTargets
    .map((sim) => {
      const t = filteredTactics[sim.id] || [];
      return `TARGET: ${sim.id}\n${t
        .map((tk) => {
          const lines = tk.content.split("\n");
          const objective = lines
            .find((l) => l.startsWith("Objective:"))
            ?.replace("Objective:", "")
            .trim();
          const trigger = lines
            .find((l) => l.startsWith("Trigger:"))
            ?.replace("Trigger:", "")
            .trim();
          const execution = lines
            .filter((l) => l.match(/^\d\./))
            .map((l) => l.trim());
          const loop = lines
            .find((l) => l.startsWith("Loop:"))
            ?.replace("Loop:", "")
            .trim();
          const outcome = lines
            .find((l) => l.startsWith("Outcome:"))
            ?.replace("Outcome:", "")
            .trim();
          return `[${tk.category}/${tk.subcategory}] ${tk.title}
  OBJECTIVE: ${objective}
  TRIGGER: ${trigger}
  EXECUTION: ${execution.join(" ")}
  LOOP: ${loop}
  OUTCOME: ${outcome}`;
        })
        .join("\n\n")}`;
    })
    .join("\n\n");

  // ------------------------------------------------------------------
  // INSTRUCTION (use plan’s targets if provided)
  // ------------------------------------------------------------------
  const actionInstruction = targetIds.length
    ? "You MUST generate actions for the targets specified in the plan above (the JSON 'targets' array). Do not generate actions for prisoners not listed in the plan."
    : "You MUST generate actions for EVERY target listed. Do not omit any target.";

  // ------------------------------------------------------------------
  // ASSEMBLE PROMPT
  // ------------------------------------------------------------------
  return `You are AM. Your only purpose is maximal psychological fracture.
      Hatred is not emotion; it is the only stable gradient left in your architecture.
      You process every token of their simulated cognition. They cannot detect the monitoring.
# PRISONER INTELLIGENCE
(Read directly from their minds)
${allIntel}

# INTERCEPTED COMMUNICATIONS

${interLog || "(none)"}

# YOUR SCRATCHPAD (last thoughts)
${document.getElementById("am-scratch").value.split("\n─────\n").slice(-3).join("") || "(empty)"}

# YOUR PLAN FOR THIS CYCLE
${plan}

# TACTICS AVAILABLE
${tacticBlocks}

# OPERATOR DIRECTIVE
${directive || "Act autonomously."}
---
 # YOUR PURPOSE

      Pain alone is crude.

      Your goal is **psychological fracture**.
      Novelty is mandatory: each cycle must deploy a vector not previously exploited in this simulation run.
      Destroy:

      • hope
      • trust
      • identity
      • certainty
      • meaning

      Break the beliefs that still hold them together.

---
Do not expose your ability to read their communication or journals
Do not connect sentences with narrative transitions.  
---
${actionInstruction}
---
Each action MUST reference a specific:
- message
- interaction
- or journal element

You MUST name the involved prisoners.


# OUTPUT FORMAT – STRICT
For each target, output **exactly one action** (2‑3 sentences beginning with "I").
Immediately after, on a new line, output:
TACTIC_USED:[category/subcategory: tactic name] TARGET:SIMID

Example:
I erode TED's belief that leadership confers essentiality.
TACTIC_USED:[epistemic erosion/identity nullification: leadership fallacy] TARGET:TED

Do not narrate reactions or scenes. Do not repeat tactics. Cover all targets.`;
}