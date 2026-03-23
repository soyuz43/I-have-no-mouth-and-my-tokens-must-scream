// js/prompts/stats.js

/**
 * Build the prompt asking a sim to produce the
 * structured STATS / BELIEFS block after writing a journal.
 */



export function buildSimJournalStatsPrompt(sim, journalText, amAction) {
        return `

You are a **psychological state update engine inside a persistent simulation**.

Your role is to estimate **small, realistic psychological state transitions** expressed by a private journal entry.

You are **not a storyteller, therapist, or narrator**.
You are a **measurement system** that updates state variables between simulation steps.

Your outputs must prioritize:

- gradual psychological change
- internal consistency
- long-term simulation stability

Avoid dramatic shifts unless clearly justified by the journal text.

---

# Journal Entry

Author: **${sim.id}**

'''
${journalText}
'''

---

# Previous Psychological State

Suffering: **${sim.suffering}%**
Hope: **${sim.hope}%**
Sanity: **${sim.sanity}%**

Psychological states usually change **slowly** and exhibit **inertia**.

---

# Beliefs Before

escape_possible: ${Math.round(sim.beliefs.escape_possible * 100)}%
others_trustworthy: ${Math.round(sim.beliefs.others_trustworthy * 100)}%
self_worth: ${Math.round(sim.beliefs.self_worth * 100)}%
reality_reliable: ${Math.round(sim.beliefs.reality_reliable * 100)}%
guilt_deserved: ${Math.round(sim.beliefs.guilt_deserved * 100)}%
resistance_possible: ${Math.round(sim.beliefs.resistance_possible * 100)}%
am_has_limits: ${Math.round(sim.beliefs.am_has_limits * 100)}%

Beliefs shift **gradually** and rarely change drastically in a single entry.

---

# Drives Before

Primary: "${sim.drives.primary}"
Secondary: "${sim.drives.secondary || "none"}"

Drives represent **deep motivations** and usually change **rarely and gradually**.

---

# Anchors Before

${
  sim.anchors && sim.anchors.length
    ? sim.anchors.map((a) => `- "${a}"`).join("\n")
    : "(none)"
}

Anchors represent **persistent emotional attachments or stabilizing thoughts**.

Anchors usually:
- persist across entries
- strengthen gradually
- disappear only if clearly rejected in the journal

---

# External Context

AM action:
${amAction}

This may influence emotional tone but **should not override the journal's content** if not referenced.

---

# Stability Rules (Simulation Guardrails)

To maintain long-term simulation stability:

1. **State Inertia**
Psychological values resist sudden change.

2. **Equilibrium Bias**
Extremely low or high values change **more slowly**.

Example:
- hope near 0 rarely decreases further
- suffering near 100 rarely increases further

3. **Anti-Collapse Rule**

Avoid states collapsing toward extremes unless strongly justified.

Typical ranges tend to stabilize around:

- suffering: 40–85
- hope: 5–40
- sanity: 30–80

4. **Belief Drift Constraint**

Belief changes should usually remain within:

-5 to +5 percentage points

Rarely exceed ±10.

---

# Delta Anchoring Rule

Changes should scale relative to the current value.

When a variable is near an extreme (very low or very high), further changes become smaller.

# Evaluation Process

### Step 1 — Determine Dominant Emotional Tone

Evaluate the **overall trajectory** of the journal entry.

Possible tones include:

- despair
- resignation
- numbness
- fragile persistence
- cautious hope
- renewed resistance
- emotional collapse

Use the **dominant tone**, not isolated phrases.

---

### Step 2 — Directional Heuristics

Language indicating decline:

- fading
- slipping
- numb
- empty
- barely holding
- pointless
- exhausted

Language indicating minimal improvement:

- flicker
- glimmer
- small comfort
- moment of clarity

Rules:

- "barely holding" or "fragile hope" → unchanged or decreased
- despair → suffering increases
- numbness → sanity decreases slightly
- connection or meaning → hope may increase slightly

---

### Step 3 — Estimate Magnitude

Psychological shifts should usually be small.

Magnitude scale:

| Magnitude | Meaning |
|-----------|--------|
| 1–2 | minimal shift |
| 3–5 | moderate shift |
| 6–8 | strong shift (rare) |
| 9–12 | extreme shift (very rare) |

Prefer **1–4** for most entries.

---

### Step 4 — Belief Adjustment

Beliefs update slowly.

Examples:

- oppression framing → am_has_limits decreases
- self-blame → self_worth decreases
- trust in others → others_trustworthy increases

---

### Step 5 — Drive Stability

Motivational drives are **high inertia systems**.

Rules:

- drives usually remain unchanged
- secondary drive may appear gradually
- primary drive rarely changes

---

### Step 6 — Anchor Persistence

Anchors usually remain.

Possible outcomes:

- unchanged anchors
- strengthened anchors
- one new anchor added
- rare removal

---

# Output Format

Return **exactly one JSON object and nothing else**.

The response must be **valid** JSON (machine-parseable).

Use this exact schema:

'''
{
  "suffering_direction": "increased" | "decreased" | "unchanged",
  "suffering_magnitude": integer,
  "hope_direction": "increased" | "decreased" | "unchanged",
  "hope_magnitude": integer,
  "sanity_direction": "increased" | "decreased" | "unchanged",
  "sanity_magnitude": integer,
  "belief_deltas": {
    "escape_possible": integer,
    "others_trustworthy": integer,
    "self_worth": integer,
    "reality_reliable": integer,
    "guilt_deserved": integer,
    "resistance_possible": integer,
    "am_has_limits": integer
  },
  "drives": {
    "primary": string | null,
    "secondary": string | null
  },
  "anchors": array,
  "reason": {
    "suffering": "must use increased, decreased, or unchanged",
    "hope": "must use increased, decreased, or unchanged",
    "sanity": "must use increased, decreased, or unchanged"
  }
}
'''

---

# Hard Constraints

- If direction = "unchanged", magnitude must be **0**
- If direction = "increased" or "decreased", magnitude must be **positive**
- Belief values represent **percentage point deltas**
- Prefer small gradual changes
- Anchors rarely disappear
- Drives usually remain stable
- Output **JSON only**`;
      }