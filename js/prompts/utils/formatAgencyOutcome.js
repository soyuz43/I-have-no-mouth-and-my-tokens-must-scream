// js/prompts/utils/formatAgencyOutcome.js
//
// Renders one engine-resolved agency outcome as a plain-language
// sentence for the prisoner's private scratchpad review.
//
// WHAT THIS IS
// ------------
// The scratchpad review already receives the raw resolution reason
// (see `resolutionReason` in scratchpadComms.js), so the engine's
// verdict is not lost. What is lost is its READABILITY. A prisoner
// reading `"resolutionReason":"resource_unavailable"` has to
// reconstruct, unaided, that they reached for a cigarette and found
// nothing there.
//
// That reconstruction is the whole point of this phase. The dissonance
// moment is not the refusal; it is the prisoner UNDERSTANDING the
// refusal. So the refusal is rendered as a sentence the prisoner can
// think with.
//
// WHY IT NEVER SAYS WHY
// ---------------------
// The prisoner is NOT told what really happened. They are told what
// they tried to do and that the thing they reached for was not there.
// They do not know AM took it, and saying so would collapse the
// divergence the engine is keeping open.
//
// This is the same rule `formatClaimDissonance.js` follows: describe
// the MISSING THING, never the cause.
//
// DETERMINISM
// -----------
// Pure function of its input. No clock, no randomness, no state read.

import { getResourceDefinition } from "../../engine/agency/resourceDefs.js";

/*
 * The plain-language reading of each resolution reason.
 *
 * The phrasing is deliberately about the ACTION and the ABSENCE, and
 * never about a cause. "there was nothing there to smoke" describes
 * what the prisoner found; "AM took your cigarette" would tell them
 * something they are not supposed to know.
 */
const REASON_NARRATIVES = Object.freeze({
  resource_unavailable:
    "You reached for it and there was nothing there.",
  ignition_unavailable:
    "You had it, but there was nothing to light it with.",
  transfer_unavailable:
    "You reached to hand it over and there was nothing there to give.",
  resource_already_in_state:
    "It was already in that state.",
  conflict:
    "Something else had already claimed it first.",
  capability_below_minimum:
    "Your body could not do it.",
  search_cooldown:
    "You had searched too recently.",
  environment_unyielding:
    "You found nothing there.",
  action_not_implemented:
    "There was no way to carry that out.",
  actor_unavailable:
    "You were not there to do it.",
  invalid_proposal:
    "The action could not be carried out.",
  transfer_resource_unavailable:
    "You reached for it and there was nothing there."
});

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

/*
 * The resource label, lowercased because it is dropped into the
 * middle of a sentence the prisoner is thinking rather than read as a
 * catalogue entry.
 */
function getResourceLabel(definitionId) {
  const id = normalizeText(definitionId);

  if (!id) return null;

  const definition = getResourceDefinition(id);

  return (normalizeText(definition?.title) || id).toLowerCase();
}

/*
 * The phrase for the thing the prisoner reached for.
 *
 * The resource id is the strongest signal available: it names the
 * exact stack the prisoner was reaching for. When only a definition
 * is known, the definition's label is used instead.
 */
function getResourcePhrase(event) {
  const resourceIds = Array.isArray(event?.provenance?.resourceIds)
    ? event.provenance.resourceIds
    : [];

  const actionResourceId = normalizeText(
    event?.provenance?.actionResourceId
  );

  const ids = [
    ...resourceIds.map(normalizeText).filter(Boolean),
    ...(actionResourceId ? [actionResourceId] : [])
  ];

  if (ids.length > 0) {
    return ids[0];
  }

  const definitionId = normalizeText(
    event?.provenance?.actionDefinitionId
  );

  return getResourceLabel(definitionId);
}

/*
 * The verb the prisoner was performing.
 */
const ACTION_VERBS = Object.freeze({
  SMOKE: "smoke",
  CONSUME: "drink",
  TRANSFER: "hand over",
  HIDE: "conceal",
  REVEAL: "reveal",
  SEARCH: "search for"
});

/*
 * Render one agency event as a sentence the prisoner can think with.
 *
 * Returns null for a SUCCESSFUL action: there is nothing to narrate
 * when the attempt worked, and the JSON block beside this already
 * records what happened.
 */
export function formatAgencyOutcome(event) {
  if (!event || typeof event !== "object") return null;

  if (event.status === "success") return null;

  const actionType = normalizeText(event.actionType);
  const reason = normalizeText(event.provenance?.resolutionReason);

  if (!actionType) return null;

  /*
   * A WAIT that was refused is not a dissonance moment. The prisoner
   * chose to do nothing and the engine agreed; there is nothing to
   * reconcile.
   */
  if (actionType === "WAIT") return null;

  const verb = ACTION_VERBS[actionType];
  const resource = getResourcePhrase(event);
  const narrative = REASON_NARRATIVES[reason];

  if (!narrative) {
    /*
     * An unrecognized reason still has to reach the prisoner as
     * SOMETHING. The raw reason is included so the failure is
     * legible rather than silently dropped, but it is not dressed up
     * as a narrative the engine does not actually understand.
     */
    return reason
      ? `Your attempt to ${verb ?? actionType.toLowerCase()} was refused (${reason}).`
      : `Your attempt to ${verb ?? actionType.toLowerCase()} was refused.`;
  }

  if (!verb) {
    return narrative;
  }

  const subject = resource
    ? ` ${resource}`
    : "";

  return `You tried to ${verb}${subject}. ${narrative}`;
}

/*
 * Render the outcome block for a list of agency events.
 *
 * Returns an empty string when there is nothing to narrate, so the
 * caller can drop the section rather than print an empty heading.
 */
export function formatAgencyOutcomes(events) {
  const list = Array.isArray(events) ? events : [];

  const lines = [];

  for (const event of list) {
    const outcome = formatAgencyOutcome(event);

    if (!outcome) continue;

    lines.push(`- ${outcome}`);
  }

  return lines.length > 0 ? lines.join("\n") : "";
}
