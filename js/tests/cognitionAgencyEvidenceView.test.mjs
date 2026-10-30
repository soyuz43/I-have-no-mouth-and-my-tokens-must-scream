// js/tests/cognitionAgencyEvidenceView.test.mjs
//
// The Cognition view must be able to OPEN the evidence behind a
// scratchpad reference, whatever kind of evidence that reference
// names.
//
// THE BUG THIS COVERS
// -------------------
// The scratchpad evidence contract admits canonical messages,
// overheard events, and (since the agency-evidence change) agency
// events. The Cognition view's availability check only knew about
// G.comms.history, so a reference to an agency event rendered as
// disabled with the title "Message not available in current history"
// even though the event existed in G.agency.events. The preview
// lookup searched only messages too, so there was nothing to open.
//
// The same gap already affected overheard event IDs, which are
// admissible evidence on the same terms.
//
// These tests cover:
//
//  1. An agency-event reference is interactive when the event exists.
//  2. An agency-event reference is still disabled when it does not.
//  3. The preview renders the agency event's resolved outcome.
//  4. An overheard-event reference is interactive and previewable.
//  5. Message references are unaffected.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  formatScratchpadForDisplay,
  formatEvidenceReference,
  formatEvidenceAgencyEvent,
  formatEvidenceOverhearingEvent,
} from "../ui/cognitionFormatter.js";

import {
  getAvailableEvidenceIds,
} from "../ui/cognitionModal.js";

import { G } from "../core/state.js";

function buildScratchWithAgencyNote() {
  return {
    schemaVersion: 1,
    initialized: true,
    revision: 0,
    goalHistory: [],
    predictions: [],
    unresolvedQuestions: [],
    discardedHypotheses: [],
    hypothesesAboutAM: [],
    hypothesesAboutOthers: {
      BEN: {
        perceivedGoal: {
          value: "hi",
          confidence: 0.5,
          evidence: ["agency:3:1"],
          rationale: "r",
        },
      },
    },
    informationModel: { channels: {} },
    metaAwareness: {},
    messageNotes: [
      {
        messageId: "agency:3:1",
        sequence: 1,
        cycle: 3,
        speaker: "TED",
        recipients: [],
        channel: "agency",
        kind: "SMOKE",
        intent: null,
        note: "I reached for it and there was nothing there.",
        confidence: 0.7,
        sourceEventId: "agency:3:1",
      },
    ],
  };
}

function makeAgencyEvent() {
  return {
    eventId: "agency:3:1",
    cycle: 3,
    actorId: "TED",
    actionType: "SMOKE",
    status: "blocked",
    provenance: {
      resolutionReason: "resource_unavailable",
      resourceIds: ["cigarette_stack_01"],
      targetId: null,
    },
  };
}

function makeOverhearingEvent() {
  return {
    eventId: "C3-O000001",
    sequence: 1,
    cycle: 3,
    listener: "TED",
    participants: { from: "ELLEN", to: "BENNY" },
    outcome: "full",
    sourceMessageIds: ["C3-M000001"],
    sourceKind: "MESSAGE",
    observations: [
      {
        sourceMessageId: "C3-M000001",
        sourceMessageSequence: 1,
        perception: "full",
        text: "Meet me by the wall.",
        characterRange: null,
      },
    ],
  };
}

/* ============================================================
   1-2. AVAILABILITY
============================================================ */

test("an agency-event reference is interactive when the event exists", () => {
  const html =
    formatScratchpadForDisplay(
      buildScratchWithAgencyNote(),
      "TED",
      null,
      new Set(["agency:3:1"])
    );

  assert.match(
    html,
    /<button[^>]*data-cog-message-id="agency:3:1"/
  );
  assert.doesNotMatch(
    html,
    /cog-ref--unavailable[^>]*>agency:3:1/
  );
});

test("an agency-event reference stays disabled when the event does not exist", () => {
  const html =
    formatScratchpadForDisplay(
      buildScratchWithAgencyNote(),
      "TED",
      null,
      new Set()
    );

  assert.doesNotMatch(
    html,
    /<button[^>]*data-cog-message-id="agency:3:1"/
  );

  assert.match(
    html,
    /class="cog-ref cog-ref--unavailable"[^>]*>agency:3:1</
  );
});

test("an unavailable agency-event reference says agency event, not message", () => {
  const html =
    formatScratchpadForDisplay(
      buildScratchWithAgencyNote(),
      "TED",
      null,
      new Set()
    );

  assert.match(
    html,
    /title="agency event not available in current history"/
  );
});

test("an available agency-event reference is labelled as an agency event", () => {
  const html =
    formatScratchpadForDisplay(
      buildScratchWithAgencyNote(),
      "TED",
      null,
      new Set(["agency:3:1"])
    );

  assert.match(
    html,
    /aria-label="View agency event agency:3:1"/
  );
});

/* ============================================================
   3. THE AGENCY EVENT PREVIEW
============================================================ */

test("the agency event preview renders the resolved outcome", () => {
  const html =
    formatEvidenceReference(
      "agency:3:1",
      null,
      makeAgencyEvent(),
      null
    );

  assert.match(html, /agency:3:1/);
  assert.match(html, /SMOKE/);
  assert.match(html, /blocked/);
  assert.match(html, /resource_unavailable/);
  assert.match(html, /TED/);
});

test("the agency event preview escapes HTML in event-derived values", () => {
  const html =
    formatEvidenceAgencyEvent(
      "agency:3:1",
      {
        eventId: "agency:3:1",
        cycle: 3,
        actorId: "<b>x",
        actionType: "SMOKE",
        status: "blocked",
        provenance: {
          resolutionReason: '"><img src=y onerror=z>',
        },
      }
    );

  assert.ok(html.includes("&lt;b&gt;x"));
  assert.ok(!html.includes("<b>x"));
  assert.ok(html.includes("&quot;&gt;"));
  assert.ok(!html.includes("<img"));
});

test("a missing agency event renders a not-found card", () => {
  const html =
    formatEvidenceAgencyEvent(
      "agency:9:9",
      undefined
    );

  assert.match(html, /AGENCY EVENT agency:9:9 NOT FOUND/);
});

test("the agency event preview marks engine bookkeeping as hidden from the agent", () => {
  const html =
    formatEvidenceAgencyEvent(
      "agency:3:1",
      makeAgencyEvent()
    );

  /*
   * The action and its outcome are the prisoner's own experience, so
   * they are shown to the agent. The resolution reason is engine
   * bookkeeping.
   */
  assert.match(
    html,
    /class="cog-evidence-field-name">action_type<\/span>\s*<span class="cog-visibility cog-visibility--visible"/
  );

  assert.match(
    html,
    /class="cog-evidence-field-name">resolution_reason<\/span>\s*<span class="cog-visibility cog-visibility--hidden"/
  );
});

/* ============================================================
   4. OVERHEARD EVENTS
============================================================ */

test("an overheard-event reference is interactive and previewable", () => {
  const scratchpad = {
    ...buildScratchWithAgencyNote(),
    hypothesesAboutOthers: {
      BEN: {
        perceivedGoal: {
          value: "hi",
          confidence: 0.5,
          evidence: ["C3-O000001"],
          rationale: "r",
        },
      },
    },
    messageNotes: [],
  };

  const html =
    formatScratchpadForDisplay(
      scratchpad,
      "TED",
      null,
      new Set(["C3-O000001"])
    );

  assert.match(
    html,
    /<button[^>]*data-cog-message-id="C3-O000001"/
  );

  const preview =
    formatEvidenceReference(
      "C3-O000001",
      null,
      null,
      makeOverhearingEvent()
    );

  assert.match(preview, /C3-O000001/);
  assert.match(preview, /Meet me by the wall/);
});

test("a missing overheard event renders a not-found card", () => {
  const html =
    formatEvidenceOverhearingEvent(
      "C9-O999999",
      undefined
    );

  assert.match(
    html,
    /OVERHEARD EVENT C9-O999999 NOT FOUND/
  );
});

/* ============================================================
   5. MESSAGES ARE UNAFFECTED
============================================================ */

test("a message reference still previews as a message", () => {
  const html =
    formatEvidenceReference(
      "C3-M000001",
      {
        messageId: "C3-M000001",
        cycle: 3,
        from: "ELLEN",
        to: ["TED"],
        visibility: "public",
        text: "I will send the next message to TED.",
      }
    );

  assert.match(html, /C3-M000001/);
  assert.match(html, /ELLEN/);
  assert.match(html, /I will send the next message to TED/);
});

test("a message reference still renders the message unavailable title", () => {
  const scratchpad = {
    ...buildScratchWithAgencyNote(),
    messageNotes: [
      {
        messageId: "C3-M000009",
        sequence: 1,
        cycle: 3,
        speaker: "ELLEN",
        note: "gone",
        confidence: 0.5,
      },
    ],
  };

  const html =
    formatScratchpadForDisplay(
      scratchpad,
      "TED",
      null,
      new Set()
    );

  assert.match(
    html,
    /title="message not available in current history"/
  );
});

test("a reference to nothing at all still renders a message not-found card", () => {
  const html =
    formatEvidenceReference(
      "C9-M999999"
    );

  assert.match(
    html,
    /MESSAGE C9-M999999 NOT FOUND/
  );
});

/* ============================================================
   6. THE MODAL'S OWN AVAILABILITY SET
============================================================ */

test("the modal's availability set includes agency and overheard events, not just messages", () => {
  /*
   * This is the function the modal actually uses to decide whether a
   * reference is openable. It is the one that was reading only
   * G.comms.history, which is what made every agency reference
   * render as missing.
   */
  const saved = {
    comms: G.comms,
    agency: G.agency,
    overhearing: G.overhearing,
  };

  try {
    G.comms = {
      history: [
        { messageId: "C3-M000001" },
      ],
    };

    G.agency = {
      events: [makeAgencyEvent()],
    };

    G.overhearing = {
      history: [makeOverhearingEvent()],
    };

    const ids = getAvailableEvidenceIds();

    assert.ok(ids.has("C3-M000001"));
    assert.ok(ids.has("agency:3:1"));
    assert.ok(ids.has("C3-O000001"));

    /*
     * And the reference actually renders as openable through the
     * modal's own set.
     */
    const html =
      formatScratchpadForDisplay(
        buildScratchWithAgencyNote(),
        "TED",
        null,
        ids
      );

    assert.match(
      html,
      /<button[^>]*data-cog-message-id="agency:3:1"/
    );
  } finally {
    G.comms = saved.comms;
    G.agency = saved.agency;
    G.overhearing = saved.overhearing;
  }
});

test("the modal's availability set tolerates missing ledgers", () => {
  const saved = {
    comms: G.comms,
    agency: G.agency,
    overhearing: G.overhearing,
  };

  try {
    G.comms = null;
    G.agency = null;
    G.overhearing = null;

    assert.equal(
      getAvailableEvidenceIds().size,
      0
    );
  } finally {
    G.comms = saved.comms;
    G.agency = saved.agency;
    G.overhearing = saved.overhearing;
  }
});
