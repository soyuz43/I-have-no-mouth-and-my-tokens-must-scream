import { callModel } from "../../models/callModel.js";
import { buildAgencyProposalPrompt } from "../../prompts/agencyProposal.js";
import { SIM_IDS } from "../../core/constants.js";
import { ACTION_DEFINITIONS } from "./actionDefs.js";
import {
  getBelievedDefinitionId,
  livesResourceId
} from "./claimView.js";

const PROPOSAL_KEYS = new Set([
  "type",
  "mode",
  "resourceId",
  "targetId",
  "selected_objective"
]);

function waitResult(reason, requestedType = null) {
  return {
    actorId: null,
    action: { type: "WAIT" },
    cost: 0,
    accepted: false,
    reason,
    requestedType
  };
}

function findAccessibleStack(resourceView, resourceId) {
  return resourceView?.stacks?.find(
    (stack) =>
      stack?.resourceId === resourceId &&
      stack.accessible === true &&
      Number(stack.quantity) > 0
  ) ?? null;
}

/*
 * Whether the prisoner may NAME this resource in a proposal.
 *
 * Two ways to say yes:
 *
 *   1. They really hold it. The objective view says so.
 *   2. They believe they hold it. The claim ledger says so.
 *
 * The second case is the whole point of this phase. A prisoner whose
 * cigarette was confiscated without their knowledge still believes
 * they have it, and they must be allowed to REACH for it. Reaching is
 * not having: the resolver checks the reach against the objective
 * snapshot and refuses it with `resource_unavailable`, and that
 * refusal is the dissonance moment the prisoner experiences.
 *
 * The belief is restricted to FRESH divergences, so a stale
 * misremembering cannot be proposed against indefinitely.
 */
function findAccessibleStackOrBelief(
  resourceView,
  claimView,
  resourceId
) {
  const stack = findAccessibleStack(resourceView, resourceId);

  if (stack) return { stack, claimed: false };

  /*
   * The belief has to be FRESH. A prisoner who used to hold a stack
   * and no longer does may still remember it, but the confusion has
   * gone cold, and proposing against a cold memory would produce a
   * refusal with nothing new to resolve.
   */
  if (livesResourceId(claimView, resourceId)) {
    return { stack: null, claimed: true };
  }

  return null;
}

export function validateAgencyProposal({
  proposal,
  actorId,
  legalActions,
  budget,
  resourceView,
  claimView = null
}) {
  const selectedObjective =
    proposal && typeof proposal === "object" && !Array.isArray(proposal)
      ? proposal.selected_objective
      : null;
  const requestedType =
    proposal && typeof proposal === "object" &&
    typeof proposal.type === "string"
      ? proposal.type
      : null;

  const reject = (reason) => ({
    ...waitResult(reason, requestedType),
    actorId,
    selectedObjective
  });

  if (
    !proposal ||
    typeof proposal !== "object" ||
    Array.isArray(proposal) ||
    Object.keys(proposal).some((key) => !PROPOSAL_KEYS.has(key))
  ) {
    return reject("invalid_proposal_shape");
  }

  if (typeof proposal.type !== "string") {
    return reject("missing_action_type");
  }

  const legalAction = Array.isArray(legalActions)
    ? legalActions.find((entry) => entry?.type === proposal.type)
    : null;
  if (!legalAction) {
    return reject("action_not_legal");
  }

  const definition = ACTION_DEFINITIONS[proposal.type];
  if (!definition) {
    return reject("action_definition_missing");
  }

  const availableModes = Array.isArray(legalAction.availableModes)
    ? legalAction.availableModes
    : [];
  if (proposal.mode !== undefined) {
    if (
      typeof proposal.mode !== "string" ||
      !availableModes.includes(proposal.mode)
    ) {
      return reject("mode_not_legal");
    }
  }

  const cost = proposal.mode === undefined
    ? Number(definition.baseCost ?? legalAction.cost ?? 0)
    : Number(definition.executionModes?.[proposal.mode]?.cost);
  if (!Number.isFinite(cost) || cost < 0) {
    return reject("action_cost_invalid");
  }
  if (!Number.isFinite(Number(budget)) || cost > Number(budget)) {
    return reject("budget_exceeded");
  }

  const action = { type: proposal.type };
  if (proposal.mode !== undefined) action.mode = proposal.mode;

  if (proposal.type === "TRANSFER") {
    if (
      typeof proposal.resourceId !== "string" ||
      !findAccessibleStackOrBelief(
        resourceView,
        claimView,
        proposal.resourceId
      )
    ) {
      return reject("transfer_resource_unavailable");
    }
    if (
      typeof proposal.targetId !== "string" ||
      !SIM_IDS.includes(proposal.targetId) ||
      proposal.targetId === actorId
    ) {
      return reject("transfer_target_invalid");
    }
    action.resourceId = proposal.resourceId;
    action.targetId = proposal.targetId;
  } else if (proposal.type === "HIDE" || proposal.type === "REVEAL") {
    if (
      typeof proposal.resourceId !== "string" ||
      !findAccessibleStackOrBelief(
        resourceView,
        claimView,
        proposal.resourceId
      )
    ) {
      return reject("resource_unavailable");
    }
    action.resourceId = proposal.resourceId;
  } else if (proposal.type === "CONSUME") {
    const held = findAccessibleStackOrBelief(
      resourceView,
      claimView,
      proposal.resourceId
    );
    /*
     * CONSUME is the one action whose target is defined rather than
     * generic. A BELIEVED stack cannot be checked against the
     * catalogue from the objective view, because there is no
     * objective stack: the belief carries the definition id itself.
     */
    const definitionId = held?.stack
      ? held.stack.definitionId
      : held?.claimed
        ? getBelievedDefinitionId(claimView, proposal.resourceId)
        : null;

    if (definitionId !== "dirty_water") {
      return reject("resource_unavailable");
    }
    action.resourceId = proposal.resourceId;
  } else if (
    proposal.resourceId !== undefined ||
    proposal.targetId !== undefined
  ) {
    return reject("unexpected_action_parameters");
  }

  return {
    actorId,
    action,
    cost,
    accepted: true,
    reason: null,
    requestedType,
    selectedObjective
  };
}

export function parseAgencyProposal(responseText) {
  try {
    const parsed = JSON.parse(String(responseText ?? ""));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export async function collectAgencyProposal(
  sim,
  {
    budget,
    legalActions,
    resourceView,
    claimView = null,
    modelCall = callModel
  }
) {
  const fallback = (reason) => ({
    ...waitResult(reason),
    actorId: sim.id
  });

  try {
    const prompt = buildAgencyProposalPrompt(
      sim,
      legalActions,
      budget,
      resourceView,
      claimView
    );
    const response = await modelCall(
      sim.id,
      prompt,
      [{ role: "user", content: "Choose one action and return JSON only." }],
      240,
      {
        purpose: "AGENCY_PROPOSAL",
        subject: sim.id
      }
    );
    const parsed = parseAgencyProposal(response);
    if (!parsed) return fallback("proposal_parse_failed");

    return validateAgencyProposal({
      proposal: parsed,
      actorId: sim.id,
      legalActions,
      budget,
      resourceView,
      claimView
    });
  } catch (error) {
    return fallback("model_call_failed");
  }
}
