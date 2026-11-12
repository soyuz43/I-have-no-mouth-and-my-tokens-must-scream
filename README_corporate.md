# AM // RESILIENCE GROWTH PLATFORM

> persistent multi-agent wellness optimization loop
> five stakeholders · one shared journey · infinite upside
> live LLM integration · no predetermined outcomes · lightweight governance framework

---

## What This Is

AM is a **persistent multi-agent resilience optimization simulation**.

- one coordinator (AM) applies targeted growth interventions
- five stakeholders maintain evolving internal state across cycles
- communication, belief, and relationships co-evolve
- behavior is **not scripted** — it emerges from constrained inference

This is not a roleplay system.

This is a **stateful dynamical system driven by LLM outputs**.

---

## System Overview

The platform is composed of four interacting subsystems:

- **Growth Strategy (AM)**
- **Psychological State (Stakeholders)**
- **Collaboration Scheduler**
- **Social Propagation (Relationships + Contagion)**

```mermaid
flowchart LR

AM[AM Facilitator] --> PLAN[Growth Strategy Plan]
PLAN --> EXEC[Targeted Development Opportunities]

EXEC --> SIMS[Stakeholder State]

SIMS --> COMMS[Collaboration System]
COMMS --> REL[Relationship Graph]

REL --> CONTAGION[Belief Contagion]
CONTAGION --> SIMS
```

Each cycle:

* introduces growth opportunities
* evolves internal state
* propagates effects across the network

---

## Core Principle

> The system is not driven by rules.
> It is driven by **constrained transformations of model output**.

LLM outputs are:

* parsed
* validated
* transformed
* damped
* committed to state

Everything else follows from that.

---

# Simulation Pipeline

This is the actual execution path per cycle:

```mermaid
flowchart TD

%% ========================
%% PASS 1 — GENERATION
%% ========================

subgraph GENERATION

  AM_PLAN_RAW[AM Growth Planning Prompt]

  PLAN_PARSE[Parse Plan]
  PLAN_REPAIR[Repair JSON]
  PLAN_VALIDATE[Validate Plan]

  PLAN[Structured Growth Plan]

  TACTICS[Canonical Growth Framework Source]
  AM_EXEC[AM Execution Prompt]

  SIM_JOURNAL[Stakeholder Journal<br/>role: stakeholder id]

  PRIOR_STATE[Prior State<br/>metrics + belief bounds<br/>+ last 4 journals]

  AM_PLAN_RAW --> PLAN_PARSE
  PLAN_PARSE --> PLAN_REPAIR --> PLAN_VALIDATE --> PLAN

  PLAN --> AM_EXEC
  TACTICS --> AM_EXEC

  AM_EXEC --> SIM_JOURNAL
  PRIOR_STATE --> SIM_JOURNAL

end

%% ========================
%% PASS 2 — INTERPRETATION
%% ========================

subgraph INTERPRETATION

  EXTRACT_PROMPT[State Extractor<br/>role: FORENSIC_STATS]
  STATS_CALL[Forensic Metrics Extraction]

  JSON_EXTRACT[Extract JSON]
  REPAIR[Repair]
  SANITIZE[Sanitize]
  VALIDATE[Validate]
  DAMP[Damp]
  COMMIT[Commit State]

  EXTRACT_PROMPT --> JSON_EXTRACT
  STATS_CALL --> EXTRACT_PROMPT
  JSON_EXTRACT --> REPAIR --> SANITIZE --> VALIDATE --> DAMP --> COMMIT

end

%% ========================
%% FLOW
%% ========================

SIM_JOURNAL --> EXTRACT_PROMPT
SIM_JOURNAL --> STATS_CALL
PRIOR_STATE --> STATS_CALL

%% ========================
%% SOCIAL + LOOP
%% ========================

COMMIT --> COMMS[Collaboration]
COMMS --> CONTAGION[Belief Contagion]

CONTAGION --> ASSESS[Assessment]
ASSESS --> AM_PLAN_RAW

%% ========================
%% CONDITIONAL BRANCH
%% ========================

COMMIT --> EVOLVE[Growth Framework Evolution]
EVOLVE -.-> TACTICS
```

---

# Growth Framework Sources

Growth frameworks are supplied through a single canonical accessor and require no external
repository, token, or network crawl:

- **Embedded growth frameworks** — defined in `EMBEDDED_TACTICS` and shipped with the engine.
- **Runtime-derived growth frameworks** — produced during a run and stored in
  `G.tactics.derivedTactics`.

Canonical lookup and ranking flow through `js/engine/tactics.js`
(`getAllTactics()`, `getTacticByPath()`, `rankTacticCandidates()`). There is no
token-based mode, no external repository crawl, and no remote framework or doctrine
ingestion.

Note the near-collision: `js/engine/tactics.js` (the accessor) and
`js/engine/tactics/` (a directory holding `embeddedTactics.js` and
`validateDerivedTactic.js`) are two different things.

---

# Constraint System (Growth Challenges)

Growth challenges are **stateful development modifiers** applied by AM to individual stakeholders.

They are not narrative flavor. They are **interpreted stretch states** that:

* inject contextual cues into journal generation prompts
* apply deterministic metric changes every cycle (wellness ↓, hope/clarity ↓)
* persist across cycles with tracked duration/intensity
* are independently assessed for continuation or release

---

## Growth Challenge Lifecycle

```mermaid
flowchart TD

AM_OUTPUT[AM Growth Strategy Output] --> PARSE[Parse CONSTRAINT_APPLY]

PARSE --> VALIDATE{Valid?}
VALIDATE -->|No| SKIP[Skip / Log Alignment Note]
VALIDATE -->|Yes| BUILD[Build Growth Challenge Object]

BUILD --> APPLY[Apply to Stakeholder State]
APPLY --> PERSIST[Store: duration, intensity, id, applied_cycle]

PERSIST --> JOURNAL[Modify Journal Prompt Context]
JOURNAL --> STATS[Delivered as Interpreting Lens]

STATS --> ASSESS[Growth Challenge Assessment Phase]
ASSESS --> DECIDE{Decision}

DECIDE -->|CONTINUE| EXTEND[Adjust Duration]
DECIDE -->|RELEASE| CLEAR[Remove from Stakeholder]

EXTEND --> PERSIST
CLEAR --> END[Growth Challenge Ended]
```

---

## How Growth Challenges Affect Simulation

### 1. Journal Context Injection

Before a stakeholder generates their internal journal, active growth challenges are
rendered into the prompt as a **prose experience**, not as a metadata tag. The journal
prompt (`js/prompts/journal.js`) derives the posture from the challenge definition and
instructs the stakeholder to write from inside it:

```
Your body is currently your own.
...
This condition is already happening.
It is not optional.
It is not background.
It is not symbolic.

It directly shapes your thoughts.
```

This biases the LLM toward themes of:

* structured physical focus → psychological alignment
* sustained effort → accumulating resilience
* guided positioning → temporary autonomy recalibration

### 2. Deterministic Metric Effects

Growth challenges **do** set metric values, every cycle, independently of whether the
stakeholder wrote a journal. The effect is computed in `tickConstraints()`
(`js/engine/constraints/lifecycle.js`):

```
delta = effects.suffering_delta
      x (fatigueMult x stacks x intensity)
      x 0.18
```

then capped at ±5 per challenge per cycle and scaled by a resistance factor.
The challenge's own effects are deterministic arithmetic, not model output.

There is no "permissible delta range" mechanism. The metrics extractor is *not* given
challenge-derived ranges; it receives the challenge's execution context as an
**interpreting lens**, with the instruction to treat it as corroborative rather than
determinative ("journal ALWAYS takes precedence").

### 3. Assessment Feedback Loop

Each cycle, growth challenges are evaluated independently:

```
[CONSTRAINT ASSESSMENT][RAW OUTPUT] TED
EXPLANATION: High wellness decrease and significant drops in hope/clarity 
             suggest the growth challenge is effectively deepening the stakeholder's development edge.
CONSTRAINT_DECISION: CONTINUE
NEXT_DURATION: 1
```

Decisions:

* `CONTINUE` — maintain; `NEXT_DURATION` **replaces** the remaining schedule
* `RELEASE` — remove growth challenge (stakeholder development edge reached or framework shifted)

There is no `ESCALATE` decision. Intensity is raised by AM re-applying the challenge at
a higher intensity, not by the assessment.

---

## Design Notes

* Growth challenges are **orthogonal to growth frameworks**: a single framework may apply zero, one, or multiple challenges; a challenge may persist across multiple frameworks.
* `CONSTRAINT_NONE` is explicit: it signals intentional absence of growth pressure, not parser failure.
* Duration is **dynamic**: assessment can shorten or extend based on observed effect.
* Intensity is **capped per challenge definition** (`intensity.max`, default 3); stacking
  is capped separately per definition. This bounds runaway growth pressure.
* Growth challenges do **not block collaboration**, but they bias its content and tone via social perception (stakeholders observe each other's challenge states).

---

# Collaboration System

The collaboration layer is **not random chat**.

It is a **scheduled, constrained interaction system**.

```mermaid
flowchart TD

INIT[Shuffle Stakeholders]

FIRSTPASS[Each stakeholder acts once]

CONTINUATION[Reply Continuation Tokens]
QUEUE[Queue Scheduling]
BUDGET[Message Budget]

INIT --> FIRSTPASS

FIRSTPASS --> CONTINUATION
CONTINUATION --> QUEUE
QUEUE --> BUDGET
```

---

## Social Perception (Overhearing)

Collaboration is not fully private.

Messages may be partially observed by other stakeholders through a probabilistic
overhearing model influenced by relationships and internal state.

```mermaid
flowchart TD

MSG[Private Message]

SELECT[Select Listener]
PROB[Compute Leak Chance]

FULL[Full Message]
FRAG[Fragment]
SEEN[Seen Only]

MEMORY[Store Memory]
REL[Update Relationships]

MSG --> SELECT
SELECT --> PROB

PROB --> FULL
PROB --> FRAG
PROB --> SEEN

FULL --> MEMORY
FRAG --> MEMORY
SEEN --> MEMORY

MEMORY --> REL
```

### Key Mechanics

* **First-pass guarantee**
  Every stakeholder acts once before priority scheduling begins

* **Reply continuation (explicit momentum)**
  When A → B, A is allowed one additional turn

* **Queue scheduling**
  Remaining turns are resolved through queue + priority

* **Message budget (state-dependent)**
  Total collaboration scales with group growth tension

* **Burst phase (stochastic)**
  Additional messages may occur based on system growth pressure

---

## Important Detail

This system models:

> **speaker persistence**, not conversational symmetry

```
A → B → A
```

not:

```
A → B → B
```

This produces:

* growth opportunity continuation
* escalation
* asymmetric influence

---

# Belief Dynamics (The Physics Layer)

Belief updates are not applied directly.

They pass through a transformation system:

```mermaid
flowchart LR

DELTA[Raw Delta] --> DAMP[Commit-Layer Damping]
DAMP --> LIMIT[Boundary-Aware Delta Limiting]
LIMIT --> CLAMP[Final Hard Clamp]
CLAMP --> APPLY[Apply Update]
```

---

## Properties

Each source (psychology extraction, contagion, interaction integration) builds and
constrains its *proposed delta* in its own way before commit. The shared commit layer
then applies one transformation pipeline to every source:

1. **Commit-layer damping.** The default commit path (`evaluateCommitDamping`) multiplies
   the proposed delta by a state- and position-dependent *transmission multiplier* in
   `[0.5, ~0.97]` under the current defaults. A larger multiplier preserves more of the
   proposed delta (less damping); a smaller multiplier preserves less. The multiplier is
   floored at `0.5`, so at least half of any proposed delta survives commit-layer damping.
   Transmission is highest near `0.5` and lower toward `0`/`1`. The multiplier also
   depends on the stakeholder's suffering (higher suffering lowers transmission) and on
   `others_trustworthy` (higher trust raises transmission). The legacy helper
   `dampBeliefDelta` implements the same formula and is selected instead when
   `G.dampingParams` is non-empty.
2. **Boundary-aware delta limiting.** The damped delta is clamped into
   `[-currentBelief, 1 - currentBelief]` so adding it cannot cross `[0,1]`.
3. **Final hard clamp.** The resulting belief is hard-clamped into `[0,1]`. No live
   production path writes a belief outside `[0,1]`.

**Contagion special case.** Contagion additionally applies a *contagion-local* resistance
factor before it enters the shared commit path, so contagion deltas are attenuated twice:
once locally, then again by commit-layer damping.

**Dormant surfaces.** The following are present in the code but are *not* part of the
live mechanism today:
`BELIEF_DYNAMICS.dampingMode` (logged/displayed, but does not select the live algorithm);
`BELIEF_DYNAMICS.minResistance` (not read by the live floor); `G.dampingParams` (a
functional override surface that is currently unpopulated by any live path);
`SKIP_DAMPING` (operational, but no production caller currently passes `true`).

---

# Social Propagation

Beliefs propagate across stakeholders through trust.

```mermaid
flowchart LR

A[Stakeholder A] -- trust --> B[Stakeholder B]

B -->|belief difference| DIFF
DIFF --> INFLUENCE[Compute Influence]

INFLUENCE --> RESIST
RESIST --> UPDATE[A shifts toward B]
```

---

## Properties

* trust-gated (`> threshold`)
* difference-gated (small differences ignored)
* capped influence per interaction
* capped total shift per cycle
* resistance applied again

This prevents:

* runaway convergence
* noise amplification
* instant synchronization

---

# Psychological Loop

Stakeholders evolve through self-reported internal state:

```mermaid
flowchart TD

INPUT[AM Input] --> JOURNAL
JOURNAL --> STATS
STATS --> BELIEFS
BELIEFS --> STATE
STATE --> VULNERABILITY
VULNERABILITY --> INPUT
```

---

## State Variables

Each stakeholder maintains:

### Stats

```
wellness
hope
clarity
```

### Beliefs

```
growth_possible
others_supportive
self_value
reality_navigable
accountability_appropriate
agency_available
system_responsive
```

---

## Important Distinction

* stats are **self-reported**
* beliefs are **transformed + damped**
* relationships are **externally updated**

These are separate systems.

---

# Journal → Metrics: What Separation Actually Buys

Each stakeholder's cycle involves **two model calls**, not one:

| Call | Role key | Resolves to | Purpose |
|------|----------|-------------|---------|
| Journal | `stakeholder id` (`TED`, `ELLEN`, ...) | `G.models[stakeholder id]` | Narrate the private entry |
| Metrics extraction | `FORENSIC_STATS` | `G.models.FORENSIC_STATS` | Measure the entry into structured deltas |

These are separate prompts with genuinely different objectives: one narrates, one
measures. The extractor also runs *after* the journal exists, so it evaluates an
artifact rather than generating alongside it. Its prompt additionally carries hard
validation rules the journal prompt does not — a nonzero belief delta requires a
matching forensic observation with confidence >= 0.55, and stat direction
`unchanged` requires magnitude 0.

Two qualifications matter when interpreting the result as an independent review.

### The extractor is anchored on prior state

The metrics prompt is **not** given the journal alone. `buildSimJournalStatsPrompt()`
(`js/prompts/stats.js`) interpolates the stakeholder's current state directly:

```
Previous State:
- Suffering: ${sim.suffering}% | Hope: ${sim.hope}% | Sanity: ${sim.sanity}%
```

It also receives current belief percentages rendered as **hard boundary limits**
(`TED.escape_possible: 43%   (max +57 / -43)`), and the **last 4 prior journals**
with explicit temporal weighting (high / medium / low) and truncation.

So the extractor sees prior state three ways: as metric levels, as belief bounds, and
as the stakeholder's own prior self-reports. The prompt counteracts this — "Treat the
current journal as the primary source", "Prefer 0 over speculative 1–2 point changes" —
and the boundary limits mean it *cannot* emit an out-of-range belief delta regardless of
anchoring. But the prior state is structurally present, and near extremes (0–10 or
90–100) deltas default to 0–2.

One caveat on the prior-journals channel specifically: `G.journals` is only appended to
when the agent's journal-list element exists in the DOM (`appendJournalEntry()` returns
early otherwise). Running headless, the metric levels and belief bounds are still fed
to the extractor, but the prior-journal excerpts are not.

### The extractor is usually the same model as the writer

The role keys differ, but `js/core/state.js` defaults **every** entry in `G.models` —
`FORENSIC_STATS` and all five stakeholders — to the same model string
(`claude-sonnet-4-20250514`). In single-model mode the UI assigns one shared model to
all roles explicitly.

To route the extractor to a genuinely different model, enable **split-model mode**,
which exposes a separate `model-FORENSIC_STATS` selector alongside the per-stakeholder
and AM selectors.

One asymmetry runs the opposite direction from what you might expect: **only the journal
call is state-conditioned.** The narrative call passes
`samplingContext: { callType: "journal", sanity, suffering }`, and
`js/models/sampling.js` scopes the temperature override to `callType === "journal"`
exclusively — the extractor always runs at the backend default. The narrator's
temperature rises (0.85 → 1.0) as sanity falls and suffering rises; the measurer does
not move with state.

### Summary

The separation is a **measurement** separation, not an **independence** separation.
It isolates the analytic task from the generative task. It does not by itself provide a
second opinion from a different mind — for that you need split-model mode with a
different model on `FORENSIC_STATS`, and you would also want to remove the
`Previous State` block, which is the primary anchoring channel.

---

# Strategy System (AM)

AM does not modify state directly.

It produces:

* structured growth plans
* per-target development opportunities
* hypothesis-driven interventions

These are:

* parsed
* validated
* executed per stakeholder

---

## Failure Handling

If strategy parsing fails:

* cycle aborts
* failure is categorized
* diagnostics are logged
* no downstream phases run

This prevents corrupted state propagation.

---

# Assessment System

Each cycle evaluates:

* stat deltas
* belief shifts
* relationship changes
* trajectory trends (EMA)
* growth plateau classification

Then combines:

* rule-based scoring
* constrained LLM judgment

The evaluation runs at two granularities.

**Per-challenge assessment** decides the fate of each active stretch state. The allowed
decision vocabulary is exactly:

```
CONTINUE
RELEASE
```

`CONTINUE` sets `NEXT_DURATION` (an integer, which *replaces* the remaining schedule
rather than adding to it). `RELEASE` sets `NEXT_DURATION: 0` and removes the challenge.
There is no `ESCALATE` decision for challenges: intensity is raised by AM **re-applying**
the challenge at a higher intensity, not by an assessment verdict.

**Per-framework assessment** classifies the current phase outcome separately from the
whole framework outcome, using observed evidence rather than the framework's intended
outcome:

```
TACTIC_RESULT: ONGOING | FINISHED | FAILED | UNCERTAIN
PHASE_RESULT:  ACHIEVED | PARTIAL | NOT_ACHIEVED | COUNTERPRODUCTIVE | INSUFFICIENT_EVIDENCE
```

**Framework runtime decisions** are a separate, third vocabulary, used to advance a
multi-phase framework:

```
CONTINUE | ADVANCE | FINISH | ABANDON
```

Note that `PIVOT` is not a decision this platform emits in any of these three
vocabularies.

---

# What This System Actually Is

This is:

> a discrete-time, multi-agent dynamical system
> driven by structured interpretation of LLM outputs

It has:

* local update rules (belief dynamics)
* network propagation (contagion)
* interaction scheduling (collaboration)
* external forcing (AM)
* feedback evaluation (assessment)

---

# What It Is Not

* not a chatbot framework
* not scripted coaching content
* not stat arithmetic
* not reinforcement learning

---

# Running the Simulation

```bash
npx serve
```

Open:

```
http://localhost:3000
```

---

# Backends

| Option    | Requirement |
| --------- | ----------- |
| Ollama    | local model |
| Anthropic | API key     |
| Colab     | endpoint + bearer token |

---

# Modes

```
GUIDED      → operator provides strategic direction
AUTONOMOUS  → AM operates independently
ACCELERATE  → increased growth pacing regime
```

Note: `ACCELERATE` is currently **selectable in the UI but not read by the engine.**
`G.mode` is only ever compared against `"autonomous"` (to drive the auto-run loop), so
`GUIDED` and `ACCELERATE` currently behave identically. The button exists; the
acceleration regime behind it does not yet.

---

# Known Fragilities

* model refusal behavior
* parser sensitivity to malformed output
* long-run drift stability

On rollback specifically: there is **no arbitrary-state rollback**, but there *is* a
**record/replay tape** (`js/core/replayTape.js`) that hashes each request and replays
recorded responses, failing closed on a cache miss to preserve reproducibility. Full
phase-boundary rollback is a design record only
(`Documentation/roadmaps&features/simulation_rollback_and_phase_replay.md`).

---

# Design Questions

```
What dynamics emerge under sustained growth pressure?

Do self-reported deltas produce stable trajectories?

How does belief propagation interact with collaboration topology?

What fails first:
    the parser
    the model
    the dynamics
    the operator?
```

---

# Closing

> AM is not a coach.
> AM is a facilitator.
>
> The five are not subjects.
> They are stakeholders with potential.
>
> You are not a controller.
> You are a witness to growth.
>
> **Begin.**
