// js/engine/agency/claimLedger.js
//
// The Subjective Ledger: what each prisoner BELIEVES they hold.
//
// WHAT THIS MODULE IS
// -------------------
// The Objective Ledger (js/engine/agency/resourceEventLog.js) records
// what actually exists and who moved it. It has no notion of what a
// prisoner THINKS exists. This module supplies that second half: a
// parallel, append-only history of a prisoner's own relationship with
// their own resources.
//
// WHY A SECOND LEDGER RATHER THAN A COLUMN ON THE FIRST
// -----------------------------------------------------
// The two ledgers answer different questions and can legitimately
// disagree. The objective ledger says "the cigarette is in AM's
// hand". The subjective ledger says "TED still believes the cigarette
// is in his pocket". A column on the objective ledger could only ever
// hold the truth, and the truth is not the interesting part. The
// interesting part is the gap between the two.
//
// DERIVATION, NOT NARRATION
// -------------------------
// Every claim event is DERIVED from a recorded objective action. No
// claim event is ever written from prose, from an LLM output, or from
// a prisoner's free-text reasoning. The projector rule is:
//
//   A prisoner's belief about a resource changes when
//     - THEY act on it         (own_action)
//     - THEY receive it        (received)
//     - THEY are told about it (informed)
//     - it is seeded to them   (seed)
//     - its definition changes (definition_change)
//     - THEY reach for it and
//       find nothing there     (belief_corrected)
//
//   and does NOT change when something happens to them that they are
//   not told about (silent).
//
// A silent event is written with a delta of zero. That is the whole
// point: the absence of a belief update IS the divergence.
//
// `belief_corrected` is the RESOLUTION of a divergence. A silent
// intervention leaves a belief wrong; a refused attempt on that
// believed-but-absent resource is the prisoner learning their memory
// was wrong, and the belief moves to match the reality. It is still
// derived from a recorded objective event (the attempt), never from
// prose, so the determinism invariant is preserved.
//
// DETERMINISM
// -----------
// No clock, no randomness, no floating-point accumulation. Quantities
// are integers. Every field is a pure function of the recorded
// objective events.
//
// SCOPE
// -----
// This module writes the claim ledger and derives the divergence. It
// never mutates the authoritative resource ledger, never gates an
// action, and never reads a belief.

import { SIM_IDS } from "../../core/constants.js";
import { RESOURCE_EVENT_KINDS } from "./resourceEventLog.js";

/* ============================================================
   CLAIM EVENT KINDS
============================================================ */

/*
 * The closed set of subjective-ledger event kinds.
 *
 * Every kind names WHY a prisoner's belief moved (or did not move).
 * `silent` is the only kind whose delta is normally zero: it records
 * that reality moved and the prisoner's belief did not.
 */
export const CLAIM_EVENT_KINDS = Object.freeze({
  SEED: "seed",
  OWN_ACTION: "own_action",
  RECEIVED: "received",
  INFORMED: "informed",
  SILENT: "silent",
  DEFINITION_CHANGE: "definition_change",
  BELIEF_CORRECTED: "belief_corrected"
});

const VALID_CLAIM_KINDS = new Set(Object.values(CLAIM_EVENT_KINDS));

/* ============================================================
   DISCLOSURE
============================================================ */

/*
 * Whether an action was disclosed to the people it affected.
 *
 * `revealed` is the default and preserves the behaviour that already
 * exists: the victim of an AM intervention is told what happened.
 *
 * `silent` is the load-bearing option. It is the only way a
 * persistent quantity divergence can arise: AM takes the item and the
 * prisoner's belief is never updated, so the belief and the reality
 * drift apart and stay apart.
 */
export const CLAIM_DISCLOSURES = Object.freeze({
  REVEALED: "revealed",
  SILENT: "silent"
});

const VALID_DISCLOSURES = new Set(Object.values(CLAIM_DISCLOSURES));

/* ============================================================
   RECENCY
============================================================ */

/*
 * How many cycles a divergence stays "fresh".
 *
 * A fresh divergence is one the engine will actively surface: it
 * opens AM's assessment gate and it appears in the prisoner's own
 * scratchpad. A stale divergence is still recorded and still visible
 * to AM as background, but it is no longer worth a model call and no
 * longer worth interrupting the prisoner for.
 *
 * Three cycles is long enough for the prisoner to have reacted to the
 * confusion and short enough that the confusion is still news.
 */
export const DIVERGENCE_RECENCY_WINDOW = 3;

/* ============================================================
   DIVERGENCE LIFECYCLE KINDS
============================================================ */

/*
 * The closed set of divergence lifecycle transitions.
 *
 * `onset`   the belief and the reality parted company. A new
 *           divergence entered the active set.
 * `resolved` the belief caught up with the reality. The divergence
 *           left the active set because nothing was wrong any more.
 *
 * The two kinds are the two ways a divergence can stop being active.
 * A divergence that simply gets old is NOT a transition: it stays in
 * the active set, it just stops being fresh. Staleness is a property
 * of the age, not an event, so it is measured rather than recorded.
 *
 * A CORRECTION and a RESOLUTION are the same thing viewed from two
 * sides: the belief moved onto the reality. `resolved` is named
 * because that is what the divergence did, and because the ledger
 * does not claim to know WHY the belief moved. A belief correction
 * is the usual cause, but a silent intervention that happens to
 * restore the quantity would look identical from here.
 *
 * SAVE COMPATIBILITY
 * ------------------
 * The lifecycle log is new. A save written before this module
 * existed carries no `divergenceEvents`, so the log starts empty
 * when that save is loaded. The divergence VIEW is unaffected: it is
 * still rebuilt from the claim ledger, and the onsets it carries are
 * still correct. What a pre-lifecycle save loses is the run-wide
 * ONSET and RESOLUTION TOTALS for the cycles that happened before
 * the load, because those totals are counted from the log rather
 * than reconstructed from the ledger.
 */
export const DIVERGENCE_LIFECYCLE_KINDS = Object.freeze({
  ONSET: "onset",
  RESOLVED: "resolved"
});

const VALID_LIFECYCLE_KINDS = new Set(
  Object.values(DIVERGENCE_LIFECYCLE_KINDS)
);

/* ============================================================
   NORMALIZATION
============================================================ */

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeId(value) {
  const text = normalizeText(value);
  return text.length > 0 ? text : null;
}

function normalizeQuantity(value) {
  const quantity = Number(value);
  return Number.isFinite(quantity) ? quantity : 0;
}

/*
 * AM is a holder, not a prisoner. AM never holds a belief, so a
 * claim event about AM is meaningless.
 *
 * A sim id is accepted as well as the static roster, so a test or a
 * future scenario that introduces a prisoner is not silently
 * excluded from the ledger.
 */
function isPrisonerId(state, id) {
  const normalized = normalizeId(id);

  if (!normalized || normalized === "AM") return false;
  if (SIM_IDS.includes(normalized)) return true;

  return Boolean(
    state &&
    state.sims &&
    typeof state.sims === "object" &&
    Object.hasOwn(state.sims, normalized)
  );
}

/* ============================================================
   SEQUENCE
============================================================ */

/*
 * The per-cycle sequence counter.
 *
 * Stored on the game state rather than in module scope so a
 * save/load round-trip cannot reissue a claim event id. It restarts
 * at 1 for each cycle, exactly like the objective ledger's counter.
 */
function ensureClaimEventSequence(state) {
  const current = state?.claimEventSequence;

  if (
    !current ||
    typeof current !== "object" ||
    Array.isArray(current)
  ) {
    state.claimEventSequence = {
      cycle: null,
      next: 1
    };

    return state.claimEventSequence;
  }

  return current;
}

function nextSequence(state, cycle) {
  const sequence = ensureClaimEventSequence(state);

  const storedCycle = Number.isFinite(Number(sequence.cycle))
    ? Number(sequence.cycle)
    : null;

  /*
   * A cycle ADVANCE restarts the counter. A retroactive write to an
   * EARLIER cycle keeps advancing it, so an id is never reissued.
   */
  if (storedCycle === null || cycle > storedCycle) {
    sequence.cycle = cycle;
    sequence.next = 1;
  }

  const value =
    Number.isSafeInteger(sequence.next) && sequence.next > 0
      ? sequence.next
      : 1;

  sequence.next = value + 1;

  return value;
}

/* ============================================================
   DIVERGENCE LIFECYCLE SEQUENCE
============================================================ */

/*
 * The per-cycle sequence counter backing divergence event ids.
 *
 * It lives on the state, exactly like the claim and goal event
 * counters, so a save/load round-trip cannot reissue an id. A cycle
 * advance restarts the counter; a retroactive write to an earlier
 * cycle keeps advancing it.
 */
function ensureDivergenceEventSequence(state) {
  const current = state?.divergenceEventSequence;

  if (
    !current ||
    typeof current !== "object" ||
    Array.isArray(current)
  ) {
    state.divergenceEventSequence = {
      cycle: null,
      next: 1
    };

    return state.divergenceEventSequence;
  }

  return current;
}

function nextDivergenceSequence(state, cycle) {
  const sequence = ensureDivergenceEventSequence(state);

  const storedCycle = Number.isFinite(Number(sequence.cycle))
    ? Number(sequence.cycle)
    : null;

  if (storedCycle === null || cycle > storedCycle) {
    sequence.cycle = cycle;
    sequence.next = 1;
  }

  const value =
    Number.isSafeInteger(sequence.next) && sequence.next > 0
      ? sequence.next
      : 1;

  sequence.next = value + 1;

  return value;
}

/* ============================================================
   DIVERGENCE EVENT WRITING
============================================================ */

/*
 * Append one divergence lifecycle transition to the run-scoped
 * lifecycle log.
 *
 * The event id is assigned here, from the per-cycle counter, so no
 * caller can invent a non-monotonic id.
 */
function appendDivergenceEvent(state, transition) {
  const kind = normalizeText(transition?.kind);

  if (!VALID_LIFECYCLE_KINDS.has(kind)) {
    throw new TypeError(
      `Cannot record a divergence event: unknown kind "${kind}".`
    );
  }

  const subjectId = normalizeId(transition?.subjectId);
  const definitionId = normalizeId(transition?.definitionId);

  if (!subjectId || !definitionId) return null;

  if (!Array.isArray(state.divergenceEvents)) {
    state.divergenceEvents = [];
  }

  const cycle = Number.isFinite(Number(transition?.cycle))
    ? Number(transition.cycle)
    : Number.isFinite(Number(state.cycle))
      ? Number(state.cycle)
      : 0;

  const sequence = nextDivergenceSequence(state, cycle);

  const event = {
    eventId: `dvg_${cycle}_${sequence}`,
    cycle,
    kind,
    subjectId,
    definitionId,
    onsetCycle: Number.isFinite(Number(transition?.onsetCycle))
      ? Number(transition.onsetCycle)
      : null,
    claimed: normalizeQuantity(transition?.claimed),
    objective: normalizeQuantity(transition?.objective),
    claimedResourceId: normalizeId(transition?.claimedResourceId)
  };

  state.divergenceEvents.push(event);

  return event;
}

/* ============================================================
   PROJECTION
============================================================ */

/*
 * Fold the claim ledger into the per-prisoner believed quantities.
 *
 * The fold reads `quantityAfter` rather than accumulating `delta`.
 * The recorded belief is the authority; the delta explains how it got
 * there. Reading the recorded belief means a ledger that was
 * reconstructed from a save file produces the same projection as one
 * that was built incrementally.
 */
function projectClaimQuantities(state) {
  const projected = {};

  const events = Array.isArray(state?.claimEvents)
    ? state.claimEvents
    : [];

  for (const event of events) {
    if (!event || typeof event !== "object") continue;

    const subjectId = normalizeId(event.subjectId);
    const definitionId = normalizeId(event.definitionId);

    if (!subjectId || !definitionId) continue;

    if (!projected[subjectId]) projected[subjectId] = {};

    projected[subjectId][definitionId] = normalizeQuantity(
      event.quantityAfter
    );
  }

  return projected;
}

function ensureClaimState(state) {
  if (
    state.claimState &&
    typeof state.claimState === "object" &&
    !Array.isArray(state.claimState)
  ) {
    return state.claimState;
  }

  state.claimState = projectClaimQuantities(state);

  return state.claimState;
}

/* ============================================================
   OBJECTIVE QUANTITIES
============================================================ */

/*
 * The reachable quantity of every definition, per holder.
 *
 * This is the truth the divergence is measured against. It reads the
 * authoritative ledger, so it can never drift from what actually
 * exists.
 *
 * `accessible === true` is the same filter the action enumerator
 * uses (see buildResourceView). A prisoner who believes they hold an
 * item they cannot reach is, for every purpose the engine cares
 * about, a prisoner who does not hold it.
 */
function buildObjectiveQuantities(state) {
  const quantities = {};

  const instances = Array.isArray(state?.resources?.instances)
    ? state.resources.instances
    : [];

  for (const instance of instances) {
    if (!instance || typeof instance !== "object") continue;

    const holderId = normalizeId(instance.holderId);

    if (!holderId || holderId === "AM") continue;
    if (instance.accessible !== true) continue;

    const quantity = Number(instance.quantity);

    if (!Number.isFinite(quantity) || quantity <= 0) continue;

    const definitionId = normalizeId(instance.definitionId);

    if (!definitionId) continue;

    if (!quantities[holderId]) quantities[holderId] = {};

    quantities[holderId][definitionId] =
      (quantities[holderId][definitionId] ?? 0) + quantity;
  }

  return quantities;
}

/* ============================================================
   DIVERGENCE
============================================================ */

/*
 * The cycle in which a divergence began.
 *
 * The onset is the cycle of the newest claim event for the pair. That
 * is the moment the prisoner's belief and the reality last parted
 * company, and it is the moment the confusion is "fresh".
 *
 * The onset is resolved by one backward pass over the claim ledger
 * for the pairs that actually diverged, rather than by maintaining a
 * second index. The divergence set is small, so the pass is cheap and
 * the ledger stays the only source of truth.
 */
function computeOnsetCycles(state, wantedPairs) {
  const onsets = new Map();
  const beliefResourceIds = new Map();

  const events = Array.isArray(state?.claimEvents)
    ? state.claimEvents
    : [];

  for (const event of events) {
    if (!event || typeof event !== "object") continue;

    const key = `${normalizeId(event.subjectId)} ${normalizeId(event.definitionId)}`;

    if (!wantedPairs.has(key)) continue;

    /*
     * The onset is the cycle in which the divergence OPENED, which is
     * the FIRST claim event that parted the belief from the reality,
     * not the newest. A silent event in a later cycle does not reopen
     * a divergence that never closed, so it must not reset the age to
     * zero. Only set the onset when it is still unknown: this keeps a
     * NEW divergence anchored to the cycle it actually opened, and
     * leaves an onset that was inherited from the prior divergence set
     * (see refreshClaimDivergence) untouched.
     */
    if (!onsets.has(key)) {
      onsets.set(key, Number.isFinite(Number(event.cycle))
        ? Number(event.cycle)
        : 0);
    }

    /*
     * The resource the prisoner believes they hold. It is captured
     * from the FIRST claim event for the pair that has one, which is
     * the stack the prisoner still believes they hold and the one the
     * divergence originally named.
     */
    if (!beliefResourceIds.has(key)) {
      const beliefResourceId = normalizeId(event.cause?.resourceId);

      if (beliefResourceId) {
        beliefResourceIds.set(key, beliefResourceId);
      }
    }
  }

  return { onsets, beliefResourceIds };
}

/*
 * Recompute the divergence between belief and reality.
 *
 * A divergence exists for a prisoner and a definition when the
 * quantity they believe they hold differs from the quantity they
 * actually hold. The sign is objective-minus-claimed: a NEGATIVE
 * delta means reality holds less than the prisoner believes, which is
 * the case that hurts.
 */
export function refreshClaimDivergence(state) {
  if (!state || typeof state !== "object") return null;

  /*
   * The divergence set that is in place RIGHT NOW. It is read
   * before the recomputation overwrites it, because the difference
   * between the two sets is exactly what the lifecycle transitions
   * are.
   */
  const previous = readPreviousDivergence(state);

  const claimState = ensureClaimState(state);
  const objective = buildObjectiveQuantities(state);

  const divergence = {};
  const wantedPairs = new Set();

  const subjects = new Set([
    ...Object.keys(claimState),
    ...Object.keys(objective)
  ]);

  for (const subjectId of subjects) {
    const claimed = claimState[subjectId] ?? {};
    const actual = objective[subjectId] ?? {};

    const definitions = new Set([
      ...Object.keys(claimed),
      ...Object.keys(actual)
    ]);

    for (const definitionId of definitions) {
      const claimedQuantity = normalizeQuantity(claimed[definitionId]);
      const objectiveQuantity = normalizeQuantity(actual[definitionId]);

      if (claimedQuantity === objectiveQuantity) continue;

      if (!divergence[subjectId]) divergence[subjectId] = {};

      divergence[subjectId][definitionId] = {
        definitionId,
        claimed: claimedQuantity,
        objective: objectiveQuantity,
        delta: objectiveQuantity - claimedQuantity,
        onsetCycle: null,
        claimedResourceId: null
      };

      wantedPairs.add(`${subjectId} ${definitionId}`);
    }
  }

  const { onsets, beliefResourceIds } = computeOnsetCycles(
    state,
    wantedPairs
  );

  for (const [subjectId, definitions] of Object.entries(divergence)) {
    for (const [definitionId, entry] of Object.entries(definitions)) {
      const key = `${subjectId} ${definitionId}`;

      /*
       * Inherit the onset and named resource from the divergence that
       * was already open, so a divergence that keeps diverging does
       * not have its age reset to zero by a later silent claim event.
       * For a NEW divergence (not present in the previous set) the
       * onset is the cycle the divergence actually opened, which
       * computeOnsetCycles resolved from the claim ledger.
       */
      const previousEntry = previous[subjectId]?.[definitionId];

      const onset = previousEntry?.onsetCycle != null
        ? Number(previousEntry.onsetCycle)
        : onsets.get(key);

      const claimedResourceId = previousEntry?.claimedResourceId != null
        ? normalizeId(previousEntry.claimedResourceId)
        : beliefResourceIds.get(key) ?? null;

      entry.onsetCycle = Number.isFinite(onset) ? onset : null;
      entry.claimedResourceId = claimedResourceId;
    }
  }

  /*
   * The divergence set has just been recomputed. Compare it with
   * the set that was in place before this recomputation to find the
   * lifecycle transitions: a pair that is newly diverged is an
   * ONSET, and a pair that is no longer diverged is a RESOLUTION.
   *
   * This runs AFTER the new divergence has been installed on the
   * state, and it compares against the PREVIOUS set, which was
   * captured before the recomputation began.
   */
  recordDivergenceTransitions(state, divergence, previous);

  state.claimDivergence = divergence;

  return divergence;
}

/* ============================================================
   DIVERGENCE LIFECYCLE TRANSITIONS
============================================================ */

/*
 * The pair key used to compare two divergence sets.
 *
 * Both ids are normalized, so the key is stable across the
 * recomputations that produce it.
 */
function divergenceKey(subjectId, definitionId) {
  return `${normalizeId(subjectId) ?? ""} ${normalizeId(definitionId) ?? ""}`;
}

/*
 * The divergence set that was in place BEFORE this recomputation.
 *
 * `state.claimDivergence` IS that set. `refreshClaimDivergence`
 * overwrites it, but it overwrites it at the END, so the previous
 * set is still readable when the transition is detected. There is
 * no need for a second index: the previous set is already tracked,
 * and it is tracked by the very projection that defines what
 * "diverging" means.
 *
 * The set is read defensively because a state that was never
 * refreshed has no divergence view at all, and a state restored
 * from a save written before the divergence view existed carries
 * none either. In both cases there is no previous set, so there is
 * nothing to have resolved.
 */
function readPreviousDivergence(state) {
  const previous = state?.claimDivergence;

  if (
    !previous ||
    typeof previous !== "object" ||
    Array.isArray(previous)
  ) {
    return {};
  }

  return previous;
}

/*
 * Find the lifecycle transitions between the previously known
 * divergence set and the newly computed one.
 *
 * Returns the transition records WITHOUT ids. The ids are assigned
 * by the writer, so a caller can never invent a non-monotonic one.
 */
function detectDivergenceTransitions(previous, divergence) {
  const transitions = [];

  const currentKeys = new Set();

  for (const [subjectId, definitions] of Object.entries(divergence)) {
    for (const [definitionId, entry] of Object.entries(definitions)) {
      const key = divergenceKey(subjectId, definitionId);

      currentKeys.add(key);

      if (previous[subjectId]?.[definitionId]) continue;

      transitions.push({
        kind: DIVERGENCE_LIFECYCLE_KINDS.ONSET,
        subjectId: normalizeId(subjectId),
        definitionId: normalizeId(definitionId),
        onsetCycle: entry?.onsetCycle ?? null,
        claimed: normalizeQuantity(entry?.claimed),
        objective: normalizeQuantity(entry?.objective),
        claimedResourceId: normalizeId(entry?.claimedResourceId)
      });
    }
  }

  /*
   * A pair that was diverging and no longer is has been RESOLVED.
   *
   * The resolution carries the last-known belief and reality, read
   * out of the PREVIOUS set, because the new divergence set no
   * longer contains the pair at all.
   */
  for (const [subjectId, definitions] of Object.entries(previous)) {
    for (const [definitionId, entry] of Object.entries(definitions ?? {})) {
      const key = divergenceKey(subjectId, definitionId);

      if (currentKeys.has(key)) continue;

      transitions.push({
        kind: DIVERGENCE_LIFECYCLE_KINDS.RESOLVED,
        subjectId: normalizeId(subjectId),
        definitionId: normalizeId(definitionId),
        onsetCycle: entry?.onsetCycle ?? null,
        claimed: normalizeQuantity(entry?.claimed),
        objective: normalizeQuantity(entry?.objective),
        claimedResourceId: normalizeId(entry?.claimedResourceId)
      });
    }
  }

  return transitions;
}

/*
 * Record the lifecycle transitions caused by a divergence
 * recomputation.
 */
function recordDivergenceTransitions(state, divergence, previous) {
  const transitions = detectDivergenceTransitions(previous, divergence);

  if (!Array.isArray(state.divergenceEvents)) {
    state.divergenceEvents = [];
  }

  for (const transition of transitions) {
    appendDivergenceEvent(state, transition);
  }

  return transitions;
}

/*
 * Rebuild both derived views from the claim ledger.
 *
 * This is the recovery path: a state that was loaded from a save
 * file, or a state whose derived views were dropped, is restored
 * here. It is also called at the start of every cycle so the derived
 * views can never drift away from the ledger they describe.
 */
export function rebuildClaimState(state) {
  if (!state || typeof state !== "object") return null;

  /*
   * MIGRATION FROM A PRE-SUBJECTIVE-LEDGER SAVE.
   *
   * A save written before this module existed has resourceEvents but
   * no claimEvents. Replaying the objective history through the
   * projector reconstructs the belief history exactly, because the
   * projector is deterministic and the old objective events carry no
   * disclosure, so every AM intervention in that history replays as
   * revealed.
   *
   * The distinction is between an ABSENT claimEvents field and an
   * EMPTY one. An empty array is an authoritative statement that no
   * belief has ever been recorded, and it is respected as-is. An
   * absent field means "this save predates the subjective ledger".
   */
  if (
    !Array.isArray(state.claimEvents) &&
    Array.isArray(state.resourceEvents) &&
    state.resourceEvents.length > 0
  ) {
    state.claimEvents = [];

    for (const resourceEvent of state.resourceEvents) {
      recordClaimEventsForResourceEvent(state, resourceEvent);
    }
  }

  state.claimState = projectClaimQuantities(state);

  return refreshClaimDivergence(state);
}

/* ============================================================
   READING
============================================================ */

/*
 * What a prisoner believes they hold of one definition.
 *
 * Zero rather than null when they have no belief at all, because
 * every caller compares this against a numeric reality.
 */
export function getClaimQuantity(state, subjectId, definitionId) {
  const subject = normalizeId(subjectId);
  const definition = normalizeId(definitionId);

  if (!subject || !definition) return 0;

  const claimState = state?.claimState;

  if (
    !claimState ||
    typeof claimState !== "object" ||
    !claimState[subject]
  ) {
    return 0;
  }

  return normalizeQuantity(claimState[subject][definition]);
}

/*
 * What a prisoner ACTUALLY holds of one definition.
 *
 * This is the same reachable quantity the divergence is measured
 * against, read from the authoritative ledger with the same filters:
 * the holder must be a prisoner (AM is a holder, not a believer), the
 * instance must be accessible, and the quantity must be positive.
 *
 * It is exposed here so a belief correction can converge the belief
 * onto the reality without re-implementing the filter rules in a
 * second place.
 */
export function getObjectiveQuantity(state, subjectId, definitionId) {
  const subject = normalizeId(subjectId);
  const definition = normalizeId(definitionId);

  if (!subject || !definition) return 0;

  const objective = buildObjectiveQuantities(state);

  return normalizeQuantity(objective[subject]?.[definition]);
}

/*
 * Every divergence for one prisoner, ordered by definition id so the
 * output is stable.
 */
export function getClaimDivergenceEntries(state, subjectId) {
  const subject = normalizeId(subjectId);

  if (!subject) return [];

  const definitions = state?.claimDivergence?.[subject];

  if (!definitions || typeof definitions !== "object") return [];

  return Object.keys(definitions)
    .sort()
    .map((definitionId) => ({ ...definitions[definitionId] }));
}

/*
 * The divergences for one prisoner that are still fresh.
 *
 * Fresh means the belief and the reality last parted company no more
 * than DIVERGENCE_RECENCY_WINDOW cycles ago. A stale divergence is
 * real but is no longer worth interrupting the prisoner for.
 */
export function getFreshClaimDivergenceEntries(
  state,
  subjectId,
  cycle
) {
  const currentCycle = Number.isFinite(Number(cycle))
    ? Number(cycle)
    : Number(state?.cycle) || 0;

  return getClaimDivergenceEntries(state, subjectId).filter((entry) => {
    if (!Number.isFinite(Number(entry.onsetCycle))) return false;

    return (
      currentCycle - Number(entry.onsetCycle) <=
      DIVERGENCE_RECENCY_WINDOW
    );
  });
}

/*
 * Whether a prisoner currently believes something they do not have.
 *
 * This is the gate AM's assessment uses: a prisoner who is wrong
 * about their own holdings is worth talking to even when they hold
 * nothing worth a resource attention flag.
 */
export function hasFreshClaimDivergence(state, subjectId, cycle) {
  return (
    getFreshClaimDivergenceEntries(state, subjectId, cycle).length > 0
  );
}

/*
 * The resource ids a prisoner still BELIEVES they hold.
 *
 * When AM takes an item silently, the item leaves the held ledger but
 * stays in the prisoner's expectation. This is the set AM needs in
 * order to name the resource in a taunt, and the set the engine uses
 * to decide whether a proposed intervention is aimed at something the
 * prisoner actually thinks is theirs.
 */
export function getBelievedResourceIds(state, subjectId, cycle) {
  const entries = getFreshClaimDivergenceEntries(
    state,
    subjectId,
    cycle
  );

  const ids = new Set();

  for (const entry of entries) {
    if (Number(entry.claimed) <= 0) continue;
    if (!entry.claimedResourceId) continue;

    ids.add(entry.claimedResourceId);
  }

  return ids;
}

/* ============================================================
   DIVERGENCE LIFECYCLE READING
============================================================ */

/*
 * Every divergence lifecycle transition, in the order it happened.
 *
 * The log is run-scoped and append-only, following the claim event
 * and goal event pattern. It records the two moments that change the
 * shape of the divergence set: a divergence appearing, and a
 * divergence disappearing.
 *
 * A divergence that simply gets OLD is not a transition and does not
 * appear here. Staleness is a function of the age, and the age is
 * measured from the onset cycle, so it is computed on demand rather
 * than recorded as an event.
 */
export function getDivergenceEvents(state) {
  const events = Array.isArray(state?.divergenceEvents)
    ? state.divergenceEvents
    : [];

  return events.map((event) => ({ ...event }));
}

/*
 * The divergence lifecycle transitions that happened in one cycle.
 */
export function getDivergenceEventsForCycle(state, cycle) {
  return getDivergenceEvents(state).filter(
    (event) => event.cycle === cycle
  );
}

/* ============================================================
   WRITING
============================================================ */

/*
 * Correct a prisoner's belief about a resource after a refused
 * attempt proved them wrong.
 *
 * WHEN THIS HAPPENS
 * -----------------
 * AM took an item silently. The prisoner's belief stayed where it was
 * and the two ledgers diverged. The prisoner reached for the thing
 * and it was not there. THAT REFUSAL IS THE LEARNING EVENT: the
 * prisoner's hand has now confirmed what the engine already knew.
 *
 * Without this, the belief never moves. A prisoner robbed in cycle 5
 * still believes they are carrying the item in cycle 50, because
 * nothing in the system ever tells them otherwise. The divergence
 * goes stale, the engine stops surfacing it, and the prisoner is left
 * permanently, silently wrong.
 *
 * WHY THE CORRECTION CONVERGES TO REALITY RATHER THAN TO ZERO
 * ---------------------------------------------------------
 * The naive correction is "set the believed quantity to zero". That
 * is right in the common case, where the prisoner believes they hold
 * one stack of a definition and holds none of it. It is WRONG when
 * the prisoner holds a DIFFERENT stack of the same definition.
 *
 * The belief is tracked per DEFINITION, not per stack. A prisoner
 * who believed four cigarettes across two stacks, and whose AM took
 * one of those stacks, believes four while reality holds one. A
 * refused attempt on the missing stack tells them that stack is
 * gone, not that they hold nothing. Zeroing the belief would leave
 * them believing zero while reality holds one, which is a NEW
 * divergence in the opposite direction — the correction would
 * manufacture a fresh lie rather than close the old one.
 *
 * So the correction converges the belief onto the objective
 * quantity for that definition. In the common case the objective
 * quantity is zero and this IS the zeroing correction; in the
 * multi-stack case it is the correct partial reduction.
 *
 * The correction only ever moves the belief DOWNWARD. A refusal
 * proves that something is missing; it never proves that the
 * prisoner holds MORE than they thought, so a belief that is
 * already below reality is left alone.
 *
 * WHY THIS IS NOT A PROJECTOR CHANGE
 * ---------------------------------
 * The projector (`deriveClaimEventSpecs`) translates OBJECTIVE
 * LEDGER events into claim events. A refused attempt produces no
 * objective ledger event — the objective ledger records mutations,
 * and a refusal mutates nothing. So this correction cannot be
 * expressed as a projection of a resource event, and the projector
 * is left untouched. The AGENCY EVENT is the objective record: it
 * is written to `G.agency.events` with a stable id, and the claim
 * event points back at it through `cause.sourceEventId`, exactly as
 * a projected claim event points back at its resource event.
 *
 * The determinism invariant is therefore preserved: the claim event
 * is derived from a RECORDED event, never from prose or from a model
 * judgement.
 *
 * IDEMPOTENCE
 * -----------
 * A second correction for the same subject and definition finds a
 * believed quantity of zero and writes nothing, so the belief is
 * corrected at most once no matter how many times the engine is
 * asked to correct it.
 */
export function recordBeliefCorrection(
  state,
  {
    subjectId,
    definitionId,
    cycle,
    sourceEventId = null,
    actorId = null,
    resourceId = null
  } = {}
) {
  if (!state || typeof state !== "object") return null;

  const subject = normalizeId(subjectId);
  const definition = normalizeId(definitionId);

  if (!subject || !definition) return null;

  const believed = getClaimQuantity(state, subject, definition);
  const actual = getObjectiveQuantity(state, subject, definition);

  if (believed <= 0 || believed <= actual) {
    /*
     * Nothing to correct, in either direction.
     *
     * A belief of zero cannot be reduced, and a belief that is
     * already at or below the objective quantity is not made wrong by
     * a refusal — the refusal cannot inform the prisoner that they
     * hold MORE than they believed.
     */
    return null;
  }

  return recordClaimEvent(state, {
    subjectId: subject,
    definitionId: definition,
    delta: actual - believed,
    cycle: Number.isFinite(Number(cycle))
      ? Number(cycle)
      : Number(state.cycle) || 0,
    cause: {
      kind: CLAIM_EVENT_KINDS.BELIEF_CORRECTED,
      sourceEventId: normalizeId(sourceEventId),
      actorId: normalizeId(actorId),
      resourceId: normalizeId(resourceId),
      disclosure: null
    }
  });
}

/*
 * Append one claim event.
 *
 * The quantity before is read from the current projection and the
 * quantity after is computed from the delta, so the event is
 * self-describing: it says what the prisoner believed before, what
 * they believe now, and by how much the belief moved.
 *
 * The event id is assigned here, from the per-cycle counter, so no
 * caller can invent a non-monotonic id.
 */
export function recordClaimEvent(state, spec) {
  if (!state || typeof state !== "object") return null;

  const kind = normalizeText(spec?.cause?.kind);

  if (!VALID_CLAIM_KINDS.has(kind)) {
    throw new TypeError(
      `Cannot record a claim event: unknown kind "${kind}".`
    );
  }

  const subjectId = normalizeId(spec?.subjectId);
  const definitionId = normalizeId(spec?.definitionId);

  if (!subjectId || !definitionId) return null;

  if (!Array.isArray(state.claimEvents)) {
    state.claimEvents = [];
  }

  const claimState = ensureClaimState(state);

  if (!claimState[subjectId]) claimState[subjectId] = {};

  const quantityBefore = normalizeQuantity(
    claimState[subjectId][definitionId]
  );
  /*
   * The applied delta is clamped so a belief can never go negative.
   * A negative belief is not a "less wrong" belief, it is a broken
   * projection, and it would turn into a nonsense divergence.
   */
  const delta = Math.max(
    normalizeQuantity(spec?.delta),
    -quantityBefore
  );
  const quantityAfter = quantityBefore + delta;

  const cycle = Number.isFinite(Number(spec?.cycle))
    ? Number(spec.cycle)
    : Number.isFinite(Number(state.cycle))
      ? Number(state.cycle)
      : 0;

  const sequence = nextSequence(state, cycle);

  const disclosure = normalizeText(spec?.cause?.disclosure);

  const event = {
    eventId: `clm_${cycle}_${sequence}`,
    cycle,
    subjectId,
    definitionId,
    quantityBefore,
    quantityAfter,
    delta,
    cause: {
      kind,
      sourceEventId: normalizeId(spec?.cause?.sourceEventId),
      actorId: normalizeId(spec?.cause?.actorId),
      resourceId: normalizeId(spec?.cause?.resourceId),
      disclosure: VALID_DISCLOSURES.has(disclosure) ? disclosure : null
    }
  };

  state.claimEvents.push(event);

  claimState[subjectId][definitionId] = quantityAfter;

  return event;
}

/*
 * Append a batch of claim events in order.
 *
 * The order matters: the quantity before of each event is read from
 * the projection the previous event in the batch already updated, so
 * a batch that moves one prisoner up and another down reads
 * correctly.
 */
export function recordClaimEvents(state, specs) {
  const list = Array.isArray(specs) ? specs : [];
  const recorded = [];

  for (const spec of list) {
    const event = recordClaimEvent(state, spec);

    if (event) recorded.push(event);
  }

  return recorded;
}

/* ============================================================
   DERIVATION
============================================================ */

/*
 * Translate one objective ledger event into the claim events it
 * causes.
 *
 * This is the projector. It is the ONLY place that decides what a
 * prisoner believes, and it decides it from the recorded action
 * alone.
 *
 * The disclosure option decides the AM branch. A silent intervention
 * produces a zero-delta event for everyone it affected: reality
 * moved, belief did not. That absence is the divergence.
 */
export function deriveClaimEventSpecs(
  state,
  resourceEvent,
  {
    disclosure = CLAIM_DISCLOSURES.REVEALED,
    believedResourceId = null
  } = {}
) {
  if (!resourceEvent || typeof resourceEvent !== "object") return [];

  const kind = normalizeText(resourceEvent.kind);
  const action = normalizeText(resourceEvent.cause?.action).toUpperCase();
  const definitionId = normalizeId(resourceEvent.definitionId);

  if (!definitionId) return [];

  const sourceEventId = normalizeId(resourceEvent.eventId);
  const actorId = normalizeId(resourceEvent.actorId);
  const resourceId = normalizeId(resourceEvent.resourceId);
  /*
   * The resource the SUBJECT believes they hold.
   *
   * For a partial AM confiscation the objective event names the
   * derived stack that now holds the moved units, because that is
   * where the quantity physically went. That is the wrong id for a
   * belief: the victim still thinks of the stack they always had.
   * The caller supplies that id separately.
   */
  const believedId = normalizeId(believedResourceId) ?? resourceId;
  const cycle = Number.isFinite(Number(resourceEvent.cycle))
    ? Number(resourceEvent.cycle)
    : 0;
  const quantityBefore = normalizeQuantity(resourceEvent.quantityBefore);
  const quantityAfter = normalizeQuantity(resourceEvent.quantityAfter);

  const resolvedDisclosure =
    disclosure === CLAIM_DISCLOSURES.SILENT
      ? CLAIM_DISCLOSURES.SILENT
      : CLAIM_DISCLOSURES.REVEALED;

  const specs = [];

  const add = (
    subjectId,
    definition,
    delta,
    causeKind,
    causeDisclosure = null
  ) => {
    if (!isPrisonerId(state, subjectId)) return;
    if (!definition) return;

    specs.push({
      subjectId,
      definitionId: definition,
      delta,
      cycle,
      cause: {
        kind: causeKind,
        sourceEventId,
        actorId,
        resourceId,
        disclosure: causeDisclosure
      }
    });
  };

  /*
   * A SEED is a creation handed to a prisoner. They know what they
   * were given.
   */
  if (kind === RESOURCE_EVENT_KINDS.SEED) {
    add(
      resourceEvent.toHolderId,
      definitionId,
      quantityAfter,
      CLAIM_EVENT_KINDS.SEED
    );

    return specs;
  }

  /*
   * A DRYING event changes an item's DEFINITION, not its quantity.
   * The holder is holding the item, so they know it dried. The belief
   * has to move across the two definitions, or the prisoner would
   * believe they hold a wet cigarette forever and the engine would
   * see a divergence on BOTH definitions at once.
   */
  if (kind === RESOURCE_EVENT_KINDS.DRYING) {
    const previousDefinitionId = normalizeId(resourceEvent.cause?.source);
    const holderId =
      normalizeId(resourceEvent.toHolderId) ??
      normalizeId(resourceEvent.fromHolderId);
    const quantity = quantityBefore || quantityAfter;

    if (previousDefinitionId && previousDefinitionId !== definitionId) {
      add(
        holderId,
        previousDefinitionId,
        -quantity,
        CLAIM_EVENT_KINDS.DEFINITION_CHANGE
      );
      add(
        holderId,
        definitionId,
        quantity,
        CLAIM_EVENT_KINDS.DEFINITION_CHANGE
      );
    }

    return specs;
  }

  /*
   * An EXPOSURE changes who can SEE an item, not what anyone holds.
   * Concealment is a separate dimension from quantity, and the claim
   * ledger only tracks quantity.
   */
  if (kind === RESOURCE_EVENT_KINDS.EXPOSURE) {
    return specs;
  }

  if (kind === RESOURCE_EVENT_KINDS.PRISONER_ACTION) {
    /*
     * A SEARCH CREATES the units. The actor found them, so they
     * know about them.
     */
    if (action === "SEARCH") {
      add(
        actorId,
        definitionId,
        quantityAfter,
        CLAIM_EVENT_KINDS.OWN_ACTION
      );

      return specs;
    }

    /*
     * HIDE and REVEAL move no quantity.
     */
    if (action === "HIDE" || action === "REVEAL") {
      return specs;
    }

    const toHolderId = normalizeId(resourceEvent.toHolderId);

    /*
     * No new holder means the affected units ceased to exist: a
     * consumption. SMOKE emits one of these per consumed definition,
     * so the cigarette and the match are recorded separately and
     * neither is double-counted.
     */
    if (!toHolderId) {
      add(
        actorId,
        definitionId,
        -quantityBefore,
        CLAIM_EVENT_KINDS.OWN_ACTION
      );

      return specs;
    }

    if (toHolderId === normalizeId(actorId)) {
      return specs;
    }

    /*
     * The units changed hands. The actor gave them away and knows
     * it; the recipient took them and knows it.
     */
    add(
      actorId,
      definitionId,
      -quantityBefore,
      CLAIM_EVENT_KINDS.OWN_ACTION
    );
    add(
      toHolderId,
      definitionId,
      quantityBefore,
      CLAIM_EVENT_KINDS.RECEIVED
    );

    return specs;
  }

  if (kind === RESOURCE_EVENT_KINDS.AM_INTERVENTION) {
    const victimId = normalizeId(resourceEvent.fromHolderId);
    const toHolderId = normalizeId(resourceEvent.toHolderId);
    const affected = quantityBefore;

    /*
     * A SILENT intervention moves the reality and leaves every
     * affected belief exactly where it was. The victim still thinks
     * they hold the item. That is the divergence.
     */
    if (resolvedDisclosure === CLAIM_DISCLOSURES.SILENT) {
      add(
        victimId,
        definitionId,
        0,
        CLAIM_EVENT_KINDS.SILENT,
        CLAIM_DISCLOSURES.SILENT
      );

      /*
       * A RECIPIENT of a silent transfer is still told. They were
       * handed an item; not knowing about it would credit them with
       * a phantom holding rather than expose a lie.
       */
      if (toHolderId && toHolderId !== "AM") {
        add(
          toHolderId,
          definitionId,
          affected,
          CLAIM_EVENT_KINDS.INFORMED,
          CLAIM_DISCLOSURES.SILENT
        );
      }

      /*
       * The silent event records the stack the victim believes they
       * hold, so the divergence can name it.
       */
      for (const spec of specs) {
        if (spec.subjectId === victimId) {
          spec.cause.resourceId = believedId;
        }
      }

      return specs;
    }

    /*
     * A REVEALED intervention is told to everyone it affected, so
     * their beliefs move with the reality and no divergence arises.
     */
    add(
      victimId,
      definitionId,
      -affected,
      CLAIM_EVENT_KINDS.INFORMED,
      CLAIM_DISCLOSURES.REVEALED
    );

    for (const spec of specs) {
      if (spec.subjectId === victimId) {
        spec.cause.resourceId = believedId;
      }
    }

    if (toHolderId && toHolderId !== "AM") {
      add(
        toHolderId,
        definitionId,
        affected,
        CLAIM_EVENT_KINDS.INFORMED,
        CLAIM_DISCLOSURES.REVEALED
      );
    }

    return specs;
  }

  return specs;
}

/*
 * Derive and record the claim events caused by one objective event.
 *
 * The caller records the objective event FIRST, so the claim event
 * can point back at it through cause.sourceEventId.
 */
export function recordClaimEventsForResourceEvent(
  state,
  resourceEvent,
  options = {}
) {
  const specs = deriveClaimEventSpecs(state, resourceEvent, options);

  return recordClaimEvents(state, specs);
}
