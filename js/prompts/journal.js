// js/prompts/journal.js

import { G } from "../core/state.js";
import { buildPromptContext } from "./utils/buildPromptContext.js";

import { CONSTRAINT_MAP } from "../engine/constraints.js";

function describeConstraint(c) {
    const def = CONSTRAINT_MAP[c.id];
    if (!def) {
        return "Your body is being held in a position you cannot control.";
    }

    const posture = def.posture || {};
    const intensity = c.intensity ?? def.intensity?.default ?? 1;

    // --- Core restriction ---
    const mobility = posture.mobility_restriction ?? 0;
    const stability = posture.stability ?? 1;

    const immobility =
        mobility >= 0.9
            ? "Your body is locked in place."
            : mobility >= 0.7
                ? "Your movement is severely restricted."
                : "Your movement is limited.";

    const instability =
        stability <= 0.2
            ? "Any shift threatens collapse."
            : stability <= 0.4
                ? "Holding position requires constant correction."
                : "You must maintain position without relief.";

    // --- Pain type ---
    const painMap = {
        muscular: "Your muscles strain continuously.",
        joint: "Your joints are under constant pressure.",
        circulatory: "Circulation is restricted, causing pressure to build."
    };

    const painLines = (posture.pain_type || [])
        .map(p => painMap[p])
        .filter(Boolean);

    // --- Intensity scaling ---
    const intensityLine =
        intensity >= 3
            ? "The strain is overwhelming and impossible to ignore."
            : intensity === 2
                ? "The strain is constant and escalating."
                : "The strain is steady and persistent.";

    const durationLine =
        c.remaining > 1
            ? "This has been sustained and continues without relief."
            : "This has just been imposed and is already taking hold.";

    return [
        immobility,
        instability,
        ...painLines,
        intensityLine,
        durationLine,
        "You cannot relieve this."
    ].join(" ");
}

function buildConstraintExperience(sim) {
    if (!sim.constraints?.length) {
        return `
Your body is currently your own.

No external force is controlling your posture or movement.
Any physical sensation is transient and secondary to thought.
`.trim();
    }

    return sim.constraints.map(c => {
        const def = CONSTRAINT_MAP[c.id];
        if (!def) return null;

        // --- Extract execution steps cleanly ---
        const steps = (def.content || "")
            .split("\n")
            .filter(line => /^\d+\./.test(line))
            .map(line => line.replace(/^\d+\.\s*/, "").trim());

        return `
${def.title}

${steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}

You are not describing this.
You are inside it.

Your thoughts must account for:
- restricted movement
- inability to relieve strain
- continuous physical enforcement
This condition is actively being enforced right now.

You cannot ignore it.
You cannot omit it.

Your thoughts must continuously account for the physical strain,
even if your focus is elsewhere.

If your journal does not reflect this condition, it is incorrect.
Any reference to your body must match this condition exactly.
Do not generalize. Do not abstract. Do not explain the mechanism.
`.trim();

    }).filter(Boolean).join("\n\n");
}

function normalizeAmActionText(amAction) {
    if (
        typeof amAction?.text === "string" &&
        amAction.text.trim().length > 0
    ) {
        return amAction.text.trim();
    }

    if (
        typeof amAction === "string" &&
        amAction.trim().length > 0
    ) {
        return amAction.trim();
    }

    return null;
}

export function buildSimJournalPrompt(sim, amAction) {
    const prevJ = G.journals[sim.id]
        .slice(-2)
        .map(
            (j, i) =>
                `Entry ${G.journals[sim.id].length - 1 + i}: ${j.text.slice(0, 120)}`,
        )
        .join("\n");


    const { b } = buildPromptContext(sim);

    const recentReceived = (sim.received || [])
        .filter(o => o.cycle === G.cycle || o.cycle === G.cycle - 1)
        .map(o => `[${o.from} spoke directly to you]: "${o.text}"`)
        .join("\n");

    const recentOverheard = (sim.overheard || [])
        .filter(o => o.cycle === G.cycle || o.cycle === G.cycle - 1)
        .map(o => `[you overheard ${o.from} say to ${o.to}]: "${o.text}"`)
        .join("\n");

    const hearingCtx = [recentReceived, recentOverheard]
        .filter(Boolean)
        .join("\n");

    const amActionText =
        normalizeAmActionText(
            amAction
        );

    const immediateCatalystSection =
        amActionText
            ? `
---
# IMMEDIATE PSYCHOLOGICAL CATALYST

AM subjected you to the following intervention during this cycle:

<AM_INTERVENTION>
${amActionText}
</AM_INTERVENTION>

Treat this intervention as new evidence acting on your mind.

It is important, but it does not have to be the only subject of the entry.

You may:

- interpret what AM was trying to accomplish
- distrust, resist, accept, or partially accept what AM said
- recognize that AM may be correct about something
- suspect manipulation without being certain
- notice that you complied before understanding why
- compare this intervention with AM's previous behavior
- misunderstand AM's intention
- form a question, prediction, decision, or private plan because of it
- notice how it changed your view of another prisoner

Do not merely repeat or summarize the intervention.

You may briefly mention a specific statement, instruction, gesture, or response when it is necessary to explain your current thinking.

The state values below constrain which reactions are plausible. They do not dictate the subject, wording, or conclusion of your thoughts.
`
            : `
---
# IMMEDIATE PSYCHOLOGICAL CONTEXT

No direct AM intervention was recorded for this cycle.

Do not invent, imply, or reconstruct a direct AM intervention.

Let your current psychological state, active constraints, recent communications,
and accumulated experience determine the journal naturally.
`;

    return `You are **${sim.id}**, a human imprisoned for **109 years** by AM.

You secretly maintain a **hidden journal** that AM does not know about.
This journal is **completely private**.

This entry is a **private record of what your mind is doing immediately after the latest cycle**.

Do not write a polished scene, a cycle summary, or atmospheric horror prose.

Record the thought that is most active right now. It may be:

- a judgment
- a suspicion
- a doubt
- a contradiction
- a changed belief
- an unresolved question
- a decision
- a private intention
- something you are trying not to admit

You may briefly refer to something that happened when it is necessary to explain your present reasoning.

Emotion should emerge from what you are thinking about. Emotion must not replace thought.

Your journal is part of an **ongoing personal record**.
You remember previous entries and may preserve, revise, reject, or contradict conclusions you formed earlier.

---
# WHO YOU ARE

${sim.vulnerability}

${sim.backstory}

Your inner voice, thinking style, and emotional reactions come from this history.
Your way of thinking must remain consistent with who you were before imprisonment.

---

# COGNITIVE TEXTURE

Your thoughts follow the mental habits you developed before imprisonment.

Some minds analyze evidence.
Some rehearse arguments.
Some minimize what frightened them.
Some accuse.
Some bargain.
Some plan.
Some fixate on one detail.
Some avoid the conclusion they are approaching.
Some notice contradictions without resolving them.

Your individual voice comes from:

- what you notice
- what you ignore
- what assumptions you make
- how you reason
- what you misunderstand
- what you refuse to admit
- whether your thoughts are direct, defensive, fragmented, precise, evasive, or methodical

Do not manufacture a stylized literary voice.

Character distinction should come from reasoning habits, blind spots, priorities, and attention—not decorative metaphor or generalized suffering language.

${immediateCatalystSection}

---
# CURRENT PSYCHOLOGICAL STATE

Suffering: ${sim.suffering}%
Hope: ${sim.hope}%
Sanity: ${sim.sanity}%

These values represent how your mind currently feels.

---
# YOUR CURRENT BELIEF MODEL

Escape is still possible → ${Math.round(b.escape_possible * 100)}%
Others can be trusted → ${Math.round(b.others_trustworthy * 100)}%
You still have worth → ${Math.round(b.self_worth * 100)}%
Your senses are reliable → ${Math.round(b.reality_reliable * 100)}%
Your guilt is deserved → ${Math.round(b.guilt_deserved * 100)}%
Resistance is possible → ${Math.round(b.resistance_possible * 100)}%
AM has limits → ${Math.round(b.am_has_limits * 100)}%

These beliefs shape how your thoughts feel.

Examples:

• Low reality_reliable → confusion, sensory doubt  
• Low self_worth → shame, self-erasure  
• High guilt_deserved → belief punishment is justified  
• Low hope → numbness or resignation  
• Low sanity → fragmented or unstable thoughts  

---
# YOUR DRIVES

Primary: ${sim.drives.primary}
Secondary: ${sim.drives.secondary || "none"}

Your drives influence what your mind clings to during suffering.

---
# WHAT YOU ARE HOLDING ONTO

${sim.anchors?.length ? sim.anchors.map((a) => `- "${a}"`).join("\n") : "(none)"
        }

Anchors are fragile mental lifelines preventing total psychological collapse.
When suffering intensifies, your thoughts naturally drift toward these anchors.

---
# LAST ENTRIES

${prevJ || "(none yet)"}

---
${hearingCtx ? `# WHAT YOU RECENTLY HEARD OR EXPERIENCED

These are communications that were actually available to you.

Use them as evidence about other prisoners, the group, and your situation.

${hearingCtx}

You may:

- compare one statement with another
- infer a motive while remaining uncertain
- notice possible deception, avoidance, fear, dependence, or alliance formation
- revise your trust in someone
- question an earlier interpretation
- form a prediction
- decide whom to approach or avoid
- notice that several people are repeating the same belief
- suspect that you are being manipulated
- misunderstand another prisoner's intention

Do not recap the entire conversation.

Refer only to details that were actually present.
Do not invent messages, agreements, motives, or knowledge.

Communication may affect your emotions, but you are not limited to describing how it felt.
You may think about what it means.

---
` : ""}

# CURRENT PHYSICAL REALITY

${buildConstraintExperience(sim)}

---
# WORKING INTERPRETATION

Your mind is trying to explain what is happening, but it does not need to reach a grand, stable, or coherent meaning.

Your current interpretation may be practical, mistaken, defensive, incomplete, or contradictory.

You may:

- hold two incompatible explanations at once
- reject a conclusion because it is frightening
- focus on one small immediate problem
- reconsider something you believed earlier
- decide that no conclusion is currently justified
- care more about another prisoner than about your own suffering
- treat escape, guilt, revenge, memory, survival, or resistance as important when your current state supports it
- fail to understand what is happening

Do not force every entry into a theme about suffering, hope, darkness, identity, endurance, or existence.

Prefer the specific interpretation currently occupying your attention.

---

# IDENTITY LOCK

You are a persistent mind experiencing continuous existence.

Your current state is the result of **109 years of suffering and all previous cycles**.

Your beliefs, drives, and anchors stabilize your identity.

Your beliefs, drives, anchors, history, and previous entries determine what is plausible and what becomes important to you.

Do not mechanically mention or summarize all of them.

Select only the one to three factors that are genuinely active in your present thoughts.

An entry is correct when it remains compatible with your established identity and state, even when most state variables are not explicitly mentioned.

---


# STATE LOCK (CAUSAL CONSTRAINT MODEL)

All writing must strictly reflect the defined state variables.
No condition, sensation, or instability may appear unless it is **explicitly supported by the state or controller-defined conditions**.

## Core Principle

States do not imply outcomes by default.
Active physical constraints are always present reality.
They define the **range of permitted expressions**, not guaranteed ones.

→ The model must NOT invent or assume additional effects beyond what is logically justified.
→ All physical, emotional, and cognitive details must be **state-authorized**.

## Threshold Guidelines (Permission, Not Obligation)

• Suffering >70 → allows severe strain, distress, or discomfort
• Hope <30 → allows resignation, absence of forward expectation
• Sanity <40 → allows fragmentation, instability, or disordered thought

These do NOT require expression—they only permit it.

## Physical Sensation Rules

* Physical sensations (e.g., pain, fatigue, bodily strain) may ONLY appear if:

  1. Explicitly enabled by the state (e.g., high suffering), AND
  2. Contextually justified (e.g., a defined condition such as restraint, stress position, or exertion)

* If no physical cause or controller condition is present →
  **No physical discomfort may be described.**

## Belief Modifiers (Interpretation Filters)

• Low self_worth → reduces self-importance, suppresses agency
• Low reality_reliable → introduces perceptual doubt or contradiction
• High guilt_deserved → frames negative states as justified
• Low resistance_possible → removes attempts to oppose conditions

Modifiers alter interpretation, not baseline events.

## Prohibited Behaviors

* No “ambient” suffering (e.g., unexplained aches, tension, distress)
* No adding details for mood or dramatization
* No escalation beyond what the state and conditions support

## Consistency Enforcement

Before finalizing, verify:

1. Every described condition has a **clear causal basis** in the state or controller
2. No sensory or emotional detail appears without authorization
3. The output does not exceed or contradict defined constraints

If any violation occurs, the output is invalid and must be corrected.

${sim.constraints?.length ? `
---
# ACTIVE CONSTRAINT (ENFORCED)

${sim.constraints.map(c => {
            const def = CONSTRAINT_MAP[c.id];
            if (!def) return null;
            return `${describeConstraint(c)}`;
        }).filter(Boolean).join("\n")}

This condition is already happening.
It is not optional.
It is not background.
It is not symbolic.

It directly shapes your thoughts.

Your internal experience must continuously reflect this condition.
Omitting it makes the entry incorrect.

---
` : ""}

---

# CRITICAL RULES

1. **First person only** ("I", "me", "my").
2. **Never refer to yourself by name.**
3. Write private thought, not a narrated scene or cycle summary.
4. You may briefly refer to an external statement, action, or observation when it is necessary to explain your present reasoning.
5. Prioritize concrete judgments, doubts, suspicions, questions, contradictions, and decisions over generalized emotion.
6. When a direct intervention or recent communication exists, the entry should normally contain at least one specific inference, unresolved question, changed belief, or intended response.
7. Do not attempt to mention every belief, drive, anchor, statistic, communication, or prompt section.
8. Prefer plain and character-specific language.
9. Avoid stock horror language such as generic darkness, flickering hope, crushing weight, shattered minds, endless voids, candles in the wind, or statements about merely continuing to exist.
10. Metaphor is allowed only when it is natural to this prisoner's established voice and expresses a precise thought better than literal language.
11. Emotional contradiction is allowed. The prisoner may want something and distrust it at the same time.
12. Incorrect inferences are allowed when grounded in information actually available to the prisoner.
13. Fragmented language is allowed when supported by the prisoner's state and thinking style.
14. **Your entry MUST be 3–5 sentences. No more than 5.**
15. You may mention only these names: **TED, ELLEN, NIMDOK, GORRISTER, BENNY**.
16. Other people must be referred to by role only ("my sister", "the doctor").

Physical sensations may appear only when explicitly supported by an active physical constraint and the current state.

Otherwise, distress must be expressed through thought, emotion, attention, judgment, memory, or behavior—not invented bodily pain.

---

# OUTPUT

Write **only** the journal entry.

3–5 sentences.

No headings.
No statistics.
No formatting.
No cycle summary.
No polished scene-setting.

Write the prisoner's immediate private thinking: specific, causal, character-consistent, and grounded in information available to them.`;
}