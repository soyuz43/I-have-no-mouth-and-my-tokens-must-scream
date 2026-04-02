# Inter-Sim Communication Scheduler

---

## 1. System Placement

The communication system executes during the simulation cycle:

```text
runCycle()
  ├─ runStrategyPhase()
  ├─ runPsychologyPhase()
  ├─ runSocialPhase()
  │    └─ runAutonomousInterSim()
  └─ runEvaluationPhase()
```

The communication scheduler is implemented in:

```text
js/engine/comms/orchestrator.js
```

Interaction execution is implemented in:

```text
js/engine/comms/engine.js
```

---

## 2. High-Level Architecture

The system is composed of four layers:

```text
[ Scheduler ] → [ Target Selection ] → [ Interaction Engine ] → [ State Effects ]
```

More precisely:

```text
orchestrator.js
    ↓
engine.js (attemptCommunication)
    ↓
LLM calls + parsing
    ↓
relationships.js + state updates
```

---

## 3. End-to-End Execution Pipeline

```text
CYCLE START
    ↓
runSocialPhase
    ↓
runAutonomousInterSim
    ↓
[ PASS 1 ]
    ↓
attemptCommunication(fromId)
    ↓
  selectTarget(fromId)
    ↓
  generateMessage (LLM)
    ↓
  parseMessage
    ↓
  generateReply (LLM)
    ↓
  parseReply
    ↓
  apply effects
    ↓
[ PASS 2 (conditional) ]
    ↓
repeat with burst dynamics
    ↓
CYCLE END
```

---

## 4. Scheduler (orchestrator.js)

### 4.1 Responsibilities

* Defines pass structure
* Computes message budget
* Controls ordering (shuffle)
* Applies burst amplification
* Tracks per-cycle activity

---

### 4.2 Message Budget

```js
const MAX_MESSAGES = 24;

messageBudget = Math.min(
  MAX_MESSAGES,
  SIM_COUNT * (1.6 + groupStress)
);
```

**Enforcement points:**

```js
if (counters.messageCount >= state.messageBudget) return;
if (counters.messageCount >= state.messageBudget) break;
```

Budget is enforced:

* before attempting communication
* during iteration (hard stop)

---

### 4.3 Pass Structure

#### Pass 1 — Baseline

```js
const initialQueue = shuffle(SIM_IDS);

for (const fromId of initialQueue) {
  attemptCommunication(...)
}
```

* Full population pass
* Uniform random ordering
* No bias

---

#### Pass 2 — Burst Phase

Triggered by:

```js
Math.random() < SECOND_PASS_CHANCE
```

and:

```js
state.counters.messageCount < state.messageBudget
```

Dynamics:

```js
burstModifier = 1 + groupStress * 1.4
burstProb = BURST_BASE * burstModifier
```

Execution:

```js
const burstQueue = shuffle(SIM_IDS)

for (const fromId of burstQueue) {
  if (Math.random() > burstProb) continue
  attemptCommunication(...)
}
```

---

### 4.4 Activity Tracking

```js
activeThisCycle: Set
```

Used to:

* prevent redundant reactions
* suppress repeated activation
* bias burst participation

---

## 5. Target Selection (engine.js)

Target selection is not a single function.
It is a composite of competing mechanisms.

---

### 5.1 Selection Flow

```text
attemptCommunication(fromId)
    ↓
evaluate rumor opportunity
    ↓
evaluate recent partner
    ↓
evaluate relationship weights
    ↓
fallback random
```

---

### 5.2 Conversation Inertia

```js
getRecentPartner(fromId)
```

Constraint:

```js
!(replyTargetsThisCycle.get(fromId)?.has(recentPartner))
```

Effect:

```text
A → B → A → B
```

---

### 5.3 Relationship Routing

```js
const rels = fromSim.relationships || {}
```

Implicit weighting:

```text
weight ∝ |relationship|
```

---

### 5.4 Rumor Routing

```js
rumorPressure = min(0.4, 0.1 + overheard.length * 0.03)
```

If triggered:

```js
rumorTarget = random(sim)
rumorText = derived from overheard memory
```

Effect:

```text
A → B (original)
B → C (rumor relay)
```

---

### 5.5 Exploration

Fallback stochastic targeting when other signals do not dominate.

---

## 6. Interaction Engine (engine.js)

---

### 6.1 Core Flow

```text
fromId → toId
    ↓
LLM: outreach generation
    ↓
parseMessage
    ↓
LLM: reply generation
    ↓
parseReply
    ↓
applyCommunicationEffect
    ↓
adjustRelationship
    ↓
overhearing propagation
```

---

### 6.2 Message Generation

```js
const outreachRaw = await callModel(...)
```

Sanitized:

```js
stripMetaCommentary(outreachRaw)
```

---

### 6.3 Reply Generation

```js
const replyRaw = await callModel(...)
```

Processed:

```js
parseReply(replyRaw)
```

With repetition guard:

```js
if (similarity(lastReply, replyText) > 0.85)
```

---

### 6.4 Comms Parsing Layer

Location:

```text
js/engine/comms/parsing/
```

Functions:

```js
parseMessage(raw)
parseReply(raw)
stripMetaCommentary(text)
```

Role:

```text
LLM output → structured interaction signal
```

---

## 7. Loop Prevention

---

### 7.1 Reply Tracking

```js
replyTargetsThisCycle: Map<sim → Set(targets)>
```

Update:

```js
replyTargetsThisCycle.get(toId).add(fromId)
```

Constraint:

```text
If B replied to A this cycle,
B cannot initiate A again.
```

---

### 7.2 Active Set Constraint

```js
activeThisCycle.has(simId)
```

Used to prevent:

* repeated activation
* reactive cascades

---

### 7.3 Message Budget Constraint

Global hard limit.

---

## 8. Overhearing System

---

### 8.1 Storage

```js
sim.overheard: Array
```

Bounded:

```js
if (overheard.length > 20) shift()
```

---

### 8.2 Recording

```js
recordOverheard(listener, fromId, toId, text)
```

---

### 8.3 Effects

```js
applyOverheardEffect(listener, fromId, toId)
```

Includes:

* suspicion increase
* trust decay

---

## 9. Rumor Propagation

---

### 9.1 Trigger

```js
Math.random() < rumorPressure
```

---

### 9.2 Effect

```text
Indirect communication chain:
A → B → C → D
```

---

### 9.3 Relationship Impact

```js
adjustRelationship(rumorTarget, source.from, -0.015)
```

---

## 10. Relationship System Coupling

---

### 10.1 Direct Effects

```js
applyCommunicationEffect(from, to, intent)
```

---

### 10.2 Overheard Effects

```js
applyOverheardEffect(listener, fromId, toId)
```

---

### 10.3 Relationship Update Function

```js
adjustRelationship(a, b, delta)
```

---

## 11. Feedback Structure

---

### 11.1 Direct Loop

```text
relationships
    ↓
target selection
    ↓
communication
    ↓
relationship updates
    ↓
(next cycle)
```

---

### 11.2 Indirect Loop

```text
communication
    ↓
overhearing
    ↓
rumor propagation
    ↓
third-party updates
```

---

## 12. ASCII Architecture Diagram

```text
                 ┌──────────────────────────────┐
                 │        Scheduler             │
                 │   (orchestrator.js)          │
                 └────────────┬─────────────────┘
                              │
                              ▼
                 ┌──────────────────────────────┐
                 │     attemptCommunication     │
                 │        (engine.js)           │
                 └────────────┬─────────────────┘
                              │
                ┌─────────────┼─────────────┐
                ▼                           ▼
     ┌────────────────────┐     ┌────────────────────┐
     │ Target Selection    │     │   Rumor System      │
     │ (relationships etc) │     │ (overheard memory)  │
     └────────────┬───────┘     └────────────┬───────┘
                  │                           │
                  └──────────────┬────────────┘
                                 ▼
                   ┌─────────────────────────┐
                   │   LLM Interaction       │
                   │ (message + reply)       │
                   └────────────┬────────────┘
                                │
                                ▼
                   ┌─────────────────────────┐
                   │   Comms Parsing         │
                   │ parseMessage / Reply    │
                   └────────────┬────────────┘
                                │
                                ▼
                   ┌─────────────────────────┐
                   │   Relationship System   │
                   │ adjust / apply effects  │
                   └────────────┬────────────┘
                                │
                                ▼
                   ┌─────────────────────────┐
                   │   Overhearing System    │
                   │   + Memory Update       │
                   └────────────┬────────────┘
                                │
                                ▼
                           (Next Cycle)
```

---

## 13. Mermaid Diagram

```mermaid
flowchart TD

A[runCycle] --> B[runSocialPhase]
B --> C[runAutonomousInterSim]

C --> D[Pass 1]
C --> E[Pass 2 (Burst)]

D --> F[attemptCommunication]
E --> F

F --> G[Target Selection]
G --> H[LLM Message]
H --> I[parseMessage]

I --> J[LLM Reply]
J --> K[parseReply]

K --> L[applyCommunicationEffect]
L --> M[adjustRelationship]

M --> N[Overhearing System]
N --> O[Rumor Propagation]

O --> G
M --> G
```

---

## 14. Core Mental Model

```text
scheduler
  → selects actor
    → selects target
      → generates interaction (LLM)
        → parses interaction
          → applies relationship + belief effects
            → updates state
              → influences next cycle
```

---

## 15. Key Properties

* Stochastic scheduling with deterministic guards
* Multi-signal target selection
* Stateful interaction constraints
* Persistent social memory (overhearing)
* Indirect propagation via rumor
* Hard-bounded execution (message budget)

---

## 16. System Characterization

This system is best described as:

```text
A stochastic multi-agent interaction system
with constrained scheduling and persistent social memory.
```
