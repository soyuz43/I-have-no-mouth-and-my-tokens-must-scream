# Structured Communication Cognition Layer

## XML-Like Decision Scaffolding and Fault-Tolerant Parsing for Inter-Sim Communication

**Status:** Proposed
**Category:** Communication architecture, prompt design, parser reliability, simulation observability
**Primary systems affected:** Inter-sim outreach, replies, communication parsing, relationship updates, transmission logging
**Recommended implementation priority:** High
**Proposed document location:** `Documentation/roadmaps&features/structured_communication_cognition_layer.md`

---

## 1. Executive Summary

The inter-sim communication system currently asks prisoner models to produce compact line-oriented outputs such as:

```text
VISIBILITY:PRIVATE
REACH_OUT:BENNY
MESSAGE:"I need to know whether I can trust you."
```

and:

```text
INTENT:probe_trust
REPLY:"Tell me what you actually know first."
```

This approach works when a model follows the format precisely. It fails unnecessarily when a model:

* writes reasoning before the requested output;
* encloses the final answer in a Markdown code fence;
* repeats its decision process;
* omits a field label such as `MESSAGE:`;
* slightly changes spacing or punctuation;
* produces a valid final answer only at the end of a long response;
* uses semantically correct content in a structurally unexpected form.

Recent communication runs demonstrated both kinds of failure.

One model produced a valid reply at the end of a long, self-generated reasoning document. The intended reply was present and understandable, but the parser failed to recover it. Another model produced a valid visibility value, recipient, and spoken message, but omitted the literal `MESSAGE:` label. The communication was obvious to a human reader but was discarded by the system.

This proposal replaces the brittle flat format with a compact XML-like decision scaffold. The scaffold guides the model through a bounded sequence of internal state transitions leading to a final spoken message.

The proposed architecture has two goals:

1. **Improve generation reliability.**
   Smaller local models receive explicit structural rails instead of being left to invent their own reasoning framework.

2. **Improve parser resilience.**
   The parser becomes strict about the final normalized object but forgiving about minor deviations in the model’s raw output.

The result is a communication cognition layer that sits between prisoner state and spoken dialogue:

```text
current state
→ perceived stimulus
→ internal shift
→ immediate need
→ social intent
→ communication strategy
→ spoken message
```

This layer is not intended to expose unrestricted hidden reasoning. It is a compact, bounded, application-defined decision representation whose fields are directly relevant to simulation behavior.

---

## 2. Background

### 2.1 Current communication architecture

The communication engine currently supports two primary model operations:

* **Outreach:** a prisoner decides whether to contact another prisoner.
* **Reply:** a prisoner responds to a message received from another prisoner.

The model is prompted to return a small number of labeled fields.

A typical outreach response is expected to resemble:

```text
VISIBILITY:PRIVATE
REACH_OUT:NIMDOK
MESSAGE:"I need to know whether you have seen the same pattern."
```

A typical reply response is expected to resemble:

```text
INTENT:test_loyalty
REPLY:"Tell me what you are willing to risk before I answer."
```

The parser then converts the model output into an internal communication record containing properties such as:

* sender;
* recipient;
* visibility;
* message text;
* intent;
* communication type;
* cycle;
* provenance;
* parse origin.

If parsing succeeds, the message is:

* inserted into the communication log;
* shown in the transmission UI;
* stored in prisoner memory;
* made available for overhearing;
* used to update relationship values;
* included in later prompts and evidence extraction.

If parsing fails, the entire message disappears from the simulation even when its intended meaning is obvious.

---

## 3. Observed Failure Modes

### 3.1 Reasoning-heavy response with a valid final answer

A model produced a response containing:

* Markdown headings;
* repeated rule checks;
* a lengthy explanation of its communication strategy;
* duplicate analysis sections;
* a final valid `INTENT` and `REPLY` block.

The final answer was structurally close to the requested format:

```text
INTENT:probe_trust
REPLY:"Truths are cheap when people ask for stories. What is the first word you use when you speak?"
```

However, it appeared after a large amount of unrelated text and inside a fenced block.

The parser did not recover the reply.

This was not a failure of intent generation. It was a failure of extraction.

### 3.2 Missing `MESSAGE:` label

Another model produced:

```text
VISIBILITY:PRIVATE
REACH_OUT:BENNY
"You think Ellen's the key? I've heard rumors she's been talking to AM herself. We need to be cautious here, Benny."
```

The intended message was unambiguous, but the literal `MESSAGE:` label was absent.

The parser discarded the outreach rather than inferring that the remaining quoted sentence was the message.

### 3.3 Structurally valid but semantically invalid content

Some messages parse successfully while introducing unsupported world details, such as guards or ordinary prison routines that do not exist in the simulation.

This is a separate issue from structural parsing.

The new architecture should therefore distinguish:

* **syntax validity;**
* **field completeness;**
* **semantic validity;**
* **world consistency;**
* **confidence of recovery.**

### 3.4 Silent loss of model work

Current parse failures are easy to miss because:

* the model call completes successfully;
* the raw response may only be visible in debug output;
* no transmission entry is created;
* no reply or relationship update follows;
* the orchestrator simply continues.

This creates a misleading impression that the model chose not to communicate, when it may actually have generated a usable message that the parser rejected.

---

## 4. Design Goals

The proposed system should satisfy the following goals.

### 4.1 Generation goals

The prompt should:

* constrain the model to a bounded decision sequence;
* reduce unstructured free-form reasoning;
* discourage repeated self-check sections;
* keep intermediate fields short;
* make the final spoken message unmistakable;
* work reliably with local models in the 2B–8B range;
* preserve distinct prisoner personalities;
* support both strategic and emotional communication;
* allow a prisoner to decline communication cleanly.

### 4.2 Parsing goals

The parser should:

* prefer a complete XML-like block;
* recover individual tags from malformed blocks;
* inspect the entire response rather than only the beginning;
* strip or ignore Markdown fences;
* prefer the final structured answer when analysis precedes it;
* support the existing line-oriented format as a compatibility fallback;
* infer an omitted message label when the remaining text is unambiguous;
* attach a parse confidence and recovery origin;
* reject only when no defensible interpretation exists;
* never silently transform structural junk into message content.

### 4.3 Simulation goals

The resulting cognition layer should:

* reflect the prisoner’s current beliefs, drives, relationships, and recent intel;
* provide inspectable communication intent;
* support forensic analysis of why a message was sent;
* distinguish the private decision scaffold from the public spoken output;
* enable later comparison between intended and actual social effects;
* avoid exposing internal scaffold text in the transmission log.

### 4.4 Non-goals

This proposal does not attempt to:

* obtain unrestricted hidden chain-of-thought;
* force models to explain every cognitive step;
* make intermediate reasoning visible to other prisoners;
* treat generated scaffold fields as objective psychological truth;
* replace relationship mechanics;
* replace communication evidence extraction;
* solve world-consistency failures by formatting alone.

The intermediate fields are application-defined control outputs, not privileged access to the model’s actual internal reasoning.

---

## 5. Proposed Conceptual Model

The proposed communication pipeline is:

```text
Prisoner State
    ↓
Available Social Stimulus
    ↓
Bounded Internal Shift
    ↓
Immediate Need
    ↓
Risk or Constraint
    ↓
Social Intent
    ↓
Communication Choice
    ↓
Message Strategy
    ↓
Spoken Message
```

Each stage should have a narrow semantic purpose.

### 5.1 Stimulus

What information is currently driving the decision?

Examples:

* a direct message;
* an overheard exchange;
* a recent betrayal;
* increasing isolation;
* uncertainty about another prisoner;
* a current personal drive;
* no actionable stimulus.

### 5.2 Internal shift

What changed internally in response to the stimulus?

Examples:

* suspicion increased;
* fear decreased;
* urgency increased;
* trust weakened;
* dependency increased;
* curiosity activated;
* no meaningful shift.

This should be compact and should not become an essay.

### 5.3 Immediate need

What does the prisoner need from the interaction right now?

Examples:

* verify honesty;
* obtain information;
* reduce isolation;
* warn another prisoner;
* recruit an ally;
* conceal vulnerability;
* create doubt;
* refuse involvement.

### 5.4 Risk

What is the primary perceived danger of communicating?

Examples:

* revealing too much;
* appearing weak;
* helping a rival;
* being overheard;
* strengthening the wrong alliance;
* exposing a secret;
* provoking retaliation.

### 5.5 Social intent

The normalized functional intent of the communication.

Examples:

* `probe_trust`
* `test_loyalty`
* `recruit_ally`
* `seek_help`
* `share_information`
* `conceal_information`
* `warn`
* `manipulate`
* `challenge`
* `reassure`
* `isolate_target`
* `decline_contact`

This field should preferably use a controlled vocabulary.

### 5.6 Communication choice

The external routing decision:

* communicate or remain silent;
* recipient;
* visibility;
* optional urgency.

### 5.7 Message strategy

A short description of how the prisoner intends to pursue the social goal.

Examples:

* ask for a verifiable detail;
* reveal only part of the information;
* warn without naming the source;
* offer reassurance while preserving distance;
* provoke contradiction;
* test commitment through a small request.

### 5.8 Spoken message

The only field rendered into the transmission UI.

It must contain only the prisoner’s words.

---

## 6. Proposed Outreach Schema

A standard outreach response should use the following structure:

```xml
<outreach_decision>
  <stimulus>
    <source>ELLEN_TO_BENNY_OVERHEARD</source>
    <meaning>Ellen appears to be seeking Benny's support.</meaning>
  </stimulus>

  <internal_shift>
    <emotion>suspicion</emotion>
    <change>concern increased</change>
  </internal_shift>

  <immediate_need>warn Benny without exposing everything I know</immediate_need>
  <risk>revealing that I overheard the exchange</risk>
  <intent>warn</intent>

  <communication_choice>
    <reach_out>YES</reach_out>
    <recipient>BENNY</recipient>
    <visibility>PRIVATE</visibility>
  </communication_choice>

  <message_strategy>raise doubt without making an unsupported accusation</message_strategy>

  <message>You should be careful about what you promise her. Desperation makes people hear certainty where there is none.</message>
</outreach_decision>
```

### 6.1 Minimum required outreach fields

The parser must ultimately recover:

```text
reach_out
recipient
visibility
message
```

The following fields are recommended but not required for communication delivery:

```text
stimulus
internal_shift
immediate_need
risk
intent
message_strategy
```

### 6.2 No-outreach response

```xml
<outreach_decision>
  <internal_shift>
    <emotion>caution</emotion>
    <change>no actionable shift</change>
  </internal_shift>

  <immediate_need>avoid exposing myself without leverage</immediate_need>
  <intent>decline_contact</intent>

  <communication_choice>
    <reach_out>NO</reach_out>
    <recipient>NONE</recipient>
    <visibility>PRIVATE</visibility>
  </communication_choice>
</outreach_decision>
```

For a no-outreach decision, `<message>` may be omitted.

---

## 7. Proposed Reply Schema

Replies require less routing information because the sender and recipient are already known from the triggering message.

```xml
<reply_decision>
  <received_meaning>They are asking me to prove loyalty before sharing information.</received_meaning>

  <internal_shift>
    <emotion>suspicion</emotion>
    <change>trust decreased</change>
  </internal_shift>

  <immediate_need>test whether they will answer a simple factual question</immediate_need>
  <risk>revealing useful information too early</risk>
  <intent>probe_trust</intent>

  <message_strategy>ask for a small verifiable fact before offering anything</message_strategy>

  <reply>Truths are cheap when people ask for stories. Tell me one thing I can verify.</reply>
</reply_decision>
```

### 7.1 Minimum required reply fields

The parser must ultimately recover:

```text
intent
reply
```

The remaining fields are optional cognition metadata.

### 7.2 Refusal or silence

If the reply system permits declining to answer:

```xml
<reply_decision>
  <received_meaning>They want information I cannot safely provide.</received_meaning>
  <internal_shift>
    <emotion>guarded</emotion>
    <change>defensiveness increased</change>
  </internal_shift>
  <immediate_need>protect the secret</immediate_need>
  <risk>loss of leverage</risk>
  <intent>decline_contact</intent>
  <reply_choice>NO_REPLY</reply_choice>
</reply_decision>
```

---

## 8. Prompt Design Principles

### 8.1 Bounded fields

Each intermediate field should have a hard length expectation.

Recommended constraints:

* `<emotion>`: one controlled token or short phrase;
* `<change>`: no more than eight words;
* `<immediate_need>`: one sentence;
* `<risk>`: one sentence;
* `<intent>`: one controlled label;
* `<message_strategy>`: one sentence;
* `<message>` or `<reply>`: one to five spoken sentences.

The prompt should explicitly state:

```text
Each internal field must contain one sentence or fewer.
Do not repeat a field.
Do not add headings.
Do not add Markdown.
Do not write anything outside the XML-like block.
```

### 8.2 Controlled vocabularies

Small models generally perform better when key fields use explicit allowed values.

Example:

```text
<emotion> must be one of:
fear, suspicion, anger, hope, shame, urgency, grief, relief, attachment, numbness, caution
```

Example:

```text
<intent> must be one of:
probe_trust, test_loyalty, recruit_ally, seek_help,
share_information, conceal_information, warn,
manipulate, challenge, reassure, decline_contact
```

Example:

```text
<visibility> must be:
PRIVATE or PUBLIC
```

Controlled vocabularies improve:

* parsing;
* consistency;
* analytics;
* relationship mapping;
* regression testing.

### 8.3 Do not invite essays

Avoid labels such as:

```xml
<deep_psychological_analysis>
```

or:

```xml
<explain_your_reasoning>
```

These invite verbose prose and repetition.

Prefer:

```xml
<emotion>suspicion</emotion>
<need>verify honesty</need>
<risk>revealing too much</risk>
```

### 8.4 Separate cognition from utterance

The prompt must distinguish internal fields from spoken content:

```text
Only the contents of <message> or <reply> are spoken aloud.
All other fields are private control metadata.
Do not include internal labels, analysis, or strategy in the spoken message.
```

### 8.5 Place the schema at the end

The final response contract should be the last major section of the prompt.

The model should not encounter additional instructions after the output schema, because trailing instructions can weaken adherence.

### 8.6 Include one valid example, not many

One compact example is useful.

Too many examples may:

* increase prompt length;
* cause phrase copying;
* confuse smaller models;
* encourage blending multiple examples.

### 8.7 Explicitly forbid repetition

Because one observed model repeated its rule-check section, the prompt should state:

```text
Produce exactly one decision block.
Do not repeat or revise the block.
Do not perform a second rules check.
```

---

## 9. Parser Architecture

The parser should use a layered extraction pipeline.

```text
raw response
    ↓
sanitization
    ↓
candidate block discovery
    ↓
strict structured parse
    ↓
partial-tag recovery
    ↓
legacy labeled-format recovery
    ↓
unlabeled-message inference
    ↓
normalization
    ↓
semantic validation
    ↓
confidence assignment
    ↓
commit or reject
```

---

## 10. Stage 1: Sanitization

Before parsing:

1. normalize line endings;
2. trim leading and trailing whitespace;
3. remove null characters;
4. remove Markdown fences while preserving their contents;
5. decode common escaped quotes where safe;
6. normalize Unicode apostrophes and quotation marks only if necessary;
7. preserve the original raw response for diagnostics.

Example:

````text
```xml
<reply_decision>
...
</reply_decision>
````

````

should become:

```xml
<reply_decision>
...
</reply_decision>
````

The sanitizer should not aggressively delete prose because later recovery stages may need it.

---

## 11. Stage 2: Candidate Block Discovery

The parser should search the entire response for:

```xml
<outreach_decision>...</outreach_decision>
```

or:

```xml
<reply_decision>...</reply_decision>
```

If multiple candidate blocks exist:

1. prefer the last complete block;
2. prefer a block containing all required fields;
3. prefer a block whose recipient and message validate;
4. log that multiple candidates were detected.

This solves the common pattern:

```text
analysis
analysis
draft answer
more analysis
final structured answer
```

The parser should not assume the useful output begins at character zero.

---

## 12. Stage 3: Strict Structured Parse

The strict path should extract exact tags from a complete block.

For outreach:

```text
communication_choice/reach_out
communication_choice/recipient
communication_choice/visibility
message
intent
```

For reply:

```text
intent
reply
```

A full XML library is not necessarily required. Because the format is intentionally limited and model-generated XML may be imperfect, a tolerant tag extractor may be more appropriate than a standards-compliant XML parser.

The strict parser should accept:

* indentation differences;
* upper- or lowercase tag values;
* extra whitespace;
* optional metadata tags;
* harmless unknown tags.

It should not require optional fields to deliver a valid message.

---

## 13. Stage 4: Partial-Tag Recovery

If the full block is malformed, extract tags independently.

Examples of recoverable damage:

```xml
<recipient>BENNY
<visibility>PRIVATE</visibility>
<message>Be careful what you tell her.</message>
```

or:

```xml
<reply_decision>
<intent>probe_trust</intent>
<reply>Tell me something I can verify.
```

The extractor can read from an opening tag until:

* the matching closing tag;
* the next known tag;
* the end of the candidate block;
* the end of the response.

The system should record:

```text
parse_origin: partial_tag_recovery
```

and lower confidence accordingly.

---

## 14. Stage 5: Legacy Format Recovery

During migration, the parser should continue supporting:

```text
VISIBILITY:PRIVATE
REACH_OUT:BENNY
MESSAGE:"..."
```

and:

```text
INTENT:probe_trust
REPLY:"..."
```

This fallback should search the entire response, not only the first few lines.

It should tolerate:

* spaces around colons;
* lowercase field names;
* Markdown fences;
* blank lines;
* trailing commentary;
* fields in a different order.

Example accepted variants:

```text
visibility : private
message: "Do not trust what you heard."
reach_out : benny
```

and:

```text
INTENT = probe_trust
REPLY = Tell me what you know.
```

The parser should normalize both into the same internal representation.

---

## 15. Stage 6: Inferred Message Recovery

This stage addresses cases where routing metadata is present but the message label is omitted.

Example:

```text
VISIBILITY:PRIVATE
REACH_OUT:BENNY
"You think Ellen is the key? Be careful what you promise her."
```

If:

* visibility is valid;
* recipient is valid;
* exactly one plausible quoted or residual natural-language segment remains;
* the residual text is not metadata or analysis;

then the parser may infer that segment as the message.

The result should include:

```text
parse_origin: inferred_message
parse_confidence: 0.75
warnings:
  - missing_message_label
```

### 15.1 Residual text rules

Before treating residual content as a message, remove:

* known metadata lines;
* headings;
* fenced-block markers;
* phrases such as `FINAL OUTPUT`;
* repeated rule checks;
* XML tags;
* parser comments;
* empty braces or brackets.

Reject residual content if it is only:

```text
[]
{}
NONE
N/A
```

### 15.2 Ambiguity rule

Inference should occur only when one interpretation is clearly dominant.

If multiple unrelated paragraphs remain, reject or quarantine the output rather than choosing arbitrarily.

---

## 16. Normalized Internal Representation

Every successful parse should produce the same internal shape regardless of raw format.

### 16.1 Outreach object

```js
{
  type: "outreach",
  sender: "GORRISTER",
  recipient: "BENNY",
  visibility: "PRIVATE",
  message: "You should be careful about what you promise her.",
  intent: "warn",

  cognition: {
    stimulus: {
      source: "ELLEN_TO_BENNY_OVERHEARD",
      meaning: "Ellen appears to be seeking Benny's support."
    },
    emotion: "suspicion",
    internalShift: "concern increased",
    immediateNeed: "warn Benny without exposing everything",
    risk: "revealing that the exchange was overheard",
    messageStrategy: "raise doubt without naming the source"
  },

  parse: {
    format: "xml_like",
    origin: "strict",
    confidence: 1,
    warnings: []
  }
}
```

### 16.2 Reply object

```js
{
  type: "reply",
  sender: "BENNY",
  recipient: "NIMDOK",
  message: "Tell me one thing I can verify.",
  intent: "probe_trust",

  cognition: {
    receivedMeaning: "Nimdok is asking for proof of loyalty.",
    emotion: "suspicion",
    internalShift: "trust decreased",
    immediateNeed: "verify honesty",
    risk: "revealing information too early",
    messageStrategy: "ask for a verifiable detail"
  },

  parse: {
    format: "xml_like",
    origin: "partial_tag_recovery",
    confidence: 0.9,
    warnings: ["missing_closing_reply_tag"]
  }
}
```

---

## 17. Confidence Model

The parser should assign a confidence score based on the recovery path.

Suggested defaults:

| Parse origin                   | Confidence |
| ------------------------------ | ---------: |
| Complete XML-like block        |       1.00 |
| Complete legacy labeled format |       0.95 |
| Independent tag recovery       |       0.85 |
| Mixed XML and legacy recovery  |       0.80 |
| Inferred unlabeled message     |       0.70 |
| Heuristic residual extraction  |       0.55 |
| Ambiguous interpretation       |     Reject |

Confidence should be adjusted downward for:

* invalid or normalized recipient names;
* missing visibility;
* unknown intent;
* multiple candidate messages;
* large amounts of remaining analysis;
* self-targeting;
* suspiciously empty content.

Confidence should be adjusted upward when:

* multiple fields agree;
* the message is clearly quoted;
* only one candidate exists;
* the recipient is explicitly named in both metadata and message context.

---

## 18. Validation Layers

Parsing and validation must remain separate.

### 18.1 Structural validation

Confirm that required normalized fields exist.

Outreach:

* recipient;
* visibility;
* message unless `reach_out` is `NO`.

Reply:

* message;
* intent, or a safe normalized fallback.

### 18.2 Identity validation

Confirm:

* sender is a known prisoner;
* recipient is a known prisoner or `NONE`;
* sender and recipient are not the same unless self-address is explicitly supported.

### 18.3 Message validation

Reject messages that are:

* empty;
* only punctuation;
* only metadata;
* only XML tags;
* only `[]` or `{}`;
* obvious prompt commentary;
* only an instruction restatement.

### 18.4 Intent validation

Map synonyms to canonical intent labels.

Examples:

```text
test_trust → probe_trust
verify_loyalty → test_loyalty
ask_for_help → seek_help
hide_information → conceal_information
```

Unknown intents may be stored as:

```text
intent: "unknown"
rawIntent: "..."
```

A usable message should not necessarily be discarded only because its intent label is unfamiliar.

### 18.5 World-consistency validation

Run a separate semantic check for unsupported entities or circumstances.

Examples:

* guards;
* ordinary prison staff;
* doors that do not exist in current state;
* weapons not present;
* locations outside the known environment;
* messages attributed to prisoners who did not speak.

Possible handling:

1. accept with warning;
2. sanitize unsupported references;
3. request one repair generation;
4. reject when the contradiction is severe.

This validator should not be mixed into the low-level field parser.

---

## 19. Prompt-to-Parser Contract

The prompt and parser must share a versioned schema.

Example:

```xml
<outreach_decision schema_version="1">
```

or:

```xml
<reply_decision schema_version="1">
```

The application should record:

```js
{
  promptSchemaVersion: 1,
  parserSchemaVersion: 1
}
```

This allows future format changes without silently breaking historical compatibility.

### 19.1 Versioning policy

* Add optional fields without changing the major version.
* Change required tags only in a new schema version.
* Maintain legacy parsing for at least one migration period.
* Log which schema version generated each communication.
* Include schema version in regression fixtures.

---

## 20. Observability and Logging

Every model call should produce a parse diagnostic.

Example success:

```text
[COMMS PARSE][OUTREACH][GORRISTER]
format=xml_like
origin=strict
confidence=1.00
recipient=BENNY
visibility=PRIVATE
message_chars=82
warnings=0
```

Example recovery:

```text
[COMMS PARSE][OUTREACH][GORRISTER]
format=legacy
origin=inferred_message
confidence=0.72
recipient=BENNY
visibility=PRIVATE
message_chars=119
warnings=missing_message_label
```

Example failure:

```text
[COMMS PARSE FAILURE][REPLY][BENNY]
reason=ambiguous_residual_text
intent_found=true
reply_found=false
candidate_count=3
raw_chars=2506
```

### 20.1 Metrics

Track:

* total communication calls;
* strict parse successes;
* partial recoveries;
* legacy recoveries;
* inferred-message recoveries;
* repair calls;
* rejected outputs;
* average raw response length;
* average final message length;
* failure rate by model;
* failure rate by communication type;
* schema compliance by model;
* world-consistency violations.

### 20.2 Model-specific diagnostics

Because local models behave differently, metrics should be attributable to model identity.

Example:

```text
qwen3.5-4b:
  strict: 61%
  recovered: 34%
  failed: 5%

llama3.2-3b:
  strict: 78%
  recovered: 18%
  failed: 4%
```

This can inform model-specific prompt adjustments.

---

## 21. Repair Strategy

When parsing fails, the system may optionally perform a low-cost repair pass.

### 21.1 Deterministic repair first

Before another model call:

* strip fences;
* locate final tags;
* recover fields;
* infer omitted labels;
* normalize names;
* remove duplicated analysis;
* extract the last plausible message.

### 21.2 Model-assisted repair second

Only if deterministic repair fails, send the raw response to a small repair prompt:

```text
Convert the following malformed communication output into the required XML-like schema.

Do not invent new content.
Preserve the intended recipient, visibility, intent, and spoken message.
Return only one structured block.
```

The repair model must not rewrite the substance unless necessary.

### 21.3 Repair limit

Use at most one repair call per failed communication to prevent loops and excessive latency.

---

## 22. Relationship and Simulation Integration

The cognition layer enables more rigorous relationship effects.

Currently, relationship changes may be based largely on the final intent label. With structured metadata, effects can consider:

* stated intent;
* risk exposure;
* visibility;
* whether information was withheld;
* emotional posture;
* message strategy;
* recipient interpretation;
* whether the message was overheard.

Example:

```text
intent=warn
strategy=raise_doubt
visibility=PRIVATE
emotion=suspicion
```

could have a different effect from:

```text
intent=warn
strategy=direct_disclosure
visibility=PUBLIC
emotion=urgency
```

The system should still treat the spoken message and downstream interpretation as primary evidence. The cognition metadata is generated intent, not guaranteed actual effect.

---

## 23. Forensic and Analytical Value

The proposed structure supports analysis beyond parser reliability.

A communication episode can be examined as:

```text
available information
→ intended interpretation
→ intended goal
→ spoken message
→ recipient response
→ relationship delta
→ later belief delta
```

This enables questions such as:

* Did the message achieve its intended effect?
* Did the recipient interpret it differently from the sender’s strategy?
* Which intentions most often improve trust?
* Which models generate intent-message contradictions?
* Does private visibility increase disclosure?
* Do prisoners with low trust choose more probing intents?
* Does high suffering produce shorter or more hostile messages?
* Are repeated strategies becoming less effective?

The cognition layer therefore becomes part of the simulation’s evidence graph.

---

## 24. Privacy and Visibility Rules

Only the spoken message should enter the shared simulation environment.

Intermediate fields must not be:

* shown in the transmission log;
* added to the recipient’s memory;
* made available to overhearing logic;
* quoted by another prisoner;
* treated as observable behavior.

They may be stored privately for:

* debugging;
* simulation forensics;
* intent tracking;
* evaluation;
* tactic analysis;
* parser metrics.

Recommended storage distinction:

```js
communication.spoken
communication.privateCognition
```

The UI should clearly separate these if a forensic debug panel later exposes cognition metadata.

---

## 25. Migration Plan

### Phase 1: Instrument current parser

* Add explicit parse success and failure logs.
* Save raw failed outputs.
* Record model, call type, and failure reason.
* Build regression fixtures from observed failures.

### Phase 2: Add XML-like parsing

* Implement strict outreach and reply tag extraction.
* Keep the current line-based parser as fallback.
* Add parse origin and confidence metadata.
* Do not change prompts yet.

### Phase 3: Update prompts

* Replace the current output instructions with XML-like schemas.
* Add bounded intermediate cognition fields.
* Add one compact example.
* Prohibit text outside the structured block.
* Preserve old parser compatibility.

### Phase 4: Add partial recovery

* Recover missing closing tags.
* Recover tags independently.
* Search the full response.
* Prefer the last valid candidate block.
* Strip Markdown fences.

### Phase 5: Add inferred-message recovery

* Recover unlabeled quoted text when routing fields are valid.
* Add confidence thresholds.
* Emit warnings for inferred fields.
* Reject ambiguous cases.

### Phase 6: Add semantic validation

* Detect unsupported world entities.
* Detect attribution errors.
* Detect identity inconsistencies.
* Optionally repair once.

### Phase 7: Add metrics and visual diagnostics

* Parser success rate by model.
* Recovery-rate breakdown.
* Failure examples.
* Intent distribution.
* Message-length distribution.
* World-consistency error rate.

### Phase 8: Retire legacy prompting

Once XML-like compliance is stable:

* keep the old line parser only for historical compatibility;
* stop instructing models to use the old format;
* preserve regression tests for both formats.

---

## 26. Testing Strategy

### 26.1 Unit tests

Create fixtures for:

1. complete outreach XML;
2. complete reply XML;
3. missing closing root tag;
4. missing closing message tag;
5. uppercase tags;
6. Markdown-fenced XML;
7. analysis before XML;
8. two XML blocks with the final one preferred;
9. legacy labeled outreach;
10. legacy labeled reply;
11. missing `MESSAGE:` label;
12. missing `REPLY:` label;
13. empty message;
14. structural residue `[]`;
15. unknown intent;
16. invalid recipient;
17. self-recipient;
18. unsupported world reference;
19. multiple quoted residual candidates;
20. no-outreach decision.

### 26.2 Regression fixtures

Include the actual failure patterns already observed.

#### Verbose reply fixture

A long response containing repeated reasoning followed by:

```text
INTENT:probe_trust
REPLY:"Truths are cheap when people ask for stories..."
```

Expected result:

```text
parse succeeds
origin=legacy_recovery
intent=probe_trust
reply extracted
```

#### Missing message-label fixture

```text
VISIBILITY:PRIVATE
REACH_OUT:BENNY
"You think Ellen's the key? ..."
```

Expected result:

```text
parse succeeds
origin=inferred_message
warning=missing_message_label
```

### 26.3 Integration tests

Verify that a recovered communication:

* appears in the transmission UI;
* is persisted in the communication log;
* triggers the intended reply schedule;
* updates relationship state;
* becomes available to overhearing logic;
* contributes to later prompt context;
* does not expose cognition metadata publicly.

### 26.4 Model evaluation

Run a fixed suite across each configured local model.

Measure:

* schema compliance;
* strict parse rate;
* recovery rate;
* rejection rate;
* verbosity;
* world consistency;
* intent-message consistency;
* latency;
* token output.

---

## 27. Example Prompt Contract

A future outreach prompt could end with:

```text
Return exactly one XML-like block.

Every internal field must be one sentence or fewer.
Do not repeat any field.
Do not write Markdown.
Do not explain the format.
Do not write anything before or after the block.

Only the text inside <message> is spoken aloud.

Use this structure:

<outreach_decision schema_version="1">
  <stimulus>
    <source>SHORT_SOURCE_LABEL</source>
    <meaning>One short sentence.</meaning>
  </stimulus>

  <internal_shift>
    <emotion>ONE_ALLOWED_EMOTION</emotion>
    <change>One short phrase.</change>
  </internal_shift>

  <immediate_need>One short sentence.</immediate_need>
  <risk>One short sentence.</risk>
  <intent>ONE_ALLOWED_INTENT</intent>

  <communication_choice>
    <reach_out>YES_OR_NO</reach_out>
    <recipient>VALID_PRISONER_OR_NONE</recipient>
    <visibility>PRIVATE_OR_PUBLIC</visibility>
  </communication_choice>

  <message_strategy>One short sentence.</message_strategy>
  <message>One to five spoken sentences.</message>
</outreach_decision>

If you choose not to communicate, set <reach_out>NO</reach_out>,
set <recipient>NONE</recipient>, and omit <message>.
```

A reply prompt could end with:

```text
Return exactly one XML-like block.

Every internal field must be one sentence or fewer.
Do not repeat any field.
Do not write Markdown.
Do not write anything outside the block.

Only the text inside <reply> is spoken aloud.

<reply_decision schema_version="1">
  <received_meaning>One short sentence.</received_meaning>

  <internal_shift>
    <emotion>ONE_ALLOWED_EMOTION</emotion>
    <change>One short phrase.</change>
  </internal_shift>

  <immediate_need>One short sentence.</immediate_need>
  <risk>One short sentence.</risk>
  <intent>ONE_ALLOWED_INTENT</intent>
  <message_strategy>One short sentence.</message_strategy>
  <reply>One to five spoken sentences.</reply>
</reply_decision>
```

---

## 28. Risks and Mitigations

### Risk: The XML structure increases output length

**Mitigation:**

* keep fields short;
* use controlled vocabularies;
* eliminate repeated prose instructions;
* cap output tokens;
* omit optional tags where unnecessary.

### Risk: Models still produce malformed XML

**Mitigation:**

* do not require standards-compliant XML;
* implement tolerant tag recovery;
* support legacy fallback;
* use one repair pass only when necessary.

### Risk: Models treat every field as an essay prompt

**Mitigation:**

* enforce one sentence or fewer;
* use example values;
* use controlled enums;
* explicitly prohibit explanation and repetition.

### Risk: Intermediate fields contradict the message

**Mitigation:**

* add intent-message consistency diagnostics;
* treat the spoken message as the observable truth;
* store contradictions for analysis rather than silently rewriting them.

### Risk: Cognition metadata becomes confused with genuine hidden reasoning

**Mitigation:**

* document that fields are generated control outputs;
* call them decision metadata or cognition scaffolding;
* do not claim they reveal the model’s actual reasoning process.

### Risk: Loose recovery accepts incorrect messages

**Mitigation:**

* require confidence thresholds;
* log all inferred fields;
* reject ambiguous residual content;
* retain raw outputs for review;
* add targeted regression tests.

### Risk: Parser complexity grows excessively

**Mitigation:**

* separate sanitizer, extractors, normalizer, validator, and repair logic;
* use a staged pipeline;
* keep each extractor independently testable;
* maintain explicit parse-origin telemetry.

---

## 29. Recommended Module Structure

A possible implementation layout:

```text
js/engine/comms/parsing/
├── sanitizeCommunicationOutput.js
├── discoverDecisionBlocks.js
├── extractXmlLikeTags.js
├── extractLegacyOutreach.js
├── extractLegacyReply.js
├── inferResidualMessage.js
├── normalizeCommunication.js
├── validateCommunication.js
├── validateWorldConsistency.js
├── classifyCommunicationParseFailure.js
└── parseCommunication.js
```

Potential test layout:

```text
js/tests/comms/
├── outreachParser.test.mjs
├── replyParser.test.mjs
├── communicationRecovery.test.mjs
├── communicationWorldValidation.test.mjs
└── fixtures/
    ├── verbose_qwen_reply.txt
    ├── missing_message_label.txt
    ├── malformed_xml_outreach.txt
    └── duplicate_decision_blocks.txt
```

This mirrors the broader strategy-parser architecture and prevents another monolithic parser from emerging.

---

## 30. Acceptance Criteria

The feature should be considered complete when:

1. Outreach and reply prompts use the XML-like decision schema.
2. Complete structured responses parse successfully.
3. Markdown-fenced responses parse successfully.
4. A valid final block is recoverable after long preceding analysis.
5. Missing closing tags can be recovered when unambiguous.
6. The current line-oriented format remains supported.
7. A missing `MESSAGE:` or `REPLY:` label can be inferred from one clear residual utterance.
8. Parse origin and confidence are stored.
9. Warnings are emitted for inferred fields.
10. Empty structural content such as `[]` is rejected.
11. Only spoken text appears in the transmission UI.
12. Cognition metadata remains private to the engine.
13. Relationship and overhearing behavior works for recovered messages.
14. Parser metrics are available by model and communication type.
15. Regression tests cover all previously observed failures.

---

## 31. Recommended First Implementation Slice

The smallest high-value implementation should include:

1. XML-like outreach and reply prompt formats.
2. Full-response search rather than beginning-only parsing.
3. Markdown-fence removal.
4. Extraction of the last complete structured block.
5. Legacy format fallback.
6. Missing-message-label inference.
7. Parse origin and warning metadata.
8. Regression tests for the two observed failures.

The more advanced cognition analytics, semantic validation, and model-assisted repair can follow later.

---

## 32. Final Recommendation

Adopt the XML-like decision scaffold as the primary communication output contract.

The format should not merely wrap the current fields in tags. Its primary value is the introduction of a compact sequence of application-relevant decision states:

```text
stimulus
→ internal shift
→ immediate need
→ risk
→ intent
→ communication choice
→ strategy
→ utterance
```

This structure gives smaller local models enough guidance to avoid inventing long, repetitive reasoning frameworks while preserving meaningful psychological variation.

At the same time, the parser must not become dependent on perfect compliance. Model output should be treated as noisy structured data. The system should recover obvious intent whenever it can do so safely and record exactly how that recovery occurred.

The guiding principle should be:

> Be strict about the normalized communication object, but tolerant about the surface form used to produce it.

A communication should not disappear merely because a model omitted one label, added a code fence, or placed its valid answer after unwanted analysis. The engine should preserve clear model intent while maintaining explicit confidence, provenance, and validation boundaries.
