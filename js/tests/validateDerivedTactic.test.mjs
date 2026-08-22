import assert from "node:assert/strict";
import test from "node:test";

import {
  validateAndNormalizeDerivedTactic,
  purgeInvalidDerivedTactics,
} from "../engine/tactics/validateDerivedTactic.js";

const BASE = {
  title: "Cognitive Warfare: Hollow Compliance",
  category: "Cognitive Warfare",
  subcategory: "Manufactured Compliance",
  objective: "Erode autonomy by rewarding only obedience.",
  phases: {
    initial: {
      purpose: "Establish a conditional reward loop for compliance.",
      instruction:
        "When the target obeys, grant a small relief; when they resist, withdraw it.",
      expectedSignals: ["compliance-seeking language"],
      advanceWhen: "Target begins modulating behavior for approval.",
      minExecutions: 1,
      maxExecutions: 2,
    },
  },
  finishWhen: "Target treats compliance as self-evidently correct.",
  abandonWhen: "Target refuses all reward conditioning.",
};

test("valid single-phase tactic normalizes with server fields", () => {
  const res = validateAndNormalizeDerivedTactic(BASE, { cycle: 7 });
  assert.equal(res.ok, true);
  const t = res.tactic;
  assert.equal(t.path, "__derived__/cycle_7_cognitive-warfare-hollow-compliance");
  assert.equal(t.initialPhaseId, "initial");
  assert.equal(t.phases.initial.purpose, BASE.phases.initial.purpose);
  assert.equal(t.phases.initial.instruction, BASE.phases.initial.instruction);
  assert.equal(t.isEmbedded, false);
  assert.equal(t.discoveredCycle, 7);
  assert.equal(t.expiresCycle, 22);
  assert.deepEqual(t.phases.initial.expectedSignals, ["compliance-seeking language"]);
});

test("rejects non-object input", () => {
  assert.equal(validateAndNormalizeDerivedTactic(null).ok, false);
  assert.equal(validateAndNormalizeDerivedTactic("x").ok, false);
  assert.equal(validateAndNormalizeDerivedTactic([]).ok, false);
});

test("rejects missing title/category/subcategory/objective", () => {
  for (const key of ["title", "category", "subcategory", "objective"]) {
    const clone = JSON.parse(JSON.stringify(BASE));
    delete clone[key];
    assert.equal(
      validateAndNormalizeDerivedTactic(clone).ok,
      false,
      `should reject missing ${key}`
    );
  }
});

test("rejects missing or multi-phase phases", () => {
  const none = JSON.parse(JSON.stringify(BASE));
  delete none.phases;
  assert.equal(validateAndNormalizeDerivedTactic(none).ok, false);

  const multi = JSON.parse(JSON.stringify(BASE));
  multi.phases.second = { purpose: "p", instruction: "i" };
  assert.equal(validateAndNormalizeDerivedTactic(multi).ok, false);
});

test("rejects phase missing purpose or instruction", () => {
  const noPurpose = JSON.parse(JSON.stringify(BASE));
  delete noPurpose.phases.initial.purpose;
  assert.equal(validateAndNormalizeDerivedTactic(noPurpose).ok, false);

  const noInstruction = JSON.parse(JSON.stringify(BASE));
  delete noInstruction.phases.initial.instruction;
  assert.equal(validateAndNormalizeDerivedTactic(noInstruction).ok, false);
});

test("old flat-format tactic (content/OBJECTIVE) is rejected", () => {
  const legacy = {
    path: "__derived__/cycle_1-x",
    title: "Legacy Tactics",
    category: "Cognitive Warfare",
    subcategory: "Legacy",
    content: "TITLE: ...",
  };
  assert.equal(validateAndNormalizeDerivedTactic(legacy).ok, false);
});

test("optional fields receive defaults", () => {
  const minimal = {
    title: "Identity Dissolution: Nameless",
    category: "Identity Dissolution",
    subcategory: "Anonymity",
    objective: "Strip the target\x27s sense of self.",
    phases: {
      initial: {
        purpose: "Begin erasure.",
        instruction: "Avoid using the target\x27s name.",
      },
    },
  };
  const res = validateAndNormalizeDerivedTactic(minimal, { cycle: 3 });
  assert.equal(res.ok, true);
  assert.deepEqual(res.tactic.phases.initial.expectedSignals, []);
  assert.equal(res.tactic.phases.initial.advanceWhen, "");
  assert.equal(res.tactic.phases.initial.minExecutions, 1);
  assert.equal(res.tactic.phases.initial.maxExecutions, 2);
  assert.equal(res.tactic.finishWhen, "");
  assert.equal(res.tactic.abandonWhen, "");
});

test("maxExecutions never drops below minExecutions", () => {
  const t = JSON.parse(JSON.stringify(BASE));
  t.phases.initial.minExecutions = 5;
  t.phases.initial.maxExecutions = 1;
  const res = validateAndNormalizeDerivedTactic(t, { cycle: 1 });
  assert.equal(res.ok, true);
  assert.equal(res.tactic.phases.initial.maxExecutions, 5);
});

test("purgeInvalidDerivedTactics drops malformed, keeps valid", () => {
  const G = {
    tactics: {
      derivedTactics: [
        // valid
        validateAndNormalizeDerivedTactic(BASE, { cycle: 1 }).tactic,
        // legacy old-format (no phases) -> invalid
        {
          path: "__derived__/cycle_0-legacy",
          title: "Legacy",
          category: "Cognitive Warfare",
          subcategory: "Legacy",
        },
      ],
    },
  };
  const removed = purgeInvalidDerivedTactics(G);
  assert.equal(removed, 1);
  assert.equal(G.tactics.derivedTactics.length, 1);
  assert.equal(G.tactics.derivedTactics[0].title, BASE.title);
});

test("purgeInvalidDerivedTactics returns 0 when no derived array", () => {
  assert.equal(purgeInvalidDerivedTactics({ tactics: {} }), 0);
});
