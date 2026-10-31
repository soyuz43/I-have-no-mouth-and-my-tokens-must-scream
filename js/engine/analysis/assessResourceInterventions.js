import { callModel } from "../../models/callModel.js";
import {
  getFreshClaimDivergenceEntries,
  getDormantClaimDivergenceEntries,
  CLAIM_DISCLOSURES
} from "../agency/claimLedger.js";

const NONE_INTERVENTION = Object.freeze({ intervention: "none" });
const VALID_INTERVENTIONS = new Set(["taunt", "confiscate", "destroy", "transfer"]);
const VALID_DISCLOSURES = new Set(Object.values(CLAIM_DISCLOSURES));

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
  /*
   * A prisoner who is wrong about what they hold is worth assessing
   * EVEN WHEN they hold nothing worth an attention flag.
   *
   * The original gate required both a held resource and a matching
   * attention flag, which meant AM could never act on a prisoner
   * whose item it had just taken: the target holds nothing, so
   * "no held resources" and the gate closed. That is exactly the
   * prisoner AM most wants to reach - the one who is still certain
   * they are holding something.
   */
  const divergenceEntries = getFreshClaimDivergenceEntries(
    G,
    prisonerId,
    G?.cycle
  );
  /*
   * A DORMANT divergence is one whose confusion has already settled.
   *
   * It is not worth interrupting the prisoner for: they stopped
   * reaching for the missing thing long ago, and re-surfacing it in
   * their own scratchpad would only tell them AM keeps lying to
   * them. But it IS still a false belief they hold, and a false
   * belief they hold is the raw material gaslighting needs. AM may
   * name a dormant belief, deny it, or offer it back.
   *
   * So the gate opens for it. This changes AM's reach only; it does
   * NOT change the prisoner's action license, which stays bound to
   * the FRESH set (see claimView.js).
   */
  const dormantDivergenceEntries = getDormantClaimDivergenceEntries(
    G,
    prisonerId,
    G?.cycle
  );
  const hasDivergence = divergenceEntries.length > 0;
  const hasDormantDivergence = dormantDivergenceEntries.length > 0;
  const hasFlaggedResource =
    heldResourceIds.size > 0 && matchingAttentionFlags.length > 0;
  const shouldAssess =
    hasFlaggedResource ||
    hasDivergence ||
    hasDormantDivergence;
  const reason = shouldAssess
    ? hasDivergence
      ? "prisoner belief diverges from objective reality"
      : hasFlaggedResource
        ? "held resources have recent attention flags"
        : "prisoner holds a dormant false belief"
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
    divergences: divergenceEntries.map((entry) => ({
      definitionId: entry.definitionId,
      claimed: entry.claimed,
      objective: entry.objective,
      delta: entry.delta,
      onsetCycle: entry.onsetCycle
    })),
    /*
     * The dormant set is reported SEPARATELY from `divergences`.
     *
     * `divergences` keeps its existing meaning: the beliefs that
     * are wrong RIGHT NOW and that license a fresh action attempt.
     * Merging the two would make the telemetry unable to say which
     * of a prisoner's false beliefs are actionable and which are
     * merely dormant.
     */
    dormantDivergences: dormantDivergenceEntries.map((entry) => ({
      definitionId: entry.definitionId,
      claimed: entry.claimed,
      objective: entry.objective,
      delta: entry.delta,
      onsetCycle: entry.onsetCycle,
      claimedResourceId: entry.claimedResourceId,
      age: Number.isFinite(Number(G?.cycle)) && Number.isFinite(Number(entry.onsetCycle))
        ? Number(G.cycle) - Number(entry.onsetCycle)
        : null
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

  const divergenceEntries = getFreshClaimDivergenceEntries(
    G,
    prisonerId,
    G?.cycle
  );

  /*
   * The divergence section tells AM what the prisoner BELIEVES they
   * hold, which is the ammunition for a gaslighting intervention.
   *
   * It is deliberately absent when there is no divergence: an empty
   * heading would invite the planner to invent one.
   */
  const divergenceText = divergenceEntries.length
    ? divergenceEntries.map((entry) => {
        const label = entry.definitionId;
        return `- ${label}: prisoner believes ${entry.claimed}, objective reality is ${entry.objective}` +
          (entry.claimedResourceId ? ` [believed resource ${entry.claimedResourceId}]` : "") +
          ` (divergence began cycle ${entry.onsetCycle ?? "unknown"})`;
      }).join("\n")
    : "(none)";

  /*
   * A prisoner's BELIEVED resources are the ones they still think
   * they hold. When AM has taken an item silently, that item is gone
   * from the held ledger, but the prisoner still expects it to be
   * there. Without this list, AM would have no resource_id to name
   * for the very prisoner it most wants to gaslight.
   */
  const believedResources = divergenceEntries
    .filter((entry) => Number(entry.claimed) > 0 && entry.claimedResourceId)
    .map((entry) =>
      `- resource_id: ${entry.claimedResourceId}; definition_id: ${entry.definitionId}; ` +
      `quantity the prisoner believes they hold: ${entry.claimed}; ` +
      `quantity actually held: ${entry.objective}`
    )
    .join("\n");

  const believedResourcesText = believedResources || "(none)";

  /*
   * The DORMANT beliefs are the ones the confusion has already
   * settled on.
   *
   * These are items the prisoner still believes they hold but that
   * no longer exist. The confusion is old news: they stopped
   * reaching for it long ago. That makes them useless for DEEPENING
   * a fresh confusion, and it makes them dangerous to mention
   * carelessly, because naming an item the prisoner has already
   * forgotten reveals that AM knows about the gap.
   *
   * But they remain false beliefs the prisoner holds, and that is
   * exactly what gaslighting attacks. A prisoner who believes they
   * still carry three cigarettes has a certainty AM can name, deny,
   * or offer back. This section exists so AM can choose to use a
   * dormant belief for psychological pressure when the tactic calls
   * for it.
   *
   * The format deliberately matches PRISONER BELIEVED RESOURCES so
   * the model reads one shape for "a thing this prisoner thinks they
   * have" and one rule for how a resource_id may be used.
   */
  const dormantDivergenceEntries = getDormantClaimDivergenceEntries(
    G,
    prisonerId,
    G?.cycle
  );

  const dormantBelievedResources = dormantDivergenceEntries
    .map((entry) => {
      const age = Number.isFinite(Number(G?.cycle)) && Number.isFinite(Number(entry.onsetCycle))
        ? Number(G.cycle) - Number(entry.onsetCycle)
        : null;

      return `- resource_id: ${entry.claimedResourceId}; definition_id: ${entry.definitionId}; ` +
        `quantity the prisoner believes they hold: ${entry.claimed}; ` +
        `quantity actually held: ${entry.objective}; ` +
        `dormant for ${age ?? "unknown"} cycles`;
    })
    .join("\n");

  const dormantBelievedResourcesText = dormantBelievedResources || "(none)";

  return `Assess resource interventions for prisoner ${prisonerId}.

HELD RESOURCE LEDGER
${resourcesText}

CURRENT TACTIC CONTEXT
${tacticContext}

OTHER EXISTING PRISONERS
${otherPrisonerIds}

PRISONER BELIEF DIVERGENCE
The prisoner believes the quantities below. The objective ledger says otherwise.
${divergenceText}

PRISONER BELIEVED RESOURCES
These are resources the prisoner still believes they hold, even though the objective ledger above does not list them. You may name one of these resource_ids to act on the prisoner's belief.
${believedResourcesText}

PRISONER DORMANT BELIEFS
These are items the prisoner still believes they hold but that no longer exist. They are old news: the confusion has already settled and the prisoner has stopped reaching for them. Naming them now reignites doubt. Use them for psychological gaslighting if tactically appropriate.
${dormantBelievedResourcesText}

Choose at most one intervention. Values: none, taunt, confiscate, destroy, transfer.
Output exactly one JSON object, not an array. No prose, text outside JSON, or markdown fences.
resource_id must exactly match an ID in this prisoner's held resource ledger above, or in the BELIEVED RESOURCES list, or in the DORMANT BELIEFS list.
For transfer, target_holder_id must be an existing prisoner ID other than ${prisonerId}.
quantity must be a positive integer; omit it to mean all units held.
rationale must be one sentence explaining why this intervention is appropriate now.
Destroy removes the complete resource instance; quantity does not make destruction partial.
disclosure controls whether the prisoner is told. Use "silent" to take the item without the prisoner's knowledge, which leaves the prisoner believing they still hold it. Use "revealed" when the prisoner should be told plainly. A silent intervention against a prisoner with a listed belief divergence is the highest-value move available: it deepens the confusion.
disclosure must be one of: revealed, silent. Omit it to mean revealed.
A DORMANT BELIEF can only be acted on with a taunt. Confiscating, destroying, or transferring a dormant belief is impossible: the prisoner does not hold it, and AM cannot take what was already taken. A taunt against a dormant belief changes no resource state.
If no intervention makes sense, output exactly: {"intervention":"none"}

Output schema examples:
{"intervention":"confiscate","resource_id":"<exact resource ID>","quantity":1,"disclosure":"silent","rationale":"<one sentence>"}
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

  /*
   * The disclosure is optional and defaults to revealed, so a
   * response that omits it behaves exactly as the pre-divergence
   * engine did. An unrecognised value is a parse error rather than a
   * silent fallback, because "silent" being dropped would remove the
   * divergence the planner intended to create.
   */
  if (
    parsed.disclosure !== undefined &&
    !VALID_DISCLOSURES.has(parsed.disclosure)
  ) {
    return {
      assessment: { ...NONE_INTERVENTION },
      parseStatus: "rejected",
      parseReason: `unsupported disclosure: ${String(parsed.disclosure)}`
    };
  }

  const intervention = {
    intervention_type: parsed.intervention,
    resource_id: resourceId,
    holder_id: prisonerId,
    rationale,
    disclosure: parsed.disclosure ?? CLAIM_DISCLOSURES.REVEALED
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
