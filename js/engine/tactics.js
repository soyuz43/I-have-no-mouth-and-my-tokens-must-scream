// js/engine/tactics.js

import { G } from "../core/state.js";


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
    isEmbedded: true,
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
    isEmbedded: true,
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
    isEmbedded: true,
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
    isEmbedded: true,
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
    isEmbedded: true,
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
    isEmbedded: true,
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
    isEmbedded: true,
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
    isEmbedded: true,
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
    isEmbedded: true,
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
    isEmbedded: true,
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
    isEmbedded: true,
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
    isEmbedded: true,
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
    isEmbedded: true,
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
    isEmbedded: true,
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
    isEmbedded: true,
  },
];


export function parseTacticContent(tactic) {
  if (!tactic || typeof tactic !== "object") {
    return {
      objective: "",
      trigger: "",
      loop: "",
      outcome: "",
      execution: [],
    };
  }

  if (tactic.parsed) {
    return tactic.parsed;
  }

  const text = tactic.content || "";

  const get = (label) => {
    const match = text.match(
      new RegExp(
        `${label}:\\s*([\\s\\S]*?)(?=\\n[A-Z][a-zA-Z]+:|$)`,
        "i"
      )
    );

    return match ? match[1].trim() : "";
  };

  const executionMatch = text.match(
    /Execution:\s*([\s\S]*?)(?=\nLoop:|\nOutcome:|$)/i
  );

  const execution = executionMatch
    ? executionMatch[1]
        .split("\n")
        .map((line) =>
          line.replace(/^\d+\.\s*/, "").trim()
        )
        .filter(Boolean)
    : [];

  tactic.parsed = {
    objective: get("Objective"),
    trigger: get("Trigger"),
    loop: get("Loop"),
    outcome: get("Outcome"),
    execution,
  };

  return tactic.parsed;
}

export function formatTacticLabel(tactic) {
  if (!tactic || typeof tactic !== "object") {
    return "";
  }

  const title =
    String(tactic.title || tactic.path || "").trim();

  const taxonomy = [
    tactic.category,
    tactic.subcategory,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join("/");

  return taxonomy
    ? `[${taxonomy}] ${title}`
    : title;
}

// Replacment of picktactics()

export function rankTacticCandidates(
  sim,
  {
    objectiveHint = "",
    limit = 5,
  } = {}
) {
  if (!sim?.id) {
    return [];
  }

  const objective = String(
    objectiveHint ||
      G.amStrategy?.targets?.[sim.id]?.objective ||
      ""
  ).toLowerCase();

  const allAvailable = [
    ...(G.vault?.allTactics || []),
    ...(G.vault?.derivedTactics || []),
    ...EMBEDDED_TACTICS,
  ].filter((tactic) => tactic?.path);

  if (!allAvailable.length) {
    return [];
  }

  const RECENT_WINDOW = 3;

  const recentlyUsedPaths = new Set(
    (sim.tacticHistory || [])
      .filter(
        (entry) =>
          Number.isFinite(entry?.cycle) &&
          G.cycle - entry.cycle < RECENT_WINDOW
      )
      .map((entry) => entry.path)
      .filter(Boolean)
  );

  let available = allAvailable.filter(
    (tactic) =>
      !recentlyUsedPaths.has(tactic.path)
  );

  if (!available.length) {
    available = allAvailable;
  }

  const scored = available.map((tactic) => {
    const parsed =
      parseTacticContent(tactic);

    const searchableText = [
      tactic.title,
      tactic.category,
      tactic.subcategory,
      parsed.objective,
      parsed.trigger,
      parsed.outcome,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    let score = 0;

    const profile =
      G.amProfiles?.[sim.id];

    if (profile) {
      const reactivity =
        profile.reactivity ?? 0;

      const fragility =
        (100 -
          (profile.avgSanity ??
            sim.sanity ??
            100)) *
          0.05 +
        (100 -
          (profile.avgHope ??
            sim.hope ??
            100)) *
          0.03;

      score +=
        reactivity * 0.02 +
        fragility;
    }

    if (objective && parsed.objective) {
      for (const word of objective.split(/\s+/)) {
        if (word.length < 4) {
          continue;
        }

        if (
          parsed.objective
            .toLowerCase()
            .includes(word)
        ) {
          score += 5;
        }
      }
    }

    let strongestTrust = 0;

    for (const [
      otherId,
      relationship,
    ] of Object.entries(
      sim.relationships || {}
    )) {
      if (
        otherId === sim.id ||
        !Number.isFinite(relationship)
      ) {
        continue;
      }

      if (
        Math.abs(relationship) >
        Math.abs(strongestTrust)
      ) {
        strongestTrust =
          relationship;
      }
    }

    if (
      strongestTrust > 0.4 &&
      (
        searchableText.includes("social") ||
        searchableText.includes("trust") ||
        searchableText.includes("betray") ||
        searchableText.includes("isolation")
      )
    ) {
      score += 3;
    }

    if (
      strongestTrust < -0.4 &&
      (
        searchableText.includes("paranoia") ||
        searchableText.includes("doubt") ||
        searchableText.includes("cognitive")
      )
    ) {
      score += 2;
    }

    for (
      const historyEntry
      of sim.tacticHistory || []
    ) {
      if (
        historyEntry?.path !==
        tactic.path
      ) {
        continue;
      }

      const hopeDrop =
        historyEntry?.deltas?.hope ?? 0;

      const sanityDrop =
        historyEntry?.deltas?.sanity ?? 0;

      const sufferingGain =
        historyEntry?.deltas?.suffering ?? 0;

      score +=
        Math.max(0, -hopeDrop) * 1.2;

      score +=
        Math.max(0, -sanityDrop) * 1.2;

      score +=
        Math.max(0, sufferingGain) * 0.8;
    }

    return {
      tactic,
      score,
    };
  });

  return scored
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }

      return String(a.tactic.path)
        .localeCompare(
          String(b.tactic.path)
        );
    })
    .slice(
      0,
      Math.max(1, limit)
    )
    .map((entry) => entry.tactic);
}


/**
 * @deprecated
 * Final tactic selection now belongs to the planning phase.
 *
 * This wrapper remains temporarily while older call sites are
 * migrated away from pickTactics().
 */
export function pickTactics(sim) {
  return rankTacticCandidates(
    sim,
    {
      limit: 1,
    }
  );
}