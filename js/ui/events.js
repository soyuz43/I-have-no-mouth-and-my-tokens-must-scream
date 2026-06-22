// js/ui/events.js

import { G } from "../core/state.js";
import { SIM_IDS } from "../core/constants.js";

// ══════════════════════════════════════════════════════════
// SETUP UI EVENTS
// ══════════════════════════════════════════════════════════


export function toggleSplit() {
  G.splitModels = !G.splitModels;

  const toggle =
    document.getElementById(
      "split-toggle"
    );

  if (toggle) {
    toggle.classList.toggle(
      "on",
      G.splitModels
    );
  }

  const single =
    document.getElementById(
      "single-model-cfg"
    );

  const split =
    document.getElementById(
      "split-model-cfg"
    );

  if (single) {
    single.style.display =
      G.splitModels
        ? "none"
        : "block";
  }

  if (split) {
    split.style.display =
      G.splitModels
        ? "grid"
        : "none";
  }

  /*
   * Populate the selectors that just became active using the
   * currently selected backend's discovered model list.
   */
  refreshModelDropdowns();
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

export function setBackend(btn) {
  document
    .querySelectorAll(".btog")
    .forEach((backendButton) => backendButton.classList.remove("sel"));

  btn.classList.add("sel");

  G.backend = btn.dataset.b;

  const ollamaSection = document.getElementById("ollama-section");
  const colabSection = document.getElementById("colab-section");

  if (ollamaSection) {
    ollamaSection.style.display =
      G.backend === "ollama"
        ? "block"
        : "none";
  }

  if (colabSection) {
    colabSection.style.display =
      G.backend === "colab"
        ? "block"
        : "none";
  }

  if (G.backend === "ollama") {
    void pingOllama();
  }

  updateColabScanAvailability();
  refreshModelDropdowns();
}

/* ============================================================
   COLAB CONNECTION
   ============================================================ */

export function updateColabScanAvailability() {
  const endpointInput =
    document.getElementById(
      "colab-endpoint"
    );

  const scanButton =
    document.getElementById(
      "colab-scan-btn"
    );

  const statusElement =
    document.getElementById(
      "colab-status"
    );

  const endpoint =
    endpointInput?.value
      ?.trim()
      ?.replace(/\/+$/, "") || "";

  const endpointChanged =
    endpoint !==
    String(
      G.colabEndpoint || ""
    );

  if (scanButton) {
    scanButton.disabled =
      !endpoint;
  }

  /*
   * A changed endpoint invalidates the model list discovered from
   * the previous endpoint. The next successful connection test will
   * repopulate it.
   */
  if (endpointChanged) {
    G.colabEndpoint =
      endpoint;

    G.colabModels = [];

    refreshModelDropdowns();

    if (statusElement) {
      statusElement.replaceChildren();

      const span =
        document.createElement(
          "span"
        );

      span.textContent =
        endpoint
          ? "Endpoint entered. Test the Colab connection."
          : "Enter the active Colab endpoint and token.";

      statusElement.appendChild(
        span
      );
    }
  }

  return Boolean(endpoint);
}

export function invalidateColabConnection() {
  const tokenInput =
    document.getElementById(
      "colab-token"
    );

  const statusElement =
    document.getElementById(
      "colab-status"
    );

  /*
   * Keep runtime state synchronized with the field, but invalidate
   * every model discovered using the previous token.
   */
  G.colabBearerToken =
    tokenInput?.value
      ?.trim() || "";

  G.colabModels = [];

  /*
   * Removing the discovered model list disables the Colab model
   * selectors until the user successfully tests the connection
   * again.
   */
  refreshModelDropdowns();

  if (statusElement) {
    statusElement.replaceChildren();

    const span =
      document.createElement(
        "span"
      );

    span.textContent =
      G.colabBearerToken
        ? "Token changed. Test the Colab connection again."
        : "Enter the active Colab endpoint and token.";

    statusElement.appendChild(
      span
    );
  }
}

export async function scanColab() {
  /*
   * This guard exists in addition to the disabled button so direct
   * console calls and stale inline events cannot scan an empty URL.
   */
  if (
    !updateColabScanAvailability()
  ) {
    return false;
  }

  return pingColab();
}

export async function pingColab() {
  const endpointInput =
    document.getElementById("colab-endpoint");

  const tokenInput =
    document.getElementById("colab-token");

  const statusElement =
    document.getElementById("colab-status");

  const endpoint =
    endpointInput?.value
      .trim()
      .replace(/\/+$/, "") || "";

  const bearerToken =
    tokenInput?.value.trim() || "";

  /*
   * Keep the current values in runtime state so the model-call
   * layer can use the exact configuration that was tested.
   */
  G.colabEndpoint = endpoint;
  G.colabBearerToken = bearerToken;

  function setStatus(message, className = "") {
    if (!statusElement) return;

    statusElement.replaceChildren();

    const span = document.createElement("span");

    if (className) {
      span.className = className;
    }

    span.textContent = message;

    statusElement.appendChild(span);
  }

  if (!endpoint) {
    G.colabModels = [];

    setStatus(
      "✗ Enter the Colab endpoint URL.",
      "err",
    );

    refreshModelDropdowns();
    return false;
  }

  if (!/^https?:\/\//i.test(endpoint)) {
    G.colabModels = [];

    setStatus(
      "✗ Colab endpoint must begin with http:// or https://.",
      "err",
    );

    refreshModelDropdowns();
    return false;
  }

  if (!bearerToken) {
    G.colabModels = [];

    setStatus(
      "✗ Enter the Colab bearer token.",
      "err",
    );

    refreshModelDropdowns();
    return false;
  }

  setStatus(
    `⟳ Connecting to ${endpoint}/health...`,
    "spin",
  );

  const controller = new AbortController();
  const timeoutMs = 10_000;

  const timeoutId = window.setTimeout(
    () => controller.abort(),
    timeoutMs,
  );

  try {
    const response = await fetch(
      `${endpoint}/health`,
      {
        method: "GET",

        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${bearerToken}`,
        },

        cache: "no-store",
        signal: controller.signal,
      },
    );

    if (
      response.status === 401 ||
      response.status === 403
    ) {
      G.colabModels = [];

      setStatus(
        `✗ Colab endpoint reachable, but the bearer token was rejected (HTTP ${response.status}).`,
        "err",
      );

      refreshModelDropdowns();
      return false;
    }

    if (!response.ok) {
      G.colabModels = [];

      const statusDescription =
        response.statusText
          ? ` ${response.statusText}`
          : "";

      setStatus(
        `✗ Colab endpoint responded with HTTP ${response.status}${statusDescription}.`,
        "err",
      );

      refreshModelDropdowns();
      return false;
    }

    /*
     * The expected health response may contain either:
     *
     * {
     *   "ok": true,
     *   "model": "Qwen/Qwen3-8B"
     * }
     *
     * or:
     *
     * {
     *   "ok": true,
     *   "models": [
     *     "Qwen/Qwen3-8B",
     *     "meta-llama/Llama-3.1-8B-Instruct"
     *   ]
     * }
     *
     * Object entries such as {"id": "..."} or {"name": "..."}
     * are also accepted.
     */
    let healthData = {};

    try {
      healthData = await response.json();
    } catch {
      /*
       * A plain-text 200 response still proves that the endpoint
       * is reachable and authenticated. It simply advertises no
       * model information.
       */
      healthData = {};
    }

    const advertisedModels = Array.isArray(
      healthData?.models,
    )
      ? healthData.models
      : healthData?.model
        ? [healthData.model]
        : [];

    G.colabModels = [
      ...new Set(
        advertisedModels
          .map((model) => {
            if (typeof model === "string") {
              return model.trim();
            }

            if (
              model &&
              typeof model === "object"
            ) {
              const name =
                model.id ||
                model.name ||
                model.model;

              return typeof name === "string"
                ? name.trim()
                : "";
            }

            return "";
          })
          .filter(Boolean),
      ),
    ];

    if (G.colabModels.length === 1) {
      setStatus(
        `✓ Colab connected and authenticated. Model: ${G.colabModels[0]}.`,
        "ok",
      );
    } else if (G.colabModels.length > 1) {
      setStatus(
        `✓ Colab connected and authenticated. ${G.colabModels.length} models available.`,
        "ok",
      );
    } else {
      setStatus(
        "✓ Colab connected and authenticated, but /health did not advertise a model.",
        "ok",
      );
    }

    refreshModelDropdowns();
    return true;
  } catch (error) {
    G.colabModels = [];

    if (error?.name === "AbortError") {
      setStatus(
        `✗ Colab endpoint unreachable. Health check timed out after ${timeoutMs / 1000} seconds.`,
        "err",
      );
    } else {
      setStatus(
        "✗ Colab endpoint unreachable or blocked by CORS.",
        "err",
      );
    }

    refreshModelDropdowns();
    return false;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

/* ============================================================
   MODEL DROPDOWNS
   ============================================================ */

export function refreshModelDropdowns() {
  const anthropicModels = [
    "claude-sonnet-4-20250514",
    "claude-opus-4-5",
    "claude-haiku-4-5-20251001",
  ];

  let models = [];

  if (G.backend === "ollama") {
    models = Array.isArray(G.ollamaModels)
      ? G.ollamaModels
      : [];
  } else if (G.backend === "colab") {
    models = Array.isArray(G.colabModels)
      ? G.colabModels
      : [];
  } else {
    models = anthropicModels;
  }

  /*
   * Remove invalid, blank, and duplicate entries before placing
   * model identifiers into the DOM.
   */
  models = [
    ...new Set(
      models
        .filter((model) => typeof model === "string")
        .map((model) => model.trim())
        .filter(Boolean),
    ),
  ];

  const selectIds = G.splitModels
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

  selectIds.forEach((id) => {
    const selectElement =
      document.getElementById(id);

    if (!selectElement) return;

    const currentValue =
      selectElement.value;

    selectElement.replaceChildren();

    if (!models.length) {
      const placeholder =
        document.createElement("option");

      placeholder.value = "";
      placeholder.disabled = true;
      placeholder.selected = true;

      if (G.backend === "ollama") {
        placeholder.textContent =
          "No Ollama models discovered";
      } else if (G.backend === "colab") {
        placeholder.textContent =
          "No Colab model discovered";
      } else {
        placeholder.textContent =
          "No models available";
      }

      selectElement.appendChild(placeholder);
      selectElement.disabled = true;

      return;
    }

    selectElement.disabled = false;

    models.forEach((model) => {
      const option =
        document.createElement("option");

      option.value = model;
      option.textContent = model;

      if (model === currentValue) {
        option.selected = true;
      }

      selectElement.appendChild(option);
    });

    /*
     * When switching providers, the previous provider's model
     * usually will not exist in the new list. Select the first
     * valid model in that case.
     */
    if (!models.includes(currentValue)) {
      selectElement.value = models[0];
    }
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