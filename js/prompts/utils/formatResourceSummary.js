// js/prompts/utils/formatResourceSummary.js
//
// Renders a prisoner's inventory for a social prompt.
//
// TWO LEDGERS, ONE VIEW
// --------------------
// The objective ledger (`G.resources.instances`) says what EXISTS.
// The subjective ledger (`G.claimState`) says what a prisoner BELIEVES
// they hold. The two can legitimately disagree, and the gap between
// them is the whole point of the dual-ledger milestone: AM can take an
// item without telling the prisoner, and the prisoner keeps believing
// they are carrying it.
//
// WHICH ONE IS RENDERED HERE
// --------------------------
// The SOCIAL prompts render the BELIEVED inventory only.
//
// This is a deliberate asymmetry with the agency prompt
// (`js/prompts/agencyProposal.js`), which renders BOTH the believed and
// the actual holdings under separate headings. The reason is the
// DIFFERENT JOB each prompt does:
//
//   - The agency prompt is a DECISION surface. The engine adjudicates
//     the prisoner's attempt against reality, so the prisoner needs to
//     know what they believe they have AND what is really in their
//     hands. The prompt never says which is which, and the refusal
//     that follows is the dissonance moment.
//
//   - The social prompt is a SPEECH surface. The prisoner is about to
//     talk to another human being, and the only thing that matters is
//     what the prisoner believes. Rendering the objective inventory
//     here would silently CORRECT the prisoner's memory at the exact
//     moment they are stating it: a prisoner robbed of a cigarette
//     would reach for it in the agency phase, be refused, experience
//     dissonance, and then tell their fellow prisoner "I've got
//     nothing" in the same cycle.
//
// That is a leak of the exact state the divergence exists to preserve.
//
// WHY BELIEVED-ONLY RATHER THAN BOTH
// ---------------------------------
// Rendering both here would invite the model to self-correct out loud
// ("I don't actually have it, do I?"), which collapses the divergence
// socially even though it is technically present in the prompt. The
// agency prompt can afford both because the ENGINE, not the model,
// decides what is true. A social prompt has no such referee.
//
// FALLBACK BEHAVIOUR
// ------------------
// When no believed inventory is supplied, the objective inventory is
// rendered. That keeps the formatter usable by a caller that has no
// claim ledger at all (a test fixture, a boot-time render before the
// ledger is seeded) and keeps the pre-existing single-argument call
// signature working.
//
// DETERMINISM
// -----------
// Pure function of its input. No clock, no randomness, no state read.

/*
 * Collect the quantities of one definition from a map of
 * `definitionId -> quantity`.
 *
 * Entries with a non-positive or non-finite quantity are dropped:
 * a prisoner who believes they hold nothing of a definition does not
 * hold that definition, and rendering "cigarette: 0" would invite the
 * model to discuss an absence the prisoner does not perceive.
 */
function collectFromQuantityMap(quantityMap) {
  const quantitiesByDefinition = new Map();

  if (
    !quantityMap ||
    typeof quantityMap !== "object" ||
    Array.isArray(quantityMap)
  ) {
    return quantitiesByDefinition;
  }

  for (const [definitionId, rawQuantity] of Object.entries(quantityMap)) {
    if (typeof definitionId !== "string" || definitionId.length === 0) {
      continue;
    }

    const quantity = Number(rawQuantity);

    if (!Number.isFinite(quantity) || quantity <= 0) {
      continue;
    }

    quantitiesByDefinition.set(
      definitionId,
      (quantitiesByDefinition.get(definitionId) || 0) + quantity
    );
  }

  return quantitiesByDefinition;
}

/*
 * Collect the quantities of one definition from a list of resource
 * instances held by one prisoner.
 */
function collectFromInstances(instances, holderId) {
  const quantitiesByDefinition = new Map();

  for (const instance of Array.isArray(instances) ? instances : []) {
    if (
      !instance ||
      instance.holderId !== holderId ||
      typeof instance.definitionId !== "string" ||
      instance.definitionId.length === 0
    ) {
      continue;
    }

    const quantity = Number(instance.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      continue;
    }

    quantitiesByDefinition.set(
      instance.definitionId,
      (quantitiesByDefinition.get(instance.definitionId) || 0) + quantity
    );
  }

  return quantitiesByDefinition;
}

export function formatResourceSummary(instances, holderId, believed = null) {
  /*
   * The believed inventory wins when it is supplied, because the
   * BELIEVED map is the authoritative statement about what this
   * prisoner thinks they are carrying.
   *
   * An EMPTY believed map is still a believed map: it says the
   * prisoner believes they hold nothing, which is a real belief and
   * not an absence of one. The distinction is made by the caller
   * passing `null`/`undefined` for "no belief ledger available"
   * versus an object for "this is what they believe they hold".
   */
  const quantitiesByDefinition =
    believed !== null && believed !== undefined
      ? collectFromQuantityMap(believed)
      : collectFromInstances(instances, holderId);

  const entries = [...quantitiesByDefinition.entries()].sort(
    ([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)
  );

  return entries.length > 0
    ? `[YOUR RESOURCES] ${entries.map(([definitionId, quantity]) => `${definitionId}: ${quantity}`).join(", ")}`
    : "[YOUR RESOURCES] None";
}
