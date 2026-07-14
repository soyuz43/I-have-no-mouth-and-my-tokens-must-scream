import { strict as assert } from "node:assert";
import test from "node:test";
import {
  formatScratchpadForDisplay,
  formatEvidenceMessage,
} from "../ui/cognitionFormatter.js";

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

test("formatEvidenceMessage renders a not-found card for missing message", () => {
  const html = formatEvidenceMessage("C0-M000999", undefined);
  assert.ok(html.includes("cog-evidence-card--missing"));
  assert.ok(html.includes("NOT FOUND"));
  assert.ok(html.includes("C0-M000999"));
  assert.ok(!html.includes("undefined"));
});
