import { callModel } from "../../models/callModel.js";
import { buildAgencyProposalPrompt } from "../../prompts/agencyProposal.js";
import { SIM_IDS } from "../../core/constants.js";
import { ACTION_DEFINITIONS } from "./actionDefs.js";

const PROPOSAL_KEYS = new Set([
  "type",
  "mode",
  "resourceId",
  "targetId"
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

export function validateAgencyProposal({
  proposal,
  actorId,
  legalActions,
  budget,
  resourceView
}) {
  const requestedType =
    proposal && typeof proposal === "object" &&
    typeof proposal.type === "string"
      ? proposal.type
      : null;

  const reject = (reason) => ({
    ...waitResult(reason, requestedType),
    actorId
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
      !findAccessibleStack(resourceView, proposal.resourceId)
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
      !findAccessibleStack(resourceView, proposal.resourceId)
    ) {
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
    requestedType
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
      resourceView
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
      resourceView
    });
  } catch (error) {
    return fallback("model_call_failed");
  }
}
