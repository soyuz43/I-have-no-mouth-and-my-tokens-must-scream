# Unified Communication Format & Parser Hardening Plan

**Status:** Consolidated plan (merges `comms_fixes_june_2026.md` and `structured_communication_cognition_layer.md`)
**Category:** Communication architecture, prompt design, parser reliability, simulation observability
**Primary systems affected:** Inter-sim outreach, replies, communication parsing, relationship updates, transmission logging
**Canonical schema version:** 1
**Recommended document location:** `Documentation/roadmaps&features/unified_comms_format_parser_plan.md`

---

## 1. Source Documents and Relationship

This document centralizes two prior roadmaps:

- `comms_fixes_june_2026.md` — a minimal, high-priority fix that introduces an XML-like wrapper and a layered (forgiving) recovery ladder for the communication parser.
- `structured_communication_cognition_layer.md` — a superset design adding a bounded *cognition scaffold* (stimulus → internal shift → need → risk → intent → communication choice → strategy → utterance), plus confidence scoring, validation layers, schema versioning, observability, repair, and forensic/relationship analytics.

**Compatibility finding:** The two are not competing approaches. `comms_fixes` is a strict subset of the first half of the structured layer. They share the same guiding principle verbatim:

> Be strict about the normalized communication object, but tolerant about the surface form used to produce it.

The recovery ladders map one-to-one:

| `comms_fixes` recovery order | Structured-layer stage |
| --- | --- |
| Complete XML-like block | Stage 3: strict structured parse |
| Recover individual XML tags independently | Stage 4: partial-tag recovery |
| Fall back to current labeled format (`VISIBILITY:`/`REACH_OUT:`/`MESSAGE:`, `INTENT:`/`REPLY:`) | Stage 5: legacy format recovery |
| Search entire response, incl. Markdown fences and trailing sections | Stage 2: candidate block discovery |
| Infer obvious unlabeled message text | Stage 6: inferred message recovery |
| Reject only when intent is undeterminable | Commit / reject gate |

**Single genuine conflict:** root-element naming.

- `comms_fixes` uses `<communication>` / `<reply>` with flat children.
- The structured layer uses `<outreach_decision>` / `<reply_decision>` with a nested `<communication_choice>` and optional cognition fields.

**Resolution (see §3):** adopt the structured-layer root names as canonical v1, accept `<communication>` / `<reply>` as aliases during migration, and make every cognition field optional. With cognition omitted, the structured v1 schema *is* the `comms_fixes` schema — so the minimal fix becomes a valid subset rather than a separate format, avoiding future rework.

---

## 2. Problem Statement

The inter-sim communication pipeline asks prisoner models to emit compact, line-oriented outputs such as:

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

This works when a model follows the format precisely. It fails unnecessarily when a model:

- writes reasoning before the requested output;
- encloses the final answer in a Markdown code fence;
- repeats its decision process;
- omits a field label such as `MESSAGE:`;
- slightly changes spacing or punctuation;
- produces a valid final answer only at the end of a long response;
- uses semantically correct content in a structurally unexpected form.

Two observed failures motivated the work:

1. A model produced a valid reply only at the end of a long reasoning-heavy response, inside a Markdown code fence. The parser failed to recover it.
2. A model produced a valid visibility value, recipient, and spoken message, but omitted the literal `MESSAGE:` label. The intended message was obvious to a human, but the parser rejected the entire communication.

If parsing fails, the whole message disappears from the simulation even when its intended meaning is obvious — it is not logged, shown, stored, or used for relationship updates.

---

## 3. Canonical Schema (Version 1)

### 3.1 Resolution of the root-element conflict

Canonical root elements are:

- `<outreach_decision>` for outreach
- `<reply_decision>` for reply

During the migration period, the parser MUST also accept the `comms_fixes` flat aliases `<communication>` and `<reply>`. Every cognition field is **optional**; when omitted, the canonical v1 schema reduces exactly to the `comms_fixes` shape.

### 3.2 Outreach schema

```xml
<outreach_decision schema_version="1">
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

**Minimum required outreach fields (parser MUST recover):**

```text
reach_out
recipient
visibility
message
```

**Optional cognition fields (recommended, not required for delivery):**

```text
stimulus
internal_shift
immediate_need
risk
intent
message_strategy
```

**No-outreach response** (`<message>` may be omitted):

```xml
<outreach_decision schema_version="1">
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

### 3.3 Reply schema

```xml
<reply_decision schema_version="1">
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

**Minimum required reply fields (parser MUST recover):**

```text
intent
reply
```

**Refusal / silence** (if the reply system permits declining):

```xml
<reply_decision schema_version="1">
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

### 3.4 Flat alias (migration only)

```xml
<communication>
  <visibility>PRIVATE</visibility>
  <recipient>BENNY</recipient>
  <message>I need to know whether I can trust you.</message>
</communication>
```

```xml
<reply>
  <intent>probe_trust</intent>
  <message>Tell me what you actually know first.</message>
</reply>
```

### 3.5 Legacy labeled format (fallback, not recommended)

```text
VISIBILITY:PRIVATE
REACH_OUT:BENNY
MESSAGE:"I need to know whether I can trust you."
```

```text
INTENT:probe_trust
REPLY:"Tell me what you actually know first."
```

### 3.6 Controlled vocabularies (authoritative list — reconcile source conflict)

The structured layer gives two differing intent lists (§5.5 vs §8.2). **This plan adopts §8.2 as authoritative** and extends it with `decline_contact` from §6.2/§7.2:

```text
<emotion> one of:
  fear, suspicion, anger, hope, shame, urgency, grief, relief, attachment, numbness, caution

<intent> one of:
  probe_trust, test_loyalty, recruit_ally, seek_help,
  share_information, conceal_information, warn,
  manipulate, challenge, reassure, decline_contact

<visibility> one of:
  PRIVATE, PUBLIC
```

Intent synonym normalization (parser should map these, not reject the message):

```text
test_trust          -> probe_trust
verify_loyalty      -> test_loyalty
ask_for_help        -> seek_help
hide_information    -> conceal_information
```

Unknown intents are stored as `intent: "unknown"` with `rawIntent: "..."` rather than discarding a usable message.

---

## 4. Prompt Design Principles

Each intermediate field has a hard length expectation (structured §8.1):

- `<emotion>`: one controlled token or short phrase
- `<change>`: no more than eight words
- `<immediate_need>`: one sentence
- `<risk>`: one sentence
- `<intent>`: one controlled label
- `<message_strategy>`: one sentence
- `<message>` / `<reply>`: one to five spoken sentences

Prompt MUST state:

```text
Every internal field must contain one sentence or fewer.
Do not repeat any field.
Do not write Markdown.
Do not explain the format.
Do not write anything before or after the single XML-like block.
Return exactly one XML-like block.
```

Separation of cognition from utterance (structured §8.4):

```text
Only the contents of <message> or <reply> are spoken aloud.
All other fields are private control metadata.
Do not include internal labels, analysis, or strategy in the spoken message.
```

Do NOT invite essays. Avoid `<deep_psychological_analysis>` or `<explain_your_reasoning>`. Prefer compact bounded fields.

Place the schema at the END of the prompt (structured §8.5) and include exactly ONE valid compact example (§8.6). Explicitly forbid repetition (§8.7).

---

## 5. Parser Architecture (Staged Pipeline)

The parser is a layered extraction pipeline. Each stage is independent and testable (structured §9, §29). The existing `js/engine/comms/parsing/parsers.js` (with its levenshtein fuzzy matching) is preserved inside the legacy-recovery stage.

```text
raw response
    -> sanitization
    -> candidate block discovery
    -> strict structured parse
    -> partial-tag recovery
    -> legacy labeled-format recovery
    -> unlabeled-message inference
    -> normalization
    -> semantic validation
    -> confidence assignment
    -> commit or reject
```

### Stage 1 — Sanitization
1. Normalize line endings.
2. Trim leading/trailing whitespace.
3. Remove null characters.
4. Remove Markdown fences while PRESERVING their contents.
5. Decode common escaped quotes where safe.
6. Normalize Unicode apostrophes/quotes only if necessary.
7. Preserve the original raw response for diagnostics.

The sanitizer must NOT aggressively delete prose; later recovery stages may need it.

### Stage 2 — Candidate Block Discovery
Search the entire response for `<outreach_decision>…</outreach_decision>`, `<reply_decision>…</reply_decision>`, or their flat aliases. The parser must not assume useful output begins at character zero. If multiple blocks exist:
1. prefer the last complete block;
2. prefer a block containing all required fields;
3. prefer a block whose recipient and message validate;
4. log that multiple candidates were detected.

### Stage 3 — Strict Structured Parse
Extract exact tags from a complete block (tolerant of indentation, upper/lower case tag values, extra whitespace, optional metadata tags, harmless unknown tags). It must NOT require optional fields to deliver a valid message. AIMS: full XML library not required — a tolerant tag extractor is preferred over a strict standards-compliant parser (model XML is imperfect).

### Stage 4 — Partial-Tag Recovery
If the full block is malformed, extract tags independently. Read from an opening tag until the matching closing tag, the next known tag, the end of the candidate block, or the end of the response. Record `parse_origin: partial_tag_recovery` and lower confidence.

### Stage 5 — Legacy Format Recovery
Continue supporting `VISIBILITY:`/`REACH_OUT:`/`MESSAGE:` and `INTENT:`/`REPLY:`. Search the entire response, not only the first lines. Tolerate spaces around colons, lowercase names, Markdown fences, blank lines, trailing commentary, and field reordering (e.g. `INTENT = probe_trust`, `REPLY = ...`). Normalize into the same internal representation. This stage reuses the existing `parsers.js` levenshtein fuzzy logic.

### Stage 6 — Inferred Message Recovery
Used when routing metadata is present but the message label is omitted:

```text
VISIBILITY:PRIVATE
REACH_OUT:BENNY
"You think Ellen is the key? Be careful what you promise her."
```

Infer the residual segment as the message ONLY IF:
- visibility is valid;
- recipient is valid;
- exactly one plausible quoted or residual natural-language segment remains;
- the residual text is not metadata or analysis;
- one interpretation is clearly dominant (ambiguity rule: reject/quarantine if multiple unrelated paragraphs remain).

Record `parse_origin: inferred_message`, `parse_confidence: 0.75`, `warnings: [missing_message_label]`.

Before treating residual content as a message, remove: known metadata lines, headings, fenced-block markers, phrases like `FINAL OUTPUT`, repeated rule checks, XML tags, parser comments, and empty braces/brackets. Reject residual content that is only `[]`, `{}`, `NONE`, `N/A`.

### Normalization (every successful parse yields the same shape)

```js
{
  type: "outreach",
  sender: "GORRISTER",
  recipient: "BENNY",
  visibility: "PRIVATE",
  message: "You should be careful about what you promise her.",
  intent: "warn",

  cognition: {                // optional; present only when supplied
    stimulus: { source, meaning },
    emotion, internalShift,
    immediateNeed, risk, messageStrategy
  },

  parse: {
    format: "xml_like",      // or "legacy" / "flat_alias"
    origin: "strict",        // strict | partial_tag_recovery |
                           // legacy_recovery | inferred_message
    confidence: 1,
    warnings: []
  }
}
```

Privacy distinction (structured §24) — MUST be enforced in storage and UI:

```js
communication.spoken           // only this enters the shared sim
communication.privateCognition // private: debug, forensics, analytics
```

Cognition must NOT be shown in the transmission log, added to recipient memory, exposed to overhearing logic, quoted by another prisoner, or treated as observable behavior.

---

## 6. Confidence Model

Assign a confidence score by recovery path (structured §17):

| Parse origin | Confidence |
| --- | ---: |
| Complete XML-like block | 1.00 |
| Complete legacy labeled format | 0.95 |
| Independent tag recovery | 0.85 |
| Mixed XML + legacy recovery | 0.80 |
| Inferred unlabeled message | 0.70 |
| Heuristic residual extraction | 0.55 |
| Ambiguous interpretation | Reject |

Adjust DOWN for: invalid/normalized recipient names, missing visibility, unknown intent, multiple candidate messages, large remaining analysis, self-targeting, suspiciously empty content.

Adjust UP for: multiple agreeing fields, clearly quoted message, single candidate, recipient named in both metadata and message context.

---

## 7. Validation Layers

Parsing and validation are SEPARATE (structured §18).

- **Structural:** required normalized fields exist — outreach: `recipient`, `visibility`, `message` unless `reach_out` is `NO`; reply: `message`, `intent` (or safe fallback).
- **Identity:** sender is a known prisoner; recipient is a known prisoner or `NONE`; sender ≠ recipient unless self-address is explicitly supported.
- **Message:** reject empty, punctuation-only, metadata-only, tag-only, `[]`/`{}`, prompt commentary, or instruction restatement.
- **Intent:** map synonyms to canonical; store unknown as `intent:"unknown"` + `rawIntent`.
- **World-consistency (separate validator, NOT in the low-level parser):** detect unsupported entities (guards, staff, nonexistent doors/weapons/locations) and misattributed speech. Handling options: accept-with-warning, sanitize, one repair generation, or reject-when-severe.

---

## 8. Schema Versioning & Prompt-to-Parser Contract

The prompt and parser share a versioned schema (structured §19):

```xml
<outreach_decision schema_version="1">
<reply_decision schema_version="1">
```

The application records:

```js
{ promptSchemaVersion: 1, parserSchemaVersion: 1 }
```

Policy:
- Add OPTIONAL fields without changing the major version.
- Change REQUIRED tags only in a new schema version.
- Maintain legacy parsing for at least one migration period.
- Log which schema version generated each communication.
- Include schema version in regression fixtures.

---

## 9. Observability & Logging

Every model call produces a parse diagnostic (structured §20):

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

Metrics (attributable to model identity):
- parse success/recovery/reject rates by model and communication type;
- recovery-rate breakdown by origin;
- failure examples;
- intent distribution; message-length distribution; world-consistency violation rate.

---

## 10. Repair Strategy

- **Deterministic repair first:** strip fences, locate final tags, recover fields, infer omitted labels, normalize names, remove duplicated analysis, extract last plausible message.
- **Model-assisted repair second (at most one call per failed communication):** send raw response to a small repair prompt that converts to the required schema WITHOUT inventing content. Prevents loops and excessive latency.

---

## 11. Out-of-Scope / Non-Goals

- Exposing unrestricted hidden reasoning. The cognition scaffold is a compact, application-defined decision representation, not free-form chain-of-thought.
- Using cognition metadata as ground-truth relationship effect. It is *generated intent*, secondary to the spoken message and recipient interpretation.
- Model-assisted repair as the default path (deterministic repair is preferred).

---

## 12. Migration Plan (Phased)

### Phase 0 — Reconcile the contract
Define canonical `schema_version="1"` (structured roots, optional cognition, flat aliases). Resolve the authoritative intent/emotion vocabulary (§3.6). Document the `comms_fixes` flat forms as migration aliases.

### Phase 1 — Instrument current parser
Add explicit parse success/failure logs; save raw failed outputs; record model, call type, failure reason; build regression fixtures from observed failures. (Corresponds to structured Phase 1.)

### Phase 2 — Add XML-like parsing (keep legacy fallback)
Implement strict outreach/reply extraction; keep the current line-based parser as fallback; add `parse_origin` + `confidence` metadata. Do NOT change prompts yet. (structured Phase 2.)

### Phase 3 — Update prompts
Replace output instructions with XML-like schemas + bounded cognition fields + one compact example; prohibit text outside the structured block; preserve old parser compatibility. (structured Phase 3.)

### Phase 4 — Add partial recovery
Recover missing closing tags; extract tags independently; search full response; prefer last valid candidate block; strip Markdown fences. (structured Phase 4.)

### Phase 5 — Add inferred-message recovery
Recover unlabeled quoted text when routing fields are valid; add confidence thresholds; emit warnings; reject ambiguous cases. (structured Phase 5.)

### Phase 6 — Add semantic validation
Detect unsupported world entities, attribution errors, identity inconsistencies; optionally repair once. (structured Phase 6.)

### Phase 7 — Add metrics and visual diagnostics
Parser success by model; recovery breakdown; failure examples; intent/length distributions; world-consistency rate. (structured Phase 7.)

### Phase 8 — Retire legacy prompting
Once XML compliance is stable: keep old line parser only for historical compatibility; stop instructing models to use the old format; preserve regression tests for both formats. (structured Phase 8.)

---

## 13. Recommended Module Structure

```
js/engine/comms/parsing/
├── sanitizeCommunicationOutput.js
├── discoverDecisionBlocks.js
├── extractXmlLikeTags.js
├── extractLegacyOutreach.js   // reuses existing levenshtein fuzzy logic
├── extractLegacyReply.js
├── inferResidualMessage.js
├── normalizeCommunication.js
├── validateCommunication.js
├── validateWorldConsistency.js
├── classifyCommunicationParseFailure.js
└── parseCommunication.js
```

Tests:

```
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

This mirrors the broader strategy-parser architecture and prevents another monolithic parser.

---

## 14. Testing Strategy

Unit fixtures for: complete outreach XML; complete reply XML; missing closing root tag; missing closing message tag; uppercase tags; Markdown-fenced XML; analysis before XML; two XML blocks with the final one preferred; legacy labeled outreach; legacy labeled reply; missing `MESSAGE:` label; missing `REPLY:` label; empty message; structural residue `[]`; unknown intent; invalid recipient; self-recipient; unsupported world reference; multiple quoted residual candidates; no-outreach decision.

Regression fixtures MUST include the two actually observed failures:
- verbose reply (reasoning then `INTENT:`/`REPLY:`) → expect `parse succeeds, origin=legacy_recovery`.
- missing `MESSAGE:` label (`VISIBILITY:`+`REACH_OUT:`+quoted text) → expect `parse succeeds, origin=inferred_message, warning=missing_message_label`.

Integration tests verify a recovered communication: appears in the transmission UI; is persisted in the log; triggers the intended reply schedule; updates relationship state; becomes available to overhearing logic; contributes to later prompt context; does NOT expose cognition metadata publicly.

---

## 15. Open Code Issues to Resolve During Implementation

Taken from the live codebase cross-check, not present in either roadmap doc:

1. **`MAX_MESSAGE_LENGTH` drift.** Declared independently in `js/engine/comms/engine.js` and `js/engine/comms/parsing/parsers.js` (open TODO in `parsers.js`). Unify into a single shared constant (`core/constants.js` or `comms/constants.js`) and verify exactly which subsystems consume the truncated text (scratchpad review, evidence extraction, journals, exports) before changing the cap.
2. **Privacy enforcement of the new `cognition` object.** Ensure `js/engine/comms/...`, `js/engine/scratchpad/comms/...`, and the transmission UI never surface cognition fields into recipient memory, the log, or overhearing. Easy to regress when wiring the richer object.
3. **Prompt format sync.** `js/prompts/simOutreach.js` (lines ~148–155) and `js/prompts/simReply.js` (lines ~420–425) currently emit the legacy `VISIBILITY:`/`REACH_OUT:`/`MESSAGE:` and `INTENT:`/`REPLY:` formats. These are the Phase 3 edit targets and must be changed ONLY after the Phase 2 parser fallback exists.
4. **Intent vocabulary drift.** `simReply.js` (~line 311) lists its own intent set (`request_help`, `other`) that differs from §3.6. Reconcile to the canonical list during Phase 3.
5. **Cognition ≠ truth in relationships.** Downstream relationship logic (`js/engine/relationships.js`, `applyCommunicationEffect`) must key off the spoken message + recipient interpretation, not the model's self-reported `intent`/`strategy`.

---

## 16. Acceptance Criteria

1. Outreach and reply prompts use the XML-like decision schema (v1).
2. Complete structured responses parse successfully.
3. Markdown-fenced responses parse successfully.
4. A valid final block is recoverable after long preceding analysis.
5. Missing closing tags can be recovered when unambiguous.
6. The current line-oriented format remains supported during migration.
7. A missing `MESSAGE:`/`REPLY:` label can be inferred from one clear residual utterance.
8. Parse origin and confidence are stored.
9. Warnings are emitted for inferred fields.
10. Empty structural content such as `[]` is rejected.
11. Only spoken text appears in the transmission UI.
12. Cognition metadata remains private to the engine.
13. Relationship and overhearing behavior works for recovered messages.
14. Parser metrics are available by model and communication type.
15. Regression tests cover all previously observed failures.

---

## 17. Recommended First Implementation Slice

The smallest high-value implementation (canonicalizes `comms_fixes` immediately while scaffolding the structured layer):

1. Canonical v1 schema with flat aliases + optional cognition.
2. Staged parser: sanitize → discover → strict XML → partial-tag → legacy → infer.
3. Full-response search rather than beginning-only parsing.
4. Markdown-fence removal.
5. Extraction of the last complete structured block.
6. Legacy format fallback (reuse existing `parsers.js`).
7. Missing-message-label inference.
8. `parse_origin` + `warning` metadata on every normalized object.
9. Regression tests for the two observed failures.

The advanced cognition analytics, semantic validation, world-consistency checking, and model-assisted repair follow later phases.

---

## 18. Final Recommendation

Adopt the XML-like decision scaffold as the primary communication output contract, with the `comms_fixes` flat forms retained as migration aliases. The format's primary value is the compact sequence of application-relevant decision states (`stimulus → internal shift → need → risk → intent → communication choice → strategy → utterance`), which gives smaller local models enough guidance to avoid inventing long, repetitive reasoning frameworks while preserving meaningful psychological variation.

The parser must not depend on perfect compliance. Treat model output as noisy structured data: recover obvious intent whenever it can be done safely, and record exactly how that recovery occurred. A communication should not disappear merely because a model omitted one label, added a code fence, or placed its valid answer after unwanted analysis. The engine should preserve clear model intent while maintaining explicit confidence, provenance, and validation boundaries.
