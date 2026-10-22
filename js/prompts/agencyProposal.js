import { TIER1_GOALS } from "../engine/scratchpad/goals/registry.js";

/*
 * Group a resource list by definition and total the quantities.
 *
 * The objective view holds STACKS; the belief view holds a quantity
 * per definition. Both are rendered as the same `definition: n`
 * shape so the two inventories in the prompt can be compared line for
 * line by the prisoner, which is the entire point of showing both.
 */
function groupQuantitiesByDefinition(resources) {
  const totals = {};

  for (const resource of Array.isArray(resources) ? resources : []) {
    const definitionId = resource?.definitionId;

    if (!definitionId) continue;

    const quantity = Number(resource?.quantity);

    if (!Number.isFinite(quantity)) continue;

    totals[definitionId] = (totals[definitionId] ?? 0) + quantity;
  }

  return totals;
}

/*
 * Render a holdings map as `definition: quantity` lines, sorted by
 * definition id so the output is stable between cycles.
 */
function formatHoldings(entries) {
  const lines = [];

  const sorted = [...entries].sort((left, right) =>
    String(left[0]).localeCompare(String(right[0]))
  );

  for (const [definitionId, quantity] of sorted) {
    const total = Number(quantity);

    if (!Number.isFinite(total)) continue;

    lines.push(`${definitionId}: ${total}`);
  }

  return lines.length > 0 ? lines.join(", ") : "(none)";
}

/*
 * Annotate the actions that rest on a BELIEF.
 *
 * An action whose resource requirement was satisfied only by what
 * the prisoner believes they hold is offered with a flag saying so.
 * The annotation tells the prisoner that reaching for it may come
 * back empty, without telling them why: they do not know the world
 * took it, and saying so would collapse the divergence.
 */
function annotateClaimedActions(legalActions, claimView) {
  const list = Array.isArray(legalActions) ? legalActions : [];

  if (list.length === 0) return [];

  const live = Array.isArray(claimView?.live) ? claimView.live : [];

  if (live.length === 0) return list;

  return list.map((entry) => {
    if (entry?.claimedButAbsent !== true) return entry;

    /*
     * The resource IDs are what the prisoner has to name in a
     * proposal, so they are named explicitly. An action that reaches
     * for something they no longer hold is only actionable if they
     * know WHICH id to reach for.
     *
     * The DEFINITIONS are described separately, with the quantity
     * they remember, because "you remember having 3 cigarettes" is
     * the belief and "cigarette_stack_01" is the handle.
     */
    const resourceIdList = Array.isArray(entry.claimedResourceIds)
      ? entry.claimedResourceIds.filter(Boolean)
      : [];

    const described = live
      .filter((candidate) =>
        resourceIdList.includes(candidate?.claimedResourceId)
      )
      .map(
        (candidate) =>
          `${candidate.definitionId} (you remember having ${candidate.claimed})`
      )
      .join(", ");

    /*
     * `claimedDefinitions` names the REQUIREMENT keys that only the
     * belief satisfied ("holdAny", "ignition", a definition id).
     * Those are the engine's internal vocabulary and mean nothing to
     * the prisoner, so they are dropped from the prompt. The
     * annotation below carries the same information in the prisoner's
     * own terms.
     */
    const { claimedDefinitions, ...promptEntry } = entry;

    return {
      ...promptEntry,
      claimedButAbsentNote: [
        described
          ? `You believe you still hold: ${described}.`
          : "You believe you still hold what this action needs.",
        resourceIdList.length > 0
          ? `The resource ids you remember holding: ${resourceIdList.join(", ")}.`
          : "",
        "You may reach for it, but you are not certain it is there."
      ]
        .filter(Boolean)
        .join(" ")
    };
  });
}

export function buildAgencyProposalPrompt(
  sim,
  legalActions,
  budget,
  resourceView = null,
  claimView = null
) {
  const { activeGoal, goalHistory, ...scratchpadWithoutGoals } =
    sim.scratchpad ?? {};

  const subjectiveState = {
    identity: sim.id,
    condition: {
      hope: sim.hope,
      sanity: sim.sanity,
      suffering: sim.suffering
    },
    drives: sim.drives ?? {},
    anchors: sim.anchors ?? [],
    beliefs: sim.beliefs ?? {},
    scratchpad: scratchpadWithoutGoals
  };

  const tacticalMenu = [
    "══════════════════════════════════════",
    "TACTICAL MENU (COVERT OBJECTIVES)",
    "══════════════════════════════════════",
    "Choose ONE objective that best aligns with your current Drives and the physical reality of the vault:",
    "",
    ...TIER1_GOALS.flatMap((goal) => [
      `${goal.id}: ${goal.label}`,
      goal.description,
      ""
    ]),
    "══════════════════════════════════════"
  ].join("\n");

  const resources = Array.isArray(resourceView?.stacks)
    ? resourceView.stacks.map((stack) => ({
        resourceId: stack.resourceId,
        definitionId: stack.definitionId,
        quantity: stack.quantity,
        accessible: stack.accessible,
        concealed: stack.concealed
      }))
    : [];

  /*
   * THE TWO INVENTORIES.
   *
   * A prisoner whose cigarette was confiscated without their
   * knowledge still believes they have it. Showing them only the
   * objective view would silently correct their memory and collapse
   * the divergence the engine is keeping open. Showing them only the
   * believed view would have them act on things that are not there.
   *
   * So both are shown, under separate headings, and the prompt never
   * says which one is right. The prisoner reaches for what they
   * believe they have; the engine resolves the attempt against
   * reality; and the refusal is the moment they learn.
   */
  const actualHoldings = formatHoldings(
    Object.entries(
      groupQuantitiesByDefinition(resources)
    )
  );

  const believedHoldings = formatHoldings(
    Object.entries(
      claimView?.believed &&
      typeof claimView.believed === "object"
        ? claimView.believed
        : {}
    )
  );

  /*
   * The actions that rest on a belief rather than on reality. The
   * prisoner is told plainly that they believe they have the thing,
   * because reaching for it is a legitimate move even when the reach
   * will come back empty.
   */
  const annotatedActions = annotateClaimedActions(
    legalActions,
    claimView
  );

  return [
    `You are ${sim.id}. Choose exactly one typed Agency action for this cycle.`,
    "Return one JSON object only. Do not narrate or predict the outcome.",
    "The object must contain type and selected_objective, and may contain mode, resourceId, and targetId.",
    `selected_objective must be one of: ${TIER1_GOALS.map((goal) => goal.id).join(", ")}.`,
    "Do not include any other keys or free-form action names.",
    "For TRANSFER, name one resourceId from your inventory and a different prisoner as targetId.",
    "For HIDE or REVEAL, name one resourceId from your inventory.",
    "For CONSUME, name one dirty_water resourceId from your inventory. Cigarettes can only be consumed through SMOKE.",
    "SEARCH: Scavenges the immediate area. 35% success. Yields cigarettes, wet cigarettes (2 turns to dry), or matches. Triggers a 4-cycle cooldown on use. Cannot be used while on cooldown.",
    "SEARCH does not target other prisoners.",
    "An omitted mode selects the action's default form.",
    "An action marked claimedButAbsent rests on something you believe you still have. You may choose it, but you may find nothing there.",
    "If you choose WAIT, return {\"type\":\"WAIT\",\"selected_objective\":\"<id>\"}.",
    "",
    `Remaining action budget: ${budget}`,
    "Legal actions:",
    JSON.stringify(annotatedActions, null, 2),
    "",
    "[YOUR RESOURCES - BELIEVED] what you think you are carrying:",
    believedHoldings,
    "[YOUR RESOURCES - ACTUAL] what is really in your hands:",
    actualHoldings,
    "",
    "Your accessible resources:",
    JSON.stringify(resources, null, 2),
    "",
    tacticalMenu,
    "",
    "Your subjective state:",
    JSON.stringify(subjectiveState, null, 2)
  ].join("\n");
}
