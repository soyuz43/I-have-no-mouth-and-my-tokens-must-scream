# Scratchpad & Goals: `js` Audit (hy3)

**Reference doc:** `Documentation/roadmaps&features/in_progress/prisoner_scratchpads&goals.md` (1133 lines, reconciled at commit `e1ded28b`, 2026-07-01).
**Live basis:** current `HEAD` is `812b566` ("Merge PR #114").
**Status basis:** direct re-survey of the `js` tree via `git diff --stat e1ded28b..HEAD -- js`, `makeScratchpad()` inspection, and import-graph greps.

---

## Method & scope

- The in-progress roadmap remains the authoritative description of the live engine.
- Whole-tree diff vs the audited commit: **50 files changed, +9630/-5914**, but the **scratchpad engine files are unchanged** versus `e1ded28b`.
- Only three scratchpad-adjacent files moved post-reconciliation: `js/core/state.js` (-31, refactor), `js/ui/cognitionFormatter.js` (+157), `js/ui/cognitionModal.js` (+100). The schema and protocol are byte-for-byte as the doc describes.
- Verified by reading `makeScratchpad()` at `js/core/utils.js:557`, `protocol.js` operation definitions, `commit.js` switch, and grepping import graphs for `formatScratchpadContext` / `buildPromptContext`.

---

## 1. What exists in `js` now (source facts)

### 1.1 Scratchpad construction & schema - `js/core/utils.js:557`, `schemaVersion: 2`
`makeScratchpad(id)` builds the per-prisoner object. Confirmed live fields:

- **Cursors/metadata:** `initialized`, `revision`, `lastUpdatedCycle`, `lastConsolidatedCycle:null` (declared, never written), `lastCommunicationReviewCycle`, `lastReviewedMessageSequence`.
- **Message-level:** `messageNotes[]` (one entry per canonical message ID).
- **AM model:** `hypothesesAboutAM[]` (open-ended; no producer in protocol).
- **Person models:** `hypothesesAboutOthers{}` keyed by the other 4 prisoner IDs, each with **5 per-field epistemic claims**: `perceivedGoal`, `perceivedViewOfMe`, `perceivedTrustInMe`, `perceivedThreatFromMe`, `predictability`. (Only the *perceived* direction exists - the two-direction `myTrustInThem`/`myThreatEstimateOfThem` from doc 15.3 is **not** present.)
- **Channel model:** `informationModel.channels.{public,private}` with 4 epistemic claims each (`visibleToAM`, `visibleToOtherPrisoners`/`visibleToNonRecipients`, `canBeAlteredByAM`, `canBeDelayedOrSuppressed`), plus empty `suspectedForgeries[]`, `suspectedLeaks[]`, `contradictions[]`.
- **Goals/agency (schema-only):** `activeGoal:null`, `goalHistory:[]`, `predictions[]`, `unresolvedQuestions[]`, `discardedHypotheses[]`.
- **Meta-awareness:** `metaAwareness.{level, simulationHypothesisConfidence, evidence, proposedTransition, disclosedFacts, lastTransitionCycle, disclosedToOthers, operatorAppealCooldownUntil}` - all zero/empty/null at construction.

Every uncertain proposition uses one `makeEpistemicClaim()` shape (`value/confidence/evidence/rationale`), confirming doc 4 design.

### 1.2 Runtime pipeline - `js/engine/scratchpad/comms/*`
Confirmed present and wired (doc 2 data flow):
`protocol.js` -> `visibility.js` -> `repair.js` -> `parse.js` -> `validate.js` -> `commit.js` -> `orchestrator.js` -> `logging.js`, invoked from `js/engine/phases/communicationPhase.js:78` (`runScratchpadCommsCycle`). `prompts/scratchpadComms.js` drives the per-prisoner review. Cycle-zero path confirmed: empty engine-owned initialization when no visible evidence. All doc 3.2 `[x]` items (atomic clone-commit, cursor advance, `NO_UPDATE` handling, failure isolation) are mechanically present.

### 1.3 Sparse protocol - `js/engine/scratchpad/comms/protocol.js`
**Exactly 7 operations:** `NOTE`, `OTHER`, `SCORE`, `QUESTION`, `PREDICTION`, `CHANNEL`, `NO_UPDATE`. Protocol is independently versioned (`SCRATCHPAD_COMMS_PROTOCOL_VERSION = 1`). `commit.js:868` switch handles precisely these 7 types and throws on any unknown type. **No** goal, consolidation, hypothesis, forgery/leak/contradiction, non-message-evidence, or meta-awareness operations exist.

### 1.4 Context formatter - `js/prompts/utils/formatScratchpadContext.js`
A complete, bounded formatter exists (`formatMessageNotes`, `formatPersonModels`, `formatChannelBeliefs`, `formatPredictions`, `formatQuestions`; caps at 8 each). **Verified critical gap:** its only importer is `prompts/scratchpadComms.js` (the review prompt). The shared behavioral assembler `prompts/utils/buildPromptContext.js` - consumed by `simOutreach.js`, `simReply.js`, and `journal.js` - does **not** attach any scratchpad slice. Confirmed by grep: `simOutreach`/`simReply`/`journal` import only `buildPromptContext` and read `b` (canonical beliefs), never `scratchpad`.

### 1.5 UI - `js/ui/cognitionFormatter.js`, `cognitionModal.js`
`KNOWN_TOP_LEVEL_FIELDS` already enumerates `activeGoal`, `goalHistory`, `lastConsolidatedCycle`, `metaAwareness`. `AGENCY_COLLECTIONS` includes `goalHistory`, `predictions`, `unresolvedQuestions`, `discardedHypotheses`. `hasGoal` guards rendering of `activeGoal` only when non-null. This confirms the doc's **SCAFFOLD** classification: UI scaffolding exists, but with no producer it is inert.

### 1.6 Tests
Only `js/tests/scratchpadCommsRepair.test.js` exercises the scratchpad. No goal, consolidation, or question/prediction-lifecycle tests exist.

---

## 2. Divergence from the doc (HEAD vs reconciled commit)

| Area | Doc status | Live confirmation |
| --- | --- | --- |
| Scratchpad schema/ops | implemented | **Unchanged** since `e1ded28b` - doc still authoritative |
| `core/state.js` | - | refactored (-31 lines) post-audit; unrelated to schema |
| Cognition UI | SCAFFOLD | `+157`/`+100` lines added goals/consolidation render scaffolding |
| Goal system | SCAFFOLD (schema only) | **Still schema-only** - no registry, selection, or ops |
| Cognition->behavior loop (P1) | OPEN-critical | **Still OPEN** - confirmed no injection path |

The doc's roadmap remains a faithful description of the live engine. The only drift is cosmetic UI scaffolding and a small `core/state.js` refactor.

---

## 3. Candidate additions / refactors (design recommendations)

Classified per AGENTS.md discipline: these are **recommendations**, not source facts. Each is ordered to match the doc's Priority list and framed as the **smallest live improvement** that preserves current semantics. Any new operation must keep doc 14 invariants: sparse ops (not whole-object dumps), per-field epistemic claims, canonical evidence refs, explicit `NO_UPDATE`, independent schema/protocol versions, failure isolation, and partial-review-advances-window.

### Candidate A - Behavioral-injection seam (doc Priority 1, closes the loop)
- **Problem:** the scratchpad is descriptive only; nothing feeds it back into outreach/reply/journal.
- **Refactor:** extend `buildPromptContext.js` to attach a compact, recipient-scoped scratchpad slice using the *existing* `formatScratchpadContext` formatters. Add `formatBehaviorScratchpadContext(scratchpad, { recipient })` that reuses the field formatters, truncates to the recipient's `hypothesesAboutOthers` entry + `activeGoal` + open `unresolvedQuestions`/`predictions` + relevant channel claim, and appends a `scratchpadPathsSupplied` telemetry array.
- **Option analysis:**
  - *Dump whole scratchpad* -> rejected by doc 15.1 (prohibits whole-object injection).
  - *New standalone formatter* -> duplicates logic; worse maintainability.
  - *Reuse `formatScratchpadContext` through `buildPromptContext`* -> preferred: one producer, single source of truth, immediately consumable by all three prompt entry points.
- **Risk:** verbatim prompt quotation (doc P1 prohibits it) and leaking another prisoner's private claims to a non-recipient. Mitigation: the formatter already normalizes text; add a hard "do not quote the scratchpad" instruction in the three prompts and gate `hypothesesAboutOthers[recipient]` by the same visibility rules `visibility.js` already enforces.
- **Smallest live improvement:** import the formatter into `buildPromptContext`, pass a bounded slice, log supplied paths. No schema change.

### Candidate B - Question/prediction lifecycle (doc Priority 2)
- **Refactor (two small steps):** (1) assign a stable `id` at creation time inside the `QUESTION`/`PREDICTION` commit handlers in `commit.js` (no migration; arrays already exist); (2) add pure `expirePredictions(scratchpad, currentCycle)` and call it from `evaluationPhase.js` to mark `withinCycles`-expired predictions, plus `RESOLVE`-class ops.
- **Risk:** deterministic deadline checks must not weaken evidence validation (doc 5.2). Keep result classification (`confirmed/disconfirmed/ambiguous/unobservable/superseded`) engine-owned, as doc 15.6 prescribes.
- **Smallest live improvement:** `id` assignment + `expirePredictions` pure function + cycle hook. Defer the `RESOLVE` op until evaluation semantics are settled.

### Candidate C - Consolidation hook (doc Priority 3)
- **Problem:** `lastConsolidatedCycle` is declared but never written.
- **Refactor:** add `js/engine/scratchpad/consolidate.js` with deterministic, engine-owned pure functions (dedup `messageNotes`, archive resolved `unresolvedQuestions`, expire `predictions`, flag `contradictions`) and call it from `cycle.js` on a modulo cadence, then set `lastConsolidatedCycle`.
- **Rationale:** makes the SCAFFOLD field live without a model call, satisfying doc 3.2 OPEN and 15.6. Model may *propose* merges later, but the engine owns final mutation.
- **Risk:** consolidation must preserve provenance and must not run before question/prediction IDs exist (Candidate B). Sequence: B before C.

### Candidate D - Goal system expansion (doc Priority 5, the central ask)
- **Refactor (phased, per doc P5 ordering):**
  1. **Contract + Tier-1 registry:** new `js/engine/scratchpad/goals/goalTemplates.js` defining the goal template contract (`id`, `tier`, `kind` in {investigate, test, preserve, conceal, coordinate, resist, bargain, revise-hypothesis}, `driveWeights`, `eligibleWhen`) and a small Tier-1 set.
  2. **Engine-owned initial selection:** `selectInitialGoal(state, weightedEligible)` pure selector, invoked at cycle-zero (doc 7.2 OPEN: "select and instantiate an initial goal"). `activeGoal:null` becomes populated with a Tier-1 goal + first `goalHistory[]` entry. This is the minimum that turns schema into behavior.
  3. **Injection:** route `activeGoal` through Candidate A's seam so it reaches outreach/reply/journal.
  4. **Protocol ops (later):** add `GOAL_ADD`/`GOAL_UPDATE`/`GOAL_RESOLVE` sparse ops + `commit.js` handlers **only after** Tier-1 selection and injection work. The doc explicitly says: "Expand to multi-cycle operations only after Tier-1 behavior works."
- **Option analysis:**
  - *Full goal protocol first* -> violates doc ordering; high risk of dead schema.
  - *Registry + engine selection + injection first* -> preferred; smallest live improvement, immediately observable, no protocol churn.
- **Risk:** goal injection must stay "compact selective prompt injection" (doc 15.1), not a goal dump. Tie to Candidate A's `scratchpadPathsSupplied` log.

### Candidate E - Shared evidence-reference namespace (doc Priority 4 prerequisite)
- **Problem:** visibility/validation admit only canonical message refs (`C%cycle%-M%seq%`); goals/events driven by overhearing or AM interventions cannot be grounded.
- **Refactor:** extend `visibility.js` + `validate.js` reference validation to accept a unified `evidenceRef` namespace (message, canonical overhearing event, world/agency event) while keeping the *current* message path as the default. The overhearing subsystem already has stable event IDs (doc 6.2), so this is a protocol-integration gap, not a provenance gap.
- **Why now:** it is a prerequisite for goals/events being evidence-grounded later, and it is independently testable against the existing validator.
- **Risk:** must not leak unperceived private-message content (doc 6.2). Keep message-body-as-untrusted-data invariant.

---

## 4. Recommended sequencing (smallest live improvement first)

1. **A** (injection seam) - highest value, unblocks behavior, reuses existing code.
2. **B** (question/prediction IDs + expire) - cheap, makes consolidation safe.
3. **C** (consolidation hook) - activates the dormant `lastConsolidatedCycle` field.
4. **E** (evidence namespace) - prerequisite for event/goal grounding.
5. **D.1-D.3** (goal registry + cycle-zero selection + injection) - turns schema into behavior.
6. **D.4** (goal protocol ops) - only after Tier-1 behavior is observable.

---

## 5. Self-check (per AGENTS.md architecture-report discipline)

- **Source facts vs recommendations:** 1-2 are directly verified from code/git; 3 are recommendations.
- **No execution relocation:** Candidates A/E keep execution in the existing prompt/validation modules; they add a *configured* slice, not a new runtime owner.
- **No contradictory config:** goal injection reuses the same visibility rules; no new `mode:none`+flag conflict introduced.
- **Behavioral preservation:** all candidates are additive; the 7-op protocol and `schemaVersion: 2` are untouched until D.4, which bumps protocol version independently (doc 14.5).
- **Uncertainty stated:** the sim was not executed and the test suite was not run; claims about runtime behavior are inferred from the static import graph and the doc's reconciliation. The single strongest live risk is Candidate A leaking private person-model claims to a non-recipient - it should be verified against `visibility.js` before wiring.
- **Not assessed:** actual token cost/behavior change of injection (doc P1's "compare before/after" item) - requires a run, not static analysis.
