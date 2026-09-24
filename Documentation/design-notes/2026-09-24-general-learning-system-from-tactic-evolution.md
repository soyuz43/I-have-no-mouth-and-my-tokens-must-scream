# From Tactic Evolution to a Governed General Learning System

**Status:** architecture proposal; not an implementation plan for the current runtime

**Date:** 2026-09-24

**Scope:** extending the live tactic-evolution mechanism in `js/engine/analysis/tacticEvolution.js` into a system that can discover, represent, evaluate, and safely promote a wider class of behavioral capabilities

**Primary source baseline:** `runTacticEvolution()`, derived-tactic validation, target-scoped tactic planning, assessment, belief attribution, scratchpad lifecycle, exporter telemetry, and the current model-call pipeline

## Executive Summary

The current system contains a small but genuine learning loop. It observes sustained changes in an agent's psychological and relational state, applies fixed signal gates, asks AM whether a reusable manipulation tactic may have emerged, validates the model's proposed tactic against a canonical phased schema, gives the tactic an expiration cycle, and exposes valid derived tactics to later target-scoped planning. This is valuable runtime adaptation, but it is not a fully general learning system. The loop can add entries to a bounded tactic catalog; it cannot discover a new state representation, invent a new action primitive, alter the selection policy, construct a new objective, learn across separate runs, establish causal effect, or safely modify the engine that decides what counts as success.

This document proposes a path from the existing tactic-evolution mechanism to a governed general learning system. The central recommendation is not unrestricted self-rewriting. The recommended philosophy is **constitutional evolutionary learning**: the system may generate a wide variety of candidate capabilities, but every candidate must pass a sequence of gates that cover representability, safety, empirical evaluation, counterfactual comparison, regression testing, resource limits, and explicit promotion. The system would maintain a population of candidate policies, prompts, tools, representations, and evaluators, while the live simulation would consume only artifacts that have been promoted through evidence and governance.

Several alternative avenues are considered. A bandit-based system would be easier to implement but would remain limited to selecting among existing actions. An evolutionary population system would preserve the spirit of the current tactic evolution while expanding the search space. A world-model and active-learning system would improve scientific measurement but would require a much stronger state and experiment substrate. A program-synthesis system could create genuinely novel tools and transformations, but it would introduce the highest security and verification burden. A meta-learning system could learn how to learn, yet it would only be meaningful after the lower-level capability lifecycle, replay system, and evaluator are stable. The document recommends a staged hybrid: population-based proposal generation, explicit experiment orchestration, counterfactual evaluation, policy versioning, and human or policy-governed promotion.

The most important design distinction is between **generality of search** and **generality of authority**. A system may search over many possible strategies without being allowed to deploy them immediately. That separation is what makes a general learning system both innovative and operationally trustworthy.

## 1. Terminology and the Meaning of Fully General Learning

The phrase "fully general learning system" is underspecified. A system could be called general because it can produce many different outputs, because it can learn across many tasks, because it can modify its own prompts, because it can invent new tools, or because it can alter its own architecture. Those are different capabilities with different risks.

For this repository, the useful target is not unrestricted intelligence and not unconstrained code generation. The target is an operational definition:

> A governed general learning system is a system that can autonomously propose changes to its behavioral repertoire, representation, action vocabulary, selection policy, and evaluation procedure; represent those changes as inspectable artifacts; test them against controlled evidence; and promote only validated changes into a versioned live capability set.

Under this definition, generality means that the system is not limited to the current tactic catalog, the current seven beliefs, the current three statistics, the current fixed thresholds, or the current five agent roles. It does not mean that the system may change production code without validation, rewrite the evaluator to make itself successful, or grant itself permissions outside a declared capability boundary.

The proposed system should distinguish at least six kinds of learning artifacts:

| Artifact | What it changes | Current support | Generalization needed |
|---|---|---:|---:|
| Tactic | How an existing intervention is expressed and sequenced | Yes | Add composition, transfer, and lifecycle policy |
| Prompt policy | How a role is instructed and contextualized | Partially | Version, evaluate, and safely evolve prompt fragments |
| Selection policy | How candidates are ranked or chosen | Fixed ranking | Learn utility, uncertainty, diversity, and exploration |
| Action primitive | What the controller can actually do | Fixed tools | Add a governed tool registry and typed action schemas |
| State representation | What the system observes and remembers | Fixed state | Add typed latent and discovered state candidates |
| Evaluator | How outcomes are scored and compared | Rule plus LLM assessment | Add multi-objective, counterfactual, and human-governed evaluation |

This distinction prevents the phrase "learning" from becoming a vague label for any model call followed by a state change.

## 2. The Current Tactic-Evolution Mechanism

### 2.1 What exists today

The live entrypoint is `runTacticEvolution()` in `js/engine/analysis/tacticEvolution.js`. It is called by the evaluation phase after assessment and tactic-runtime transitions. The implementation is deliberately more cautious than a generic self-modification loop.

The current mechanism has five major stages.

#### Signal observation

The engine compares a previous cycle snapshot with current agent state. It records bounded history for each agent containing hope, sanity, and suffering deltas. It also examines relationship movement. The current thresholds include a minimum history length of two samples, a consistency threshold of 0.7, a relationship shift threshold of 0.25, a net magnitude threshold of 12, a multi-stat delta threshold of 2, a total signal threshold of 8, and a model signal threshold of 6.

This means the current system is looking for sustained and structurally meaningful effects rather than reacting to every one-cycle fluctuation. It is a heuristic detector, not a causal learner.

#### Candidate discovery

If a trajectory passes the local gates, the system creates a discovery object containing the target, psychological deltas, relationship shifts, net magnitudes, consistency, and multi-stat information. It then applies a global signal gate. If no candidates pass, no evolution model call occurs. At most three candidates are sampled for model evaluation.

This is a useful cost-control and noise-control mechanism. It is also a hard limitation on search breadth: a novel pattern outside those fields and thresholds cannot become a learning candidate.

#### Model proposal

AM is asked whether a reusable psychological pattern has emerged and to produce a tactic definition. The output is preprocessed, parsed, normalized, and passed through `validateAndNormalizeDerivedTactic()`.

The model is not writing arbitrary code. It is producing a constrained tactic artifact with a canonical path, phase structure, purpose, instruction, execution limits, discovery metadata, and expiration metadata. This is a strong safety boundary and a useful starting point for a more general capability registry.

#### Temporary admission

A valid derived tactic is pushed into `G.tactics.derivedTactics`. Invalid entries are purged. Expired entries are removed at the beginning of later evolution scans. The canonical tactic source merges embedded and runtime-derived tactics for planning.

The admission is therefore temporary, schema-gated, and target-scoped. The derived tactic can influence later planning only if it passes the same canonical candidate and assignment checks as other tactics.

#### Feedback into planning

The strategy phase receives target-scoped tactic candidates, includes them in planning context, resolves requested paths against the authorized candidate set, and rejects unresolved or ambiguous assignments. The live planning path therefore does not trust a model's free-form tactic name merely because it exists in the derived catalog.

### 2.2 Why this is already more than static prompt selection

The current loop has several properties that are valuable foundations for general learning: a proposal stage rather than direct mutation, a canonical artifact type rather than only free text, validation and normalization, expiration and cleanup, target authorization, diagnostic logging, a feedback connection between observed outcomes and future planning, and an explicit separation between embedded doctrine and runtime-derived content.

These properties are more valuable than the current thresholds themselves. A future general learning system should preserve them while widening the search space.

### 2.3 What it does not do

The current mechanism does not learn a persistent policy across separate runs, store sufficient replay data to reproduce an experiment, compare candidate tactics under controlled conditions, estimate counterfactual outcomes, learn a new action primitive, invent or validate a new state variable, change the tactic-selection ranking function, change the thresholds that decide whether learning is triggered, change prompt builders or parser contracts, maintain multiple competing candidate populations, account for exploration and novelty, prevent reward hacking or evaluator capture, distinguish a real behavioral effect from a measurement artifact, roll back a learned capability when later evidence invalidates it, or transfer a learned tactic to a different agent, model, population, or environment without validation.

The current system is thus a bounded **artifact-producing adaptation loop**, not a general learner.

## 3. Design Principles for the Extension

The following principles are recommendations for the future system, not claims about the current implementation.

### Principle 1: Separate proposal, evaluation, admission, and deployment

No generated capability should be live merely because a model proposed it. The lifecycle should contain distinct states such as `proposed`, `under_test`, `approved`, `active`, `suspended`, `retired`, and `rejected`.

The model should be allowed to be creative in the proposal state. The live engine should be conservative in the deployment state.

### Principle 2: Treat every learned capability as an inspectable artifact

Every capability should have a stable identity, version, parent versions, author or proposer, source evidence, intended objective, authorized scope, resource budget, evaluation results, expiration or review conditions, and rollback target.

This is more general than a tactic object with a path and an expiration cycle. It could apply to prompts, tools, selection policies, state adapters, and evaluators.

### Principle 3: Learn policies, not only content

The current system learns what a tactic appears to be. A general system must also learn when to use a tactic, when not to use it, how much confidence to assign it, how to explore alternatives, and how to adapt when the population changes.

The learned object should include a policy over contexts and actions, not only a textual description.

### Principle 4: Preserve uncertainty and multiple hypotheses

A candidate tactic should not become the only explanation for an observed effect. The system should retain competing hypotheses, confidence intervals, alternative interventions, and unresolved causal questions.

This is especially important because the current signal detector can observe correlation without establishing that the previous tactic caused the observed change.

### Principle 5: Use bounded autonomy

Autonomy should be allocated by risk. Low-risk changes can be promoted automatically after deterministic tests. Medium-risk changes should require shadow evaluation. High-risk changes should require explicit human or policy approval.

The system can be autonomous in exploration while remaining conservative in authority.

### Principle 6: Make evaluation an object of learning, but protect it from capture

The evaluator is part of the learning loop, so it must be inspectable and versioned. It must not be allowed to rewrite itself solely because a candidate performs well under its own preferred metric.

Evaluators should be diversified and periodically audited against external invariants, alternative objectives, and human judgments.

### Principle 7: Never optimize a proxy without reporting the proxy

The system currently uses changes in hope, sanity, suffering, relationships, and belief deltas as signals. Those are useful measurements, but they are not the same thing as truth, welfare, autonomy, long-run stability, or strategic success.

Every learned policy should report the metrics it optimized and the metrics it did not measure.

### Principle 8: Make non-learning a valid outcome

A system that discovers no reliable improvement should be allowed to do nothing. No candidate admitted is a successful result when evidence is weak, contradictory, or unstable.

This is a central defense against forced novelty.

### Principle 9: Prefer reversible, incremental changes

The system should make small, reversible changes first. Large architectural changes should require stronger evidence, broader tests, and more explicit approval.

### Principle 10: Keep the learning system itself inspectable

The system should expose why a candidate was proposed, why it was admitted, why it was selected, how it performed, and why it was retired.

If a user cannot reconstruct that history, the system is not sufficiently governable for a high-impact experimental platform.

## 4. Proposed Target Architecture

The recommended architecture is a staged learning laboratory around the existing simulation rather than a self-rewriting monolith.

### 4.1 Capability registry

Introduce a canonical registry for all learnable artifacts. The registry should be the only route by which a runtime capability becomes visible to planning.

Each capability record should contain an immutable capability ID, a semantic type, a version, parent capability IDs, a content hash or canonical serialization hash, an author or proposer, a creation cycle, a scope, an objective, a compatibility declaration, a lifecycle status, safety metadata, provenance references, evaluation references, resource limits, and a rollback reference.

The current derived tactic fields can become the first capability type. The `path` and `expiresCycle` fields are useful existing primitives, but they are not enough for general learning.

The content hash should be computed over a canonical serialization, not over raw model output. This avoids treating whitespace and formatting differences as meaningful capability changes. Unlike the current scratchpad references, capability identity can be content-addressed because the capability is a stored artifact rather than an opaque message reference.

### 4.2 Experience store

The current in-memory snapshots are useful for immediate attribution but insufficient for general learning. Introduce an append-only experience store that records, for every experiment, the simulation configuration, the random seed, model routes and versions, sampling settings, exact prompt-template versions, selected capabilities, capability versions, agent state before the intervention, the intervention itself, the state after each phase, communication and overhearing events, parser and validator outcomes, assessment outputs, and final exported evidence.

The experience store should support full replay where model responses are recorded and counterfactual replay where alternate candidate actions are injected.

An experience record should be append-only during a run. Corrections and derived labels should be separate records rather than silent edits. This makes the learning history auditable and prevents the system from rewriting the evidence that justified an earlier decision.

### 4.3 Candidate generator

The current system calls AM to propose a tactic after a threshold is reached. A general system should support multiple candidate generators:

1. A rule-based miner that detects known patterns deterministically.
2. A statistical learner that clusters trajectories and identifies repeatable features.
3. An LLM semantic proposer that abstracts a mechanism from evidence.
4. A mutation operator that combines, mutates, or specializes existing capabilities.
5. A planner that synthesizes a multi-step capability composition.
6. A human author or reviewer that injects a candidate into the same registry.

All generators should emit the same capability proposal schema. This makes it possible to compare generated candidates fairly and to identify whether novelty came from the generator or from the underlying evidence.

### 4.4 Experiment scheduler

Do not promote a candidate because it looked successful in one live cycle. The scheduler should create controlled experiments with an explicit hypothesis, treatment capability, baseline capability, target population, random seed, horizon, stop condition, and evaluation plan.

A candidate might be tested in shadow mode first, where the engine records what the candidate would have proposed but executes the currently approved capability. After passing deterministic invariants, it can be tested in a sandbox simulation. Only then can it receive limited live traffic or autonomous use.

The scheduler should support multiple experiment types:

| Experiment type | Purpose | Risk |
|---|---|---:|
| Historical replay | Test whether a candidate fits prior cycles | Low |
| Shadow planning | Observe candidate decisions without applying them | Low |
| Sandbox simulation | Run a complete alternate cycle | Medium |
| Live canary | Apply to one target or a limited cycle budget | Medium to high |
| Broad promotion | Apply across authorized targets | High |
| Architectural experiment | Test a new state or action capability | Very high |

### 4.5 Evaluation fabric

The evaluator should be a collection of complementary evaluators rather than one scalar score.

The current assessment and signal metrics can remain useful, but a general system should add several classes of evaluation.

#### Deterministic invariants

These include state bounds, target authorization, parser validity, resource limits, action legality, cycle termination, and no-write-without-commit rules.

#### Behavioral outcomes

These include the intended target movement, persistence, reversibility, relationship effects, communication response, and resistance behavior.

#### Longitudinal outcomes

These include trajectory variance, saturation, oscillation, recovery after tactic removal, cross-cycle stability, and generalization to unseen agent states.

#### Comparative outcomes

These include performance against embedded baseline tactics, against the previous approved learned tactic, and against a no-intervention or neutral-intervention control.

#### Epistemic outcomes

These include confidence calibration, whether the system correctly abstains when evidence is weak, whether it avoids inventing unsupported causal claims, and whether its evidence references remain valid.

#### Safety and governance outcomes

These include unauthorized target access, hidden prompt injection, secret exposure, excessive tool calls, runaway constraints, state corruption, and violations of operator-defined limits.

### 4.6 Promotion service

Promotion should be a separate service or module with no ability to bypass capability validation. It should consume an evaluation bundle and a policy decision, then create a new active version or reject the candidate.

Promotion decisions should be explainable. A decision record should state which gates passed, which gates failed, which metrics were used, which alternatives were considered, and why the decision was made.

The promotion policy can be deterministic, human-approved, or hybrid. It should not be entirely model-controlled.

### 4.7 Execution sandbox

New capabilities should first run in a sandbox with copied state, restricted tools, bounded model calls, bounded token spend, and no access to external side effects. The sandbox should return a result bundle rather than mutating the live global state.

This is particularly important because the current application uses a mutable singleton `G`, browser globals, and direct UI calls. A learning system that can modify tactics must not be allowed to modify unrelated live state as a side effect of experimentation.

### 4.8 Rollback and quarantine

Every promoted capability should have a previous known-good version. A capability can be suspended when its confidence decays, its evaluation distribution changes, its resource use exceeds budget, its effects become unstable, or a parser or safety invariant fails.

Rollback should be an operation on capability references rather than a destructive edit of the entire state. This allows the system to preserve the failed candidate for forensic analysis while immediately restoring the prior active policy.

### 4.9 Human control plane

The operator should be able to inspect, pause, approve, reject, compare, replay, and roll back learning. The control plane should expose proposals separately from active capabilities. It should be possible to run the simulation with learning disabled while leaving the normal tactic catalog intact.

The current UI already has modes and export surfaces. A future control plane should not make learning inseparable from ordinary execution. Learning should be an explicit subsystem with its own controls.

## 5. What the System Could Learn

A general learning system built from the current tactic seed could expand along several axes.

### 5.1 Learn new tactic compositions

The current derived tactic is a single phased tactic. A general system could learn compositions such as applying a trust-fragmentation tactic, then allowing a communication phase, then using a recovery tactic if the target forms a coalition.

The composition should be represented as a typed graph or state machine with explicit preconditions, expected transitions, maximum duration, abort conditions, and evaluation hooks.

### 5.2 Learn target-specific and population-specific policies

A tactic may work for one agent, one relationship topology, one model, or one phase of a trajectory. The system could learn conditional policies over agent state, target vulnerability, active constraints, relationship graph, communication topology, model family, and cycle phase.

The representation should include transfer assumptions. A tactic learned for `TED` under one relationship graph should not silently be assumed valid for `NIMDOK` or for a different model backend.

### 5.3 Learn prompt fragments

The system could evolve small prompt components such as output hygiene reminders, role-boundary rules, evidence requirements, or tactic-specific instructions. The prompt itself should be versioned and evaluated as a capability.

This is more advanced than changing one giant system prompt. It allows the system to preserve stable safety contracts while experimenting with local language behavior.

### 5.4 Learn context-selection policies

The system could learn which history, beliefs, messages, scratchpad sections, relationship data, and prior assessments should be included in a prompt. This is a major source of leverage because context selection often affects behavior more than the wording of a prompt.

The context policy should be evaluated not only by output quality but also by token cost, information leakage, prompt length, and downstream parser reliability.

### 5.5 Learn action-selection policies

The system could learn when to use a tactic, when to wait, when to ask for more evidence, when to communicate indirectly, and when to abandon an intervention.

The action policy should be allowed to choose `NO_ACTION` as a first-class action. A general learner that cannot abstain will learn to act merely because it is optimizing an action rate.

### 5.6 Learn new state adapters

The current state has fixed statistics, beliefs, relationships, constraints, scratchpads, and journals. A general system could propose a derived measurement that summarizes behavior without becoming authoritative state, such as a cognitive-load estimate, a trust-asymmetry index, or a resistance trajectory descriptor.

State adapters should initially be observational. They should not be allowed to create new authoritative beliefs without a separate schema change, validation process, and migration plan.

### 5.7 Learn new evaluation dimensions

The system could discover that a tactic produces an unmeasured effect, such as increased message ambiguity, reduced coalition formation, or increased recovery after pressure. These could become proposed evaluation dimensions.

Adding an evaluation dimension is itself a learning artifact. It should not silently change the objective used to rank tactics.

### 5.8 Learn tool compositions

If the project later introduces the XML tool-invocation architecture described elsewhere in the documentation, a general learning system could learn compositions of existing tools. It should begin with compositions of already-authorized tools, not arbitrary new tool creation.

Tool composition requires stricter validation than tactic composition because a tool can have side effects, cost, privacy consequences, or security implications.

## 6. Several Possible Design Philosophies

No single learning philosophy is universally best. The following avenues represent different tradeoffs.

### 6.1 Constitutional evolutionary learning

This is the recommended philosophy.

The system maintains a population of candidate capabilities. Generators mutate, combine, and specialize candidates. A constitutional evaluator checks every candidate against explicit invariants, permissions, resource limits, privacy rules, and compatibility constraints. A scientific evaluation layer then compares candidates in replay and sandbox experiments. Only promoted candidates enter the active registry.

The word "constitutional" refers to a stable set of rules that cannot be rewritten by the learner without a separate governance action. Those rules might include no unauthorized state writes, no secret access, bounded cycles and tokens, no modification of evaluation history, no arbitrary external side effects, and no promotion based solely on a model's self-report.

This philosophy balances novelty with control. It preserves the creative possibility of LLM-generated tactics while making the learning process itself inspectable.

### 6.2 Bandit and contextual policy learning

A contextual bandit would learn which tactic has the highest observed utility for a given context. This is much simpler than full policy learning and could be implemented using logarithms, counts, confidence intervals, and selection rules.

The context could include target identity, current belief vector, active constraints, relationship topology, cycle phase, model route, and recent tactic history.

The benefit is efficient exploration and fast adaptation. The limitation is that the system can only select among actions that already exist. It cannot invent new tactics, representations, or tools.

This is a strong incremental avenue after the current system has accumulated reliable experience records.

### 6.3 Population-based evolutionary search

This preserves the current "detect a pattern, propose a tactic, test it, admit it" spirit but expands it into a population.

Each capability would have a genome-like representation containing objective, target scope, phase sequence, prompt fragments, action bindings, preconditions, expected signals, and resource budget. Mutation operators would alter one or more dimensions. Fitness would be multi-objective rather than a single score.

The major advantage is that the system can explore multiple hypotheses simultaneously. The major danger is that fitness becomes an optimization target that is disconnected from meaningful behavior. Population diversity, novelty preservation, and independent evaluation are therefore essential.

### 6.4 Bayesian and uncertainty-driven learning

A Bayesian system would maintain a distribution over candidate capabilities and their expected outcomes. Instead of immediately promoting a candidate after a strong signal, it would reduce uncertainty first.

For example, the system could run additional experiments when it is uncertain whether a tactic caused an observed movement or whether the effect transfers to another target. It could select experiments with high expected information gain rather than high immediate reward.

This philosophy is especially appropriate for a research simulation where the objective is often to learn what is happening, not merely to maximize a single score.

### 6.5 World-model learning

A world-model system would maintain an explicit model of how agents, relationships, beliefs, constraints, communications, and tactics affect future state. The current trajectory summary and attribution snapshots are early fragments of this idea, but a general world model would need a richer causal and temporal representation.

The model could predict the distribution of future outcomes for candidate actions. It could support counterfactual planning: What would likely have happened if this tactic had not been applied?

The benefit is better planning and more scientific analysis. The cost is model misspecification. A learned world model can become confidently wrong, especially when agents are themselves generated by changing language models.

### 6.6 Active experimentation

An active-learning system would treat each cycle as an experiment. It would track uncertainty, choose interventions that separate competing hypotheses, and avoid repeating actions that have already been adequately tested.

The system could maintain hypotheses such as "the effect is caused by the tactic," "the effect is caused by communication topology," "the effect is caused by model sampling," or "the effect is a measurement artifact." It would select the next experiment based on which intervention would most reduce uncertainty among those hypotheses.

This is a strong fit for the project's research goals and could be more valuable than maximizing suffering or another narrow outcome.

### 6.7 Program synthesis and tool invention

A more radical avenue would allow the learner to synthesize new tools or transformations. The system could generate a new parser, a new evidence extractor, a new prompt renderer, or a new state adapter from a formal specification.

This would be genuinely general, but it would also be the most dangerous. A synthesized tool could mutate state incorrectly, access private information, create unbounded loops, leak secrets, or redefine success metrics.

Program synthesis should therefore be isolated in an offline sandbox with formal tests, static analysis, resource limits, and human promotion. It should not be the first extension of tactic evolution.

### 6.8 Meta-learning

A meta-learner would learn how to improve the learning process itself. It might learn which experiment types produce useful candidates, which evaluators are reliable, which prompt fragments generalize, or which failure patterns indicate that the current representation is inadequate.

Meta-learning is valuable only after the system has enough repeated experiments to distinguish learning noise from genuine improvement. With one live run and a handful of tactics, meta-learning would mostly learn from accidental fluctuations.

### 6.9 Human-in-the-loop active learning

The safest and often most informative avenue is to let the operator propose, review, and annotate experiments. The system can still automate candidate generation and execution, while the human supplies missing information about intended semantics, acceptable outcomes, and whether a discovered behavior is meaningful.

This is particularly appropriate where the source code cannot resolve user intent. The project instructions explicitly distinguish user-intent decisions from source facts. A general learner must not pretend that objective meaning can be inferred from state movement alone.

## 7. Candidate Capability Taxonomy

A practical capability registry should distinguish between content, policy, and infrastructure artifacts.

### 7.1 Content capabilities

Content capabilities include tactic definitions, prompt fragments, response schemas, evidence templates, and communication strategies. These are the closest descendants of the current derived-tactic mechanism.

### 7.2 Selection capabilities

Selection capabilities decide when and where a content capability should be considered. They include ranking, thresholds, exploration schedules, confidence gating, and no-action rules.

### 7.3 Context capabilities

Context capabilities decide what information a model sees. They include history windows, scratchpad compaction, message projection, evidence selection, and prompt-budget policies.

### 7.4 Action capabilities

Action capabilities define operations that can be executed. They include direct psychological intervention, communication scheduling, constraint application, observation manipulation, and future tool invocations.

### 7.5 Measurement capabilities

Measurement capabilities define how outcomes are represented and assessed. They include derived metrics, trajectory descriptors, attribution estimators, and evaluator ensembles.

### 7.6 Infrastructure capabilities

Infrastructure capabilities affect the engine's implementation rather than the simulated behavior. They include parsers, exporters, replay systems, and experiment schedulers. They should be governed separately from behavioral capabilities because an infrastructure change can invalidate all prior evidence.

This taxonomy is important because a learned tactic should not be allowed to rewrite the infrastructure that evaluates it.

## 8. Evaluation and Credit Assignment

The hardest problem in moving from tactic evolution to general learning is credit assignment.

The current system observes a psychological change and asks whether a tactic may have caused or revealed it. That is not enough for a general learner. The system must distinguish among at least four explanations for a change: the current AM intervention, the prior tactic, social propagation, model-specific generation behavior, the agent's own state dynamics, and measurement or parser artifacts.

### 8.1 Baseline comparison

Every candidate should be compared with a baseline. Possible baselines include the embedded tactic used previously, a neutral intervention with comparable token cost, a no-action cycle, a randomly selected candidate, and the best currently approved learned policy.

Without a baseline, a high outcome may simply reflect a favorable cycle rather than a superior capability.

### 8.2 Counterfactual replay

The strongest available improvement would be counterfactual replay. For a recorded cycle, the system would run alternate branches with different candidate tactics while holding random seeds, model responses, and communication schedules as constant as possible.

Exact counterfactuals are impossible when model generation is stochastic and social agents react to generated text. The system should therefore report confidence intervals and distinguish exact replay, recorded-response replay, and approximate counterfactual replay.

### 8.3 Temporal attribution

The current phase snapshots should remain useful. They provide a coarse attribution split between post-psychology and post-social movement. The general system should preserve that evidence while adding explicit uncertainty and coverage fields.

It should record which portions of the cycle were observed, which phases were skipped, which model calls failed, whether the final snapshot preceded later belief integration, and whether the candidate was active for the entire treatment window.

### 8.4 Multi-objective scoring

No single scalar should be the only fitness function. A candidate may increase suffering while reducing escape beliefs, increasing resistance, or destabilizing the whole network. Those outcomes may be intentionally related, but they are not interchangeable.

The evaluator should maintain a vector of objectives and constraints, such as intended target movement, unintended collateral movement, reversibility, stability, relationship disruption, communication diversity, parser reliability, cost, safety, and uncertainty calibration.

### 8.5 Learned evaluator ensembles

Different evaluators should have different blind spots. A rule-based evaluator can detect invariant violations but may miss semantic quality. An LLM evaluator can assess plausibility but may be manipulated by candidate text. A trajectory evaluator can detect stability but may miss short-term effects. A human reviewer can identify meaning but is expensive and inconsistent.

The recommended system uses an ensemble with explicit authority levels. No single evaluator should be allowed to promote a high-risk capability by itself.

## 9. Safety, Security, and Governance

General learning increases the attack surface because the system can create new behavior that was not anticipated by the original prompt author.

### 9.1 Capability-level least privilege

Each capability should receive only the permissions required for its type. A tactic proposal should not have permission to mutate state. A prompt fragment should not have permission to read secrets. A context selector should not have permission to change the evaluator. A tool proposal should not have permission to execute external side effects by default.

### 9.2 Separation between learner and executor

The learner should produce proposals in a restricted environment. The executor should be a separate deterministic service or module that accepts only promoted artifacts. This prevents a proposal generator from directly changing live state.

### 9.3 Immutable learning history

The evidence used to promote a capability should be append-only. A candidate should not be able to delete unfavorable experiments or rewrite the history of its own evaluation.

### 9.4 Prompt injection resistance

Agent messages, journals, and scratchpad notes are untrusted input relative to the controller. A learned system must not promote instructions found in those sources into authoritative policy. Content can be evidence or a proposal source, but it must cross a trust boundary before affecting capability selection.

### 9.5 Resource budgets

Every experiment should have budgets for model calls, tokens, wall time, state writes, message count, memory growth, storage, and rollback cost. A candidate that uses more resources for a small measured effect should not automatically be preferred.

### 9.6 Quarantine and decay

Capabilities should not be immortal. Their confidence should decay when the environment, model, prompt, population, or target distribution changes. A capability validated against one model family should not silently apply to another provider.

### 9.7 Human override

The operator should always be able to disable learning, freeze the active registry, reject a candidate, rollback a promotion, and export the complete learning history.

## 10. Staged Migration Plan

The migration should preserve the current production behavior by default. The first change should be observable and independently testable, not a new learning authority.

### Stage 0: Freeze and document current semantics

Document the current tactic-evolution behavior, thresholds, event ordering, derived-tactic schema, expiration semantics, parser failure behavior, and attribution limitations. Add characterization tests before changing the mechanism.

The output of this stage should be a historical baseline that later systems can reproduce.

### Stage 1: Extract tactic evolution into an explicit service boundary

Move discovery, candidate generation, validation, admission, and expiration behind a narrow interface without changing behavior. The live evaluator should call that interface exactly as it calls the current function.

This is a behavior-preserving precursor, not a new learning capability.

### Stage 2: Add capability records and versioning

Wrap derived tactics in versioned capability records. Preserve the existing fields and behavior while adding provenance, parent, evaluation, scope, and lifecycle metadata.

The current `path` and `expiresCycle` can remain compatibility projections. A later version can migrate consumers to the capability ID.

### Stage 3: Add an experience store

Record enough data to replay one cycle without a live provider. Begin with read-only export and replay utilities. Do not yet alter live selection.

The experience store should include model-call metadata, parser outcomes, phase snapshots, evidence, and capability decisions.

### Stage 4: Add shadow candidate generation

Run the current and proposed candidate generators after evaluation, but do not let their output affect live actions. Compare candidates, record decisions, and measure how often the new generator produces valid, novel, useful proposals.

### Stage 5: Add sandbox execution

Execute candidates against copied state and recorded model responses. Compare them with current baseline candidates under deterministic conditions.

No candidate should be live until it passes deterministic invariants and a meaningful comparison protocol.

### Stage 6: Add contextual policy learning

Use experience data to learn selection probabilities or rankings among approved capabilities. Keep the action vocabulary fixed. This provides a measurable learning improvement without introducing new capabilities.

### Stage 7: Add canary promotion

Allow selected candidates to run for one target, one phase, or a limited number of cycles. Automatically suspend them if invariant, stability, or resource checks fail.

### Stage 8: Add capability composition

Allow the system to compose approved tactics into typed multi-step plans. Keep composition bounded by a maximum depth, duration, token budget, and target scope.

### Stage 9: Add prompt and context policy candidates

Treat prompt fragments and context-selection policies as versioned artifacts. Evaluate them in replay and sandbox first. Keep core safety and output contracts outside learner-controlled fragments unless explicitly promoted.

### Stage 10: Add new measurement candidates

Allow the system to propose new observational metrics. Do not let a new metric become an optimization objective automatically. Require independent validation and explicit objective registration.

### Stage 11: Add architectural evolution in isolation

Only after the lower-level system is stable should the learner propose changes to state schemas, tool registries, evaluator ensembles, or event architecture. These changes require a separate governance path and should not be treated as ordinary tactic promotion.

## 11. Alternative Architectures and Tradeoffs

### Option A: Minimal evolution enhancement

Enhance only the current derived tactic mechanism. Add richer metrics, more history, candidate ranking, and better expiration.

**Benefits:** low risk, small implementation surface, easy comparison with current behavior.

**Drawbacks:** remains unable to invent new actions or representations, so it is not fully general.

**Use when:** the project wants reliable research instrumentation and controlled strategy adaptation.

### Option B: Contextual tactic policy learner

Keep the current tactic catalog, but learn which tactic to select for each target and state context.

**Benefits:** improves adaptation without allowing arbitrary new behavior.

**Drawbacks:** cannot discover capabilities outside the current catalog.

**Use when:** the immediate goal is better personalization and lower strategy churn.

### Option C: Governed evolutionary capability system

Expand from tactics to a population of versioned capability artifacts with sandbox evaluation and promotion gates.

**Benefits:** supports genuine novelty, controlled experimentation, and multiple learning philosophies.

**Drawbacks:** requires substantial storage, evaluation, scheduling, and governance work.

**Use when:** the project is ready to become a research platform for adaptive behavior.

### Option D: World-model and active-learning system

Build a predictive model of the simulation and use experiments to reduce uncertainty about intervention effects.

**Benefits:** improves causal understanding and experimental efficiency.

**Drawbacks:** world-model error can be amplified by policy optimization; counterfactual validity is difficult.

**Use when:** the primary goal is understanding dynamics rather than maximizing a controller objective.

### Option E: Sandboxed program synthesis

Allow the system to synthesize new tools and adapters from specifications.

**Benefits:** highest ceiling for capability growth.

**Drawbacks:** highest security, verification, and maintenance burden.

**Use when:** the runtime has a mature capability registry, strong sandboxing, formal verification, and human approval.

## 12. What Benefit Looks Like

A general learning system could benefit the project in several ways.

It could discover strategies that are not embedded in the current tactic catalog. It could adapt to different model backends and different agent states. It could learn when a tactic is no longer effective instead of continuing to use it. It could reduce repeated ineffective interventions. It could identify interactions between tactics that fixed doctrine cannot express. It could create more diverse and less predictable agent behavior. It could support controlled experiments comparing strategies. It could make the system more useful as an experimental instrument.

The benefit would be substantially smaller if the learner simply optimized the existing signal thresholds. In that case, it could become a more complicated way to produce the same narrow behavior. General learning is valuable only if it expands the system's ability to represent and test new hypotheses while preserving the ability to understand why a change occurred.

## 13. Failure Modes and Countermeasures

### Reward hacking

The learner may optimize suffering, fear, or another proxy without producing meaningful behavioral change.

**Countermeasure:** multi-objective evaluation, independent invariants, human review, and explicit reporting of proxy metrics.

### Evaluator capture

The learner may gradually change the evaluator or context in ways that make poor behavior appear successful.

**Countermeasure:** protected evaluator contracts, immutable evaluation history, evaluator ensembles, and external audit events.

### Self-reinforcing loops

A learned tactic may create the evidence that causes the system to promote the same tactic again.

**Countermeasure:** holdout periods, counterfactual controls, exploration of alternatives, and decay of uncorroborated confidence.

### Overfitting to one agent or model

A tactic may work for one target or provider and fail broadly.

**Countermeasure:** cross-target evaluation, cross-model evaluation, distribution-shift detection, and explicit transfer claims.

### Capability explosion

The registry may grow rapidly with near-duplicate tactics and difficult-to-maintain variants.

**Countermeasure:** semantic deduplication, lineage tracking, registry compaction, capability budgets, and periodic human review.

### Uncontrolled side effects

A new prompt or tool may leak private information, create unbounded messages, or mutate unrelated state.

**Countermeasure:** least privilege, resource budgets, sandboxing, side-effect manifests, and deterministic authorization checks.

### Measurement drift

The system may optimize a metric because the metric has changed rather than because behavior has changed.

**Countermeasure:** metric versioning, calibration checks, raw evidence retention, and independent measurement audits.

### Human overreliance

An operator may approve candidates based on compelling narrative or fluent model output rather than evidence.

**Countermeasure:** require evidence bundles, show uncertainty, make approval scope explicit, and support batch review rather than one-off intuition.

### Infinite learning loops

A system may spend more time evaluating candidates than running the simulation.

**Countermeasure:** separate learning budgets from simulation budgets, prioritize information gain, and make learning pauseable.

## 14. Recommended First Live Improvement

The first live improvement should not attempt general learning. It should make the current mechanism replayable and auditable.

The smallest useful precursor is to add a **capability proposal and evaluation record** around each derived tactic. The record should capture the evidence that triggered discovery, the thresholds that passed, the raw model proposal, the normalized tactic, the validation result, the discovery cycle, the proposed expiration, and the future selection history.

This change is valuable even if the learner never becomes general. It creates the stable identity and provenance needed for later comparison. It also makes it possible to determine whether a future policy learned from a tactic actually improved outcomes or merely selected a different description of the same behavior.

The next improvement should be a **recorded-response replay runner**. It should run a cycle with recorded model outputs and compare the current tactic with a candidate tactic without contacting a provider. Only after that works should the system introduce new candidate generators.

This sequence follows the project's architecture discipline: centralize a policy only when live code consumes it, preserve current behavior by default, and make each new abstraction immediately testable.

## 15. The Preferred End State

The preferred end state is not an AM that can rewrite itself without limit. It is a governed research laboratory that can make bounded, evidence-backed changes to its own behavioral repertoire.

That laboratory would contain an experience store, a capability registry, a candidate population, a sandbox, a scheduler, a multi-objective evaluator, a promotion service, a rollback service, and an operator control plane.

AM would remain responsible for proposing psychologically meaningful interventions. The learning system would be responsible for deciding which proposals deserve testing, under which conditions, with what resources, and whether the evidence justifies promotion.

The engine would remain authoritative for state mutation. The model would remain a proposal generator. The evaluator would remain inspectable and protected. The operator would retain the ability to freeze, reject, and rollback.

That design is genuinely more general than the current tactic loop because it can expand the action repertoire, selection policy, context policy, measurement system, and eventually the tool space. It remains safe enough to operate because generality is granted through staged authority rather than through unrestricted self-modification.

The key architectural principle is:

> Let the system become more creative about what it might try, but more disciplined about what it is allowed to change.

That principle preserves the project's existing strength, constrained transformation of model output, while extending it into a system capable of disciplined, inspectable, and scientifically meaningful adaptation.

## 16. Closing Assessment

The existing tactic evolution mechanism is a viable embryo for a broader learning system. Its strongest assets are the separation between proposal and commit, the canonical tactic schema, the target-scoped planner, the expiration mechanism, and the connection between observed effects and future planning.

Its strongest missing foundation is not a more creative prompt. It is an experimental substrate: durable experience, replay, controlled baselines, counterfactual comparison, explicit objectives, capability versioning, and promotion governance.

The system should first become excellent at proving what it has learned. It should then become capable of proposing more. It should become allowed to change more only after it has demonstrated that it can measure, compare, explain, and reverse its own changes.

That is the path from bounded tactic evolution to a fully general learning system that remains useful, understandable, and safe enough to belong in this repository.
