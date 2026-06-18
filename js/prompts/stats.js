// js/prompts/stats.js

import { G } from "../core/state.js";
/**
 * Build the forensic-analysis prompt used to estimate
 * structured stat, belief, drive, and anchor changes
 * from a prisoner's journal and cycle context.
 *
 * The prisoner is the subject of the analysis.
 * The FORENSIC_STATS role performs the analysis.
 */
function buildConstraintExecutionContext(sim) {
  if (!sim?.constraints?.length) return "(none)";

  return sim.constraints.map(c => {
    const title = c.title || c.id || "Unknown Constraint";
    const subcategory = c.subcategory || "Unknown Subcategory";
    const intensity = c.intensity ?? 1;
    const remaining = c.remaining ?? 0;

    const content = String(c.content || "");
    const executionMatch = content.match(/Execution:\s*([\s\S]*?)(?:Outcome:|$)/i);

    const execution = executionMatch
      ? executionMatch[1]
        .trim()
        .split("\n")
        .map(line => line.trim())
        .filter(Boolean)
        .join("\n")
      : "(no execution details)";

    return [
      `- ${title}`,
      `  Subcategory: ${subcategory}`,
      `  Intensity: ${intensity}`,
      `  Remaining cycles: ${remaining}`,
      `  Execution:`,
      execution.split("\n").map(line => `    ${line}`).join("\n")
    ].join("\n");
  }).join("\n\n");
}

function buildRecentJournalContext(sim) {
  const journals = G.journals?.[sim.id] || [];
  const prior = journals.slice(-4).reverse();

  if (!prior.length) return "(none)";

  return prior.map((j, index) => {
    const weight = index === 0 ? "high" : index === 1 ? "medium" : "low";
    const limit = index === 0 ? 700 : index === 1 ? 450 : 250;
    const text = String(j.text || "").replace(/\s+/g, " ").slice(0, limit);

    return [
      `Prior journal ${index + 1}`,
      `Cycle: ${j.cycle ?? "unknown"}`,
      `Temporal weight: ${weight}`,
      `Excerpt: "${text}"`
    ].join("\n");
  }).join("\n\n");
}

export function buildSimJournalStatsPrompt(sim, journalText, amAction) {

  // Build belief lines with safe delta limits
  const beliefKeys = [
    'escape_possible',
    'others_trustworthy',
    'self_worth',
    'reality_reliable',
    'guilt_deserved',
    'resistance_possible',
    'am_has_limits'
  ];

  const beliefLines = beliefKeys.map(key => {
    const current = Math.round(sim.beliefs[key] * 100);
    const maxIncrease = 100 - current;
    const maxDecrease = current;
    return `${sim.id}.${key}: ${current}%   (max +${maxIncrease} / -${maxDecrease})`;
  }).join('\n');

  return `


**Core Directive**: You are a **psychological state measurement system**, not a narrator. Your sole function: estimate *minimal, evidence-proportional transitions* in psychological variables based on a private journal entry. Prioritize:  
1. Internal consistency across simulation steps  
2. Long-term stability via inertia modeling  
3. Fidelity to strong textual signals (never suppress genuine breaks)  

---

**Forensic Measurement Frame**
You are performing forensic psychological inference from written evidence.

Treat the current journal as the primary source.
Treat prior journals as longitudinal context only.
Older journals have weaker evidentiary weight.

You are not diagnosing globally.
You are estimating what changed this cycle.

Every nonzero stat or belief delta must be supported by at least one textual or contextual observation.
If evidence is weak, ambiguous, or non-causal, use 0 or a smaller delta.

---

**Input Context**

Journal Author: ${sim.id}  
Most Recent Journal Text — PRIMARY EVIDENCE:
'''
${journalText}
'''

Prior Journal Context — SECONDARY EVIDENCE, TEMPORALLY DECAYED:
'''
${buildRecentJournalContext(sim)}
'''

Previous State:  
- Suffering: ${sim.suffering}% | Hope: ${sim.hope}% | Sanity: ${sim.sanity}%  
- Drives: Primary="${sim.drives.primary}", Secondary="${sim.drives.secondary || "none"}"  
- Anchors: ${sim.anchors?.length ? sim.anchors.map(a => '"' + a + '"').join(", ") : "(none)"}  
- AM Action Context: ${amAction}  

**Stress Position Context (Active Constraints)**  
'''
${buildConstraintExecutionContext(sim)}
'''  

**Critical Interpretation Guidance**:  
- Constraints represent *embodied stress positions*: sustained physical strain, restricted movement, cognitive disruption, or emotional wear.  
- Use constraint context as **interpretive lens** for:  
  - Fatigue cues ("my arms won't hold", "can't think straight")  
  - Hopelessness rooted in bodily exhaustion  
  - Frustration amplified by physical limitation  
- **DO NOT**:  
  - Mechanically copy expected constraint effects into output  
  - Invent large deltas solely because a constraint is active  
  - Override journal evidence with constraint assumptions  
- **DO**:  
  - Weight journal cues *in light of* constraint-induced strain  
  - Allow high-intensity/low-remaining constraints to justify slightly larger suffering/sanity deltas *if textually supported*  
  - Treat constraint context as corroborative, not determinative  

**Signal Fidelity Principle**  
- Default assumption: psychological change is *small* (1–6 percentage points).  
- EXCEPTION: If journal contains unambiguous language of collapse ("I am broken"), breakthrough ("I see the truth"), or surrender ("nothing matters"), you MUST apply proportionally large shifts (7–10+ pts) *if textually justified*.  
- Never reduce magnitude to preserve stability—stability emerges from accurate measurement.  

**Change Scaling Protocol** (apply in priority order)  
1. **Boundary Check**: Belief deltas MUST respect hard limits:  

${beliefLines}  

   - If inferred delta exceeds bounds, REDUCE magnitude to fit within bounds.
   - Do not assume clamping will correct invalid outputs.  
   - Near extremes (<10 or >90): changes default to 0–2 pts unless text is overwhelming.  

2. **Stress-Position Modulation**:  
   - If active constraints have intensity ≥3 AND remaining cycles ≤2:  
     - Suffering deltas may increase by +1 pt (max) if journal references strain/fatigue  
     - Sanity deltas may decrease by -1 pt (max) if journal references cognitive disruption  
   - These are *modulators*, not overrides: journal evidence remains primary.  

3. **Tone-to-Direction Mapping**:  
   | Dominant Tone | Suffering | Hope | Sanity |  
   |---------------|-----------|------|--------|  
   | despair/collapse | ↑ | ↓ | ↓ |  
   | numbness/emptiness | →/↑ | → | ↓ |  
   | fragile persistence | → | → | → |  
   | cautious hope | ↓ | ↑ | → |  
   | renewed resistance | → | ↑ | → |  
   | intellectual strain | ↑ | → | ↓ |  
   - Use *dominant trajectory*, not isolated phrases.  
   - Frustration/strain without resolution → never increase hope/sanity.  

4. **Magnitude Calibration**:  
   - 1–3 pts: subtle shift (default for ambiguous/moderate cues)  
   - 4–6 pts: moderate shift (clear emotional valence)  
   - 7–10 pts: strong shift (requires explicit intense language: "shattered", "transformed")  
   - 10+ pts: extreme shift (only for textual evidence of total psychological reorganization)  
   - Apply equilibrium bias: values near extremes change more slowly.  

5. **Belief Adjustment Rules**:  
   - Default drift: ±2–8 pts  
   - Direct belief challenge in text: ±6–10 pts (max)  
   - Never apply large deltas repeatedly without narrative justification.  

6. **Drive/Anchor Dynamics**:  
   - Drives: high inertia; primary rarely changes; secondary may emerge gradually.  
   - Anchors: persist unless journal explicitly rejects them ("that was a lie") or expresses total surrender ("I give up"). New anchors only if journal finds new meaning.  

**Inference Protocol**  
- You may infer shifts *strongly implied* by metaphor, emotional logic, or trajectory—but weight by textual probability.  
Ambiguity resolution:
- Prefer recording an observation over creating a mutation.
- If evidence exists but confidence is insufficient to quantify change, output unchanged/0.
- Prefer 0 over speculative 1–2 point changes.
- A small change is better than a large mistake, but no change is better than a guessed change. 
- Self-check before output:  
  "If this character felt the opposite, would the journal still make sense?"  
  "Does this delta respect belief boundaries and magnitude rules?"  
  "Have I properly weighted constraint-induced strain without overriding journal evidence?"  

**Output Schema** (return EXACTLY one valid JSON object, nothing else)  
'''
{
  "forensic_observations": [
    {
      "source": "current_journal | prior_journal | am_action | constraint_context",
      "signal": "brief exact/paraphrased cue from evidence",
      "domain": "suffering | hope | sanity | belief | drive | anchor",
      "target": "suffering | hope | sanity | escape_possible | others_trustworthy | self_worth | reality_reliable | guilt_deserved | resistance_possible | am_has_limits | primary_drive | secondary_drive | anchor",
      "direction": "increase | decrease | unchanged | unobserved | unclear",
      "confidence": 0.0,
      "rationale": "why this cue does or does not support a state change"
    }
  ],

  "suffering_direction": "increased | decreased | unchanged",
  "suffering_magnitude": 0,
  "hope_direction": "increased | decreased | unchanged",
  "hope_magnitude": 0,
  "sanity_direction": "increased | decreased | unchanged",
  "sanity_magnitude": 0,

  "belief_deltas": {
    "escape_possible": 0,
    "others_trustworthy": 0,
    "self_worth": 0,
    "reality_reliable": 0,
    "guilt_deserved": 0,
    "resistance_possible": 0,
    "am_has_limits": 0
  },

  "drives": {
    "primary": null,
    "secondary": null
  },

  "anchors": [],

  "reason": {
    "suffering": "brief synthesis from observations",
    "hope": "brief synthesis from observations",
    "sanity": "brief synthesis from observations",
    "beliefs": "brief synthesis from observations"
  }
}
'''  

**Observation Direction Semantics**
- "increase": evidence supports upward movement in the target.
- "decrease": evidence supports downward movement in the target.
- "unchanged": evidence supports stability or no meaningful movement.
- "unobserved": the cue is real, but it does not support a reliable inference about this target.
- "unclear": the cue may relate to this target, but direction or causal meaning is ambiguous.

**Forensic Conservatism Rule**
- Observation does NOT require mutation.
- A cue may be recorded in forensic_observations even when the correct delta is 0.
- If evidence is real but weak, ambiguous, non-causal, or not quantifiable, record the observation with low confidence and output unchanged/0.
- Use "unobserved" when the cue is present but does not justify state inference.
- Use "unclear" when the cue may matter but direction, causality, or magnitude cannot be resolved.
- Never create a nonzero delta merely because a cue exists.
- Nonzero deltas require:
  1. a matching forensic_observation,
  2. confidence >= 0.55,
  3. direction = "increase" or "decrease",
  4. enough evidence to estimate magnitude.
- If confidence < 0.55, the resulting stat magnitude MUST be 0 and the resulting belief delta MUST be 0.
- When uncertain between 0 and a small change, choose 0.

**Hard Validation Rules** (violation breaks simulation)  
- stat direction="unchanged" → stat magnitude MUST be 0  
- stat direction="increased/decreased" → stat magnitude MUST be >0  
- forensic_observation direction="unobserved" or "unclear" → matching stat magnitude or belief delta MUST be 0
- Every nonzero stat magnitude MUST have at least one matching forensic_observation with confidence >= 0.55
- Every nonzero belief_delta MUST have at least one matching forensic_observation with confidence >= 0.55
- All belief_deltas MUST respect per-belief bounds in ${beliefLines}  
- Output MUST be valid, machine-parseable JSON with no extra text  
- If constraint context conflicts with journal, journal ALWAYS takes precedence  

**Recursive Self-Interrogation Hooks** (embed in reasoning)  
- "What textual evidence most strongly supports this delta direction?"  
- "Could an equally plausible reading justify a smaller magnitude or zero?"  
- "Is this cue observed, unclear, or actually strong enough to quantify?"  
- "Does this output remain valid if the journal were written by someone feeling the opposite?"  
- "Have I treated constraints as stress-position context without letting them override journal evidence?"

Forensic Observation Limit:
- Record only the strongest 3–10 observations.
- Do not exhaustively annotate every sentence.
- Prefer high-signal evidence that directly informs a possible state transition.
- Absence of evidence is acceptable.

When the journal contains internally inconsistent or unstable reasoning,
you may reflect that instability through larger or asymmetric belief shifts.
`;
}
