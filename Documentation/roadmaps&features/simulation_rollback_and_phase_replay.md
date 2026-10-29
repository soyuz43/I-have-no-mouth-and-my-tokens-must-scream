# Simulation Rollback and Phase Replay

**Repository area:** `js/core/saveLoad.js`, `js/core/replayTape.js`, `js/engine/cycle.js`
**Subsystem status:** Not implemented. This document is a design record, not a status report.

**Last reconciled:** 2026-10-28
**Verified against:** `8fbc95d` (2026-10-24)

This roadmap covers arbitrary simulation rollback and phase-boundary replay. It is **engine-wide**, not scratchpad-scoped: it touches the full authoritative run state, every phase boundary, the model queue, the exporter, and the UI. It was split out of the prisoner scratchpad roadmap, where it previously buried the scratchpad signal, because the scratchpad is only one of the restoration domains it must cover.

The scratchpad-specific restoration domains this roadmap must cover are listed in section 2.2 and cross-referenced from `Documentation/roadmaps&features/in_progress/prisoner_scratchpads&goals.md`.

---

## Status legend

- [x] ~~Crossed-out item~~ — **IMPLEMENTED** and wired into the runtime path, with relevant coverage.
- [ ] **OPEN** — no meaningful implementation was found in the reviewed source.
- [ ] **REQUIRED** — accepted design requirement that is not yet implemented.
- [ ] **OPEN DESIGN** — a future capability is accepted, but its exact semantics remain intentionally undecided.
- [ ] **NOT ASSESSED** — intentionally excluded from the relevant reconnaissance pass.

---

# 1. Current system in one sentence

Full-run Save/Load and model-response Replay Tape are implemented; arbitrary simulation rollback and phase replay remain planned capabilities.

At an idle cycle boundary, `exportState()` saves the JSON-compatible run-state payload from `G` (including Scratchpads, but excluding credentials and runtime-only handles), exporter state, PRNG streams, and Replay Tape; `importState()` restores that saved run. Replay Tape reuses responses for matching requests, but neither feature provides arbitrary phase-boundary rewind and rerun.

The repository also contains diagnostic, attribution, and exporter snapshots, including `G.prevCycleSnapshot`, pre/post/final belief snapshots, and exporter comparison state. `G.prevCycleSnapshot` is not a rollback checkpoint. No phase-replay controller, rollback UI, or rollback test suite was found.

---

# 2. Non-negotiable safety boundary

- [ ] **REQUIRED:** Permit rollback only when the engine is idle.
- [ ] **REQUIRED:** Permit rollback only after the selected phase or cycle boundary has completed.
- [ ] **REQUIRED:** Never restore state while a phase, model request, queued callback, commit, or autonomous-cycle transition can still mutate the active timeline.
- [ ] **REQUIRED:** Halt or suspend autonomous execution before restoration.
- [x] ~~Enforce an idle cycle boundary for full-run Save/Load.~~ `exportState()` rejects active cycles/model work; `importState()` waits for cycle and model-queue idleness.
- [ ] **OPEN:** Define authoritative completed-boundary semantics for arbitrary phase-level rollback.

The feature must not attempt to interrupt a phase halfway through and preserve whatever partial state happens to exist at that instant.

## 2.1 Candidate rollback boundaries

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
→ rerun evaluation, metrics, export, and finalization
```

Calling `runCommunicationPhase()` again without restoration would create a second communication pass on top of the first one and therefore does not qualify as rollback.

## 2.2 Required restoration scope

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

## 2.3 Downstream invalidation and rerun semantics

- [ ] **REQUIRED:** Invalidate or restore every downstream result produced after the selected checkpoint.
- [ ] **REQUIRED:** Restore communication histories and their sequence counters together.
- [ ] **REQUIRED:** Restore overhearing histories and their event counters together.
- [ ] **REQUIRED:** Restore scratchpad content and review cursors together.
- [ ] **REQUIRED:** Restore model threads together with the communication state they encode.
- [ ] **REQUIRED:** Recompute or restore belief contagion, assessments, tactic transitions, metrics, and exports after communication is replaced.
- [ ] **REQUIRED:** Rebuild the active UI from restored canonical state rather than leaving incrementally appended records from a discarded attempt visible as current truth.

Downloaded export files and developer-console output cannot be withdrawn. The application must therefore distinguish active canonical history from any external or forensic records created by a discarded attempt.

## 2.4 Asynchronous model-work safety

The model queue exposes status and an idle-wait path used by full-state loading. It does not expose cancellation or simulation-generation invalidation for arbitrary rollback.

- [ ] **REQUIRED:** Prevent a model response created for a discarded timeline from committing into restored state.
- [ ] **OPEN DESIGN:** Allow rollback only after the model queue is fully idle.
- [ ] **OPEN DESIGN:** Add cancellation and request-generation tokens so stale results can be rejected safely.
- [ ] **OPEN:** Define behavior for backend requests that cannot be cancelled after transmission.
- [ ] **OPEN:** Add tests proving that stale queued or in-flight results cannot mutate restored state.

An idle-only first implementation is acceptable, but the idle condition must be authoritative rather than inferred from one disabled button.

## 2.5 History and identity policy

- [ ] **OPEN DESIGN:** Destructive rollback that removes the discarded attempt from active in-application history.
- [ ] **OPEN DESIGN:** Retain discarded attempts as an audit trail or alternate branch while excluding them from active simulation semantics.
- [ ] **OPEN DESIGN:** Keep the original cycle number and add an attempt identifier.
- [ ] **OPEN DESIGN:** Assign a new cycle number to the rerun.
- [ ] **OPEN DESIGN:** Define how message IDs, event IDs, evidence IDs, assessment IDs, and export filenames represent replacement attempts.
- [ ] **OPEN DESIGN:** Define how previously downloaded exports are labeled when their originating attempt is no longer active.

Counters must never be rewound independently of the records they identify.

## 2.6 Fresh rerun versus deterministic replay

Full-state Save/Load captures the engine, UI, and research PRNG states. Replay Tape records model responses against request hashes and replays those responses for matching requests; a cache miss fails closed. Together these support reproducible continuation/branching when the saved state and required request responses are available. A changed prompt produces a different request hash and needs its own recorded response. This is distinct from arbitrary phase rollback and rerun.

- [x] ~~Save and restore full-run state, PRNG streams, exporter state, and Replay Tape at idle cycle boundaries.~~
- [x] ~~Record and replay model responses for matching request hashes.~~
- [ ] **OPEN DESIGN:** Define arbitrary rollback/phase-boundary rerun semantics separately from full-run Save/Load and request-level replay.
- [ ] **OPEN:** Specify how branches capture or supply model responses for branch-specific requests and how external inputs are controlled.

Use **Save/Load** and **Replay Tape** for the implemented capabilities; **rollback and phase replay** remain open.

## 2.7 Checkpoint architecture

- [ ] **OPEN:** Define rollback-specific phase/cycle checkpoints beyond the existing versioned full-run Save/Load envelope.
- [ ] **OPEN:** Decide whether checkpoints copy the entire authoritative run state or use a validated event-log reconstruction model.
- [x] ~~Preserve the imported singleton identity of `G` during full-state import.~~
- [ ] **OPEN:** Use a clone/serialization strategy that supports every authoritative runtime type.
- [ ] **OPEN:** Add checkpoint compatibility and migration rules.
- [ ] **OPEN:** Define checkpoint retention, memory limits, pruning, and user-visible availability.
- [ ] **OPEN:** Distinguish restore-grade checkpoints from diagnostic, attribution, and exporter snapshots.

`G.prevCycleSnapshot` is not a rollback checkpoint. It contains only the `G.sims` subtree, is captured before strategy at cycle start, is overwritten by the next cycle, and has no restore path.

## 2.8 UI and operator controls

- [ ] **OPEN:** Present only completed, safe rollback boundaries.
- [ ] **OPEN:** Disable rollback while the engine is not authoritatively idle.
- [ ] **OPEN:** Show exactly which phases and outputs will be discarded or recomputed.
- [ ] **OPEN:** Require explicit confirmation for destructive rollback.
- [ ] **OPEN:** Display active cycle and attempt identity after restoration.
- [ ] **OPEN:** Mark retained discarded attempts clearly if audit history is supported.
- [ ] **OPEN:** Re-render journals, cognition, relationships, timeline, metrics, and logs from the restored active state.

## 2.9 Rollback testing threshold

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
