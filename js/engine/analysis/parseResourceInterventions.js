import { getResourceDefinition } from "../agency/resourceDefs.js";

export function hasTargetDialogue(actions, targetId) {
  return typeof actions?.[targetId]?.text === "string";
}

export function dialogueReferencesResource(actionText, resource) {
  const text = String(actionText ?? "").toLowerCase();
  const definition = getResourceDefinition(resource?.definitionId);
  const references = [
    resource?.resourceId,
    resource?.definitionId?.replace(/_/g, " "),
    definition?.title
  ].filter((value) => typeof value === "string" && value.trim());

  return references.some((reference) => text.includes(reference.toLowerCase()));
}
