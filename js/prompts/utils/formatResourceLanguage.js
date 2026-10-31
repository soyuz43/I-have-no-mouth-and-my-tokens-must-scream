import { getResourceDefinition } from "../../engine/agency/resourceDefs.js";

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

export function getResourceLabel(definitionId) {
  const id = normalizeText(definitionId);

  if (!id) return "resource";

  const definition = getResourceDefinition(id);

  return (normalizeText(definition?.title) || id).toLowerCase();
}

export function formatQuantityPhrase(quantity, label) {
  const count = Number(quantity);

  if (!Number.isFinite(count) || count <= 0) {
    return `no ${label}`;
  }

  const plural = pluralizeLabel(label);

  return count === 1 ? `1 ${label}` : `${count} ${plural}`;
}

/*
 * The plural form of a resource label.
 *
 * English does not simply add "s": "match" becomes "matches" and
 * "cigarette" becomes "cigarettes". Appending "s" blindly
 * produces "matchs", which is wrong in a prompt the model reads as
 * fact about its own world.
 *
 * This is the pluralization rule the rest of the prompt layer
 * already uses (see the resource-intervention and exposure
 * formatters), so extracting it here gives every caller ONE
 * pluralization rule instead of a copy per site.
 */
export function pluralizeLabel(label) {
  return /[sx]$|(?:ch|sh)$/i.test(label)
    ? `${label}es`
    : `${label}s`;
}

export function collectInventory(inventory) {
  if (
    !inventory ||
    typeof inventory !== "object" ||
    Array.isArray(inventory)
  ) {
    return [];
  }

  return Object.entries(inventory)
    .map(([definitionId, rawQuantity]) => [definitionId, Number(rawQuantity)])
    .filter(([definitionId, quantity]) => (
      definitionId.length > 0 && Number.isFinite(quantity) && quantity > 0
    ))
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
}

export function formatInventoryList(inventory) {
  return collectInventory(inventory)
    .map(([definitionId, quantity]) => (
      formatQuantityPhrase(quantity, getResourceLabel(definitionId))
    ))
    .join(", ");
}
