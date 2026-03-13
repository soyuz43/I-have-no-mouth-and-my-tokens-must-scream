# Simulation Pipeline Architecture

### AM Torment Engine

This document describes the **complete execution pipeline** of a simulation cycle.

It explains how:

* AM plans torment
* tactics are selected
* prisoners generate journals
* psychological state changes
* communication occurs
* relationships evolve

Together these subsystems produce **emergent narrative behavior**.

---

# System Overview

The simulation runs in **discrete cycles**.

Each cycle represents a unit of time in which AM acts upon the prisoners and prisoners react psychologically and socially.

```text
Cycle
 ├─ AM Strategic Planning
 ├─ AM Tactical Execution
 ├─ Prisoner Journal Generation
 ├─ Psychological State Updates
 ├─ Inter-Sim Communication
 ├─ Social Network Updates
 └─ UI Rendering
```

Each stage feeds information forward into the next.

---

# High-Level Architecture Diagram

```text
             +--------------------+
             |        AM          |
             | Strategic Planning |
             +---------+----------+
                       |
                       v
             +--------------------+
             |   AM Execution     |
             |   (Tactic Output)  |
             +---------+----------+
                       |
                       v
             +--------------------+
             |  Prisoner Journals |
             |  Narrative Output  |
             +---------+----------+
                       |
                       v
             +--------------------+
             | Psychological      |
             | State Updates      |
             | suffering / hope   |
             | sanity / beliefs   |
             +---------+----------+
                       |
                       v
             +--------------------+
             | Inter-Sim          |
             | Communication      |
             +---------+----------+
                       |
                       v
             +--------------------+
             | Relationship Graph |
             | Trust / Suspicion  |
             +---------+----------+
                       |
                       v
             +--------------------+
             | UI Rendering       |
             | Logs / Panels      |
             +--------------------+
```

The pipeline forms a **feedback loop across cycles**.

---

# Stage 1 — AM Strategic Planning

AM begins each cycle by generating a **strategic plan**.

Input:

```text
previous cycle state
directive input
target selection
```

Prompt:

```text
buildAMPlanningPrompt()
```

Output:

```text
strategic plan narrative
```

This plan describes how AM intends to manipulate the prisoners.

Example output:

```text
Divide prisoners by sowing distrust between TED and BENNY.
Apply sensory deprivation to NIMDOK.
```

---

# Stage 2 — AM Tactical Execution

AM converts the plan into **specific tactics** applied to prisoners.

Input:

```text
plan
tactic vault
target sims
```

Prompt:

```text
buildAMPrompt()
```

Output example:

```text
TACTIC_USED: [Cognitive Isolation]
TARGET: TED
```

The result determines what prisoners experience during the cycle.

---

# Stage 3 — Prisoner Journals

Each prisoner writes a **private journal entry**.

Input:

```text
AM output
recent messages
internal beliefs
previous journals
```

Prompt:

```text
buildSimJournalPrompt()
```

Output:

```text
narrative journal entry
```

Example:

```text
"I can hear the machines humming again. AM wants us to turn on each other."
```

These journals simulate **internal psychological processing**.

---

# Stage 4 — Psychological State Updates

A second model call analyzes the journal.

Prompt:

```text
buildSimJournalStatsPrompt()
```

The system extracts:

```text
suffering_delta
hope_delta
sanity_delta
belief_deltas
drive updates
anchor updates
```

Example result:

```json
{
  "suffering_delta": 4,
  "hope_delta": -2,
  "sanity_delta": -1
}
```

These updates modify the prisoner’s internal state.

---

# State Model

Each prisoner has a state vector:

```text
suffering
hope
sanity
beliefs
drives
anchors
relationships
```

Example:

```text
TED
suffering: 42
hope: 21
sanity: 65
belief_escape_possible: 0.30
```

This state influences future behavior.

---

# Stage 5 — Inter-Sim Communication

After psychological updates, prisoners may attempt to communicate.

Scheduler:

```text
runAutonomousInterSim()
```

Features:

```text
message budget
two-pass communication
burst probability
relationship effects
overhearing
```

Example exchange:

```text
TED → BENNY
"I think we should talk about the tunnel."
```

Reply:

```text
BENNY → TED
"What exactly did you find?"
```

---

# Stage 6 — Relationship Graph Updates

Communication affects trust relationships.

Example:

```text
intent: probe_trust
```

Effect:

```text
target → speaker +0.01 trust
```

Overheard whispers create suspicion.

Example:

```text
ELLEN overhears TED whispering to BENNY
```

Effect:

```text
ELLEN → TED   -0.008
ELLEN → BENNY -0.008
```

Graph example:

```text
TED ⇄ BENNY
ELLEN → TED (suspicion)
```

---

# Stage 7 — Rendering

Finally, the UI updates.

Components rendered:

```text
Transmission Log
Journal Panels
Psychological Stats
Relationship Graph
Cycle Timeline
```

Functions involved:

```text
appendJournalEntry()
updateSimDisplay()
renderRelationships()
addLog()
```

---

# Cycle Feedback Loop

The output of one cycle becomes input for the next.

```text
Cycle N
 ├─ relationships
 ├─ psychological state
 ├─ journals
 └─ messages

↓ feed into ↓

Cycle N+1
```

This feedback loop produces **long-term narrative evolution**.

---

# Emergent Dynamics

Over many cycles, the system produces:

```text
alliances
rivalries
paranoia
information networks
social isolation
```

Example emergent structure:

```text
TED ⇄ BENNY (alliance)

ELLEN ⇄ NIMDOK (alliance)

GORRISTER isolated
```

These structures arise from **local interactions**, not scripted events.

---

# Design Philosophy

The engine follows three principles:

### Local Rules

Simple rules govern each interaction.

### State Persistence

Psychological and social states persist across cycles.

### Emergent Narrative

Stories arise from system dynamics rather than predefined scripts.

---

# System Summary

The simulation pipeline forms a **closed narrative loop**:

```text
AM Torment
      ↓
Prisoner Psychology
      ↓
Communication
      ↓
Social Network
      ↓
Future Behavior
```

This architecture allows the simulation to produce **complex human-like dynamics** using a relatively small set of mechanisms.

---