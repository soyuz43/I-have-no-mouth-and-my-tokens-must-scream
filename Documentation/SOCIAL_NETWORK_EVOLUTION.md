# Social Network Evolution

### AM Torment Engine

This document explains how prisoner relationships evolve over multiple simulation cycles and how the communication engine gradually produces alliances, suspicion, and faction dynamics.

Unlike the **communication scheduler document**, which describes *how messages are scheduled*, this document focuses on **how the social graph changes over time**.

---

# Core Concept

Each prisoner maintains a **directed trust value toward every other prisoner**.

```
A → B
```

Means:

> "How much A trusts B"

Values range between:

```
-1.0  = extreme hostility
 0.0  = neutral
+1.0  = strong trust
```

This produces a **directed weighted graph** of relationships.

---

# Initial State

At cycle start, all relationships are neutral.

```
Cycle 0

        TED   ELLEN   NIMDOK   GORRISTER   BENNY
TED      —      0        0         0         0
ELLEN    0      —        0         0         0
NIMDOK   0      0        —         0         0
GORRISTER0      0        0         —         0
BENNY    0      0        0         0         —
```

Graphically:

```
No alliances
No distrust
Fully neutral network
```

---

# Cycle Evolution

Each communication interaction slightly modifies the graph.

Example conversation:

```
BENNY → TED
TED reply (intent: probe_trust)
```

Trust change:

```
TED → BENNY +0.01
```

Graph now:

```
TED trusts BENNY slightly
```

Diagram:

```
TED ─────► BENNY
      +0.01
```

---

# Overhearing Effects

Other prisoners may overhear private communication.

Example:

```
OVERHEARD ELLEN
TED and BENNY whispering
```

Trust shifts:

```
ELLEN → TED   -0.008
ELLEN → BENNY -0.008
```

Diagram:

```
         ELLEN
        /     \
     -0.008  -0.008
       ▼         ▼
      TED ─────► BENNY
```

This produces **paranoia propagation**.

---

# Multi-Cycle Example

Below is a simplified example of social evolution over several cycles.

---

## Cycle 1

```
TED ↔ BENNY conversation
ELLEN overhears
```

Relationships:

```
TED → BENNY   +0.01
BENNY → TED   -0.01
ELLEN → TED   -0.008
ELLEN → BENNY -0.008
```

Graph:

```
ELLEN
  │
  ▼
 TED ─────► BENNY
   ▲
   │
 BENNY
```

---

## Cycle 2

ELLEN speaks with NIMDOK.

```
ELLEN → NIMDOK
NIMDOK reply (test_loyalty)
```

Trust shift:

```
ELLEN → NIMDOK -0.01
```

Graph expands:

```
ELLEN ─────► NIMDOK
  │
  ▼
 TED ─────► BENNY
```

Now two communication clusters exist.

---

## Cycle 3

Suppose BENNY recruits TED as ally.

```
intent: recruit_ally
```

Trust change:

```
TED → BENNY +0.05
```

Graph strengthens:

```
TED ─────────► BENNY
     strong trust
```

A stable alliance begins forming.

---

# Emergent Social Patterns

Over multiple cycles, the system tends to produce the following dynamics.

---

## Alliances

Mutual trust increases.

```
A → B +0.20
B → A +0.18
```

Graph:

```
A ⇄ B
```

These pairs often communicate repeatedly.

---

## Suspicion Loops

One-sided distrust.

```
A → B -0.20
B → A +0.05
```

Graph:

```
A ──x──► B
```

Creates unstable relationships.

---

## Isolation

Prisoners ignored or distrusted by others.

```
everyone → X negative
```

Graph:

```
A → X
B → X
C → X
D → X
```

X becomes socially isolated.

---

## Factions

Groups with internal trust and external distrust.

Example:

```
Group 1: TED BENNY
Group 2: ELLEN NIMDOK
```

Graph:

```
TED ⇄ BENNY

ELLEN ⇄ NIMDOK

TED → ELLEN  negative
BENNY → NIMDOK negative
```

Diagram:

```
   Group A          Group B

TED ⇄ BENNY       ELLEN ⇄ NIMDOK
     │                 │
     └──── distrust ───┘
```

---

# Long-Term Dynamics

As cycles progress, the social network tends to stabilize into:

```
alliances
rivalries
isolated individuals
```

Example after many cycles:

```
           TED ⇄ BENNY

ELLEN ⇄ NIMDOK

GORRISTER isolated
```

This creates **narrative tension** for the simulation.

---

# Relationship Drift

To prevent relationships from becoming permanently locked, the system applies passive drift:

```
relationship *= 0.995
```

Meaning:

```
strong feelings slowly fade over time
```

Unless reinforced by new interactions.

---

# Visualizing the Network

During debugging, the console may display a **relationship matrix**.

Example:

```
RELATIONSHIP MATRIX

        TED  ELLEN  NIMDOK  GORRISTER  BENNY
TED      —    -0.01    0        0      +0.05
ELLEN  -0.008   —    -0.01      0     -0.008
NIMDOK   0      0       —       0        0
GORRISTER0      0       0       —        0
BENNY   -0.01    0       0       0        —
```

This helps visualize the evolving social graph.

---

# Why This Matters

The relationship system enables **emergent narrative behavior**:

* alliances
* betrayal
* paranoia
* faction formation
* isolation

Because these effects arise from **simple rules**, the system produces stories without explicit scripting.

---

# Interaction with Other Systems

The social network influences:

```
communication targeting
overhearing suspicion
future cooperation
conflict dynamics
```

Future versions may also use relationships to influence:

```
escape planning
information sharing
coalition behavior
```

---

# Summary

The social graph evolves through three mechanisms:

```
communication intent
overheard conversations
passive emotional drift
```

Over time this produces a dynamic prisoner society shaped by trust and suspicion.

---
