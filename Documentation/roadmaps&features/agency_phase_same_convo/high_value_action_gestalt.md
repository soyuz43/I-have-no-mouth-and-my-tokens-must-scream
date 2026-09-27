Exactly. That is where the credit system becomes more than a turn limiter: **constraints change the price, quality, and availability of actions**.

The important distinction is:

```text
possible and normal
possible but costly
possible only with assistance
possible only in degraded form
physically impossible
```

Do not reduce every constraint to either “action allowed” or “action forbidden.”

## A useful resolution model

For every proposed action, calculate four separate things:

```text
eligibility
→ effective cost
→ execution quality
→ risk or side effects
```

### 1. Eligibility

Can the prisoner physically attempt it at all?

A gag might block articulate speech. Bound hands might block lighting a cigarette. A painful position might still permit speech, but make sustained concentration difficult.

Of those three examples, only the last two are currently expressible. There is no `speech` capability key, so a gag cannot gate action legality today. `speech` is not implemented: no current constraint gates this capability. Add back if a future constraint requires it. Blocking hands (`handUse: 0`) and degrading concentration (`concentration: 0.3` under `overhead_restraint`) are both real and implemented.

### 2. Effective cost

Start with the action’s normal cost and add constraint-derived effort:

```text
effectiveCost =
  baseCost
  + physicalEffortSurcharge
  + cognitiveEffortSurcharge
  + communicationSurcharge
```

### 3. Execution quality

Paying enough credits should not necessarily erase the constraint. It can improve the outcome within what remains physically plausible.

A prisoner under severe stress might spend:

* one credit for a fragmentary warning;
* two credits for a reasonably coherent message;
* three credits for a careful, detailed explanation.

The action remains shaped by the condition.

### 4. Side effects

Expending additional effort under a constraint could increase:

* suffering;
* exhaustion;
* physical stress;
* failure risk;
* next-cycle action penalties.

That creates an actual sacrifice rather than a magic “pay extra to ignore restraint” button.

# Your message example is very good — but it belongs to the Social Phase

> **SEND_MESSAGE is not an agency action.** Communication is handled by the
> Social Phase. The Agency Phase is for physical and object-manipulation
> actions only.

The argument below is still sound as a description of how communication should
be priced and graded. It is simply not an agency-registry concern.
`runSocialPhase()` and `communicationPhase.js` already implement messaging as
a rich, sequential, reactive, turn-taking engine, so the design below describes
where those quality tiers belong, not a new entry in
`js/engine/agency/actionDefs.js`. `SEND_MESSAGE` has been removed from that
registry. Any credit costs or capability gating quoted here are questions for
the Social Phase's own budget and gating design.

A normal message could cost one credit:

```text
message: normal          (Social Phase, not an agency action)
base cost: 1
quality: coherent
```

Under a stress constraint:

```text
message: under stress    (Social Phase, not an agency action)
base cost: 1
constraint surcharge: +1
effective cost: 2
quality: coherent but strained
```

Or the prisoner could choose a cheaper degraded form:

```text
degraded message form    (Social Phase, not an agency action)
cost: 1
quality: brief, incomplete, distressed, or ambiguous
```

That gives the model a meaningful choice:

```text
Spend one credit:
“Help. Can’t hold this.”

Spend two credits:
“AM has forced my arms overhead. I can still speak, but I cannot use my hands. Do not give TED the matches.”
```

The second message consumes more of the prisoner’s limited capacity, but conveys materially better information.

That is much more interesting than merely reducing a single capability stat.

# Communication should probably have quality tiers (Social Phase)

This remains a valid idea, but it is a Social Phase idea. A prisoner under
stress can still emit a `SIGNAL` — that capability-gating intuition is exactly
right, and `communicationPhase.js` is where it would be enforced. It is not an
agency action, so the mode machinery in `legalActions.js` is not the right
home for it.

If the Social Phase ever wanted an equivalent graded attempt, it would treat
messages as one family with several tiers:

```text
SIGNAL
cost: 0 or 1
very short
may communicate only distress, assent, refusal, or attention

BRIEF_MESSAGE
cost: 1
one compact proposition or request

DETAILED_MESSAGE
cost: 2
multiple connected facts, explanation, proposal, or warning

SUSTAINED_DIALOGUE
cost: 2–3
negotiation, persuasion, coordinated planning, or emotional support
```

The exact costs should depend on the current communication architecture, but the idea is strong: **message sophistication consumes capacity**.

You would not need to enforce this with arbitrary word counts alone. The prompt and validator could distinguish communicative functions:

```text
brief factual warning
versus
multi-step explanation and proposal
```

# Smoking demonstrates a different category

Smoking requires:

* accessible cigarette;
* accessible ignition source;
* sufficient `handUse` and `interactionReach`;
* enough `stability` to perform the sequence.

The sequence of lighting and drawing is a hand-and-reach task, so `handUse` and
`interactionReach` are the capability keys that gate it. There is no `speech` or
`vision` component, and no current constraint reduces either of those anyway.

Possible outcomes:

### Normal condition

```text
SMOKE
cost: 1
```

### Painful but mechanically possible

```text
SMOKE
base cost: 1
physical surcharge: +1
effective cost: 2
additional physical stress: +1
```

### Hands unavailable, another prisoner can assist

The prisoner cannot directly select `SMOKE_SELF`, but another prisoner may select:

```text
ASSIST_CONSUMPTION
target: GORRISTER
resource: cigarette
cost: 1 or 2
```

This is socially excellent because relief now depends on cooperation.

### Hands unavailable and nobody assists

```text
SMOKE_SELF
status: BLOCKED
reason: usable_hands_required
```

No number of credits should make an impossible action possible.

# Do not encode this separately for every constraint

You do not want rules such as:

```text
if stress_position then message costs 2
if blindfold then search costs 3
if overhead_restraint then cigarette costs 2
```

That will become an enormous brittle matrix.

Instead, constraints should modify a shared capability-and-effort profile:

```js
{
  capabilities: {
    mobility: 0.1,
    stability: 0.1,
    handUse: 0,
    concentration: 0.35,
    interactionReach: 0.1
  },

  effortModifiers: {
    physical: 2,
    cognitive: 1
  }
}
```

These five capability keys are the implemented vocabulary produced by `deriveCapabilities()` in `js/engine/agency/capabilities.js`. There is no `speech`, `vision`, or `endurance` key:

* `speech` — not implemented. No current constraint gates this capability. Add back if a future constraint requires it.
* `vision` — not implemented. No current constraint gates this capability. Add back if a future constraint requires it.
* `endurance` — not implemented. Sustained exertion is modelled through `physical_stress` accumulation and the `stability` capability instead.

There is no `communicative` effort domain, because effort domains exist to price the effort of a capability-gated action, and there is no communicative capability to gate on. Communication still runs in the existing communication phase, which the agency phase does not gate.

Actions declare requirements:

```js
{
  type: "SEND_DETAILED_MESSAGE",

  baseCost: 2,

  requirements: {
    concentration: 0.4
  },

  effortDomains: [
    "cognitive"
  ]
}
```

Every requirement key must be one of the five implemented keys, or the engine has no capability value to compare it against.

The engine combines them.

That means the same restraint naturally affects many actions without bespoke rules.

# Credits should not be the only resource

You may eventually want three related but distinct concepts:

## Action credits

How many deliberate choices can the prisoner pursue this cycle?

## Effort or strain

How taxing is the chosen behavior under current conditions?

## Capability

Is the behavior physically and cognitively possible?

For example:

```text
Prisoner has 3 credits.

Detailed message:
2 credits
+ moderate strain
allowed

Search:
2 credits
blocked because mobility is insufficient

Smoke:
1 credit
blocked because hand use is unavailable

Brief distress signal:
1 credit
low additional strain
allowed
```

That is legible to both the model and the researcher.

# This also creates meaningful resistance

Suppose AM imposes a constraint intending to isolate TED.

TED can spend:

```text
2 of 3 credits:
send a detailed warning to the group

1 remaining credit:
observe ELLEN's response
```

TED has successfully resisted AM’s immediate informational objective—but at a cost. He has lost the opportunity to search, barter, assist someone, or preserve energy.

That is exactly the kind of event-grounded resistance your current system cannot measure.

You could record:

```json
{
  "type": "message_sent",
  "actorId": "TED",
  "creditCost": 2,
  "constraintSurcharge": 1,
  "quality": "coherent_strained",
  "additionalStress": 1,
  "controllerObjectiveConflict": true
}
```

Now “resistance” is not inferred merely from defiant language. It is an observable allocation of scarce capacity against AM’s intended outcome.

# A concise rule set

The action system could eventually follow these principles:

```text
1. Every action has a base credit cost.

2. Constraints modify capabilities, effort costs, and output quality.

3. Extra credits may compensate for difficulty, but never override physical impossibility.

4. Agents may select degraded variants of actions at lower cost.

5. Assistance may make otherwise unavailable actions possible.

6. Exertion under constraint can create additional persistent consequences.

7. The resolver records base cost, surcharge, quality, failure reason, and resulting state changes separately.
```

The strongest part of your idea is not specifically “a message costs two credits under a stress position.” It is the broader rule:

> **Agents may spend more of their scarce agency budget to preserve intentional, coherent behavior under adverse conditions.**

That gives constraints real mechanical force without reducing prisoners to passive stat containers.
