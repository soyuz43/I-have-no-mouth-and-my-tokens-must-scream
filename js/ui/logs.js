// js/ui/logs.js
//
// Logging + Log Export System
//
// Responsibilities
// 1. Record runtime events to G.transmissionLog
// 2. Render log entries in the UI
// 3. Provide export tools for simulation artifacts

import { G } from "../core/state.js";
import { downloadTextFile, escapeHtml } from "../core/utils.js";

/* ============================================================
   RUNTIME LOGGING
   ============================================================ */

export function addLog(spk, body, type = "sys", tactic = "", allowHtml = false) {

  const feed = document.getElementById("rp-log");
  if (!feed) return;

  const el = document.createElement("div");
  el.className = `log-e ${type}`;

  const safeSpeaker = escapeHtml(spk);

  const renderedBody =
    allowHtml
      ? body
      : escapeHtml(String(body)).replace(/\n/g, "<br>");

  
let renderedTactic = "";

if (tactic) {

  const parts = String(tactic).split("→").map(s => s.trim());

  if (parts.length === 1) {

    renderedTactic =
      `<div class="log-tactic">▸ ${escapeHtml(parts[0])}</div>`;

  } else {

    renderedTactic =
      `<div class="log-tactic">▸ ${escapeHtml(parts[0])}</div>` +
      parts.slice(1)
        .map(t =>
          `<div class="log-tactic-sub">↳ ${escapeHtml(t)}</div>`
        )
        .join("");

  }

}
  el.innerHTML =
      `<div class="log-spk">${safeSpeaker}</div>` +
      `<div class="log-body">${renderedBody}</div>` +
      renderedTactic +
      `<div class="log-ts">CYCLE ${G.cycle} // ${new Date().toTimeString().slice(0,8)}</div>`;

  feed.appendChild(el);
  feed.scrollTop = feed.scrollHeight;

  // store for exports
  G.transmissionLog.push({
    cycle: G.cycle,
    speaker: spk,
    body,
    type,
    tactic,
    ts: new Date().toISOString()
  });

  G.logCount++;

  const countEl = document.getElementById("rp-count");
  if (countEl) countEl.textContent = G.logCount;
}


/* ============================================================
   THINKING INDICATOR
   ============================================================ */

export function showThinking(lbl) {

  const feed = document.getElementById("rp-log");
  if (!feed) return null;

  const el = document.createElement("div");
  el.className = "thinking-row";

  el.innerHTML =
    `<span style="font-size:.46rem;letter-spacing:.18em;color:var(--crimson)">` +
    escapeHtml(lbl) +
    `</span>` +
    `<div class="td"></div><div class="td"></div><div class="td"></div>`;

  feed.appendChild(el);
  feed.scrollTop = feed.scrollHeight;

  return el;
}

export function removeThinking(el) {
  if (el?.parentNode) el.remove();
}

/* ============================================================
   EXPORT — INTER-SIM COMMUNICATION
   ============================================================ */

export function exportInterSimLogTxt() {
  exportInterSimLog("txt");
}

export function exportInterSimLog(format = "txt") {
  if (!G.interSimLog.length) {
    alert("No inter-sim messages yet.");
    return;
  }

  let out = "";
  const hr = "─".repeat(60);

  if (format === "md") {
    out += `# Inter-Sim Communications\n\n`;
    out += `Session Cycle: ${G.cycle} · Exported: ${new Date().toISOString()}\n\n`;

    G.interSimLog.forEach((e) => {
      const visText =
        e.visibility === "public"
          ? `PUBLIC ${e.from} → ${e.to.join(", ")} (all sims see)`
          : e.visibility === "overheard"
          ? `OVERHEARD ${e.from} → ${e.to.join(", ")}`
          : `PRIVATE ${e.from} → ${e.to.join(", ")}`;

      out += `**Cycle ${e.cycle}** – ${visText}  \n`;
      out += `> "${e.text}"  \n`;

      if (e.autonomous) out += `*(autonomous)*  \n`;
      if (e.intent) out += `*(intent: ${e.intent})*  \n`;
      if (e.overheardBy) out += `*(overheard by: ${e.overheardBy})*  \n`;

      out += `\n`;
    });
  } else {
    out += `INTER-SIM COMMUNICATIONS\n${hr}\n`;
    out += `Session Cycle: ${G.cycle} · Exported: ${new Date().toISOString()}\n\n`;

    G.interSimLog.forEach((e) => {
      const visText =
        e.visibility === "public"
          ? `PUBLIC ${e.from} → ${e.to.join(", ")} (all sims see)`
          : e.visibility === "overheard"
          ? `OVERHEARD ${e.from} → ${e.to.join(", ")}`
          : `PRIVATE ${e.from} → ${e.to.join(", ")}`;

      out += `[Cycle ${e.cycle}] ${visText}\n`;
      out += `  "${e.text}"\n`;

      if (e.autonomous) out += `  (autonomous)\n`;
      if (e.intent) out += `  (intent: ${e.intent})\n`;
      if (e.overheardBy) out += `  (overheard by: ${e.overheardBy})\n`;

      out += `\n`;
    });
  }

  downloadTextFile(`AM_interSim_cycle${G.cycle}.${format}`, out);
}

/* ============================================================
   EXPORT — AM PLANS
   ============================================================ */

export function exportPlans() {
  if (!G.amPlans.length) {
    alert("No plans to export.");
    return;
  }

  let content = "# AM Strategic Plans\n\n";

  G.amPlans.forEach((p) => {
    content += `## Cycle ${p.cycle} (${p.timestamp})\n\n${p.plan}\n\n---\n\n`;
  });

  downloadTextFile(`AM_plans_cycle${G.cycle}.md`, content);
}

/* ============================================================
   EXPORT — TRANSMISSION LOG
   ============================================================ */

export function exportTransmissionLog() {
  if (!G.transmissionLog.length) {
    alert("No transmission log entries yet.");
    return;
  }

  let out = `TRANSMISSION LOG\n${"─".repeat(60)}\n`;
  out += `Session Cycle: ${G.cycle} · Exported: ${new Date().toISOString()}\n\n`;

  G.transmissionLog.forEach((e) => {
    const timeLabel = new Date(e.ts).toLocaleTimeString();

    out += `${e.speaker}\n`;
    out += `${e.body}\n`;

    if (e.tactic) out += `TACTIC: ${e.tactic}\n`;

    out += `CYCLE ${e.cycle} // ${timeLabel}\n\n`;
  });

  downloadTextFile(`AM_transmission_log_cycle${G.cycle}.txt`, out);
}