# Communication Output Format and Parser Hardening

## Problem

The inter-sim communication pipeline currently relies on line-based formats such as:

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

Recent failures showed two weaknesses:

1. A model produced a valid reply only at the end of a long reasoning-heavy response, inside a Markdown code fence. The parser failed to recover it.
2. A model produced a valid outreach recipient and visibility but omitted the `MESSAGE:` label. The intended message was still obvious from the remaining quoted text, but the parser rejected the entire communication.

## Proposed Direction

Replace the current communication format with a simple XML-like structure, matching the newer AM execution format.

### Outreach

```xml
<communication>
  <visibility>PRIVATE</visibility>
  <recipient>BENNY</recipient>
  <message>I need to know whether I can trust you.</message>
</communication>
```

No outreach:

```xml
<communication>
  <recipient>NONE</recipient>
</communication>
```

### Reply

```xml
<reply>
  <intent>probe_trust</intent>
  <message>Tell me what you actually know first.</message>
</reply>
```

## Parser Requirements

The parser should use layered recovery rather than rejecting the complete response after one formatting mistake.

### Preferred extraction order

1. Parse a complete XML-like block.
2. Recover individual XML tags independently if the complete block is malformed.
3. Fall back to the current labeled format:

   * `VISIBILITY:`
   * `REACH_OUT:`
   * `MESSAGE:`
   * `INTENT:`
   * `REPLY:`
4. Search the entire response, including Markdown code fences and trailing output sections.
5. Recover obvious unlabeled message text when the recipient and visibility are already known.
6. Reject only when the intended communication cannot be determined with reasonable confidence.

## Specific Recovery Rules

* If `VISIBILITY` and `REACH_OUT` are present but `MESSAGE:` is omitted, treat the remaining quoted or non-metadata text as the message.
* If `INTENT` is present but `REPLY:` is omitted, treat the remaining quoted or non-metadata text as the reply.
* Strip Markdown fences before parsing.
* Prefer the last complete structured block when the model includes analysis before its final answer.
* Ignore headings, reasoning sections, and repeated instruction checks.
* Do not accept empty structural residue such as `[]`, `{}`, or tag-only content as a valid message.
* Record whether the result came from:

  * strict parsing,
  * partial-tag recovery,
  * labeled-format recovery,
  * inferred-message recovery.
* Emit a warning whenever inference was required, but preserve the communication when confidence is high.

## Validation

After recovery, validate:

* recipient is one of the five known prisoners or `NONE`;
* visibility is `PRIVATE` or `PUBLIC`;
* intent is a recognized intent or safely normalized;
* message text is nonempty;
* sender is not addressing themselves unless explicitly permitted;
* structural analysis or prompt commentary is not included in the final message.

## Goal

The communication parser should be strict about the resulting data shape, but forgiving about how local models express that data.

A minor omission such as a missing `MESSAGE:` label should not cause an otherwise obvious and usable communication to disappear from the simulation.
