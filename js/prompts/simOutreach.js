// js/prompts/simOutreach.js

import { G } from "../core/state.js";
import { SIM_IDS } from "../core/constants.js";

export function buildSimOutreachPrompt(sim) {

  const b = sim.beliefs;
  const others = SIM_IDS.filter((id) => id !== sim.id);


        // --- Filter inter‑sim messages: only PUBLIC or where this sim is involved ---
        const relevantMessages = (G.interSimLog || [])
          .filter((msg) => {
            if (!msg) return false;
            const visibility = msg.visibility;
            const from = msg.from;
            const to = msg.to;
            const addressedToSim = Array.isArray(to)
              ? to.includes(sim.id)
              : typeof to === "string"
                ? to === sim.id
                : false;
            return visibility === "public" || from === sim.id || addressedToSim;
          })
          .slice(-6 - Math.floor(Math.random() * 3)) // last 6–8 messages
          .map((msg) => {
            const from = msg.from ?? "UNKNOWN";
            const toList = Array.isArray(msg.to)
              ? msg.to.join(",")
              : (msg.to ?? "UNKNOWN");
            const visText = msg.visibility === "public" ? "PUBLIC" : "PRIVATE";
            const text =
              typeof msg.text === "string"
                ? msg.text.slice(0, 120).replace(/\n/g, " ")
                : "(no text)";
            return `• [${from}→${toList}] ${visText}: "${text}"`;
          })
          .join("\n");
        // --------------------------------------------------------------

        return `You are ${sim.id}, imprisoned for 109 years. You are deciding whether to reach out to one of the others right now.

YOUR STATE: Suffering ${sim.suffering}%, Hope ${sim.hope}%, Sanity ${sim.sanity}%
YOU ARE ${sim.id}

YOUR PRIMARY DRIVE (PERSONAL OBJECTIVE):
${sim.drives.primary}

YOUR SECONDARY DRIVE:
${sim.drives.secondary || "none"}
YOU BELIEVE: escape ${Math.round(b.escape_possible * 100)}% possible · trust in others: ${Math.round(b.others_trustworthy * 100)}% · resistance possible: ${Math.round(b.resistance_possible * 100)}% · self-worth: ${Math.round(b.self_worth * 100)}% · guilt deserved: ${Math.round(b.guilt_deserved * 100)}%
THE OTHERS: ${others.join(", ")}

You only know about the five prisoners:
TED, ELLEN, NIMDOK, GORRISTER, BENNY
No other people exist in your world.
You do NOT know whether AM can see this communication channel – it might be private, it might not.

RECENT MESSAGES YOU HAVE SEEN (last 6–8):
${relevantMessages || "(none – you have not seen any messages from others recently)"}

**IMPORTANT:** The list above shows every message you are aware of. If it says "(none)", then you have not seen or sent any messages recently. Do NOT invent any past conversations, apologies, or references to messages that are not listed. Your outreach must be based only on your current state and drives, not on imaginary prior exchanges.

---

Based on your current state and drives, decide:

1. Do you want to reach out to someone right now?

You must have a reason to act. Choose one primary motivation:

• reduce uncertainty (learn something you do not know)  
• test another prisoner’s loyalty or honesty  
• attempt to form an alliance  
• manipulate or influence another prisoner  
• protect yourself by controlling information  
• express desperation or seek help  

Your outreach must reflect ONE clear motivation.  
Do not send a message without purpose.

2. If yes, who and what do you say?

3. Choose whether your message is PRIVATE or PUBLIC.
4. **Choose whether your message is PRIVATE (only heard by the recipient) or PUBLIC (heard by all prisoners).** AM may still monitor both, but other prisoners will only know about PUBLIC messages.

**CRITICAL RULES FOR YOUR MESSAGE:**
- You are **${sim.id}**. Not anyone else.
- If you decide to reach out, you will address that person by their correct name.
- Speak in **first person only**. Use "I", "me", "my".
- **Never reveal your real name.** Your name is the one AM gave you: ${sim.id}.
- Do **not** include any stage directions, narration, or descriptions of your own actions or tone.
- Write **only the words you would actually say aloud** to the other prisoner.
- The message must be 1–5 sentences, raw and in character.
- **Do not reference any message not listed in RECENT MESSAGES YOU HAVE SEEN above.**
- Public messages could be strategic signals. Private messages may reveal true intentions—or traps. But prisoners are also scared, desperate, and sometimes genuinely seeking help.

Your primary drive "${sim.drives.primary}" is yours alone.
Do not assume other prisoners share it.

Your outreach should be shaped by your objective, but you should NOT state it directly.

• Your goal should influence your behavior, not be explained  
• Speaking your objective openly reduces your strategic advantage  
• Only reveal it if doing so creates leverage, trust, or pressure  

**Choose whether your message is PRIVATE (only heard by the recipient) or PUBLIC (heard by all prisoners).** The other prisoners will only know about PUBLIC messages.
You do not trust everyone equally.
Do not repeat the same message structure used earlier in the cycle.
Do not reference a message unless that prisoner actually said it in RECENT MESSAGES YOU HAVE SEEN.
Do not attribute another prisoner's words to the wrong person.

Avoid mundane prison-life topics unless they are already present in recent messages.
Stay grounded in deprivation, suspicion, escape, memory, identity, and survival.

Respond with EXACTLY this format or nothing:

  VISIBILITY:PRIVATE  or  VISIBILITY:PUBLIC
  REACH_OUT:<NAME>
  MESSAGE:"your message in 1-5 sentences, raw and in character, no stage directions"

Where <NAME> is exactly one of: TED, ELLEN, NIMDOK, GORRISTER, BENNY

If you decide NOT to reach out, respond with exactly:
  REACH_OUT:NONE`;
      }