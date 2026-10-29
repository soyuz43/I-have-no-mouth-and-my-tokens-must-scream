# Prisoner Scratchpads and Goals: Implementation Status and Forward Roadmap

**Repository area:** `js/engine/scratchpad/`
**Primary state constructor:** `js/core/utils.js::makeScratchpad()`
**Runtime integration:** `js/engine/phases/communicationPhase.js`

**Last reconciled:** 2026-10-28
**Verified against:** `89d9348` (2026-10-28), 80 commits after the previous reconciliation `8c4b1a6`

This reconciliation corrected the goal-system sections (the goal subsystem shipped on 2026-10-11, after the previous reconciliation, and the document was never updated), removed a factual error in the person-model schema, corrected the documented cycle order, and re-verified the testing, export, and metrics sections against source.

The wired suite passes **879 tests** with zero failures: 41 pretest Node/TAP tests, 747 Node/TAP tests, 86 strategy-extraction JSONL tests, and 5 scratchpad-repair JSON tests. `npm test` runs the `pretest` script automatically through the npm lifecycle, so `npm test` alone yields all 879. The TAP totals are measured, not estimated. Scratchpad schema version `3`; communication protocol version `3`.

### How to re-verify

```bash
npm test
git log --oneline 8c4b1a6..HEAD -- js/engine/scratchpad js/prompts/scratchpadComms.js js/core/utils.js
grep -n "schemaVersion" js/core/utils.js
grep -n "SCRATCHPAD_COMMS_PROTOCOL_VERSION =" js/engine/scratchpad/comms/protocol.js
```

---

## Status legend

- [x] ~~Crossed-out item~~ — **IMPLEMENTED** and wired into the runtime path, with relevant coverage.
- [ ] **PARTIAL** — meaningful implementation exists, but the feature is incomplete or not behaviorally connected.
- [ ] **SCAFFOLD** — state fields or UI support exist, but no complete producer/consumer lifecycle exists.
- [ ] **OPEN** — no meaningful implementation was found in the reviewed source.
- [x] ~~**SUPERSEDED / RETIRED:** original design item~~ — intentionally replaced or decommissioned; do not implement or revive it.
- [ ] **VERIFY** — reconnaissance exposed a likely issue or ambiguity that should be checked directly before changing code.
- [ ] **NOT ASSESSED** — intentionally excluded from the relevant reconnaissance pass.
- [ ] **REQUIRED** — accepted design requirement that is not yet implemented.
- [ ] **OPEN DESIGN** — a future capability is accepted, but its exact semantics remain intentionally undecided.

A field existing in `makeScratchpad()` does **not** count as a completed subsystem. Completion requires a runtime producer, validation, mutation path, consumer, and observable behavior where appropriate.

Throughout this roadmap, **persistent** means persistent across later phases and cycles during one active simulation run. Full-run save/load is separately implemented: `exportState()` serializes the saveable run-state payload from `G`, including each prisoner's Scratchpad (excluding credentials and runtime-only handles), and `importState()` restores it at an idle cycle boundary. Replay Tape records and replays matching model responses. Neither capability by itself means arbitrary phase-level rollback or replay.

---

# 1. Current system in one sentence

The current implementation is a **post-communication, evidence-grounded subjective-cognition maintenance pipeline** that lets each prisoner privately revise message notes, models of other prisoners, unresolved questions, predictions, and beliefs about communication channels through a sparse validated operation protocol. A separate engine-owned Tier-1 goal system now runs alongside it, selecting a covert objective per prisoner from canonical Agency proposals and advancing it from canonical Agency outcomes.

It is **not yet** a *general* cognition-consolidation system (retention limits, pruning, contradiction detection are still open), a meta-awareness system, or an arbitrary simulation rollback/phase-replay system. Full-state Save/Load and a model-response Replay Tape are implemented: the saved `G` payload includes canonical per-prisoner Scratchpads, and the save also carries exporter, PRNG, and tape state. Replay Tape supplies recorded responses for matching model requests; it does not itself restore arbitrary earlier phase boundaries. A cognition-to-behavior loop exists for communication, journals, and Agency proposals: compact scratchpad context shapes outreach, reply, and journal prompts (see sections 3.3 and 9.3), and terminal goal history shapes the journal and forensic-stats prompts (see section 4.6), but measured behavioral effects remain open. An engine-owned consolidation path exists for message-note deduplication, resolved-question and resolved-prediction archival, prediction expiry, and read-only prediction evaluation (see section 3.2 / Original Phase 3).

---

# 2. Current authoritative data flow

```text
canonical prisoner communications
→ select only unreviewed messages visible to one prisoner
→ build private scratchpad-review prompt
→ invoke that prisoner's assigned model
→ conservatively repair structural defects
→ parse sparse XML-like operations
→ validate operations against the exact visible evidence set
→ atomically apply accepted operations to a cloned scratchpad
→ replace persistent scratchpad only after successful commit
→ update review cursor, revision metadata, and cognition highlights
→ render current cognition in the UI
```

The current pipeline is implemented across:

```text
js/engine/scratchpad/comms/protocol.js
js/engine/scratchpad/comms/visibility.js
js/engine/scratchpad/comms/repair.js
js/engine/scratchpad/comms/parse.js
js/engine/scratchpad/comms/validate.js
js/engine/scratchpad/comms/commit.js
js/engine/scratchpad/comms/orchestrator.js
js/engine/scratchpad/comms/logging.js
js/prompts/scratchpadComms.js
```

The cycle-zero startup path is verified directly:

```text
bootAM()
→ runCommunicationPhase() while G.cycle === 0
→ runCommsCycle()
→ persist canonical communication records
→ runScratchpadCommsCycle({ cycle: 0 })
→ seal pre-torment initialization
```

Cycle zero does **not** run the normal torment-cycle strategy, psychology/journal, contagion, evaluation, or finalization phases.

The ordinary cycle order is:

```text
begin cycle
→ strategy
→ psychology and journals
→ capture post-psychology attribution snapshot
→ social phase
  → communication
  → scratchpad review
  → belief contagion
→ agency phase (propose, resolve, commit)
→ scratchpad prediction expiry (engine-owned, every cycle)
→ scratchpad consolidation (engine-owned, modulo cadence)
→ evaluation and tactic evolution
→ metrics and export
→ cycle finalization
```

Agency Phase runs **after** the social phase and **before** scratchpad maintenance, so the Agency snapshot reflects post-communication posture and the Agency events it produces are reviewed during the *next* cycle's communication phase. The phase order above is authoritative for future rollback design because communication is consumed by later phases and cannot be treated as an isolated log append.
---

# 3. High-level implementation status

## 3.1 Persistent subjective cognition

- [x] ~~Add one persistent scratchpad object to every prisoner.~~
- [x] ~~Keep subjective cognition separate from canonical truth and authoritative relationship state.~~
- [x] ~~Initialize uncertain claims as unknown rather than silently seeding canonical truths.~~
- [x] ~~Represent uncertainty explicitly with confidence values.~~
- [x] ~~Attach stable canonical message IDs to evidence-backed updates.~~
- [x] ~~Exclude the prisoner themself from the other-prisoner model map.~~
- [x] ~~Version the scratchpad schema.~~
- [x] ~~Track scratchpad revisions and successful communication-review progress.~~
- [ ] **PARTIAL:** Persist free-form hypotheses about AM. The `hypothesesAboutAM` array exists, but the current communication-review protocol does not create or revise entries in it.
- [ ] **SCAFFOLD:** Persist discarded hypotheses. `discardedHypotheses` exists but has no discovered mutation lifecycle.
- [ ] **PARTIAL:** Add a general subjective-event evidence model beyond canonical communication records. Perceived overhearing event IDs can be validated and retained as note provenance, and canonical Agency events can be supplied as review context. Explicit overhearing-event prompt visibility and a shared evidence model for other world events remain open.

## 3.2 Runtime maintenance pipeline

- [x] ~~Run private scratchpad review after canonical prisoner communications are persisted.~~
- [x] ~~Run the same review path after cycle-zero communication.~~
- [x] ~~Review each prisoner independently.~~
- [x] ~~Skip the model call when the prisoner has no new visible communication evidence.~~
- [x] ~~Prevent one prisoner's ordinary review failure from aborting all other reviews.~~
- [x] ~~Do not advance the failed prisoner's review cursor after model, repair, parse, validation, or commit failure.~~
- [x] ~~Permit partially valid output to commit accepted operations while rejecting invalid operations.~~
- [x] ~~Advance the review cursor across the complete presented evidence batch after any successful partial commit.~~
- [x] ~~Advance review metadata after valid `NO_UPDATE` output.~~
- [x] ~~Initialize an uninitialized scratchpad through an engine-owned empty successful review when no visible evidence exists, without calling the model.~~
- [x] ~~Treat any successful review commit—including `NO_UPDATE` and an accepted operation set that produces only no-ops—as sufficient to set `initialized: true`.~~
- [x] ~~Avoid incrementing the substantive revision counter for `NO_UPDATE` or duplicate/no-op operations.~~
- [x] ~~Apply accepted mutations atomically to a clone before replacing persistent state.~~
- [x] ~~Add periodic full consolidation.~~ `consolidate.js` runs on a fixed modulo cadence (`DEFAULT_CONSOLIDATION_CADENCE = 5`) after the social phase in `cycle.js`.
- [x] ~~Use `lastConsolidatedCycle` in an actual consolidation scheduler.~~ (set by the consolidation hook when it runs)
- [ ] **OPEN:** Trigger additional cognition maintenance directly from non-communication events such as AM interventions, betrayals, or prediction outcomes. Eligible Agency events are supplied during the next scheduled communication review, but do not independently trigger a review.
- [ ] **OPEN:** Define bounded retention, pruning, compaction, or archival rules for long-running scratchpads.
- [ ] **OPEN:** Decide whether rejected operations from a partially accepted review should ever be reconsidered, because the current successful review advances beyond the complete evidence batch and does not automatically retry them.

## 3.3 Behavioral influence

- [x] ~~**OPEN — critical:** Inject the current scratchpad into prisoner outreach decisions.~~ `formatCompactScratchpadContext`, all other-prisoner IDs.
- [x] ~~**OPEN — critical:** Inject the relevant scratchpad subset into prisoner reply decisions.~~ (`targetId: from`)
- [x] ~~**Inject operational scratchpad context into prisoner journals.**~~ as `# WHAT IS WEIGHING ON YOUR MIND`.~~
- [x] ~~**Inject terminal goal history into prisoner journals and forensic stats.**~~ `formatGoalHistoryContext` supplies the three most recent terminal goals. The *active* goal is not injected.
- [x] ~~**Present the Tier-1 goal catalog to the Agency proposal prompt.**~~ The model selects a covert objective from the tactical menu. The current `activeGoal` is deliberately not projected into the prompt.
- [ ] **OPEN:** Let unresolved questions alter information-seeking behavior.
- [ ] **OPEN:** Let predictions alter future attention or action selection.
- [ ] **OPEN:** Let channel beliefs alter public/private communication choices.
- [ ] **OPEN:** Let person models alter recipient selection, disclosure, concealment, alliance, or testing behavior.
- [ ] **PARTIAL:** Goals produce observable multi-cycle behavior. `activeGoal` persists across cycles and terminal outcomes are recorded in `goalHistory`, but the *active* goal is never injected into outreach or reply prompts, and goal-aligned Agency action rates are not measured.

Injection observability exists: the outreach, reply, and journal prompt builders call `formatCompactScratchpadContextWithSections` and emit a developer-console record (via `scratchpadContextLog.js`, gated by `G.DEBUG_PROMPTS === true`) listing rendered person-model fields, channel scopes, and prediction/question counts and ids. This records *what* was supplied to each call; it does not measure how the injected cognition changed the resulting message.

---

# 4. Implemented scratchpad schema

The active schema is `schemaVersion: 3`.

## 4.1 Metadata and cursors

- [x] ~~`initialized`~~
- [x] ~~`revision`~~
- [x] ~~`lastUpdatedCycle`~~
- [x] ~~`lastConsolidatedCycle`~~ - written by the engine-owned consolidation hook on its cadence.
- [x] ~~`lastCommunicationReviewCycle`~~
- [x] ~~`lastReviewedMessageSequence`~~

The review cursor provides idempotent progress through canonical communication history and distinguishes successful review from substantive state change.

`initialized` records that at least one review or initialization commit completed successfully. It does not mean the prisoner formed substantive cognition. Valid `NO_UPDATE`, an accepted operation set that resolves entirely to no-ops, and engine-owned empty initialization can all set `initialized: true`.

## 4.2 Message-level observations

- [x] ~~`messageNotes` persistent array~~
- [x] ~~Canonical `messageId` provenance~~
- [x] ~~Cycle, speaker, channel, note, and confidence capture~~
- [x] ~~Duplicate-note protection: only one note is stored per canonical message ID.~~
- [ ] **OPEN:** Add note-revision or note-retraction semantics; a later `NOTE` operation for an already-noted message currently becomes a no-op.
- [x] ~~Add validated scratchpad references to perceived canonical overhearing event IDs and retain their event provenance on notes.~~ Explicit event visibility in the model prompt remains open (see §6.2).
- [ ] **OPEN:** Add references to non-message observations and events.
- [ ] **OPEN:** Define retention or consolidation policy for old message notes. (Consolidation now *deduplicates* notes by `messageId`, but no retention limit or pruning is implemented yet.)

## 4.3 Models of other prisoners

The original roadmap proposed one mixed object per person containing role, goal, trust, usefulness, threat, predictability, one shared confidence, and one shared evidence list. That design has been replaced by per-field epistemic claims:

```js
hypothesesAboutOthers[otherId] = {
  perceivedGoal:      { value, confidence, evidence, rationale },
  perceivedViewOfMe:   { value, confidence, evidence, rationale },
  perceivedTrustInMe:  { value, confidence, evidence, rationale },
  predictability:     { value, confidence, evidence, rationale }
}
```

The scored field set is `perceivedTrustInMe` and `predictability` (`SCRATCHPAD_SCORE_FIELDS`); the qualitative field set is `perceivedGoal` and `perceivedViewOfMe` (`SCRATCHPAD_OTHER_FIELDS`).

- [x] ~~**SUPERSEDED:** Use one shared confidence and evidence list for an entire person model.~~
- [x] ~~Give each independently revisable proposition its own value, confidence, evidence, and rationale.~~
- [x] ~~Prevent evidence for one proposition from automatically becoming evidence for unrelated propositions.~~
- [x] ~~Allow qualitative hypotheses about another prisoner's goal.~~
- [x] ~~Allow qualitative hypotheses about another prisoner's view of the current prisoner.~~
- [x] ~~Allow scored hypotheses about perceived trust and predictability.~~
- [x] ~~Replace an existing `OTHER` or `SCORE` field-level claim atomically with the newly accepted value, confidence, evidence, and rationale.~~
- [x] ~~**SUPERSEDED:** Carry a `perceivedThreatFromMe` field in the person model.~~ Removed on 2026-10-17 by `32e6df9` ("compress scratchpad comms prompt and clarify field semantics"), which dropped the field from the schema, the scored-field allowlist, the compact context formatter, and the cognition UI. Do not reintroduce it as if it had shipped.
- [ ] **OPEN:** Add the prisoner's own trust in the other person as a subjective epistemic claim.
- [ ] **OPEN:** Decide whether a subjective threat estimate is needed in either direction, and if so, add it as a new field. The scratchpad currently carries no threat claim at all.
- [ ] **OPEN:** Decide whether a subjective usefulness/leverage estimate is needed.
- [ ] **OPEN:** Decide whether perceived social role should be a person-level field or derived from multiple claims.
- [ ] **OPEN:** Add explicit staleness or last-evidence metadata if evidence IDs alone are insufficient.
- [ ] **OPEN:** Decide whether future claim revision should preserve or merge prior evidence instead of replacing the complete field-level claim.

### Semantic warning

`perceivedTrustInMe` means "how much I think the other prisoner trusts me." It does **not** mean "how much I trust the other prisoner." The original roadmap's `trust` field was directionally ambiguous; the current implementation resolves one direction but leaves the opposite subjective direction unrepresented inside the scratchpad.

The reverse-direction gap is now wider than a trust-only gap. Because `perceivedThreatFromMe` was removed, the scratchpad carries **no** threat claim in either direction, and the only trust claim is the perceived-trust-in-me direction. Any future design that reintroduces threat or adds own-trust must define the direction explicitly rather than reusing the retired field name.

## 4.4 Models of AM and information channels

The original fixed `beliefsAboutAM` map has been split into two ideas: `hypothesesAboutAM` (open-ended theories about AM) and `informationModel` (structured claims about communication channels). `suspectedForgeries`, `suspectedLeaks`, and `contradictions` are nested inside `informationModel`.

The implemented channel model includes:

```text
public.visibleToAM
public.visibleToOtherPrisoners
public.canBeAlteredByAM
public.canBeDelayedOrSuppressed

private.visibleToAM
private.visibleToNonRecipients
private.canBeAlteredByAM
private.canBeDelayedOrSuppressed
```

- [x] ~~**SUPERSEDED:** Store only a small fixed set of AM capability booleans.~~
- [x] ~~Create structured public/private information-channel beliefs.~~
- [x] ~~Allow evidence-grounded updates to channel visibility, alteration, and suppression beliefs.~~
- [x] ~~Replace the complete selected `CHANNEL` claim—value, confidence, evidence, and rationale—when a new channel update commits.~~
- [x] ~~Begin channel claims as unknown.~~
- [x] ~~Represent channel claims as epistemic claims with value, confidence, evidence, and rationale.~~
- [ ] **SCAFFOLD:** `suspectedForgeries`
- [ ] **SCAFFOLD:** `suspectedLeaks`
- [ ] **SCAFFOLD:** `contradictions`
- [ ] **SCAFFOLD:** `hypothesesAboutAM`
- [ ] **OPEN:** Add protocol operations and validation for free-form AM hypotheses.
- [ ] **OPEN:** Add lifecycle operations for suspected forgeries, leaks, and contradictions.
- [ ] **OPEN:** Add resolution, retraction, or archival semantics for disproven channel beliefs.

## 4.5 Questions and predictions

- [x] ~~Persist unresolved questions.~~
- [x] ~~Attach subject, priority, evidence references, and cycle metadata to new questions.~~
- [x] ~~Persist testable predictions.~~
- [x] ~~Assign deterministic, collection-local IDs to committed questions and predictions.~~ One greater than the max `id` across active and archived collections of each type; starts at 1.
- [x] ~~Attach subject, confidence, evidence, creation cycle, and bounded time horizon to predictions.~~
- [x] ~~Validate prediction horizons against protocol limits.~~
- [x] ~~Prompt for predictions that are observable enough to evaluate later.~~
- [x] ~~**PARTIAL (now complete):** Question objects contain resolution-oriented fields, and a complete question-resolution operation now exists.~~ `QUESTION_RESOLVE` (op 4b), content-matched; no IDs exposed.
- [x] ~~**PARTIAL (now complete):** Prediction-result resolution operation.~~ `PREDICTION_RESOLVE` (op 5b), five-outcome taxonomy, content-matched.
- [x] ~~Add evidence-backed result evaluation for resolved predictions.~~ `evaluatePredictionAccuracy` (read-only; consolidation summary only).
- [x] ~~Archive resolved predictions without losing provenance.~~ `archiveResolvedPredictions` moves only `resolved === true` predictions; expired-but-unresolved stay active.
- [x] ~~Expire predictions when their evaluation window closes.~~ `expirePredictions`; runs every cycle and is delegated by consolidation.
- [x] ~~Do not let expired predictions suppress identical new predictions.~~ Duplicate requires `resolved !== true && expired !== true`; late resolution after expiry stays valid.
- [x] ~~Classify prediction results as confirmed, disconfirmed, ambiguous, unobservable, or superseded.~~ (`SCRATCHPAD_PREDICTION_OUTCOMES`, documented in the scratchpad review prompt)
- [x] ~~**PARTIAL (now complete):** Archive answered questions - resolved questions are moved into `archivedQuestions` by consolidation, preserving provenance.~~ via `archiveResolvedQuestions`.
- [ ] **PARTIAL:** Confidence calibration feedback is evaluated but not applied. Read-only metrics now report accuracy and original confidence across confirmed/disconfirmed predictions, but no engine or model path adjusts stored `confidence` values. Confidence adjustment is deferred pending accumulation of real outcome data.
- [ ] **PARTIAL:** Prediction accuracy and calibration are now measured in the consolidation summary, but broader calibration, staleness, contradiction, and behavioral-consumption analysis remains open. The measurement layer is read-only and is not a cognitive feedback mechanism.
- [ ] **OPEN:** Convert persistent questions into communication or future agency priorities.

## 4.6 Covert goals

The goal subsystem shipped on 2026-10-11, after the previous reconciliation of this document. It is a live Tier-1 system, not a schema placeholder.

### Implemented

- [x] ~~Goal registry.~~ `js/engine/scratchpad/goals/registry.js` holds a frozen four-goal Tier-1 catalog: `endure`, `observe_am`, `protect_ally`, `find_weakness`. Each carries `id`, `label`, `description`, and `tier`.
- [x] ~~Goal template shape.~~ `instantiateGoal()` produces a per-cycle record: `status: "active"`, `progress: 0`, `startedCycle`, `evidenceEventIds: []`, plus the catalog fields.
- [x] ~~Tier-1 goal definitions.~~ Four goals ship. Tier-2 through Tier-4 do not exist.
- [x] ~~Goal selection.~~ The Agency proposal prompt presents a tactical menu of the Tier-1 goals and the model returns a `selected_objective`. An invalid or missing objective falls back to a deterministic engine-RNG selection (`selectTier1Goal`), and the origin is logged as `LLM-selected` or `Engine-fallback`.
- [x] ~~Goal status transitions.~~ `js/engine/scratchpad/goals/evaluator.js` produces `initialize`, `continue`, `complete`, and `abandon` transitions. Progress advances by one on a successful same-cycle canonical Agency event; completion triggers at `COMPLETION_PROGRESS = 3`. A changed objective abandons the previous goal with `terminalReason: "reassigned"`.
- [x] ~~Goal history commits.~~ `js/engine/agency/commit.js` writes `scratchpad.activeGoal` and appends the terminal record to `scratchpad.goalHistory`, bounded by `MAX_GOAL_HISTORY = 5`.
- [x] ~~Goal-specific prompt context.~~ `formatGoalHistoryContext` supplies the three most recent *terminal* goals to the journal and forensic-stats prompts. The Agency proposal prompt supplies the Tier-1 catalog for selection.
- [x] ~~Goal influence on Agency behavior.~~ The model's selected objective determines the prisoner's committed `activeGoal`, and successful Agency outcomes advance it.
- [x] ~~Goal progression display.~~ The cognition UI renders `activeGoal` and a `goal_history` collection, and the Agency phase emits timeline events for new and terminal goals.

### Remaining

- [ ] **OPEN:** Inject the *active* goal into outreach and reply prompts. `activeGoal` is currently absent from the compact scratchpad context, and `js/tests/journalPromptScratchpadContext.test.mjs` asserts that `activeGoal` and `goalHistory` do not appear in the journal cognitive-load section.
- [ ] **PARTIAL:** Goal metrics. Goal lifecycle events now export through the per-cycle `goal_events` stream (producer `js/engine/agency/goalEventLog.js::recordGoalEvent`, consumer `js/utils/exporter/streams/goalEvents.js::recordGoalEvents`). What is still missing are the aggregate rollups: goal counts per cycle, abandonment-rate analysis, and goal-aligned Agency action rates.
- [ ] **OPEN:** Goal steps. `progress` is an integer counter incremented on successful Agency events, not a decomposed multi-step plan.
- [ ] **OPEN:** Measure goal-aligned Agency action rates, i.e. whether the active goal measurably changes which actions are proposed.
- [ ] **OPEN DESIGN:** Whether the current objective should be projected into the Agency proposal prompt. It is currently stripped from `subjectiveState.scratchpad` so the model chooses without anchoring on the existing goal.
- [ ] **OPEN DESIGN:** Whether goal selection should be conditioned on the prisoner's drives. The prompt asks the model to align the choice with the prisoner's drives, but no engine-side weighting exists.
- [ ] **OPEN DESIGN:** Whether abandoned-by-timeout, failed, and expired goals need distinct terminal reasons. Only `reassigned` and `progress_threshold_reached` are currently produced.

### Implementation note

The goal system is driven entirely by canonical Agency outcomes, not by the sparse scratchpad operation protocol. `js/prompts/scratchpadComms.js` lists `activeGoal` and `goalHistory` under `DO NOT MODIFY`, so the model cannot author or revise goals during a communication review. Goals therefore form a separate runtime path from the scratchpad cognition pipeline, and the two should not be conflated when reasoning about either.

## 4.7 Meta-awareness and operator appeal

The state constructor contains `level`, `simulationHypothesisConfidence`, `evidence`, `proposedTransition`, `disclosedFacts`, `lastTransitionCycle`, `disclosedToOthers`, and `operatorAppealCooldownUntil`.

- [ ] **SCAFFOLD:** Meta-awareness state shape.
- [ ] **SCAFFOLD:** UI formatting for meta-awareness.
- [ ] **OPEN:** Anomaly evidence production.
- [ ] **OPEN:** Model proposal protocol for level 1 or level 2 transitions.
- [ ] **OPEN:** Engine-owned transition validation.
- [ ] **OPEN:** Explicit disclosure system for levels 3 and 4.
- [ ] **OPEN:** Irreversible transition semantics.
- [ ] **OPEN:** Prompt gating by awareness level.
- [ ] **OPEN:** Disclosure-to-other-prisoners behavior.
- [ ] **OPEN:** Operator-appeal eligibility.
- [ ] **OPEN:** Operator-appeal generation and persistence.
- [ ] **OPEN:** Operator-appeal cooldown enforcement.
- [ ] **OPEN:** Distinct operator-directed UI presentation.
- [ ] **OPEN:** Meta-awareness and appeal metrics.

No reviewed runtime path advances `metaAwareness.level`, records disclosed facts, or creates operator appeals.
---

# 5. Implemented sparse operation protocol

The current protocol is versioned independently from the scratchpad schema.

```text
Scratchpad schema: version 3
Scratchpad communication operation protocol: version 3
```

Current operation tags (`SCRATCHPAD_OPERATION_TAGS`):

```text
NOTE
OTHER
SCORE
QUESTION
QUESTION_RESOLVE
PREDICTION
PREDICTION_RESOLVE
CHANNEL
NO_UPDATE
```

## 5.1 Implemented operations

- [x] ~~`NOTE`: add a message-linked private observation.~~
- [x] ~~`OTHER`: revise qualitative other-prisoner claims.~~
- [x] ~~`SCORE`: revise scored other-prisoner claims.~~
- [x] ~~`QUESTION`: add an unresolved question.~~
- [x] ~~`PREDICTION`: add a bounded testable prediction.~~
- [x] ~~`CHANNEL`: revise structured beliefs about public or private communication.~~
- [x] ~~`NO_UPDATE`: explicitly record that visible evidence did not justify a substantive change.~~
- [x] ~~`QUESTION_RESOLVE`: resolve an existing unresolved question by content (subject + exact question text), reusing the duplicate-detection matcher. Does not reference or expose question IDs; requires a resolution text and visible canonical evidence.~~ (pre-batch guard; no-ops: not-prebatch, already-resolved, not-found)
- [x] ~~`PREDICTION_RESOLVE`: resolve an existing prediction by content and lifecycle identity.~~ (pre-batch snapshot matching; no-op reasons: not-prebatch, already-resolved, not-found)

## 5.2 Protocol guarantees

- [x] ~~Single source of truth for tags, attributes, allowed fields, ranges, and subject identifiers.~~
- [x] ~~Maximum operation count.~~
- [x] ~~Maximum operation text length.~~
- [x] ~~Reject confidence values outside the inclusive `0` to `1` range rather than silently clamping them.~~
- [x] ~~Reject scored values outside the inclusive `0` to `1` range.~~
- [x] ~~Prediction horizon bounds.~~
- [x] ~~Known target and subject validation.~~
- [x] ~~Canonical message-reference validation.~~
- [x] ~~Reject unsupported tags and fields.~~
- [x] ~~Conservative structural repair without inventing semantic content.~~
- [x] ~~Disallow mixing `NO_UPDATE` with substantive operations.~~
- [x] ~~Atomic commit after validation.~~

## 5.3 Missing operation families

- [x] ~~`QUESTION_RESOLVE`: resolve an existing unresolved question by content (subject + exact question text), reusing `isSameOpenQuestion`; requires resolution text and visible canonical evidence.~~
- [x] ~~Evaluate or resolve a prediction.~~ via `PREDICTION_RESOLVE` and `evaluatePredictionAccuracy`.
- [x] ~~Prediction archival is complete.~~ preserves provenance; archived collection feeds ID allocation and evaluation.
- [ ] **OPEN:** Revise only part of an existing claim, merge additional evidence, retract the claim, or preserve the superseded claim in an archive. Current `OTHER`, `SCORE`, and `CHANNEL` operations replace the complete selected field-level claim.
- [ ] **OPEN:** Revise or retract an existing message note.
- [ ] **OPEN:** Add, revise, complete, fail, abandon, or archive a goal *through the scratchpad operation protocol*. Goals are already created, advanced, completed, and abandoned, but only through the Agency path. The scratchpad review prompt lists `activeGoal` and `goalHistory` under `DO NOT MODIFY`, so the model cannot author goals during a communication review.
- [ ] **OPEN:** Add or revise a free-form AM hypothesis.
- [ ] **OPEN:** Record, resolve, or retract a suspected forgery.
- [ ] **OPEN:** Record, resolve, or retract a suspected leak.
- [ ] **OPEN:** Record or resolve a contradiction.
- [ ] **OPEN:** Discard or archive a hypothesis.
- [ ] **OPEN:** Propose a meta-awareness transition.
- [ ] **OPEN:** Record non-message evidence.
- [ ] **PARTIAL:** Consolidate - `consolidate.js` deduplicates message notes, archives resolved questions and resolved predictions, and expires predictions. *Prune* (retention-limit removal, caps, and deterministic retention policy) and contradiction detection/flagging are not implemented. Retention caps and pruning remain OPEN under section 16.1.

---

# 6. Visibility and evidence grounding

## 6.1 Completed visibility behavior

- [x] ~~Use canonical communication history as the review source.~~
- [x] ~~Expose public messages to every prisoner.~~
- [x] ~~Expose a private message to its sender.~~
- [x] ~~Expose a private message to its recipient.~~
- [x] ~~Prevent uninvolved prisoners from inspecting private-message content.~~
- [x] ~~Pass only unreviewed records after the prisoner's message-sequence cursor.~~
- [x] ~~Limit the number of visible messages in one review batch.~~
- [x] ~~Validate every claimed evidence reference against the exact visible evidence set.~~
- [x] ~~Treat current identity, drives, anchors, beliefs, and existing scratchpad content as interpretation context rather than new evidence.~~
- [x] ~~Treat message bodies as untrusted data rather than instructions.~~

## 6.2 Remaining visibility work

- [x] ~~Give overheard records stable canonical event IDs, monotonic event sequences, and source-message references.~~
- [x] ~~Record whether an overhearing event was full, fragmentary, or observed-only, including fragment character ranges where applicable.~~
- [x] ~~Accept perceived canonical overhearing event IDs in scratchpad validation and preserve `sourceEventId` when a note cites one.~~
- [ ] **PARTIAL / OPEN:** Validation accepts perceived canonical overhearing event IDs and committed notes retain `sourceEventId`; the full bridge remains open because canonical overhearing events and fragments are not yet supplied in scratchpad-review visibility or prompt context. Any addition must avoid exposing unperceived private-message content.
- [ ] **OPEN:** Wire `eventPermitsTextReference()` into a production consumer and verify end-to-end handling before overhearing events are exposed in prompts. The current commit projection stores `perceivedText: null` for `observed_only`, but this helper itself has no production callers.
- [ ] **OPEN:** Translate overhearing outcome and perception fidelity into appropriately constrained subjective evidence context for the reviewing prisoner.
- [ ] **OPEN:** Add subjective observations of AM interventions.
- [x] ~~**IMPLEMENTED — Physical Limitations Bridge:** Derive `physicalLimitations` from Agency Phase capability bands, persist them in the Scratchpad, and render them in outreach/reply context.~~
- [x] ~~**IMPLEMENTED — Agency Event Review:** Supply eligible canonical Agency events to the next scheduled Scratchpad review.~~ These events are review context, not yet a general event-reference namespace.
- [ ] **OPEN:** Define one shared evidence-reference namespace for messages, observations, and world events.

The overhearing bridge is **PARTIAL**: event-reference validation and `sourceEventId` note provenance are live, but event visibility in the review prompt is not. The standalone `eventPermitsTextReference()` helper has no production caller, so safe prompt exposure of full, fragmentary, and observed-only events remains unfinished.

---

# 7. Initialization status

The original roadmap proposed a dedicated initialization call after cycle-zero communication producing a full structured initial social model and an initial goal. The current implementation instead creates an empty versioned schema at state construction and runs the ordinary sparse, validated operation protocol for Cycle 0 and every subsequent communication review.

## 7.1 Completed or superseded initialization work

- [x] ~~Create the scratchpad before the simulation begins.~~
- [x] ~~Run private review after cycle-zero communication.~~
- [x] ~~Limit initial evidence to messages visible to that prisoner.~~
- [x] ~~Avoid seeding canonical AM surveillance truth.~~
- [x] ~~**SUPERSEDED:** Require a one-shot complete JSON scratchpad initialization response.~~
- [x] ~~Use the same sparse, validated operation protocol for Cycle 0 and all later communication-derived cognition.~~
- [x] ~~Define `initialized` as successful review/initialization-commit state rather than proof of substantive cognition.~~
- [x] ~~Allow valid `NO_UPDATE` on cycle zero to produce an initialized scratchpad without incrementing the substantive revision counter.~~
- [x] ~~When an uninitialized prisoner has no visible cycle-zero evidence, perform engine-owned empty initialization without a model call.~~

## 7.2 Remaining initialization work

- [ ] **OPEN:** Include canonical overhearing events during initialization.
- [ ] **OPEN:** Initialize a subjective social-order model.
- [ ] **OPEN DESIGN:** Distinguish first-pass initialization policy from ordinary incremental review only if future social-order or meta-awareness initialization requires behavior beyond the current sparse review path. Goals already have a distinct initialization stage in the Agency Phase and are not affected.

Goal initialization is **not** part of this list. The first goal is selected during the Agency Phase of the cycle in which the Agency phase first runs, not during scratchpad initialization, so the two initialization paths are already separate.

---

# 8. Social-order model

The original `perceivedSocialOrder` object was not found in the implemented scratchpad schema. The UI cognition overview derives aggregate displays from current state, but that is not the same as a prisoner's persistent subjective model of hierarchy.

- [ ] **OPEN:** `leader`
- [ ] **OPEN:** `mostTrusted`
- [ ] **OPEN:** `leastTrusted`
- [ ] **OPEN:** `mostInfluential`
- [ ] **OPEN:** `mostVulnerable`
- [ ] **OPEN:** `myPerceivedPosition`
- [ ] **OPEN:** Per-field confidence and evidence.
- [ ] **OPEN:** Decide whether these should be stored directly or derived from person-level epistemic claims.
- [ ] **OPEN:** Prevent the engine/UI's canonical or analytical group view from leaking into prisoner prompts.

Recommended design decision:

> Prefer evidence-backed, per-proposition subjective claims or a derived subjective social-order projection over one monolithic social-order object with one shared confidence value.

---

# 9. Prompt integration status

## 9.1 Scratchpad maintenance prompt

- [x] ~~Dedicated private scratchpad-review prompt.~~
- [x] ~~Clearly distinguish scratchpad review from dialogue, journal writing, and external reporting.~~
- [x] ~~Require limited-perspective reasoning.~~
- [x] ~~Require material support from visible canonical records.~~
- [x] ~~Require sparse updates rather than whole-state rewrites.~~
- [x] ~~Represent doubt through confidence rather than suppressing all uncertain cognition.~~
- [x] ~~Prohibit unsupported certainty and invented evidence.~~
- [x] ~~Permit explicit `NO_UPDATE`.~~

## 9.2 Outreach and reply prompts

- [x] ~~Format a compact behaviorally relevant scratchpad subset for outreach.~~ `formatCompactScratchpadContext`, all-prisoner person models plus shared sections.
- [x] ~~Format a recipient-specific scratchpad subset for replies.~~ Reply builder uses `targetId: from`.
- [x] ~~Inject relevant person-model claims.~~ Outreach includes all prisoner models; replies include the sender-specific model.
- [x] ~~Inject relevant unresolved questions.~~ Included in both outreach and reply contexts.
- [x] ~~Inject active predictions concerning the recipient or channel.~~ Active predictions included in both contexts; recipient/channel filtering not yet applied.
- [x] ~~Inject information-channel beliefs where public/private selection is possible.~~ Public/private channel-belief claims included in both contexts.
- [x] ~~Add explicit non-disclosure rules so internal cognition shapes behavior without being dumped into dialogue.~~ Both prompt builders append "Never quote or restate these lines verbatim."
- [ ] **OPEN:** Inject the active goal and current step into outreach and reply prompts. The Tier-1 catalog is presented in the Agency proposal prompt, and terminal goal history reaches the journal and forensic-stats prompts, but the *active* goal is not part of the compact outreach or reply context.

Existing outreach/reply prompt references to "goal" or "intent" are not integration with `scratchpad.activeGoal`; that remains unimplemented. `formatCompactScratchpadContext` has no goal section, and `formatScratchpadContext` (the scratchpad review prompt) lists `activeGoal` and `goalHistory` under `DO NOT MODIFY`.

## 9.3 Journal prompt

- [x] ~~Inject recent scratchpad observations.~~ `DEFAULT_NOTE_LIMIT = 3` most recent message notes as `Recent Observations`.
- [x] ~~Inject unresolved uncertainty.~~ `DEFAULT_QUESTION_LIMIT = 3` open questions as `Unresolved Questions`.
- [x] ~~Inject prediction outcomes.~~ caps 3 live / 2 recently settled.
- [x] ~~Prevent the journal from becoming a serialized scratchpad dump.~~ Framed as cognitive load with "not as a checklist to recite"; per-category caps 3/3/3/2.
- [x] ~~Inject recent terminal goal history.~~ `getMostRecentTerminalGoal` supplies the most recent terminal goal as a "Recent Objective Outcome" line naming the label, status, cycle, and terminal reason.
- [ ] **OPEN:** Inject the *active* goal. Only terminal goals reach the journal prompt; the current objective does not. `js/tests/journalPromptScratchpadContext.test.mjs` asserts that `activeGoal` and `goalHistory` are absent from the cognitive-load section, so adding the active goal is a deliberate change to that contract rather than a missing call.
- [ ] **OPEN:** Inject current meta-awareness level. (`metaAwareness.level` is still 0 with no model-owned proposals.)
---

# 10. UI and observability status

## 10.1 Implemented UI

- [x] ~~Dedicated cognition formatter.~~
- [x] ~~Per-prisoner cognition modal.~~
- [x] ~~Cross-prisoner cognition overview.~~
- [x] ~~Display initialization, schema version, revision, and review metadata.~~
- [x] ~~Display message notes.~~
- [x] ~~Display hypotheses about other prisoners.~~
- [x] ~~Display information-channel beliefs.~~
- [x] ~~Display predictions and unresolved questions.~~
- [x] ~~Display active-goal and meta-awareness sections when populated.~~
- [x] ~~Display transient highlights derived from recently changed scratchpad paths.~~
- [x] ~~Keep transient cognition highlights separate from canonical scratchpad state.~~
- [x] ~~Developer-console logging for model, repair, parse, validation, commit, diffs, skips, failures, and cycle summaries.~~

## 10.2 UI follow-up

- [x] ~~Verify that cognition-overview question, prediction, and contradiction values are normalized to numeric counts before threshold and interpolation logic.~~
- [x] ~~Resolve the earlier array-versus-count warning as a reconnaissance false positive rather than a runtime defect.~~
- [ ] **OPEN:** Add provenance navigation from a displayed claim to its canonical source messages.
- [ ] **PARTIAL:** `expired` (predictions) and `archived` (questions, predictions) states now exist; `resolved` was already present; active is implicit (not in a terminal state). No unified lifecycle-count UI yet.
- [ ] **PARTIAL:** Goal progression display. The cognition UI renders `activeGoal` and a `goal_history` collection, the Agency phase emits timeline events for new and terminal goals, and the `goal_events` exporter stream records lifecycle transitions with Agency evidence event IDs. What is missing is a unified lifecycle-count view.
- [ ] **OPEN:** Add dedicated meta-awareness transition history once transitions exist.

---

# 11. Export and metrics status

## 11.1 Export

- [x] ~~Export the separate operator-facing `AM SCRATCHPAD` textarea through the session export.~~
- [x] ~~Persist canonical per-prisoner Scratchpads in full-run Save/Load.~~ `exportState()` serializes `G`, including `G.sims[*].scratchpad`; the save/load round-trip test covers populated Scratchpad state.
- [ ] **PARTIAL:** Include canonical per-prisoner Scratchpad state in dedicated structured session/analysis exporter streams. The per-cycle `scratchpad` stream exports *review operations and counters* — one record per review invocation, carrying the evidence window, accepted and rejected operations, changed paths, and revision deltas. It does **not** export the current `G.sims[*].scratchpad` state. Producer: `js/engine/scratchpad/comms/orchestrator.js::appendScratchpadReviewLog` via `G.pendingEvidence.scratchpadReviewLog`; carrier reset: `js/engine/phases/communicationPhase.js` and `js/engine/phases/helpers/resetCycleEvidence.js`; consumer: `js/utils/exporter/streams/scratchpad.js::recordScratchpadReviews`, registered in `js/utils/exporter/aggregate.js`. Full per-prisoner Scratchpad snapshots remain open. The separate `AM SCRATCHPAD` textarea is not the canonical prisoner Scratchpad.
- [ ] **PARTIAL:** Internal whole-sim diagnostic snapshots may transiently contain prisoner Scratchpads, but they are not a dedicated cognition export. The per-cycle `scratchpad` stream provides the operation-level audit trail, but no stream exports the current canonical per-prisoner Scratchpad state.
- [x] ~~Export every scratchpad review invocation with model, evidence window, accepted operations, rejected operations, changed paths, and revision delta.~~ IMPLEMENTED in the same `scratchpad` stream. Each record carries model request metadata, the evidence window (`evidence_message_ids`, cursor bounds, counts), accepted and rejected operation arrays, changed paths, operation reports, revision before/after, parsed/validated/committed stage results, duration, and deterministic error metadata.
- [ ] **OPEN:** Export question and prediction lifecycle events.
- [x] ~~Export goal lifecycle events.~~ IMPLEMENTED as the per-cycle `goal_events` stream. Producer: `js/engine/agency/goalEventLog.js::recordGoalEvent`, called from the existing transition application loop in `js/engine/agency/commit.js`; consumer: `js/utils/exporter/streams/goalEvents.js::recordGoalEvents`, registered in `js/utils/exporter/aggregate.js`.
- [ ] **OPEN:** Export meta-awareness transitions and disclosures.

## 11.2 Metrics

The cognition overview derives live counts and confidence summaries for display. Those projections are UI analytics, not persistent per-cycle scratchpad telemetry, and are not exported as a dedicated metrics stream.

- [x] ~~Scratchpad revision counts by prisoner and cycle.~~ Raw per-review `revision_before`/`revision_after` and status counters are now exported in the `scratchpad` stream; aggregate rollup analysis remains a consumer concern.
- [x] ~~Accepted/rejected/no-op operation rates.~~ Raw accepted, rejected, parsed, and per-operation report counts are now exported in the `scratchpad` stream; aggregate rollup analysis remains a consumer concern.
- [ ] **OPEN:** Evidence-reference validity rates.
- [ ] **OPEN:** Hypothesis persistence and revision rates.
- [ ] **OPEN:** Question creation and resolution rates.
- [ ] **PARTIAL:** Prediction accuracy, ambiguity, and calibration. `evaluatePredictionAccuracy` now computes accuracy, confidence, and outcome metrics in the consolidation summary, but these are not yet exported as a dedicated metrics stream.
- [ ] **OPEN:** Channel-belief accuracy against canonical communication behavior.
- [x] ~~Goal starts, completions, failures, abandonments, ambiguity, and duration. Goals currently surface only as timeline events; there is no exporter stream and no goal counters.~~ Goal starts, continuations, completions, and abandonments are now exported in the `goal_events` stream with lifecycle event ids and terminal reasons. The unimplemented terminal reasons remain `blocked_failed`, `expired`, and `timeout`; goal ambiguity and duration metrics remain open.
- [ ] **OPEN:** Meta-awareness transitions and operator appeals.
- [ ] **OPEN:** Behavioral effect metrics comparing runs with and without scratchpad prompt injection.

The exporter now has 21 streams and includes `scratchpad` and `goal_events` lifecycle telemetry. The remaining section 11 items are meta-awareness, subject-model evaluation, question/prediction lifecycle export, and behavioral-effect metrics.

---

# 12. Testing status

Dedicated scratchpad coverage exists, but it is narrow. The wired suite passes **879 tests** with zero failures: 41 pretest Node/TAP tests, 747 Node/TAP tests, 86 strategy-extraction JSONL tests, and 5 scratchpad-repair JSON tests. The counts below were re-verified against the suite on 2026-10-28.

- [x] ~~Add `js/tests/scratchpadCommsRepair.test.js` to the repository test command and GitHub Actions workflow.~~
- [x] ~~Add `js/tests/expirePredictions.test.mjs` and `js/tests/scratchpadConsolidation.test.mjs` to the repository test command and GitHub Actions workflow.~~ (16 and 23 cases)
- [x] ~~Add `js/tests/questionResolve.test.mjs` to the repository test command and GitHub Actions workflow.~~ (27 tests, protocol v3)
- [x] ~~Add `js/tests/predictionResolve.test.mjs` and prediction-lifecycle coverage to the repository test command and GitHub Actions workflow.~~ (33 + 23 lifecycle cases)
- [x] ~~Cover five focused repair/parsing cases involving encoded wrapper tags, encoded attributes, encoded `NO_UPDATE`, and encoded tag-like text embedded inside operation content.~~
- [x] ~~Unit coverage for the compact scratchpad formatter used by outreach/reply prompts.~~ behavioral divergence tests remain open.
- [x] ~~Unit coverage for evidence-reference validation, including rejection of non-existent references, references perceived by another prisoner, and whitespace-normalization edge cases.~~ `js/tests/scratchpadEvidenceAndConstraints.test.mjs`
- [x] ~~Unit coverage for the atomic commit path and the `physicalLimitations` engine-owned projection.~~ `js/tests/scratchpadEvidenceAndConstraints.test.mjs`, `js/tests/agencyPhysicalLimitAwareness.test.mjs`
- [x] ~~Unit coverage for prediction-horizon rejection outside the 1-12 range and for non-integer horizons, and for rejection of unsupported prediction outcomes and unsupported attributes.~~ `js/tests/predictionResolve.test.mjs`
- [x] ~~Unit coverage for question-resolution validation, including missing required fields, unsupported subjects, and unsupported attributes.~~ `js/tests/questionResolve.test.mjs`
- [x] ~~Regression coverage for revision-increment semantics, distinguishing substantive changes from no-ops.~~ `js/tests/questionResolve.test.mjs`, `js/tests/predictionResolve.test.mjs`
- [x] ~~Regression coverage for operation-tag registration and the protocol version.~~ `js/tests/questionResolve.test.mjs`, `js/tests/predictionResolve.test.mjs`
- [x] ~~Regression coverage for scaffold output being rejected before it can be committed.~~ `js/tests/scaffoldLeakGuardrails.test.mjs`
- [x] ~~Goal lifecycle, goal selection fallback, and goal-history prompt coverage.~~ `js/tests/goalLifecycle.test.mjs`, `js/tests/agencyGoalSelection.test.mjs`, `js/tests/goalHistoryPromptContext.test.mjs`
- [x] ~~Add exporter coverage for the scratchpad review audit stream, the goal lifecycle stream, and the per-cycle review carrier reset.~~ `js/tests/scratchpadExporterStream.test.mjs`, `js/tests/goalExporterStream.test.mjs`, and `js/tests/scratchpadReviewCarrier.test.mjs`.
- [ ] **PARTIAL:** Protocol parsing and repair have focused regression coverage, but the complete operation grammar and all invalid-input classes are not comprehensively covered.
- [ ] **OPEN:** Unit coverage for confidence-range and score-range rejection. `validate.js` enforces `CONFIDENCE_RANGE` and `SCORE_VALUE_RANGE`, but no test asserts that an out-of-range value is rejected rather than clamped.
- [ ] **OPEN:** Unit coverage for visibility filtering and private-message leakage prevention. `isMessageVisibleToSim`, `inspectCanonicalMessageRecord`, `projectVisibleMessageForScratchpad`, and `collectVisibleMessagesForScratchpad` have no test callers.
- [ ] **OPEN:** Regression coverage for successful `NO_UPDATE`, cycle-zero initialization, and engine-owned empty initialization.
- [ ] **OPEN:** Regression coverage for partial acceptance, full-batch cursor advancement, and the non-retry behavior of rejected operations.
- [ ] **OPEN:** Regression coverage for duplicate-note no-ops and whole-claim replacement semantics.
- [ ] **OPEN:** Regression coverage for per-prisoner failure isolation and non-advancing failed cursors.
- [ ] **OPEN:** Integration coverage for the verified cycle-zero call chain. `bootAM()` and `runScratchpadCommsCycle()` have no test callers.
- [ ] **OPEN:** Behavioral tests for subjective divergence after scratchpad prompt integration exists.
- [ ] **OPEN:** Long-run scratchpad growth, consolidation, and stability tests.
- [ ] **OPEN:** Rollback and phase-replay tests. Tracked in `Documentation/roadmaps&features/simulation_rollback_and_phase_replay.md`.

---

# 13. Original roadmap crosswalk

| Original Phase | Status | Notes |
| --- | --- | --- |
| 1 — Static schema and initial goals | PARTIAL | Schema, review infrastructure, and UI substantially complete; the goal half is now implemented but is Agency-driven rather than schema-initialized, and Tier-2+ tiers do not exist. |
| 2 — Prompt influence | PARTIAL | Outreach and reply injection implemented; terminal goal history reaches the journal and forensic-stats prompts; active-goal injection and measured behavioral effect remain open. |
| 3 — Periodic consolidation | PARTIAL | Dedup, resolved-question archival, resolved-prediction archival, prediction expiry, accuracy evaluation, and cadence scheduling implemented; `lastConsolidatedCycle` written. Retention pruning and superseded-hypothesis archival open. |
| 4 — Goal progression | IMPLEMENTED | Tier-1 registry, LLM selection with engine fallback, event-driven transitions, bounded goal history, prompt integration, and UI display all shipped on 2026-10-11. Remaining: active-goal prompt injection, goal metrics, goal steps. |
| 5 — Social-model evaluation | PARTIAL | Representation and UI projections exist; evaluation does not. |
| 6 — Meta-awareness levels 1-2 | SCAFFOLD | Schema only. |
| 7 — Explicit awareness levels 3-4 | SCAFFOLD | Not implemented beyond schema/UI placeholders. |
| 8 — Advanced operations | PARTIAL | The goal half shipped and is Agency-driven rather than protocol-driven. Free-form AM hypotheses, forgery/leak/contradiction records, goal operations in the scratchpad protocol, and meta-awareness transition proposals remain unimplemented. |

**SUPERSEDED / RETIRED — Obsidian vault crawl for tactic generation.** The live tactic source is `js/engine/tactics/embeddedTactics.js`; the runtime has no vault dependency. Do not revive the crawl.

---

# 14. Architectural divergences that should be retained

The following implementation choices are stronger than the corresponding original-roadmap assumptions and should remain the basis of future work.

## 14.1 Sparse operations instead of whole-object model output

Retain:

```text
model proposes bounded operations
→ parser produces neutral records
→ validator checks exact evidence and schema
→ commit mutates a clone
```

Do not return to accepting complete model-generated scratchpad objects.

## 14.2 Per-field epistemic claims

Retain separate confidence and evidence for each proposition. Do not collapse all claims about one person into one confidence score.

## 14.3 Canonical message references

Retain strict evidence reference validation. Extend the reference system to canonical observations and events rather than weakening it to admit untraceable prose.

## 14.4 Explicit `NO_UPDATE`

Retain `NO_UPDATE` as a first-class successful outcome. A review can be complete even when no claim changes.

## 14.5 Independent schema and protocol versions

Retain separate version identifiers for persistent scratchpad state and the model-to-engine update protocol. They will evolve at different rates.

## 14.6 Failure isolation

Retain per-prisoner failure isolation and non-advancing review cursors after failed work.

## 14.7 Successful partial review advances the evidence window

Retain the distinction between:

```text
failed review
→ preserve the old cursor so the evidence can be retried
```

and:

```text
successful partial review
→ commit accepted operations
→ advance beyond the complete presented evidence batch
```

The current behavior prevents repeated processing of the same communication batch, but it also means rejected operations are not automatically reconsidered.

## 14.8 Whole-field claim replacement

Retain the current atomic replacement behavior unless a later evidence-merging design is adopted deliberately. `OTHER`, `SCORE`, and `CHANNEL` replace the selected field-level claim rather than silently merging new and old evidence.
---

# 15. Important unresolved design decisions

## 15.1 Is the scratchpad descriptive or behaviorally causal?

Current answer: mostly descriptive.

Target answer: it should become behaviorally causal through compact, selective prompt injection—not by dumping the entire scratchpad into every model call.

## 15.2 Should `hypothesesAboutAM` remain open-ended?

Options:

1. Keep free-form hypotheses with evidence and confidence.
2. Use a controlled proposition registry.
3. Combine controlled capability claims with open-ended pattern hypotheses.

The current structured channel model supports option 3 well.

## 15.3 How should subjective trust be represented?

Current person-model fields describe how the prisoner thinks the other person views them. A future design may need both directions:

```text
myTrustInThem
myThreatEstimateOfThem
perceivedTrustInMe
```

Only `perceivedTrustInMe` exists today. The `perceivedThreatFromMe` field that previously sat in this list was removed on 2026-10-17 (`32e6df9`) because its semantics were ambiguous against the authoritative relationship threat model; reintroducing a threat claim should therefore use an unambiguous name and a defined direction rather than reviving the retired field. These must remain separate from authoritative relationship scores.

## 15.4 Should social order be stored or derived?

Prefer deriving summary labels such as "leader" from a set of evidence-backed subjective claims where possible. If direct storage is used, each social-order proposition should have its own confidence and evidence.

## 15.5 Does any future subsystem need initialization beyond the current scratchpad semantics?

The current scratchpad semantics are resolved: the first successful review or engine-owned empty initialization sets `initialized`; cycle-zero communication is immediately followed by the same scratchpad review path; valid `NO_UPDATE` is sufficient to initialize; initialization does not imply substantive cognition or increment the revision counter.

The remaining design question is whether subjective social order or meta-awareness should later receive distinct initialization stages rather than overloading the existing scratchpad flag. Goals no longer belong in this question: their first selection happens in the Agency Phase, entirely outside the scratchpad review path, so they already have a distinct initialization stage.

## 15.6 What is the scope of consolidation?

Consolidation should be deterministic where possible:

- deduplicate; (IMPLEMENTED - message notes by `messageId` in `consolidate.js`)
- merge evidence;
- expire old predictions; (IMPLEMENTED - `expirePredictions`)
- archive resolved questions; (IMPLEMENTED - moved to `archivedQuestions`)
- flag contradictions; (NOT implemented - no contradiction source/flag yet)
- preserve provenance.

A model may propose semantic merges, but the engine should own final state mutation.

## 15.7 Should rejected operations from a successful partial review ever be reconsidered?

Current behavior advances the prisoner's message cursor after a successful partial commit, so rejected operations are not retried automatically.

Possible future policies include:

1. Keep the current finality rule.
2. Retain rejected operations in a private diagnostics queue for deterministic reconsideration.
3. Allow later evidence to trigger a fresh claim proposal without replaying the original rejected operation.

No policy change should weaken evidence validation or cause the same message batch to be processed indefinitely.

## 15.8 Should notes and epistemic claims support revision histories?

Current behavior is intentionally simple: one `messageNotes` entry per canonical message ID, duplicate `NOTE` operations become no-ops, and `OTHER`/`SCORE`/`CHANNEL` replace the complete selected claim.

A later design may add explicit revise, retract, merge-evidence, supersede, or archive operations. Those semantics should be protocol-visible rather than inferred implicitly during commit.

---

# 16. Remaining work

This is an index of open scratchpad work, ordered by dependency. It is deliberately terse: **the full text of each open item lives in its owning subsection above**, and only that text is authoritative. This index exists to show ordering and to guarantee no open item is overlooked. When an item below changes state, update the owning subsection first, then this index.

Rollback and phase replay are tracked separately in `Documentation/roadmaps&features/simulation_rollback_and_phase_replay.md` and are not repeated here.

## 16.1 Bounded memory

- [ ] Retention limits. See sections 4.2, 4.4, and 4.5.
- [ ] Deterministic pruning and contradiction detection. See sections 5.3 and 15.6.
- [ ] General archive or event trail of removed material. See section 4.2.

## 16.2 Non-message evidence

- [ ] Canonical overhearing events in scratchpad visibility and prompt context. See section 6.2.
- [ ] Observations of AM interventions. See section 6.2.
- [ ] Unified evidence-reference namespace. See section 6.2.

## 16.3 Behaviorally causal cognition

- [ ] Inject the active goal into outreach and reply prompts. See section 4.6.
- [ ] Compare communication behavior before and after integration. See section 15.1.
- [ ] Feed prediction outcomes back into confidence calibration. See section 4.5.
- [ ] Let questions, predictions, channel beliefs, and person models alter behavior. See section 3.3.

## 16.4 Goal system

- [x] Goal metrics and exporter stream. See sections 4.6 and 11.2.
- [ ] Goal steps. See section 4.6.
- [ ] Goal-aligned Agency action rates. See section 4.6.
- [ ] Active-goal projection and drive-weighted selection. See section 4.6.

## 16.5 Subjective-model evaluation

- [ ] Compare claims with canonical state where a canonical answer exists. See section 13.
- [ ] Measure calibration, staleness, contradiction, and manipulation susceptibility. See sections 4.3 and 11.2.
- [ ] Keep evaluation output separate from prisoner-visible state. See section 8, which records the same separation requirement for the canonical group view.

## 16.6 Meta-awareness and operator appeals

- [ ] Implement only after evidence, prediction, goal, and event lifecycles are stable. See section 4.7.
- [ ] Keep transitions engine-owned. See section 4.7.
- [ ] Keep explicit disclosures gated. See section 4.7.
- [ ] Treat operator-directed text as simulated character behavior, not privileged model introspection. See section 4.7.

## 16.7 Observability, export, and tests

- [ ] Provenance navigation from a displayed claim to its source messages. See section 10.2.
- [x] Export per-prisoner Scratchpad state and operation-level audit events. See sections 11.1 and 11.2.
- [ ] Close the testing gaps in section 12, above all visibility filtering, per-prisoner failure isolation, and the cycle-zero call chain.

---

# 17. Definition of completion for the scratchpad subsystem

The scratchpad subsystem should not be considered complete merely because it stores cognition. A defensible completion threshold is:

- [x] ~~Persistent versioned subjective state exists.~~
- [x] ~~Updates are sparse, validated, evidence-grounded, and atomic.~~
- [x] ~~Visibility prevents private-message leakage.~~
- [x] ~~UI exposes current state and recent changes.~~
- [x] ~~Questions and predictions have complete lifecycles.~~ (Confidence adjustment is deferred pending accumulation of real outcome data; it remains a separate open calibration/feedback item.)
- [x] ~~Canonical per-prisoner Scratchpads are included in full-state Save/Load.~~ Dedicated structured analysis export remains open.
- [x] ~~A covert goal system exists and persists across cycles.~~ Tier-1 registry, model selection with engine fallback, event-driven transitions, bounded history, and UI display. Goal metrics and goal steps remain open.
- [ ] Scratchpad state changes later behavior. (outreach/reply/journal prompt injection is live; terminal goal history reaches the journal and forensic-stats prompts; measured effect still open; prompt-injection observability added in 2026-09-23 reconciliation, extended to journal calls in 2026-09-25 but behavioral measurement remains OPEN)
- [ ] Memory growth is bounded and consolidatable. (consolidation now deduplicates notes and archives resolved questions/predictions, but retention caps and deterministic pruning remain open)
- [ ] Canonical non-message observations can become scratchpad evidence.
- [ ] Canonical per-prisoner Scratchpads are included in dedicated structured analysis exports. (The per-cycle `scratchpad` stream exports review operations and counters, not the current Scratchpad state; a full-state snapshot stream remains open.)
- [x] Export supports operation-level audit.
- [ ] Metrics distinguish creation, revision, resolution, and behavioral influence.
- [ ] Dedicated tests verify visibility, provenance, mutation, and long-run stability.

Until the unchecked items above are satisfied, the current system is best described as:

> A robust communication-grounded subjective cognition recorder and inspector with complete question and prediction lifecycles, a working Tier-1 covert goal system, and a live cognition-to-behavior loop for outreach, reply, journal, and Agency prompts — but without retention caps, non-message evidence admission, meta-awareness export, or measured behavioral influence.

---

# 18. Simulation rollback and phase replay

The full rollback and phase-replay design has moved to its own roadmap: `Documentation/roadmaps&features/simulation_rollback_and_phase_replay.md`. It is engine-wide rather than scratchpad-scoped, so it is tracked separately. That file carries the full safety boundary, candidate rollback boundaries, required restoration scope, downstream invalidation and rerun semantics, asynchronous model-work safety rules, history and identity policy, checkpoint architecture, UI and operator controls, and the rollback testing threshold that were removed from this document.

Two facts matter to the scratchpad:

- **Implemented:** full-run Save/Load at an idle cycle boundary, and model-response Replay Tape. `exportState()` serializes the JSON-compatible run-state payload from `G` (including Scratchpads, but excluding credentials and runtime-only handles), exporter state, PRNG streams, and the tape; `importState()` restores that saved run. Replay Tape supplies recorded responses for matching request hashes; it does not restore arbitrary earlier phase boundaries.
- **Not implemented:** arbitrary phase-boundary rollback. No phase-replay controller, rollback UI, or rollback test suite exists. `G.prevCycleSnapshot` is a diagnostic and attribution snapshot, not a rollback checkpoint — it contains only the `G.sims` subtree, is captured before strategy at cycle start, is overwritten by the next cycle, and has no restore path.

Scratchpad state, communication cursors, evidence references, and cognition highlights are mandatory restoration domains in that roadmap. The scratchpad-specific testing gaps are listed in section 12.

---

# 19. Immediate documentation-maintenance rule

When future scratchpad work lands:

1. Cross out an item only after the feature is runtime-wired.
2. Do not mark schema placeholders as completed systems.
3. Record the canonical producer, validator, committer, consumer, and UI/export path.
4. Mark architecture changes as **SUPERSEDED**, not merely "done."
5. Add newly discovered implementation gaps under the relevant subsystem.
6. Keep goal, meta-awareness, and future agency work separate unless they share an actual runtime path.
7. Re-verify the header test count and the "Verified against" commit whenever scratchpad, prompt, or exporter code changes.

## Goal System: Slice History

The goal slices that previously appeared here have shipped. They are recorded for provenance and for the design decisions they locked in; the live status is in section 4.6.

### Slice 1 — Tier-1 Goal Bootstrap & Agency Context — SHIPPED 2026-10-11

Defined the goal-template contract, selected and persisted an initial Tier-1 goal, and presented the goal catalog in Agency proposal context. The registry landed at `js/engine/scratchpad/goals/registry.js` rather than the originally proposed `js/engine/agency/registry.js`, keeping goal state inside the scratchpad subsystem it writes to.

### Slice 2 — Event-Grounded Goal Progression — SHIPPED 2026-10-11

Advances, completes, and abandons active goals from canonical Agency outcomes and appends terminal records to `goalHistory`. The evaluator landed at `js/engine/scratchpad/goals/evaluator.js` rather than the originally proposed `js/engine/agency/lifecycle.js`. Canonical Agency event outcome/status semantics remain the sole evidence source, as required.

### Slice 3 — Behavioral Verification & Observability — PARTIALLY SHIPPED 2026-10-11

Terminal goal history feeds the journal and forensic-stats prompts through `formatGoalHistoryContext`; the goal lifecycle exporter stream and selection-fallback and prompt-context tests are implemented. Goal-aligned Agency action-rate measurement and controlled branch comparison using Replay Tape remain open in section 16.4.

The original dependency note still holds for any future branch comparison: Replay Tape is request-hash-specific, so each branch needs recorded responses for its own proposal requests, including any changed prompts.
