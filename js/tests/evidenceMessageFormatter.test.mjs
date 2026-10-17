import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  formatScratchpadForDisplay,
  formatEvidenceMessage,
} from "../ui/cognitionFormatter.js";
import {
  formatCognitionOverview,
} from "../ui/cognitionOverview.js";
import { SIM_IDS } from "../core/constants.js";
import { Exporter } from "../utils/exporter/state.js";

function buildScratchWithClaim() {
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
          evidence: ["C0-M000005", "C0-M000008"],
          rationale: "r",
        },
      },
    },
    informationModel: { channels: {} },
    metaAwareness: {},
  };
}

test("interactive evidence buttons carry aria-controls/aria-expanded and the viewer has id + aria-live", () => {
  const html = formatScratchpadForDisplay(
    buildScratchWithClaim(),
    "TED",
    null
  );

  const buttonCount = (html.match(/cog-evidence-ref/g) || []).length;
  assert.equal(buttonCount, 2);
  assert.ok(html.includes("aria-controls="), "buttons should reference viewer id");
  assert.ok(
    html.includes('aria-expanded="false"'),
    "buttons start collapsed"
  );
  assert.ok(
    /id="cog-evidence-viewer-\d+"/.test(html),
    "viewer should have a unique id"
  );
  assert.ok(
    html.includes('aria-live="polite"'),
    "viewer should be aria-live"
  );
  assert.ok(
    html.includes("data-cog-evidence-close"),
    "viewer should include a close control"
  );
});

test("evidence references are interactive only when message history contains them", () => {
  const scratchpad = buildScratchWithClaim();
  scratchpad.messageNotes = [];

  const html = formatScratchpadForDisplay(
    scratchpad,
    "TED",
    null,
    new Set(["C0-M000005"])
  );

  assert.match(
    html,
    /<button[^>]*data-cog-message-id="C0-M000005"/
  );
  assert.match(
    html,
    /<span[^>]*class="cog-ref cog-ref--unavailable"[^>]*>C0-M000008<\/span>/
  );
  assert.doesNotMatch(
    html,
    /<button[^>]*data-cog-message-id="C0-M000008"/
  );

  const missingOnlyHtml = formatScratchpadForDisplay(
    buildScratchWithClaim(),
    "TED",
    null,
    new Set()
  );

  assert.doesNotMatch(
    missingOnlyHtml,
    /<button[^>]*data-cog-message-id=/
  );
  assert.doesNotMatch(
    missingOnlyHtml,
    /data-cog-evidence-viewer/
  );
});

test("prediction, question, and message-note refs share history-aware rendering", () => {
  const scratchpad = buildScratchWithClaim();
  scratchpad.predictions = [
    {
      prediction: "A message will arrive",
      confidence: 0.7,
      evidence: ["C0-M000005", "C0-M000404"],
    },
  ];
  scratchpad.unresolvedQuestions = [
    {
      question: "Who sent the message?",
      evidence: ["C0-M000008", "C0-M000405"],
    },
  ];
  scratchpad.messageNotes = [
    { messageId: "C0-M000005", sequence: 1, note: "available" },
    { messageId: "C0-M000406", sequence: 2, note: "missing" },
  ];

  const html = formatScratchpadForDisplay(
    scratchpad,
    "TED",
    null,
    new Set(["C0-M000005", "C0-M000008"])
  );

  assert.equal(
    (html.match(/<button[^>]*data-cog-message-id=/g) || []).length,
    5
  );
  assert.equal(
    (html.match(/cog-ref--unavailable/g) || []).length,
    3
  );
  assert.match(html, /data-cog-message-id="C0-M000005"/);
  assert.match(html, /data-cog-message-id="C0-M000008"/);
  assert.match(html, />C0-M000404<\/span>/);
  assert.match(html, />C0-M000405<\/span>/);
  assert.match(html, />C0-M000406<\/span>/);
});

test("cognition overview renders visible trend classes and accessible metric bars", () => {
  const originalHistory = Exporter.overviewHistory;
  const originalRunId = Exporter.runId;

  try {
    Exporter.runId = "cognition-overview-test";
    Exporter.overviewHistory = [
      {
        cycle: 1,
        streams: {
          state: SIM_IDS.map((agent) => ({
            agent,
            hope: 60,
            sanity: 70,
            suffering: 40,
          })),
        },
      },
      {
        cycle: 2,
        streams: {
          state: SIM_IDS.map((agent) => ({
            agent,
            hope: 70,
            sanity: 60,
            suffering: 30,
          })),
        },
      },
    ];

    const sims = Object.fromEntries(
      SIM_IDS.map((id) => [
        id,
        {
          hope: 70,
          sanity: 60,
          suffering: 30,
          _trend: { hope: 2, sanity: -1, suffering: -3 },
          scratchpad: {
            revision: 1,
            hypothesesAboutAM: [
              {
                belief: {
                  value: "test belief",
                  confidence: 0.6,
                  evidence: [],
                },
              },
            ],
          },
        },
      ])
    );

    const html = formatCognitionOverview({
      cycle: 2,
      sims,
      relationships: {},
    });

    assert.match(html, /cog-sparkline cog-sparkline--positive/);
    assert.match(html, /cog-sparkline cog-sparkline--negative/);
    assert.match(html, /class="cog-pulse-meter"/);
    assert.match(html, /aria-valuenow="70"/);
    assert.match(html, /cog-pressure-confidence-track/);
    assert.match(html, /aria-valuetext="60%"/);
    assert.match(html, /cog-overview-table cog-pressure-table/);
    assert.match(html, /cog-overview-table cog-relationship-matrix/);
  } finally {
    Exporter.overviewHistory = originalHistory;
    Exporter.runId = originalRunId;
  }
});

test("formatEvidenceMessage escapes HTML in message-derived values", () => {
  const html = formatEvidenceMessage("C0-M000005", {
    messageId: "C0-M000005",
    from: "<b>x",
    text: '"><img src=y onerror=z>',
  });
  assert.ok(html.includes("&lt;b&gt;x"));
  assert.ok(!html.includes("<b>x"));
  assert.ok(html.includes("&quot;&gt;"));
  assert.ok(!html.includes("<img"));
});

test("message-note visibility allowlist and hidden metadata grouping are explicit", () => {
  const scratchpad = buildScratchWithClaim();
  scratchpad.messageNotes = [
    {
      messageId: "C0-M000005",
      speaker: "TED",
      note: "A visible note",
      confidence: 0.8,
      intent: "OUTREACH",
      cycle: 3,
      sequence: 5,
      channel: "private",
      kind: "message",
      engineDetail: "unknown fields default hidden",
    },
  ];

  const html = formatScratchpadForDisplay(
    scratchpad,
    "TED",
    null,
    new Set(["C0-M000005"])
  );

  for (const fieldName of ["message_id", "speaker", "note", "confidence"]) {
    assert.match(
      html,
      new RegExp(
        `class="cog-field-name">${fieldName}<\\/span>\\s*` +
          `<span class="cog-visibility cog-visibility--visible"`
      )
    );
  }

  for (const fieldName of [
    "intent",
    "cycle",
    "sequence",
    "channel",
    "kind",
    "engine_detail",
  ]) {
    assert.match(
      html,
      new RegExp(
        `class="cog-field-name">${fieldName}<\\/span>\\s*` +
          `<span class="cog-visibility cog-visibility--hidden"`
      )
    );
  }

  const visibleNotePosition = html.indexOf(
    'class="cog-field-name">note</span>'
  );
  const metadataSectionPosition = html.indexOf(
    'class="cog-system-metadata__fields"'
  );
  const hiddenIntentPosition = html.indexOf(
    'class="cog-field-name">intent</span>'
  );

  assert.match(html, /System metadata · not shown to agent/);
  assert.ok(visibleNotePosition >= 0);
  assert.ok(metadataSectionPosition > visibleNotePosition);
  assert.ok(hiddenIntentPosition > metadataSectionPosition);
  assert.match(
    html,
    /class="cog-system-metadata"[\s\S]*?aria-label="System metadata, not shown to agent"/
  );
  assert.match(html, /role="img" aria-label="Shown to agent"/);
  assert.match(
    html,
    /role="img" aria-label="System metadata, not shown to agent"/
  );
  assert.doesNotMatch(html, /\p{Extended_Pictographic}/u);
});

test("evidence message visibility icons mark only prompt-visible allowlisted fields", () => {
  const html = formatEvidenceMessage("C0-M000005", {
    messageId: "C0-M000005",
    cycle: 3,
    visibility: "private",
    from: "TED",
    to: ["ELLEN"],
    intent: "OUTREACH",
    text: "Can we talk?",
  });

  for (const fieldName of [
    "message_id",
    "visibility",
    "sender",
    "recipients",
    "text",
  ]) {
    assert.match(
      html,
      new RegExp(
        `class="cog-evidence-field-name">${fieldName}<\\/span>\\s*` +
          `<span class="cog-visibility cog-visibility--visible"`
      )
    );
  }

  for (const fieldName of ["cycle", "intent"]) {
    assert.match(
      html,
      new RegExp(
        `class="cog-evidence-field-name">${fieldName}<\\/span>\\s*` +
          `<span class="cog-visibility cog-visibility--hidden"`
      )
    );
  }

  assert.doesNotMatch(html, /\p{Extended_Pictographic}/u);
});

test("cognition modal keeps the SVG field-visibility legend in its shell", () => {
  const modalMarkup = readFileSync(
    new URL("../../index.html", import.meta.url),
    "utf8"
  );

  assert.match(modalMarkup, /class="cog-visibility-legend"/);
  assert.match(modalMarkup, /Shown to agent/);
  assert.match(modalMarkup, /System metadata · hidden from agent/);
  assert.equal(
    (modalMarkup.match(/class="cog-visibility__eye"/g) || []).length,
    2
  );
  assert.match(modalMarkup, /class="cog-visibility cog-visibility--visible"/);
  assert.match(modalMarkup, /class="cog-visibility cog-visibility--hidden"/);
  assert.match(modalMarkup, /stroke="currentColor"/);
  assert.match(modalMarkup, /aria-label="Field visibility legend"/);
});

test("formatEvidenceMessage renders a not-found card for missing message", () => {
  const html = formatEvidenceMessage("C0-M000999", undefined);
  assert.ok(html.includes("cog-evidence-card--missing"));
  assert.ok(html.includes("NOT FOUND"));
  assert.ok(html.includes("C0-M000999"));
  assert.ok(!html.includes("undefined"));
});
