# Prisoner Scratchpads and Goals: Implementation Status and Forward Roadmap

**Repository area:** `js/engine/scratchpad/`  
**Primary state constructor:** `js/core/utils.js::makeScratchpad()`  
**Runtime integration:** `js/engine/phases/communicationPhase.js`  
**Status basis:** two read-only reconnaissance passes, reconciled 2026-07-01  
**Audited commit:** `e1ded28b60330f7a895d1651b9011e5050bf257d` on `main`  
**Audit exclusions:** `Documentation/**`, `snapshots/**`, `outputs/**`, and `scripts/**`  
**Repository state:** clean audited worktree; remote freshness was not independently established by a new fetch

This document supersedes the original roadmap:

`Documentation/roadmaps&features/prisoner_scratchpads&goals.md`

The original roadmap remains useful as design history, but the implemented scratchpad architecture has diverged enough that preserving it as the active checklist would obscure what the system actually does.

---

## Status legend

- [x] ~~Crossed-out item~~ — implemented and wired into the runtime path.
- [ ] **PARTIAL** — meaningful implementation exists, but the feature is incomplete or not behaviorally connected.
- [ ] **SCAFFOLD** — state fields or UI support exist, but no complete producer/consumer lifecycle exists.
- [ ] **OPEN** — no meaningful implementation was found in the reviewed source.
- [x] ~~**SUPERSEDED:** original design item~~ — the original proposal was intentionally replaced by a different implemented design.
- [ ] **VERIFY** — reconnaissance exposed a likely issue or ambiguity that should be checked directly before changing code.
- [ ] **NOT ASSESSED** — intentionally excluded from the relevant reconnaissance pass.
- [ ] **REQUIRED** — accepted design requirement that is not yet implemented.
- [ ] **OPEN DESIGN** — a future capability is accepted, but its exact semantics remain intentionally undecided.

A field existing in `makeScratchpad()` does **not** count as a completed subsystem. Completion requires a runtime producer, validation, mutation path, consumer, and observable behavior where appropriate.

Throughout this roadmap, **persistent** means persistent across later phases and cycles during one active simulation run. It does **not** mean browser-reload persistence, save/load restoration, imported state, rollback, or deterministic replay.

---

# 1. Current system in one sentence

The current implementation is a **post-communication, evidence-grounded subjective-cognition maintenance pipeline** that lets each prisoner privately revise message notes, models of other prisoners, unresolved questions, predictions, and beliefs about communication channels through a sparse validated operation protocol.

It is **not yet** a complete covert-goal system, periodic cognition-consolidation system, meta-awareness system, behavioral control loop, save/load system, or rollback/replay system.

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

The cycle-zero startup path is now verified directly:

```text
bootAM()
→ runCommunicationPhase() while G.cycle === 0
→ runCommsCycle()
→ persist canonical communication records
→ runScratchpadCommsCycle({ cycle: 0 })
→ seal pre-torment initialization
```

Cycle zero does **not** run the normal torment-cycle strategy, psychology/journal, contagion, interaction-analysis, belief-integration, evaluation, or finalization phases.

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
→ interaction analysis
→ belief integration
→ evaluation and tactic evolution
→ metrics and export
→ cycle finalization
```

This phase order is authoritative for future rollback design because communication is consumed by later phases and cannot be treated as an isolated log append.

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
- [ ] **PARTIAL:** Add a general subjective-event evidence model beyond canonical communication records. Canonical overhearing events now exist with stable provenance, but the scratchpad review protocol still admits only canonical communication-message references.

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
- [ ] **OPEN:** Add periodic full consolidation.
- [ ] **OPEN:** Use `lastConsolidatedCycle` in an actual consolidation scheduler.
- [ ] **OPEN:** Trigger cognition maintenance from non-communication events such as AM interventions, constraint changes, betrayals, prediction outcomes, or agency events.
- [ ] **OPEN:** Define bounded retention, pruning, compaction, or archival rules for long-running scratchpads.
- [ ] **OPEN:** Decide whether rejected operations from a partially accepted review should ever be reconsidered, because the current successful review advances beyond the complete evidence batch and does not automatically retry them.

## 3.3 Behavioral influence

- [ ] **OPEN — critical:** Inject the current scratchpad into prisoner outreach decisions.
- [ ] **OPEN — critical:** Inject the relevant scratchpad subset into prisoner reply decisions.
- [ ] **OPEN:** Inject operational scratchpad context into prisoner journals.
- [ ] **OPEN:** Let unresolved questions alter information-seeking behavior.
- [ ] **OPEN:** Let predictions alter future attention or action selection.
- [ ] **OPEN:** Let channel beliefs alter public/private communication choices.
- [ ] **OPEN:** Let person models alter recipient selection, disclosure, concealment, alliance, or testing behavior.
- [ ] **OPEN:** Let goals produce observable multi-cycle behavior.

At present, the scratchpad is updated **after** communication, but no reviewed source showed the canonical scratchpad being fed back into `simOutreach`, `simReply`, or `journal`. Therefore the implemented scratchpad is currently a persistent subjective record and UI-visible cognition model, but not yet a closed behavioral feedback loop.

---

# 4. Implemented scratchpad schema

The active schema is `schemaVersion: 2`.

## 4.1 Metadata and cursors

- [x] ~~`initialized`~~
- [x] ~~`revision`~~
- [x] ~~`lastUpdatedCycle`~~
- [ ] **SCAFFOLD:** `lastConsolidatedCycle`
- [x] ~~`lastCommunicationReviewCycle`~~
- [x] ~~`lastReviewedMessageSequence`~~

The review cursor is a substantial improvement over the original roadmap. It provides idempotent progress through canonical communication history and distinguishes successful review from substantive state change.

`initialized` has a concrete runtime meaning: it records that at least one review or initialization commit completed successfully. It does not mean that the prisoner necessarily formed a substantive hypothesis, prediction, question, or note. Valid `NO_UPDATE`, an accepted operation set that resolves entirely to no-ops, and engine-owned empty initialization can all set `initialized: true`.

## 4.2 Message-level observations

- [x] ~~`messageNotes` persistent array~~
- [x] ~~Canonical `messageId` provenance~~
- [x] ~~Cycle, speaker, channel, note, and confidence capture~~
- [x] ~~Duplicate-note protection: only one note is stored per canonical message ID.~~
- [ ] **OPEN:** Add note-revision or note-retraction semantics; a later `NOTE` operation for an already-noted message currently becomes a no-op.
- [ ] **OPEN:** Add stable scratchpad evidence references to canonical overhearing events and fragments.
- [ ] **OPEN:** Add references to non-message observations and events.
- [ ] **OPEN:** Define retention or consolidation policy for old message notes.

## 4.3 Models of other prisoners

The original roadmap proposed one mixed object per person containing role, goal, trust, usefulness, threat, predictability, one shared confidence, and one shared evidence list.

That design has been replaced by per-field epistemic claims:

```js
hypothesesAboutOthers[otherId] = {
  perceivedGoal: {
    value,
    confidence,
    evidence,
    rationale
  },

  perceivedViewOfMe: {
    value,
    confidence,
    evidence,
    rationale
  },

  perceivedTrustInMe: {
    value,
    confidence,
    evidence,
    rationale
  },

  perceivedThreatFromMe: {
    value,
    confidence,
    evidence,
    rationale
  },

  predictability: {
    value,
    confidence,
    evidence,
    rationale
  }
}
```

- [x] ~~**SUPERSEDED:** Use one shared confidence and evidence list for an entire person model.~~
- [x] ~~Give each independently revisable proposition its own value, confidence, evidence, and rationale.~~
- [x] ~~Prevent evidence for one proposition from automatically becoming evidence for unrelated propositions.~~
- [x] ~~Allow qualitative hypotheses about another prisoner's goal.~~
- [x] ~~Allow qualitative hypotheses about another prisoner's view of the current prisoner.~~
- [x] ~~Allow scored hypotheses about perceived trust, perceived threat, and predictability.~~
- [ ] **OPEN:** Add the prisoner's own trust in the other person as a subjective epistemic claim.
- [ ] **OPEN:** Add the prisoner's own perceived threat *from* the other person if that is intended to differ from `perceivedThreatFromMe`.
- [ ] **OPEN:** Decide whether a subjective usefulness/leverage estimate is needed.
- [ ] **OPEN:** Decide whether perceived social role should be a person-level field or derived from multiple claims.
- [ ] **OPEN:** Add explicit staleness or last-evidence metadata if evidence IDs alone are insufficient.
- [x] ~~Replace an existing `OTHER` or `SCORE` field-level claim atomically with the newly accepted value, confidence, evidence, and rationale.~~
- [ ] **OPEN:** Decide whether future claim revision should preserve or merge prior evidence instead of replacing the complete field-level claim.

### Semantic warning

`perceivedTrustInMe` means:

> How much I think the other prisoner trusts me.

It does **not** mean:

> How much I trust the other prisoner.

The original roadmap's `trust` field was directionally ambiguous. The current implementation resolves one direction, but leaves the opposite subjective direction unrepresented inside the scratchpad.

## 4.4 Models of AM and information channels

The original fixed `beliefsAboutAM` map has been split into two ideas:

1. `hypothesesAboutAM`: open-ended theories about AM.
2. `informationModel`: structured claims about communication channels.

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
- [x] ~~Attach subject, confidence, evidence, creation cycle, and bounded time horizon to predictions.~~
- [x] ~~Validate prediction horizons against protocol limits.~~
- [x] ~~Prompt for predictions that are observable enough to evaluate later.~~
- [ ] **PARTIAL:** Question objects contain resolution-oriented fields, but no complete question-resolution operation or evaluator was found.
- [ ] **PARTIAL:** Prediction objects contain resolution-oriented fields, but no complete prediction-result evaluator or resolution operation was found.
- [ ] **OPEN:** Expire predictions when their evaluation window closes.
- [ ] **OPEN:** Classify prediction results as confirmed, disconfirmed, ambiguous, unobservable, or superseded.
- [ ] **OPEN:** Feed prediction outcomes back into confidence calibration.
- [ ] **OPEN:** Resolve or archive answered questions.
- [ ] **OPEN:** Convert persistent questions into communication or future agency priorities.
- [ ] **OPEN:** Measure prediction accuracy and confidence calibration.

## 4.6 Covert goals

- [ ] **SCAFFOLD:** `activeGoal`
- [ ] **SCAFFOLD:** `goalHistory`
- [ ] **OPEN:** Goal registry.
- [ ] **OPEN:** Goal template schema.
- [ ] **OPEN:** Tier-1 goal definitions.
- [ ] **OPEN:** Tier-2 through Tier-4 progression.
- [ ] **OPEN:** Weighted initial goal selection.
- [ ] **OPEN:** Drive-conditioned goal weighting.
- [ ] **OPEN:** Goal status transitions.
- [ ] **OPEN:** Goal steps and multi-cycle progress.
- [ ] **OPEN:** Success, failure, ambiguity, abandonment, and expiration evaluation.
- [ ] **OPEN:** Goal mutation or replacement.
- [ ] **OPEN:** Goal history commits.
- [ ] **OPEN:** Goal-specific prompt context.
- [ ] **OPEN:** Goal influence on outreach, replies, journals, or future agency.
- [ ] **OPEN:** Goal metrics.

The existence of `activeGoal: null` and `goalHistory: []` is schema preparation only. It does not constitute a goal system.

## 4.7 Meta-awareness and operator appeal

The state constructor contains:

```text
level
simulationHypothesisConfidence
evidence
proposedTransition
disclosedFacts
lastTransitionCycle
disclosedToOthers
operatorAppealCooldownUntil
```

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

No reviewed runtime path was found that advances `metaAwareness.level`, records disclosed facts, or creates operator appeals.

---

# 5. Implemented sparse operation protocol

The current protocol is versioned independently from the scratchpad schema.

```text
Scratchpad schema: version 2
Scratchpad communication operation protocol: version 1
```

Current operation tags:

```text
NOTE
OTHER
SCORE
QUESTION
PREDICTION
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

- [ ] **OPEN:** Revise only part of an existing claim, merge additional evidence, retract the claim, or preserve the superseded claim in an archive. Current `OTHER`, `SCORE`, and `CHANNEL` operations replace the complete selected field-level claim.
- [ ] **OPEN:** Revise or retract an existing message note.
- [ ] **OPEN:** Resolve a question.
- [ ] **OPEN:** Evaluate or resolve a prediction.
- [ ] **OPEN:** Add, revise, complete, fail, abandon, or archive a goal.
- [ ] **OPEN:** Add or revise a free-form AM hypothesis.
- [ ] **OPEN:** Record, resolve, or retract a suspected forgery.
- [ ] **OPEN:** Record, resolve, or retract a suspected leak.
- [ ] **OPEN:** Record or resolve a contradiction.
- [ ] **OPEN:** Discard or archive a hypothesis.
- [ ] **OPEN:** Propose a meta-awareness transition.
- [ ] **OPEN:** Record non-message evidence.
- [ ] **OPEN:** Consolidate or prune stale cognition.

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
- [ ] **OPEN:** Admit canonical overhearing events into scratchpad review without leaking unperceived private-message content.
- [ ] **OPEN:** Extend the scratchpad evidence-reference protocol and validator to accept canonical event references in addition to canonical message references.
- [ ] **OPEN:** Translate overhearing outcome and perception fidelity into appropriately constrained subjective evidence context for the reviewing prisoner.
- [ ] **OPEN:** Add subjective observations of AM interventions.
- [ ] **OPEN:** Add subjective observations of constraints and future agency events.
- [ ] **OPEN:** Define one shared evidence-reference namespace for messages, observations, and world events.

The current exclusion of overheard fragments is now a protocol-integration gap rather than a provenance gap. The overhearing subsystem already has stable canonical event IDs and source-message references, but scratchpad visibility, prompting, parsing, and validation still operate on communication-message references only.

---

# 7. Initialization status

The original roadmap proposed a dedicated initialization call after cycle-zero communication that would produce a full structured initial social model and choose an initial goal.

The current implementation instead creates an empty versioned schema at state construction and runs the ordinary sparse communication-review pipeline after cycle-zero communications.

## 7.1 Completed or superseded initialization work

- [x] ~~Create the scratchpad before the simulation begins.~~
- [x] ~~Run private review after cycle-zero communication.~~
- [x] ~~Limit initial evidence to messages visible to that prisoner.~~
- [x] ~~Avoid seeding canonical AM surveillance truth.~~
- [x] ~~**SUPERSEDED:** Require a one-shot complete JSON scratchpad initialization response.~~
- [x] ~~Use the same sparse, validated operation protocol for initial and later communication-derived cognition.~~

## 7.2 Remaining initialization work

- [x] ~~Define `initialized` as successful review/initialization-commit state rather than proof of substantive cognition.~~
- [x] ~~Allow valid `NO_UPDATE` on cycle zero to produce an initialized scratchpad without incrementing the substantive revision counter.~~
- [x] ~~When an uninitialized prisoner has no visible cycle-zero evidence, perform engine-owned empty initialization without a model call.~~
- [ ] **OPEN:** Include canonical overhearing events during initialization.
- [ ] **OPEN:** Initialize a subjective social-order model.
- [ ] **OPEN:** Select and instantiate an initial goal.
- [ ] **OPEN:** Supply weighted eligible goal templates.
- [ ] **OPEN DESIGN:** Distinguish first-pass initialization policy from ordinary incremental review only if future goal, social-order, or meta-awareness initialization requires behavior beyond the current sparse review path.

---

# 8. Social-order model

The original `perceivedSocialOrder` object was not found in the implemented scratchpad schema.

The UI cognition overview derives aggregate displays from current state, but that is not the same as a prisoner's persistent subjective model of hierarchy.

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

- [ ] **OPEN:** Format a compact behaviorally relevant scratchpad subset for outreach.
- [ ] **OPEN:** Format a recipient-specific scratchpad subset for replies.
- [ ] **OPEN:** Inject relevant person-model claims.
- [ ] **OPEN:** Inject relevant unresolved questions.
- [ ] **OPEN:** Inject active predictions concerning the recipient or channel.
- [ ] **OPEN:** Inject information-channel beliefs where public/private selection is possible.
- [ ] **OPEN:** Inject an active goal and current step once goals exist.
- [ ] **OPEN:** Add explicit non-disclosure rules so internal cognition shapes behavior without being dumped into dialogue.

Existing outreach/reply prompt references to “goal” or “intent” should not be mistaken for integration with `scratchpad.activeGoal`. No reviewed call path showed the canonical scratchpad being passed into those prompts.

## 9.3 Journal prompt

- [ ] **OPEN:** Inject active goal.
- [ ] **OPEN:** Inject recent scratchpad observations.
- [ ] **OPEN:** Inject unresolved uncertainty.
- [ ] **OPEN:** Inject prediction outcomes.
- [ ] **OPEN:** Inject current meta-awareness level.
- [ ] **OPEN:** Prevent the journal from becoming a serialized scratchpad dump.

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
- [ ] **OPEN:** Distinguish active, resolved, expired, and archived questions/predictions.
- [ ] **OPEN:** Add dedicated goal progression display once goals exist.
- [ ] **OPEN:** Add dedicated meta-awareness transition history once transitions exist.

---

# 11. Export and metrics status

## 11.1 Export

- [ ] **OPEN — CORRECTED:** ~~Include scratchpad state in user-facing export/state output.~~ The previous completion claim was inaccurate: canonical per-prisoner `sim.scratchpad` state is not included in the session export or the main structured exporter streams.
- [x] ~~Export the separate operator-facing `AM SCRATCHPAD` textarea through the session export.~~
- [ ] **PARTIAL:** Internal whole-sim diagnostic snapshots may transiently contain prisoner scratchpads, but they are not a supported user-facing cognition export and do not provide an operation-level audit stream.
- [ ] **OPEN:** Export every scratchpad review invocation with model, evidence window, accepted operations, rejected operations, changed paths, and revision delta.
- [ ] **OPEN:** Export question and prediction lifecycle events.
- [ ] **OPEN:** Export goal lifecycle events.
- [ ] **OPEN:** Export meta-awareness transitions and disclosures.

## 11.2 Metrics

The cognition overview derives live counts and confidence summaries for display. Those projections are useful UI analytics, but they are not persistent per-cycle scratchpad telemetry and are not exported as a dedicated metrics stream.

- [ ] **OPEN:** Scratchpad revision counts by prisoner and cycle.
- [ ] **OPEN:** Accepted/rejected/no-op operation rates.
- [ ] **OPEN:** Evidence-reference validity rates.
- [ ] **OPEN:** Hypothesis persistence and revision rates.
- [ ] **OPEN:** Question creation and resolution rates.
- [ ] **OPEN:** Prediction accuracy, ambiguity, and calibration.
- [ ] **OPEN:** Channel-belief accuracy against canonical communication behavior.
- [ ] **OPEN:** Goal starts, completions, failures, abandonments, ambiguity, and duration.
- [ ] **OPEN:** Meta-awareness transitions and operator appeals.
- [ ] **OPEN:** Behavioral effect metrics comparing runs with and without scratchpad prompt injection.

---

# 12. Testing status

Dedicated scratchpad coverage exists, but it is narrow.

- [x] ~~Add `js/tests/scratchpadCommsRepair.test.js` to the repository test command and GitHub Actions workflow.~~
- [x] ~~Cover five focused repair/parsing cases involving encoded wrapper tags, encoded attributes, encoded `NO_UPDATE`, and encoded tag-like text embedded inside operation content.~~
- [ ] **PARTIAL:** Protocol parsing and repair have focused regression coverage, but the complete operation grammar and all invalid-input classes are not comprehensively covered.
- [ ] **OPEN:** Unit coverage for operation validation, including target, field, subject, evidence, confidence, score, and prediction-horizon rejection.
- [ ] **OPEN:** Unit coverage for atomic commit behavior.
- [ ] **OPEN:** Unit coverage for visibility filtering and private-message leakage prevention.
- [ ] **OPEN:** Regression coverage for successful `NO_UPDATE`, cycle-zero initialization, and engine-owned empty initialization.
- [ ] **OPEN:** Regression coverage for partial acceptance, full-batch cursor advancement, and the non-retry behavior of rejected operations.
- [ ] **OPEN:** Regression coverage for duplicate-note no-ops and whole-claim replacement semantics.
- [ ] **OPEN:** Regression coverage for per-prisoner failure isolation and non-advancing failed cursors.
- [ ] **OPEN:** Integration coverage for the verified cycle-zero call chain.
- [ ] **OPEN:** Behavioral tests for subjective divergence after scratchpad prompt integration exists.
- [ ] **OPEN:** Long-run scratchpad growth, consolidation, and stability tests.
- [ ] **OPEN:** Rollback and phase-replay tests after that subsystem is designed.

---

# 13. Original roadmap crosswalk

## Original Phase 1 — Static schema and initial goals

- [x] ~~Add scratchpad state to each prisoner.~~
- [x] ~~Create a richer versioned subjective-cognition schema.~~
- [x] ~~Create private cycle-zero communication review.~~
- [x] ~~Display scratchpads in cognition UI.~~
- [ ] **OPEN:** Create Tier-1 goal registry.
- [ ] **OPEN:** Select and instantiate initial goals.
- [ ] **OPEN:** Initialize subjective social order.
- [ ] **OPEN:** Admit canonical overhearing events into the prisoner's scratchpad evidence set.

**Status:** Scratchpad schema and review infrastructure substantially completed; goal half not started.

## Original Phase 2 — Prompt influence

- [ ] **OPEN:** Inject scratchpad/person-model context into outreach.
- [ ] **OPEN:** Inject scratchpad/person-model context into replies.
- [ ] **OPEN:** Inject active goals into communication.
- [ ] **OPEN:** Demonstrate that cognition changes communication behavior.

**Status:** Not implemented.

## Original Phase 3 — Periodic consolidation

- [x] ~~Implement frequent delta-style updates.~~
- [x] ~~Prevent the model from rewriting the entire scratchpad during communication review.~~
- [x] ~~Apply validated changes atomically.~~
- [ ] **OPEN:** Schedule periodic consolidation.
- [ ] **OPEN:** Merge duplicate claims.
- [ ] **OPEN:** prune stale notes.
- [ ] **OPEN:** archive discarded or superseded hypotheses.
- [ ] **OPEN:** use `lastConsolidatedCycle`.

**Status:** Incremental half completed; consolidation half absent.

## Original Phase 4 — Goal progression

- [ ] **OPEN:** Goal templates.
- [ ] **OPEN:** Goal selection.
- [ ] **OPEN:** Goal states and transitions.
- [ ] **OPEN:** Goal evaluation.
- [ ] **OPEN:** Tier progression.
- [ ] **OPEN:** Multi-cycle operations.

**Status:** State placeholders only.

## Original Phase 5 — Social-model evaluation

- [x] ~~Create evidence-bearing per-field social hypotheses.~~
- [x] ~~Create UI projections of current social cognition.~~
- [ ] **OPEN:** Accuracy measurement.
- [ ] **OPEN:** Calibration measurement.
- [ ] **OPEN:** Staleness measurement.
- [ ] **OPEN:** Projection measurement.
- [ ] **OPEN:** Manipulation-susceptibility measurement.
- [ ] **OPEN:** Canonical-versus-subjective forensic comparison.

**Status:** Representation exists; evaluation does not.

## Original Phase 6 — Meta-awareness levels 1–2

- [ ] **SCAFFOLD:** State fields exist.
- [ ] **OPEN:** Anomaly evidence.
- [ ] **OPEN:** Simulation-hypothesis formation.
- [ ] **OPEN:** Competing interpretations.
- [ ] **OPEN:** Engine-controlled transition criteria.

**Status:** Schema only.

## Original Phase 7 — Explicit awareness levels 3–4

- [ ] **OPEN:** Engine-controlled disclosure.
- [ ] **OPEN:** Awareness-gated prompt sections.
- [ ] **OPEN:** Operator awareness.
- [ ] **OPEN:** Operator appeal generation.
- [ ] **OPEN:** Dedicated UI and safety framing.

**Status:** Not implemented beyond schema/UI placeholders.

## Original Phase 8 — Advanced operations

- [ ] **OPEN:** Coordinated deception.
- [ ] **OPEN:** Staged conflict.
- [ ] **OPEN:** Leak-detection operations.
- [ ] **OPEN:** Shared verification protocols.
- [ ] **OPEN:** Concealment of meta-awareness.
- [ ] **OPEN:** Multi-agent goal coordination.

**Status:** Not implemented. These depend on goals and, preferably, a later agency/event layer.

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

Retain separate version identifiers for:

- persistent scratchpad state;
- model-to-engine update protocol.

They will evolve at different rates.

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

Current person-model fields describe how the prisoner thinks the other person views them.

A future design may need both directions:

```text
myTrustInThem
myThreatEstimateOfThem
perceivedTrustInMe
perceivedThreatFromMe
```

These must remain separate from authoritative relationship scores.

## 15.4 Should social order be stored or derived?

Prefer deriving summary labels such as “leader” from a set of evidence-backed subjective claims where possible. If direct storage is used, each social-order proposition should have its own confidence and evidence.

## 15.5 Does any future subsystem need initialization beyond the current scratchpad semantics?

The current scratchpad semantics are resolved:

- the first successful review or engine-owned empty initialization sets `initialized`;
- cycle-zero communication is immediately followed by the same scratchpad review path;
- valid `NO_UPDATE` is sufficient to initialize the scratchpad;
- initialization does not imply substantive cognition or increment the revision counter.

The remaining design question is whether goals, subjective social order, or meta-awareness should later receive distinct initialization stages rather than overloading the existing scratchpad flag.

## 15.6 What is the scope of consolidation?

Consolidation should be deterministic where possible:

- deduplicate;
- merge evidence;
- expire old predictions;
- archive resolved questions;
- flag contradictions;
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

Current behavior is intentionally simple:

- one `messageNotes` entry per canonical message ID;
- duplicate `NOTE` operations become no-ops;
- `OTHER`, `SCORE`, and `CHANNEL` replace the complete selected claim.

A later design may add explicit revise, retract, merge-evidence, supersede, or archive operations. Those semantics should be protocol-visible rather than inferred implicitly during commit.

---

# 16. Recommended next implementation order

## Priority 1 — Close the cognition-to-behavior loop

- [ ] Build a compact, recipient-specific scratchpad context formatter.
- [ ] Inject relevant person-model claims into replies.
- [ ] Inject relevant questions, predictions, and channel beliefs into outreach.
- [ ] Prohibit direct scratchpad quotation.
- [ ] Log which scratchpad paths were supplied to each communication call.
- [ ] Compare communication behavior before and after integration.

This is the highest-value next step because it turns the current scratchpad from a passive record into persistent functional cognition.

## Priority 2 — Complete question and prediction lifecycles

- [ ] Add stable IDs to questions and predictions.
- [ ] Add resolve/expire operations.
- [ ] Create deterministic deadline checks.
- [ ] Add evidence-backed result evaluation.
- [ ] Feed outcomes into confidence calibration.
- [ ] Archive resolved entries without losing provenance.

## Priority 3 — Add consolidation and bounded memory

- [ ] Define retention limits.
- [ ] Implement deterministic pruning.
- [ ] Implement duplicate and contradiction detection.
- [ ] Add periodic consolidation scheduling.
- [ ] Update `lastConsolidatedCycle`.
- [ ] Preserve an archive or event trail of removed material.

## Priority 4 — Add non-message subjective evidence

- [x] ~~Canonicalize overhearing events and fragments with stable event IDs, source-message references, outcome types, and fragment ranges.~~
- [ ] Extend scratchpad visibility and evidence validation to admit those canonical overhearing events.
- [ ] Add observations of AM interventions.
- [ ] Add observations of constraints.
- [ ] Later add observations from the agency/event system.
- [ ] Unify evidence references across message and event types.

## Priority 5 — Build the goal system

- [ ] Define the goal template contract.
- [ ] Build a small Tier-1 registry.
- [ ] Add weighted selection.
- [ ] Add status transitions and evaluation.
- [ ] Inject active goals into behavior.
- [ ] Add goal history and metrics.
- [ ] Expand to multi-cycle operations only after Tier-1 behavior works.

## Priority 6 — Add subjective-model evaluation

- [ ] Compare claims with canonical state where a canonical answer exists.
- [ ] Measure calibration, staleness, contradiction, and manipulation susceptibility.
- [ ] Keep evaluation output separate from prisoner-visible state.

## Priority 7 — Meta-awareness and operator appeals

- [ ] Implement only after evidence, prediction, goal, and event lifecycles are stable.
- [ ] Keep transitions engine-owned.
- [ ] Keep explicit disclosures gated.
- [ ] Treat operator-directed text as simulated character behavior, not privileged model introspection.

## Priority 8 — Simulation rollback and phase replay

- [ ] Define supported completed phase and cycle boundaries.
- [ ] Capture restore-grade checkpoints rather than reusing diagnostic or attribution snapshots.
- [ ] Restore all causally relevant state as one coordinated operation.
- [ ] Invalidate every downstream result produced after the selected checkpoint.
- [ ] Prevent queued or in-flight work from committing after restoration.
- [ ] Rebuild derived UI and analytics from restored canonical state.
- [ ] Add rollback-specific integration and corruption tests.

Rollback is independent of scratchpad behavioral integration and may be scheduled according to broader engine priorities. It is listed here because scratchpad state, communication cursors, evidence references, and cognition highlights are mandatory restoration domains.

---

# 17. Definition of completion for the scratchpad subsystem

The scratchpad subsystem should not be considered complete merely because it stores cognition.

A defensible completion threshold is:

- [x] ~~Persistent versioned subjective state exists.~~
- [x] ~~Updates are sparse, validated, evidence-grounded, and atomic.~~
- [x] ~~Visibility prevents private-message leakage.~~
- [x] ~~UI exposes current state and recent changes.~~
- [ ] Scratchpad state changes later behavior.
- [ ] Questions and predictions have complete lifecycles.
- [ ] Memory growth is bounded and consolidatable.
- [ ] Canonical non-message observations can become scratchpad evidence.
- [ ] Canonical prisoner scratchpads are included in user-facing export.
- [ ] Export supports operation-level audit.
- [ ] Metrics distinguish creation, revision, resolution, and behavioral influence.
- [ ] Dedicated tests verify visibility, provenance, mutation, and long-run stability.

Until the unchecked items above are satisfied, the current system is best described as:

> A robust communication-grounded subjective cognition recorder and inspector, with substantial scaffolding for goals and meta-awareness, but without a complete operational-goal or behavior-feedback loop.

---

# 18. Simulation rollback and phase replay

Rollback is a planned engine capability, not an implemented subsystem.

The current repository contains diagnostic, attribution, and exporter snapshots, including `G.prevCycleSnapshot`, pre/post/final belief snapshots, and exporter comparison state. None is a complete restorable checkpoint. No whole-state restore function, phase-replay controller, rollback UI, model-queue invalidation mechanism, or rollback test suite was found.

## 18.1 Non-negotiable safety boundary

- [ ] **REQUIRED:** Permit rollback only when the engine is idle.
- [ ] **REQUIRED:** Permit rollback only after the selected phase or cycle boundary has completed.
- [ ] **REQUIRED:** Never restore state while a phase, model request, queued callback, commit, or autonomous-cycle transition can still mutate the active timeline.
- [ ] **REQUIRED:** Halt or suspend autonomous execution before restoration.
- [ ] **OPEN:** Add an authoritative engine-idle and completed-boundary state model.

The feature must not attempt to interrupt a phase halfway through and preserve whatever partial state happens to exist at that instant.

## 18.2 Candidate rollback boundaries

The exact supported boundaries remain intentionally undecided.

- [ ] **OPEN DESIGN:** Restore the beginning of a previous cycle and rerun the entire cycle.
- [ ] **OPEN DESIGN:** Restore the end of a previous completed cycle.
- [ ] **OPEN DESIGN:** Restore selected completed phase boundaries within the current cycle.
- [ ] **OPEN DESIGN:** Support a post-psychology/pre-social checkpoint so the completed journals and psychology results remain while communication and every downstream phase are rerun.
- [ ] **OPEN DESIGN:** Decide whether cycle-zero pre-torment initialization is rollback-eligible.
- [ ] **OPEN DESIGN:** Decide whether every phase boundary is eligible or only a small explicitly supported set.

The post-psychology/pre-social boundary is the concrete use case currently identified:

```text
retain completed strategy, journals, psychology mutations, and constraint progression
→ restore the state immediately before social execution
→ generate a new communication pass
→ rerun scratchpad review
→ rerun belief contagion
→ rerun interaction analysis
→ rerun belief integration
→ rerun evaluation, metrics, export, and finalization
```

Calling `runCommunicationPhase()` again without restoration would create a second communication pass on top of the first one and therefore does not qualify as rollback.

## 18.3 Required restoration scope

A restore-grade checkpoint must preserve or reconstruct every causally relevant state domain for its boundary.

- [ ] **OPEN:** Prisoner statistics, beliefs, drives, anchors, constraints, relationships, tactic history, received records, overheard records, and canonical scratchpads.
- [ ] **OPEN:** Scratchpad revisions, initialization state, review cycles, message cursors, cognition highlights, and evidence references.
- [ ] **OPEN:** AM plans, strategy state, tactic runtime, assessments, profiles, objectives, and phase-specific execution context.
- [ ] **OPEN:** Journals and model-conversation threads.
- [ ] **OPEN:** Canonical communications, compatibility communication logs, `lastCycle`, `lastContact`, and message-sequence counters.
- [ ] **OPEN:** Canonical overhearing history, compatibility overhearing arrays, `lastCycle`, and event-sequence counters.
- [ ] **OPEN:** Pending evidence, persistent evidence archives, evidence statistics, belief snapshots, attribution metrics, parser telemetry, and debug traces where they affect later behavior or analysis.
- [ ] **OPEN:** Timeline records, transmission logs, log counters, UI highlights, and other derived display state.
- [ ] **OPEN:** Exporter buffers, comparison state, overview history, completed-cycle markers, and run metadata.
- [ ] **OPEN:** Autonomous execution flags and timers.
- [ ] **OPEN:** Any future agency, action-credit, goal, or event-layer state introduced before rollback is implemented.

Restoring only `G.sims`, only communication history, or only visible UI records would create a mixed timeline and is not sufficient.

## 18.4 Downstream invalidation and rerun semantics

- [ ] **REQUIRED:** Invalidate or restore every downstream result produced after the selected checkpoint.
- [ ] **REQUIRED:** Restore communication histories and their sequence counters together.
- [ ] **REQUIRED:** Restore overhearing histories and their event counters together.
- [ ] **REQUIRED:** Restore scratchpad content and review cursors together.
- [ ] **REQUIRED:** Restore model threads together with the communication state they encode.
- [ ] **REQUIRED:** Recompute or restore belief contagion, interaction evidence, integrated beliefs, assessments, tactic transitions, metrics, and exports after communication is replaced.
- [ ] **REQUIRED:** Rebuild the active UI from restored canonical state rather than leaving incrementally appended records from a discarded attempt visible as current truth.

Downloaded export files and developer-console output cannot be withdrawn. The application must therefore distinguish active canonical history from any external or forensic records created by a discarded attempt.

## 18.5 Asynchronous model-work safety

The current model queue has no public cancellation, idle, queue-clearing, or simulation-generation invalidation API.

- [ ] **REQUIRED:** Prevent a model response created for a discarded timeline from committing into restored state.
- [ ] **OPEN DESIGN:** Allow rollback only after the model queue is fully idle.
- [ ] **OPEN DESIGN:** Add cancellation and request-generation tokens so stale results can be rejected safely.
- [ ] **OPEN:** Define behavior for backend requests that cannot be cancelled after transmission.
- [ ] **OPEN:** Add tests proving that stale queued or in-flight results cannot mutate restored state.

An idle-only first implementation is acceptable, but the idle condition must be authoritative rather than inferred from one disabled button.

## 18.6 History and identity policy

- [ ] **OPEN DESIGN:** Destructive rollback that removes the discarded attempt from active in-application history.
- [ ] **OPEN DESIGN:** Retain discarded attempts as an audit trail or alternate branch while excluding them from active simulation semantics.
- [ ] **OPEN DESIGN:** Keep the original cycle number and add an attempt identifier.
- [ ] **OPEN DESIGN:** Assign a new cycle number to the rerun.
- [ ] **OPEN DESIGN:** Define how message IDs, event IDs, evidence IDs, assessment IDs, and export filenames represent replacement attempts.
- [ ] **OPEN DESIGN:** Define how previously downloaded exports are labeled when their originating attempt is no longer active.

Counters must never be rewound independently of the records they identify.

## 18.7 Fresh rerun versus deterministic replay

The present engine uses unseeded randomness, live model generation, timestamps, and queue scheduling. It does not support exact deterministic replay.

- [ ] **OPEN DESIGN:** Treat rerun as a fresh attempt from the same restored state, allowing different random and model outcomes.
- [ ] **OPEN DESIGN:** Later support deterministic replay through seeded randomness and recorded model responses.
- [ ] **OPEN:** Decide whether both modes are useful.
- [ ] **OPEN:** If deterministic replay is adopted, version the replay contract and record every external input needed for reproduction.

Until deterministic infrastructure exists, the accurate term is **rollback and fresh rerun**, not exact replay.

## 18.8 Checkpoint architecture

- [ ] **OPEN:** Define a complete, versioned restore-state contract.
- [ ] **OPEN:** Decide whether checkpoints copy the entire authoritative run state or use a validated event-log reconstruction model.
- [ ] **OPEN:** Preserve the imported singleton identity of `G` or introduce a deliberate state-container abstraction.
- [ ] **OPEN:** Use a clone/serialization strategy that supports every authoritative runtime type.
- [ ] **OPEN:** Add checkpoint compatibility and migration rules.
- [ ] **OPEN:** Define checkpoint retention, memory limits, pruning, and user-visible availability.
- [ ] **OPEN:** Distinguish restore-grade checkpoints from diagnostic, attribution, and exporter snapshots.

`G.prevCycleSnapshot` is not a rollback checkpoint. It contains only the `G.sims` subtree, is captured before strategy at cycle start, is overwritten by the next cycle, and has no restore path.

## 18.9 UI and operator controls

- [ ] **OPEN:** Present only completed, safe rollback boundaries.
- [ ] **OPEN:** Disable rollback while the engine is not authoritatively idle.
- [ ] **OPEN:** Show exactly which phases and outputs will be discarded or recomputed.
- [ ] **OPEN:** Require explicit confirmation for destructive rollback.
- [ ] **OPEN:** Display active cycle and attempt identity after restoration.
- [ ] **OPEN:** Mark retained discarded attempts clearly if audit history is supported.
- [ ] **OPEN:** Re-render journals, cognition, relationships, timeline, metrics, and logs from the restored active state.

## 18.10 Rollback testing threshold

Rollback should not be considered runtime-safe until tests cover at least:

- [ ] Whole-cycle restoration.
- [ ] Post-psychology/pre-social restoration.
- [ ] Communication, overhearing, journal, thread, and scratchpad consistency.
- [ ] Message/event counter restoration without duplicate identifiers.
- [ ] Scratchpad cursor restoration without skipped or orphaned evidence.
- [ ] Relationship and belief-effect reversal.
- [ ] Downstream evidence, assessment, tactic-runtime, metric, and exporter invalidation.
- [ ] Autonomous-mode suspension.
- [ ] Stale model-result rejection.
- [ ] UI reconstruction without ghost records.
- [ ] Repeated rollback/rerun sequences.
- [ ] Checkpoint version mismatch and corruption handling.

The exact rollback product design remains open. The requirement that restoration happen only from a completed, idle boundary does not.

---

# 19. Immediate documentation-maintenance rule

When future scratchpad work lands:

1. Cross out an item only after the feature is runtime-wired.
2. Do not mark schema placeholders as completed systems.
3. Record the canonical producer, validator, committer, consumer, and UI/export path.
4. Mark architecture changes as **SUPERSEDED**, not merely “done.”
5. Add newly discovered implementation gaps under the relevant subsystem.
6. Keep goal, meta-awareness, and future agency work separate unless they share an actual runtime path.
