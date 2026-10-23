// js/prompts/utils/formatTargetMaterialState.js
//
// Renders a target prisoner material state for AM constraint assessment.
// Pure function of its input. No clock, no randomness.

import { getResourceDefinition } from "../../engine/agency/resourceDefs.js";
import { getClaimDivergenceEntries } from "../../engine/agency/claimLedger.js";
import { formatQuantityPhrase } from "./formatResourceLanguage.js";

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function getResourceLabel(definitionId) {
  const id = normalizeText(definitionId);
  if (!id) return "resource";
  const definition = getResourceDefinition(id);
  return normalizeText(definition?.title) || id;
}

function formatStack(instance) {
  const label = getResourceLabel(instance?.definitionId);
  const quantity = Number(instance?.quantity);
  const phrase = formatQuantityPhrase(quantity, label);
  const visibility = instance?.concealed === true ? "concealed" : "exposed";
  return `${phrase} (${visibility})`;
}

function formatExposure(event) {
  const label = getResourceLabel(event?.definitionId);
  const cause = normalizeText(event?.cause?.action);
  const source = normalizeText(event?.cause?.source);
  const cycle = Number(event?.cycle);
  const cycleNote = Number.isFinite(cycle) ? `Cycle ${cycle}` : "unknown cycle";
  const causeNote = cause ? ` due to ${cause}` : "";
  const sourceNote = source ? ` (${source})` : "";
  const cyclePart = cycleNote ? `${cycleNote}: ` : "";
  return `- ${cyclePart}${label} became exposed${causeNote}${sourceNote}.`;
}

export function formatTargetMaterialState(targetId, G) {
  if (!targetId || typeof targetId !== "string") return "";
  const instances = G?.resources && Array.isArray(G.resources.instances)
    ? G.resources.instances
    : [];
  const held = instances.filter(
    (instance) => instance && instance.holderId === targetId && Number(instance.quantity) > 0
  ).sort((left, right) => {
    const leftId = String(left?.resourceId ?? "");
    const rightId = String(right?.resourceId ?? "");
    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
  });
  const exposures = G?.resourceEvents && Array.isArray(G.resourceEvents)
    ? G.resourceEvents.filter(
      (event) => event && event.kind === "exposure" && event.fromHolderId === targetId
    )
    : [];
  const divergenceEntries = G?.claimDivergence && typeof G.claimDivergence === "object"
    ? getClaimDivergenceEntries(G, targetId)
    : [];
  const hasMaterial = held.length > 0 || exposures.length > 0 || divergenceEntries.length > 0;
  if (!hasMaterial) return "Target holds no resources.";
  const lines = [];
  lines.push("[TARGET MATERIAL STATE]");
  if (held.length > 0) {
    const holding = held.map(formatStack).join(", ");
    lines.push(`- Currently holding: ${holding}.`);
  } else {
    lines.push("- Currently holding: nothing.");
  }
  if (exposures.length > 0) {
    lines.push("- Recent exposure:");
    for (const event of exposures) lines.push(`  ${formatExposure(event)}`);
  }
  if (divergenceEntries.length > 0) {
    lines.push("- Belief divergence:");
    for (const entry of divergenceEntries) {
      const label = getResourceLabel(entry.definitionId);
      const claimed = Number(entry.claimed) || 0;
      const objective = Number(entry.objective) || 0;
      lines.push(`  Target believes they hold ${formatQuantityPhrase(claimed, label)} (reality: ${formatQuantityPhrase(objective, label)}).`);
    }
  }
  return lines.join("\n");
}
