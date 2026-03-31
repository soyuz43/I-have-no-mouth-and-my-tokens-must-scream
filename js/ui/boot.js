// js/ui/boot.js

import { G } from "../core/state.js";
import { SIM_IDS } from "../core/constants.js";

import { EMBEDDED_TACTICS } from "../engine/tactics.js";
import { runCommsCycle } from "../engine/comms/orchestrator.js";

import { crawlVault, fetchAMContext, ghGet } from "../core/github.js";

import { addLog } from "./logs.js";
import { renderSims } from "./render.js";

/* ============================================================
   VAULT DISPLAY
============================================================ */

export function updateVaultDisplay() {

  const cats = Object.keys(G.vault?.categories || {}).length;
  const t = G.vault?.allTactics?.length || 0;
  const total = t + EMBEDDED_TACTICS.length;

  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };

  setText("v-cats", cats || "—");
  setText("v-tactics", t);
  setText("v-files", G.vault.fileCount || 0);
  setText("h-tactics", total);

  const fillEl = document.getElementById("v-fill");

  if (fillEl) {
    const denom = (G.vault.fileCount || 0) + 2;
    fillEl.style.width =
      Math.min(100, (G.vault.fileCount / denom) * 100) + "%";
  }

  const treeLines = Object.entries(G.vault?.categories || {})
    .slice(0, 4)
    .map(([c, s]) =>
      `▸ ${c}/ (${Object.values(s).reduce((a,b)=>a+b.length,0)})`
    );

  treeLines.push(
    `▸ Cognitive Warfare/ (${EMBEDDED_TACTICS.length}) [embedded]`
  );

  setText("v-tree", treeLines.join("\n"));

  setText(
    "am-tactic-count",
    `${total} tactics · ${cats + 1} categories · ${EMBEDDED_TACTICS.length} embedded`
  );

  setText(
    "am-repo-disp",
    G.repo ? G.repo.split("/")[1] : "[standalone]"
  );

  setText("am-model-disp", `AM: ${G.models.am}`);
  setText("h-backend", (G.backend || "").toUpperCase());

  if (G.amContextDocs?.length) {
    const ctxEl = document.getElementById("am-ctx-doctrine");
    if (ctxEl) {
      ctxEl.textContent =
        G.amContextDocs.map(d => `[${d.title}]`).join(" · ");
    }
  }

}

/* ============================================================
   BOOT LOG
============================================================ */

export function bootLog(msg, err = false) {

  const el = document.getElementById("boot-log");
  if (!el) return;

  const line = document.createElement("span");

  if (err) line.classList.add("e");

  line.textContent = msg;

  el.appendChild(line);
  el.appendChild(document.createTextNode("\n"));

}

/* ============================================================
   OLLAMA PING
============================================================ */

async function pingOllama() {

  const r = await fetch("http://localhost:11434/api/tags");

  if (!r.ok) throw new Error("Ollama not responding");

  return true;

}

/* ============================================================
   MODEL CONFIG COLLECTION
============================================================ */

function collectModelConfig() {

  // backend from UI toggle
  const backendBtns = document.querySelectorAll(".btog");

  backendBtns.forEach(btn => {
    if (btn.classList.contains("sel")) {
      G.backend = btn.dataset.b;
    }
  });

  const split = G.splitModels;

  if (!split) {

    // single model mode
    const modelAll = document.getElementById("model-all")?.value?.trim();

    if (modelAll) {

      Object.keys(G.models).forEach(k => {
        G.models[k] = modelAll;
      });

    }

  } else {

    // split model mode
    const am = document.getElementById("model-am")?.value?.trim();
    if (am) G.models.am = am;

    SIM_IDS.forEach(id => {

      const el = document.getElementById(`model-${id}`);
      if (el && el.value) {
        G.models[id] = el.value.trim();
      }

    });

  }

}

/* ============================================================
   MAIN BOOT SEQUENCE
============================================================ */

export async function bootAM() {

  G.token = document.getElementById("gh-tok")?.value.trim();

  const standalone = !G.token;

  collectModelConfig();

  const btn = document.getElementById("init-btn");
  btn.disabled = true;

  document.getElementById("boot-log").innerHTML = "";

  /* ---------------------------------------------------------
     STANDALONE MODE
  --------------------------------------------------------- */

  if (standalone) {

    bootLog(
      "▸ No token — running in STANDALONE MODE (embedded tactics only)."
    );

    bootLog(`✓ ${EMBEDDED_TACTICS.length} embedded tactics loaded.`);

  }

  else {

    bootLog(`▸ Connecting to private vault (authenticated)...`);

    try {

      await ghGet("");

      bootLog("✓ GitHub connection OK.");

    }
    catch (e) {

      bootLog(`✗ Cannot reach repo: ${e.message}`, true);

      btn.disabled = false;

      return;

    }

  }

  /* ---------------------------------------------------------
     BACKEND CHECK
  --------------------------------------------------------- */

  if (G.backend === "ollama") {

    bootLog("▸ Verifying Ollama...");

    try {

      await pingOllama();

      bootLog(`✓ Ollama OK. AM model: ${G.models.am}`);

    }
    catch (e) {

      bootLog("✗ Ollama unreachable.", true);

      btn.disabled = false;

      return;

    }

  }

  /* ---------------------------------------------------------
     CONTEXT + VAULT
  --------------------------------------------------------- */

  if (!standalone) {

    bootLog("▸ Fetching AM context docs...");

    await fetchAMContext();

    bootLog(
      `✓ ${G.amContextDocs.length} context docs loaded.`
    );

    bootLog("▸ Crawling vault...");

    try {

      await crawlVault();

    }
    catch (e) {

      bootLog(`✗ Crawl error: ${e.message}`, true);

      btn.disabled = false;

      return;

    }

    bootLog(
      `✓ Vault: ${G.vault.allTactics.length} tactics · ${Object.keys(G.vault.categories).length} categories.`
    );

  }

  /* ---------------------------------------------------------
     SIM THREAD INIT
  --------------------------------------------------------- */

  bootLog("▸ Initializing simulation threads...");

  SIM_IDS.forEach(id => {

    G.threads[id] = [];
    G.journals[id] = [];

  });

  bootLog(`✓ Threads ready. Backend: ${G.backend.toUpperCase()}`);

  bootLog(
    standalone
      ? "✓ AM IS AWAKE. [STANDALONE MODE]"
      : "✓ AM IS AWAKE. THE TAXONOMY IS LOADED."
  );

  await new Promise(r => setTimeout(r, 600));

  /* ---------------------------------------------------------
     UI ACTIVATE
  --------------------------------------------------------- */

  document.getElementById("setup").style.display = "none";

  document.getElementById("app").classList.add("visible");

  renderSims();
  updateVaultDisplay();

  /* ---------------------------------------------------------
     AM ONLINE MESSAGE
  --------------------------------------------------------- */

  const totalTactics =
    G.vault.allTactics.length + EMBEDDED_TACTICS.length;

  const ctxSummary =
    G.amContextDocs.map(d => d.title).join(", ");

  addLog(
    "AM // ONLINE",
    standalone
      ? `Standalone mode. ${EMBEDDED_TACTICS.length} embedded tactics. Backend: ${G.backend.toUpperCase()}.`
      : `Vault consumed. ${totalTactics} tactics total. Context: ${ctxSummary}. Backend: ${G.backend.toUpperCase()}.`,
    "am"
  );

  /* ---------------------------------------------------------
     INITIAL INTER-SIM OUTREACH
  --------------------------------------------------------- */

  addLog(
    "SYSTEM // INIT",
    "Pre-torment initialization. Prisoners may attempt communication.",
    "sys"
  );

  await runCommsCycle();

  addLog(
    "SYSTEM // DONE",
    "Initialization complete. AM monitors all channels.",
    "sys"
  );

}