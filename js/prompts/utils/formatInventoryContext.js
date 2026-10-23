import { buildResourceView } from "../../engine/agency/resourceLedger.js";
import {
  collectInventory,
  formatInventoryList,
} from "./formatResourceLanguage.js";

export function formatInventoryContext(believedInventory, perspective = "you") {
  const inventory = formatInventoryList(believedInventory);

  if (!inventory) return "";

  const lead = perspective === "prisoner"
    ? "The prisoner believes they hold"
    : "You believe you are carrying";

  return `${lead}: ${inventory}.`;
}

export function getObjectiveInventory(instances, simId) {
  const resourceView = buildResourceView({ instances }, simId);
  const inventory = {};

  for (const [definitionId, stacks] of Object.entries(resourceView.byDefinition)) {
    inventory[definitionId] = stacks.reduce(
      (quantity, stack) => quantity + Number(stack.quantity),
      0
    );
  }

  return inventory;
}

export function inventoriesDiffer(believedInventory, objectiveInventory) {
  const believed = new Map(collectInventory(believedInventory));
  const objective = new Map(collectInventory(objectiveInventory));
  const definitionIds = new Set([...believed.keys(), ...objective.keys()]);

  return [...definitionIds].some(
    (definitionId) => believed.get(definitionId) !== objective.get(definitionId)
  );
}
