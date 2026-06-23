The previous unread-highlight machinery **barely helps with this**. The useful parts are only incidental:

* the cognition modal already uses delegated event handling;
* it already has per-modal UI state in `G`;
* the evidence values are already canonical message IDs rather than loose prose;
* your communication history appears to retain those same IDs.

The giant path-prefix highlight system itself does not make message lookup meaningfully easier.

What actually makes this feature easy is that the cognition record already contains IDs like `C0-M000005`, and the messages themselves should exist in `G.comms.history` under those IDs.

## The best design

Do **not** open the old communications modal for the first implementation.

Keep the user inside the cognition modal and turn each evidence ID into a clickable button:

```text
C0-M000005   C0-M000008
```

Clicking one opens a single evidence viewer directly below that claim:

```text
┌ EVIDENCE MESSAGE · C0-M000005 ────────────────────────┐
│ CYCLE 0 · PRIVATE · NIMDOK → TED · intent: outreach  │
│                                                       │
│ “You see things differently than the rest of us...”  │
└───────────────────────────────────────────────────────┘
```

Clicking `C0-M000008` afterward replaces the contents of that same viewer. It does not create another panel and does not increase the height again.

That is a moderate feature, not a giant subsystem.

## Likely files

The first version should require only:

```text
js/core/state.js
js/ui/cognitionFormatter.js
js/ui/cognitionModal.js
styles.css
```

Possibly no state-file change at all if the selected evidence message only needs to survive while the modal remains rendered.

The old communications modal can remain untouched.

## Roadmap

### 1. Confirm the canonical message lookup

Create one helper that resolves an exact ID from communication history:

```js
function findCommunicationMessage(messageId) {
  return G.comms?.history?.find(
    (message) =>
      message.messageId === messageId
  ) ?? null;
}
```

That should be the only source of message content. The cognition scratchpad stores references; it should not duplicate the full canonical message.

This is the first thing to verify because the entire feature depends on:

```js
claim.evidence = [
  "C0-M000005",
  "C0-M000008",
];
```

matching:

```js
G.comms.history[n].messageId
```

### 2. Render evidence IDs as buttons

The formatter currently produces visual evidence chips. Change their markup from a passive element such as:

```html
<span class="cog-evidence-ref">
  C0-M000005
</span>
```

to:

```html
<button
  type="button"
  class="cog-evidence-ref"
  data-cog-message-id="C0-M000005"
>
  C0-M000005
</button>
```

This does not require individual event listeners. One listener on the cognition modal body handles every evidence button.

### 3. Give each populated claim one viewer slot

Inside each populated claim, after the evidence row, render one initially hidden container:

```html
<div
  class="cog-evidence-viewer"
  data-cog-evidence-viewer
  hidden
></div>
```

There is exactly one viewer per claim, regardless of how many evidence IDs it contains.

That gives you the behavior you described:

* first click: viewer becomes visible and the claim becomes taller;
* later clicks: same viewer receives different message contents;
* no additional vertical expansion from adding more viewers.

### 4. Add one delegated click listener

In `cognitionModal.js`, extend the existing modal-body event handling:

```js
body.addEventListener("click", (event) => {
  const button =
    event.target.closest(
      "[data-cog-message-id]"
    );

  if (!button) {
    return;
  }

  const messageId =
    button.dataset.cogMessageId;

  const message =
    findCommunicationMessage(
      messageId
    );

  const claim =
    button.closest(
      ".cog-claim"
    );

  const viewer =
    claim?.querySelector(
      "[data-cog-evidence-viewer]"
    );

  if (!viewer) {
    return;
  }

  renderEvidenceMessage(
    viewer,
    messageId,
    message
  );
});
```

The real implementation should also:

* mark the selected chip with `.sel`;
* remove `.sel` from its sibling chips;
* show a useful unavailable state if the ID cannot be resolved.

### 5. Render the message into the existing viewer

A small DOM renderer can display:

* message ID;
* cycle;
* public/private channel;
* sender and recipient;
* mode or intent;
* canonical message body.

Something like:

```js
function renderEvidenceMessage(
  viewer,
  messageId,
  message
) {
  viewer.hidden = false;

  if (!message) {
    viewer.innerHTML = `
      <div class="cog-evidence-error">
        MESSAGE ${escapeHtml(messageId)} NOT FOUND
      </div>
    `;
    return;
  }

  viewer.innerHTML = `
    <div class="cog-evidence-message-head">
      ${escapeHtml(messageId)}
      · CYCLE ${escapeHtml(message.cycle)}
      · ${escapeHtml(message.visibility)}
      · ${escapeHtml(message.from)}
      → ${escapeHtml(message.to)}
    </div>

    <div class="cog-evidence-message-text">
      ${escapeHtml(message.text)}
    </div>
  `;
}
```

Use your existing escaping and recipient-normalization helpers rather than duplicating them if they are already accessible.

### 6. Keep the expanded height stable

You probably do not need JavaScript height calculations.

Give the viewer a fixed or minimum presentation height:

```css
.cog-evidence-viewer {
  min-height: 8rem;
  max-height: 15rem;
  overflow-y: auto;
}
```

On first click, it goes from `hidden` to visible. Every later selected message uses the same box dimensions.

That precisely gives you:

> “Make it vertically bigger initially, and then selecting another evidence message changes the message without making it bigger again.”

If message lengths vary significantly, use a fixed `height` rather than `min-height`:

```css
height: 11rem;
```

Then long messages scroll inside the viewer instead of resizing the claim.

## What happens to the old communications modal?

Treat that as a separate second phase.

Once the inline cognition viewer works, the old communications modal can be modernized to understand message IDs:

1. Render `data-message-id` on every message record.
2. Accept an optional selected message ID when opening.
3. Select the correct filter or show all.
4. Scroll the matching message into view.
5. Add a temporary highlight class.
6. Potentially add an “OPEN IN COMMUNICATIONS” button to the inline cognition viewer.

That would allow:

```text
click evidence ID
→ read inline inside cognition modal
→ optionally click OPEN IN COMMUNICATIONS
→ old modal opens and scrolls directly to that canonical message
```

But that should come later. Making the cognition viewer depend on the old modal would unnecessarily couple two UI systems.

## Difficulty

The inline viewer alone is approximately:

* one small lookup/rendering block in `cognitionModal.js`;
* one markup change where evidence chips are rendered;
* one viewer placeholder per claim;
* one CSS section.

Realistically, around **100–200 lines in your expanded formatting style**, not hundreds of conceptual moving parts.

Modernizing the old communications modal afterward is probably another **100–200 lines**, depending on how its filtering and rendering currently work.

## Did the prior work help?

A little:

* canonical message IDs already exist;
* the cognition modal already has a centralized controller;
* delegated event handling is now an established pattern;
* the formatter already knows exactly where evidence belongs.

But the unread highlight path system is mostly unrelated. This new feature should not be built on `highlightPrefixes`, acknowledgement state, or change-path classification. It should be a direct relationship:

```text
evidence button
→ messageId
→ G.comms.history lookup
→ one inline viewer
```

That is the correct level of complexity.



---

# Inline Evidence Message Viewer — Minimal Roadmap

## Objective

Make message IDs shown under a cognition claim’s `evidence` field clickable.

When the user clicks an evidence message ID:

1. Resolve that exact message from canonical communication history.
2. Open one inline message viewer inside the current claim.
3. Display the canonical message metadata and text.
4. When another evidence ID in the same claim is clicked, replace the contents of the existing viewer.
5. Do not open another modal.
6. Do not create additional viewer panels.
7. Do not resize the viewer again after its initial expansion.

## Required behavior

Given evidence such as:

```text
C0-M000005
C0-M000008
```

Clicking `C0-M000005` should display that message below the evidence row.

Clicking `C0-M000008` should reuse the same viewer and replace the displayed message.

The selected evidence ID should receive a visible selected state.

The cognition modal must remain open and retain the user’s current scroll position.

## Canonical data source

The evidence record stores only message IDs.

The full message must be resolved from the existing canonical communication history, expected to be something like:

```js
G.comms.history
```

Lookup should be direct:

```js
const message =
  G.comms?.history?.find(
    (item) =>
      item.messageId === messageId
  ) ?? null;
```

Do not:

* copy complete messages into scratchpad records;
* create a second message archive;
* modify the scratchpad schema;
* modify the communication pipeline;
* add message caching unless profiling proves it necessary.

## Expected files

The first implementation should normally change only:

```text
js/ui/cognitionFormatter.js
js/ui/cognitionModal.js
styles.css
```

A fourth file is justified only if an existing shared message-lookup or rendering helper clearly belongs elsewhere.

Do not modify:

```text
js/engine/scratchpad/
js/prompts/
js/core/state.js
the old communications modal
exporter logic
highlight or unread-state logic
```

unless the current code proves that a required canonical message ID is unavailable.

## Implementation steps

### 1. Verify the message contract

Confirm that:

```js
claim.evidence
```

contains IDs matching:

```js
G.comms.history[*].messageId
```

Stop immediately if the identifiers do not match. Fix the identifier contract before building UI behavior.

### 2. Render evidence IDs as buttons

Change passive evidence chips into buttons with one data attribute:

```html
<button
  type="button"
  class="cog-evidence-ref"
  data-cog-message-id="C0-M000005"
>
  C0-M000005
</button>
```

Do not add an individual listener to every button.

### 3. Add one viewer per claim

Render one hidden viewer container inside each populated claim:

```html
<div
  class="cog-evidence-viewer"
  data-cog-evidence-viewer
  hidden
></div>
```

There must be exactly one viewer per claim.

### 4. Add one delegated click listener

Attach one click listener to the cognition modal body.

The listener should:

1. Find the nearest `[data-cog-message-id]` button.
2. Read the message ID.
3. Find the containing `.cog-claim`.
4. Find that claim’s `[data-cog-evidence-viewer]`.
5. Resolve the canonical message from `G.comms.history`.
6. Render it into that viewer.
7. Remove the selected state from sibling evidence buttons.
8. Add the selected state to the clicked button.

Do not rerender the whole cognition modal.

### 5. Render a compact canonical message card

Show only useful fields already present on the message:

```text
message ID
cycle
visibility or channel
sender
recipient or recipients
intent or kind, when available
message text
```

Missing optional fields should be omitted cleanly.

If the message ID cannot be found, show:

```text
MESSAGE C0-M000005 NOT FOUND
```

Do not throw and break the modal.

### 6. Keep the viewer size stable

Use a fixed height or a bounded height:

```css
.cog-evidence-viewer {
  height: 11rem;
  overflow-y: auto;
}
```

The viewer is initially hidden.

The first click reveals it and increases the claim’s height once.

Later evidence selections replace its contents without changing its outer height.

## Styling scope

Add only:

```text
button reset styles for evidence IDs
hover state
selected evidence-ID state
viewer container
viewer header
viewer message body
not-found state
```

Match the existing cognition visual language.

Do not redesign the claim, modal, message chips, or global typography.

## Acceptance criteria

The feature is complete when all of these are true:

* Clicking an evidence ID displays the correct canonical message.
* The cognition modal stays open.
* The claim stays open.
* The modal does not jump to another scroll position.
* A second evidence click reuses the same viewer.
* Only one evidence viewer exists per claim.
* The viewer height stays stable when switching messages.
* The selected evidence ID is visually distinct.
* An unknown ID produces a contained error message.
* No scratchpad, prompt, exporter, or communication-engine code changed.

## Complexity budget

Target:

```text
cognitionFormatter.js: small markup change
cognitionModal.js: one lookup helper, one renderer, one delegated listener
styles.css: one focused style section
```

Expected total:

```text
roughly 80–180 lines in the project’s expanded formatting style
```

Pause and reassess if the proposed implementation:

* touches more than four files;
* introduces a new global subsystem;
* adds more than one new state object;
* modifies the scratchpad schema;
* modifies the communications pipeline;
* exceeds roughly 250 lines;
* depends on the old communications modal;
* introduces path-prefix logic, observers, caches, registries, or event buses.

## Explicit non-goals

Not part of this feature:

* opening the old communications modal;
* scrolling the communications modal to a selected message;
* cross-modal synchronization;
* preserving the selected evidence message after the cognition modal closes;
* exporting the inline viewer;
* marking evidence as read or unread;
* adding tooltips or previews;
* message search;
* message pagination;
* keyboard navigation beyond native button behavior;
* generalized linked-record infrastructure.

Those can be separate later features.

## Possible later enhancement

After the inline viewer works, optionally add:

```text
OPEN IN COMMUNICATIONS
```

That later feature may update the old communications modal so it can:

1. accept a message ID;
2. render IDs on message rows;
3. open with the correct message visible;
4. scroll to and temporarily highlight that row.

Do not couple the initial inline viewer to that later work.

## Instruction to coding assistants

Implement only the objective and acceptance criteria above.

Before proposing architecture, identify the smallest existing formatter location, modal event surface, and canonical message source.

Prefer direct data flow:

```text
evidence button
→ message ID
→ G.comms.history lookup
→ existing inline viewer
```

Do not generalize the feature into a notification system, linked-record framework, modal router, message registry, or reusable application-wide inspector.
