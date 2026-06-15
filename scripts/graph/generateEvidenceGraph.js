#!/usr/bin/env node

// scripts/graph/generateEvidenceGraph.js

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const PROJECT_ROOT = process.cwd();
const OUTPUT_ROOT = path.join(PROJECT_ROOT, "outputs", "graphs");

function timestamp() {
  const d = new Date();
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function walk(dir, results = []) {
  if (!fs.existsSync(dir)) return results;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if ([".git", "node_modules", "snapshots", "outputs"].includes(entry.name)) continue;
      walk(full, results);
    } else if (entry.isFile()) {
      results.push(full);
    }
  }

  return results;
}

function findNewestExport() {
  return walk(PROJECT_ROOT)
    .filter(p => /(^|[/\\])am_run.*\.json$/i.test(p))
    .map(p => ({ path: p, mtime: fs.statSync(p).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)[0]?.path || null;
}

function readExport(inputPath) {
  const resolved = inputPath ? path.resolve(inputPath) : findNewestExport();

  if (!resolved || !isFile(resolved)) {
    console.error("Error: no am_run*.json export found.");
    console.error("Use: make graph FILE=path/to/export.json");
    process.exit(1);
  }

  return {
    path: resolved,
    json: JSON.parse(fs.readFileSync(resolved, "utf8")),
  };
}

function esc(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, "\\n")
    .slice(0, 180);
}

function id(...parts) {
  return parts.join("_").replace(/[^a-zA-Z0-9_]/g, "_").replace(/^([0-9])/, "_$1");
}

function addNode(lines, nodeId, label, fill = "#222222") {
  lines.push(`  "${nodeId}" [label="${esc(label)}", fillcolor="${fill}"];`);
}

function addEdge(lines, from, to, label = "") {
  lines.push(`  "${from}" -> "${to}"${label ? ` [label="${esc(label)}"]` : ""};`);
}

function deltaLabel(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return String(n);
  return v > 0 ? `+${v}` : String(v);
}

function byAgent(rows = []) {
  const map = new Map();
  for (const row of rows) {
    const agent = row.agent || row.target;
    if (!agent) continue;
    if (!map.has(agent)) map.set(agent, []);
    map.get(agent).push(row);
  }
  return map;
}

function makeGraph(data, exportPath) {
  const cycle = data.cycle ?? "unknown";
  const streams = data.streams || {};

  const stateByAgent = byAgent(streams.state || []);
  const tacticsByAgent = byAgent(streams.tactics || []);
  const strategiesByAgent = byAgent(streams.strategies || []);
  const assessmentsByAgent = byAgent(streams.assessments || []);
  const constraintsByAgent = byAgent(streams.constraints || []);
  const dynamicsByAgent = byAgent(streams.dynamics || []);

  const agents = new Set([
    ...stateByAgent.keys(),
    ...tacticsByAgent.keys(),
    ...strategiesByAgent.keys(),
    ...assessmentsByAgent.keys(),
    ...constraintsByAgent.keys(),
    ...dynamicsByAgent.keys(),
  ]);

  const lines = [];

  lines.push("digraph EvidenceGraph {");
  lines.push('  graph [rankdir=LR, bgcolor="#111111", fontcolor="#eeeeee"];');
  lines.push('  node [shape=box, style="rounded,filled", fontname="Helvetica", fontsize=10, fillcolor="#222222", fontcolor="#eeeeee", color="#666666"];');
  lines.push('  edge [fontname="Helvetica", fontsize=9, color="#999999", fontcolor="#cccccc"];');
  lines.push("");

  const root = "run";
  addNode(lines, root, `AM Run\\nCycle: ${cycle}\\n${path.basename(exportPath)}`, "#333333");

  let edgeCount = 0;

  for (const agent of agents) {
    const state = stateByAgent.get(agent)?.[0];
    const simNode = id("sim", agent);

    addNode(
      lines,
      simNode,
      [
        agent,
        state ? `Suf:${Number(state.suffering).toFixed(1)} Hope:${Number(state.hope).toFixed(1)} San:${Number(state.sanity).toFixed(1)}` : null,
      ].filter(Boolean).join("\\n"),
      "#1f2937"
    );

    addEdge(lines, root, simNode, "agent");

    for (const strategy of strategiesByAgent.get(agent) || []) {
      const strategyNode = id("strategy", agent, strategy.cycle);
      addNode(
        lines,
        strategyNode,
        [
          "AM STRATEGY",
          strategy.objective,
          strategy.hypothesis ? `Hypothesis: ${strategy.hypothesis}` : null,
          strategy.confidence != null ? `Conf: ${strategy.confidence}` : null,
        ].filter(Boolean).join("\\n"),
        "#312e81"
      );
      addEdge(lines, strategyNode, simNode, "targets");
      edgeCount++;

      if (strategy.hypothesis_belief) {
        const beliefNode = id("belief", agent, strategy.hypothesis_belief);
        addNode(lines, beliefNode, `${agent}.${strategy.hypothesis_belief}`, "#3b224a");
        addEdge(lines, strategyNode, beliefNode, strategy.hypothesis_direction || "predicts");
      }
    }

    for (const tactic of tacticsByAgent.get(agent) || []) {
      const tacticNode = id("tactic", agent, tactic.tactic_id || tactic.tactic_title || tactic.cycle);
      addNode(
        lines,
        tacticNode,
        [
          "TACTIC",
          tactic.tactic_title || tactic.tactic_id,
          tactic.reported_hope_delta != null ? `reported H:${deltaLabel(tactic.reported_hope_delta)} San:${deltaLabel(tactic.reported_sanity_delta)} Suf:${deltaLabel(tactic.reported_suffering_delta)}` : null,
          tactic.effective_hope_delta != null ? `effective H:${deltaLabel(tactic.effective_hope_delta)} San:${deltaLabel(tactic.effective_sanity_delta)} Suf:${deltaLabel(tactic.effective_suffering_delta)}` : null,
        ].filter(Boolean).join("\\n"),
        "#4a321f"
      );
      addEdge(lines, tacticNode, simNode, "applied");
      edgeCount++;

      for (const stat of ["hope", "sanity", "suffering"]) {
        const val = tactic[`effective_${stat}_delta`];
        if (val == null || Number(val) === 0) continue;

        const statNode = id("stat", agent, stat);
        addNode(lines, statNode, `${agent}.${stat}`, "#0f3a4a");
        addEdge(lines, tacticNode, statNode, deltaLabel(val));
      }
    }

    for (const constraint of constraintsByAgent.get(agent) || []) {
      const constraintNode = id("constraint", agent, constraint.constraint_type, constraint.cycle);
      addNode(
        lines,
        constraintNode,
        [
          "CONSTRAINT",
          constraint.constraint_title || constraint.constraint_type,
          `Intensity: ${constraint.intensity ?? "?"}`,
          `Remaining: ${constraint.duration_remaining ?? "?"}`,
        ].join("\\n"),
        "#4a1f1f"
      );
      addEdge(lines, constraintNode, simNode, "physical context");
      edgeCount++;
    }

    for (const assessment of assessmentsByAgent.get(agent) || []) {
      const assessmentNode = id("assessment", agent, assessment.cycle);
      addNode(
        lines,
        assessmentNode,
        [
          "ASSESSMENT",
          assessment.decision ? `Decision: ${assessment.decision}` : null,
          assessment.evaluation_score != null ? `Score: ${assessment.evaluation_score}` : null,
          assessment.auto_success != null ? `Success: ${assessment.auto_success}` : null,
          assessment.confidence_before != null || assessment.confidence_after != null
            ? `Conf: ${assessment.confidence_before ?? "?"} → ${assessment.confidence_after ?? "?"}`
            : null,
        ].filter(Boolean).join("\\n"),
        "#14532d"
      );
      addEdge(lines, simNode, assessmentNode, "evaluated");
      edgeCount++;
    }

    for (const dyn of dynamicsByAgent.get(agent) || []) {
      const dynNode = id("dynamics", agent, dyn.cycle);
      addNode(
        lines,
        dynNode,
        [
          "DYNAMICS",
          `ΔHope ${deltaLabel(dyn.dHope_total)}`,
          `ΔSanity ${deltaLabel(dyn.dSanity_total)}`,
          `ΔSuffering ${deltaLabel(dyn.dSuffering_total)}`,
        ].join("\\n"),
        "#0f3a4a"
      );
      addEdge(lines, simNode, dynNode, "changed");
      edgeCount++;
    }
  }

  if (edgeCount === 0) {
    const emptyNode = "no_data";
    addNode(lines, emptyNode, "No graphable strategy/tactic/assessment data found.", "#4a1f1f");
    addEdge(lines, root, emptyNode, "empty");
  }

  lines.push("}");

  return { dot: lines.join("\n"), cycle, edgeCount };
}

function writeOutputs({ dot, cycle, edgeCount }, exportPath) {
  fs.mkdirSync(OUTPUT_ROOT, { recursive: true });

  const base = path.basename(exportPath, ".json").replace(/[^a-zA-Z0-9_-]/g, "_");
  const outDir = path.join(OUTPUT_ROOT, `${base}_cycle_${cycle}_${timestamp()}`);

  fs.mkdirSync(outDir, { recursive: true });

  const dotPath = path.join(outDir, "evidence_graph.dot");
  const svgPath = path.join(outDir, "evidence_graph.svg");
  const metaPath = path.join(outDir, "metadata.json");

  fs.writeFileSync(dotPath, dot, "utf8");
  fs.writeFileSync(
    metaPath,
    JSON.stringify({
      export: exportPath,
      cycle,
      edgeCount,
      createdAt: new Date().toISOString(),
      dot: dotPath,
      svg: svgPath,
    }, null, 2),
    "utf8"
  );

  let wroteSvg = false;

  try {
    execFileSync("dot", ["-Tsvg", dotPath, "-o", svgPath], { stdio: "inherit" });
    wroteSvg = true;
  } catch {}

  console.log("");
  console.log("Evidence graph generated");
  console.log("------------------------");
  console.log(`Export: ${exportPath}`);
  console.log(`Cycle:  ${cycle}`);
  console.log(`Edges:  ${edgeCount}`);
  console.log(`Output: ${outDir}`);
  console.log(`DOT:    ${dotPath}`);
  console.log(wroteSvg ? `SVG:    ${svgPath}` : "SVG:    skipped; Graphviz `dot` not found");
}

function main() {
  const inputArg = process.argv[2];
  const { path: exportPath, json } = readExport(inputArg);
  writeOutputs(makeGraph(json, exportPath), exportPath);
}

main();