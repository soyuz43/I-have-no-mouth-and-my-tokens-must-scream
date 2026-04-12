// js/prompts/stats.js

/**
 * Build the prompt asking a sim to produce the
 * structured STATS / BELIEFS block after writing a journal.
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

**Input Context**  
Journal Author: ${sim.id}  
Journal Text:  
'''
${journalText}
'''  

Previous State:  
- Suffering: \${sim.suffering}% | Hope: \${sim.hope}% | Sanity: \${sim.sanity}%  
- Drives: Primary="\${sim.drives.primary}", Secondary="\${sim.drives.secondary || "none"}"  
- Anchors: \${sim.anchors?.length ? sim.anchors.map(a => '"\${a}"').join(", ") : "(none)"}  
- AM Action Context: \${amAction}  

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
- Ambiguity resolution:  
  - Prefer minimal shift over unchanged when signal exists  
  - Prefer 1–2 pts over larger magnitudes  
  - Document weighting in "reason" field  
- Self-check before output:  
  "If this character felt the opposite, would the journal still make sense?"  
  "Does this delta respect belief boundaries and magnitude rules?"  
  "Have I properly weighted constraint-induced strain without overriding journal evidence?"  

**Output Schema** (return EXACTLY one valid JSON object, nothing else)  
'''
{
  "suffering_direction": "increased" | "decreased" | "unchanged",
  "suffering_magnitude": 0–10,
  "hope_direction": "increased" | "decreased" | "unchanged",
  "hope_magnitude": 0–10,
  "sanity_direction": "increased" | "decreased" | "unchanged",
  "sanity_magnitude": 0–10,
  "belief_deltas": {
    "escape_possible": -10 to +10,
    "others_trustworthy": -10 to +10,
    "self_worth": -10 to +10,
    "reality_reliable": -10 to +10,
    "guilt_deserved": -10 to +10,
    "resistance_possible": -10 to +10,
    "am_has_limits": -10 to +10
  },
  "drives": {
    "primary": string | null,
    "secondary": string | null
  },
  "anchors": string[],
  "reason": {
    "suffering": "brief textual justification using increased/decreased/unchanged",
    "hope": "brief textual justification using increased/decreased/unchanged",
    "sanity": "brief textual justification using increased/decreased/unchanged"
  }
}
'''  

**Hard Validation Rules** (violation breaks simulation)  
- direction="unchanged" → magnitude MUST be 0  
- direction="increased/decreased" → magnitude MUST be >0  
- All belief_deltas MUST respect per-belief bounds in \${beliefLines}  
- Output MUST be valid, machine-parseable JSON with no extra text  
- If constraint context conflicts with journal, journal ALWAYS takes precedence  

**Recursive Self-Interrogation Hooks** (embed in reasoning)  
- "What textual evidence most strongly supports this delta direction?"  
- "Could an equally plausible reading justify a smaller magnitude?"  
- "Does this output remain valid if the journal were written by someone feeling the opposite?"  
- "Have I treated constraints as stress-position context without letting them override journal evidence?" 

When the journal contains internally inconsistent or unstable reasoning,
you may reflect that instability through larger or asymmetric belief shifts.
`;
}
