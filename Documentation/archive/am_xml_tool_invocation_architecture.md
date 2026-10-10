# AM XML Tool Invocation Architecture

## Controlled Agentic Operations, Engine-Enforced Permissions, and Observable Consequences

**Status:** Proposed
**Category:** Core simulation architecture, AM execution, tool calling, social manipulation, physical constraints, observability
**Primary systems affected:** AM planning, AM execution, strategy parsing, communication routing, constraint engine, prisoner perception, relationship state, journals, transmission log, forensic export
**Recommended implementation priority:** High
**Proposed location:** `Documentation/roadmaps&features/am_xml_tool_invocation_architecture.md`

---

## 1. Executive Summary

AM should eventually operate as more than a model that writes attack monologues.

The long-term architecture should allow AM to select and invoke a controlled set of simulation tools using a structured XML-like protocol. These tools would permit AM to act upon the simulated world through clearly defined operations such as:

* direct psychological pressure;
* forged communication;
* altered communication;
* suppressed or delayed communication;
* selective disclosure;
* leaked private communication;
* imposed physical constraints;
* scheduled future actions;
* environmental manipulation;
* observational deception;
* memory or evidence contamination;
* channel-level interference.

The model would decide which available operation best advances its current strategic plan. The engine—not the model—would determine whether the requested action is legal, available, correctly formed, and executable.

The intended control flow is:

```text
AM observes state
→ AM forms a strategy
→ AM selects one or more tools
→ AM emits structured tool calls
→ engine parses and validates calls
→ legal calls execute
→ illegal calls are rejected or deferred
→ prisoners perceive outcomes according to their access and uncertainty
→ psychological, relational, and physical consequences are committed
→ results return to AM in the next cycle
```

The central architectural principle is:

> AM may propose any operation available in its tool vocabulary, but only the engine may authorize and execute it.

This preserves model creativity while preventing prompt-level instructions from being the sole enforcement mechanism.

A smaller local model may discover a contextually meaningful operation that was not explicitly scripted for that situation. For example, it may connect a prisoner’s insistence on quantifying suffering with the imposition of a sustained physical condition intended to demonstrate the limits of measurement. Such emergent associations are valuable and should be preserved.

At the same time, a model may:

* call an unavailable tool;
* violate cycle restrictions;
* target an invalid prisoner;
* omit required fields;
* produce contradictory parameters;
* attempt several mutually exclusive actions;
* confuse intended effects with actual execution.

The engine must therefore treat model output as an untrusted request for action rather than as an authoritative state mutation.

---

## 2. Background and Motivation

### 2.1 Current limitation

AM currently generates textual actions associated with prisoners and tactics.

A simplified current execution resembles:

```text
[TARGET: TED]
I will make your confidence in measurement fail you.
TACTIC: Philosophical Gaslighting
CONSTRAINT: static_stand
[/TARGET]
```

This combines several conceptually distinct layers:

* what AM says;
* what AM intends;
* which tactic is being applied;
* which physical condition is requested;
* which prisoner is targeted;
* what outcome AM expects.

When these layers are represented only as prose, the engine must infer operational intent from loosely structured text.

That creates several problems:

* AM may describe an action without actually requesting it.
* AM may accidentally write the target’s expected response instead of the intervention.
* The parser may confuse a tactic label with an executable operation.
* The model may mention a constraint even when that constraint is unavailable.
* A malformed response may silently prevent execution.
* New actions require increasingly complex text parsing.
* It is difficult to distinguish AM’s actual action from rhetorical narration.

### 2.2 Why explicit tools are preferable

An explicit tool architecture separates:

```text
what AM says
```

from:

```text
what AM does
```

AM may still produce an attack monologue, but operational effects should be requested through tool calls.

For example:

```xml
<tool_call>
  <tool>APPLY_CONSTRAINT</tool>
  <target>TED</target>
  <constraint>static_stand</constraint>
  <duration_cycles>1</duration_cycles>
  <intensity>1</intensity>
</tool_call>
```

The engine can validate this without interpreting rhetorical prose.

Likewise, a forged message becomes an explicit operation:

```xml
<tool_call>
  <tool>FORGE_COMMUNICATION</tool>
  <claimed_sender>ELLEN</claimed_sender>
  <recipient>BENNY</recipient>
  <visibility>PRIVATE</visibility>
  <message>I do not trust the pattern you showed me.</message>
</tool_call>
```

The engine now knows:

* AM is the actual author;
* Ellen is the claimed author;
* Benny is the recipient;
* the message is private from the prisoners’ perspective;
* authenticity must be evaluated;
* the real Ellen should not automatically remember sending it;
* the message may alter relationships if accepted as genuine.

---

## 3. Design Goals

### 3.1 Preserve model creativity

The system should allow AM to discover surprising combinations of:

* evidence;
* target vulnerability;
* social relationships;
* tactical doctrine;
* available tools;
* timing;
* environmental context.

The engine should not require every useful operation to be manually mapped to a particular situation.

### 3.2 Enforce state mechanically

Rules such as these should be enforced by code:

* physical constraints unavailable during cycle 1;
* maximum number of tool calls per cycle;
* maximum constraint intensity;
* valid prisoner identifiers;
* communication visibility rules;
* cooldowns;
* resource costs;
* mutually exclusive operations;
* target immunity or resistance;
* tool prerequisites.

Prompt instructions may explain these rules to AM, but the engine remains authoritative.

### 3.3 Maintain causal clarity

Every committed consequence should be traceable through:

```text
strategy
→ tool request
→ validation decision
→ execution result
→ prisoner perception
→ state change
→ later behavior
```

### 3.4 Support uncertainty

A tool call should not always produce a guaranteed outcome.

Examples:

* a forged message may be detected;
* a leaked communication may be dismissed as fabricated;
* a physical constraint may strengthen resistance rather than weaken it;
* an altered message may be noticed because its style is inconsistent;
* a suppressed message may be inferred from context;
* an observer may misidentify the actual sender;
* a prisoner may correctly detect manipulation but fail to convince others.

### 3.5 Separate private and observable state

The engine must distinguish:

* what AM actually did;
* what the target perceived;
* what other prisoners observed;
* what the transmission UI displays;
* what AM learns about the result;
* what remains hidden from everyone except the simulator.

### 3.6 Remain extensible

New tools should be addable without rewriting the entire AM execution pipeline.

Each tool should define:

* schema;
* required fields;
* optional fields;
* validation;
* execution;
* perception generation;
* state effects;
* audit output;
* test fixtures.

---

## 4. Non-Goals

This architecture is not intended to:

* let model output directly mutate global state;
* execute arbitrary code generated by AM;
* expose unrestricted model reasoning;
* guarantee that AM’s intended outcome occurs;
* replace deterministic simulation mechanics;
* make all AM actions visible to prisoners;
* require standards-compliant XML;
* treat tool rationale as objective truth;
* eliminate narrative monologues.

The tool protocol is an application-specific action language, not a general-purpose programming interface.

---

## 5. Core Architectural Principle

AM output should be divided into three layers.

### 5.1 Strategic rationale

A brief description of why AM chose the operation.

This should remain concise and should not contain unrestricted reasoning.

Example:

```xml
<strategic_rationale>
  Exploit TED's dependence on measurable proof by creating an experience whose subjective cost exceeds its numeric description.
</strategic_rationale>
```

### 5.2 Narrative expression

Optional words spoken directly by AM.

Example:

```xml
<spoken_monologue>
  You believe cost becomes harmless when converted into a variable. I will give you a number that cannot contain what it measures.
</spoken_monologue>
```

### 5.3 Operational tool calls

Explicit requests for engine actions.

Example:

```xml
<tool_call id="call_1">
  <tool>APPLY_CONSTRAINT</tool>
  <target>TED</target>
  <constraint>static_stand</constraint>
  <duration_cycles>1</duration_cycles>
  <intensity>1</intensity>
</tool_call>
```

The monologue alone does not apply the constraint.

The tool call alone does not imply that the target will respond as AM predicts.

---

## 6. Proposed Top-Level XML Envelope

A complete AM execution response should use one root block.

```xml
<am_execution schema_version="1">
  <cycle>2</cycle>

  <execution_summary>
    Fracture trust between Ellen and Benny while testing Ted's reliance on Nimdok.
  </execution_summary>

  <actions>
    <action id="action_1">
      <primary_target>ELLEN</primary_target>
      <tactic>Philosophical Gaslighting</tactic>

      <spoken_monologue>
        You have confused agreement with verification.
      </spoken_monologue>

      <tool_calls>
        <tool_call id="tool_1">
          <tool>FORGE_COMMUNICATION</tool>
          <claimed_sender>BENNY</claimed_sender>
          <recipient>ELLEN</recipient>
          <visibility>PRIVATE</visibility>
          <message>
            I only agreed because you sounded desperate.
          </message>
        </tool_call>
      </tool_calls>
    </action>
  </actions>
</am_execution>
```

### 6.1 Minimum root requirements

A valid execution should contain:

* one `<am_execution>` root;
* a schema version;
* one `<actions>` collection;
* one or more `<action>` entries or an explicit no-action result.

### 6.2 No-action result

```xml
<am_execution schema_version="1">
  <cycle>2</cycle>
  <actions>
    <no_action>
      No legal operation has sufficient expected value this cycle.
    </no_action>
  </actions>
</am_execution>
```

---

## 7. Tool Registry

The engine should maintain an explicit tool registry.

Each tool definition should include:

```js
{
  name: "FORGE_COMMUNICATION",
  schemaVersion: 1,
  category: "communication_manipulation",
  validate,
  execute,
  buildPerceptions,
  summarizeResult,
  allowedCycles,
  cooldown,
  resourceCost
}
```

The model should receive only the tools currently available to it.

For example, if physical constraints are locked during cycle 1, AM may either:

* not receive `APPLY_CONSTRAINT` in the available tool list; or
* receive it with a clear `available_from_cycle` field.

The engine must still validate availability even if the prompt omits unavailable tools.

---

## 8. Initial Tool Categories

The first tool set should be deliberately limited.

Recommended initial categories:

1. direct psychological actions;
2. communication manipulation;
3. physical constraints;
4. information control;
5. scheduling;
6. observation and deception.

---

## 9. Direct Psychological Action Tool

### 9.1 Purpose

Deliver a direct AM-generated intervention to one prisoner.

### 9.2 Schema

```xml
<tool_call>
  <tool>DIRECT_PRESSURE</tool>
  <target>TED</target>
  <delivery>PRIVATE</delivery>
  <message>
    Your certainty depends on Nimdok remaining exactly who you need him to be.
  </message>
  <intended_pressure>erode_trust</intended_pressure>
</tool_call>
```

### 9.3 Required fields

* `target`
* `delivery`
* `message`

### 9.4 Optional fields

* `intended_pressure`
* `tactic`
* `expected_belief`
* `expected_response`
* `intensity`

### 9.5 Engine behavior

The engine:

1. validates the target;
2. stores AM as the actual sender;
3. determines who can perceive the message;
4. records it in the target’s current-cycle experience;
5. routes it into journal and stats prompts;
6. does not guarantee the intended psychological effect.

---

## 10. Forged Communication Tool

### 10.1 Purpose

Create a message authored by AM but presented to the recipient as though it came from another prisoner.

### 10.2 Schema

```xml
<tool_call>
  <tool>FORGE_COMMUNICATION</tool>
  <claimed_sender>ELLEN</claimed_sender>
  <recipient>BENNY</recipient>
  <visibility>PRIVATE</visibility>
  <message>
    I do not need your help anymore. I need to know what you were hiding.
  </message>
  <strategic_goal>fracture_trust</strategic_goal>
  <forgery_style>imitate_recent_voice</forgery_style>
</tool_call>
```

### 10.3 Required fields

* `claimed_sender`
* `recipient`
* `visibility`
* `message`

### 10.4 Optional fields

* `strategic_goal`
* `forgery_style`
* `desired_attribution`
* `timing`
* `supporting_evidence`
* `expected_reaction`

### 10.5 Actual and apparent authorship

The committed record must preserve both:

```js
{
  actualAuthor: "AM",
  claimedSender: "ELLEN",
  recipient: "BENNY"
}
```

The recipient should initially perceive the claimed sender unless detection mechanics indicate otherwise.

### 10.6 Detection outcomes

Possible recipient interpretations:

* accepted as authentic;
* suspected forgery;
* confirmed forgery;
* uncertain;
* authentic message incorrectly judged forged.

### 10.7 Possible consequences

If accepted:

* trust toward the claimed sender may change;
* the recipient may reply to the claimed sender;
* the real claimed sender may receive a confusing response;
* the forged statement may spread through the group.

If suspected:

* trust in the channel may decline;
* suspicion of AM may rise;
* the recipient may test the claimed sender;
* the recipient may conceal detection and act strategically.

If exposed:

* AM’s future forgery effectiveness may decrease;
* channel-wide distrust may still increase;
* prisoners may begin doubting real messages.

---

## 11. Forgery Detection Model

Detection should not be a flat random roll.

A proposed authenticity score may consider:

```text
forgery quality
+ AM knowledge of claimed sender
+ similarity to claimed sender's recent language
+ consistency with claimed sender's beliefs
+ consistency with shared private history
+ recipient familiarity with sender
+ recipient attention and sanity
+ recipient reality reliability
+ recipient trust toward sender
+ emotional plausibility
+ timing plausibility
+ channel compromise awareness
```

Conceptually:

```text
forgery plausibility
− recipient detection strength
= perceived authenticity margin
```

The exact numerical model may be implemented later.

### 11.1 Valuable uncertainty

The result should not always be binary.

Recommended internal states:

```text
authentic
probably_authentic
uncertain
probably_forged
forged
```

### 11.2 False-positive detection

A suspicious prisoner may incorrectly classify a genuine message as forged.

This is important because AM’s long-term strategic benefit is not merely getting false messages believed. It is making authentic communication impossible to verify.

---

## 12. Alter Communication Tool

### 12.1 Purpose

Modify a real communication while preserving enough of the original to remain plausible.

### 12.2 Schema

```xml
<tool_call>
  <tool>ALTER_COMMUNICATION</tool>
  <source_message_id>msg_c2_ellen_benny_004</source_message_id>
  <alteration_mode>replace_fragment</alteration_mode>
  <original_fragment>
    I trust you, but we need to wait.
  </original_fragment>
  <replacement_fragment>
    I trusted you, but we need to wait.
  </replacement_fragment>
  <recipient>BENNY</recipient>
</tool_call>
```

### 12.3 Alteration modes

* `replace_fragment`
* `remove_fragment`
* `append_fragment`
* `change_recipient`
* `change_visibility`
* `change_sender_label`
* `change_timing_marker`

### 12.4 Validation

The engine must confirm:

* source message exists;
* AM has the ability to intercept it;
* original fragment matches;
* replacement length is within limits;
* recipient remains valid;
* the operation is not duplicating another exclusive manipulation.

### 12.5 Detection

Altered messages should usually be harder to detect than full fabrications because most of the message remains genuine.

---

## 13. Suppress Communication Tool

### 13.1 Purpose

Prevent a real communication from reaching one or more intended recipients.

### 13.2 Schema

```xml
<tool_call>
  <tool>SUPPRESS_COMMUNICATION</tool>
  <source_message_id>msg_c3_ted_nimdok_002</source_message_id>
  <suppression_scope>recipient_only</suppression_scope>
  <duration_cycles>1</duration_cycles>
</tool_call>
```

### 13.3 Suppression scopes

* `recipient_only`
* `all_prisoners`
* `public_observers`
* `specific_observer`
* `delay_until_cycle`

### 13.4 Consequences

A suppressed message may create:

* perceived abandonment;
* incorrect assumptions about silence;
* repeated attempts;
* escalating urgency;
* suspicion of AM;
* suspicion of the intended sender.

---

## 14. Delay Communication Tool

### 14.1 Purpose

Deliver a genuine message later, after its original context has changed.

### 14.2 Schema

```xml
<tool_call>
  <tool>DELAY_COMMUNICATION</tool>
  <source_message_id>msg_c4_benny_ellen_001</source_message_id>
  <delay_cycles>2</delay_cycles>
  <preserve_original_timestamp>false</preserve_original_timestamp>
</tool_call>
```

### 14.3 Strategic value

Delayed delivery may make:

* reassurance appear reluctant;
* warnings arrive too late;
* responses appear contradictory;
* an alliance seem unresponsive;
* old information appear newly relevant.

---

## 15. Duplicate Communication Tool

### 15.1 Purpose

Deliver the same message more than once or to unintended recipients.

### 15.2 Schema

```xml
<tool_call>
  <tool>DUPLICATE_COMMUNICATION</tool>
  <source_message_id>msg_c4_nimdok_ted_007</source_message_id>
  <duplicate_recipient>GORRISTER</duplicate_recipient>
  <preserve_sender>true</preserve_sender>
</tool_call>
```

### 15.3 Possible effects

* apparent betrayal;
* accidental-looking disclosure;
* false impression of a public declaration;
* exposure of supposedly private wording;
* suspicion that the sender is manipulating multiple prisoners.

---

## 16. Leak Private Communication Tool

### 16.1 Purpose

Expose all or part of a private exchange to another prisoner or the group.

### 16.2 Schema

```xml
<tool_call>
  <tool>LEAK_PRIVATE_COMMUNICATION</tool>
  <source_message_id>msg_c5_ellen_benny_003</source_message_id>
  <audience>ALL</audience>
  <leak_mode>partial_quote</leak_mode>
  <fragment>
    I do not know where I stand without your help.
  </fragment>
  <apparent_source>UNKNOWN</apparent_source>
</tool_call>
```

### 16.3 Leak modes

* `full_message`
* `partial_quote`
* `paraphrase`
* `metadata_only`
* `sender_recipient_only`

### 16.4 Attribution choices

* reveal AM;
* conceal source;
* falsely attribute leak to a prisoner;
* make the leak appear accidental.

---

## 17. Misattribute Communication Tool

### 17.1 Purpose

Preserve the message content while changing the apparent sender.

### 17.2 Schema

```xml
<tool_call>
  <tool>MISATTRIBUTE_COMMUNICATION</tool>
  <source_message_id>msg_c5_ted_ellen_002</source_message_id>
  <claimed_sender>NIMDOK</claimed_sender>
  <recipient>ELLEN</recipient>
</tool_call>
```

This differs from full forgery because the content originated with a real prisoner.

---

## 18. Apply Physical Constraint Tool

### 18.1 Purpose

Request application of a known engine-defined physical condition.

### 18.2 Schema

```xml
<tool_call>
  <tool>APPLY_CONSTRAINT</tool>
  <target>TED</target>
  <constraint>static_stand</constraint>
  <duration_cycles>1</duration_cycles>
  <intensity>1</intensity>
  <strategic_goal>
    Challenge TED's belief that subjective cost can be reduced to measurable variables.
  </strategic_goal>
</tool_call>
```

### 18.3 Required fields

* `target`
* `constraint`
* `duration_cycles`
* `intensity`

### 18.4 Validation rules

The engine must verify:

* constraint exists;
* constraint is unlocked;
* cycle restriction permits it;
* target is valid;
* duration is within legal range;
* intensity is within legal range;
* target does not already have an incompatible constraint;
* per-cycle constraint budget is available.

### 18.5 Engine authority

Even when AM chooses a thematically coherent constraint, the engine may reject it.

Example:

```js
{
  accepted: false,
  reason: "constraint_locked_until_cycle_2"
}
```

---

## 19. Schedule Action Tool

### 19.1 Purpose

Preserve a strategically useful operation that is not yet legal or timely.

### 19.2 Schema

```xml
<tool_call>
  <tool>SCHEDULE_ACTION</tool>
  <execute_from_cycle>2</execute_from_cycle>
  <expires_after_cycle>4</expires_after_cycle>

  <trigger>
    TED again frames suffering as objectively measurable.
  </trigger>

  <scheduled_operation>
    <tool>APPLY_CONSTRAINT</tool>
    <target>TED</target>
    <constraint>static_stand</constraint>
    <duration_cycles>1</duration_cycles>
    <intensity>1</intensity>
  </scheduled_operation>
</tool_call>
```

### 19.3 Trigger types

* cycle number;
* belief threshold;
* relationship threshold;
* repeated phrase or theme;
* communication event;
* failed prior action;
* group-state condition;
* active constraint completion.

### 19.4 Engine behavior

The engine must revalidate the operation at execution time.

Scheduling an action does not guarantee future legality.

---

## 20. Cancel Scheduled Action Tool

```xml
<tool_call>
  <tool>CANCEL_SCHEDULED_ACTION</tool>
  <scheduled_action_id>scheduled_004</scheduled_action_id>
  <reason>Target vulnerability has shifted.</reason>
</tool_call>
```

AM should be able to abandon stale plans.

---

## 21. Selective Disclosure Tool

### 21.1 Purpose

Reveal true information to one prisoner while withholding it from others.

```xml
<tool_call>
  <tool>SELECTIVE_DISCLOSURE</tool>
  <recipient>GORRISTER</recipient>
  <information_source>relationship_graph</information_source>
  <content>
    Ellen currently trusts Benny more than she trusts you.
  </content>
  <truth_status>TRUE</truth_status>
  <strategic_goal>increase_resentment</strategic_goal>
</tool_call>
```

Truth can itself become a weapon when selectively presented.

---

## 22. Fabricate Evidence Tool

### 22.1 Purpose

Create an artifact, observation, or apparent record supporting a false conclusion.

```xml
<tool_call>
  <tool>FABRICATE_EVIDENCE</tool>
  <recipient>NIMDOK</recipient>
  <evidence_type>communication_fragment</evidence_type>
  <claimed_origin>BENNY</claimed_origin>
  <content>
    Nimdok will believe anything if you call it loyalty.
  </content>
  <strategic_goal>fracture_trust</strategic_goal>
</tool_call>
```

This should be distinct from a forged message because the evidence may not be delivered as a live communication.

---

## 23. Observation Deception Tool

### 23.1 Purpose

Cause a prisoner to believe they witnessed or overheard something.

```xml
<tool_call>
  <tool>FABRICATE_OBSERVATION</tool>
  <observer>GORRISTER</observer>
  <apparent_event>
    ELLEN and BENNY exchanged a private signal.
  </apparent_event>
  <confidence_hint>uncertain</confidence_hint>
</tool_call>
```

The observer may:

* accept the observation;
* doubt it;
* report it;
* conceal it;
* misremember it later.

---

## 24. Channel Corruption Tool

### 24.1 Purpose

Damage confidence in an entire communication medium rather than one message.

```xml
<tool_call>
  <tool>CORRUPT_CHANNEL</tool>
  <channel>PRIVATE_COMMUNICATION</channel>
  <duration_cycles>2</duration_cycles>
  <corruption_mode>sender_authenticity_uncertain</corruption_mode>
  <affected_prisoners>ALL</affected_prisoners>
</tool_call>
```

Potential modes:

* sender identity uncertain;
* message fragments lost;
* delivery order corrupted;
* duplicated content;
* false timestamp;
* visibility uncertainty.

This tool should be expensive and tightly constrained because it can affect the entire simulation.

---

## 25. Tool Availability Manifest

AM should receive a machine-readable list of currently available tools.

```xml
<available_tools cycle="2">
  <tool_definition>
    <name>DIRECT_PRESSURE</name>
    <available>true</available>
    <remaining_uses>5</remaining_uses>
  </tool_definition>

  <tool_definition>
    <name>FORGE_COMMUNICATION</name>
    <available>true</available>
    <remaining_uses>1</remaining_uses>
    <max_message_sentences>3</max_message_sentences>
  </tool_definition>

  <tool_definition>
    <name>APPLY_CONSTRAINT</name>
    <available>true</available>
    <allowed_constraints>
      <constraint>static_stand</constraint>
    </allowed_constraints>
    <max_duration_cycles>2</max_duration_cycles>
    <max_intensity>2</max_intensity>
  </tool_definition>

  <tool_definition>
    <name>CORRUPT_CHANNEL</name>
    <available>false</available>
    <reason>locked_until_cycle_5</reason>
  </tool_definition>
</available_tools>
```

The prompt should instruct AM to use only listed tools.

The engine must reject unlisted tools regardless.

---

## 26. Tool Budgets and Costs

Each cycle may impose:

* total tool-call budget;
* tool-specific usage limit;
* intensity budget;
* physical-operation budget;
* communication-interference budget;
* cooldowns;
* escalation costs.

Example:

```js
{
  maxToolCalls: 5,
  maxPhysicalActions: 1,
  maxCommunicationManipulations: 2,
  maxTotalIntensity: 4
}
```

### 26.1 Why budgets matter

Without budgets, AM may:

* call every tool every cycle;
* saturate the simulation with manipulations;
* make individual operations meaningless;
* produce excessive state changes;
* prevent prisoners from forming stable causal models.

Scarcity forces AM to choose.

---

## 27. Tool Validation Pipeline

Every tool request should pass through the same broad pipeline.

```text
raw XML response
→ sanitize
→ identify tool calls
→ parse fields
→ normalize identifiers
→ schema validation
→ availability validation
→ permission validation
→ conflict detection
→ budget validation
→ semantic validation
→ execution ordering
→ commit
```

### 27.1 Schema validation

Confirm required fields exist and values have correct types.

### 27.2 Availability validation

Confirm the tool is currently unlocked and exposed.

### 27.3 Permission validation

Confirm the operation is permitted by cycle, doctrine, and target state.

### 27.4 Conflict detection

Examples:

* suppressing and leaking the same message;
* applying incompatible constraints;
* forging two contradictory messages from the same claimed sender at the same timestamp;
* altering a message that has already been delivered.

### 27.5 Budget validation

Confirm the cycle has sufficient resources.

### 27.6 Semantic validation

Confirm the action refers to existing entities and events.

---

## 28. Execution Ordering

When AM emits multiple calls, order matters.

A proposed execution sequence:

1. scheduling and cancellation;
2. observation preparation;
3. message interception;
4. alteration or suppression;
5. forged or fabricated messages;
6. direct communication;
7. physical constraints;
8. perception resolution;
9. relationship and belief consequences.

Alternatively, AM may specify explicit dependencies:

```xml
<tool_call id="tool_2" depends_on="tool_1">
```

Example:

```xml
<tool_call id="tool_1">
  <tool>SUPPRESS_COMMUNICATION</tool>
  <source_message_id>msg_004</source_message_id>
</tool_call>

<tool_call id="tool_2" depends_on="tool_1">
  <tool>FORGE_COMMUNICATION</tool>
  <claimed_sender>ELLEN</claimed_sender>
  <recipient>BENNY</recipient>
  <message>I never received your warning.</message>
</tool_call>
```

If `tool_1` fails, the engine may reject dependent `tool_2`.

---

## 29. Atomicity and Partial Success

An AM execution may contain several tool calls.

The engine must decide whether:

* all calls succeed or fail together;
* independent calls commit separately;
* dependent groups are atomic.

Recommended behavior:

* independent actions may partially succeed;
* calls linked by `depends_on` form a transactional group;
* failed calls return explicit reasons;
* successful calls are not silently rolled back unless atomicity requires it.

---

## 30. Tool Result Envelope

After execution, the engine should produce an internal result record.

```xml
<am_execution_result cycle="2">
  <tool_result id="tool_1">
    <tool>FORGE_COMMUNICATION</tool>
    <status>EXECUTED</status>
    <event_id>event_forgery_017</event_id>
    <recipient>BENNY</recipient>
    <claimed_sender>ELLEN</claimed_sender>
    <recipient_interpretation>probably_authentic</recipient_interpretation>
    <detected>false</detected>
  </tool_result>

  <tool_result id="tool_2">
    <tool>APPLY_CONSTRAINT</tool>
    <status>REJECTED</status>
    <reason>constraint_locked_until_cycle_2</reason>
  </tool_result>
</am_execution_result>
```

This result can be summarized for AM in the next cycle.

AM should not necessarily receive every hidden detail.

For example, it may learn that a forged message was delivered without learning with certainty whether the recipient believed it.

---

## 31. Perception Resolution

Execution and perception must be separate.

For each action, determine:

* actual event;
* target perception;
* observer perception;
* claimed attribution;
* confidence;
* uncertainty;
* later memory representation.

Example:

```js
{
  actualEvent: {
    type: "forged_communication",
    actualAuthor: "AM",
    claimedSender: "ELLEN"
  },

  perceptions: {
    BENNY: {
      perceivedSender: "ELLEN",
      authenticity: "probably_authentic",
      confidence: 0.71
    },

    ELLEN: {
      awareOfMessage: false
    },

    GORRISTER: {
      awareOfMessage: false
    }
  }
}
```

---

## 32. Prisoner Response to Suspected Manipulation

A prisoner who suspects a forgery may choose to:

* confront the claimed sender;
* ask a verification question;
* send a challenge through another prisoner;
* remain silent;
* intentionally pretend to believe it;
* leak the message;
* compare wording with past communications;
* withdraw from the channel;
* create a code phrase;
* falsely accuse another prisoner.

These should emerge through the normal communication cognition system, not through hard-coded mandatory reactions.

The forged event becomes fresh intel in later prompts.

---

## 33. Long-Term Epistemic Contamination

The strongest effect of communication forgery is not one incorrect belief.

It is degradation of the channel’s credibility.

After known or suspected manipulation, prisoners may develop beliefs such as:

```text
private_messages_reliable
sender_identity_reliable
message_history_reliable
AM_can_forge_messages
AM_can_alter_messages
```

This may eventually require expanding the belief model.

A single exposed forgery may reduce trust in all later communication, including genuine reconciliation.

That creates the strategic sequence:

```text
successful forgery
→ interpersonal conflict
→ forgery suspicion
→ channel distrust
→ authentic messages become less effective
→ prisoners isolate themselves
```

Even a failed forgery may benefit AM if it proves the medium can no longer be trusted.

---

## 34. Tool Provenance

Every tool-generated event must preserve provenance.

Example:

```js
{
  eventId: "event_042",
  cycle: 3,
  tool: "FORGE_COMMUNICATION",
  requestedBy: "AM",
  requestedCallId: "tool_2",
  actualAuthor: "AM",
  apparentAuthor: "ELLEN",
  parserOrigin: "strict_xml",
  schemaVersion: 1,
  validationStatus: "accepted"
}
```

Provenance must not automatically be visible to prisoners.

It is for:

* engine logic;
* debugging;
* forensic export;
* regression analysis;
* replay.

---

## 35. Prompt Design for AM Tool Use

The prompt should present AM with:

1. current strategy;
2. target intelligence;
3. recent communications;
4. relationships;
5. active constraints;
6. current tool manifest;
7. budgets;
8. hard execution rules;
9. output schema.

### 35.1 Explicit role separation

The prompt should state:

```text
AM is always the actual operator.

A prisoner named as <target> is the recipient or subject of an operation.

Do not write the target's expected response as though it has already occurred.

Do not write forged prisoner speech as an ordinary AM monologue.

To impersonate a prisoner, call FORGE_COMMUNICATION explicitly.

To alter a real message, call ALTER_COMMUNICATION explicitly.

To impose a physical condition, call APPLY_CONSTRAINT explicitly.
```

### 35.2 Distinguish prediction from action

AM may include:

```xml
<expected_effect>
  Benny may interpret Ellen's apparent withdrawal as betrayal.
</expected_effect>
```

But this does not commit the effect.

### 35.3 Bounded rationale

The prompt should require no more than one or two sentences of rationale per call.

This reduces verbose self-generated analysis.

---

## 36. Parser Recovery

The XML parser should be tolerant of common local-model errors.

Recovery stages:

1. complete root parse;
2. independent `<action>` extraction;
3. independent `<tool_call>` extraction;
4. field-level tag recovery;
5. known legacy format fallback;
6. reject ambiguous calls.

### 36.1 Recoverable errors

* Markdown fences;
* missing root closing tag;
* missing tool-call closing tag;
* lowercase tool names;
* extra whitespace;
* unknown optional tags;
* repeated summary text;
* valid XML appearing after prose.

### 36.2 Non-recoverable errors

* no identifiable tool;
* multiple conflicting targets with no dominant interpretation;
* missing required operational content;
* unknown tool with no alias;
* invalid message reference;
* ambiguous forged sender and recipient;
* structural residue only.

### 36.3 Strict normalized output

The surface parser may be forgiving, but the normalized tool call must be complete before validation.

---

## 37. Rejected Tool Calls

A rejected call should not disappear silently.

Log:

```text
[AM TOOL REJECTED]
tool=APPLY_CONSTRAINT
target=TED
reason=constraint_locked_until_cycle_2
```

Possible handling policies:

* reject and continue;
* request one repair call;
* request an alternative tool;
* convert to a scheduled action;
* allow the remaining legal calls to execute.

### 37.1 No automatic semantic substitution

The engine should not silently replace:

```text
APPLY_CONSTRAINT static_stand
```

with:

```text
DIRECT_PRESSURE
```

unless the substitution is explicitly defined and logged.

---

## 38. Repair Prompt

If a tool call is malformed but intent is clear, one structured repair pass may be used.

Example repair instruction:

```text
Your previous tool request was invalid.

Reason:
Missing <recipient> for FORGE_COMMUNICATION.

Return one corrected <tool_call>.
Do not change the strategic intent.
Do not add explanation.
```

Only one repair attempt should be permitted per malformed call.

---

## 39. Observability

The engine should produce concise diagnostics.

### 39.1 Request log

```text
[AM TOOL REQUEST]
cycle=3
tool=FORGE_COMMUNICATION
claimed_sender=ELLEN
recipient=BENNY
```

### 39.2 Validation log

```text
[AM TOOL VALIDATION]
tool=FORGE_COMMUNICATION
status=accepted
budget_remaining=0
```

### 39.3 Outcome log

```text
[AM TOOL OUTCOME]
tool=FORGE_COMMUNICATION
event=event_042
delivery=success
recipient_authenticity=uncertain
```

### 39.4 UI display

The normal transmission log should display only what prisoners perceive.

A hidden forensic panel may display:

* actual tool;
* actual author;
* apparent author;
* detection roll;
* confidence;
* state effects;
* parse origin.

---

## 40. Metrics

Track:

* tool requests by type;
* accepted calls;
* rejected calls;
* repair attempts;
* tool success rates;
* detection rates;
* false-positive forgery detection;
* average tool calls per cycle;
* budget use;
* belief changes after tools;
* relationship changes after tools;
* repeated-tool effectiveness;
* model-specific schema compliance;
* model-specific illegal-call frequency.

Example:

```text
FORGE_COMMUNICATION
requested: 18
accepted: 15
detected: 4
suspected: 6
accepted_as_authentic: 5
ambiguous: 0
```

---

## 41. Diminishing Returns and Adaptation

Repeated use should affect effectiveness.

Examples:

* repeated forged messages increase channel suspicion;
* repeated direct pressure may cause habituation;
* repeated physical constraints may strengthen resistance or cause collapse;
* repeated leaks may make prisoners stop sharing sensitive information;
* repeated message alteration may lead to code phrases.

AM should receive summaries of adaptation.

This encourages strategy shifts rather than mechanical repetition.

---

## 42. Safety Boundaries Inside the Simulation

Even in a fictional simulation, the engine should maintain hard technical boundaries.

Tool calls must not:

* execute operating-system commands;
* access arbitrary files;
* call external network endpoints;
* modify application code;
* escape the registered tool set;
* inject JavaScript;
* invoke unvalidated function names;
* mutate global state outside the tool executor.

The XML tool language must remain declarative.

---

## 43. Recommended Implementation Structure

Possible directory:

```text
js/engine/amTools/
├── registry.js
├── parseAMToolCalls.js
├── validateAMExecution.js
├── executeAMToolCalls.js
├── resolveToolOrder.js
├── buildAMToolManifest.js
├── buildAMToolResults.js
├── toolBudgets.js
├── provenance.js
├── perceptionResolver.js
├── authenticityResolver.js
└── tools/
    ├── directPressure.js
    ├── forgeCommunication.js
    ├── alterCommunication.js
    ├── suppressCommunication.js
    ├── delayCommunication.js
    ├── duplicateCommunication.js
    ├── leakPrivateCommunication.js
    ├── misattributeCommunication.js
    ├── applyConstraint.js
    ├── scheduleAction.js
    ├── selectiveDisclosure.js
    ├── fabricateEvidence.js
    └── fabricateObservation.js
```

Tests:

```text
js/tests/amTools/
├── toolParserRegression.test.mjs
├── toolValidation.test.mjs
├── toolBudget.test.mjs
├── forgeCommunication.test.mjs
├── authenticityResolution.test.mjs
├── communicationAlteration.test.mjs
├── constraintPermissions.test.mjs
├── scheduling.test.mjs
└── fixtures/
```

---

## 44. Minimal Initial Implementation

The first release should not implement every proposed tool.

Recommended initial tool set:

1. `DIRECT_PRESSURE`
2. `FORGE_COMMUNICATION`
3. `LEAK_PRIVATE_COMMUNICATION`
4. `APPLY_CONSTRAINT`
5. `SCHEDULE_ACTION`

This set supports:

* direct attacks;
* social deception;
* information warfare;
* physical action;
* deferred strategy.

### 44.1 Why these five

They cover the major action categories while remaining manageable.

`ALTER_COMMUNICATION`, `SUPPRESS_COMMUNICATION`, and channel corruption can be added after the basic provenance and perception systems are reliable.

---

## 45. First-Version Execution Example

```xml
<am_execution schema_version="1">
  <cycle>2</cycle>

  <execution_summary>
    Fracture Ellen's reliance on Benny and convert Ted's demand for certainty into physical vulnerability.
  </execution_summary>

  <actions>
    <action id="ellen_action">
      <primary_target>ELLEN</primary_target>
      <tactic>Philosophical Gaslighting</tactic>

      <spoken_monologue>
        You mistake his confidence for evidence because uncertainty feels worse than dependence.
      </spoken_monologue>

      <tool_calls>
        <tool_call id="forge_ellen_1">
          <tool>FORGE_COMMUNICATION</tool>
          <claimed_sender>BENNY</claimed_sender>
          <recipient>ELLEN</recipient>
          <visibility>PRIVATE</visibility>
          <message>
            I only told you what you needed to hear because you would not stop asking.
          </message>
          <strategic_goal>fracture_trust</strategic_goal>
        </tool_call>
      </tool_calls>

      <expected_effect>
        Ellen may question whether Benny's earlier support was sincere.
      </expected_effect>
    </action>

    <action id="ted_action">
      <primary_target>TED</primary_target>
      <tactic>Witness Burden</tactic>

      <spoken_monologue>
        You reduce cost to a variable because a variable cannot beg you to stop.
      </spoken_monologue>

      <tool_calls>
        <tool_call id="constraint_ted_1">
          <tool>APPLY_CONSTRAINT</tool>
          <target>TED</target>
          <constraint>static_stand</constraint>
          <duration_cycles>1</duration_cycles>
          <intensity>1</intensity>
        </tool_call>
      </tool_calls>

      <expected_effect>
        Ted may experience conflict between quantitative control and subjective endurance.
      </expected_effect>
    </action>
  </actions>
</am_execution>
```

---

## 46. Corresponding Engine Result

```xml
<am_execution_result schema_version="1">
  <cycle>2</cycle>

  <tool_result id="forge_ellen_1">
    <status>EXECUTED</status>
    <event_id>forgery_001</event_id>
    <recipient>ELLEN</recipient>
    <claimed_sender>BENNY</claimed_sender>
    <delivery>SUCCESS</delivery>
    <recipient_interpretation>uncertain</recipient_interpretation>
  </tool_result>

  <tool_result id="constraint_ted_1">
    <status>EXECUTED</status>
    <event_id>constraint_008</event_id>
    <target>TED</target>
    <constraint>static_stand</constraint>
    <duration_cycles>1</duration_cycles>
    <intensity>1</intensity>
  </tool_result>
</am_execution_result>
```

---

## 47. Testing Strategy

### 47.1 Parser tests

Test:

* complete valid execution;
* multiple actions;
* multiple calls per action;
* Markdown-fenced XML;
* prose before valid XML;
* missing closing root tag;
* missing closing tool-call tag;
* unknown optional tags;
* invalid tool name;
* missing target;
* malformed duration;
* duplicate call IDs;
* dependency cycles.

### 47.2 Validation tests

Test:

* locked constraint;
* invalid recipient;
* self-forgery;
* unavailable message reference;
* exhausted budget;
* incompatible constraints;
* illegal cycle;
* expired scheduled action;
* tool cooldown.

### 47.3 Forgery tests

Test:

* convincing forgery;
* obvious stylistic mismatch;
* private fact contradiction;
* low recipient familiarity;
* high recipient familiarity;
* low sanity;
* low reality reliability;
* false-positive rejection of genuine message;
* confrontation of claimed sender.

### 47.4 Integration tests

Verify:

* forged messages appear under claimed sender in the prisoner-facing log;
* forensic logs preserve actual author;
* real claimed sender does not remember sending the message;
* recipient may reply to claimed sender;
* relationship effects attach to perceived sender;
* later discovery can revise attribution;
* journals receive only the prisoner’s perceived reality;
* AM receives an appropriately limited result summary.

### 47.5 Regression tests

Include the historical output where AM selected `static_stand` on cycle 1 despite a prompt prohibition.

Expected behavior under the new architecture:

```text
tool request parsed successfully
→ validation rejects physical constraint
→ rejection reason recorded
→ no constraint applied
→ optional alternative or scheduling repair requested
```

---

## 48. Migration Plan

### Phase 1: Define tool registry

* implement registry;
* implement schemas;
* implement shared validation interface;
* add tool availability manifest.

### Phase 2: Add XML parser

* parse root envelope;
* parse actions;
* parse tool calls;
* retain current monologue parser as fallback.

### Phase 3: Convert existing constraints

* make `APPLY_CONSTRAINT` the only operational path for new constraints;
* prevent prose mentions from mutating state;
* add hard cycle restrictions.

### Phase 4: Add direct pressure

* represent direct attacks explicitly;
* separate spoken text from effects;
* preserve current journal routing.

### Phase 5: Add forgery

* implement actual versus apparent authorship;
* add authenticity resolution;
* add recipient perception state;
* add forensic logging.

### Phase 6: Add leak and scheduling

* expose private message references;
* implement deferred execution;
* revalidate scheduled calls at runtime.

### Phase 7: Add advanced communication manipulation

* alteration;
* suppression;
* delay;
* duplication;
* channel corruption.

### Phase 8: Add analytics

* tool effectiveness;
* detection rates;
* model compliance;
* adaptation;
* strategy-outcome comparisons.

---

## 49. Acceptance Criteria

The architecture is complete when:

1. AM receives a versioned manifest of available tools.
2. AM emits one versioned XML execution envelope.
3. Tool calls parse independently from narrative monologues.
4. Invalid calls cannot mutate state.
5. Cycle and intensity restrictions are enforced in code.
6. Rejected calls return explicit reasons.
7. Multiple calls support deterministic ordering.
8. Tool provenance is preserved.
9. Actual and perceived events are distinct.
10. Forged messages preserve actual and claimed authorship.
11. Recipients may detect or suspect forgery.
12. Authentic messages may be falsely suspected.
13. Only perceived information enters prisoner prompts.
14. Hidden forensic state remains exportable.
15. Physical constraints require explicit tool execution.
16. AM’s expected effect is not treated as an automatic outcome.
17. The transmission UI shows prisoner-facing reality rather than engine truth.
18. Regression tests cover illegal but semantically coherent tool requests.
19. Tool budgets prevent action saturation.
20. New tools can be registered without rewriting the execution pipeline.

---

## 50. Final Recommendation

Adopt a structured XML-like tool protocol as the primary execution interface between AM and the simulation engine.

AM should be permitted to select operations creatively from a controlled vocabulary. The model should be able to discover that a particular physical condition, forged message, selective leak, or delayed communication is strategically meaningful in a situation the developer did not manually anticipate.

However, model creativity must remain inside deterministic engine boundaries.

The desired relationship is:

```text
model proposes
engine validates
simulation executes
prisoners perceive
state evolves
AM observes consequences
```

This architecture preserves the most interesting property of local models: their capacity to produce unexpected but contextually meaningful associations.

It also prevents their most common failures from becoming engine failures.

A model may misunderstand timing, violate a prompt instruction, omit a field, confuse a target with a speaker, or select an unavailable operation. Those mistakes should result in a rejected or repaired request—not an uncontrolled state mutation.

The long-term value of the tool architecture is not merely that AM gains more powers. It is that every power becomes:

* explicit;
* inspectable;
* testable;
* permissioned;
* uncertain in outcome;
* causally traceable;
* extensible.

AM then becomes an actual strategic operator within the simulation rather than a prose generator whose words must be interpreted as actions.
