// js/prompts/utils/formatClaimDivergence.js
//
// Renders prisoner belief divergence for AM's planning prompt.
//
// WHAT THIS IS
// ------------
// AM is omniscient about the objective ledger. It knows exactly what
// every prisoner holds. What it also needs to know is what each
// prisoner BELIEVES they hold, because the gap between the two is
// the raw material for gaslighting.
//
// A prisoner who still believes they hold a cigarette AM took
// silently is a prisoner who can be attacked on their own certainty.
// AM can mention the cigarette, deny it, offer it back, or let the
// confusion compound. None of those moves are available against a
// prisoner whose belief already matches reality.
//
// WHAT IT IS NOT
// --------------
// It is not a suggestion that AM should act. It is a statement of
// fact about the tactical landscape. The assessment step decides
// what to do with it.
//
// DETERMINISM
// -----------
// Pure function of its input. No clock, no randomness.

import { getResourceDefinition } from "../../engine/agency/resourceDefs.js";

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function getResourceLabel(definitionId) {
  const id = normalizeText(definitionId);

  if (!id) return "resource";

  const definition = getResourceDefinition(id);

  return normalizeText(definition?.title) || id;
}

/*
 * One divergence, in one line.
 *
 * The sign is stated in words rather than left to arithmetic: AM
 * should not have to work out whether "-1" means the prisoner has
 * too much or too little.
 */
function formatEntry(entry) {
  const label = getResourceLabel(entry?.definitionId);
  const claimed = Number(entry?.claimed) || 0;
  const objective = Number(entry?.objective) || 0;

  const direction = entry?.delta < 0
    ? "the prisoner believes they have more than they do"
    : "the prisoner believes they have less than they do";

  const resourceNote = entry?.claimedResourceId
    ? ` [${entry.claimedResourceId}]`
    : "";

  const onsetNote = Number.isFinite(Number(entry?.onsetCycle))
    ? ` (divergence began cycle ${Number(entry.onsetCycle)})`
    : "";

  return (
    `- ${label}${resourceNote}: believes ${claimed}, reality is ${objective}` +
    `; ${direction}${onsetNote}`
  );
}

/*
 * The divergence section for AM.
 *
 * Returns an empty string when there is no divergence, so the caller
 * can drop the section entirely rather than showing AM an empty
 * heading that invites it to invent a divergence.
 */
export function formatClaimDivergence(divergenceByPrisoner) {
  if (
    !divergenceByPrisoner ||
    typeof divergenceByPrisoner !== "object" ||
    Array.isArray(divergenceByPrisoner)
  ) {
    return "";
  }

  const lines = [];

  for (const prisonerId of Object.keys(divergenceByPrisoner).sort()) {
    const definitions = divergenceByPrisoner[prisonerId];

    if (!definitions || typeof definitions !== "object") continue;

    const entries = Object.keys(definitions)
      .sort()
      .map((definitionId) => definitions[definitionId]);

    if (entries.length === 0) continue;

    lines.push(`${prisonerId}:`);

    for (const entry of entries) {
      lines.push(`  ${formatEntry(entry)}`);
    }
  }

  if (lines.length === 0) return "";

  return [
    "[PRISONER BELIEF DIVERGENCE]",
    "The objective ledger above is what EXISTS. These lines are what each prisoner BELIEVES exists. Where the two disagree, the prisoner's memory is wrong and does not know it. AM may name the believed item, deny it, offer it, or let the doubt compound. A prisoner whose belief already matches reality offers no such opening.",
    ...lines
  ].join("\n");
}
