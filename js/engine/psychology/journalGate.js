// js/engine/psychology/journalGate.js
//
// THE MENTAL FOCUS GATE.
//
// WHAT THIS MODULE DECIDES
// ------------------------
// Which prisoners write the deep, belief-updating journal in a given
// cycle, and what mechanical benefit a prisoner receives when they
// pay an action credit to write one on purpose.
//
// THE THREE WAYS INTO THE GATE
// ----------------------------
//
//   1. STIMULUS       The historical rule. AM addressed the
//                      prisoner, a constraint was applied to them,
//                      or they observed something. They write
//                      because something happened TO them.
//
//   2. PREPARE_JOURNAL The prisoner spent an action credit in the
//                      agency phase to buy reflection. They write
//                      because they CHOSE to.
//
//   3. STAT_SHOCK     The safety net. A prisoner whose sanity,
//                      hope, or suffering has crossed a severe
//                      threshold writes even with no stimulus at
//                      all.
//
// The gate is the OPTIMIZATION as well as the feature. Before this
// module, a prisoner with no stimulus simply did not write, so the
// two-call journal pipeline (narrative, then forensic stats) was
// already skipped in the stimulus-free case. What the gate adds is
// the reason a stimulus-free prisoner can still be drawn into the
// expensive pipeline, and the reason they might deliberately choose
// that cost.
//
// ONE CYCLE OF LATENCY
// --------------------
// The psychology phase runs BEFORE the agency phase in the cycle
// pipeline (see js/engine/cycle.js). A prisoner who spends an
// action credit on PREPARE_JOURNAL in cycle N cannot be given a
// journal in cycle N, because the journal for cycle N was already
// written before the agency phase ran.
//
// So the choice is read from the PREVIOUS cycle's agency record.
// This is the same ordering decision that
// js/engine/agency/capabilityConcealmentRule.js already makes, for
// the same physical reason: a body does not stop working the instant
// a strap is tightened, and a mind does not process the choice in
// the same instant it is made. The precedent is deliberate rather
// than accidental, and reusing it keeps the engine's cross-phase
// handoffs consistent with each other.
//
// The alternative - reordering the phases so agency precedes
// psychology - was rejected. It would change the attribution
// snapshots, the belief-snapshot boundaries, the scratchpad review
// order, and the agency evidence carrier, all at once, in exchange
// for one cycle of latency. The latency is the cheaper trade.
//
// WHERE THE CHOICE IS READ FROM
// -----------------------------
// The choice is carried by a dedicated pending-evidence channel,
// `G.pendingEvidence.journalPreparations`, whose name is exported
// as FOCUS_PREPARATION_EVIDENCE_KEY so that the state schema, the
// reset helper, the agency phase, and this module all name the
// same channel rather than each spelling their own string.
//
// The channel is written by the agency phase when a PREPARE_JOURNAL
// action RESOLVES SUCCESSFULLY, and it is read by the next cycle's
// psychology phase.
//
// The pending-evidence bus IS cleared at the start of every cycle,
// so the channel does not survive on its own.
// resetCycleEvidence() carries the previous cycle's preparation
// forward explicitly, exactly as it carries the concealment
// exposure records forward. Only the previous cycle's record is
// carried, so one action credit buys exactly one journal and a
// stale record can never buy a second one.
//
// WHY NOT THE AGENCY EVENT STREAM
// -------------------------------
// G.agency.events is append-only across the run and does carry the
// facts the gate needs - who acted, what they chose, whether it
// succeeded, and in which cycle. It was not used as the channel
// because the gate's read is a per-cycle LOOKUP by prisoner, not a
// scan of an unbounded history: the agency event stream grows
// without limit, so reading it in the psychology phase would mean
// scanning every event of every cycle to find the last successful
// PREPARE_JOURNAL for each prisoner. The pending-evidence channel
// holds at most one record per prisoner and is cleared every cycle,
// so the read is O(prisoners) and the state it depends on is
// bounded.
//
// PURITY
// ------
// Every function in this module is pure. It reads its arguments,
// never `G`, never the clock, never a random source, and never
// mutates anything except the sim it is explicitly told to change.

import { SIM_IDS } from "../../core/constants.js";
import { getActionDefinition } from "../agency/actionDefs.js";

/* ============================================================
   REASONS
============================================================ */

/*
 * The three ways a prisoner can qualify for the journal.
 *
 * These strings are written into the journal entry's
 * `journalReasons` and exported on the journal_events stream, so
 * they are part of the researcher's vocabulary. They are declared
 * here, once, so the phase, the prompt, and the exporter cannot
 * disagree about the spelling.
 */
export const JOURNAL_GATE_REASONS = Object.freeze({
  STIMULUS: "stimulus",
  PREPARE_JOURNAL: "prepare_journal",
  STAT_SHOCK: "stat_shock"
});

/* ============================================================
   THRESHOLDS
============================================================ */

/*
 * The stat-shock thresholds.
 *
 * These are stated as named constants rather than as literals
 * scattered through the code, because the safety net is the one
 * part of this feature that must never drift: a threshold that
 * quietly moved upward would silently stop protecting the prisoners
 * it exists to protect, and nothing else in the engine would report
 * that change.
 */
export const STAT_SHOCK_THRESHOLDS = Object.freeze({
  sanityBelow: 30,
  hopeBelow: 20,
  sufferingAbove: 80
});

/*
 * The processing bonus.
 *
 * A prisoner who PAID for reflection gets a mechanical benefit that
 * a stimulus-driven journal never receives. Without it, the choice
 * would be strictly a cost - one action credit for a journal that
 * might say nothing - and no rational prisoner would ever make it.
 */
export const PROCESSING_BONUS = Object.freeze({
  hopeGain: 3,
  hopeCap: 99
});

/*
 * The pending-evidence channel that carries a focus preparation
 * from the agency phase to the NEXT cycle's psychology phase.
 *
 * The name is exported so the state schema, the reset helper, the
 * agency phase, and the psychology phase all name the same channel
 * rather than each spelling their own string.
 */
export const FOCUS_PREPARATION_EVIDENCE_KEY =
  "journalPreparations";

/* ============================================================
   STAT SHOCK
============================================================ */

/*
 * Whether a prisoner's current state counts as a massive shock.
 *
 * The stats are read as they stand when the gate is evaluated, which
 * is the post-AM, pre-journal state of the cycle: AM's action and
 * the constraint applied this cycle have already landed, and the
 * journal has not yet been written.
 *
 * A MISSING or non-numeric stat is NOT a shock. The deriver always
 * emits all three, so absence means a malformed input, and failing
 * open here would pull every prisoner with a broken stat block into
 * the expensive journal pipeline.
 */
export function hasStatShock(sim) {
  if (!sim || typeof sim !== "object") return false;

  const sanity = Number(sim.sanity);
  const hope = Number(sim.hope);
  const suffering = Number(sim.suffering);

  if (
    !Number.isFinite(sanity) ||
    !Number.isFinite(hope) ||
    !Number.isFinite(suffering)
  ) {
    return false;
  }

  return (
    sanity < STAT_SHOCK_THRESHOLDS.sanityBelow ||
    hope < STAT_SHOCK_THRESHOLDS.hopeBelow ||
    suffering > STAT_SHOCK_THRESHOLDS.sufferingAbove
  );
}

/* ============================================================
   THE FOCUS CHOICE
============================================================ */

/*
 * The prisoners who bought a focused journal, and the cycle they
 * bought it in.
 *
 * `preparations` is the pending-evidence channel the agency phase
 * writes when a prisoner's PREPARE_JOURNAL resolves successfully.
 * A refused attempt never reaches that channel, so a prisoner who
 * had no budget, or for whom the action was not legal, bought
 * nothing and is not counted here.
 *
 * Only the immediately preceding cycle counts. A choice that stayed
 * valid for several cycles would let one action credit pay for
 * several journals, and the benefit would stop being a trade-off.
 * The channel is filtered by cycle rather than trusted blindly, so
 * a stale record can never buy a second journal.
 */
export function findFocusPreparations(
  preparations,
  cycle
) {
  const found = Object.create(null);

  const currentCycle = Number(cycle);
  const sourceCycle = currentCycle - 1;

  if (!Number.isFinite(sourceCycle)) {
    return found;
  }

  const records =
    preparations &&
    typeof preparations === "object"
      ? preparations
      : {};

  for (const [actorId, record] of Object.entries(records)) {
    if (!record || typeof record !== "object") continue;
    if (Number(record.cycle) !== sourceCycle) continue;
    if (record.action !== "PREPARE_JOURNAL") continue;

    found[actorId] = {
      cycle: sourceCycle,
      action: "PREPARE_JOURNAL",
      budgetConsumed: getFocusBudgetCost()
    };
  }

  return found;
}

/*
 * What one PREPARE_JOURNAL costs the prisoner.
 *
 * Read from the action registry rather than repeated here, so the
 * gate can never quote a price the catalogue disagrees with.
 */
function getFocusBudgetCost() {
  const definition = getActionDefinition("PREPARE_JOURNAL");
  const cost = Number(definition?.baseCost);

  return Number.isFinite(cost) && cost >= 0 ? cost : 0;
}

/* ============================================================
   THE GATE
============================================================ */

/*
 * Evaluate the gate for one prisoner.
 *
 * The three inputs are the three independent ways in. A prisoner
 * can qualify through any of them, and can qualify through several
 * at once; the reasons are reported together so the journal record
 * shows WHY it was written rather than just that it was.
 */
export function evaluateJournalGate({
  hasStimulus = false,
  chosePrepareJournal = false,
  hasStatShock: shocked = false
} = {}) {
  const reasons = [];

  if (hasStimulus) {
    reasons.push(JOURNAL_GATE_REASONS.STIMULUS);
  }

  if (chosePrepareJournal) {
    reasons.push(JOURNAL_GATE_REASONS.PREPARE_JOURNAL);
  }

  if (shocked) {
    reasons.push(JOURNAL_GATE_REASONS.STAT_SHOCK);
  }

  return {
    shouldJournal: reasons.length > 0,
    reasons,
    hasStimulus: Boolean(hasStimulus),
    chosePrepareJournal: Boolean(chosePrepareJournal),
    hasStatShock: Boolean(shocked)
  };
}

/*
 * The prisoner ids that qualify for a journal, in the canonical
 * prison order.
 *
 * The order is the engine's SIM_IDS order rather than the order the
 * candidates happened to be discovered in, because the journal
 * phase commits its results in target order and the psychological
 * pressure field writes into OTHER prisoners' stats. A varying
 * commit order would make the committed state depend on the
 * discovery order, which is exactly the kind of hidden ordering
 * dependency the phase is written to avoid.
 */
export function selectJournalTargetIds(
  decisions
) {
  const map =
    decisions &&
    typeof decisions === "object"
      ? decisions
      : {};

  return SIM_IDS.filter(
    (id) =>
      map[id]?.shouldJournal === true
  );
}

/* ============================================================
   PROCESSING BONUS
============================================================ */

/*
 * Halve the reported suffering delta.
 *
 * This returns a COPY. The forensic deltas are the model's own
 * output and are recorded verbatim on the journal entry and in the
 * evidence trace; the dampening is a separate mechanical
 * adjustment applied on top of them, and the two must not be
 * confused in the export.
 */
export function dampenSufferingDelta(
  statDeltas
) {
  if (
    !statDeltas ||
    typeof statDeltas !== "object"
  ) {
    return statDeltas;
  }

  const suffering = Number(statDeltas.suffering);

  if (!Number.isFinite(suffering) || suffering === 0) {
    return statDeltas;
  }

  return {
    ...statDeltas,
    suffering: suffering / 2
  };
}

/*
 * The guaranteed hope recovery.
 *
 * Applied to the prisoner's state, so it is the FINAL hope value
 * for the cycle and is capped at the same ceiling the journal
 * pipeline uses. The returned value is the ACTUAL gain, which is
 * less than the nominal gain when the prisoner was already near the
 * ceiling. The timeline and the export report the actual gain, so a
 * prisoner at 99 hope does not appear to have received a bonus it
 * could not receive.
 */
export function applyFocusHopeRecovery(
  sim
) {
  if (!sim || typeof sim !== "object") return 0;

  const hope = Number(sim.hope);

  if (!Number.isFinite(hope)) return 0;

  const capped = Math.min(
    PROCESSING_BONUS.hopeCap,
    hope + PROCESSING_BONUS.hopeGain
  );

  sim.hope = capped;

  return capped - hope;
}

/*
 * Whether a prisoner earned the processing bonus.
 *
 * The bonus is earned by CHOOSING reflection, not by having
 * something happen to the prisoner. A stimulus-driven journal gets
 * no bonus, so the incentive points at the choice rather than at
 * the trauma.
 */
export function hasProcessingBonus(
  journalGate
) {
  return journalGate?.chosePrepareJournal === true;
}

/*
 * The processing bonus, as a record.
 *
 * This BUILDS the record and does not mutate anything. The caller
 * applies the two mechanical effects at the two points where they
 * belong:
 *
 *   - the suffering dampening, by passing the dampened deltas to
 *     applyJournalStatDeltas();
 *   - the hope recovery, by calling applyFocusHopeRecovery() AFTER
 *     the journal's own deltas have been applied.
 *
 * The ordering matters. Applying the hope recovery first would let
 * the journal's own hope delta overwrite it, which would silently
 * void the guarantee for any journal whose hope delta was negative.
 */
export function buildProcessingBonusRecord({
  hopeGain = 0
} = {}) {
  return {
    bonus: "MENTAL_FOCUS",
    hopeGain,
    nominalHopeGain: PROCESSING_BONUS.hopeGain,
    sufferingDampened: true
  };
}
