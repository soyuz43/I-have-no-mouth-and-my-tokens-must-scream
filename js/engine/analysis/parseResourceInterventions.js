import { getResourceDefinition } from "../agency/resourceDefs.js";
import { validateResourceIntervention } from "./resourceInterventions.js";

const OPEN_MARKER = "[RESOURCE INTERVENTIONS]";
const CLOSE_MARKER = "[/RESOURCE INTERVENTIONS]";

export function splitAMExecutionOutput(responseText) {
  const text = String(responseText ?? "").replace(/\r/g, "");
  const openingMatches = [...text.matchAll(/\[RESOURCE INTERVENTIONS\]/gi)];

  if (openingMatches.length === 0) {
    return {
      executionText: text,
      interventionSection: null,
      sectionError: null
    };
  }

  if (openingMatches.length !== 1) {
    return {
      executionText: text.slice(0, openingMatches[0].index),
      interventionSection: null,
      sectionError: "Expected exactly one resource intervention section."
    };
  }

  const openingIndex = openingMatches[0].index;
  const contentStart = openingIndex + OPEN_MARKER.length;
  const closingIndex = text.indexOf(CLOSE_MARKER, contentStart);

  if (closingIndex < 0) {
    return {
      executionText: text.slice(0, openingIndex),
      interventionSection: null,
      sectionError: "Resource intervention section is missing its closing marker."
    };
  }

  if (text.toLowerCase().indexOf(CLOSE_MARKER.toLowerCase(), closingIndex + CLOSE_MARKER.length) >= 0) {
    return {
      executionText: text.slice(0, openingIndex),
      interventionSection: null,
      sectionError: "Expected exactly one resource intervention section."
    };
  }

  return {
    executionText: text.slice(0, openingIndex).trimEnd(),
    interventionSection: text.slice(contentStart, closingIndex).trim(),
    sectionError: null
  };
}

function parseInterventionArray(sectionText) {
  const trimmed = String(sectionText ?? "").trim();
  if (!trimmed || trimmed === "[]") return [];

  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  const parsed = JSON.parse(unfenced);
  const interventions = Array.isArray(parsed)
    ? parsed
    : parsed?.interventions;

  if (!Array.isArray(interventions)) {
    throw new TypeError("Resource interventions must be a JSON array.");
  }

  return interventions;
}

function hasTargetDialogue(actions, targetId) {
  return typeof actions?.[targetId]?.text === "string";
}

function dialogueReferencesResource(actionText, resource) {
  const text = String(actionText ?? "").toLowerCase();
  const definition = getResourceDefinition(resource.definitionId);
  const references = [
    resource.resourceId,
    resource.definitionId?.replace(/_/g, " "),
    definition?.title
  ].filter((value) => typeof value === "string" && value.trim());

  return references.some((reference) =>
    text.includes(reference.toLowerCase())
  );
}

function getTacticPath(intervention, context) {
  const targetId =
    intervention.target_id ??
    intervention.holder_id ??
    intervention.target_holder_id;

  return (
    context.tacticAssignmentsByTarget?.[targetId]?.tactic?.path ??
    context.tacticAssignmentsByTarget?.[targetId]?.path ??
    context.amTacticRuntime?.targets?.[targetId]?.path ??
    context.amStrategy?.targets?.[targetId]?.tactic_path ??
    null
  );
}

export function parseResourceInterventions(sectionText, context = {}) {
  const interventions = [];
  const rejections = [];

  if (context.sectionError) {
    return {
      interventions,
      rejections: [{ index: 0, reason: context.sectionError }]
    };
  }

  if (sectionText === null || sectionText === undefined) {
    return { interventions, rejections };
  }

  let candidates;
  try {
    candidates = parseInterventionArray(sectionText);
  } catch (error) {
    return {
      interventions,
      rejections: [{
        index: 0,
        reason: `Could not parse resource intervention JSON: ${error.message}`
      }]
    };
  }

  for (const [index, candidate] of candidates.entries()) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      rejections.push({ index, reason: "Each intervention must be a JSON object." });
      continue;
    }

    if (typeof candidate.rationale !== "string" || !candidate.rationale.trim()) {
      rejections.push({ index, reason: "rationale must be a non-empty string." });
      continue;
    }

    const validation = validateResourceIntervention(candidate, context);
    if (!validation.valid) {
      rejections.push({ index, reason: validation.reason });
      continue;
    }

    if (
      candidate.intervention_type === "taunt" &&
      !hasTargetDialogue(context.actions, candidate.target_id)
    ) {
      rejections.push({
        index,
        reason: `Taunt target ${candidate.target_id} has no accepted execution dialogue.`
      });
      continue;
    }

    const resource = validation.resource;
    if (
      candidate.intervention_type === "taunt" &&
      !dialogueReferencesResource(
        context.actions[candidate.target_id].text,
        resource
      )
    ) {
      rejections.push({
        index,
        reason: `Accepted dialogue for ${candidate.target_id} does not reference resource ${resource.resourceId}.`
      });
      continue;
    }

    const intervention = {
      ...validation.intervention,
      provenance: {
        cycle: Number.isSafeInteger(context.cycle) ? context.cycle : null,
        tacticPath: getTacticPath(candidate, context),
        rationale: candidate.rationale.trim()
      },
      definitionTitle:
        getResourceDefinition(resource.definitionId)?.title ??
        resource.definitionId ??
        resource.resourceId
    };

    interventions.push(intervention);
  }

  return { interventions, rejections };
}
