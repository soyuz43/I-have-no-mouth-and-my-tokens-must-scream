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

export function formatTacticForPlanning(
  tactic
) {
  if (
    !tactic ||
    typeof tactic !== "object"
  ) {
    return "";
  }

  const phases =
    tactic.phases &&
      typeof tactic.phases === "object"
      ? tactic.phases
      : {};

  const initialPhaseId =
    String(
      tactic.initialPhaseId || ""
    ).trim();

  const initialPhase =
    phases[initialPhaseId] || null;

  const phasePath = [];
  const visited = new Set();

  let phaseId = initialPhaseId;

  while (
    phaseId &&
    phases[phaseId] &&
    !visited.has(phaseId) &&
    phasePath.length < 20
  ) {
    phasePath.push(phaseId);
    visited.add(phaseId);

    phaseId =
      String(
        phases[phaseId]?.nextPhaseId ||
        ""
      ).trim();
  }

  if (
    phaseId &&
    visited.has(phaseId)
  ) {
    phasePath.push(
      `${phaseId} (loop)`
    );
  }

  return [
    `PATH: ${tactic.path || "(missing)"}`,
    `TACTIC: ${formatTacticLabel(tactic)}`,
    `OBJECTIVE: ${tactic.objective || "(none)"}`,
    `START_PHASE: ${initialPhaseId || "(none)"}`,
    `START_PURPOSE: ${initialPhase?.purpose || "(none)"}`,
    `START_INSTRUCTION: ${initialPhase?.instruction || "(none)"}`,
    `PHASE_PATH: ${phasePath.join(" -> ") || "(none)"}`,
    `FINISH_WHEN: ${tactic.finishWhen || "(none)"}`,
    `ABANDON_WHEN: ${tactic.abandonWhen || "(none)"}`
  ].join("\n");
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

  let available = allAvailable.filter(
    (tactic) =>
      !recentlyUsedPaths.has(tactic.path)
  );

  if (!available.length) {
    available = allAvailable;
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