# Inter-Sim Communication Scheduler

### AM Torment Engine

This document explains how autonomous communication between prisoners is scheduled, processed, and limited during each simulation cycle.

The communication engine is designed to produce **emergent social behavior** while preventing pathological loops or runaway message spam.

---

# Overview

Each simulation cycle may include an **inter-sim communication phase** where prisoners attempt to contact each other.

Communication follows this general structure:

```
Cycle
 └─ Inter-Sim Phase
     ├─ Pass 1 (baseline outreach)
     │   └─ Each sim may attempt communication
     │
     └─ Pass 2 (burst / escalation)
         └─ Active sims may attempt additional outreach
```

The engine enforces several constraints:

* message budget
* conversational structure
* reply protection
* social memory
* overhearing effects

These constraints ensure the system behaves more like **human social dynamics** rather than a pure message generator.

---

# Communication Flow

A single interaction follows this sequence:

```
Sim A decides whether to reach out
        │
        ▼
Sim A sends message to Sim B
        │
        ▼
Sim B generates reply
        │
        ▼
Relationship effects applied
        │
        ▼
Possible overhearing by other sims
```

Graphically:

```
A ───────► B
           │
           ▼
         reply
           │
           ▼
A ◄─────── B
```

---

# Communication Passes

The system performs **two possible communication passes**.

## Pass 1 — Baseline Outreach

Every prisoner gets a chance to initiate communication.

Order is randomized to avoid bias.

```
shuffle(SIMS)

for each sim:
    attemptCommunication(sim)
```

Example:

```
Cycle 1 Pass 1

TED        → BENNY
ELLEN      → NIMDOK
GORRISTER  → (none)
BENNY      → TED
NIMDOK     → (none)
```

Only some attempts succeed because:

* the LLM may decide not to reach out
* the target may be invalid
* guards may block the attempt

---

## Pass 2 — Escalation / Burst

If:

```
messageCount < messageBudget
AND
random < SECOND_PASS_CHANCE
```

then a **second communication pass** occurs.

During this pass:

* sims who already spoke are **more likely to speak again**
* inactive sims have a smaller chance

```
if activeThisCycle.has(sim):
    high probability
else
    burst probability
```

Example:

```
Cycle 1 Pass 2

TED    → BENNY
ELLEN  → (none)
BENNY  → (none)
```

This produces **short conversational bursts**.

---

# Message Budget

To prevent communication floods, each cycle has a **message budget**.

```
messageBudget = min(
    MAX_MESSAGES,
    SIM_COUNT * (1.6 + groupStress)
)
```

Where group stress is derived from:

```
suffering
sanity loss
trust erosion
```

Higher stress → more communication.

Example:

```
Low stress group
messageBudget = 6

High stress group
messageBudget = 11
```

This produces **emotional escalation behavior**.

---

# Conversation Structure

The engine models a natural conversational rhythm.

Typical exchange:

```
A → B
B reply
```

Sometimes extended:

```
A → B
B reply
A → B (follow-up)
B reply
```

But the system prevents pathological loops like:

```
A → B
B → A
A → B
B → A
A → B
B → A
```

To achieve this, the scheduler tracks **initiations per pair per cycle**.

Example rule:

```
maxInitiationsPerPair = 2
```

Replies remain unrestricted.

---

# Reply Protection

To prevent duplicate reply generation the system uses:

```
repliedPairs
```

Meaning:

```
B replying to A twice in same interaction is prevented
```

Example:

```
A → B
B reply
A → B again
B reply prevented
```

This stops **reply loops** caused by repeated prompts.

---

# Overhearing Model

Private messages may be overheard.

Possible outcomes:

```
full overhear
fragment overhear
whisper observed
```

Example:

```
PRIVATE TED → BENNY

OVERHEARD ELLEN:
"I think we should..."

NOTICE NIMDOK:
TED and BENNY were seen whispering
```

Overhearing affects trust relationships.

```
listener distrusts both participants slightly
```

This creates **gossip dynamics**.

---

# Social Graph Effects

Communication alters the **directed relationship graph**.

Example:

```
TED → BENNY trust +0.01
ELLEN → TED trust -0.008
ELLEN → BENNY trust -0.008
```

Graphically:

```
        ELLEN
        /   \
      -     -
     ▼       ▼
    TED → BENNY
          +
```

This enables:

* alliances
* suspicion
* faction formation
* isolation

---

# Example Cycle Diagram

Example communication network from a real cycle:

```
          ELLEN
            │
            ▼
          NIMDOK

TED ───────► BENNY
 ▲           │
 │           ▼
 └──────── reply
```

Clusters often emerge naturally:

```
Cluster 1:
TED ↔ BENNY

Cluster 2:
ELLEN ↔ NIMDOK

GORRISTER isolated
```

Over time these clusters evolve as trust changes.

---

# Design Goals

The scheduler attempts to balance:

### Realism

Agents should behave like people having conversations.

### Stability

The simulation must not devolve into infinite loops.

### Emergence

Interesting social patterns should arise without scripting.

### Performance

Message volume must remain manageable for the LLM backend.

---

# Future Extensions

Planned improvements include:

### Trust-weighted targeting

Agents prefer contacting trusted prisoners.

### Suspicion avoidance

Agents avoid prisoners they distrust.

### Multi-party conversations

Messages referencing multiple sims.

### Coalition formation

Agents coordinate against others.

---

# Summary

The inter-sim communication scheduler provides:

```
structured conversation flow
controlled message volume
emergent social dynamics
```

By combining:

* LLM decision making
* probabilistic scheduling
* trust relationships
* overhearing mechanics

the engine produces **organic prisoner interaction** within each torment cycle.

---