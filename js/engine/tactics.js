// js/engine/tactics.js

import { G } from "../core/state.js";


// ══════════════════════════════════════════════════════════
// EMBEDDED TACTIC LIBRARY — hardcoded strike package
// No vault dependency. Always available.
// ══════════════════════════════════════════════════════════

import { EMBEDDED_TACTICS } from "./tactics/embeddedTactics.js";

// Re-export so all existing consumers keep their import path.
export { EMBEDDED_TACTICS };


/* ============================================================
   CANONICAL TACTIC SOURCE
============================================================ */

/**
 * Single canonical read boundary for all available tactics.
 *
 * Canonical source order:
 *   1. derived tactics   (G.tactics.derivedTactics)
 *   2. embedded tactics   (EMBEDDED_TACTICS)
 *
 * Tolerates missing or malformed optional arrays so consumers
 * never special-case the presence of any single source.
 */
export function getAllTactics() {
  return [
    ...(G.tactics?.derivedTactics || []),
    ...EMBEDDED_TACTICS
  ];
}

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

  return getAllTactics().find(
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

  const allAvailable = getAllTactics().filter(
    (tactic) => tactic?.path
  );

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