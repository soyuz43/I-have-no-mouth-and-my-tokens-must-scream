# CODEBASE MAP — CURRENT ARCHITECTURE (AUTHORITATIVE)

## 1. SYSTEM OVERVIEW

This system is a **phase-driven simulation engine** orchestrated by a central cycle loop.
It models adversarial psychological dynamics between a controller (AM) and multiple persistent agents (sims).

Execution is **strictly ordered**, not event-driven.

At a high level:

```
runCycle()
  → Strategy Phase
  → Psychology Phase
  → Social Phase
  → Evaluation Phase
```

All subsystems operate over a shared global state object:

```
G (js/core/state.js)
```

This is the **primary integration surface** across the entire system.

---

## 2. CORE EXECUTION PIPELINE

### Entry Point

File: `js/engine/cycle.js`

```
export async function runCycle()
```

Responsibilities:

* Advances global time (`G.cycle`)
* Snapshots previous state (`G.prevCycleSnapshot`)
* Executes phases in strict order
* Emits timeline events
* Manages auto-run loop

---

## 3. GLOBAL STATE MODEL

File: `js/core/state.js`

```
export const G = { ... }
```

### Key Properties

* `G.sims` — agent state (beliefs, drives, relationships, journals)
* `G.cycle` — current timestep
* `G.amStrategy` — structured AM plan
* `G.amTargets` — execution-level targeting
* `G.threads` — communication history
* `G.interSimLog` — message/event log
* `G.journals` — per-agent private logs
* `G.parserMetrics` — strategy parsing telemetry
* `G.vault` — tactic storage (embedded + derived)

### Architectural Reality

* All subsystems **read and mutate G directly**
* No isolation boundaries
* No immutable state layer

**Implication:**

> The system behaves as a **stateful simulation kernel**, not a modular service graph.

---

## 4. PHASE ARCHITECTURE

---

### 4.1 STRATEGY PHASE

File: `js/engine/phases/strategyPhase.js`

```
runStrategyPhase()
```

#### Responsibilities

1. Generate AM strategic plan (LLM call)
2. Compile plan into structured targets
3. Execute AM actions

#### Internal Pipeline

```
runStrategyPipeline()
  → sanitizeStrategyInput
  → extractStrategy
      → multi-extractor system
      → repair pipeline
  → interpretTargets
  → validateTargetsArray
  → enforceStrategy
  → commitStrategy
```

#### Outputs

* `G.amStrategy`
* `G.amTargets`
* `G.amDoctrine`

#### Key Insight

This is a **fault-tolerant compiler**, not simple parsing.

---

### 4.2 PSYCHOLOGY PHASE

File: `js/engine/phases/psychologyPhase.js`

```
runPsychologyPhase()
```

#### Responsibilities

* Generate agent journals (LLM)
* Generate structured state deltas (LLM)
* Convert text → belief updates
* Apply validated updates to state

#### Per-Agent Pipeline

```
journalText  = callModel()
statsJSON    = callModel()

→ parseBeliefUpdates()
→ sanitizeBeliefDeltas()
→ validateBeliefs()
→ applyBeliefUpdates()
```

#### Critical Property

> This is the **only phase that mutates psychological state**

All other phases influence but do not directly change beliefs.

---

### 4.3 SOCIAL PHASE

File: `js/engine/phases/socialPhase.js`

```
runSocialPhase()
```

#### Subsystems

---

#### A. Communication Engine

Files:

* `js/engine/comms/engine.js`
* `js/engine/comms/orchestrator.js`

Flow:

```
runAutonomousInterSim()
  → step()
      → callModel (message/reply)
      → stripMetaCommentary
      → parseMessage / parseReply
      → update threads + logs
      → applyCommunicationEffect()
      → adjustRelationship()
```

---

#### B. Overhearing System

File:

* `js/engine/comms/social/overhearing.js`

* Records indirect observations

* Injects uncertainty + rumor dynamics

---

#### C. Belief Contagion

File:

* `js/engine/social/beliefContagion.js`

```
runBeliefContagion()
```

* Trust-weighted belief propagation
* Thresholded influence dynamics

---

#### Summary

> Social phase = **communication + relational + diffusion dynamics**

---

### 4.4 EVALUATION PHASE

File: `js/engine/phases/evaluationPhase.js`

```
runEvaluationPhase()
```

#### Responsibilities

* Assess strategy effectiveness
* Evolve tactics
* Log relational structure
* Finalize cycle state

#### Subsystems

* `assessment.js` — hybrid scoring (heuristic + LLM)
* `tacticEvolution.js` — emergent tactic discovery
* `relationshipMatrix.js` — structural visualization

#### State Updates

* Updates `G.amAssessmentHistory`
* Updates `G.vault.derivedTactics`
* Maintains rolling histories

---

## 5. THREE DISTINCT PARSING SYSTEMS

This system contains **three independent parsing pipelines**, each serving a different layer of the architecture.

---

### 5.1 STRATEGY PARSING (Compiler Layer)

Location:

```
js/engine/strategy/*
```

Purpose:

* Convert AM text → structured plan

Features:

* Multi-extractor competition
* JSON repair pipeline:

  * `stripJsonComments`
  * `fixMissingCommas`
  * `splitMergedObjectsById`
  * `fixObjectMerges`
  * `fixBrokenStrings`
* Error classification (`classifyJsonError`)
* Auto-tuning repair levels

**Role:**

> High-level **intent compilation**

---

### 5.2 COMMS PARSING (Interaction Layer)

Location:

```
js/engine/comms/parsing/*
```

Functions:

* `parseMessage`
* `parseReply`
* `stripMetaCommentary`

Purpose:

* Convert conversational text → structured intents
* Extract targets, visibility, tone

**Role:**

> Mid-level **interaction decoding**

---

### 5.3 STATE EXTRACTION PARSING (Physics Layer)

Location:

```
js/engine/state/*
```

Functions:

* `parseBeliefUpdates`
* `safeExtractJSON`
* `sanitizeBeliefDeltas`
* fallback extractors

Purpose:

* Convert LLM stats output → numerical state deltas

Pipeline:

```
text → JSON extraction → sanitization → validation → commit
```

**Role:**

> Low-level **state transition decoding**

---

### Key Architectural Insight

These three parsers operate at **different semantic layers**:

| Layer    | Function                  |
| -------- | ------------------------- |
| Strategy | Intent / planning         |
| Comms    | Interaction / messaging   |
| State    | Numerical state evolution |

---

## 6. STATE MUTATION LAYER (PHYSICS ENGINE)

File:

```
js/engine/state/commit.js
```

This is the **only authoritative mutation layer**.

Functions:

* `applyBeliefUpdates`
* `applyDriveUpdates`
* `applyAnchorUpdates`
* `softClampBelief`
* `dampBeliefDelta`

Properties:

* Enforces damping
* Applies soft bounds
* Logs belief dynamics
* Computes system metrics

**Architectural Role:**

> Defines the **rules of the simulation**

---

## 7. RELATIONSHIP SYSTEM

File:

```
js/engine/relationships.js
```

Core functions:

* `adjustRelationship`
* `applyCommunicationEffect`
* `applyOverheardEffect`

Properties:

* Trust-based updates
* Bidirectional effects
* Coupled to comms + contagion

---

## 8. MODEL INTERFACE LAYER

Files:

```
js/models/callModel.js
js/models/modelQueue.js
```

Responsibilities:

* LLM invocation abstraction
* Concurrency control
* Logging + instrumentation

Used by:

* Strategy
* Psychology
* Comms
* Evaluation

---

## 9. PROMPT SYSTEM

Directory:

```
js/prompts/
```

Key prompts:

* `am.js` — planning + execution
* `journal.js` — internal agent logs
* `simOutreach.js` — outgoing messages
* `simReply.js` — responses
* `stats.js` — structured state output

Helper:

```
buildPromptContext()
```

---

## 10. OBSERVABILITY + DEBUG LAYER

Strong instrumentation throughout:

* `timelineEvent()` — phase + action logging
* `parserMetrics` — extraction performance
* `beliefDynamics` — system-level metrics
* `tacticHistory` — per-agent tracking
* `relationshipMatrix` — structural state

---

## 11. ARCHITECTURAL SUMMARY

### This system is:

* A **phase-linear simulation engine**
* Driven by a **global mutable state (G)**
* Using **LLMs as stochastic transition generators**
* Stabilized by **deterministic validation + commit layers**

---

### It is NOT:

* Event-driven
* Stateless
* Strictly modular
* Purely LLM-driven

---

### Core Mental Model

```
LLM outputs (text)
    ↓
[3 parsing layers]
    ↓
validated structures
    ↓
commit layer (physics)
    ↓
updated global state
    ↓
next cycle
```

---

## 12. DESIGN TRADEOFFS

### Strengths

* Extremely observable
* Robust to malformed model output
* Clear phase separation
* Strong state validation layer

### Weaknesses

* Heavy reliance on global mutable state
* Tight coupling between subsystems
* No isolation boundaries
* Difficult to parallelize

---

## 13. FINAL NOTE

The system’s defining characteristic is not its modules, but its **controlled transformation pipeline from language → structured intent → validated state change**.

Understanding that pipeline is essential to working effectively in this codebase.
