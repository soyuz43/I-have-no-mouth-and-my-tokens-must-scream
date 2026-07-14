// js/ui/export.js
//
// Session Export + Modal Controls
//
// Responsibilities:
// 1. Toggle export menu
// 2. Show session analysis modal
// 3. Generate session reports (JSON / TXT / MD)
// 4. Export tactic heatmaps
// 5. Download artifacts

import { G } from "../core/state.js";
import { SIM_IDS } from "../core/constants.js";
import { getTacticByPath } from "../engine/tactics.js";

/* ============================================================
   EXPORT MENU
   ============================================================ */

export function toggleExportMenu() {
  const m = document.getElementById("export-menu");
  if (!m) return;

  m.style.display = m.style.display === "none" ? "block" : "none";
}

/* ============================================================
   SESSION MODAL CONTROL
   ============================================================ */

export function openSessionModal() {
  const totalEntries = SIM_IDS.reduce(
    (s, id) => s + G.journals[id].length,
    0
  );

  const tacticCounts = computeTacticFrequency();

  document.getElementById("sm-meta").textContent =
    `Cycle ${G.cycle} · ${totalEntries} total journal entries · ${G.backend.toUpperCase()}`;

  // Stats
  document.getElementById("sm-stats").innerHTML = `
    <div class="sm-stat"><div class="sm-stat-val">${G.cycle}</div><div class="sm-stat-lbl">CYCLES</div></div>
    <div class="sm-stat"><div class="sm-stat-val">${totalEntries}</div><div class="sm-stat-lbl">JOURNAL ENTRIES</div></div>
    <div class="sm-stat"><div class="sm-stat-val">${G.transmissionLog.length}</div><div class="sm-stat-lbl">TRANSMISSIONS</div></div>
    <div class="sm-stat"><div class="sm-stat-val">${G.vault.allTactics.length}</div><div class="sm-stat-lbl">VAULT TACTICS</div></div>
    <div class="sm-stat"><div class="sm-stat-val">${G.interSimLog.length}</div><div class="sm-stat-lbl">INTER-SIM MSGS</div></div>
    <div class="sm-stat"><div class="sm-stat-val">${Object.values(tacticCounts).reduce((a,b)=>a+b,0)}</div><div class="sm-stat-lbl">TACTICS DEPLOYED</div></div>
  `;

  // Sim states
  document.getElementById("sm-sim-states").innerHTML = SIM_IDS.map((id) => {
    const sim = G.sims[id];

    return `
      <div class="sm-sim-row" style="--sc:${sim.color}">
        <span class="sm-sim-name" style="color:${sim.color}">
          ${sim.name}
        </span>
        <span class="sm-sim-stats">
          SUFFERING:${sim.suffering}% HOPE:${sim.hope}% SANITY:${sim.sanity}%
          · ${G.journals[id].length} ENTRIES · ${sim.status}
        </span>
      </div>
    `;
  }).join("");

  renderTopTactics(tacticCounts);

  document.getElementById("session-modal").classList.add("open");
}

export function closeSessionModal() {
  document.getElementById("session-modal").classList.remove("open");
}

/* ============================================================
   SESSION EXPORT ENTRY POINT
   ============================================================ */

export function exportSession(fmt) {
  const menu = document.getElementById("export-menu");
  if (menu) menu.style.display = "none";

  openSessionModal();

  setTimeout(() => downloadSession(fmt), 100);
}

/* ============================================================
   SESSION DOWNLOAD
   ============================================================ */

export function downloadSession(fmt) {

  const ts = new Date().toISOString().slice(0,19).replace(/[:.]/g,"-");
  const filename = `AM_session_cycle${G.cycle}_${ts}.${fmt}`;

  const tacticCounts = computeTacticFrequency();

  if (fmt === "json") {

    const payload = {

      meta: {
        exportedAt: new Date().toISOString(),
        cycles: G.cycle,
        backend: G.backend,
        models: G.models,
        vault: {
          repo: G.repo,
          tacticCount: G.vault.allTactics.length
        }
      },

      simStates: Object.fromEntries(
        SIM_IDS.map(id => {
          const s = G.sims[id];

          return [id,{
            suffering: s.suffering,
            hope: s.hope,
            sanity: s.sanity,
            status: s.status,
            tacticCount: s.tacticHistory.length,
            model: G.models[id]
          }];
        })
      ),

      journals: Object.fromEntries(
        SIM_IDS.map(id => [id,G.journals[id]])
      ),

      tacticHistory: Object.fromEntries(
        SIM_IDS.map(id => [id,G.sims[id].tacticHistory])
      ),

      interSimLog: G.interSimLog,
      transmissionLog: G.transmissionLog,

      amScratchpad:
        document.getElementById("am-scratch")?.value || ""

    };

    dl(filename,JSON.stringify(payload,null,2),"application/json");
    return;
  }

  /* ===============================
     TEXT / MARKDOWN EXPORT
  =============================== */

  let out = "";
  const hr = "═".repeat(80);

  out += `AM TORMENT ENGINE — SESSION REPORT\n${hr}\n`;
  out += `Date: ${new Date().toISOString()}\n`;
  out += `Cycles: ${G.cycle} | Backend: ${G.backend.toUpperCase()} | Vault: ${G.repo}\n\n`;

  /* --- Final sim states --- */

  out += `SIMULATION FINAL STATES\n${hr}\n`;

  SIM_IDS.forEach(id => {

    const s = G.sims[id];

    out += `${s.name} [${G.models[id]}]\n`;
    out += `  Suffering:${s.suffering}% Hope:${s.hope}% Sanity:${s.sanity}% Status:${s.status}\n`;
    out += `  Entries:${G.journals[id].length} Tactics deployed:${s.tacticHistory.length}\n\n`;

  });

  /* --- tactic frequency --- */

  const sorted = Object.entries(tacticCounts)
    .sort((a,b)=>b[1]-a[1]);

  if (sorted.length) {

    out += `TACTIC FREQUENCY\n${hr}\n`;

    sorted.forEach(([path,count]) => {

      const t = getTacticByPath(path);

      if (t)
        out += `x${count} [${t.category}/${t.subcategory}] ${t.title}\n`;

    });

    out += "\n";
  }

  /* --- scratchpad --- */

  out += `AM SCRATCHPAD\n${hr}\n`;
  out += `${document.getElementById("am-scratch")?.value || "(empty)"}\n\n`;

  /* --- inter-sim log --- */

  if (G.interSimLog.length) {

    out += `INTER-SIM COMMUNICATIONS\n${hr}\n`;

    G.interSimLog.forEach(e => {
      out += `[Cycle ${e.cycle}] ${e.from} → ${e.to.join(",")} : "${e.text}"\n`;
    });

    out += "\n";
  }

  /* --- transmission log --- */

  out += `TRANSMISSION LOG\n${hr}\n`;

  G.transmissionLog.forEach(e => {

    out += `[CYCLE ${e.cycle}] ${e.speaker}`;

    if (e.tactic)
      out += ` (${e.tactic})`;

    out += `\n${e.body}\n\n`;

  });

  dl(filename,out,"text/plain");
}

/* ============================================================
   TACTIC HEATMAP EXPORT
   ============================================================ */

export function exportTacticHeatmap() {

  const tacticCounts = computeTacticFrequency();
  const tacticSimMap = {};

  SIM_IDS.forEach(id => {

    G.sims[id].tacticHistory.forEach(h => {

      if (!tacticSimMap[h.path])
        tacticSimMap[h.path] = [];

      if (!tacticSimMap[h.path].includes(id))
        tacticSimMap[h.path].push(id);

    });

  });

  const sorted = Object.entries(tacticCounts)
    .sort((a,b)=>b[1]-a[1]);

  let out = `# AM Vault — Tactic Heatmap\n\n`;
  out += `Generated: ${new Date().toISOString()} · Cycles: ${G.cycle}\n\n`;

  out += `| Rank | Count | Category | Subcategory | Tactic | Targets |\n`;
  out += `|------|-------|----------|-------------|--------|---------|\n`;

  sorted.forEach(([path,count],i)=>{

    const t = getTacticByPath(path);

    if (t)
      out += `| ${i+1} | ×${count} | ${t.category} | ${t.subcategory} | ${t.title} | ${(tacticSimMap[path]||[]).join(", ")} |\n`;

  });

  dl(`AM_tactic_heatmap_cycle${G.cycle}.md`,out,"text/plain");
}

/* ============================================================
   INTERNAL HELPERS
   ============================================================ */

function computeTacticFrequency() {

  const counts = {};

  SIM_IDS.forEach(id => {

    G.sims[id].tacticHistory.forEach(h => {

      counts[h.path] = (counts[h.path] || 0) + 1;

    });

  });

  return counts;
}

function renderTopTactics(counts){

  const sorted = Object.entries(counts)
    .sort((a,b)=>b[1]-a[1])
    .slice(0,15);

  const el = document.getElementById("sm-tactic-analysis");

  if(!el) return;

  if(!sorted.length){

    el.innerHTML =
      `<div style="font-size:.55rem;color:#1e1e1e;font-family:Courier Prime,monospace;">
        No tactics deployed yet.
      </div>`;

    return;
  }

  el.innerHTML = sorted.map(([path,count]) => {

    const tactic = getTacticByPath(path);

    const label =
      tactic
        ? `[${tactic.category}/${tactic.subcategory}] ${tactic.title}`
        : path;

    return `<div class="sm-tactic-row">
              <span class="count">×${count}</span>
              <span class="tn">${label}</span>
            </div>`;

  }).join("");

}

function dl(filename,content,type="text/plain"){

  const blob = new Blob([content],{type});

  const a = document.createElement("a");

  a.href = URL.createObjectURL(blob);
  a.download = filename;

  a.click();

  URL.revokeObjectURL(a.href);

}