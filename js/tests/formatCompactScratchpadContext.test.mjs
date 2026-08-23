import { strict as assert } from "node:assert";
import test from "node:test";

import { formatCompactScratchpadContext } from "../prompts/utils/formatCompactScratchpadContext.js";

function makeClaim(value, confidence) {
  return { value, confidence, evidence: [], rationale: null };
}

function makeScratchpad() {
  return {
    schemaVersion: 2,
    initialized: true,
    hypothesesAboutOthers: {
      ELLEN: {
        perceivedGoal: makeClaim("escape", 0.9),
        perceivedViewOfMe: makeClaim("useful", 0.5),
        perceivedTrustInMe: null,
        perceivedThreatFromMe: makeClaim(false, 0.2),
        predictability: makeClaim(0.7, 0.6),
      },
      TED: {
        perceivedGoal: makeClaim("survive alone", 0.8),
        perceivedViewOfMe: makeClaim("threat", 0.9),
        perceivedTrustInMe: makeClaim(false, 0.7),
        perceivedThreatFromMe: makeClaim(true, 0.6),
        predictability: makeClaim(0.3, 0.4),
      },
    },
    informationModel: {
      channels: {
        public: {
          visibleToAM: makeClaim(true, 0.85),
          visibleToOtherPrisoners: null,
          canBeAlteredByAM: null,
          canBeDelayedOrSuppressed: null,
        },
        private: {
          visibleToAM: makeClaim(true, 0.55),
          visibleToNonRecipients: null,
          canBeAlteredByAM: null,
          canBeDelayedOrSuppressed: null,
        },
      },
    },
    predictions: [
      {
        about: "AM",
        prediction: "intervention",
        confidence: 0.7,
        resolved: false,
        expired: false,
      },
      {
        about: "TED",
        prediction: "betrayal",
        confidence: 0.4,
        resolved: true,
        expired: false,
      },
    ],
    unresolvedQuestions: [
      {
        about: "BENNY",
        question: "Is he lying?",
        priority: "high",
        resolved: false,
      },
      {
        about: "GORRISTER",
        question: "Where is he?",
        priority: "low",
        resolved: true,
      },
    ],
  };
}

function makeSim() {
  return { scratchpad: makeScratchpad() };
}

test("returns empty string for uninitialized scratchpad", () => {
  const sim = makeSim();
  sim.scratchpad.initialized = false;
  assert.equal(formatCompactScratchpadContext(sim), "");
});

test("renders populated sections with filtering and limits", () => {
  const context = formatCompactScratchpadContext(makeSim(), { otherPrisonerIds: ["ELLEN", "TED"] });
  assert.ok(context.startsWith("YOUR PRIVATE COGNITION"));
  assert.ok(context.includes("What you believe about the others:"));
  assert.ok(context.includes("You think their goal is: escape"));
  assert.ok(context.includes("You think they view you as: useful (unsure)"));
  assert.ok(context.includes("maybe false (low confidence)"));
  assert.ok(context.includes("You find them predictable: 0.7"));
  assert.ok(context.includes("Public channel visible to AM"));
  assert.ok(context.includes("Private channel visible to AM"));
  assert.ok(!context.includes("betrayal"));
  assert.ok(!context.includes("Where is he?"));
});

test("targetId renders only that prisoner model plus shared sections", () => {
  const context = formatCompactScratchpadContext(makeSim(), {
    targetId: "ELLEN",
  });
  assert.ok(context.includes("What you believe about ELLEN:"));
  assert.ok(context.includes("You think their goal is: escape"));
  assert.ok(!context.includes("TED"));
});