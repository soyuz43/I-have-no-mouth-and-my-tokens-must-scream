import { G } from "./state.js";
import { Exporter } from "../utils/exporter/state.js";
import {
  isCycleRunning,
  waitForCycleIdle,
} from "../engine/cycle.js";
import {
  getModelQueueStatus,
  waitForModelQueueIdle,
} from "../models/modelQueue.js";

const SAVE_SCHEMA_VERSION = 1;
const ENGINE_VERSION = "1.0.0";

export function exportState() {
  const queueStatus = getModelQueueStatus();

  if (
    G.autoRunning ||
    isCycleRunning() ||
    queueStatus.active > 0 ||
    queueStatus.pending > 0
  ) {
    throw new Error("Save is only available at an idle cycle boundary.");
  }

  const gameSnapshot = { ...G };
  delete gameSnapshot.colabBearerToken;
  delete gameSnapshot.autoTimer;
  delete gameSnapshot.research;

  try {
    assertJsonCompatible(gameSnapshot, "G");
    assertJsonCompatible(Exporter, "Exporter");

    const envelope = {
      schemaVersion: SAVE_SCHEMA_VERSION,
      engineVersion: ENGINE_VERSION,
      savedAt: Date.now(),
      cycle: G.cycle,
      G: structuredClone(gameSnapshot),
      Exporter: structuredClone(Exporter),
    };

    return JSON.stringify(envelope);
  } catch (error) {
    throw new Error(`Unable to serialize the current run: ${error.message}`, {
      cause: error,
    });
  }
}

export async function importState(jsonString, { game = G, exporter = Exporter } = {}) {
  const envelope = JSON.parse(jsonString);

  if (
    !envelope ||
    envelope.schemaVersion !== SAVE_SCHEMA_VERSION ||
    typeof envelope.engineVersion !== "string" ||
    !Number.isFinite(envelope.savedAt) ||
    !Number.isFinite(envelope.cycle) ||
    envelope.cycle < 0 ||
    !isRecord(envelope.G) ||
    envelope.G.cycle !== envelope.cycle ||
    !isRecord(envelope.G.sims) ||
    !isRecord(envelope.Exporter) ||
    !isRecord(envelope.Exporter.buffers)
  ) {
    throw new Error("Invalid save file or unsupported schema version.");
  }

  const restoredGame = structuredClone(envelope.G);
  const restoredExporter = structuredClone(envelope.Exporter);

  if (Object.hasOwn(restoredGame, "__proto__")) {
    throw new Error("Invalid save file: reserved state key.");
  }

  delete restoredGame.colabBearerToken;
  delete restoredGame.autoTimer;
  delete restoredGame.research;

  haltAutoRun(game);
  await waitForCycleIdle();
  await waitForModelQueueIdle();

  const runtimeResearch = game.research;
  replaceObjectContents(game, restoredGame);
  replaceObjectContents(exporter, restoredExporter);

  game.colabBearerToken = "";
  game.autoRunning = false;
  game.autoTimer = null;
  if (envelope.cycle > 0 || restoredExporter.runId) {
    game._exporterInitialized = true;
  }
  if (runtimeResearch !== undefined) {
    game.research = runtimeResearch;
  }

  resetUiState(game);
  return game;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertJsonCompatible(value, path, ancestors = new WeakSet()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`Unsupported non-finite number at ${path}.`);
    }
    return;
  }

  if (typeof value !== "object") {
    throw new TypeError(`Unsupported ${typeof value} value at ${path}.`);
  }

  if (value instanceof Map || value instanceof Set) {
    throw new TypeError(`Unsupported ${value.constructor.name} value at ${path}.`);
  }

  const isArray = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (!isArray && prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`Unsupported object type at ${path}.`);
  }

  if (ancestors.has(value)) {
    throw new TypeError(`Unsupported circular reference at ${path}.`);
  }
  ancestors.add(value);

  if (isArray) {
    for (let index = 0; index < value.length; index++) {
      if (!Object.hasOwn(value, index)) {
        throw new TypeError(`Unsupported sparse array entry at ${path}[${index}].`);
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor)) {
        throw new TypeError(`Unsupported accessor at ${path}[${index}].`);
      }
      assertJsonCompatible(descriptor.value, `${path}[${index}]`, ancestors);
    }

    for (const key of Reflect.ownKeys(value)) {
      if (key === "length" || (typeof key === "string" && isArrayIndex(key, value.length))) {
        continue;
      }
      throw new TypeError(`Unsupported array property at ${path}.${String(key)}.`);
    }
  } else {
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key === "symbol") {
        throw new TypeError(`Unsupported symbol key at ${path}.`);
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !("value" in descriptor)) {
        throw new TypeError(`Unsupported non-JSON property at ${path}.${key}.`);
      }
      assertJsonCompatible(descriptor.value, `${path}.${key}`, ancestors);
    }
  }

  ancestors.delete(value);
}

function isArrayIndex(key, length) {
  const index = Number(key);
  return Number.isInteger(index) && index >= 0 && index < length && String(index) === key;
}

function replaceObjectContents(target, source) {
  for (const key of Object.keys(target)) {
    delete target[key];
  }

  for (const key of Object.keys(source)) {
    Object.defineProperty(target, key, {
      configurable: true,
      enumerable: true,
      writable: true,
      value: source[key],
    });
  }
}

function haltAutoRun(game) {
  if (game.autoTimer != null) {
    clearTimeout(game.autoTimer);
  }

  game.autoTimer = null;
  game.autoRunning = false;

  if (game === G) {
    const executeButton = globalThis.document?.getElementById("exec-btn");
    if (executeButton) {
      executeButton.textContent = "⚡ EXECUTE ⚡";
      executeButton.classList.remove("running");
    }
  }
}

function resetUiState(game) {
  const simIds = Object.keys(game.sims || {});
  game.journalModalSim = simIds[0] || "TED";
  game.cognitionModalSim = simIds[0] || "TED";
  game.cognitionModalView = "sim";
  game.cognitionHighlights = Object.fromEntries(
    simIds.map((simId) => [simId, { cycle: null, changes: [] }]),
  );

  const document = globalThis.document;
  if (!document) return;

  for (const id of [
    "intersim-modal",
    "journal-modal",
    "cognition-modal",
    "session-modal",
  ]) {
    const modal = document.getElementById(id);
    if (!modal) continue;
    modal.classList?.remove("open");
  }

  for (const id of [
    "plans-modal",
    "assessment-modal",
    "parser-metrics-modal",
  ]) {
    const modal = document.getElementById(id);
    if (modal?.style) modal.style.display = "none";
  }
}
