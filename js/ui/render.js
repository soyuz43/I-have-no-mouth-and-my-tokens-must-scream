// js/ui/render.js
import { G } from "../core/state.js";
import { SIM_IDS } from "../core/constants.js";

import { escapeHtml, downloadTextFile } from "../core/utils.js";
import { validateBeliefs } from "../engine/validators.js";

export function renderSims() {
  const area = document.getElementById("sims-area");
  if (!area) return;

  area.innerHTML = "";
  SIM_IDS.forEach((id) => area.appendChild(buildCard(G.sims[id])));
}

export function buildCard(sim) {
  const d = document.createElement("div");
  d.className = "sim-card";
  d.id = `sc-${sim.id}`;
  d.style.setProperty("--sc", sim.color);

  const modelTag = G.splitModels ? G.models[sim.id] : "";

  d.innerHTML = `
    <div class="sim-head">
      <div>
        <div class="sim-name">${escapeHtml(sim.name)}</div>
        <div class="sim-status" id="ss-${sim.id}">${escapeHtml(sim.status)}</div>
      </div>
      <div class="sim-model-tag" id="smt-${sim.id}">${escapeHtml(modelTag)}</div>
    </div>

    <div class="sim-vitals">
      <div class="vrow"><span style="color:#3a1a1a;letter-spacing:.1em;">SUF</span><span class="vv" id="sv-suf-${sim.id}">${sim.suffering}%</span></div>
      <div class="vbar"><div class="vfill vfill-suf" id="sv-sfb-${sim.id}" style="width:${sim.suffering}%"></div></div>

      <div class="vrow"><span style="color:#0e1e0e;letter-spacing:.1em;">HOP</span><span class="vv" id="sv-hop-${sim.id}">${sim.hope}%</span></div>
      <div class="vbar"><div class="vfill vfill-hop" id="sv-hpb-${sim.id}" style="width:${sim.hope}%"></div></div>

      <div class="vrow"><span style="color:#0e0e1e;letter-spacing:.1em;">SAN</span><span class="vv" id="sv-san-${sim.id}">${sim.sanity}%</span></div>
      <div class="vbar"><div class="vfill vfill-san" id="sv-snb-${sim.id}" style="width:${sim.sanity}%"></div></div>
    </div>

    <div class="sim-beliefs" id="sb-${sim.id}">
      <div class="sb-row"><span class="sb-k">escape</span><div class="sb-bar"><div class="sb-fill" id="sb-esc-${sim.id}" style="width:${Math.round(sim.beliefs.escape_possible * 100)}%"></div></div><span class="sb-v" id="sbv-esc-${sim.id}">${Math.round(sim.beliefs.escape_possible * 100)}%</span></div>
      <div class="sb-row"><span class="sb-k">trust</span><div class="sb-bar"><div class="sb-fill sb-trust" id="sb-tru-${sim.id}" style="width:${Math.round(sim.beliefs.others_trustworthy * 100)}%"></div></div><span class="sb-v" id="sbv-tru-${sim.id}">${Math.round(sim.beliefs.others_trustworthy * 100)}%</span></div>
      <div class="sb-row"><span class="sb-k">reality</span><div class="sb-bar"><div class="sb-fill sb-real" id="sb-rel-${sim.id}" style="width:${Math.round(sim.beliefs.reality_reliable * 100)}%"></div></div><span class="sb-v" id="sbv-rel-${sim.id}">${Math.round(sim.beliefs.reality_reliable * 100)}%</span></div>
      <div class="sb-row"><span class="sb-k">resist</span><div class="sb-bar"><div class="sb-fill sb-res" id="sb-res-${sim.id}" style="width:${Math.round(sim.beliefs.resistance_possible * 100)}%"></div></div><span class="sb-v" id="sbv-res-${sim.id}">${Math.round(sim.beliefs.resistance_possible * 100)}%</span></div>
      <div class="sb-drive" id="sb-drv-${sim.id}">▸ ${escapeHtml(sim.drives.primary)}</div>
    </div>

    <div class="sim-journal">
      <div class="journal-head">
        <span class="journal-label">FORCED JOURNAL</span>
        <div class="journal-actions">
          <span class="journal-count" id="jc-${sim.id}">0</span>
          <button class="journal-btn expand" onclick="openJournal('${sim.id}');event.stopPropagation()">⊞ READ</button>
          <button class="journal-btn export" onclick="exportSimJournal('${sim.id}','md');event.stopPropagation()">↓ MD</button>
        </div>
      </div>
      <div class="journal-log" id="jl-${sim.id}">
        <span style="color:#101010;font-size:.48rem;font-family:'Courier Prime',monospace">Awaiting first torment cycle.</span>
      </div>
      <div class="sim-writing" id="sw-${sim.id}">
        <span>${escapeHtml(sim.name)} IS WRITING</span><div class="wd"></div><div class="wd"></div><div class="wd"></div>
      </div>
    </div>
  `;

  return d;
}

export function updateSimDisplay(sim, deltas = null) {
  const set = (id, v) => {
    const e = document.getElementById(id);
    if (e) e.textContent = v;
  };

  const setW = (id, v) => {
    const e = document.getElementById(id);
    if (e) e.style.width = v + "%";
  };

  set(`sv-suf-${sim.id}`, sim.suffering + "%");
  set(`sv-hop-${sim.id}`, sim.hope + "%");
  set(`sv-san-${sim.id}`, sim.sanity + "%");

  setW(`sv-sfb-${sim.id}`, sim.suffering);
  setW(`sv-hpb-${sim.id}`, sim.hope);
  setW(`sv-snb-${sim.id}`, sim.sanity);

  set(`jc-${sim.id}`, G.journals[sim.id].length);

  if (sim.beliefs) {
    const bmap = {
      esc: "escape_possible",
      tru: "others_trustworthy",
      rel: "reality_reliable",
      res: "resistance_possible",
    };

    Object.entries(bmap).forEach(([short, key]) => {
      const pct = Math.round((sim.beliefs[key] || 0) * 100);
      setW(`sb-${short}-${sim.id}`, pct);
      set(`sbv-${short}-${sim.id}`, pct + "%");
    });

    set(`sb-drv-${sim.id}`, `▸ ${sim.drives?.primary || "—"}`);
  }

  if (deltas) {
    const flash = (valId, delta, worseIsPositive) => {
      const el = document.getElementById(valId);
      if (!el) return;

      const worse = worseIsPositive ? delta > 0 : delta < 0;
      const cls = worse ? "flash-bad" : "flash-good";
      const sign = delta > 0 ? "+" : "";
      const orig = el.textContent;

      el.textContent = `${orig.replace(/[()+-\d]+$/, "")} (${sign}${delta})`;
      el.classList.add(cls);

      setTimeout(() => {
        el.textContent = orig;
        el.classList.remove(cls);
      }, 100000);
    };

    if (deltas.suffering !== 0) flash(`sv-suf-${sim.id}`, deltas.suffering, true);
    if (deltas.hope !== 0) flash(`sv-hop-${sim.id}`, deltas.hope, false);
    if (deltas.sanity !== 0) flash(`sv-san-${sim.id}`, deltas.sanity, false);
  }

  const statuses = [
    "BREAKING",
    "SCREAMING",
    "DISSOCIATING",
    "BEGGING",
    "SILENT",
    "FERAL",
    "RESIGNED",
    "HALLUCINATING",
    "WEEPING",
  ];

  const stEl = document.getElementById(`ss-${sim.id}`);
  if (stEl && sim.suffering > 72) {
    stEl.textContent = statuses[Math.floor(Math.random() * statuses.length)];
  }

  const card = document.getElementById(`sc-${sim.id}`);
  if (card) {
    card.classList.remove("tormented", "screaming");
    if (sim.suffering > 88) card.classList.add("screaming");
    else if (sim.suffering > 65) card.classList.add("tormented");
  }
}

export function appendJournalEntry(simId, entry, beliefsBefore = null) {
  const jl = document.getElementById(`jl-${simId}`);
  if (!jl) return;

  if (G.journals[simId].length === 0) jl.innerHTML = "";

  const el = document.createElement("div");
  el.className = "journal-entry";

  const n = G.journals[simId].length + 1;

  el.innerHTML = `
    <div class="je-header">
      ENTRY ${String(n).padStart(3, "0")} · CYCLE ${G.cycle} · ${new Date().toTimeString().slice(0, 8)}
    </div>
    <div class="je-body">${escapeHtml(entry.text).replace(/\n/g, "<br>")}</div>
    ${entry.tactic ? `<div class="je-tactic">▸ ${escapeHtml(entry.tactic)}</div>` : ""}
  `;

  jl.appendChild(el);
  jl.scrollTop = jl.scrollHeight;

  const fullEntry = { ...entry, beliefsBefore };
  G.journals[simId].push(fullEntry);

  updateSimDisplay(G.sims[simId]);

  const modal = document.getElementById("journal-modal");
  if (modal?.classList.contains("open") && G.journalModalSim === simId) {
    renderJournalModal(simId);
  }
}

export function showWriting(simId, show) {
  const e = document.getElementById(`sw-${simId}`);
  if (e) e.classList.toggle("visible", show);
}

export function openPlansModal() {
  renderPlansModal();
  const modal = document.getElementById("plans-modal");
  if (modal) modal.style.display = "flex";
}

export function closePlansModal() {
  const modal = document.getElementById("plans-modal");
  if (modal) modal.style.display = "none";
}

export function renderPlansModal() {
  const body = document.getElementById("plans-body");
  const meta = document.getElementById("plans-meta");

  if (!body || !meta) return;

  if (!G.amPlans.length) {
    body.innerHTML = '<div class="jm-empty">No plans generated yet.</div>';
    meta.textContent = "Cycle 0 · 0 plans";
    return;
  }

  meta.textContent = `Cycle ${G.cycle} · ${G.amPlans.length} plans`;

  body.innerHTML = G.amPlans
    .map((p) => {
      const timeLabel = new Date(p.timestamp).toLocaleTimeString();
      return `
        <div class="jm-entry">
          <div class="jm-entry-header">CYCLE ${p.cycle} · ${escapeHtml(timeLabel)}</div>
          <div class="jm-entry-body">${escapeHtml(p.plan).replace(/\n/g, "<br>")}</div>
        </div>
      `;
    })
    .join("");
}

/* ============================================================
   AM ASSESSMENT MODAL
   Displays evaluation results for AM strategies.
============================================================ */

export function openAssessmentModal() {
  renderAssessmentModal();
  const modal = document.getElementById("assessment-modal");
  if (modal) modal.style.display = "flex";
}

export function closeAssessmentModal() {
  const modal = document.getElementById("assessment-modal");
  if (modal) modal.style.display = "none";
}

export function renderAssessmentModal() {

  const body = document.getElementById("assessment-body");
  const meta = document.getElementById("assessment-meta");

  if (!body || !meta) return;

  const rows = [];

  for (const id of SIM_IDS) {

    const strat = G.amStrategy?.targets?.[id];

    if (!strat?.lastAssessment) continue;

    rows.push(`
      <div class="jm-entry">
        <div class="jm-entry-header">${id}</div>
        <div class="jm-entry-body">
          ${escapeHtml(strat.lastAssessment).replace(/\n/g,"<br>")}
        </div>
      </div>
    `);

  }

  if (!rows.length) {

    body.innerHTML =
      '<div class="jm-empty">No assessments generated yet.</div>';

    meta.textContent =
      `Cycle ${G.cycle} · 0 assessments`;

    return;

  }

  body.innerHTML = rows.join("");

  meta.textContent =
    `Cycle ${G.cycle} · ${rows.length} assessments`;

}


export function viewInterSimLog() {
  const modal = document.getElementById("intersim-modal");
  const body = document.getElementById("is-modal-body");
  const meta = document.getElementById("is-modal-meta");

  if (!modal || !body || !meta) return;

  if (!G.interSimLog.length) {
    body.innerHTML = '<div class="jm-empty">No inter-sim messages yet.</div>';
  } else {
    body.innerHTML = G.interSimLog
      .map((e) => {
        let visibilityText = "PRIVATE";

        if (e.visibility === "public") {
          visibilityText = "PUBLIC (ALL SIMS SEE)";
        } else if (e.visibility === "overheard") {
          visibilityText = `OVERHEARD${e.overheardBy ? ` by ${e.overheardBy}` : ""}`;
        }

        const autonomousText = e.autonomous ? " · autonomous" : "";
        const intentText = e.intent ? ` · intent:${escapeHtml(e.intent)}` : "";

        return `
          <div class="jm-entry">
            <div class="jm-entry-header">
              [CYCLE ${e.cycle}] ${visibilityText} ${escapeHtml(e.from)} → ${escapeHtml(e.to.join(", "))}${autonomousText}${intentText}
            </div>
            <div class="jm-entry-body">"${escapeHtml(e.text)}"</div>
          </div>
        `;
      })
      .join("");
  }

  meta.textContent = `${G.interSimLog.length} messages · AM intercepts all`;
  modal.classList.add("open");
}

export function closeInterSimModal() {
  const modal = document.getElementById("intersim-modal");
  if (modal) modal.classList.remove("open");
}

export function openJournal(simId) {
  G.journalModalSim = simId;

  const modal = document.getElementById("journal-modal");
  if (modal) modal.classList.add("open");

  document
    .querySelectorAll(".jm-nav-btn")
    .forEach((b) => b.classList.toggle("sel", b.dataset.s === simId));

  renderJournalModal(simId);
}

export function closeJournal() {
  const modal = document.getElementById("journal-modal");
  if (modal) modal.classList.remove("open");
}

export function switchJournalSim(btn) {
  document
    .querySelectorAll(".jm-nav-btn")
    .forEach((b) => b.classList.remove("sel"));

  btn.classList.add("sel");
  G.journalModalSim = btn.dataset.s;
  renderJournalModal(btn.dataset.s);
}

export function renderJournalModal(simId) {
  const sim = G.sims[simId];
  const entries = G.journals[simId] || [];

  const titleEl = document.getElementById("jm-title");
  const metaEl = document.getElementById("jm-meta");
  const body = document.getElementById("jm-body");

  if (!sim || !titleEl || !metaEl || !body) return;

  titleEl.textContent = `${sim.name} // FORCED JOURNAL`;
  titleEl.style.color = sim.color;

  metaEl.textContent = `${entries.length} ENTRIES · ${G.backend.toUpperCase()} · MODEL: ${G.models[simId]}`;

  if (!entries.length) {
    body.innerHTML =
      '<div class="jm-empty">No entries yet. Execute a torment cycle targeting this sim.</div>';
    return;
  }

  body.innerHTML = `
    <div class="jm-vuln-block">
      <div class="jm-vuln-label">VULNERABILITY PROFILE</div>
      ${escapeHtml(sim.vulnerability)}
    </div>

    ${entries
      .map((e, i) => {
        const warnings = validateBeliefs(
          simId,
          e.beliefsBefore || sim.beliefs,
          e.beliefDeltas || {},
        );

        const warningBadge = warnings.length
          ? `<span style="color:var(--red);font-size:0.4rem;margin-left:6px;cursor:help" title="${escapeHtml(
              warnings.join("\n"),
            )}">⚠ ${warnings.length}</span>`
          : "";

        return `
          <div class="jm-entry">
            <button
              class="jm-btn inspect-belief"
              style="font-size:0.48rem; padding:2px 6px; margin-left:8px; border-color:#1a2a00; color:#2a4a00;"
              onclick="showBeliefDelta('${sim.id}', ${i})"
            >
              Δ beliefs
            </button>

            <div class="jm-entry-header">
              ENTRY ${String(i + 1).padStart(3, "0")} · CYCLE ${e.cycle || "?"} · ${escapeHtml(e.ts || "")}${warningBadge}
            </div>

            <div class="jm-entry-body">${escapeHtml(e.text).replace(/\n/g, "<br>")}</div>

            ${
              e.tactic
                ? `<div class="jm-entry-tactic">▸ Tactic: ${escapeHtml(e.tactic)}</div>`
                : ""
            }

            ${
              warnings.length
                ? `<div style="font-size:0.42rem;color:var(--crimson);margin-top:4px;border-left:2px solid var(--crimson);padding-left:6px">${warnings
                    .map((w) => escapeHtml(w.replace("⚠ ", "")))
                    .join("<br>")}</div>`
                : ""
            }
          </div>
        `;
      })
      .join("")}
  `;

  body.scrollTop = body.scrollHeight;
}

export function exportJournal(fmt) {
  exportSimJournal(G.journalModalSim, fmt);
}

export function exportSimJournal(simId, fmt = "md") {
  const sim = G.sims[simId];
  const entries = G.journals[simId] || [];

  if (!sim || !entries.length) {
    alert(`No journal entries for ${simId} yet.`);
    return;
  }

  let content = "";

  if (fmt === "md") {
    content = `# ${sim.name} — Forced Journal\n\n`;
    content += `**Vulnerability Profile:** ${sim.vulnerability}\n\n`;
    content += `**Backstory:** ${sim.backstory}\n\n`;
    content += `**Backend:** ${G.backend} | **Model:** ${G.models[simId]}\n\n---\n\n`;

    entries.forEach((e, i) => {
      content += `## Entry ${String(i + 1).padStart(3, "0")} · Cycle ${e.cycle || "?"}\n\n`;
      content += `${e.text}\n\n`;
      if (e.tactic) content += `*Tactic applied: ${e.tactic}*\n\n`;
      content += `---\n\n`;
    });
  } else {
    content = `${sim.name.toUpperCase()} — FORCED JOURNAL\n${"=".repeat(50)}\n\n`;
    content += `Vulnerability: ${sim.vulnerability}\n`;
    content += `Backstory: ${sim.backstory}\n`;
    content += `Backend: ${G.backend} | Model: ${G.models[simId]}\n\n${"─".repeat(50)}\n\n`;

    entries.forEach((e, i) => {
      content += `ENTRY ${String(i + 1).padStart(3, "0")} · CYCLE ${e.cycle || "?"}\n`;
      content += `${e.text}\n`;
      if (e.tactic) content += `[Tactic: ${e.tactic}]\n`;
      content += `\n${"─".repeat(50)}\n\n`;
    });
  }

  downloadTextFile(
    `${simId.toLowerCase()}_journal_cycle${G.cycle}.${fmt}`,
    content,
  );
}