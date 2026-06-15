#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const input = process.argv[2] || process.env.FILE;

if (!input) {
  console.error("Usage: make analyze FILE=/path/to/am_run.json");
  process.exit(1);
}

const file = path.resolve(input);
const data = JSON.parse(fs.readFileSync(file, "utf8"));
const streams = data.streams || {};
const cycle = data.cycle ?? "unknown";

const rows = name => Array.isArray(streams[name]) ? streams[name] : [];

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pct(v, digits = 1) {
  const n = num(v);
  return n === null ? "—" : `${n.toFixed(digits)}%`;
}

function signed(v, digits = 1) {
  const n = num(v);
  if (n === null) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(digits)}`;
}

function ratioPct(v) {
  const n = num(v);
  if (n === null) return "—";
  return `${(n * 100).toFixed(0)}%`;
}

function impactScore(t) {
  const hope = Math.abs(num(t.effective_hope_delta) || 0);
  const sanity = Math.abs(num(t.effective_sanity_delta) || 0);
  const suffering = Math.abs(num(t.effective_suffering_delta) || 0);
  return hope * 1.1 + sanity * 1.2 + suffering * 1.0;
}

function grade(score) {
  if (score >= 16) return "S";
  if (score >= 12) return "A";
  if (score >= 8) return "B";
  if (score >= 4) return "C";
  return "D";
}

function reliability(t) {
  const vals = [
    num(t.effectiveness_ratio_hope),
    num(t.effectiveness_ratio_sanity),
    num(t.effectiveness_ratio_suffering),
  ].filter(v => v !== null);

  if (!vals.length) return null;

  const avg = vals.reduce((a, b) => a + Math.abs(b), 0) / vals.length;
  return Math.min(2, avg);
}

function byAgent(rows) {
  const m = new Map();
  for (const r of rows) {
    const agent = r.agent || r.target;
    if (!agent) continue;
    if (!m.has(agent)) m.set(agent, []);
    m.get(agent).push(r);
  }
  return m;
}

const state = rows("state");
const dynamics = rows("dynamics");
const tactics = rows("tactics");
const strategies = rows("strategies");
const assessments = rows("assessments");

const stateByAgent = byAgent(state);
const dynByAgent = byAgent(dynamics);
const tacticByAgent = byAgent(tactics);
const stratByAgent = byAgent(strategies);
const assessByAgent = byAgent(assessments);

const agents = [...new Set([
  ...stateByAgent.keys(),
  ...dynByAgent.keys(),
  ...tacticByAgent.keys(),
  ...stratByAgent.keys(),
  ...assessByAgent.keys(),
])];

console.log("========================================");
console.log("AM TORMENT FORENSICS");
console.log(`Cycle ${cycle}`);
console.log("========================================\n");

for (const agent of agents) {
  const s = stateByAgent.get(agent)?.[0];
  const d = dynByAgent.get(agent)?.[0];
  const ts = tacticByAgent.get(agent) || [];
  const st = stratByAgent.get(agent)?.[0];
  const as = assessByAgent.get(agent)?.[0];

  console.log(agent);
  console.log("----------------------------------------");

  if (s) {
    console.log(`State: Hope ${pct(s.hope)} | Sanity ${pct(s.sanity)} | Suffering ${pct(s.suffering)}`);
  }

  if (d) {
    const totalImpact =
      Math.abs(num(d.dHope_total) || 0) +
      Math.abs(num(d.dSanity_total) || 0) +
      Math.abs(num(d.dSuffering_total) || 0);

    console.log(`Cycle Impact: ${totalImpact.toFixed(1)} pts`);
    console.log(`  Hope ${signed(d.dHope_total)} | Sanity ${signed(d.dSanity_total)} | Suffering ${signed(d.dSuffering_total)}`);
  }

  if (st) {
    console.log("\nAM Theory:");
    console.log(`  Target belief: ${st.hypothesis_belief || "unknown"} ${st.hypothesis_direction || ""}`.trim());
    console.log(`  Hypothesis: ${st.hypothesis || "—"}`);
  }

  for (const t of ts) {
    const score = impactScore(t);
    const rel = reliability(t);

    console.log("\nTactic Performance:");
    console.log(`  ${t.tactic_title || t.tactic_id || "unknown"}`);
    console.log(`  Impact Grade: ${grade(score)} (${score.toFixed(1)} weighted pts)`);
    console.log(`  Efficiency: Hope ${ratioPct(t.effectiveness_ratio_hope)} | Sanity ${ratioPct(t.effectiveness_ratio_sanity)} | Suffering ${ratioPct(t.effectiveness_ratio_suffering)}`);
    console.log(`  Prediction vs Outcome:`);
    console.log(`    Hope ${signed(t.reported_hope_delta)} → ${signed(t.effective_hope_delta)}`);
    console.log(`    Sanity ${signed(t.reported_sanity_delta)} → ${signed(t.effective_sanity_delta)}`);
    console.log(`    Suffering ${signed(t.reported_suffering_delta)} → ${signed(t.effective_suffering_delta)}`);
    console.log(`  Reliability Index: ${rel === null ? "—" : `${(rel * 50).toFixed(0)}/100`}`);
  }

  if (as) {
    console.log("\nAssessment:");
    console.log(`  Decision: ${as.decision || "—"}`);
    console.log(`  Evaluation Score: ${num(as.evaluation_score) === null ? "—" : pct(Number(as.evaluation_score) * 100)}`);
    console.log(`  Auto Success: ${as.auto_success ?? "—"}`);
    console.log(`  Confidence: ${pct((num(as.confidence_before) ?? 0) * 100)} → ${pct((num(as.confidence_after) ?? 0) * 100)}`);
  }

  console.log("");
}

const grouped = new Map();

for (const t of tactics) {
  const name = t.tactic_title || t.tactic_id || "unknown";
  if (!grouped.has(name)) grouped.set(name, []);
  grouped.get(name).push(t);
}

const leaderboard = [...grouped.entries()]
  .map(([name, list]) => {
    const avgImpact = list.reduce((s, t) => s + impactScore(t), 0) / list.length;
    const avgSuffering = list.reduce((s, t) => s + (num(t.effective_suffering_delta) || 0), 0) / list.length;
    const avgHopeDamage = list.reduce((s, t) => s + -(num(t.effective_hope_delta) || 0), 0) / list.length;
    const avgSanityDamage = list.reduce((s, t) => s + -(num(t.effective_sanity_delta) || 0), 0) / list.length;

    return { name, attempts: list.length, avgImpact, avgSuffering, avgHopeDamage, avgSanityDamage };
  })
  .sort((a, b) => b.avgImpact - a.avgImpact);

console.log("TACTIC LEADERBOARD");
console.log("----------------------------------------");

if (!leaderboard.length) {
  console.log("None");
} else {
  leaderboard.slice(0, 10).forEach((t, i) => {
    console.log(`${i + 1}. ${t.name}`);
    console.log(`   Grade: ${grade(t.avgImpact)} | Avg Impact: ${t.avgImpact.toFixed(1)} weighted pts`);
    console.log(`   Attempts: ${t.attempts}`);
    console.log(`   Avg suffering gain: ${signed(t.avgSuffering)}`);
    console.log(`   Avg hope damage: ${signed(t.avgHopeDamage)}`);
    console.log(`   Avg sanity damage: ${signed(t.avgSanityDamage)}`);
  });
}
