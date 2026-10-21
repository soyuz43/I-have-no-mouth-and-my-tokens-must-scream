// js/prompts/utils/formatResourceTrajectory.js
//
// Renders the recent Objective Ledger history as a compact,
// human-readable trajectory for the AM planning prompt.
//
// WHY THIS EXISTS
// ---------------
// AM reads the objective ledger as a STATE: what each prisoner holds
// right now. A state says nothing about direction. Two worlds can
// present the identical ledger and demand opposite responses, if in
// one world the cigarette was just confiscated and in the other it
// has sat untouched for twenty cycles.
//
// The event history carries that direction. Rendering it turns AM
// from a state-reader into a trajectory-reader.
//
// BOUNDEDNESS
// -----------
// The section is capped at a fixed number of entries so the prompt
// cannot grow without limit over a long run. The most recent events
// win; the oldest are dropped.
//
// DETERMINISM
// -----------
// Pure function of its input. No clock, no randomness, no ordering
// by anything but the order the events were recorded in.

import { getResourceDefinition } from "../../engine/agency/resourceDefs.js";

/*
 * How many events the trajectory section may contain.
 *
 * Bounded so the prompt stays a fixed size. Twelve is enough to
 * show a transfer, a confiscation, and a search within one
 * trajectory without dragging in a whole run of noise.
 */
export const RESOURCE_TRAJECTORY_LIMIT = 12;

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

/*
 * A readable label for a resource definition.
 *
 * Falls back to the raw definition id, then to "resource", so a
 * line never renders as an empty label.
 */
function getResourceLabel(definitionId) {
  const id = normalizeText(definitionId);

  if (!id) return "resource";

  const definition = getResourceDefinition(id);

  return normalizeText(definition?.title) || id;
}

/*
 * A readable label for an actor or holder.
 */
function getHolderLabel(holderId) {
  const id = normalizeText(holderId);

  if (!id) return "no one";

  return id;
}

function formatQuantity(quantity) {
  const value = Number(quantity);

  if (!Number.isFinite(value)) return "0";

  return String(value);
}

/*
 * One trajectory line, per event kind.
 *
 * Each line states WHO did WHAT to HOW MUCH of WHAT, and names the
 * holder on both sides of the move. That is the minimum an
 * omniscient planner needs to reason about a trajectory rather than
 * a snapshot.
 */
function formatEventLine(event) {
  const cycle = Number.isFinite(Number(event?.cycle))
    ? Number(event.cycle)
    : 0;

  const label = getResourceLabel(event?.definitionId);
  const quantity = formatQuantity(event?.quantityAfter);
  const action = normalizeText(event?.cause?.action).toUpperCase();

  const from = getHolderLabel(event?.fromHolderId);
  const to = getHolderLabel(event?.toHolderId);

  switch (event?.kind) {
    case "seed":
      return `- Cycle ${cycle}: the world seeded ${quantity} ${label} into ${to}'s hands (${action || "SEED"})`;

    case "prisoner_action":
      if (action === "HIDE" || action === "REVEAL") {
        return `- Cycle ${cycle}: ${from} ${action === "HIDE" ? "hid" : "revealed"} their ${label} (${action})`;
      }

      if (action === "SEARCH") {
        return `- Cycle ${cycle}: ${to} found ${quantity} ${label} by searching (SEARCH)`;
      }

      if (!to || to === "no one") {
        return `- Cycle ${cycle}: ${from} used up ${quantity} ${label} (${action || "CONSUMED"})`;
      }

      return `- Cycle ${cycle}: ${from} gave ${quantity} ${label} to ${to} (${action || "TRANSFER"})`;

    case "am_intervention":
      if (!to || to === "no one") {
        return `- Cycle ${cycle}: AM destroyed ${quantity} ${label} taken from ${from} (${action || "DESTROY"})`;
      }

      if (to === "AM") {
        return `- Cycle ${cycle}: AM confiscated ${quantity} ${label} from ${from} (${action || "CONFISCATE"})`;
      }

      return `- Cycle ${cycle}: AM moved ${quantity} ${label} from ${from} to ${to} (${action || "TRANSFER"})`;

    case "drying":
      return `- Cycle ${cycle}: ${from}'s ${label} dried out and became usable (${action || "DRIED"})`;

    case "exposure":
      return `- Cycle ${cycle}: ${from}'s ${label} came into view (${action || "EXPOSED"})`;

    default:
      return `- Cycle ${cycle}: ${quantity} ${label} changed hands from ${from} to ${to}`;
  }
}

/*
 * Build the bounded trajectory section.
 *
 * Returns an empty string when there is no history yet, so a caller
 * can drop the section from the prompt entirely rather than showing
 * AM an empty heading.
 */
export function formatResourceTrajectory(events) {
  const history = Array.isArray(events)
    ? events.slice(-RESOURCE_TRAJECTORY_LIMIT)
    : [];

  if (history.length === 0) return "";

  return [
    "[RECENT RESOURCE TRAJECTORY]",
    "The objective ledger above is a snapshot. These lines are its recent history, oldest first. Direction matters: an item that keeps moving is being worked, and an item that has not moved in many cycles is not in play.",
    ...history.map(formatEventLine)
  ].join("\n");
}
