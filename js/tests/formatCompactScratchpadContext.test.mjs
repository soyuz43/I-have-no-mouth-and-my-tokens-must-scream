import { strict as assert } from "node:assert";
import test from "node:test";

import {
  formatCompactScratchpadContext,
  formatCompactScratchpadContextWithSections,
} from "../prompts/utils/formatCompactScratchpadContext.js";
import { logScratchpadContextInjection } from "../prompts/utils/scratchpadContextLog.js";

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
        id: 1,
        about: "AM",
        prediction: "intervention",
        confidence: 0.7,
        resolved: false,
        expired: false,
      },
      {
        id: 2,
        about: "TED",
        prediction: "betrayal",
        confidence: 0.4,
        resolved: true,
        expired: false,
      },
    ],
    unresolvedQuestions: [
      {
        id: 10,
        about: "BENNY",
        question: "Is he lying?",
        priority: "high",
        resolved: false,
      },
      {
        id: 11,
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

test("WithSections returns identical text to the legacy entry point", () => {
  const sim = makeSim();
  const opts = { otherPrisonerIds: ["ELLEN", "TED"] };
  const legacy = formatCompactScratchpadContext(sim, opts);
  const { text, sections } = formatCompactScratchpadContextWithSections(sim, opts);
  assert.equal(text, legacy);
  assert.ok(Array.isArray(sections));
});

test("WithSections reports only rendered person-model fields (targetId)", () => {
  const { sections } = formatCompactScratchpadContextWithSections(makeSim(), {
    targetId: "ELLEN",
  });
  const person = sections.find(
    (s) => s.section === "personModel" && s.targetId === "ELLEN"
  );
  assert.ok(person, "expected an ELLEN personModel section");
  assert.deepEqual(person.fields.sort(), [
    "perceivedGoal",
    "perceivedThreatFromMe",
    "perceivedViewOfMe",
    "predictability",
  ]);
  assert.ok(!person.fields.includes("perceivedTrustInMe"));
});

test("WithSections reports channel scopes and rendered field keys", () => {
  const { sections } = formatCompactScratchpadContextWithSections(makeSim(), {
    targetId: "ELLEN",
  });
  const publicChannel = sections.find(
    (s) => s.section === "channelBeliefs" && s.scope === "public"
  );
  const privateChannel = sections.find(
    (s) => s.section === "channelBeliefs" && s.scope === "private"
  );
  assert.ok(publicChannel);
  assert.deepEqual(publicChannel.fields, ["visibleToAM"]);
  assert.ok(privateChannel);
  assert.deepEqual(privateChannel.fields, ["visibleToAM"]);
});

test("WithSections reports predictions and questions counts/ids with filtering", () => {
  const { sections } = formatCompactScratchpadContextWithSections(makeSim(), {
    targetId: "ELLEN",
  });
  const predictions = sections.find((s) => s.section === "predictions");
  const questions = sections.find((s) => s.section === "questions");
  assert.ok(predictions);
  assert.equal(predictions.count, 1);
  assert.deepEqual(predictions.ids, [1]);
  assert.ok(questions);
  assert.equal(questions.count, 1);
  assert.deepEqual(questions.ids, [10]);
});

test("WithSections is empty for uninitialized scratchpad", () => {
  const sim = makeSim();
  sim.scratchpad.initialized = false;
  const { text, sections } = formatCompactScratchpadContextWithSections(sim);
  assert.equal(text, "");
  assert.deepEqual(sections, []);
});

test("WithSections is empty when nothing renders", () => {
  const sim = makeSim();
  sim.scratchpad.initialized = true;
  sim.scratchpad.hypothesesAboutOthers = {};
  sim.scratchpad.informationModel = { channels: { public: {}, private: {} } };
  sim.scratchpad.predictions = [];
  sim.scratchpad.unresolvedQuestions = [];
  const { text, sections } = formatCompactScratchpadContextWithSections(sim, {
    targetId: "ELLEN",
  });
  assert.equal(text, "");
  assert.deepEqual(sections, []);
});

test("logger is a no-op when disabled", () => {
  let logged = null;
  const spy = (record) => {
    logged = record;
  };
  const original = console.debug;
  console.debug = spy;
  try {
    logScratchpadContextInjection({
      callType: "reply",
      simId: "TED",
      targetId: "ELLEN",
      sections: [{ section: "personModel", targetId: "ELLEN", fields: ["perceivedGoal"] }],
      isEnabled: () => false,
    });
  } finally {
    console.debug = original;
  }
  assert.equal(logged, null);
});

test("logger writes a structured record when enabled", () => {
  let captured = null;
  const spy = (prefix, record) => {
    captured = { prefix, record };
  };
  const original = console.debug;
  console.debug = spy;
  try {
    const sections = [
      { section: "personModel", targetId: "ELLEN", fields: ["perceivedGoal"] },
      { section: "channelBeliefs", scope: "public", fields: ["visibleToAM"] },
    ];
    logScratchpadContextInjection({
      callType: "outreach",
      simId: "TED",
      targetId: "all",
      sections,
      isEnabled: () => true,
    });
  } finally {
    console.debug = original;
  }
  assert.ok(captured, "expected a console.debug call");
  assert.equal(captured.record.callType, "outreach");
  assert.equal(captured.record.simId, "TED");
  assert.equal(captured.record.targetId, "all");
  assert.deepEqual(captured.record.sections, [
    { section: "personModel", targetId: "ELLEN", fields: ["perceivedGoal"] },
    { section: "channelBeliefs", scope: "public", fields: ["visibleToAM"] },
  ]);
});

test("logger honors an explicit disabled override even if global would enable", () => {
  let logged = false;
  const spy = () => {
    logged = true;
  };
  const original = console.debug;
  console.debug = spy;
  try {
    // Simulate global G.DEBUG_PROMPTS = true, but override disables.
    globalThis.G = { DEBUG_PROMPTS: true };
    logScratchpadContextInjection({
      callType: "reply",
      simId: "TED",
      targetId: "ELLEN",
      sections: [],
      isEnabled: () => false,
    });
  } finally {
    console.debug = original;
    delete globalThis.G;
  }
  assert.equal(logged, false);
});
