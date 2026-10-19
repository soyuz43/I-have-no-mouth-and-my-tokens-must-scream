import { callModel } from "../../models/callModel.js";

const NONE_INTERVENTION = Object.freeze({ intervention: "none" });
const VALID_INTERVENTIONS = new Set(["taunt", "confiscate", "destroy", "transfer"]);

export function shouldAssessPrisoner(prisonerId, G) {
  const heldResources = Array.isArray(G?.resources?.instances)
    ? G.resources.instances.filter(
      (resource) => resource?.holderId === prisonerId && resource.quantity > 0
    )
    : [];
  if (!heldResources.length) return false;

  const heldResourceIds = new Set(
    heldResources
      .map((resource) => resource.resourceId)
      .filter((resourceId) => typeof resourceId === "string" && resourceId.length > 0)
  );
  if (heldResourceIds.size === 0) return false;
  return Array.isArray(G?.recentResourceDiscoveries) &&
    G.recentResourceDiscoveries.some(
      (discovery) =>
        typeof discovery?.resourceId === "string" &&
        heldResourceIds.has(discovery.resourceId)
    );
}

export function buildAssessmentPrompt(prisonerId, G) {
  const heldResources = Array.isArray(G?.resources?.instances)
    ? G.resources.instances.filter((resource) => resource?.holderId === prisonerId)
    : [];
  const heldResourceIds = new Set(
    heldResources
      .map((resource) => resource.resourceId)
      .filter((resourceId) => typeof resourceId === "string" && resourceId.length > 0)
  );
  const flagsByResource = new Map();
  for (const flag of Array.isArray(G?.recentResourceDiscoveries)
    ? G.recentResourceDiscoveries.filter(
      (entry) => typeof entry?.resourceId === "string" && heldResourceIds.has(entry.resourceId)
    )
    : []) {
    const flags = flagsByResource.get(flag.resourceId) ?? [];
    flags.push(`cycle ${flag.cycle ?? "unknown"}${flag.actorId ? `, actor ${flag.actorId}` : ""}`);
    flagsByResource.set(flag.resourceId, flags);
  }

  const resourcesText = heldResources.length
    ? heldResources.map((resource) => [
      `- resource_id: ${resource.resourceId}`,
      `definition_id: ${resource.definitionId}`,
      `quantity: ${resource.quantity}`,
      `concealed: ${resource.concealed === true ? "yes" : "no"}`,
      `accessible: ${resource.accessible === false ? "no" : "yes"}`,
      `attention flags: ${(flagsByResource.get(resource.resourceId) ?? []).join("; ") || "none"}`
    ].join("; ")).join("\n")
    : "(none)";
  const runtime = G?.amTacticRuntime?.targets?.[prisonerId];
  const tacticContext = runtime
    ? `Tactic path: ${runtime.path ?? "unavailable"}\nCurrent phase: ${runtime.phaseId ?? "unavailable"}`
    : "Tactic path: unavailable\nCurrent phase: unavailable";
  const otherPrisonerIds = Object.keys(G?.sims ?? {})
    .filter((simId) => simId !== prisonerId).join(", ") || "(none)";

  return `Assess resource interventions for prisoner ${prisonerId}.

HELD RESOURCE LEDGER
${resourcesText}

CURRENT TACTIC CONTEXT
${tacticContext}

OTHER EXISTING PRISONERS
${otherPrisonerIds}

Choose at most one intervention. Values: none, taunt, confiscate, destroy, transfer.
Output exactly one JSON object, not an array. No prose, text outside JSON, or markdown fences.
resource_id must exactly match an ID in this prisoner's held resource ledger above.
For transfer, target_holder_id must be an existing prisoner ID other than ${prisonerId}.
quantity must be a positive integer; omit it to mean all units held.
rationale must be one sentence explaining why this intervention is appropriate now.
Destroy removes the complete resource instance; quantity does not make destruction partial.
If no intervention makes sense, output exactly: {"intervention":"none"}

Output schema examples:
{"intervention":"confiscate","resource_id":"<exact resource ID>","quantity":1,"rationale":"<one sentence>"}
{"intervention":"destroy","resource_id":"<exact resource ID>","quantity":1,"rationale":"<one sentence>"}
{"intervention":"taunt","resource_id":"<exact resource ID>","rationale":"<one sentence>"}
{"intervention":"transfer","resource_id":"<exact resource ID>","target_holder_id":"<another prisoner ID>","quantity":1,"rationale":"<one sentence>"}`;
}

function parseResponseObject(responseText) {
  const trimmed = String(responseText ?? "").trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  try {
    const parsed = JSON.parse(fenced ? fenced[1].trim() : trimmed);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function parseAssessmentResponse(responseText, prisonerId) {
  const parsed = parseResponseObject(responseText);
  if (!parsed || parsed.intervention === "none") return { ...NONE_INTERVENTION };
  if (!VALID_INTERVENTIONS.has(parsed.intervention)) return { ...NONE_INTERVENTION };

  const resourceId = typeof parsed.resource_id === "string" ? parsed.resource_id.trim() : "";
  const rationale = typeof parsed.rationale === "string" ? parsed.rationale.trim() : "";
  if (!resourceId || !rationale || typeof prisonerId !== "string" || !prisonerId) {
    return { ...NONE_INTERVENTION };
  }
  if (parsed.quantity !== undefined &&
    (!Number.isSafeInteger(parsed.quantity) || parsed.quantity < 1)) {
    return { ...NONE_INTERVENTION };
  }

  const intervention = {
    intervention_type: parsed.intervention,
    resource_id: resourceId,
    holder_id: prisonerId,
    rationale
  };
  if (parsed.quantity !== undefined) intervention.quantity = parsed.quantity;

  if (parsed.intervention === "taunt") {
    intervention.target_id = prisonerId;
  } else if (parsed.intervention === "transfer") {
    const targetHolderId = typeof parsed.target_holder_id === "string"
      ? parsed.target_holder_id.trim()
      : "";
    if (!targetHolderId || targetHolderId === prisonerId) return { ...NONE_INTERVENTION };
    intervention.target_holder_id = targetHolderId;
  }

  return intervention;
}

export async function requestPrisonerAssessment(prisonerId, G, modelCall = callModel) {
  const prompt = buildAssessmentPrompt(prisonerId, G);
  const messages = [{
    role: "user",
    content: `Assess ${prisonerId}'s resources for cycle ${G?.cycle ?? "unknown"}.`
  }];
  console.debug(`[AM RESOURCE ASSESSMENT] cycle=${G?.cycle ?? "unknown"} prisoner=${prisonerId} started`);

  try {
    const responseText = await modelCall(
      "am",
      prompt,
      messages,
      256,
      {
        purpose: "AM_RESOURCE_INTERVENTION_ASSESSMENT",
        subject: prisonerId,
        suppressResponseBodyLogs: true
      }
    );
    const parsed = parseAssessmentResponse(responseText, prisonerId);
    if (parsed.intervention === "none" && parseResponseObject(responseText)?.intervention !== "none") {
      console.warn(`[AM RESOURCE ASSESSMENT] cycle=${G?.cycle ?? "unknown"} prisoner=${prisonerId} invalid response; treating as none`);
    }
    console.debug(`[AM RESOURCE ASSESSMENT] cycle=${G?.cycle ?? "unknown"} prisoner=${prisonerId} decision=${parsed.intervention ?? parsed.intervention_type}`);
    return parsed;
  } catch (error) {
    console.warn(`[AM RESOURCE ASSESSMENT] cycle=${G?.cycle ?? "unknown"} prisoner=${prisonerId} failed; treating as none`, error);
    return { ...NONE_INTERVENTION };
  }
}
