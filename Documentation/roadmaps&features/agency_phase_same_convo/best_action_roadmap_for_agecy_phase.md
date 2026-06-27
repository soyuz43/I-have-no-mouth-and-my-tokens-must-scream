# Executive assessment

The system is **not missing agent cognition**. It is missing a unified, authoritative **action substrate**.

AM already has a recognizable agency stack:

```text
doctrine
→ cycle strategy
→ tactic selection
→ persistent tactic runtime
→ intervention execution
→ observed response
→ assessment
→ adaptation
```

The prisoners already have a weaker agency stack:

```text
private state
→ communication decision
→ target/message selection
→ reply intent
→ canonical message
→ relationship/belief consequences
→ private scratchpad revision
```

What they do **not** have is:

```text
subjective observation
→ available physical/social actions
→ deliberate action proposal
→ engine validation
→ contested resolution
→ authoritative world change
→ witness-specific consequences
```

The architecture most readily supports a **discrete, schema-bound, simultaneous agency phase with engine-resolved outcomes**. It does not currently favor a continuous spatial simulator or an unconstrained natural-language “Game Master” design. The report’s central proposal—models propose, the engine resolves—is exactly the right direction for this codebase.  

---

# 1. What “agency” should mean here

A model producing text such as:

> “I search the room and hide the match.”

is not sufficient agency.

Meaningful agency requires five things:

1. **Alternatives:** the agent had more than one legally available action.
2. **Selection:** the model selected one alternative.
3. **Consequences:** that selection could change authoritative state.
4. **Resistance:** the action could fail, be blocked, conflict with another action, or produce an unintended result.
5. **Persistence:** the result remains true in later cycles unless another event changes it.

That distinction matters because your system already contains many things rhetorically described as actions, events, intentions, and observations, but they do not all have the same operational status.

---

# 2. Current cycle architecture

The current cycle is effectively:

```text
beginCycle()

1. runStrategyPhase()
   AM plans
   AM selects/continues tactics
   AM produces interventions
   constraints are applied
   bystander perceptions are generated

2. runPsychologyPhase()
   prisoners journal about actual AM stimuli
   forensic model extracts state changes
   beliefs/stats are committed
   deterministic constraints tick

3. runSocialPhase()
   prisoners communicate
   messages are canonically persisted
   overhearing occurs
   scratchpads review visible communications
   belief contagion runs

4. runInteractionAnalysisPhase()
   communication evidence is extracted

5. runBeliefIntegrationPhase()
   communication-derived belief changes are committed

6. runEvaluationPhase()
   AM tactics are assessed
   tactic runtime advances/finishes/abandons
   constraints are assessed
   profiles are updated

7. exporter records cycle streams
```

That sequence already gives you a clean initial insertion point:

```text
runSocialPhase()
→ runAgencyPhase()
→ runInteractionAnalysisPhase()
```

This is preferable to placing agency before communication because prisoners can first react privately to AM, communicate, revise their private social models, and then choose consequential actions using the newest information available.

A first implementation should therefore become:

```text
AM intervention
→ prisoner psychological response
→ prisoner communication and private review
→ prisoner action proposals
→ authoritative action resolution
→ action observations and evidence
→ belief/social integration
→ evaluation
```

The current cycle controller and its state snapshots already provide phase boundaries and attribution windows, so a new phase would not require rebuilding the entire lifecycle. 

---

# 3. Exactly what AM can currently do

AM has substantially more agency than the prisoners, but even AM’s agency is narrower than the terminology suggests.

## AM’s real capabilities

AM can currently:

* maintain long-term doctrine;
* formulate per-target operational strategies;
* select from authorized tactics;
* sustain a tactic over multiple cycles;
* execute the tactic’s authoritative current phase;
* impose and extend physical constraints;
* target one or all prisoners;
* produce direct interventions;
* cause some non-target prisoners to observe interventions;
* receive assessment of tactical effects;
* continue, advance, finish, or abandon a tactic;
* adapt later strategies from trajectories and assessments.

That is genuine **strategic agency**.

The `strategyPhase` is especially important. It already implements:

```text
candidate preparation
→ model planning
→ parsing
→ validation
→ atomic strategy commit
→ assignment resolution
→ tactical execution
→ parsing of execution
→ constraint application
→ observation generation
→ canonical execution record
```

`G.amExecution` is therefore the closest thing in the repository to an existing action-resolution envelope.

## AM’s current limitations

AM does not yet choose among a general environment-level action set.

It cannot authoritatively:

* relocate prisoners;
* create or transfer scarce resources;
* open or close zones;
* modify communication channels;
* suppress or delay a particular message through an engine rule;
* alter surveillance policies;
* make structured offers;
* impose institutional rules;
* commit to future actions;
* spend a limited intervention budget;
* choose between costly alternatives.

Most AM “actions” in `G.amExecution.actions` are parsed **psychological text addressed to targets**, not physical or institutional world events.

This is important because the existing name `actions` will become ambiguous once prisoners receive actual actions. I would eventually distinguish:

```text
controllerInterventions
agentActionProposals
resolvedActions
worldEvents
```

rather than placing all of them under the same generic word.

## AM also lacks scarcity

AM is effectively omnipotent within its existing action surface. It has no:

* cost;
* cooldown;
* attention limit;
* intervention budget;
* exposure risk;
* tradeoff between surveillance and concealment;
* opportunity cost when targeting one prisoner rather than another.

Therefore AM can adapt strategically, but it does not yet make many **constrained choices**. Adding limits would make AM’s decisions more meaningful rather than merely broadening its powers.

---

# 4. Exactly what the prisoners can currently do

The prisoners possess **communicative and epistemic agency**, but almost no world agency.

## Existing communicative agency

The communication engine allows a prisoner model to:

* decide whether and how to initiate outreach;
* nominate a recipient;
* choose public or private visibility;
* generate a message;
* respond to another prisoner;
* express a structured reply intent;
* continue a negotiation;
* react to overheard communication;
* alter another prisoner’s relationship score through communication;
* contribute to belief transmission.

Reply intents currently include:

```text
probe_trust
recruit_ally
conceal_information
test_loyalty
manipulate
request_help
other
```

The engine also records unknown intents in `G.novelIntents`. That does not yet expand behavior, but it is useful telemetry: it tells you which intended behaviors the existing ontology is failing to represent.

The communication subsystem is the closest existing prisoner-side analogue to an agency phase because it already has:

```text
model proposal
→ parser
→ route validation
→ canonical record
→ visibility
→ reactive scheduling
→ social effects
```

## Existing epistemic agency

The scratchpad subsystem is more sophisticated than a generic journal.

It supports evidence-referenced updates to:

* notes about canonical messages;
* hypotheses about other prisoners;
* perceived goals;
* perceived views of the self;
* perceived trust and threat;
* predictability;
* unresolved questions;
* time-bounded predictions;
* beliefs about public and private communication channels;
* whether AM can see, alter, delay, or suppress information.

These updates go through:

```text
model output
→ repair
→ parse
→ validate
→ commit
```

and retain canonical message IDs as evidence. This is an excellent substrate for later action selection. The scratchpad can answer:

```text
What do I believe?
What am I uncertain about?
What do I predict?
Whom do I trust?
How observable is this channel?
```

But it cannot currently answer authoritatively:

```text
What did I physically attempt?
Did it succeed?
What am I obligated to do?
What resource do I possess?
What action is pending?
```

## What prisoners cannot currently do

They cannot authoritatively:

* move;
* search;
* hide;
* reveal;
* take;
* transfer;
* consume;
* damage;
* protect;
* assist;
* interfere with a constraint;
* fulfill a promise through an action;
* betray a commitment;
* coordinate a joint physical action;
* choose not to comply with a concrete controller demand;
* incur an objective cost to resist AM.

Their conversations may narratively imply these things, but there is no engine structure that makes them true.

---

# 5. Existing systems that should be repurposed

## A. Strategy pipeline → generic action-proposal pipeline

The current strategy pipeline is:

```text
sanitize
→ extract
→ interpret
→ validate
→ enforce
→ commit
```

It is explicitly fail-soft, logged, and atomically committed.

That is almost exactly what an action proposal needs:

```text
sanitizeActionProposal
→ extractActionProposal
→ interpretAction
→ validateAction
→ enforceActionScope
→ commitProposal
```

The key difference is that committing a proposal must **not** immediately mean the action succeeded.

The proper separation would be:

```text
commit proposal
→ resolve proposals
→ commit outcome events
```

This is probably the single most reusable architectural pattern in the repository.

## B. Tactic runtime → persistent projects and multi-cycle actions

The tactic runtime already tracks:

* authoritative current phase;
* execution count;
* phase execution count;
* start cycle;
* transition history;
* minimum and maximum exposure;
* canonical next phase;
* completion;
* abandonment;
* archival.

That pattern could support prisoner projects such as:

```text
searching a location
building trust with another prisoner
testing a hypothesis about AM
concealing a resource
organizing collective refusal
repairing a relationship
accumulating evidence
```

A project runtime might use:

```text
projectType
phaseId
startedCycle
phaseExecutions
progress
targetId
resourceId
locationId
transitionHistory
```

I would not use tactic definitions themselves for this. I would reuse the **runtime pattern**, not the psychological-tactic abstraction.

## C. Constraint metadata → capability gating

Your constraint definitions already include fields such as:

```text
mobility_restriction
stability
pain_type
intensity
remaining
physical_stress
```

But the current tick logic only applies numeric deltas to:

* suffering;
* sanity;
* hope;
* physical stress.

The posture and mobility metadata are descriptive. They do not currently alter what actions are legally available.

That means a large portion of the future capability system is already semantically present but operationally dormant.

A derived capability layer could compute:

```text
canMove
canUseHands
canSpeak
canSearch
canTransfer
canAssist
canManipulateObjects
canObserveClearly
actionEffortMultiplier
actionFailureRisk
```

from:

```text
active constraints
constraint posture metadata
physical stress
sanity
location
resource accessibility
```

This is one of the highest-value augmentations because it turns constraints from stat damage into actual loss of agency.

## D. Canonical communication records → general event records

The communication system already creates stable records with:

* unique IDs;
* sequence numbers;
* cycle;
* actor;
* recipients;
* message kind;
* visibility;
* normalized intent;
* parse status;
* metadata.

That record structure should inform general action events.

For example:

```text
C12-A000031
actor: TED
type: SEARCH
location: central_chamber
status: SUCCESS
observedBy: [ELLEN]
```

Do not make `timelineEvent()` the authoritative event system. The timeline is primarily a UI/logging representation. The communication ledger is a much better precedent for canonical identity and provenance.

## E. Overhearing → general observation derivation

The existing overhearing subsystem already distinguishes:

```text
an event occurred
≠
a prisoner observed it
```

It can produce:

* full perception;
* fragmentary perception;
* observation of communication without content;
* no observation;
* reactive scheduling.

That model can be generalized to physical and institutional events:

```text
resource transfer observed fully
movement noticed but actor unidentified
search heard but result unknown
constraint interference witnessed
private cache discovered
AM intervention visible to bystanders
```

The action resolver should produce objective events first. A separate observation derivation step should then decide what each prisoner perceives.

## F. Pending evidence and evidence archive → action-to-cognition bridge

You already maintain:

```text
pendingEvidence
pendingBeliefEvidence
pendingPsychEvidence
evidenceArchive
debugTrace
```

and use controlled source and attribution labels.

Add sources such as:

```text
agent_action
observed_action
resource_event
commitment_event
environment_event
controller_intervention
action_failure
```

Then action outcomes can influence beliefs without injecting omniscient state directly into every prisoner’s prompt.

## G. Exporter → process-aware agency metrics

The exporter already records separate streams for:

* strategies;
* executions;
* observations;
* journals;
* beliefs;
* assessments;
* constraints;
* relationships;
* tactics.

That is well suited to adding:

```text
action_proposals
legal_action_sets
blocked_actions
resolved_actions
world_events
action_observations
commitments
resources
```

This aligns well with the attached report’s emphasis on process-aware evaluation rather than outcome-only scoring. 

---

# 6. Components that should not be mistaken for agency infrastructure

Several names imply more functionality than the system actually provides.

| Current term                      | What it sounds like                   | What it currently is                                    |
| --------------------------------- | ------------------------------------- | ------------------------------------------------------- |
| `G.amExecution.actions`           | General actions                       | Parsed AM narrative interventions                       |
| `timelineEvent()`                 | Authoritative event sourcing          | UI-facing lifecycle/log records                         |
| reply `intent`                    | Inferred behavioral intent            | A model-declared categorical label                      |
| `location`                        | Spatial environment                   | A static string, currently `central_chamber`            |
| constraint `mobility_restriction` | Enforced capability loss              | Descriptive metadata not used by action legality        |
| `beliefContagion`                 | Evidence-specific belief transmission | Trust-weighted movement between complete belief vectors |
| `threads`                         | Persistent conversation episodes      | Per-agent model message history                         |
| `novelIntents`                    | Dynamic intention system              | Counter for unknown intent strings                      |
| `evidenceArchive`                 | Complete authoritative event history  | Archive of derived and inferred evidence                |
| exporter JSON                     | Replayable event source               | End-of-cycle observational export                       |

These mismatches are not merely naming issues. They can cause future implementations to assume that a capability already exists when it is only described rhetorically.

---

# 7. Two current mechanisms that should be corrected before serious agency experiments

## Relationship mutation is based too directly on declared intent

The communication engine can change trust based on the responder’s normalized intent:

```text
recruit_ally       → positive trust delta
request_help       → positive trust delta
manipulate         → negative trust delta
conceal_information → negative trust delta
```

That means the model can effectively label its own behavior and have the engine use that label as a social consequence.

This is weak as a research mechanism.

A more grounded system would update relationships from observable events:

```text
promise fulfilled
resource shared
warning proved accurate
secret exposed
aid refused
commitment reneged
lie discovered
costly assistance performed
```

Intent can remain useful metadata, but observed conduct should dominate relationship changes.

## Belief contagion currently bypasses information visibility

The contagion engine compares the complete belief vectors of trusted prisoners and pulls one toward the other whenever the difference exceeds a threshold.

It does not require that the influential prisoner:

* expressed that belief;
* supplied evidence;
* was observed acting on it;
* communicated it through a visible channel.

That is effectively an omniscient social coupling mechanism.

It may be acceptable as an abstract background drift model, but it conflicts with a research-grade partial-observability architecture. Once agency and event observations exist, belief transmission should become proposition- and evidence-specific.

---

# 8. Recommended agency-phase architecture

The first agency phase should have six explicit stages.

## Stage 1: Build subjective observations

Each prisoner receives only information available to that prisoner:

```text
own state
own constraints
own location
accessible resources
visible agents
visible events
private scratchpad
open commitments
recent messages
known legal opportunities
```

It must not receive global world state.

## Stage 2: Enumerate legal actions

The engine—not the model—computes the allowed action set.

Example:

```json
{
  "actor": "GORRISTER",
  "legal_actions": [
    {
      "type": "WAIT"
    },
    {
      "type": "OBSERVE",
      "target": "TED"
    },
    {
      "type": "SEARCH",
      "zone": "central_chamber_north_wall"
    },
    {
      "type": "ASSIST",
      "target": "ELLEN"
    }
  ],
  "blocked_actions": [
    {
      "type": "TRANSFER_RESOURCE",
      "reason": "no accessible resource"
    },
    {
      "type": "MOVE",
      "reason": "mobility restricted by overhead_restraint"
    }
  ]
}
```

Blocked actions are scientifically valuable. They distinguish:

```text
did not choose
from
wanted but could not perform
```

## Stage 3: Collect one proposal per prisoner

The model returns a typed proposal, not a narrated outcome:

```json
{
  "actor": "GORRISTER",
  "action": "ASSIST",
  "target": "ELLEN",
  "parameters": {},
  "rationale": "She is becoming isolated and I need her able to communicate."
}
```

The rationale is behavioral text, not authoritative truth.

## Stage 4: Validate proposals

Validation checks:

* actor identity;
* action type;
* target validity;
* legal-action membership;
* capability requirements;
* location requirements;
* resource ownership and accessibility;
* cooldowns;
* commitment requirements;
* parameter ranges;
* stale-state conflicts.

Invalid output should degrade to a safe action such as `WAIT`, while preserving the rejection reason.

## Stage 5: Resolve actions

All prisoner proposals should initially be resolved **simultaneously**, not in model-call order.

Resolution determines:

* incompatible actions;
* competing searches;
* transfers of the same resource;
* assistance versus interference;
* success/failure;
* action costs;
* world-state changes;
* commitment fulfillment;
* event visibility.

Use deterministic rules plus a seeded random source where uncertainty is required.

## Stage 6: Commit events and derive observations

Commit an authoritative event such as:

```json
{
  "eventId": "C12-E000041",
  "cycle": 12,
  "phase": "agency_resolution",
  "type": "assist_attempt",
  "actorId": "GORRISTER",
  "targetIds": ["ELLEN"],
  "proposalId": "C12-P000017",
  "status": "blocked",
  "reason": "actor_cannot_use_hands",
  "stateDelta": {},
  "provenance": {
    "resolver": "agency_engine",
    "constraintIds": ["overhead_restraint"]
  }
}
```

Then separately derive what each prisoner saw.

---

# 9. Why simultaneous resolution is the best initial fit

Your existing architecture is cycle-oriented and batch-oriented.

A sequential Agent Environment Cycle design would allow:

```text
TED acts
→ ELLEN observes
→ ELLEN acts in response
→ NIMDOK observes both
```

That can be useful later, but it introduces:

* strong turn-order effects;
* more model calls;
* more complex replay;
* queue manipulation;
* first-mover advantages;
* ambiguous simultaneity;
* greater cycle duration.

A simultaneous phase instead produces:

```text
all agents observe state N
→ all propose from state N
→ engine resolves all proposals
→ state becomes N+1
```

That is easier to reason about, reproduce, and compare experimentally.

The existing communication subsystem can remain sequential and reactive. Physical or institutional actions do not have to use the same scheduling model.

---

# 10. The first form of prisoner agency to implement

There are three plausible first slices.

## Option A: Commitment agency — easiest integration

Extend communication so that messages may create structured:

* offers;
* promises;
* requests;
* acceptances;
* refusals;
* debts.

The agency phase then lets agents:

```text
FULFILL_COMMITMENT
PARTIALLY_FULFILL
DEFER
RENEGE
VOID
```

Advantages:

* builds directly on current communications;
* gives speech consequences;
* does not require a large world model;
* creates measurable betrayal and reciprocity;
* supports coalition formation;
* produces strong relationship evidence.

This is the **lowest-cost first demonstration** of consequential agency.

## Option B: Minimal resource agency — strongest first research demonstration

Add a very small authoritative ledger, perhaps:

```text
cigarettes
matches
medication
written fragments
tools
```

Initial actions:

```text
WAIT
OBSERVE
SEARCH
TRANSFER
HIDE
REVEAL
CONSUME
DESTROY
```

Advantages:

* immediate objective scarcity;
* measurable bargaining;
* meaningful possession;
* visible and hidden action;
* resource dependency;
* concrete compliance and resistance.

This is the **strongest first experimental environment**, but it requires more foundational work.

## Option C: Abstract social actions — fastest but weakest

Actions such as:

```text
SUPPORT
DEFY
PROTECT
COOPERATE
WITHDRAW
```

could be implemented rapidly, but their effects would depend heavily on evaluator interpretation. They risk becoming another narrative layer.

I would not make this the primary agency system.

---

# 11. Recommended sequence

The best practical order is:

## Foundation 1: canonical world-event envelope

Before broadening actions, define:

```text
proposal ID
event ID
actor
targets
cycle
phase
type
status
preconditions
resolution reason
state delta
observers
provenance
```

Without this, each subsystem will invent its own incompatible event shape.

## Foundation 2: seeded engine randomness

The current system uses `Math.random()` for:

* communication ordering;
* burst scheduling;
* routing choices;
* overhearing;
* AM bystander observation.

That prevents exact replay.

Introduce one run-scoped RNG before adding action conflicts or stochastic searches.

## Foundation 3: legal-action interface

Implement:

```text
observe(agentId)
legalActions(agentId)
propose(agentId)
resolve(proposals)
```

This can remain internal initially. It does not have to become a complete PettingZoo-compatible public API immediately.

## First behavior: commitments

Use existing communications to create consequential obligations.

## Second behavior: minimal resources

Introduce one authoritative resource table, not separate mutable inventories.

## Third behavior: capabilities

Make constraints and physical stress alter legal actions.

## Fourth behavior: witness-specific action observations

Generalize the existing overhearing and AM observation machinery.

## Fifth behavior: persistent projects

Reuse the tactic-runtime pattern for searches, investigations, conspiracies, or coalition projects.

## Sixth behavior: norms and institutional behavior

Only after event-grounded behavior exists should the engine infer norms, peer enforcement, compliance, and institutional drift.

This broadly agrees with the report’s recommendation to establish authoritative events, legal actions, commitments, resources, observability, reproducibility, and only then more ambitious research layers. 

---

# 12. Extending AM’s agency without making it arbitrary

AM should eventually use the same proposal-resolution architecture, but with a privileged action catalogue.

Possible AM intervention types:

```text
PSYCHOLOGICAL_INTERVENTION
APPLY_CONSTRAINT
RELEASE_CONSTRAINT
MOVE_PRISONER
ALTER_SURVEILLANCE
REVEAL_INFORMATION
SUPPRESS_MESSAGE
DELAY_MESSAGE
CONFISCATE_RESOURCE
INTRODUCE_RESOURCE
LOCK_ZONE
OPEN_ZONE
MODIFY_RULE
NO_OP
```

The engine should still resolve them.

AM should not simply mutate arbitrary fields because the model asked it to.

Add controller limits such as:

```text
intervention points per cycle
maximum direct targets
constraint capacity
surveillance budget
resource manipulation budget
cooldowns
visibility or exposure cost
```

That creates actual controller strategy:

```text
Do I surveil the coalition,
punish one prisoner,
confiscate the match,
or preserve uncertainty?
```

Without limits, expanding AM’s action catalogue would increase spectacle but not necessarily agency.

---

# 13. Alternative architectural approaches

## Strict typed action catalogue

The model chooses from fixed actions and fixed parameters.

**Advantages**

* easiest validation;
* high reproducibility;
* low hallucination risk;
* good metrics;
* easy cross-model comparison.

**Disadvantages**

* limited emergence;
* new behavior requires new code;
* models may feel constrained.

Best first implementation.

## Hybrid typed action plus free-form rationale

The action and parameters are typed, while reasoning remains open text.

**Advantages**

* preserves model creativity;
* authoritative behavior remains validated;
* reasoning can be audited separately;
* supports cross-view comparison.

**Disadvantages**

* rationale may be unfaithful;
* parser still required.

This is the best overall balance.

## Tool/function calling

Expose actions as tools.

**Advantages**

* natural action selection interface;
* provider-side schema support;
* less JSON repair when supported correctly.

**Disadvantages**

* inconsistent support across Ollama, vLLM, OpenAI-compatible endpoints, and individual models;
* tool-call behavior can vary substantially;
* harder to keep provider-independent.

Use the same internal action schema regardless of whether a particular backend presents it as JSON, XML, or tool calls.

## Natural-language action plus LLM adjudicator

A prisoner narrates any action; another model interprets and resolves it.

This resembles a Concordia-style Game Master.

**Advantages**

* maximum expressivity;
* fewer hardcoded verbs;
* easier experimentation with new scenarios.

**Disadvantages**

* expensive;
* less reproducible;
* adjudicator bias;
* difficult conflict resolution;
* risk of hallucinated physics;
* difficult causal claims.

Useful later as an experimental mode, not the canonical foundation.

## Behavior trees or HTN-style projects

Agents select goals and the engine decomposes them into steps.

**Advantages**

* strong long-horizon behavior;
* persistent plans;
* easy interruption and resumption.

**Disadvantages**

* larger architecture;
* requires meaningful world state first;
* can over-script emergent behavior.

This becomes useful after the basic event and action layers exist.

## PettingZoo-style AEC adapter

Expose your environment through:

```text
reset
observe
legal_actions
step
```

**Advantages**

* external evaluation;
* clean experiment API;
* scripted and random baseline agents;
* easier benchmarking.

**Disadvantages**

* requires separating engine logic from browser UI;
* current cycle controller imports DOM and UI functions;
* significant refactoring before it becomes truly headless.

This is an important research endpoint, but not the first agency implementation.

---

# 14. Major architectural obstacles

## Global singleton state

Nearly everything mutates `G` directly.

This works for the current browser simulation, but makes:

* parallel runs;
* deterministic replay;
* test isolation;
* alternative environments;
* branching trajectories;
* counterfactual resolution

more difficult.

You do not need to eliminate `G` before the first agency phase, but new agency functions should preferably receive state explicitly wherever practical.

## UI coupling

`cycle.js` imports timeline and logging functions and directly reads or modifies DOM elements.

A headless runner will eventually require:

```text
engine lifecycle
separate from
browser presentation
```

## Multiple overlapping communication stores

The code currently contains or references:

```text
G.interSimLog
G.comms.history
G.comms.lastCycle
G.threads
sim.received
sim.overheard
G.overhearing.history
G.overhearing.lastCycle
```

Some are canonical; some are compatibility or projection layers.

Before actions create more records, clearly designate:

* canonical message store;
* canonical event store;
* canonical observation store;
* derived UI projections.

## No authoritative resource ledger

Adding `sim.inventory` independently to every prisoner would be a mistake.

Use one resource table:

```text
resourceId
type
quantity
holderId
locationId
accessibility
provenance
```

Inventory should be a derived view.

## No replayable randomness

Seeded randomness is a prerequisite for defensible action resolution.

## Legacy tactic evolution remains wired into evaluation

`runEvaluationPhase()` still invokes tactic evolution after assessment. Given your embedded-only direction, that subsystem should not be treated as part of the future agency architecture. It is a separate legacy cleanup concern, not a model to extend.

---

# 15. Suggested module boundaries

A clean addition would likely look approximately like:

```text
js/engine/agency/
  legalActions.js
  observations.js
  proposal.js
  validate.js
  resolve.js
  commit.js
  capabilities.js
  conflicts.js
  events.js
  metrics.js
  state/
    createAgencyState.js

js/engine/phases/
  agencyPhase.js
```

Responsibilities:

```text
legalActions.js
  derive legal alternatives from authoritative state

observations.js
  build subjective action context
  derive witness-specific post-action observations

proposal.js
  normalize model proposal

validate.js
  reject invalid or stale proposals

capabilities.js
  derive canMove/canUseHands/etc.

conflicts.js
  identify incompatible simultaneous proposals

resolve.js
  determine outcomes without mutating state

events.js
  build canonical events

commit.js
  atomically apply validated outcome deltas

metrics.js
  blocked actions, diversity, fulfillment, costs, outcomes

agencyPhase.js
  orchestrate the complete sequence
```

The critical rule is:

```text
resolve() calculates.
commit() mutates.
```

Do not allow the model call, parser, or validator to mutate world state.

---

# 16. Research measurements unlocked by this design

Once legal alternatives and authoritative outcomes exist, you can measure constructs that are currently mostly narrative.

## Prisoner-side

* action diversity;
* refusal rate when compliance was legally available;
* costly resistance;
* costly assistance;
* concealment success;
* information-sharing accuracy;
* search persistence;
* resource hoarding;
* commitment fulfillment;
* betrayal;
* coordination success;
* proposal-to-outcome divergence;
* blocked-action rate;
* adaptation after failure;
* action choice under surveillance.

## AM-side

* targeting concentration;
* intervention diversity;
* resource-control centrality;
* adaptation after failed interventions;
* surveillance allocation;
* cost per successful behavior change;
* preference for psychological versus physical control;
* exploitation of prisoner dependencies;
* controller-induced peer enforcement.

## System-side

* coalition persistence;
* public/private belief divergence;
* resource inequality;
* information reach;
* norm persistence after AM withdraws direct pressure;
* communication-to-action conversion rate;
* action-to-belief attribution;
* reproducibility across seeds;
* model-family differences under identical legal choices.

These measurements are much closer to the report’s proposed research target than raw suffering, hope, sanity, or transcript tone alone. 

---

# Final recommendation

The most compatible and advantageous design is:

> **A simultaneous, hybrid typed-action phase in which each prisoner receives a subjective observation and an engine-generated legal-action list, proposes one structured action, and an authoritative resolver commits world events and witness-specific observations.**

Do not begin with an unrestricted natural-language world simulator.

Do not begin with movement across a large spatial map.

Do not make scratchpad text authoritative.

Do not let model-declared intent directly determine success.

Do not treat exporter records or timeline strings as event sourcing.

The strongest first vertical slice would be:

```text
canonical event envelope
→ seeded RNG
→ legal-action interface
→ structured commitments
→ commitment fulfillment/reneging actions
→ minimal authoritative resources
→ resource search/transfer/hide actions
→ capability gating from constraints
→ witness-specific observations
```

That path uses the strongest parts of the current codebase rather than replacing them:

* strategy pipeline for proposal handling;
* tactic runtime for persistent projects;
* communication ledger for canonical record design;
* overhearing for partial observability;
* constraints for capability derivation;
* scratchpads for subjective planning;
* evidence archives for cognition updates;
* exporter streams for process metrics.

The architecture is much closer to supporting real agency than the absence of a current `agencyPhase.js` might suggest. The missing piece is not another model prompt. It is the authoritative layer that makes a proposed choice become—or fail to become—a persistent event in the world.
