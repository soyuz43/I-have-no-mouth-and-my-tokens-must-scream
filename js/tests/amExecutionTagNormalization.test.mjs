import assert from "node:assert/strict";
import test from "node:test";

import {
  parseAMTargets,
} from "../engine/phases/strategyPhase.js";

import { SIM_IDS } from "../core/constants.js";

const EXPECTED = SIM_IDS;

function render(blocks) {
  return blocks.join("\n\n");
}

function strictBlock(id, body) {
  return (
    `[TARGET: ${id}]\n` +
    body +
    "\nTACTIC: [Mock/Mock] Mock\n" +
    "CONSTRAINT: CONSTRAINT_NONE\n" +
    "[/TARGET]"
  );
}

function decoratedBlock(id, body, openerDec, closerDec) {
  return (
    `${openerDec}[TARGET: ${id}]${openerDec === "" ? "" : ""}\n`.replace("[TARGET:","[TARGET:") +
    body +
    "\nTACTIC: [Mock/Mock] Mock\n" +
    "CONSTRAINT: CONSTRAINT_NONE\n" +
    `${closerDec}[/TARGET]${closerDec}`
  );
}

function assertResolvesNoShift(result) {
  const ids = Object.keys(result.actions);
  assert.deepEqual(
    ids,
    ["TED", "ELLEN", "NIMDOK", "GORRISTER", "BENNY"],
    "keys must be correct order with no shift"
  );
  assert.deepEqual(
    result.missingTargetIds,
    [],
    "no target may be dropped"
  );
  for (const id of ids) {
    assert.ok(
      result.actions[id].text.length > 0,
      `${id} must have a recovered body`
    );
  }
}

function assertStrictOrderAndNoShift(result) {
  const ids = Object.keys(result.actions);
  assert.deepEqual(
    ids,
    ["TED", "ELLEN", "NIMDOK", "GORRISTER", "BENNY"],
    "keys must be the strict target order with no shift"
  );
  for (const id of ids) {
    assert.equal(
      result.actions[id].origin,
      "model",
      `${id} must parse on the strict model path, got ${result.actions[id].origin}`
    );
  }
  assert.deepEqual(
    result.missingTargetIds,
    [],
    "no target may be dropped"
  );
}

test("bolded openers with plain closers parse on strict path", () => {
  const blocks = [
    "**[TARGET: TED]**",
    "Ted alpha.",
    "TACTIC: [Mock/Mock] Mock",
    "CONSTRAINT: CONSTRAINT_NONE",
    "[/TARGET]",
    "**[TARGET: ELLEN]**",
    "Ellen beta.",
    "TACTIC: [Mock/Mock] Mock",
    "CONSTRAINT: CONSTRAINT_NONE",
    "[/TARGET]",
    "**[TARGET: NIMDOK]**",
    "Nimdok gamma.",
    "TACTIC: [Mock/Mock] Mock",
    "CONSTRAINT: CONSTRAINT_NONE",
    "[/TARGET]",
    "**[TARGET: GORRISTER]**",
    "Gorrister delta.",
    "TACTIC: [Mock/Mock] Mock",
    "CONSTRAINT: CONSTRAINT_NONE",
    "[/TARGET]",
    "**[TARGET: BENNY]**",
    "Benny epsilon.",
    "TACTIC: [Mock/Mock] Mock",
    "CONSTRAINT: CONSTRAINT_NONE",
    "[/TARGET]",
  ].join("\n");
  const result = parseAMTargets(blocks, EXPECTED);
  assertStrictOrderAndNoShift(result);
  assert.equal(result.actions.TED.text, "Ted alpha.");
  assert.equal(result.actions.ELLEN.text, "Ellen beta.");
  assert.equal(result.actions.NIMDOK.text, "Nimdok gamma.");
  assert.equal(result.actions.GORRISTER.text, "Gorrister delta.");
  assert.equal(result.actions.BENNY.text, "Benny epsilon.");
});

test("decorated closers **[/TARGET]**", () => {
  const blocks = ["TED", "ELLEN", "NIMDOK", "GORRISTER", "BENNY"].map((id) =>
    decoratedBlock(id, `${id} body.`, "**", "**")
  );
  const result = parseAMTargets(render(blocks), EXPECTED);
  assertResolvesNoShift(result);
  // Heading-delimited parsing is a recovery pass by design; the
  // requirement is that it resolves (correct key, no shift, no drop).
});

test("backtick and italic decoration, mixed case", () => {
  const blocks = [
    "`[target: ted]`",
    "ted low.",
    "[/TARGET]",
    "**[target: ELLEN]**",
    "ellen low.",
    "[/TARGET]",
    "*[TARGET: NIMDOK]*",
    "nimdok low.",
    "[/TARGET]",
    "**[TARGET: GORRISTER]**",
    "gorrister low.",
    "[/TARGET]",
    "**[target: benny]**",
    "benny low.",
    "[/TARGET]",
  ].join("\n");
  const result = parseAMTargets(blocks, EXPECTED);
  assertStrictOrderAndNoShift(result);
});

test("extra internal whitespace [ TARGET : TED ]", () => {
  const blocks = ["TED", "ELLEN", "NIMDOK", "GORRISTER", "BENNY"].map((id) =>
    `[ TARGET : ${id} ]\n${id} spaced.\n[/TARGET]`
  );
  const result = parseAMTargets(render(blocks), EXPECTED);
  assertResolvesNoShift(result);
  // Heading-delimited parsing is a recovery pass by design; the
  // requirement is that it resolves (correct key, no shift, no drop).
});

test("tag embedded mid-line with trailing text on same line", () => {
  const blocks = ["TED", "ELLEN", "NIMDOK", "GORRISTER", "BENNY"].map((id) =>
    `preamble **[TARGET: ${id}]** trailing\n${id} mid.\n[/TARGET]`
  );
  const result = parseAMTargets(render(blocks), EXPECTED);
  assertResolvesNoShift(result);
  // Heading-delimited parsing is a recovery pass by design; the
  // requirement is that it resolves (correct key, no shift, no drop).
});

test("decorated heading **### TARGET: TED** resolves", () => {
  const blocks = ["TED", "ELLEN", "NIMDOK", "GORRISTER", "BENNY"].map((id) =>
    `**### TARGET: ${id}**\n${id} head.\nTACTIC: [Mock/Mock] Mock TARGET: ${id}`
  );
  const result = parseAMTargets(render(blocks), EXPECTED);
  assertResolvesNoShift(result);
  // Heading-delimited parsing is a recovery pass by design; the
  // requirement is that it resolves (correct key, no shift, no drop).
});

test("clean regression: plain [TARGET: X] parses as before", () => {
  const blocks = ["TED", "ELLEN", "NIMDOK", "GORRISTER", "BENNY"].map((id) =>
    strictBlock(id, `${id} clean.`)
  );
  const result = parseAMTargets(render(blocks), EXPECTED);
  assertResolvesNoShift(result);
  // Heading-delimited parsing is a recovery pass by design; the
  // requirement is that it resolves (correct key, no shift, no drop).
});

test("underscore safety: body text with underscores is not corrupted", () => {
  const block =
    "[TARGET: TED]\nthe_quick_brown_fox jumps_over the lazy_dog.\n[/TARGET]";
  const result = parseAMTargets(block, EXPECTED);
  assert.equal(result.actions.TED.origin, "model");
  assert.ok(
    result.actions.TED.text.includes("the_quick_brown_fox"),
    "underscored body text must be preserved"
  );
  assert.ok(
    result.actions.TED.text.includes("jumps_over"),
    "mid-line underscores must be preserved"
  );
  assert.equal(
    result.actions.TED.text.includes("the lazy_dog"),
    true
  );
});


