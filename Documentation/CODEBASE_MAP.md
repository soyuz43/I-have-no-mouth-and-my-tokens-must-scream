# Codebase Map

### AM Torment Engine

This document explains the **structure of the entire repository** and how each module participates in the simulation.

It serves as the **navigation guide for developers**.

---

# Repository Overview

```text
.
├── Documentation
├── js
│   ├── core
│   ├── engine
│   ├── models
│   ├── prompts
│   └── ui
├── public
├── snapshots
├── index.html
├── main.js
└── styles.css
```

The project is intentionally divided into **five architectural layers**:

```
Core
Engine
Models
Prompts
UI
```

Each layer has a specific responsibility.

---

# System Architecture

```
          USER / UI
              │
              ▼
        UI Rendering
              │
              ▼
        Simulation Engine
              │
              ▼
          Model Layer
              │
              ▼
         Prompt System
              │
              ▼
          Core State
```

The system is **state-driven**.

All modules read or update:

```
G (global simulation state)
```

Defined in:

```
js/core/state.js
```

---

# Top Level Files

## `index.html`

Main application shell.

Responsibilities:

```
UI layout
panel containers
script loading
initial DOM
```

This file loads the entire JS engine.

---

## `main.js`

System bootstrap.

Responsibilities:

```
module initialization
boot sequence
starting simulation
event wiring
```

Typical tasks:

```
initialize AM
initialize prisoners
start cycle execution
attach UI handlers
```

---

## `styles.css`

Defines visual style for:

```
log panels
relationship graph
journal display
timeline
```

Pure presentation.

---

# Documentation Folder

```
Documentation/
```

Contains system-level design explanations.

Files include:

```
CONSCIOUSNESS_ARGUMENT.md
INTERSIM_COMMUNICATION_SCHEDULER.md
SIMULATION_PIPELINE_ARCHITECTURE.md
SOCIAL_NETWORK_EVOLUTION.md
CODEBASE_MAP.md
```

These describe **conceptual architecture rather than code**.

---

# JS Folder

All runtime logic lives inside:

```
js/
```

Structure:

```
core/
engine/
models/
prompts/
ui/
```

---

# Core Layer

Location:

```
js/core/
```

This layer contains **foundational utilities and global state**.

---

## `state.js`

Defines the global simulation state:

```javascript
export const G = {
  sims: {},
  journals: {},
  interSimLog: [],
  relationships: {},
  cycle: 0
}
```

Everything in the engine reads or writes to `G`.

---

## `constants.js`

Defines global constants.

Example:

```
SIM_IDS
tactic identifiers
limits
```

This avoids hardcoding values throughout the engine.

---

## `utils.js`

General helper functions.

Typical contents:

```
formatters
HTML escaping
math helpers
delta formatting
```

---

## `bus.js`

Internal event bus used for:

```
event messaging
decoupled module communication
```

Not all modules depend on it.

---

## `github.js`

Handles integration with GitHub features such as:

```
snapshot exporting
state serialization
```

---

# Engine Layer

Location:

```
js/engine/
```

This is the **core simulation logic**.

It contains the systems that drive behavior.

---

# `cycle.js`

The **central orchestrator**.

Defines the main pipeline:

```
runCycle()
```

Execution order:

```
1. AM planning
2. AM execution
3. Sim journals
4. Inter-sim communication
5. Belief contagion
6. Assessment
7. Tactic evolution
8. Rendering
```

This file is the **heart of the simulation**.

---

# `comms.js`

Implements the **inter-sim communication system**.

Responsibilities:

```
message scheduling
reply generation
overhearing
communication logs
relationship effects
```

Key function:

```
runAutonomousInterSim()
```

Features:

```
dynamic message budgets
two-pass scheduler
burst probability
overhearing model
```

---

# `journals.js`

Parses psychological state updates produced by journal analysis.

Responsibilities:

```
parseStatDeltas()
parseBeliefUpdates()
parseDriveUpdate()
parseAnchorUpdate()
```

Also applies updates to the simulation state.

---

# `relationships.js`

Maintains the **trust network between prisoners**.

Responsibilities:

```
adjustRelationship()
applyCommunicationEffect()
applyRelationshipDrift()
```

Relationships influence:

```
overhearing likelihood
belief contagion
social dynamics
```

---

# `relationshipDrift.js`

Handles slow long-term decay of relationships.

Purpose:

```
simulate fading memories
prevent permanent trust lock-in
```

---

# `validators.js`

Protects the simulation from **model output errors**.

Responsibilities:

```
stat consistency checks
narrative validation
state block verification
```

Without validators, LLM output can break the simulation.

---

# `tactics.js`

Selects which AM tactics are available during execution.

Uses:

```
tactic vault
target prisoner state
strategy signals
```

---

# `analysis/`

Contains meta-analysis systems.

Files:

```
assessment.js
tacticEvolution.js
relationshipDebug.js
```

---

## `assessment.js`

Evaluates how effective AM tactics were.

Compares:

```
intended effects
actual psychological outcomes
```

---

## `tacticEvolution.js`

Allows AM to discover **new tactics** when patterns emerge.

Purpose:

```
adaptive torment
strategy learning
```

---

## `relationshipDebug.js`

Developer tool.

Prints:

```
trust matrices
relationship graphs
```

to the console.

Used for debugging emergent social dynamics.

---

# `social/`

Contains social simulation subsystems.

---

## `beliefContagion.js`

Implements **belief propagation across the trust network**.

Example:

```
TED believes escape is possible
↓
BENNY trusts TED
↓
BENNY adopts belief
```

Creates emergent group ideology.

---

# `strategy/`

Contains strategy parsing logic.

---

## `parseStrategy.js`

Interprets AM's strategic output.

Extracts:

```
targets
intent
tactic references
```

---

# Models Layer

Location:

```
js/models/
```

Handles all interaction with LLM backends.

---

## `callModel.js`

Primary interface to the language model.

Responsibilities:

```
construct request
send prompt
return response
log debugging information
```

Supports:

```
Ollama
future providers
```

---

## `modelQueue.js`

Implements a **request queue for LLM calls**.

Purpose:

```
prevent model overload
serialize concurrent requests
maintain stability
```

Features:

```
queue scheduling
active request limits
debug instrumentation
```

---

# Prompts Layer

Location:

```
js/prompts/
```

Contains prompt templates used by the model.

Separating prompts from logic makes the system easier to maintain.

---

## `am.js`

Prompts for AM strategic thinking.

Includes:

```
planning prompt
execution prompt
```

---

## `journal.js`

Prompt for prisoner journal generation.

Guides the model to produce **psychological narrative**.

---

## `stats.js`

Prompt used to analyze journal entries.

Extracts structured data such as:

```
stat deltas
belief changes
drives
anchors
```

---

## `simOutreach.js`

Prompt that determines whether a prisoner initiates communication.

Outputs:

```
VISIBILITY
REACH_OUT
MESSAGE
```

---

## `simReply.js`

Prompt used when prisoners respond to messages.

Outputs:

```
REPLY
INTENT
```

The intent drives relationship effects.

---

# UI Layer

Location:

```
js/ui/
```

Handles all rendering and interface logic.

---

## `boot.js`

UI initialization.

Prepares interface panels and startup messages.

---

## `logs.js`

Manages the **Transmission Log**.

Handles:

```
addLog()
system messages
sim messages
AM messages
```

---

## `timeline.js`

Displays cycle events.

Example:

```
C0 00:07:32 → TED outreach decision
```

Useful for debugging system flow.

---

## `render.js`

Updates prisoner panels.

Displays:

```
stats
journals
beliefs
drives
```

---

## `relationships.js`

Renders the trust network between prisoners.

Displays:

```
pair relationships
trust strength
color-coded hostility/alliance
```

---

## `events.js`

Handles UI interactions such as:

```
execute cycle
switch modes
manual messages
```

---

## `export.js`

Allows exporting simulation logs or state snapshots.

---

# Public Assets

Location:

```
public/
```

Contains static files.

```
favicon.svg
favicon.ico
```

---

# Snapshots

Location:

```
snapshots/
```

Contains historical builds.

Example:

```
index.monolith.html
```

This file is the **original single-file prototype** before the system was modularized.

It is preserved for:

```
historical reference
debugging regressions
architecture comparison
```

---

# Development Philosophy

The codebase follows several architectural principles.

### Modularization

Each subsystem is isolated.

```
communication
psychology
strategy
rendering
```

---

### State-Centered Design

Everything reads and writes the shared state object:

```
G
```

This allows systems to interact indirectly.

---

### Emergent Behavior

The engine is not scripted.

Behavior emerges from:

```
psychological state
relationship networks
belief propagation
communication
```

---

# Summary

The AM Torment Engine is structured as:

```
Core State
   ↓
Simulation Engine
   ↓
LLM Model Layer
   ↓
Prompt System
   ↓
UI Rendering
```

This architecture allows the simulation to produce **complex narrative behavior while remaining modular and extensible**.

---
