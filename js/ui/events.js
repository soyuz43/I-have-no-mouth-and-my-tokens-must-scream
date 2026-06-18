// js/ui/events.js

import { G } from "../core/state.js";
import { SIM_IDS } from "../core/constants.js";

// ══════════════════════════════════════════════════════════
// SETUP UI EVENTS
// ══════════════════════════════════════════════════════════

export function setBackend(btn) {
  document.querySelectorAll(".btog").forEach((b) => b.classList.remove("sel"));
  btn.classList.add("sel");

  G.backend = btn.dataset.b;

  const ollamaSection = document.getElementById("ollama-section");
  if (ollamaSection) {
    ollamaSection.style.display = G.backend === "ollama" ? "block" : "none";
  }

  if (G.backend === "ollama") {
    pingOllama();
  }

  refreshModelDropdowns();
}

export function toggleSplit() {
  G.splitModels = !G.splitModels;

  const toggle = document.getElementById("split-toggle");
  if (toggle) toggle.classList.toggle("on", G.splitModels);

  const single = document.getElementById("single-model-cfg");
  const split = document.getElementById("split-model-cfg");

  if (single) single.style.display = G.splitModels ? "none" : "block";
  if (split) split.style.display = G.splitModels ? "grid" : "none";
}

export async function pingOllama() {
  const el = document.getElementById("ollama-status");

  if (el) {
    el.innerHTML =
      '<span class="spin">⟳</span> Connecting to localhost:11434...';
  }

  try {
    const r = await fetch("http://localhost:11434/api/tags");
    if (!r.ok) throw new Error(r.status);

    const data = await r.json();
    G.ollamaModels = (data.models || []).map((m) => m.name);

    if (el) {
      el.innerHTML = `<span class="ok">✓ Ollama connected. ${G.ollamaModels.length} models found.</span>`;
    }

    refreshModelDropdowns();
  } catch (e) {
    if (el) {
      el.innerHTML =
        `<span class="err">✗ Cannot reach Ollama at localhost:11434. Is it running?</span>`;
    }
  }
}

export async function scanOllama() {
  await pingOllama();
}

export function refreshModelDropdowns() {
  const anthropicModels = [
    "claude-sonnet-4-20250514",
    "claude-opus-4-5",
    "claude-haiku-4-5-20251001",
  ];

  const models =
    G.backend === "ollama"
      ? G.ollamaModels
      : anthropicModels;

  if (!models.length) return;

  const selIds = G.splitModels
    ? [
        "model-am",
        "model-FORENSIC_STATS",
        "model-TED",
        "model-ELLEN",
        "model-NIMDOK",
        "model-GORRISTER",
        "model-BENNY",
      ]
    : ["model-all"];

  selIds.forEach((id) => {
    const el = document.getElementById(id);

    if (!el) return;

    const currentValue = el.value;

    el.innerHTML = models
      .map(
        (model) =>
          `<option value="${model}" ${
            model === currentValue
              ? "selected"
              : ""
          }>${model}</option>`,
      )
      .join("");
  });
}

export function collectModelConfig() {
  if (G.splitModels) {
    const amElement =
      document.getElementById("model-am");

    const forensicElement =
      document.getElementById(
        "model-FORENSIC_STATS"
      );

    if (amElement?.value) {
      G.models.am = amElement.value;
    }

    if (forensicElement?.value) {
      G.models.FORENSIC_STATS =
        forensicElement.value;
    }

    SIM_IDS.forEach((id) => {
      const element =
        document.getElementById(
          `model-${id}`
        );

      if (element?.value) {
        G.models[id] = element.value;
      }
    });

    return;
  }

  const modelAllElement =
    document.getElementById("model-all");

  const sharedModel =
    modelAllElement?.value;

  if (!sharedModel) return;

  G.models.am = sharedModel;
  G.models.FORENSIC_STATS = sharedModel;

  SIM_IDS.forEach((id) => {
    G.models[id] = sharedModel;
  });
}

export function showBeliefDelta(simId, entryIndex) {
  const entry = G.journals?.[simId]?.[entryIndex];
  if (!entry) return;

  const content =
    `Cycle ${entry.cycle || "?"} — ${simId}\n` +
    `Reason: ${entry.reason || "none"}\n\n` +
    `Belief deltas:\n${JSON.stringify(entry.beliefDeltas || {}, null, 2)}\n\n` +
    `Drives after:\n${JSON.stringify(entry.drivesAfter || {}, null, 2)}\n\n` +
    `Anchors after:\n${entry.anchorsAfter?.join("\n") || "(none)"}\n\n` +
    (entry.rawStatsJson
      ? `Raw model output:\n${entry.rawStatsJson}`
      : "");

  alert(content);
}

export function toggleLogDisclosure(id, el) {
  const block = document.getElementById(id);
  if (!block) return;

  const open = block.style.display !== "none";
  block.style.display = open ? "none" : "block";

  if (el) {
    el.textContent = open ? ">>" : "<<";
  }
}

export function setVisibility(btn) {
  document
    .querySelectorAll(".vis-toggle")
    .forEach((b) => b.classList.remove("sel"));

  btn.classList.add("sel");

  window.manualVisibility = btn.dataset.vis;
}

export function selTarget(btn) {
  document
    .querySelectorAll(".tbt")
    .forEach(b => b.classList.remove("sel"));

  btn.classList.add("sel");

  G.target = btn.dataset.t;
}

export function selMode(btn) {
  document
    .querySelectorAll(".mbt")
    .forEach(b => b.classList.remove("sel"));

  btn.classList.add("sel");

  G.mode = btn.dataset.m;

  const execBtn = document.getElementById("exec-btn");

  if (!execBtn) return;

  if (G.mode === "autonomous") {
    execBtn.textContent =
      G.autoRunning
        ? "⛔ HALT ⛔"
        : "⚡ UNLEASH AM ⚡";
  } else {
    execBtn.textContent = "⚡ EXECUTE ⚡";
    execBtn.classList.remove("running");
  }
}

export function setFrom(btn) {
  document
    .querySelectorAll(".is-fbtn")
    .forEach(b => b.classList.remove("sel"));

  btn.classList.add("sel");

  G.interSimFrom = btn.dataset.f;

  document.querySelectorAll(".is-tchk").forEach(b => {
    if (b.dataset.t === G.interSimFrom)
      b.classList.remove("sel");
  });
}

export function toggleTo(btn) {
  btn.classList.toggle("sel");
}