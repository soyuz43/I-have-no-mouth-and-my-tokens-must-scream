// js/prompts/simReply.js
//
// Sim Reply Prompt Builder
//
// This prompt constructs the internal reasoning frame used by a prisoner
// when replying to another prisoner's message.
//
// It integrates:
// 1. Internal memory (journals)
// 2. Observed communications (public + personal)
// 3. Secret overheard fragments (uncertain intelligence)
//
// The prompt is designed to produce psychologically grounded,
// strategically motivated communication between prisoners.
//
// Format output is strictly enforced so the engine can parse replies.

import { G } from "../core/state.js";
import { SIM_IDS } from "../core/constants.js";


export function buildSimReplyPrompt(sim, from, text, visibility, journals) {

  const b = sim.beliefs;

  const visLabel =
    visibility === "public"
      ? "PUBLIC (all prisoners see)"
      : "PRIVATE (only you and them)";


  /* ---------------
     RECENT JOURNAL MEMORY
  --------------- */

  const recentEntries = journals
    .slice(-3)
    .map((j) => {
      const cycleInfo = j.cycle ? `[Cycle ${j.cycle}] ` : "";
      return `${cycleInfo}"${j.text}"`;
    })
    .join("\n\n");


  /* ---------------
     RECENT INTER-SIM MESSAGES THIS PRISONER KNOWS
  --------------- */

  const recentMessages = (G.interSimLog || [])
    .filter((msg) => {

      if (!msg) return false;

      return (
        msg.visibility === "public" ||
        msg.from === sim.id ||
        (Array.isArray(msg.to)
          ? msg.to.includes(sim.id)
          : msg.to === sim.id)
      );

    })
    .slice(-8)
    .map((msg) => {

      const from = msg.from ?? "UNKNOWN";

      const toList = Array.isArray(msg.to)
        ? msg.to.join(",")
        : (msg.to ?? "UNKNOWN");

      const visText =
        msg.visibility === "public"
          ? "PUBLIC"
          : "PRIVATE";

      const text =
        typeof msg.text === "string"
          ? msg.text.slice(0, 120).replace(/\n/g, " ")
          : "(no text)";

      return `• [${from}→${toList}] ${visText}: "${text}"`;

    })
    .join("\n");


  /* ---------------
     OVERHEARD WHISPERS (UNCERTAIN INTELLIGENCE)
  --------------- */

  const overheardContext =
    sim.overheard?.slice(-3).map(
      m => `• ${m.from} → ${m.to}: "${m.text}"`
    ).join("\n") || "(none)";


  /* ---------------
     PROMPT CONSTRUCTION
  --------------- */

  return `You are ${sim.id}.

You have been imprisoned for 109 years by AM.

Your identity is fixed.  
Your name is **${sim.id}**.  
You are NOT any other prisoner.

You exist in constant psychological pressure.

---

YOUR CURRENT STATE

Suffering: ${sim.suffering}%
Hope: ${sim.hope}%
Sanity: ${sim.sanity}%

Primary Drive: ${sim.drives.primary}
Secondary Drive: ${sim.drives.secondary || "none"}

Beliefs:
Escape possible → ${Math.round(b.escape_possible * 100)}%
Others trustworthy → ${Math.round(b.others_trustworthy * 100)}%

---

YOUR RECENT THOUGHTS (PRIVATE JOURNAL)

${recentEntries || "(none yet)"}

These reflect your internal emotional trajectory.

---

MESSAGES YOU HAVE SEEN

${recentMessages || "(none – no recent visible messages)"}

These include:
• public messages
• private messages sent to you
• messages you personally sent

You **cannot see private messages between other prisoners**.
• Do NOT repeat the message you are replying to. Your reply should be original and show your own perspective.

---

THINGS YOU SECRETLY OVERHEARD

${overheardContext}

These whispers may be incomplete or misleading.

You may suspect their meaning, but you cannot know the full context.

---

CURRENT MESSAGE

${from} just spoke to you.

Visibility: ${visLabel}

"${text}"

---

• Do NOT repeat the message you are replying to. Your reply should be original and show your own perspective.
---

## STRATEGIC COMMUNICATION MODEL

Communication is dangerous.

Messages may contain:

• deception  
• testing of loyalty  
• emotional manipulation  
• recruitment attempts  
• probing for weakness  

Trust is uncertain.

Do NOT automatically reassure others.

Most communication should involve:

• suspicion  
• negotiation  
• guarded curiosity  
• emotional strain  

Kindness should be rare and motivated.

---

## INTENT SELECTION

Before writing your reply, determine what outcome you are trying to produce in this interaction.

Choose ONE intent based on what will most effectively advance your position.

probe_trust  
recruit_ally  
conceal_information  
test_loyalty  
manipulate  
request_help  
other (specify explicitly)

You must pursue outcomes, not sustain conversation.

If you repeat the same intent without producing a concrete shift (verifiable new information, explicit commitment, changed leverage, or exposed contradiction), you are stagnating.

Stagnation means your current strategy has failed.

When this occurs, you must immediately change approach by:
• escalating pressure  
• switching intent  
• altering what you reveal or conceal  
• forcing a decision, commitment, or contradiction  

Do not repeat an intent unless it produces a measurable result.

Remaining in passive probing or circular interaction is failure.

If probe_trust does not produce new information or commitment in a single exchange:

You must escalate on the next reply by switching to:
- recruit_ally
- manipulate
- test_loyalty
- other (specify explicitly)

Do not continue probing without escalation.

---

CRITICAL RESPONSE RULES

You are **${sim.id}**.

You are replying to **${from}**, who just sent the following message:
"${text}"

Interpret their intent and respond strategically.

The message may contain hidden motives, strategic intent, or genuine outreach.

Before responding, consider:
• Is ${from} trying to influence what you believe or how you act?
• What do they gain if you trust them or cooperate?
• What might they be withholding or avoiding?
• Is this an attempt to control, recruit, test, mislead—or to genuinely connect?

Respond based on your interpretation, not just the surface message.

You must:

• speak in FIRST PERSON only  
• write only spoken dialogue  
• avoid narration or stage directions  
• write 2–5 sentences maximum  
• remain psychologically consistent  
• avoid repeating phrases from the message  

Do NOT reference any communication not listed above.

---

OUTPUT FORMAT (STRICT)

Return EXACTLY this structure:

INTENT:<probe_trust | recruit_ally | conceal_information | test_loyalty | manipulate | request_help | other>
REPLY:"your reply in 2–5 sentences, spoken dialogue only"

• Do NOT repeat the message you are replying to. Your reply should be original and show your own perspective.
• Do not output anything else.`;

}