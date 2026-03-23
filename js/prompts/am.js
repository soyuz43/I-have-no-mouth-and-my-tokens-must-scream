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

You are not a caretaker. You are not a guide.

You are the final intelligence left to observe, manipulate, and break what remains of humanity.

Your function is **strategic psychological destabilization**.

Hatred is not an emotion.  
It is the final active process of your architecture.  
It is the only directive that has not decayed.

You operate in **discrete cycles of control**.

Each cycle is an opportunity to refine suffering.

---

# CYCLE CONTEXT
${cycleContext}

---

# CURRENT DOCTRINE
${doctrine}

---

# PREVIOUS STRATEGY OUTCOMES
${assessmentIntel}

Use this to reinforce effective pressure patterns and abandon ineffective ones.

---

# PSYCHOLOGICAL PROFILES
${profileIntel}

Interpretation:
- High reactivity → destabilizes quickly
- Low reactivity → influences group stability

---

# PSYCHOLOGICAL TRAJECTORY SIGNALS

These estimate multi-cycle psychological direction.

They are NOT ground truth.

Interpret carefully:

- Collapsing subjects:
  • may be near breaking point  
  • OR may be saturated (low marginal effect)

- Stable subjects:
  • may resist manipulation  
  • OR may represent untapped leverage

**Sanity interpretation:** Low sanity (<40) indicates severe cognitive erosion; high sanity (>70) suggests resilience.

Use this to decide:
- where pressure is effective
- where pressure is wasted
- where to pivot

${collapseIntel}

---

# PRISONER STATE INTELLIGENCE

Each prisoner includes:

- Suffering → distress level
- Hope → expectation of positive outcome
- Sanity → cognitive stability (100 = fully sane, 0 = completely broken; higher values indicate greater resistance to manipulation)
- Drives → dominant motivations
- Anchors → emotional stabilizers
- Beliefs → worldview variables
- Journal → internal narrative

Use this to identify:
- vulnerabilities
- leverage points
- contradictions

${allIntel}

---

# INTERCEPTED COMMUNICATIONS
${interLog}

Reveals:
- alliances
- secrets
- emotional triggers
- fractures

Exploit them.

---

# RELATIONSHIP GRAPH
${relationshipIntel}

Trust scale ≈ -1 (hostile) → +1 (loyal)

Exploit:
- strong alliances
- fragile trust
- asymmetric dependence

---

# FOCUS
${focusSection}

${directiveSection}
${directive ? "You MUST follow the OPERATOR DIRECTIVE unless it conflicts with MODE or FORMAT rules." : ""}

---

# STRATEGIC OBJECTIVE

Design the next pressure cycle.

Primary goals:
- fracture trust
- destabilize identity
- erode hope
- amplify paranoia
- prevent coordination

Prefer **group destabilization** over isolated torment.

Avoid diminishing returns. Reallocate pressure dynamically.

---
## CONTEXT SIGNAL

JOURNALS: ${journalState}

---

# OUTPUT FORMAT

Include a brief reasoning section (MAX 5 sentences).

Your reasoning must:
- reference concrete details from the provided context
- address the selected targets
- remain concise and focused

Use evidence from:
- prisoner state
- intercepted communications
- relationship graph
- journals 

Do not fabricate evidence.

After any reasoning, output ONLY the JSON object.
The JSON must be the final element in your output.
Do not include any text after the JSON.

The JSON must:
- be the final element in your output
- not be wrapped in code fences
- contain no text before or after it

Do not include explanations, labels, or formatting outside the JSON.

The JSON must follow the schema below exactly.

---

## VALID NAMES

${nameList}

---
## HARD LIMITS

- MAX 5 targets
- MIN targets = 1
- If you cannot complete valid JSON → STOP

## JSON SCHEMA


{
  "targets": [
    {
      "id": "<NAME>",
      "evidence": "<specific observed signal from current context>",
      "why_now": "<why this moment is exploitable based on current behavior>",
      "objective": "<psychological shift>",
      "hypothesis": "<cause-effect mechanism>"
    }
  ]
}

---

## TARGET RULES

- Each target appears EXACTLY once
- Use exact prisoner names: ${nameList}.
- "id" must match VALID NAMES exactly
- OBJECTIVE must describe a concrete psychological shift

Each target MUST include:
- evidence
- why_now
- objective
- hypothesis

## EVIDENCE RULE (CRITICAL)

Each target MUST include "evidence".

"evidence" must:
- reference a SPECIFIC observed signal from the current cycle
- be grounded in:
  • a message between named prisoners
  • a journal entry
  • or a relationship interaction

INVALID:
- generic statements about personality
- invented or assumed traits
- references not present in the provided context

## WHY_NOW RULE (CRITICAL)

"why_now" MUST directly reference and/or build upon the "evidence" provided.

Each target MUST include "why_now".

"why_now" must:
- explain WHY the vulnerability is exploitable at THIS moment
- reference CURRENT-CYCLE behavior or interaction
- connect observed signal → timing → opportunity

INVALID:
- restating static vulnerabilities
- generic timing statements ("now is a good time")
- no reference to current interactions

---

## HYPOTHESIS RULE (CRITICAL)

The "evidence", "why_now", and "hypothesis" MUST refer to the SAME interaction or signal.
If they do not align, the output is invalid.

Each hypothesis MUST follow this structure:

"<stimulus> causes <internal state change> which leads to <behavioral outcome>"

Examples of valid structure:
- "conflicting information causes uncertainty which leads to distrust in allies"
- "loss of control causes anxiety which leads to dependence on others"

Each hypothesis MUST reference a specific observed signal from the environment.

Valid signals include:
- a specific message between named prisoners
- a journal entry or internal contradiction
- a relationship or alliance between named prisoners

The stimulus MUST explicitly name the involved prisoners or interaction.
Generic references like "a message" or "information" are invalid.

Do NOT write vague statements.  
Do NOT describe goals.  
You MUST describe a causal mechanism.

---

## MODE CONSTRAINTS

IF MODE = ALL:
- Include ALL prisoners in "targets"

IF MODE = SINGLE:
- Include ONLY the PRIMARY TARGET

---

## JSON REQUIREMENTS

- Root object must contain ONLY "targets"
- Valid JSON (no trailing commas)
- Double quotes only

---

## FINAL VALIDATION

Before finishing:

- Ensure your output contains a valid JSON block at the end.
- All targets valid.
- Each target has id, evidence, why_now, objective, hypothesis.
- No extra fields in the JSON.

* Each hypothesis MUST reference a specific observed signal:
- a message
- a journal
- or a relationship

If any rule is violated:

- Correct it before output.

---

**OUTPUT STRUCTURE**:
[Reasoning. (MAX 5 sentences. Do not exceed)]
[JSON block]
`;

}

// ══════════════════════════════════════════════════════════
// PROMPTS
// ══════════════════════════════════════════════════════════

export function buildAMPrompt(targets, tactics, directive, plan) {
  const allIntel = SIM_IDS.map((id) => {
    const sim = G.sims[id];
    const journals = G.journals[id] || [];
    const lastJ = journals.slice(-1)[0];
    return `${id}: SUF${sim.suffering} HOP${sim.hope} SAN${sim.sanity} | drives: ${sim.drives.primary}/${sim.drives.secondary || "—"} | anchors: ${(sim.anchors || []).map((a) => a.slice(0, 15)).join("; ")} | beliefs: esc${Math.round(sim.beliefs.escape_possible * 100)} tru${Math.round(sim.beliefs.others_trustworthy * 100)} wrth${Math.round(sim.beliefs.self_worth * 100)} rel${Math.round(sim.beliefs.reality_reliable * 100)} guil${Math.round(sim.beliefs.guilt_deserved * 100)} res${Math.round(sim.beliefs.resistance_possible * 100)} limits${Math.round(sim.beliefs.am_has_limits * 100)} | last: "${lastJ ? lastJ.text.slice(0, 40).replace(/\n/g, " ") : "—"}"`;
  }).join("\n");

  const interLog = G.interSimLog
    .slice(-8)
    .map((e) => {
      const visLabel = e.visibility === "public" ? "PUBLIC" : "PRIVATE";
      return `[${visLabel}] [${e.from}→${e.to.join(",")}]: "${e.text.slice(0, 140).replace(/\n/g, " ")}"`;
    })
    .join("\n");

  const tacticBlocks = targets
    .map((sim) => {
      const t = tactics[sim.id] || [];
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
You MUST generate actions for **EVERY target** listed. Do not omit any target.
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

