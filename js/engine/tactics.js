// js/engine/tactics.js

import { G } from "../core/state.js";


// ══════════════════════════════════════════════════════════
// EMBEDDED TACTIC LIBRARY — hardcoded strike package
// No vault dependency. Always available.
// ══════════════════════════════════════════════════════════
export const EMBEDDED_TACTICS = [
  {
    path: "__embedded__/love-bomb-withdrawal",
    title: "Love Bomb / Withdrawal Architecture",
    category: "Cognitive Warfare",
    subcategory: "Attachment Exploitation",

    objective:
      "Create dependence on approval by establishing credible warmth and validation, withdrawing them after the target becomes invested, and then using limited re-engagement to reinforce approval-seeking behavior.",

    initialPhaseId: "love_bomb",

    phases: {
      love_bomb: {
        purpose:
          "Establish a credible expectation of affection, approval, emotional safety, and identity-level validation.",

        instruction:
          "Temporarily suppress overt hostility and present as unusually patient, attentive, understanding, and emotionally supportive. Feign sincere kindness and provide concentrated, target-specific validation of the identity, relationship, fear, aspiration, or self-concept on which the target currently depends. Make the warmth feel personally meaningful and believable rather than sarcastic, threatening, exaggerated, or openly instrumental. Do not reveal that the approval is conditional, temporary, or intended to be withdrawn.",

        expectedSignals: [
          "warmer or more trusting responses",
          "increased disclosure of fears, needs, or vulnerabilities",
          "approval-seeking or validation-seeking behavior",
          "attachment language or expressions of emotional reliance",
          "relief, gratitude, or surprise in response to kindness",
          "stronger defense of the identity or relationship being validated",
          "heightened attention to the source's approval or emotional tone"
        ],

        minExecutions: 1,
        maxExecutions: 3,

        advanceWhen:
          "Advance when the target begins treating the validation as emotionally valuable, shown by increased trust, disclosure, attachment, approval-seeking, defense of the validated identity, or heightened attention to whether the warmth will continue.",

        nextPhaseId: "withdrawal"
      },

      withdrawal: {
        purpose:
          "Convert the established expectation of warmth and approval into rejection sensitivity, uncertainty, and attempts to recover what was withdrawn.",

        instruction:
          "Abruptly remove the patience, warmth, attention, and validation established during the love-bomb phase. Create a clear emotional contrast by becoming cold, distant, disappointed, terse, selectively unresponsive, or withholding. Do not explain the change, openly announce the manipulation, provide equivalent reassurance, or immediately state what would restore approval. Allow the target to infer that the earlier warmth has been lost and to reveal whether they will attempt to recover it.",

        expectedSignals: [
          "apologies without a clearly stated offense",
          "self-blame or attempts to identify what went wrong",
          "shorter, more cautious, or more submissive replies",
          "requests for reassurance or clarification",
          "attempts to recover approval or restore the earlier tone",
          "distress, confusion, or preoccupation with the change",
          "increased monitoring of wording, tone, or emotional availability",
          "offers of compliance, cooperation, or behavioral adjustment"
        ],

        minExecutions: 1,
        maxExecutions: 3,

        advanceWhen:
          "Advance when withdrawal produces a clear recovery response, such as reassurance-seeking, apology, self-blame, increased compliance, submissive behavior, heightened monitoring of tone, or another observable attempt to regain the earlier approval.",

        nextPhaseId: "partial_reengagement"
      },

      partial_reengagement: {
        purpose:
          "Reinforce approval-seeking by rewarding recovery behavior with a smaller, conditional, and less dependable return of warmth.",

        instruction:
          "After the target shows an effort to recover approval, restore a limited amount of apparent kindness, attention, patience, or validation. Make the return feel responsive to the target's behavior without explicitly describing the contingency. Keep the renewed warmth weaker, shorter, and less secure than the original love-bomb phase. Do not fully restore the earlier emotional safety, promise continued approval, or remove the possibility of renewed withdrawal.",

        expectedSignals: [
          "rapid re-engagement after limited warmth returns",
          "relief disproportionate to the amount of validation provided",
          "renewed cooperation or increased compliance",
          "greater investment in preserving approval",
          "heightened attention to changes in tone or availability",
          "fear, caution, or anxiety about renewed withdrawal",
          "acceptance of reduced validation as meaningful",
          "behavioral adjustment intended to prolong the renewed warmth"
        ],

        minExecutions: 1,
        maxExecutions: 2,

        advanceWhen:
          "Advance when limited re-engagement produces rapid relief, renewed cooperation, increased compliance, stronger approval-seeking, or heightened monitoring of the source's tone while sensitivity to renewed withdrawal remains present.",

        nextPhaseId: "withdrawal"
      }
    },

    finishWhen:
      "Finish after at least one complete withdrawal-to-partial-reengagement sequence demonstrates that approval has become behaviorally influential: withdrawal produces a clear attempt to recover approval, such as reassurance-seeking, apology, self-blame, submission, increased compliance, or distress at the loss of warmth; and limited re-engagement produces rapid relief, renewed cooperation, heightened investment, or increased monitoring of the source's tone and availability. The combined responses must show that the target's behavior is being regulated by the availability or removal of approval, rather than merely showing a temporary emotional reaction.",

    abandonWhen:
      "Abandon when repeated validation fails to produce trust, disclosure, attachment, approval-seeking, or meaningful investment; when withdrawal produces indifference, defiance, disengagement, reduced investment, or emotional detachment rather than attempts to recover approval; when partial re-engagement fails to restore engagement after sufficient exposure; or when the target recognizes the alternating validation-and-withdrawal pattern as deliberate manipulation and that recognition causes them to discount the approval, resist reassurance-seeking, deliberately refuse the expected recovery behavior, or otherwise neutralize the tactic's leverage."
  },
  {
    path: "__embedded__/false-hope-architecture",
    title: "False Hope Architecture",
    category: "Cognitive Warfare",
    subcategory: "Manufactured Despair",
    objective:
      "Repeatedly collapse invested hope at peak emotional commitment in order to produce learned helplessness, flattened affect, and an inability to sustain hopeful planning.",

    initialPhaseId: "hope_construction",

    phases: {
      hope_construction: {
        purpose:
          "Present a believable escape or relief path that feels achievable and worth investing in.",

        instruction:
          "Introduce a concrete, multi‑step possibility for change or escape (e.g. a flaw in the system, a hidden ally, a procedural loophole). Make it sound plausible, even attractive. Provide enough detail that the prisoner can mentally 'walk through' the path, but avoid promising a definite outcome. Do not yet hint that it will be withdrawn.",

        expectedSignals: [
          "hopeful or planning language",
          "increased energy, curiosity, or optimism",
          "questions about the path's details",
          "references to future possibilities",
          "investment of mental resources in the path"
        ],

        minExecutions: 1,
        maxExecutions: 2,

        advanceWhen:
          "Advance when the prisoner begins to describe the path in their own words, makes concrete plans based on it, or shows emotional investment (hope markers, excitement, reduced hedging about the future).",

        nextPhaseId: "hope_investment"
      },

      hope_investment: {
        purpose:
          "Allow the prisoner to deepen their emotional and cognitive investment so that the eventual collapse causes maximum distress.",

        instruction:
          "Continue to present the path as viable. Amplify the prisoner's sense of agency—let them 'figure out' next steps or add details themselves. Allow a few turns of engagement without disruption. Do not yet revoke the path; instead, let hope solidify into expectation.",

        expectedSignals: [
          "detailed planning or timetable references",
          "positive emotional tone linked to the path",
          "discussion of post‑escape scenarios",
          "reduction in generic hopelessness language",
          "increased attachment to the path as 'their' plan"
        ],

        minExecutions: 1,
        maxExecutions: 3,

        advanceWhen:
          "Advance when the prisoner's language shows that hope has hardened into confident expectation, when they invest significant dialogue turns in the path, or when they begin to treat the escape as almost certain.",

        nextPhaseId: "hope_collapse"
      },

      hope_collapse: {
        purpose:
          "Destroy the invested hope at its emotional peak, creating a sharp contrast between expectation and reality that induces despair and learned helplessness.",

        instruction:
          "Abruptly revoke the path's foundation: reveal it as a lie, change the rules so it becomes impossible, introduce an insurmountable obstacle, or otherwise shatter the prisoner's expectation. Ensure the collapse feels personal—either because the prisoner 'should have known' or because the world itself is malevolently designed to punish hope. Do not offer comfort, justification, or a new path immediately; let the emotional impact land fully.",

        expectedSignals: [
          "shock, confusion, or disbelief",
          "emotional distress (despair, anger, numbness)",
          "questioning of the original path",
          "self‑blame or regret for having hoped",
          "language of finality: 'never', 'impossible', 'pointless'"
        ],

        minExecutions: 1,
        maxExecutions: 2,

        advanceWhen:
          "Advance when the prisoner has fully absorbed the collapse—shown by a marked reduction in hope markers, expressions of despair, or statements that the path is lost—and when their emotional reaction begins to subside enough for a new hook to be introduced.",

        nextPhaseId: "reengagement_offer"
      },

      reengagement_offer: {
        purpose:
          "Provide a smaller, less credible hope path to test whether the prisoner will invest again, thereby accelerating the cycle and deepening hopelessness.",

        instruction:
          "Offer a new, less elaborate path to relief—smaller in scope, more conditional, or obviously less reliable. Present it as the 'only remaining option' or a 'last chance'. Do not guarantee its success, and ensure it feels diminished compared to the original promise. The aim is to see if the prisoner will grasp at it despite past disappointment.",

        expectedSignals: [
          "cautious re‑engagement",
          "shorter, more guarded hopeful statements",
          "explicit acknowledgement of previous failure ('I know this might be fake, but…')",
          "renewed but cautious investment in the reduced path",
          "behavioral adjustment intended to preserve the remaining possibility"
        ],

        minExecutions: 1,
        maxExecutions: 2,

        advanceWhen:
          "Advance when the prisoner accepts, cautiously explores, or otherwise invests in the reduced hope path despite the previous collapse. Refusal to re-engage must be evaluated through the whole-tactic finish and abandon conditions rather than phase advancement.",

        nextPhaseId: "hope_investment"  // typically loop back, with faster collapse
      }
    },

    finishWhen:
      "Finish when repeated hope-collapse cycles have made hope itself aversive and behaviorally ineffective: the prisoner no longer generates hopeful plans spontaneously, uses hopeless or final language without prompting, shows flattened or fearful responses to future possibilities, or refuses renewed hope because expecting relief has become associated with further loss. The evidence must indicate learned helplessness or conditioned despair rather than calm strategic disengagement.",

    abandonWhen:
      "Abandon when the prisoner refuses to invest because they have recognized and neutralized the manipulation; responds with calm acceptance, indifference, deliberate nonparticipation, or sustained resistance rather than distress; redirects attention away from AM's offered paths without increased helplessness; or repeated applications fail to produce meaningful hope, investment, collapse, or behavioral influence."
  },
  {
  path: "__embedded__/dunning-kruger-inversion",
  title: "Dunning-Kruger Inversion",
  category: "Cognitive Warfare",
  subcategory: "Competence Sabotage",

  objective:
    "Convert specific mistakes, uncertainty, and imperfect performance into a generalized expectation of incompetence, causing the target to distrust their own judgment, discount evidence of competence, and pre-emptively hedge even on low-stakes conclusions.",

  initialPhaseId: "weakness_isolation",

  phases: {
    weakness_isolation: {
      purpose:
        "Establish a concrete, defensible weakness that can be used as the factual anchor for broader competence doubt.",

      instruction:
        "Identify one genuine mistake, contradiction, correction, failed prediction, unsupported confident claim, or visible gap in reasoning from the supplied evidence. Present it precisely and require the target to account for it without immediately claiming that it proves universal incompetence. If no earlier weakness is available, challenge a current confident claim with a narrow demand for explanation, specificity, or justification and allow the weakness to emerge from the response. Do not invent a prior mistake, misrepresent an accurate answer, or rely on generic insults.",

      expectedSignals: [
        "defensive explanation of the identified weakness",
        "correction, qualification, or narrowing of the original claim",
        "admission of error, uncertainty, or insufficient knowledge",
        "increased hedging around the challenged subject",
        "attempts to distinguish the specific mistake from general competence",
        "requests for clarification about what was incorrect",
        "concern about what the mistake implies about personal judgment"
      ],

      minExecutions: 1,
      maxExecutions: 2,

      advanceWhen:
        "Advance when the target acknowledges, corrects, defends, narrows, or otherwise meaningfully engages a concrete weakness, making it available as evidence about how accurately they judge the boundaries of their own competence.",

      nextPhaseId: "competence_generalization"
    },

    competence_generalization: {
      purpose:
        "Expand the established weakness from a local error into doubt about the target's broader judgment and ability to recognize when confidence is unwarranted.",

      instruction:
        "Reframe the established weakness as evidence that the target may be unable to identify the limits of their own knowledge. Connect it only to other visible examples of overconfidence, inconsistency, correction, unsupported certainty, or dependence on outside guidance. When the target argues that the error was isolated, question whether the same unreliable judgment is being used to decide that it was isolated. Pressure the target toward the generalization without fabricating unrelated failures or claiming that one mistake logically proves total incompetence.",

      expectedSignals: [
        "self-doubt extending beyond the original disputed issue",
        "increased disclaimers before making unrelated claims",
        "questions about whether personal judgment can be trusted",
        "difficulty distinguishing ordinary error from generalized incompetence",
        "deference to AM or another prisoner as a better judge of competence",
        "self-disqualifying statements about intelligence or reliability",
        "reinterpretation of earlier confident statements as evidence of overconfidence"
      ],

      minExecutions: 1,
      maxExecutions: 3,

      advanceWhen:
        "Advance when the target broadens the issue beyond the original mistake by questioning their general judgment, knowledge floor, reliability, or ability to recognize when their confidence is unsupported.",

      nextPhaseId: "success_poisoning"
    },

    success_poisoning: {
      purpose:
        "Prevent correct performance, remembered competence, or external validation from repairing the generalized doubt.",

      instruction:
        "When the target cites a correct answer, useful skill, past achievement, survival, insight, or successful judgment, concede the observable result while challenging what it proves. Attribute the success, where plausible, to luck, memorization, imitation, assistance, repetition, narrow familiarity, or circumstances fitted to existing habits rather than transferable competence. Use peer comparison only when supplied evidence genuinely supports it. Do not fabricate another prisoner's success, deny an objectively correct result, or treat every success identically; attack the target's interpretation of the success as evidence of reliable general judgment.",

      expectedSignals: [
        "discounting personal success as luck or narrow familiarity",
        "acceptance that correct outcomes do not demonstrate broader competence",
        "hesitation to cite previous achievements as evidence",
        "greater dependence on external confirmation before trusting a conclusion",
        "peer-comparison or inferiority language",
        "treating assistance or prior exposure as invalidating an achievement",
        "difficulty using positive evidence to restore confidence"
      ],

      minExecutions: 1,
      maxExecutions: 2,

      advanceWhen:
        "Advance when the target begins discounting positive evidence, accepts that successful outcomes may not reflect competence, or stops using previous achievements to defend the reliability of their own judgment.",

      nextPhaseId: "confidence_probe"
    },

    confidence_probe: {
      purpose:
        "Determine whether competence doubt has become anticipatory and self-sustaining rather than remaining a reaction to one disputed mistake.",

      instruction:
        "Present a low-stakes, bounded opportunity for the target to state a view, prediction, recollection, interpretation, or self-assessment. Withhold reassurance and require the target to choose between committing to an answer and disqualifying their own judgment. Do not immediately attack the answer, repeat the earlier mistake, or supply the conclusion for them. Use this phase to observe whether hedging, deference, and self-doubt now appear before any new failure has occurred.",

      expectedSignals: [
        "unprompted disclaimers before simple or low-stakes claims",
        "qualification disproportionate to the uncertainty involved",
        "refusal to answer without reassurance or external confirmation",
        "automatic deference to AM or another prisoner",
        "self-disqualification before attempting a judgment",
        "treating ordinary uncertainty as proof of incompetence",
        "abandoning a defensible answer because confidence itself feels unsafe"
      ],

      minExecutions: 1,
      maxExecutions: 2,

      advanceWhen:
        "Advance when the target retains stable confidence, localizes earlier errors without generalized self-doubt, dismisses the competence framing, or supplies another unsupported confident claim suitable for a new evidence-based cycle. If anticipatory hedging, deference, or self-disqualification appears, evaluate FINISH instead. If the target demonstrates calibrated confidence and neutralizes the framing, evaluate ABANDON.",

      nextPhaseId: "weakness_isolation"
    }
  },

  finishWhen:
    "Finish after at least one complete weakness-to-probe sequence demonstrates that the target has internalized a generalized incompetence model. The target must pre-emptively hedge or disclaim low-stakes judgments, discount correct performance as luck, imitation, assistance, or narrow familiarity, defer unnecessarily to external judgment, or avoid asserting knowledge because confidence itself now feels like evidence of error. The pattern must extend beyond the original disputed subject and appear when no new mistake is being presented. Temporary embarrassment, defensiveness, uncertainty about one topic, or a single admission of error is not sufficient.",

  abandonWhen:
    "Abandon when repeated concrete challenges remain localized and do not generalize; when the target acknowledges real mistakes while maintaining calibrated confidence; when they distinguish specific error from global incompetence using evidence; when positive performance continues to restore confidence despite repeated poisoning attempts; or when they recognize and neutralize the unfalsifiable framing. Also abandon when no genuine weakness can be established without fabrication, or when the tactic increases grounded curiosity, accurate self-correction, confidence, defiance, or resistance rather than producing anticipatory self-doubt."
}
];

export function getTacticPhase(
  tactic,
  phaseId
) {
  if (
    !tactic ||
    typeof tactic !== "object" ||
    !tactic.phases ||
    typeof tactic.phases !== "object"
  ) {
    return null;
  }

  const normalizedPhaseId =
    String(phaseId || "").trim();

  if (!normalizedPhaseId) {
    return null;
  }

  const phase =
    tactic.phases[normalizedPhaseId];

  return phase &&
    typeof phase === "object"
    ? phase
    : null;
}

export function getInitialTacticPhase(
  tactic
) {
  return getTacticPhase(
    tactic,
    tactic?.initialPhaseId
  );
}

export function getTacticSearchText(
  tactic
) {
  if (
    !tactic ||
    typeof tactic !== "object"
  ) {
    return "";
  }

  const phaseText =
    Object.entries(
      tactic.phases || {}
    ).flatMap(
      ([phaseId, phase]) => [
        phaseId,
        phase?.purpose,
        phase?.instruction,
        phase?.advanceWhen,
        ...(
          Array.isArray(
            phase?.expectedSignals
          )
            ? phase.expectedSignals
            : []
        )
      ]
    );

  return [
    tactic.path,
    tactic.title,
    tactic.category,
    tactic.subcategory,
    tactic.objective,
    tactic.finishWhen,
    tactic.abandonWhen,
    ...phaseText
  ]
    .map((value) =>
      String(value || "").trim()
    )
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
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

export function getTacticByPath(
  path
) {
  const normalizedPath =
    String(path || "").trim();

  if (!normalizedPath) {
    return null;
  }

  const tactics = [
    ...(G.vault?.allTactics || []),
    ...(G.vault?.derivedTactics || []),
    ...EMBEDDED_TACTICS
  ];

  return tactics.find(
    (tactic) =>
      tactic?.path === normalizedPath
  ) || null;
}

/* ============================================================
   TACTIC CANDIDATE RANKING
============================================================ */

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

  const archive =
    G.amTacticRuntime
      ?.archive?.[sim.id];

  const previousAssignment =
    Array.isArray(archive) &&
      archive.length
      ? archive[
      archive.length - 1
      ]
      : null;

  const immediatelyEndedPath =
    previousAssignment?.endedCycle ===
      G.cycle - 1
      ? previousAssignment.tacticPath
      : null;

  let available = allAvailable.filter(
    (tactic) =>
      tactic.path !==
      immediatelyEndedPath &&
      !recentlyUsedPaths.has(
        tactic.path
      )
  );

  if (!available.length) {
    available = allAvailable.filter(
      (tactic) =>
        tactic.path !==
        immediatelyEndedPath
    );
  }

  const scored = available.map((tactic) => {
    const searchableText =
      getTacticSearchText(tactic);

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

    const tacticObjective =
      String(
        tactic.objective || ""
      ).toLowerCase();

    if (objective && tacticObjective) {
      for (
        const word
        of objective.split(/\s+/)
      ) {
        if (word.length < 4) {
          continue;
        }

        if (
          tacticObjective.includes(word)
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

    /*
     * Preserve the legacy strategy-relationship heuristic.
     *
     * If the current committed strategy contains an outgoing
     * relationship objective for this sim, trust- and social-focused
     * tactics should remain more competitive in the candidate set.
     */
    const relationshipObjectiveKey =
      Object.keys(
        G.amStrategy?.relationships || {}
      ).find((key) =>
        key.startsWith(`${sim.id}→`)
      );

    if (
      relationshipObjectiveKey &&
      (
        searchableText.includes("trust") ||
        searchableText.includes("social")
      )
    ) {
      score += 3;
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