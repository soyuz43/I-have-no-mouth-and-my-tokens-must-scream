import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createRng,
  engineRng,
  seedAll,
  uiRng,
} from "../core/prng.js";

test("seeding engineRng with the same value repeats 100 draws", () => {
  seedAll(20261010);
  const firstSequence = Array.from({ length: 100 }, () => engineRng.next());

  seedAll(20261010);
  const secondSequence = Array.from({ length: 100 }, () => engineRng.next());

  assert.deepEqual(secondSequence, firstSequence);
  assert.ok(secondSequence.every((value) => value >= 0 && value < 1));
});

test("drawing from one stream does not advance another", () => {
  seedAll(931);
  const expectedEngineSequence = Array.from(
    { length: 12 },
    () => engineRng.next(),
  );

  seedAll(931);
  Array.from({ length: 100 }, () => uiRng.next());
  const actualEngineSequence = Array.from(
    { length: 12 },
    () => engineRng.next(),
  );

  assert.deepEqual(actualEngineSequence, expectedEngineSequence);
});

test("getState and setState resume a paused sequence", () => {
  const originalRng = createRng("pause-and-resume");
  Array.from({ length: 17 }, () => originalRng.next());
  const savedState = JSON.parse(JSON.stringify(originalRng.getState()));
  const expectedSequence = Array.from({ length: 25 }, () => originalRng.next());

  const resumedRng = createRng(0);
  resumedRng.setState(savedState);

  assert.deepEqual(
    Array.from({ length: 25 }, () => resumedRng.next()),
    expectedSequence,
  );
});

test("saving and restoring after five draws preserves the next five", () => {
  const seed = 719;
  const originalRng = createRng(seed);
  Array.from({ length: 5 }, () => originalRng.next());
  const savedState = originalRng.getState();
  const expectedSequence = Array.from({ length: 5 }, () => originalRng.next());

  const restoredRng = createRng(seed);
  restoredRng.setState(savedState);

  assert.deepEqual(
    Array.from({ length: 5 }, () => restoredRng.next()),
    expectedSequence,
  );
});
