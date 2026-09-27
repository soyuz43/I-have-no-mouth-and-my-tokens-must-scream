Yes. This is coherent enough to begin implementing the **foundation** of the agency phase.

You are not yet ready to finalize the complete action catalogue, object ecosystem, or balance values—and you do not need to be. The architectural direction is now stable enough that early implementation work is unlikely to be thrown away.

The core model is clear:

```text
subjective state
→ available action budget
→ engine-derived legal actions
→ model-selected proposal
→ capability and effort evaluation
→ simultaneous resolution
→ authoritative event
→ subjective observations
→ persistent consequences
```

And the key concepts are correctly separated:

```text
action credits
  = scarce opportunities to pursue deliberate behavior

capabilities
  = whether an action can physically or cognitively be attempted

effort modifiers
  = how adversity changes the cost of attempting it

execution quality
  = how complete, coherent, or effective the resulting action is

strain
  = additional cost imposed on the prisoner by forcing the action

resolution
  = whether the attempted action actually succeeds

observability
  = who learns what happened
```

That separation is the important breakthrough. You are no longer designing:

```js
if (stressPosition) {
  messageCost = 2;
}
```

You are designing a compositional system where:

```text
constraint effects
+
action requirements
+
selected execution mode
+
available credits
+
current condition
=
resolved attempt
```

That is a durable architecture.

# What you are ready to implement

You are ready to build the parts that do not depend on knowing every future object or action.

## 1. Agency state envelope

Something conceptually like:

```js
G.agency = {
  cycle: null,

  budgets: {
    TED: null,
    ELLEN: null,
    NIMDOK: null,
    GORRISTER: null,
    BENNY: null
  },

  legalActions: {},
  proposals: {},
  resolutions: [],
  observations: []
};
```

The final names may change. The important thing is establishing distinct stores for:

* budget;
* legal alternatives;
* model proposals;
* authoritative resolutions;
* derived observations.

## 2. Capability profile

You can implement the shape before determining every constraint mapping:

```js
{
  mobility: 1,
  stability: 1,
  handUse: 1,
  concentration: 1,
  interactionReach: 1
}
```

These five keys are the implemented capability vocabulary. They map one-to-one onto the `posture` metadata declared by every constraint definition in `js/engine/constraints.js`, and they are exactly the keys `deriveCapabilities()` in `js/engine/agency/capabilities.js` returns.

Capabilities that appear in earlier drafts of this document but are **not** implemented:

* `speech` — not implemented. No current constraint gates this capability. Add back if a future constraint requires it.
* `vision` — not implemented. No current constraint gates this capability. Add back if a future constraint requires it.
* `endurance` — not implemented. Sustained exertion is currently modelled through `physical_stress` accumulation and the `stability` capability rather than a separate endurance axis.

`mobility` also deserves a note: it is derived from the inverted `mobility_restriction` posture field, so a higher `mobility_restriction` produces a lower `mobility` capability. Every other key is normal-polarity, where higher means more capable.

These do not necessarily need to be booleans. Continuous normalized values give you room for:

```text
fully available
impaired
severely impaired
unavailable
```

For example:

```js
{
  mobility: 0.15,
  stability: 0.1,
  handUse: 0,
  concentration: 0.35,
  interactionReach: 0.1
}
```

This corresponds closely to the real `overhead_restraint` posture, which yields
`mobility: 0`, `stability: 0.1`, `handUse: 0`, `concentration: 0.3`,
`interactionReach: 0.1`.

You can then derive this profile from active constraints without yet connecting it to fifty actions.

## 3. Generic action definition shape

You can define the contract without filling the library:

```js
{
  type: "SEND_MESSAGE",
  baseCost: 1,

  requirements: {
    concentration: 0.15
  },

  effortDomains: [
    "cognitive"
  ],

  executionModes: {
    fragmentary: {
      cost: 1,
      minimums: {
        concentration: 0.1
      }
    },

    coherent: {
      cost: 2,
      minimums: {
        concentration: 0.4
      }
    }
  }
}
```

Every key inside `requirements` and inside each mode's `minimums` must be one of the five implemented capability keys. A requirement naming any other key cannot be evaluated, because `deriveCapabilities()` has no value to compare it against.

There is no `speech` capability key, so `SEND_MESSAGE` cannot currently be gated by a gag or a silencing. Quality degradation therefore keys off `concentration` alone until a constraint supplies a speech-affecting posture field. Communication itself still happens in the existing communication phase, which is not capability-gated.

You do not need to believe these numbers are final. You need the engine to know that actions can have:

* requirements;
* modes;
* base costs;
* surcharges;
* degraded outcomes.

## 4. Pure evaluation functions

This is probably the safest first actual code:

```text
deriveCapabilities(sim)
deriveActionBudget(sim)
evaluateActionAvailability(action, sim, capabilities)
calculateActionCost(action, mode, sim, capabilities)
validateActionProposal(proposal, legalActions, budget)
```

These should initially calculate and return data without mutating `G`.

That lets you inspect whether the model makes sense before introducing model calls or state changes.

# What you do not need to decide yet

You do not need the complete answer to:

* every object that exists;
* every action type;
* exact credit costs;
* whether communication ultimately shares the same budget;
* whether AM has three credits or a separate point system;
* the exact success formula;
* how environmental locations work;
* whether action credits regenerate uniformly;
* whether credits can be banked;
* whether models can submit contingent plans.

Those are policy and content questions built on top of the foundation.

The foundation remains useful whichever answers you later choose.

# The smallest useful prototype

I would not start with cigarettes, matches, cans, and inventories simultaneously. That immediately requires resource provenance, custody, consumption, transfer, prerequisites, and observation.

Start with three actions that test the agency machinery itself:

```text
WAIT
OBSERVE
SEND_MESSAGE
```

But give `SEND_MESSAGE` execution modes:

```text
SIGNAL
BRIEF
COHERENT
DETAILED
```

Then connect constraints to:

* concentration;
* stability;
* effective cost;
* message quality;
* additional strain.

This tests almost everything important:

* legal-action derivation;
* budget allocation;
* degraded variants;
* constraint interaction;
* paying extra to preserve quality;
* impossible versus costly actions;
* authoritative resolution;
* observable consequences.

It also integrates with your current communication architecture more naturally than objects would.

After that works, add the first resource pair:

```text
cigarette
match
```

and only these actions:

```text
SMOKE
TRANSFER
HIDE
REVEAL
```

That becomes the first real object-grounded vertical slice.

# One thing to avoid

Do not make the first capability engine excessively mathematical.

You could easily end up inventing:

```text
final cost =
base cost
× physical coefficient
× cognitive coefficient
+ suffering modifier
+ sanity modifier
− relationship assistance factor
```

before you have any evidence that those coefficients produce interesting behavior.

Begin with discrete, inspectable rules:

```text
normal
impaired
severely impaired
unavailable
```

and:

```text
no surcharge
+1 credit
degraded mode only
blocked
```

You can replace those mappings with smoother calculations later if the discrete model proves too coarse.

The early system needs to be **legible**, because you will be debugging questions such as:

> Why was this action offered?

> Why did it cost two credits?

> Which constraint caused the surcharge?

> Why was the detailed variant blocked but the brief variant allowed?

Every resolution should be able to answer those questions directly.

# Readiness verdict

You are ready to start implementing:

* the agency state boundaries;
* capability derivation;
* action definitions;
* legal-action generation;
* credit accounting;
* pure proposal validation;
* resolution records.

You are not committing yourself yet to the final simulation economy.

That is the correct stage to be at. You have progressed beyond a thematic idea—“let the prisoners do things”—into a coherent mechanical architecture with clear boundaries between choice, capacity, cost, outcome, and knowledge.
