#!/usr/bin/env node
"use strict";

const fs = require("fs");

const file = process.argv[2] || "dep.json";

let raw;
try {
  raw = fs.readFileSync(file, "utf8");
} catch (err) {
  console.error(`Could not read dependency JSON: ${file}`);
  console.error(err.message);
  process.exit(1);
}

const start = raw.indexOf("{");
if (start < 0) {
  console.error(`No JSON object found in ${file}.`);
  console.error("First 300 characters:");
  console.error(raw.slice(0, 300));
  process.exit(1);
}

let graph;
try {
  graph = JSON.parse(raw.slice(start));
} catch (err) {
  console.error(`Could not parse JSON from ${file}.`);
  console.error(err.message);
  process.exit(1);
}

const normalize = (p) => String(p).replace(/\\/g, "/");

const g = {};
for (const [key, deps] of Object.entries(graph)) {
  g[normalize(key)] = (deps || []).map(normalize);
}

const importedByAnyone = new Set();
for (const deps of Object.values(g)) {
  for (const dep of deps) {
    importedByAnyone.add(dep);
  }
}

const isEntryLike = (key) =>
  /(^|\/)main\.js$/.test(key) ||
  /(^|\/)scripts\//.test(key) ||
  /(^|\/)tests?\//.test(key) ||
  /(^|\/)research\//.test(key) ||
  /\.test\.(mjs|js)$/.test(key);

const productionOrphans = Object.keys(g).filter((key) => {
  return !importedByAnyone.has(key) && !isEntryLike(key);
});

console.log(`Production orphan candidates: ${productionOrphans.length}`);

if (productionOrphans.length === 0) {
  console.log("  none");
} else {
  for (const orphan of productionOrphans) {
    console.log(`  ${orphan}`);
  }
}