// js/ui/boot.js

import { G } from "../core/state.js";
import { SIM_IDS } from "../core/constants.js";

import { EMBEDDED_TACTICS, getAllTactics } from "../engine/tactics.js";
import { runCommunicationPhase } from "../engine/phases/communicationPhase.js";

import { crawlVault, fetchAMContext, ghGet } from "../core/github.js";

import { addLog } from "./logs.js";
import { renderSims } from "./render.js";

/* ============================================================
   VAULT DISPLAY
============================================================ */

export function updateVaultDisplay() {

  // Source-agnostic tactic count: canonical merge of ingested,
  // derived, and embedded tactics (see getAllTactics()).
  const all = getAllTactics();
  const t = all.length;

  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };

  setText("v-tactics", t);
  setText("h-tactics", t);

  setText(
    "am-tactic-count",
    `${t} tactics · ${EMBEDDED_TACTICS.length} embedded`
  );

  setText("am-repo-disp", "[standalone]");

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

  // Colab runtime config from setup UI.
  // This is intentionally kept in runtime state only.
  G.colabEndpoint =
    document
      .getElementById("colab-endpoint")
      ?.value
      ?.trim()
      ?.replace(/\/+$/, "") || "";

  G.colabBearerToken =
    document
      .getElementById("colab-token")
      ?.value
      ?.trim() || "";

  const split = G.splitModels;

  if (!split) {
    // Single-model mode: assign the selected model to
    // AM, forensic analysis, and every prisoner.
    const modelAll =
      document
        .getElementById("model-all")
        ?.value
        ?.trim();

    if (modelAll) {
      Object.keys(G.models).forEach((role) => {
        G.models[role] = modelAll;
      });
    }
  } else {
    // Split-model mode.
    const am =
      document
        .getElementById("model-am")
        ?.value
        ?.trim();

    const forensicStats =
      document
        .getElementById(
          "model-FORENSIC_STATS"
        )
        ?.value
        ?.trim();

    if (am) {
      G.models.am = am;
    }

    if (forensicStats) {
      G.models.FORENSIC_STATS =
        forensicStats;
    }

    SIM_IDS.forEach((id) => {
      const element =
        document.getElementById(
          `model-${id}`
        );

      const model =
        element?.value?.trim();

      if (model) {
        G.models[id] = model;
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

  if (G.backend === "colab") {

    const endpointReady =
      Boolean(
        G.colabEndpoint
      );

    const tokenReady =
      Boolean(
        G.colabBearerToken
      );

    const modelsReady =
      Array.isArray(
        G.colabModels
      ) &&
      G.colabModels.length > 0;

    if (
      !endpointReady ||
      !tokenReady ||
      !modelsReady
    ) {
      bootLog(
        "✗ Test the Colab connection and discover at least one model before initialization.",
        true
      );

      btn.disabled = false;

      return;
    }

    bootLog(
      `✓ Colab ready. ${G.colabModels.length} model${G.colabModels.length === 1 ? "" : "s"} available.`
    );

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

  await runCommunicationPhase();

  addLog(
    "SYSTEM // DONE",
    "Initialization complete. AM monitors all channels.",
    "sys"
  );

}