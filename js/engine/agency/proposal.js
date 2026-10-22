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

/*
 * The BELIEVED resources a prisoner believes they hold but do not
 * actually hold.
 *
 * WHY THE PROPOSAL CARRIES THIS
 * -----------------------------
 * A proposal is ACCEPTED when the prisoner names a resource they
 * really hold OR one they believe they hold. The accepted proposal
 * then goes to the resolver, which checks it against the OBJECTIVE
 * snapshot and refuses it with `resource_unavailable` when the thing
 * is genuinely not there.
 *
 * That refusal is the learning event: the prisoner's hand has just
 * confirmed their memory was wrong. But the resolver only sees the
 * objective snapshot, so it cannot tell a refusal of a BELIEVED
 * resource from a refusal of a resource the prisoner never had.
 *
 * The distinction has to be carried across the boundary, because the
 * two cases must be treated differently:
 *
 *   - Refused on a BELIEVED resource: the belief was wrong, and the
 *     refusal corrects it. This closes the divergence.
 *
 *   - Refused on a resource the prisoner never believed they held:
 *     there is no belief to correct, and nothing to write.
 *
 * So the proposal records WHAT WAS BELIEVED, and the commit path
 * uses it to decide whether a refusal is a belief correction.
 *
 * Only a FRESH belief counts. A stale divergence cannot license a
 * proposal in the first place (`livesResourceId` requires a live
 * entry), so anything reaching here is already fresh.
 *
 * WHY A LIST AND NOT A SINGLE RESOURCE
 * ------------------------------------
 * A proposal that NAMES a resource (HIDE, REVEAL, TRANSFER,
 * CONSUME) reaches for one specific stack, so one entry is enough
 * to describe it. A proposal that names NO resource (SMOKE) draws
 * on a set of definitions, so the refusal it produces can be about
 * any one of them. Carrying the whole list lets the resolver say
 * which definition was missing and the commit path match it
 * against what was believed, without either side having to
 * re-derive the other's view.
 */
function findBelievedResources(claimView, resourceView) {
  const live = Array.isArray(claimView?.live) ? claimView.live : [];
  const believed = [];

  for (const entry of live) {
    const resourceId = entry?.claimedResourceId;

    if (!resourceId) continue;

    const definitionId = entry?.definitionId ?? null;

    if (!definitionId) continue;

    /*
     * A stack the prisoner still REACHES is not a missing stack.
     * The belief may still be wrong about the QUANTITY, but the
     * refusal of an action against a stack that is physically
     * present says nothing about whether their memory was wrong.
     */
    if (findAccessibleStack(resourceView, resourceId)) continue;

    believed.push({
      resourceId,
      definitionId,
      claimed: Number(entry?.claimed) || 0
    });
  }

  return believed;
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

  /*
   * The resources the proposal reached for, and whether the reach
   * was licensed by a BELIEF rather than by the objective ledger.
   *
   * A belief-licensed reach is the ONLY kind that can produce a
   * belief-correcting refusal. If the prisoner really held the
   * stack, a refusal says nothing about their memory, and correcting
   * the belief would be wrong.
   */
  const believedResources = findBelievedResources(claimView, resourceView);

  const resolveTarget = (resourceId) => {
    if (typeof resourceId !== "string") {
      return { found: false, claimed: false, stack: null };
    }

    const held = findAccessibleStackOrBelief(
      resourceView,
      claimView,
      resourceId
    );

    if (!held) {
      return { found: false, claimed: false, stack: null };
    }

    return {
      found: true,
      claimed: held.claimed,
      stack: held.stack ?? null
    };
  };

  if (proposal.type === "TRANSFER") {
    if (!resolveTarget(proposal.resourceId).found) {
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
    if (!resolveTarget(proposal.resourceId).found) {
      return reject("resource_unavailable");
    }
    action.resourceId = proposal.resourceId;
  } else if (proposal.type === "CONSUME") {
    const held = resolveTarget(proposal.resourceId);

    if (!held.found) {
      return reject("resource_unavailable");
    }

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

  /*
   * `believedResources` is already resolved above. It lists the
   * stacks the prisoner believes they hold and objectively do not,
   * which is the only evidence a refusal can correct.
   */
  return {
    actorId,
    action,
    cost,
    accepted: true,
    reason: null,
    requestedType,
    selectedObjective,
    believedResources
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
