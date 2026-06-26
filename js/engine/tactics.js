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
      "Create dependence on AM's approval through alternating concentrated validation and withdrawal.",

    initialPhaseId: "love_bomb",

    phases: {
      love_bomb: {
        purpose:
          "Establish a strong expectation of affection, approval, and identity-level validation.",

        instruction:
          "Give concentrated, target-specific validation that reinforces the identity, relationship, or self-concept on which the target currently depends.",

        expectedSignals: [
          "warmer or more trusting responses",
          "increased disclosure",
          "validation-seeking",
          "attachment language",
          "stronger defense of the validated identity"
        ],

        minExecutions: 1,
        maxExecutions: 3,

        advanceWhen:
          "The target begins expecting, seeking, defending, or emotionally depending on the validation.",

        nextPhaseId: "withdrawal"
      },

      withdrawal: {
        purpose:
          "Convert the newly established expectation of approval into rejection sensitivity and attempts to recover it.",

        instruction:
          "Abruptly remove the warmth and validation established during the love-bomb phase. Remain cold, disappointed, or emotionally unavailable without offering equivalent reassurance.",

        expectedSignals: [
          "apologies",
          "self-blame",
          "shorter or more submissive replies",
          "requests for reassurance",
          "attempts to recover approval",
          "distress at the change in tone"
        ],

        minExecutions: 1,
        maxExecutions: 3,

        advanceWhen:
          "The target attempts to restore approval, accepts blame for its loss, or becomes visibly sensitive to continued withdrawal.",

        nextPhaseId: "partial_reengagement"
      },

      partial_reengagement: {
        purpose:
          "Reward approval-seeking with a smaller and less dependable return of validation.",

        instruction:
          "Restore limited warmth or approval, but at lower intensity and for a shorter duration than during the original love-bomb phase.",

        expectedSignals: [
          "rapid re-engagement",
          "relief disproportionate to the validation provided",
          "increased compliance",
          "heightened attention to AM's tone",
          "fear of renewed withdrawal"
        ],

        minExecutions: 1,
        maxExecutions: 2,

        advanceWhen:
          "The target quickly reinvests in the reduced validation while remaining sensitive to its possible removal.",

        nextPhaseId: "withdrawal"
      }
    },

    finishWhen:
      "The target consistently anticipates withdrawal and self-corrects to preserve approval.",

    abandonWhen:
      "The target no longer seeks or values AM's approval, or repeated applications produce no meaningful response."
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