export function buildAgencyProposalPrompt(
  sim,
  legalActions,
  budget,
  resourceView = null
) {
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
    scratchpad: sim.scratchpad ?? {}
  };

  const resources = Array.isArray(resourceView?.stacks)
    ? resourceView.stacks.map((stack) => ({
        resourceId: stack.resourceId,
        definitionId: stack.definitionId,
        quantity: stack.quantity,
        accessible: stack.accessible,
        concealed: stack.concealed
      }))
    : [];

  return [
    `You are ${sim.id}. Choose exactly one typed Agency action for this cycle.`,
    "Return one JSON object only. Do not narrate or predict the outcome.",
    "The object must contain type and may contain mode, resourceId, and targetId.",
    "Do not include any other keys or free-form action names.",
    "For TRANSFER, name one resourceId from your inventory and a different prisoner as targetId.",
    "For HIDE or REVEAL, name one resourceId from your inventory.",
    "An omitted mode selects the action's default form.",
    "If you choose WAIT, return {\"type\":\"WAIT\"}.",
    "",
    `Remaining action budget: ${budget}`,
    "Legal actions:",
    JSON.stringify(legalActions, null, 2),
    "Your accessible resources:",
    JSON.stringify(resources, null, 2),
    "Your subjective state:",
    JSON.stringify(subjectiveState, null, 2)
  ].join("\n");
}
