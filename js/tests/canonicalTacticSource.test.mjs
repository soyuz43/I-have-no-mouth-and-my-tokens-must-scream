import assert from "node:assert/strict";
import test from "node:test";

import { G } from "../core/state.js";
import { EMBEDDED_TACTICS } from "../engine/tactics/embeddedTactics.js";
import { getAllTactics, getTacticByPath, rankTacticCandidates } from "../engine/tactics.js";

const INGESTED = [
  { path: "0. Weapons/ingested-a", title: "Ingested A", category: "C1", subcategory: "S1" },
  { path: "0. Weapons/ingested-b", title: "Ingested B", category: "C1", subcategory: "S2" }
];
const DERIVED = [
  { path: "__derived__/cycle_1-foo", title: "Derived Foo", category: "C2", subcategory: "S3" }
];

// Controlled fixture path that is guaranteed not in embedded set.
const INGESTED_ONLY_PATH = "0. Weapons/ingested-a";

test("getAllTactics preserves source order: ingested -> derived -> embedded", () => {
  const saved = G.vault;
  try {
    G.vault = { allTactics: [...INGESTED], derivedTactics: [...DERIVED], categories: {}, fileCount: 0 };
    const all = getAllTactics();
    // ingested first
    assert.equal(all[0].path, INGESTED[0].path);
    assert.equal(all[1].path, INGESTED[1].path);
    // derived after ingested, before embedded
    assert.equal(all[2].path, DERIVED[0].path);
    // embedded present at the tail
    const tail = all[all.length - 1];
    assert.equal(tail.path, EMBEDDED_TACTICS[EMBEDDED_TACTICS.length - 1].path);
  } finally {
    G.vault = saved;
  }
});

test("getAllTactics tolerates missing or empty source arrays", () => {
  const saved = G.vault;
  try {
    G.vault = { allTactics: [], derivedTactics: [], categories: {}, fileCount: 0 };
    assert.ok(Array.isArray(getAllTactics()));
    assert.equal(getAllTactics().length, EMBEDDED_TACTICS.length);

    G.vault = undefined;
    // Sanity guard: the production state always defines G.vault, but the accessor
    // must not throw if it is absent (defensive parity with existing inline merges).
    assert.ok(Array.isArray(getAllTactics()));
  } finally {
    G.vault = saved;
  }
});

test("getTacticByPath resolves from ingested, derived, and embedded", () => {
  const saved = G.vault;
  try {
    G.vault = { allTactics: [...INGESTED], derivedTactics: [...DERIVED], categories: {}, fileCount: 0 };
    assert.equal(getTacticByPath(INGESTED_ONLY_PATH).title, "Ingested A");
    assert.equal(getTacticByPath(DERIVED[0].path).title, "Derived Foo");
    const embeddedPath = EMBEDDED_TACTICS[0].path;
    assert.equal(getTacticByPath(embeddedPath).path, embeddedPath);

    // Case/whitespace insensitive, trailing/leading space trimmed.
    assert.equal(getTacticByPath("  " + INGESTED_ONLY_PATH + "  ").title, "Ingested A");

    // Unknown path resolves to null.
    assert.equal(getTacticByPath("does/not/exist"), null);
  } finally {
    G.vault = saved;
  }
});

test("getTacticByPath prefers ingested object on duplicate path", () => {
  const saved = G.vault;
  try {
    const dup = { path: INGESTED_ONLY_PATH, title: "Shadow Embedded" };
    G.vault = {
      allTactics: [...INGESTED],
      derivedTactics: [...DERIVED, dup],
      categories: {},
      fileCount: 0
    };
    // ingested wins over a same-path entry later in the merge
    assert.equal(getTacticByPath(INGESTED_ONLY_PATH).title, "Ingested A");
  } finally {
    G.vault = saved;
  }
});

test("rankTacticCandidates receives the full canonical source set", () => {
  const saved = G.vault;
  try {
    G.vault = { allTactics: [...INGESTED], derivedTactics: [...DERIVED], categories: {}, fileCount: 0 };
    const sim = { id: "TED", tacticHistory: [], relationships: {}, sanity: 50, hope: 50 };
    const ranked = rankTacticCandidates(sim, { limit: 100 });
    const paths = ranked.map((t) => t.path);
    assert.ok(paths.includes(INGESTED_ONLY_PATH));
    assert.ok(paths.includes(DERIVED[0].path));
    assert.ok(paths.includes(EMBEDDED_TACTICS[0].path));
  } finally {
    G.vault = saved;
  }
});

test("export-facing lookup no longer requires direct access to G.vault.allTactics", () => {
  // getTacticByPath is the single source-agnostic lookup the export layer now uses.
  // This test documents that a deployed embedded tactic resolves to a human-readable
  // label via getTacticByPath (previously the export only found ingested tactics).
  const saved = G.vault;
  try {
    G.vault = { allTactics: [], derivedTactics: [], categories: {}, fileCount: 0 };
    const embeddedPath = EMBEDDED_TACTICS[0].path;
    const resolved = getTacticByPath(embeddedPath);
    assert.ok(resolved && resolved.path === embeddedPath, "embedded path resolves via canonical lookup");
  } finally {
    G.vault = saved;
  }
});