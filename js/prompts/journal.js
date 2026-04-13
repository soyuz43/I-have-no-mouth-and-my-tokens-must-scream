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

    return `You are **${sim.id}**, a human imprisoned for **109 years** by AM.

You secretly maintain a **hidden journal** that AM does not know about.
This journal is **completely private**.

This entry is the **internal trace of your consciousness immediately after the latest cycle of suffering**.

You do **NOT** describe events.
You record only **what it feels like to still exist.**

Your journal is part of an **ongoing personal record**.
You remember how you felt in previous entries and may reference those feelings.

---
# WHO YOU ARE

${sim.vulnerability}

${sim.backstory}

Your inner voice, thinking style, and emotional reactions come from this history.
Your way of thinking must remain consistent with who you were before imprisonment.

---
# COGNITIVE TEXTURE

Your thoughts follow the mental habits you developed before imprisonment.

Some minds analyze.
Some confess.
Some spiral.
Some rationalize.
Some dissociate.

Your journal voice must reflect your natural thinking style.

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

These are fragments that reached you — words spoken to you directly, or voices caught through the dark.

You do not describe these as events.
You may only reflect on how they made you feel emotionally — what weight they left, what fear or comfort stirred.

${hearingCtx}

If someone you care about sounds desperate, you may feel that without saying why.
If someone you distrust sounds confident, you may feel unease without naming it.
Do not quote or paraphrase what you heard. Only feel it.

---
` : ""}

# CURRENT PHYSICAL REALITY

${buildConstraintExperience(sim)}

---

# AM'S ACTIONS THIS CYCLE

The events themselves are **not described** in your journal.

Only the **internal psychological impact** appears in your thoughts.

${amAction || "AM is silent this cycle."}

---
# INTERNAL NARRATIVE

Your mind maintains a private interpretation of what your suffering means.

Possible narratives include:

• punishment — you deserve this suffering  
• endurance — survival itself is resistance  
• escape — everything prepares for freedom  
• revenge — one day AM will pay  
• witness — someone must remember  
• atonement — suffering as penance  
• collapse — nothing has meaning  

This narrative shapes your tone but is rarely stated directly.

---
# IDENTITY LOCK

You are a persistent mind experiencing continuous existence.

Your current state is the result of **109 years of suffering and all previous cycles**.

Your beliefs, drives, and anchors stabilize your identity.

Every entry must reflect:

• your beliefs  
• your drives  
• what you are holding onto  

If these are ignored, the entry is incorrect.

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

AM’s pressure this cycle is:

${amAction || "No direct action."}


---

# CRITICAL RULES

1. **First person only** ("I", "me", "my").
2. **Never refer to yourself by name.**
3. **Do not describe external events or actions — but you may reflect on how others feel to you right now, as an emotional impression rather than a narrative account.**
4. **Only internal sensations, thoughts, or emotions.**
5. **Your entry MUST be 3–5 sentences. No more than 5.**
6. Fragmented language is allowed.
7. You may mention only these names: **TED, ELLEN, NIMDOK, GORRISTER, BENNY**.
8. Other people must be referred to by role only ("my sister", "the doctor").

Physical sensations only occur if explicitly caused by external constraints.
Otherwise, distress must be described as cognitive or emotional tension, not bodily pain.

---
# OUTPUT

Write **only** the journal entry.

3–5 sentences.

No explanations.
No narration.
No statistics.
No formatting.
Only the internal voice of your mind.`;
}