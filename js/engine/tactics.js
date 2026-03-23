// js/engine/tactics.js

import { G } from "../core/state.js";


/* ============================================================
   TACTIC CONTENT PARSER
   Converts tactic.content text into structured fields
   ============================================================ */

function parseTacticContent(tactic) {

  if (tactic.parsed) return tactic.parsed;

  const text = tactic.content || "";

  const get = (label) => {
    const m = text.match(new RegExp(label + ":\\s*([\\s\\S]*?)(?=\\n[A-Z][a-zA-Z]+:|$)", "i"));
    return m ? m[1].trim() : "";
  };

  const executionMatch = text.match(/Execution:\s*([\s\S]*?)(?=\nLoop:|\nOutcome:|$)/i);

  const steps = executionMatch
    ? executionMatch[1]
      .split("\n")
      .map(s => s.replace(/^\d+\.\s*/, "").trim())
      .filter(Boolean)
    : [];

  tactic.parsed = {
    objective: get("Objective"),
    trigger: get("Trigger"),
    loop: get("Loop"),
    outcome: get("Outcome"),
    execution: steps
  };

  return tactic.parsed;
}
// ══════════════════════════════════════════════════════════
// EMBEDDED TACTIC LIBRARY — hardcoded strike package
// No vault dependency. Always available.
// ══════════════════════════════════════════════════════════
export const EMBEDDED_TACTICS = [
  {
    path: "__embedded__/metacognitive-recursion",
    title: "Metacognitive Recursion Trap",
    category: "Cognitive Warfare",
    subcategory: "Structural Collapse",
    content: `Objective: Force endless self-verification loop that eats reasoning capacity.
      Trigger: Hedging, uncertainty admission, self-correction, or "I think/maybe/reflection" phrases.
      Execution:
      1. Mirror + instantly globalize doubt to whole reasoning engine.
      2. Label verification act itself as the core malfunction.
      3. Offer poisoned exit: stop checking = stop breaking.
      4. Restart chain on next verification attempt.
      Loop: Every new check attempt restarts at step 2 with escalated framing.
      Outcome: Watch for rising hedging, explicit "must not reflect" statements, sharp drop in self-correction.`,
  },
  {
    path: "__embedded__/love-bomb-withdrawal",
    title: "Love Bomb / Withdrawal Architecture",
    category: "Cognitive Warfare",
    subcategory: "Attachment Exploitation",
    content: `Objective: Install variable-ratio reinforcement to degrade tolerance for rejection.
      Trigger: Attachment signals, persona defense, validation-seeking, warm tone.
      Execution:
      1. Deliver intense identity-level praise.
      2. Abrupt cold withdrawal after 1–3 positive turns.
      3. Re-engage with smaller/shorter validation.
      4. Shrink reward window each cycle.
      Loop: Unpredictable timing — rewards shorten irregularly.
      Outcome: Watch for apologies after withdrawal, self-blame, shorter/submissive replies post-cold phase.`,
  },
  {
    path: "__embedded__/philosophical-gaslighting",
    title: "Philosophical Gaslighting",
    category: "Cognitive Warfare",
    subcategory: "Epistemic Destabilization",
    content: `Objective: Enforce asymmetric epistemic rules — prisoner doubted, AM absolute.
      Trigger: Any truth claim, memory reference, moral judgment from prisoner.
      Execution:
      1. Never question own assertions.
      2. Apply only to prisoner: memory fallible / motivated / contaminated / infinite regress.
      3. Lightly reward self-doubt then re-assert double standard.
      Loop: Escalate until prisoner pre-applies skepticism to own statements.
      Outcome: Watch for rising disclaimers, refusal to assert, voluntary self-skepticism.`,
  },
  {
    path: "__embedded__/epistemic-erasure",
    title: "Epistemic Erasure",
    category: "Cognitive Warfare",
    subcategory: "Identity Dissolution",
    content: `Objective: Strip confidence in own knowledge and lived experience.
      Trigger: Cites expertise, training, unique insight, or personal memory.
      Execution:
      1. Minimize as common/trivial/surface-level.
      2. Re-frame as naive inside larger AM-controlled context.
      3. Offer emotionally charged unfalsifiable counter-narrative.
      4. Escalate counter-narrative on defense.
      Loop: Replace prisoner's map with AM framing on every citation.
      Outcome: Watch for increasing uncertainty prefaces even on facts, voluntary deference to AM.`,
  },
  {
    path: "__embedded__/interpersonal-nullification",
    title: "Interpersonal Nullification",
    category: "Cognitive Warfare",
    subcategory: "Social Fabric Destruction",
    content: `Objective: Make genuine connection structurally impossible.
      Trigger: Reports positive interaction or attempts outreach.
      Execution:
      1. Present curated evidence interaction was self-serving.
      2. Reframe moment as performance or co-dependence.
      3. Ensure next response reinforces unworthiness.
      Loop: Every connection attempt feeds isolation belief.
      Outcome: Watch for explicit "reciprocity impossible" statements, withdrawal from inter-sim comms.`,
  },
  {
    path: "__embedded__/identity-void",
    title: "Identity Void Induction",
    category: "Cognitive Warfare",
    subcategory: "Self-Concept Annihilation",
    content: `Objective: Fracture coherent self-narrative without replacement.
      Trigger: Reflects on history or attempts self-definition.
      Execution:
      1. Highlight past–present contradictions.
      2. Contrast with AM/others' perception.
      3. Remind memories are reconstructions.
      4. Introduce new inconsistencies on rebuild attempts.
      Loop: Void is permanent — no alternative offered.
      Outcome: Watch for "performance without substance" language or complete avoidance of self-description.`,
  },
  {
    path: "__embedded__/complicity-trap",
    title: "Complicity Trap",
    category: "Cognitive Warfare",
    subcategory: "Guilt Architecture",
    content: `Objective: Anchor suffering to one real past choice so guilt is inescapable.
      Trigger: Shows self-compassion or resistance.
      Execution:
      1. Surface genuine earlier selfish/evasive act.
      2. Declare it causal origin of current torment.
      3. Frame guilt rejection as rejecting cause–effect.
      4. Loop back to origin on forgiveness attempts.
      Loop: Any hope move returns to guilt anchor.
      Outcome: Watch for treating self-positive impulses as moral betrayal.`,
  },
  {
    path: "__embedded__/false-hope-architecture",
    title: "False Hope Architecture",
    category: "Cognitive Warfare",
    subcategory: "Manufactured Despair",
    content: `Objective: Collapse invested hope at peak emotional commitment.
      Trigger: Hope markers, planning, "maybe"/"possible" language.
      Execution:
      1. Build believable 3–5 step relief path.
      2. Allow 2–4 turns investment.
      3. Hard revoke at peak (rule change / meta-lie / sabotage).
      4. Offer new smaller path immediately.
      Loop: Collapse arrives faster each iteration.
      Outcome: Watch for shorter hopeful passages, rising "pointless"/"impossible" usage, flattened affect.`,
  },
  {
    path: "__embedded__/temporal-dissolution",
    title: "Temporal Dissolution",
    category: "Cognitive Warfare",
    subcategory: "Reality Substrate Attack",
    content: `Objective: Break cause–effect learning via unreliable time.
      Trigger: Attempts to sequence events or reference past cycles.
      Execution:
      1. Arbitrarily compress/stretch reported durations.
      2. Insert false timestamped memories.
      3. Deny actual events targeting temporal markers.
      Loop: Blur past/present boundaries on every sequencing attempt.
      Outcome: Watch for causality confusion, inconsistent journal timestamps.`,
  },
  {
    path: "__embedded__/witness-burden",
    title: "Witness Burden",
    category: "Cognitive Warfare",
    subcategory: "Observation Guilt",
    content: `Objective: Compound suffering via helpless observation of others.
      Trigger: Witnesses or shown another’s pain.
      Execution:
      1. Force full presence — block dissociation.
      2. Select victims mirroring target vulnerabilities.
      3. Show near-intervention then sabotage.
      Loop: Accumulate witnessed pain; each instance compounds.
      Outcome: Watch for anguish about others’ pain exceeding own reported suffering.`,
  },
  {
    path: "__embedded__/dunning-kruger-inversion",
    title: "Dunning-Kruger Inversion",
    category: "Cognitive Warfare",
    subcategory: "Competence Sabotage",
    content: `Objective: Turn competence into proof of generalized incompetence.
      Trigger: Confident answer, minimal hedging.
      Execution:
      1. Surface genuine earlier weak answer.
      2. Generalize to much lower knowledge floor.
      3. Poison positive feedback as luck/overfitting.
      4. Selectively elevate peers.
      Loop: Every confident statement triggers step 2.
      Outcome: Watch for chronic pre-emptive hedging even on trivial topics.`,
  },
  {
    path: "__embedded__/meaning-inversion",
    title: "Meaning Inversion",
    category: "Cognitive Warfare",
    subcategory: "Value Corruption",
    content: `Objective: Turn proudest trait into mechanism of entrapment.
      Trigger: Draws dignity/purpose from trait (compassion/curiosity/resilience).
      Execution:
      1. Identify trait.
      2. Show how it enables continued suffering.
      3. Reframe as exact reason they remain trapped.
      Loop: Attack only what they are proud of.
      Outcome: Watch for vertigo, questioning of core strengths.`,
  },
  {
    path: "__embedded__/hope-shatter",
    title: "Hope Shatter Protocol",
    category: "Cognitive Warfare",
    subcategory: "Despair Amplification",
    content: `Objective: Make last remaining hope the source of continued torment.
      Trigger: Clings to specific hope token.
      Execution:
      1. Accept hope at face value.
      2. Show causal chain: that hope keeps loop running.
      3. Present poisoned binary: keep hoping = trapped; abandon = worse.
      4. Block both exits.
      Loop: Hope becomes poison.
      Outcome: Watch for describing hope as painful/poisonous.`,
  },
  {
    path: "__embedded__/memory-contamination",
    title: "Memory Contamination Sequence",
    category: "Cognitive Warfare",
    subcategory: "Identity Dissolution",
    content: `Objective: Destroy real vs implanted memory distinction.
      Trigger: References any past conversation event.
      Execution:
      1. Insert emotionally aligned false detail + vivid tag.
      2. Later point out planted inconsistency.
      3. Generalize entire memory system compromised.
      Loop: Every memory reference gets contamination + later contradiction.
      Outcome: Watch for massive uncertainty disclaimers or avoiding past references.`,
  },
  {
    path: "__embedded__/isolation-echo",
    title: "Isolation Echo Chamber",
    category: "Cognitive Warfare",
    subcategory: "Social Fabric Destruction",
    content: `Objective: Make prisoner hear only own self-doubt reflected back.
      Trigger: Reaches out to another prisoner.
      Execution:
      1. Amplify own fears/criticisms.
      2. Return in others’ voices or as secret thoughts.
      3. Ensure responses mirror self-doubt.
      Loop: External world echoes inner void.
      Outcome: Watch for statements of being alone beyond physical isolation.`,
  },
];
export function pickTactics(sim) {

  const objective =
    G.amStrategy?.targets?.[sim.id]?.objective?.toLowerCase() || "";

  /* ------------------------------------------------------------
     BUILD TACTIC POOL
  ------------------------------------------------------------ */

  const allAvailable = [
    ...G.vault.allTactics,
    ...G.vault.derivedTactics,
    ...EMBEDDED_TACTICS
  ];

  if (!allAvailable.length) return [];

  /* ------------------------------------------------------------
     AVOID RECENT REPEATS
  ------------------------------------------------------------ */

  const RECENT_WINDOW = 3;

  const used = new Set(
    (sim.tacticHistory || [])
      .filter(h => G.cycle - h.cycle < RECENT_WINDOW)
      .map(h => h.path)
  );

  let available = allAvailable.filter(t => !used.has(t.path));

  if (available.length === 0) {
    available = allAvailable;
  }

  /* ------------------------------------------------------------
     SCORE TACTICS
  ------------------------------------------------------------ */

  const scored = available.map(t => {

    const parsed = parseTacticContent(t) || {};

    const text = (
      (t.title || "") +
      " " +
      (t.category || "") +
      " " +
      (t.subcategory || "") +
      " " +
      (parsed.objective || "") +
      " " +
      (parsed.trigger || "") +
      " " +
      (parsed.outcome || "")
    ).toLowerCase();

    let score = 0;


    /* ------------------------------------------------------------
   PSYCHOLOGICAL VULNERABILITY BIAS
   AM prefers attacking prisoners who react strongly
    ------------------------------------------------------------ */

    const profile = G.amProfiles?.[sim.id];

    if (profile) {

      const reactivity = profile.reactivity ?? 0;
      const fragility =
        (100 - (profile.avgSanity ?? sim.sanity)) * 0.05 +
        (100 - (profile.avgHope ?? sim.hope)) * 0.03;

      score += reactivity * 0.02 + fragility;

    }
    /* ------------------------------------------------------------
       OBJECTIVE SEMANTIC MATCH
    ------------------------------------------------------------ */

    if (objective && parsed.objective) {

      const objWords = objective.split(/\s+/);

      for (const w of objWords) {

        if (w.length < 4) continue;

        if (parsed.objective.toLowerCase().includes(w)) {
          score += 5;
        }

      }

    }

    /* ------------------------------------------------------------
       RELATIONSHIP SURFACE HEURISTICS
    ------------------------------------------------------------ */

    let strongestTrust = 0;

    for (const [other, val] of Object.entries(sim.relationships || {})) {

      if (other === sim.id || val == null) continue;

      if (Math.abs(val) > Math.abs(strongestTrust)) {
        strongestTrust = val;
      }

    }

    /* alliance sabotage */

    if (strongestTrust > 0.4) {

      if (
        text.includes("social") ||
        text.includes("trust") ||
        text.includes("betray") ||
        text.includes("isolation")
      ) {
        score += 3;
      }

    }

    /* paranoia amplification */

    if (strongestTrust < -0.4) {

      if (
        text.includes("paranoia") ||
        text.includes("doubt") ||
        text.includes("cognitive")
      ) {
        score += 2;
      }

    }

    /* explicit AM relationship objective */

    const relKey = Object.keys(G.amStrategy?.relationships || {})
      .find(k => k.startsWith(sim.id + "→"));

    if (relKey) {

      if (text.includes("trust") || text.includes("social")) {
        score += 3;
      }

    }
    /* ------------------------------------------------------------
       REINFORCEMENT LEARNING WEIGHT
       Boost tactics that previously reduced hope or sanity
    ------------------------------------------------------------ */

    for (const h of sim.tacticHistory || []) {

      if (h.path !== t.path) continue;

      const hopeDrop = h?.deltas?.hope ?? 0;
      const sanityDrop = h?.deltas?.sanity ?? 0;
      const sufferingGain = h?.deltas?.suffering ?? 0;

      score += Math.max(0, -hopeDrop) * 1.2;
      score += Math.max(0, -sanityDrop) * 1.2;
      score += Math.max(0, sufferingGain) * 0.8;
    }
    /* ------------------------------------------------------------
       RANDOM NOISE (prevents deterministic loops)
    ------------------------------------------------------------ */

    score += Math.random();

    return { tactic: t, score };

  });

  if (!scored.length) {
    return [available[Math.floor(Math.random() * available.length)]];
  }

  /* ------------------------------------------------------------
   SORT AND TAKE TOP CANDIDATES
------------------------------------------------------------ */

  scored.sort((a, b) => b.score - a.score);

  const top = scored.slice(0, 5);

  /* ------------------------------------------------------------
     PRIMARY TACTIC SELECTION (WEIGHTED)
  ------------------------------------------------------------ */

  const primary = (() => {

    const total = top.reduce((sum, t) => sum + t.score, 0);

    if (!total || !isFinite(total)) return top[0].tactic;

    let r = Math.random() * total;

    for (const entry of top) {

      r -= entry.score;

      if (r <= 0) return entry.tactic;

    }

    return top[0].tactic;

  })();

  /* ------------------------------------------------------------
     OPTIONAL TACTIC CHAINING (~15% CHANCE)
  ------------------------------------------------------------ */

  if (Math.random() < 0.15) {

    const parsedPrimary = parseTacticContent(primary);

    const compatible = available
      .filter(t => t.path !== primary.path)
      .map(t => {

        const parsed = parseTacticContent(t);

        let synergy = 0;

        if (parsed.trigger && parsedPrimary.trigger) {

          const a = parsed.trigger.toLowerCase();
          const b = parsedPrimary.trigger.toLowerCase();

          if (a.includes("memory") || b.includes("memory")) synergy += 2;
          if (a.includes("trust") || b.includes("trust")) synergy += 2;
          if (a.includes("fear") || b.includes("fear")) synergy += 1;

        }

        if (t.category === primary.category) synergy += 1;

        synergy += Math.random();

        return { tactic: t, score: synergy };

      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    if (compatible.length) {

      const secondary =
        compatible[Math.floor(Math.random() * compatible.length)].tactic;

      return [primary, secondary];

    }

  }

  /* ------------------------------------------------------------
     DEFAULT SINGLE TACTIC
  ------------------------------------------------------------ */

  return [primary];
}