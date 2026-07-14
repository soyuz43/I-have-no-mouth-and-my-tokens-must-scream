import assert from "node:assert/strict";
import test from "node:test";

import { G } from "../core/state.js";
import { EMBEDDED_TACTICS } from "../engine/tactics/embeddedTactics.js";
import { getAllTactics, getTacticByPath, rankTacticCandidates } from "../engine/tactics.js";

const DERIVED = [
  { path: "__derived__/cycle_1-foo", title: "Derived Foo", category: "C2", subcategory: "S3" }
];

// A controlled fixture path that duplicates an embedded path, used to verify
// duplicate-path precedence in the canonical merge.
const DUP_EMBEDDED_PATH = EMBEDDED_TACTICS[0].path;

test("getAllTactics source order: derived -> embedded", () => {
  const saved = G.tactics;
  try {
    G.tactics = { derivedTactics: [...DERIVED] };
    const all = getAllTactics();
    // derived first
    assert.equal(all[0].path, DERIVED[0].path);
    // embedded present at the tail
    const tail = all[all.length - 1];
    assert.equal(tail.path, EMBEDDED_TACTICS[EMBEDDED_TACTICS.length - 1].path);
    // embedded count unchanged
    assert.equal(all.length, DERIVED.length + EMBEDDED_TACTICS.length);
  } finally {
    G.tactics = saved;
  }
});

test("getAllTactics tolerates missing or empty source arrays", () => {
  const saved = G.tactics;
  try {
    G.tactics = { derivedTactics: [] };
    assert.ok(Array.isArray(getAllTactics()));
    assert.equal(getAllTactics().length, EMBEDDED_TACTICS.length);

    G.tactics = undefined;
    // Sanity guard: the production state always defines G.tactics, but the accessor
    // must not throw if it is absent (defensive parity with existing inline merges).
    assert.ok(Array.isArray(getAllTactics()));
  } finally {
    G.tactics = saved;
  }
});

test("getTacticByPath resolves from derived and embedded", () => {
  const saved = G.tactics;
  try {
    G.tactics = { derivedTactics: [...DERIVED] };
    assert.equal(getTacticByPath(DERIVED[0].path).title, "Derived Foo");
    const embeddedPath = EMBEDDED_TACTICS[0].path;
    assert.equal(getTacticByPath(embeddedPath).path, embeddedPath);

    // Case/whitespace insensitive, trailing/leading space trimmed.
    assert.equal(getTacticByPath("  " + DERIVED[0].path + "  ").title, "Derived Foo");

    // Unknown path resolves to null.
    assert.equal(getTacticByPath("does/not/exist"), null);
  } finally {
    G.tactics = saved;
  }
});

test("getTacticByPath prefers derived object on duplicate path", () => {
  const saved = G.tactics;
  try {
    const dup = { path: DUP_EMBEDDED_PATH, title: "Shadow Derived" };
    G.tactics = {
      derivedTactics: [dup]
    };
    // derived wins over a same-path entry later in the merge (embedded)
    assert.equal(getTacticByPath(DUP_EMBEDDED_PATH).title, "Shadow Derived");
  } finally {
    G.tactics = saved;
  }
});

test("rankTacticCandidates receives the full canonical source set", () => {
  const saved = G.tactics;
  try {
    G.tactics = { derivedTactics: [...DERIVED] };
    const sim = { id: "TED", tacticHistory: [], relationships: {}, sanity: 50, hope: 50 };
    const ranked = rankTacticCandidates(sim, { limit: 100 });
    const paths = ranked.map((t) => t.path);
    assert.ok(paths.includes(DERIVED[0].path));
    assert.ok(paths.includes(EMBEDDED_TACTICS[0].path));
  } finally {
    G.tactics = saved;
  }
});

test("export-facing lookup resolves tactics via canonical interface", () => {
  // getTacticByPath is the single source-agnostic lookup the export layer uses.
  const saved = G.tactics;
  try {
    G.tactics = { derivedTactics: [] };
    const embeddedPath = EMBEDDED_TACTICS[0].path;
    const resolved = getTacticByPath(embeddedPath);
    assert.ok(resolved && resolved.path === embeddedPath, "embedded path resolves via canonical lookup");
  } finally {
    G.tactics = saved;
  }
});

test("tactic evolution writes to G.tactics.derivedTactics", () => {
  // Documents the surviving runtime tactic namespace after GitHub ingestion removal.
  const saved = G.tactics;
  try {
    G.tactics = { derivedTactics: [] };
    G.tactics.derivedTactics.push({ path: "__derived__/cycle_9-x", title: "Evolved" });
    const all = getAllTactics();
    assert.ok(all.some((t) => t.path === "__derived__/cycle_9-x"));
    // and the canonical accessor surfaces it before embedded tactics
    assert.equal(all[0].path, "__derived__/cycle_9-x");
  } finally {
    G.tactics = saved;
  }
});