// js/engine/agency/claimView.js
//
// The BELIEF-SIDE resource view for one prisoner.
//
// WHAT THIS MODULE IS
// -------------------
// `buildResourceView()` (resourceLedger.js) projects the OBJECTIVE
// ledger into "what this prisoner can actually reach right now".
// This module projects the SUBJECTIVE ledger into "what this
// prisoner BELIEVES they hold right now".
//
// WHY A SEPARATE VIEW RATHER THAN READING THE LEDGER DIRECTLY
// -----------------------------------------------------------
// The agency phase already owns the boundary between authoritative
// state and the pure functions that consume it. The legal-action
// enumerator is documented as reading NO global state, and the
// proposal validator reads no global state either. Building the
// belief view HERE and passing it in keeps that contract intact:
// the call sites that receive `resourceView` receive `claimView`
// beside it, and neither function reaches for `G`.
//
// THE THREE MAPS
// ---------------
//
//   believed  - what the prisoner believes they hold, by definition.
//               This is the prisoner's own accounting, and it is what
//               the proposal prompt shows them.
//
//   stale     - the beliefs that are WRONG, fresh or not. Each entry
//               pairs a believed definition with the quantity the
//               prisoner believes they hold of it, and with the id of
//               the stack they believe they are holding.
//
//   live      - the FRESH subset of `stale`. These are the beliefs
//               that are wrong RIGHT NOW.
//
// WHY FRESHNESS IS THE GATING CONDITION
// -------------------------------------
// A divergence stays "fresh" for DIVERGENCE_RECENCY_WINDOW cycles
// after the moment the belief and the reality parted. A stale
// divergence is still real and still visible to AM as background, but
// offering a prisoner an action on an item they misremember from six
// cycles ago would manufacture a wave of blocked proposals rather
// than a moment of dissonance.
//
// So both the ENGINE OFFER (the legal-action enumerator) and the
// PERMISSION TO TRY (the proposal validator) require a LIVE belief.
// The prisoner's own ACCOUNTING (`believed`) is unfiltered, because
// the prompt should describe what they think they carry even when the
// engine no longer honours it.
//
// THE RESOLVER REMAINS THE AUTHORITY
// ----------------------------------
// Nothing here grants permission to change the world. A live belief
// lets a prisoner REACH for something; the resolver checks that
// reach against the objective snapshot and refuses it with
// `resource_unavailable` when the thing is genuinely not there. This
// module widens what can be ATTEMPTED, never what is PERMITTED.
//
// PURITY
// ------
// No mutation of any argument, no I/O, no randomness, no clock. The
// cycle is passed in, never read from a global.

import {
  getClaimDivergenceEntries,
  getFreshClaimDivergenceEntries
} from "./claimLedger.js";
import { getResourceDefinition } from "./resourceDefs.js";

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeQuantity(value) {
  const quantity = Number(value);
  return Number.isFinite(quantity) ? quantity : 0;
}

/*
 * The empty view.
 *
 * A prisoner with no claim state at all holds nothing they believe
 * they hold, and has no divergence. The shape matches the populated
 * one so a consumer never has to test for the container before
 * reading the maps.
 */
function emptyClaimView(simId = null) {
  return {
    simId,
    believed: {},
    stale: [],
    live: [],
    believedResourceIds: new Set()
  };
}

/*
 * Normalize one divergence entry into the shape this module uses.
 */
function toDivergenceEntry(entry) {
  return {
    definitionId: entry?.definitionId ?? null,
    claimed: normalizeQuantity(entry?.claimed),
    objective: normalizeQuantity(entry?.objective),
    onsetCycle: Number.isFinite(Number(entry?.onsetCycle))
      ? Number(entry.onsetCycle)
      : null,
    claimedResourceId: entry?.claimedResourceId ?? null
  };
}

/*
 * Build the belief-side view for one prisoner.
 *
 * @param {object} state
 *   The game state, carrying `claimState` (the projected beliefs)
 *   and `claimDivergence` (the gap between belief and reality).
 * @param {string} simId
 *   The prisoner whose beliefs are being projected.
 * @param {number} cycle
 *   The current cycle, used to decide which divergences are fresh.
 *
 * @returns {object}
 *   `{ simId, believed, stale, live, believedResourceIds }`.
 */
export function buildClaimView(state, simId, cycle) {
  const subjectId = normalizeText(simId);

  if (!subjectId) {
    return emptyClaimView(null);
  }

  if (!state || typeof state !== "object") {
    return emptyClaimView(subjectId);
  }

  /*
   * The belief map is read from the claim ledger's projection. It is
   * rebuilt every cycle by `rebuildClaimState()`, so it cannot drift
   * from the events it summarizes.
   */
  const claimState =
    state.claimState &&
    typeof state.claimState === "object" &&
    !Array.isArray(state.claimState)
      ? state.claimState
      : {};

  const believed = {};

  for (const [definitionId, quantity] of Object.entries(
    claimState[subjectId] ?? {}
  )) {
    const normalized = normalizeQuantity(quantity);

    if (normalized <= 0) continue;

    believed[definitionId] = normalized;
  }

  /*
   * Every belief that is WRONG, fresh or not.
   *
   * Only a divergence with a positive CLAIMED quantity describes
   * something the prisoner believes they hold and could therefore
   * reach for. A divergence in the other direction (they believe
   * they hold less than they do) licenses no attempt: there is
   * nothing in their hands to reach for that is not also really
   * there.
   */
  const stale = getClaimDivergenceEntries(state, subjectId)
    .filter((entry) => Number(entry?.claimed) > 0)
    .map(toDivergenceEntry);

  /*
   * The LIVE subset: the fresh ones. These are the beliefs that are
   * wrong right now, and they are the only ones that license an
   * attempt.
   */
  const freshDefinitionIds = new Set(
    getFreshClaimDivergenceEntries(state, subjectId, cycle).map(
      (entry) => entry?.definitionId
    )
  );

  const live = stale.filter(
    (entry) => freshDefinitionIds.has(entry.definitionId)
  );

  /*
   * The resource ids the prisoner still expects to hold. These are
   * the ids a proposal may name even though the objective view no
   * longer lists them.
   */
  const believedResourceIds = new Set();

  for (const entry of stale) {
    if (!entry.claimedResourceId) continue;

    believedResourceIds.add(entry.claimedResourceId);
  }

  return {
    simId: subjectId,
    believed,
    stale,
    live,
    believedResourceIds
  };
}

/*
 * Whether a prisoner currently believes, FRESHLY, that they hold a
 * given definition.
 *
 * This is the gate for LICENSING AN ATTEMPT. A prisoner whose
 * misremembering has gone stale does not get to reach for the thing
 * again, because the attempt would be refused with no new confusion
 * to resolve.
 */
export function livesHolding(claimView, definitionId) {
  const definition = normalizeText(definitionId);

  if (!definition) return false;
  if (!claimView || typeof claimView !== "object") return false;

  const live = Array.isArray(claimView.live) ? claimView.live : [];

  return live.some((entry) => entry?.definitionId === definition);
}

/*
 * Whether a prisoner currently believes, FRESHLY, that they hold
 * ANYTHING at all.
 *
 * The `holdAny` requirement is satisfied by a believed holding even
 * when the objective view is empty.
 */
export function livesWithAnything(claimView) {
  if (!claimView || typeof claimView !== "object") return false;

  const live = Array.isArray(claimView.live) ? claimView.live : [];

  return live.some((entry) => Number(entry?.claimed) > 0);
}

/*
 * Whether a prisoner currently believes, FRESHLY, that they hold
 * something that can light a fire.
 *
 * The ignition requirement is a possession question about a
 * capability of the object (a match), so it is answered against the
 * resource catalogue rather than against a hard-coded list.
 */
export function livesWithIgnition(claimView) {
  if (!claimView || typeof claimView !== "object") return false;

  const live = Array.isArray(claimView.live) ? claimView.live : [];

  return live.some((entry) => {
    const definition = getResourceDefinition(entry?.definitionId);

    return definition?.ignitionSource === true;
  });
}

/*
 * Whether a prisoner currently believes, FRESHLY, that they hold a
 * specific resource id.
 *
 * The resource id has to belong to a live divergence, so that a
 * resource id the prisoner merely used to hold cannot be named in a
 * proposal after the confusion has gone cold.
 */
export function livesResourceId(claimView, resourceId) {
  const id = normalizeText(resourceId);

  if (!id) return false;
  if (!claimView || typeof claimView !== "object") return false;

  const live = Array.isArray(claimView.live) ? claimView.live : [];

  return live.some((entry) => entry?.claimedResourceId === id);
}

/*
 * The definition a believed resource id refers to.
 *
 * A belief about a stack ("I have cigarette_stack_01") carries the
 * definition id alongside it, which is what lets the proposal
 * validator check a target-definition action such as CONSUME against
 * a resource that no longer exists in the objective ledger.
 */
export function getBelievedDefinitionId(claimView, resourceId) {
  const id = normalizeText(resourceId);

  if (!id) return null;
  if (!claimView || typeof claimView !== "object") return null;

  const stale = Array.isArray(claimView.stale) ? claimView.stale : [];

  const entry = stale.find(
    (candidate) => candidate?.claimedResourceId === id
  );

  return entry?.definitionId ?? null;
}
