import { TIER1_GOALS } from "../engine/scratchpad/goals/registry.js";

export function buildAgencyProposalPrompt(
  sim,
  legalActions,
  budget,
  resourceView = null
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
    "If you choose WAIT, return {\"type\":\"WAIT\",\"selected_objective\":\"<id>\"}.",
    "",
    `Remaining action budget: ${budget}`,
    "Legal actions:",
    JSON.stringify(legalActions, null, 2),
    "Your accessible resources:",
    JSON.stringify(resources, null, 2),
    "",
    tacticalMenu,
    "",
    "Your subjective state:",
    JSON.stringify(subjectiveState, null, 2)
  ].join("\n");
}
