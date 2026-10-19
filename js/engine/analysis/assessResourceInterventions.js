import { callModel } from "../../models/callModel.js";

const NONE_INTERVENTION = Object.freeze({ intervention: "none" });
const VALID_INTERVENTIONS = new Set(["taunt", "confiscate", "destroy", "transfer"]);

export function evaluatePrisonerAssessmentGate(prisonerId, G, interventionId = null) {
  const heldResources = Array.isArray(G?.resources?.instances)
    ? G.resources.instances.filter(
      (resource) => resource?.holderId === prisonerId && resource.quantity > 0
    )
    : [];
  const heldResourceIds = new Set(
    heldResources
      .map((resource) => resource.resourceId)
      .filter((resourceId) => typeof resourceId === "string" && resourceId.length > 0)
  );
  const matchingAttentionFlags = Array.isArray(G?.recentResourceDiscoveries)
    ? G.recentResourceDiscoveries.filter(
      (discovery) =>
        typeof discovery?.resourceId === "string" &&
        heldResourceIds.has(discovery.resourceId)
    )
    : [];
  const shouldAssess = heldResourceIds.size > 0 && matchingAttentionFlags.length > 0;
  const reason = shouldAssess
    ? "held resources have recent attention flags"
    : heldResources.length === 0
      ? "no held resources"
      : heldResourceIds.size === 0
        ? "held resources have no usable resource IDs"
        : "no matching recent attention flags";
  const gate = {
    cycle: G?.cycle ?? "unknown",
    interventionId,
    prisonerId,
    heldResources: heldResources.map((resource) => ({
      resourceId: resource.resourceId ?? null,
      definitionId: resource.definitionId ?? null,
      quantity: resource.quantity,
      concealed: resource.concealed === true
    })),
    matchingAttentionFlags: matchingAttentionFlags.map((discovery) => ({
      resourceId: discovery.resourceId,
      cycle: discovery.cycle ?? null,
      actorId: discovery.actorId ?? null
    })),
    outcome: shouldAssess ? "assess" : "skip",
    reason
  };
  console.debug("[AM RESOURCE ASSESSMENT][GATE]", gate);
  return { ...gate, shouldAssess };
}

export function shouldAssessPrisoner(prisonerId, G) {
  return evaluatePrisonerAssessmentGate(prisonerId, G).shouldAssess;
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
  return parseAssessmentResponseDetails(responseText, prisonerId).assessment;
}

function parseAssessmentResponseDetails(responseText, prisonerId) {
  const parsed = parseResponseObject(responseText);
  if (!parsed) {
    return {
      assessment: { ...NONE_INTERVENTION },
      parseStatus: "rejected",
      parseReason: "response is not a JSON object"
    };
  }
  if (parsed.intervention === "none") {
    return {
      assessment: { ...NONE_INTERVENTION },
      parseStatus: "valid-none",
      parseReason: null
    };
  }
  if (!VALID_INTERVENTIONS.has(parsed.intervention)) {
    return {
      assessment: { ...NONE_INTERVENTION },
      parseStatus: "rejected",
      parseReason: `unsupported intervention: ${String(parsed.intervention)}`
    };
  }

  const resourceId = typeof parsed.resource_id === "string" ? parsed.resource_id.trim() : "";
  const rationale = typeof parsed.rationale === "string" && parsed.rationale.trim()
    ? parsed.rationale.trim()
    : "No rationale provided.";
  if (!resourceId || typeof prisonerId !== "string" || !prisonerId) {
    return {
      assessment: { ...NONE_INTERVENTION },
      parseStatus: "rejected",
      parseReason: !resourceId ? "resource_id is missing" : "prisoner ID is missing"
    };
  }
  if (parsed.quantity !== undefined &&
    (!Number.isSafeInteger(parsed.quantity) || parsed.quantity < 1)) {
    return {
      assessment: { ...NONE_INTERVENTION },
      parseStatus: "rejected",
      parseReason: "quantity must be a positive safe integer"
    };
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
    if (!targetHolderId || targetHolderId === prisonerId) {
      return {
        assessment: { ...NONE_INTERVENTION },
        parseStatus: "rejected",
        parseReason: !targetHolderId
          ? "transfer target_holder_id is missing"
          : "transfer target must differ from the source prisoner"
      };
    }
    intervention.target_holder_id = targetHolderId;
  }

  return { assessment: intervention, parseStatus: "valid-decision", parseReason: null };
}

export async function requestPrisonerAssessment(
  prisonerId,
  G,
  modelCall = callModel,
  interventionId = null
) {
  const prompt = buildAssessmentPrompt(prisonerId, G);
  const messages = [{
    role: "user",
    content: `Assess ${prisonerId}'s resources for cycle ${G?.cycle ?? "unknown"}.`
  }];
  console.debug("[AM RESOURCE ASSESSMENT][MODEL CALL]", {
    cycle: G?.cycle ?? "unknown",
    interventionId,
    prisonerId,
    status: "started"
  });

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
    const result = parseAssessmentResponseDetails(responseText, prisonerId);
    const parsed = result.assessment;
    const interventionType = parsed.intervention_type ?? parsed.intervention;
    const heldResource = parsed.resource_id
      ? G?.resources?.instances?.find(
        (resource) =>
          resource?.resourceId === parsed.resource_id &&
          resource.holderId === prisonerId
      )
      : null;
    const logContext = {
      cycle: G?.cycle ?? "unknown",
      interventionId,
      prisonerId,
      interventionType,
      resourceId: parsed.resource_id ?? null,
      targetId: parsed.target_holder_id ?? parsed.target_id ?? null,
      quantity: parsed.quantity ?? heldResource?.quantity ?? null,
      quantityMode: parsed.intervention_type && parsed.intervention_type !== "taunt"
        ? parsed.quantity === undefined
          ? "all held units (default)"
          : "explicit"
        : null,
      rationale: parsed.rationale ?? null,
      parseStatus: result.parseStatus,
      parseReason: result.parseReason
    };
    if (result.parseStatus === "rejected") {
      console.warn("[AM RESOURCE ASSESSMENT][PARSE REJECTED]", {
        ...logContext,
        responsePreview: String(responseText ?? "").slice(0, 300)
      });
    }
    console.debug("[AM RESOURCE ASSESSMENT][MODEL RESULT]", logContext);
    if (parsed.intervention_type) parsed.interventionId = interventionId;
    return parsed;
  } catch (error) {
    console.warn("[AM RESOURCE ASSESSMENT][MODEL FAILURE]", {
      cycle: G?.cycle ?? "unknown",
      interventionId,
      prisonerId,
      reason: error?.message ?? String(error),
      error
    });
    return { ...NONE_INTERVENTION };
  }
}
