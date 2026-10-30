// js/engine/agency/capabilityConcealmentRule.js
//
// Milestone 2: Capability-Ledger Entanglement.
//
// WHAT THIS MODULE IS
// -------------------
// A deterministic engine rule that connects two systems that were
// previously independent:
//
//   1. PHYSICAL CAPABILITY  - what a prisoner's body can do, derived
//      from their restraints (js/engine/agency/capabilities.js).
//   2. THE OBJECTIVE LEDGER - what each prisoner holds and whether
//      it is concealed (js/engine/agency/resourceLedger.js).
//
// Before this rule, a prisoner's hands could be broken and their
// hidden cigarette would stay hidden forever. Concealment was a
// static property of an item. Now concealment is a CONSEQUENCE of
// the body: a prisoner whose hands no longer work cannot keep
// something hidden, and the engine enforces that.
//
// THE FEEDBACK LOOP
// -----------------
// This is the point of the rule. It closes a loop that the simulation
// previously had open:
//
//   torture -> capability loss -> concealment fails -> item exposed
//           -> AM's attention roll sees it -> AM confiscates it
//           -> material loss
//
// Without this link, physical degradation cost only psychological
// suffering. With it, degradation costs MATERIALS. Torture becomes
// materially expensive for the prisoner, which is the whole point.
//
// The loop is also self-consistent with the action catalogue: HIDE
// requires `handUse >= 0.3`, and a `severely_impaired` hand is below
// 0.4. A prisoner whose hands have failed therefore cannot re-hide
// what the engine has exposed, while a prisoner who is merely
// `impaired` can. The rule does not need a second gate to stay
// closed; the existing capability gate already does that work.
//
// ONE CYCLE OF LATENCY
// --------------------
// The rule evaluates the capability state as it stood at the END of
// the PREVIOUS cycle, not the capabilities derived in the current
// cycle. The previous cycle's capability state is reconstructed from
// `G.prevCycleSnapshot`, which `beginCycle()` captures BEFORE the
// current cycle's strategy phase applies any new restraint; running
// `deriveCapabilities()` over that snapshot reproduces the previous
// cycle's derivation exactly.
//
// A restraint applied by AM in cycle N therefore costs the prisoner
// their concealment at the start of cycle N+1, not in the same
// instant the restraint lands. This is the physically honest
// ordering: a body does not stop working the instant a strap is
// tightened, and the failure to conceal is a consequence that
// follows the restraint rather than coinciding with it.
//
// OWNERSHIP SPLIT INSIDE THIS MODULE
// ----------------------------------
// Two exports with deliberately different contracts:
//
//   evaluateConcealmentExposure()  PURE. Reads, never writes.
//   commitConcealmentExposures()   OWNS the mutation and the two
//                                  records it produces.
//
// The split mirrors resourceLedger.js, which likewise holds a pure
// projection (`buildResourceView`) beside a mutating one
// (`maintainResourceDrying`). The evaluator is the part that can be
// unit tested without any state at all; the committer is the part
// that knows about the authoritative ledger.
//
// WHY A SEPARATE BAND CHECK RATHER THAN A NUMERIC THRESHOLD
// ----------------------------------------------------------
// The rule is stated in terms of the DISCRETE BANDS that
// capabilities.js already publishes (`severely_impaired`,
// `unavailable`), not in terms of raw floats. Two reasons:
//
//   1. The band is the vocabulary the rest of the engine reasons
//      about. A refusal is reported as "severely impaired", so an
//      exposure should be attributable to the same label.
//   2. A numeric threshold would duplicate the band boundaries in a
//      second place, and the two could drift. Reading the band keeps
//      the band ladder as the single source of truth.
//
// A missing or unrecognised band is treated as NOT failing. The
// capability deriver always emits all five keys, so absence means a
// malformed input; failing open here means a broken input cannot
// silently strip every prisoner's inventory of concealment.

import {
  recordResourceEvent,
  RESOURCE_EVENT_KINDS
} from "./resourceEventLog.js";

import { refreshClaimDivergence } from "./claimLedger.js";

import { getResourceDefinition } from "./resourceDefs.js";

import { appendAttentionFlag } from "./attentionFlags.js";

/* ============================================================
   FAILURE BANDS
============================================================ */

/*
 * The two capability bands that make concealment impossible.
 *
 * `severely_impaired` means the body still functions but cannot
 * perform the fine, sustained, secret motor task of hiding an item
 * from a room full of observers. `unavailable` means the capability
 * is gone entirely.
 *
 * `handUse` is the obvious driver. `stability` is included because
 * a prisoner whose balance and core stability have collapsed cannot
 * hold something still against their body while also concealing it;
 * the concealment fails for a different reason but the outcome is
 * the same.
 */
const CONCEALMENT_FAILING_BANDS = new Set([
  "severely_impaired",
  "unavailable"
]);

/*
 * The capabilities the rule inspects, in a FIXED order.
 *
 * The order is fixed because the reported `reason` names the first
 * failing capability. A fixed order makes that name deterministic
 * rather than dependent on object key insertion order.
 */
const CONCEALMENT_CAPABILITY_KEYS = Object.freeze([
  "handUse",
  "stability"
]);

/* ============================================================
   INTERNALS
============================================================ */

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

/*
 * Read one band out of a capability envelope.
 *
 * The envelope is the object `deriveCapabilities()` returns:
 * `{ capabilities, bands, activeConstraintIds, provenance }`.
 * The `bands` map is preferred; the numeric `capabilities` map is
 * NOT consulted, because band membership is the rule's vocabulary.
 *
 * Returns null when the band is absent or not a string, which the
 * caller treats as "not failing".
 */
function readBand(capabilities, key) {
  const bands =
    capabilities &&
    typeof capabilities === "object" &&
    !Array.isArray(capabilities)
      ? capabilities.bands
      : null;

  if (!bands || typeof bands !== "object" || Array.isArray(bands)) {
    return null;
  }

  const band = bands[key];

  return typeof band === "string" ? band : null;
}

/*
 * The first capability key whose band prevents concealment, or null.
 */
function findFailingCapability(capabilities) {
  for (const key of CONCEALMENT_CAPABILITY_KEYS) {
    const band = readBand(capabilities, key);

    if (band && CONCEALMENT_FAILING_BANDS.has(band)) {
      return key;
    }
  }

  return null;
}

/*
 * A stable, human-readable reason string.
 *
 * The reason is a stable token sequence rather than prose so that it
 * can be compared in tests and rendered in a prompt without the
 * renderer having to re-derive the meaning.
 */
function buildReason(failingKey, band) {
  return `capability_degradation:${failingKey}:${band}`;
}

/*
 * The resource label a human-facing renderer should use.
 */
function resolveDefinitionTitle(definitionId) {
  const definition = getResourceDefinition(definitionId);

  return normalizeText(definition?.title) ||
    normalizeText(definitionId) ||
    "resource";
}

/* ============================================================
   PURE EVALUATION
============================================================ */

/**
 * Evaluate whether any of a prisoner's concealed holdings must be
 * exposed because their body can no longer conceal them.
 *
 * @param {Object} sim              The prisoner. Only `sim.id` is read.
 * @param {Object} capabilities     The deriveCapabilities() envelope.
 * @param {Array}  heldResources    Resource instances to consider.
 *                                  Entries not held by `sim.id` are
 *                                  ignored, so the caller may pass
 *                                  the whole ledger.
 * @returns {Array<{resourceId: string, definitionId: string, reason: string}>}
 *          A NEW array of plain objects, one per item that must be
 *          exposed. Empty when nothing fails the capability check.
 *
 * DETERMINISM
 * -----------
 * The result is sorted by `resourceId` using a plain code-unit
 * comparison, so two runs over the same state produce the same
 * order regardless of how the instances were inserted.
 *
 * IDEMPOTENCE
 * -----------
 * Only items that are CURRENTLY concealed are considered. Once an
 * item has been exposed, it is no longer concealed, so a second
 * evaluation returns nothing for it. The caller may therefore run
 * this rule as many times per cycle as it likes without
 * double-exposing anything.
 */
export function evaluateConcealmentExposure(
  sim,
  capabilities,
  heldResources
) {
  const simId = normalizeText(sim?.id);

  if (!simId) {
    return [];
  }

  const instances = Array.isArray(heldResources)
    ? heldResources
    : [];

  const failingKey = findFailingCapability(capabilities);

  if (!failingKey) {
    return [];
  }

  const band = readBand(capabilities, failingKey);

  const exposures = [];

  for (const instance of instances) {
    if (!instance || typeof instance !== "object") {
      continue;
    }

    /*
     * Only the prisoner's OWN holdings are candidates. Concealment
     * is a property of what someone is hiding; another prisoner's
     * stack is not this prisoner's to expose.
     */
    if (instance.holderId !== simId) {
      continue;
    }

    /*
     * An already-exposed item is not re-exposed. This is what
     * makes the rule idempotent.
     */
    if (instance.concealed !== true) {
      continue;
    }

    exposures.push({
      resourceId: normalizeText(instance.resourceId),
      definitionId: normalizeText(instance.definitionId),
      reason: buildReason(failingKey, band)
    });
  }

  exposures.sort((left, right) => {
    if (left.resourceId < right.resourceId) return -1;
    if (left.resourceId > right.resourceId) return 1;
    return 0;
  });

  return exposures;
}

/* ============================================================
   COMMIT
============================================================ */

/*
 * The pending-evidence channel the exposure record is written to.
 *
 * This is a SEPARATE channel from `resourceInterventions` rather
 * than a new `interventionType` inside it. The intervention channel
 * carries AM's deliberate acts, and every consumer of it branches on
 * `interventionType` (taunt / confiscate / destroy / transfer). An
 * exposure is not an act by AM: it is the engine enforcing a
 * physical consequence. Merging the two would make the ledger's
 * history of who-did-what ambiguous.
 */
const EXPOSURE_EVIDENCE_CHANNEL = "exposures";

/*
 * Make sure the pending-evidence map exists and has the exposure
 * channel in it.
 */
function ensureExposureEvidence(G) {
  if (!G.pendingEvidence || typeof G.pendingEvidence !== "object") {
    G.pendingEvidence = {};
  }

  if (
    !G.pendingEvidence[EXPOSURE_EVIDENCE_CHANNEL] ||
    typeof G.pendingEvidence[EXPOSURE_EVIDENCE_CHANNEL] !== "object"
  ) {
    G.pendingEvidence[EXPOSURE_EVIDENCE_CHANNEL] = Object.create(null);
  }

  return G.pendingEvidence[EXPOSURE_EVIDENCE_CHANNEL];
}

/**
 * Expose the items the capability rule condemns, record the change
 * in the Objective Ledger, and tell the prisoner about it.
 *
 * @param {Object} G                The authoritative game state.
 * @param {Object} sim              The prisoner.
 * @param {Object} capabilities     The deriveCapabilities() envelope.
 * @param {Array}  heldResources    Resource instances to consider.
 * @returns {Array} The exposure records that were written. Empty when
 *          nothing was exposed.
 *
 * ORDER OF OPERATIONS
 * -------------------
 * The ledger MUTATION happens first and the event is recorded after
 * it, exactly as everywhere else in this subsystem. Recording is
 * strictly an observation: it must never be able to block or alter
 * the mutation it describes.
 *
 * The pending-evidence record is written after the event, because the
 * evidence describes a mutation that has already happened.
 *
 * IDEMPOTENCE
 * -----------
 * The evaluator only returns items that are currently concealed, and
 * the mutation sets `concealed` to false. A second call over the
 * same state therefore exposes nothing, records no second event, and
 * appends no second evidence record.
 */
export function commitConcealmentExposures(
  G,
  sim,
  capabilities,
  heldResources
) {
  if (!G || typeof G !== "object") {
    return [];
  }

  const simId = normalizeText(sim?.id);

  if (!simId) {
    return [];
  }

  const instances = Array.isArray(heldResources)
    ? heldResources
    : Array.isArray(G.resources?.instances)
      ? G.resources.instances
      : [];

  const condemned = evaluateConcealmentExposure(
    sim,
    capabilities,
    instances
  );

  if (condemned.length === 0) {
    return [];
  }

  const ledger = Array.isArray(G.resources?.instances)
    ? G.resources.instances
    : [];

  const cycle = Number.isFinite(Number(G.cycle))
    ? Number(G.cycle)
    : 0;

  const records = [];

  for (const exposure of condemned) {
    const instance = ledger.find(
      (candidate) =>
        candidate?.resourceId === exposure.resourceId
    );

    if (!instance) {
      continue;
    }

    /*
     * Re-check concealment at the mutation site. The evaluator and
     * the mutation are adjacent, but a caller that evaluates one
     * list and commits against another must not be able to expose
     * an item that is already open.
     */
    if (instance.concealed !== true) {
      continue;
    }

    const quantity = Number(instance.quantity);
    const holderId = instance.holderId ?? null;

    instance.concealed = false;

    /*
     * The provenance records THAT the item is now exposed and WHY.
     * The previous provenance fields are preserved so the history of
     * how the item was acquired is not destroyed by the fact that it
     * was later exposed.
     */
    instance.provenance = {
      ...(instance.provenance ?? {}),
      source: "exposure",
      cause: "capability_degradation",
      cycle
    };

    /*
     * The Objective Ledger records the exposure. The quantity does
     * not move: the stack is unchanged and still held by the same
     * prisoner. What changed is who can SEE it, which is what
     * cause.action names.
     */
    recordResourceEvent(G, {
      kind: RESOURCE_EVENT_KINDS.EXPOSURE,
      cycle,
      resourceId: instance.resourceId,
      definitionId: instance.definitionId,
      quantityBefore: quantity,
      quantityAfter: quantity,
      fromHolderId: holderId,
      toHolderId: holderId,
      actorId: "ENGINE",
      cause: {
        phase: "agency_phase",
        action: "EXPOSED",
        source: "capability_degradation"
      }
    });

    const reasonParts = normalizeText(exposure.reason).split(":");

    records.push({
      cycle,
      prisonerId: simId,
      resourceId: instance.resourceId,
      definitionId: instance.definitionId,
      definitionTitle: resolveDefinitionTitle(instance.definitionId),
      quantity,
      reason: exposure.reason,
      cause: "capability_degradation",
      capabilityKey: reasonParts[1] ?? null,
      band: reasonParts[2] ?? null
    });

    /*
     * THE ATTENTION FLAG
     * -------------------
     * The exposure makes the item VISIBLE. AM can see the item in
     * its material-state prompt, but "AM can see it" and "AM may
     * act on it" are different questions: the resource-intervention
     * assessment gate only opens for a held resource that carries
     * a recent attention flag.
     *
     * Without this flag, an exposed item would sit in AM's prompt
     * and be inactionable. The feedback loop this rule exists to
     * close would stop one step short:
     *
     *   torture -> capability loss -> concealment fails -> item
     *   exposed -> AM SEES it but may not ASSESS it.
     *
     * The flag is raised through the SAME pending channel the
     * attention roll writes to, so it reaches the recent channel
     * through the normal cycle handoff and needs no second path.
     *
     * It is deterministic: no randomness is consumed, and the
     * exposure itself is deterministic.
     *
     * `actorId` is the HOLDER, not the engine. The flag describes
     * whose holdings AM should look at, which is the same meaning
     * the attention roll gives the field.
     *
     * ORDERING
     * --------
     * The flag is raised only after the exposure decision is final:
     * the Objective Ledger has already recorded the EXPOSURE event,
     * the instance is already marked unconcealed, and the local
     * record has already been appended to `records`. The record
     * array and the flag are part of the SAME commit batch, so the
     * flag never describes an exposure the engine might not commit.
     */
    appendAttentionFlag(G, {
      cycle,
      actorId: holderId,
      resourceId: instance.resourceId,
      definitionId: instance.definitionId,
      source: RESOURCE_EVENT_KINDS.EXPOSURE
    });
  }

  if (records.length === 0) {
    return [];
  }

  /*
   * An exposure changes who can SEE an item, not what anyone holds.
   * The claim ledger tracks quantity only, so no claim event is
   * written here - but the divergence is refreshed so the derived
   * view cannot fall behind the reality it is measured against.
   */
  refreshClaimDivergence(G);

  /*
   * The prisoner learns about the exposure in their NEXT scratchpad
   * review. The record is appended to whatever the channel already
   * holds, because the channel may be carrying exposures forward
   * from the previous cycle that have not been reviewed yet.
   */
  const channel = ensureExposureEvidence(G);
  const existing = Array.isArray(channel[simId])
    ? channel[simId]
    : [];

  channel[simId] = [...existing, ...records];

  console.debug(
    `[AGENCY][${simId}] ${records.length} concealed resource(s) exposed by capability degradation`
  );

  return records;
}

/*
 * The bands that defeat concealment, exported for the phase and the
 * tests to reference rather than re-declaring the list.
 */
export const CONCEALMENT_FAILURE_BANDS = Object.freeze(
  [...CONCEALMENT_FAILING_BANDS]
);

/*
 * The capability keys the rule inspects, exported for the same
 * reason.
 */
export const CONCEALMENT_CAPABILITIES = CONCEALMENT_CAPABILITY_KEYS;

/*
 * The pending-evidence channel name, exported so the state schema,
 * the reset helper, and the scratchpad reader all name the same
 * channel rather than each spelling their own string.
 */
export const EXPOSURE_EVIDENCE_KEY = EXPOSURE_EVIDENCE_CHANNEL;
