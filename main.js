"use strict";

// main.js
// Root module loader + global bridge for inline HTML handlers


// ============================================================
// ENGINE
// ============================================================

import {
  executeMain
} from "./js/engine/cycle.js";

import { G } from "./js/core/state.js";
import { exportState, importState } from "./js/core/saveLoad.js";
import {
  exportTape,
  getMode,
  importTape,
  isValidTapeData,
  TAPE_MODES,
} from "./js/core/replayTape.js";
import { downloadTextFile } from "./js/utils/downloadTextFile.js";

import {
  runCommsCycle
} from "./js/engine/comms/orchestrator.js";


// ============================================================
// VALIDATORS
// ============================================================

import {
  parseAndValidateStateBlock
} from "./js/engine/state/validate.js";

// ============================================================
// UI — EVENTS / CONTROLS
// ============================================================

import {
  showBeliefDelta,
  toggleLogDisclosure,
  setVisibility,
  setBackend,
  toggleSplit,
  scanOllama,
  scanColab,
  updateColabScanAvailability,
  invalidateColabConnection,
  syncSetupConfiguration,
  initLogDialogs,
  selTarget,
  selMode,
  setTapeMode,
  setFrom,
  toggleTo,
} from "./js/ui/events.js";



// ============================================================
// UI — RENDER
// ============================================================

import {
  renderSims,
  openPlansModal,
  closePlansModal,
  viewInterSimLog,
  closeInterSimModal,
  appendJournalEntry,
  updateSimDisplay,
  showWriting,
  openJournal,
  closeJournal,
  switchJournalSim,
  renderJournalModal,
  exportJournal,
  exportSimJournal,
  openAssessmentModal,
  closeAssessmentModal,
} from "./js/ui/render.js";

import {
  openParserMetricsModal,
  closeParserMetricsModal
} from "./js/ui/parserMetricsModal.js";

// ============================================================
// UI — COGNITION
// ============================================================

import {
  openCognitionModal,
  closeCognitionModal,
  switchCognitionSim,
  switchCognitionOverview,
  renderCognitionModal,
} from "./js/ui/cognitionModal.js";

// ============================================================
// UI — RELATIONSHIPS
// ============================================================

import {
  renderRelationships
} from "./js/ui/relationships.js";


// ============================================================
// UI — TIMELINE
// ============================================================

import {
  timelineEvent,
  timelineClear
} from "./js/ui/timeline.js";


// ============================================================
// UI — LOGGING
// ============================================================

import {
  addLog,
  exportPlans,
  exportInterSimLog,
  exportInterSimLogTxt,
  exportTransmissionLog,
  exportAssessments
} from "./js/ui/logs.js";


// ============================================================
// UI — SESSION EXPORT
// ============================================================

import {
  openSessionModal,
  closeSessionModal,
  exportSession,
  exportTacticHeatmap
} from "./js/ui/export.js";


// ============================================================
// UI — BOOT
// ============================================================

import {
  updateVaultDisplay,
  bootLog,
  bootAM
} from "./js/ui/boot.js";


// ============================================================
// GLOBAL BRIDGE
// Allows inline HTML onclick handlers to access module functions
// ============================================================

initLogDialogs();


// ---------- ENGINE ----------


window.executeMain = executeMain;
window.runCommsCycle = runCommsCycle;

window.saveRun = saveRun;
window.loadRun = loadRun;
window.loadTape = loadTape;
window.saveTape = saveTape;
window.setTapeMode = setTapeMode;
window.enterControlRoom = enterControlRoom;


// ---------- RENDER ----------

window.renderSims = renderSims;
window.renderRelationships = renderRelationships;

window.openPlansModal = openPlansModal;
window.closePlansModal = closePlansModal;
window.openAssessmentModal = openAssessmentModal;
window.closeAssessmentModal = closeAssessmentModal;

window.viewInterSimLog = viewInterSimLog;
window.closeInterSimModal = closeInterSimModal;

window.appendJournalEntry = appendJournalEntry;
window.updateSimDisplay = updateSimDisplay;
window.showWriting = showWriting;

// Metric Modal
window.openParserMetricsModal = openParserMetricsModal;
window.closeParserMetricsModal = closeParserMetricsModal;

// ---------- COGNITION MODAL ----------

window.openCognitionModal = openCognitionModal;
window.closeCognitionModal = closeCognitionModal;
window.switchCognitionSim = switchCognitionSim;
window.switchCognitionOverview = switchCognitionOverview;
window.renderCognitionModal = renderCognitionModal;

// ---------- JOURNAL MODAL ----------

window.openJournal = openJournal;
window.closeJournal = closeJournal;
window.switchJournalSim = switchJournalSim;
window.renderJournalModal = renderJournalModal;

window.exportJournal = exportJournal;
window.exportSimJournal = exportSimJournal;


// ---------- LOGGING ----------

window.addLog = addLog;

window.exportPlans = exportPlans;
window.exportAssessments = exportAssessments;

window.exportInterSimLog = exportInterSimLog;
window.exportInterSimLogTxt = exportInterSimLogTxt;
window.exportTransmissionLog = exportTransmissionLog;


// ---------- SESSION EXPORT ----------

window.openSessionModal = openSessionModal;
window.closeSessionModal = closeSessionModal;
window.exportSession = exportSession;
window.exportTacticHeatmap = exportTacticHeatmap;


// ---------- TIMELINE ----------

window.timelineEvent = timelineEvent;
window.timelineClear = timelineClear;


// ---------- UI EVENTS ----------

window.showBeliefDelta = showBeliefDelta;
window.toggleLogDisclosure = toggleLogDisclosure;

window.setVisibility = setVisibility;
window.setBackend = setBackend;
window.toggleSplit = toggleSplit;
window.scanOllama = scanOllama;
window.scanColab = scanColab;
window.updateColabScanAvailability =
  updateColabScanAvailability;
window.invalidateColabConnection =
  invalidateColabConnection;

window.selTarget = selTarget;
window.selMode = selMode;

window.setFrom = setFrom;
window.toggleTo = toggleTo;


// ---------- BOOT ----------

let prisonInitialized = false;

function setCycleControlsEnabled(enabled) {
  document
    .querySelectorAll(
      ".target-row button, .mode-row button, #ctrl-ta, #save-run-btn, #exec-btn",
    )
    .forEach((control) => {
      control.disabled = !enabled;
    });
}

function setTapeControlsEnabled(enabled) {
  for (const id of [
    "tape-mode-select",
    "load-tape-btn",
    "save-tape-btn",
  ]) {
    const control = document.getElementById(id);
    if (control) control.disabled = !enabled;
  }
}

function setControlFeedback(message, kind = "info") {
  const feedback = document.getElementById("control-feedback");
  if (!feedback) return;
  feedback.textContent = message;
  feedback.dataset.kind = kind;
}

function openControlDialog(title, message, {
  confirmLabel = "CONTINUE",
  cancelLabel = "CANCEL",
} = {}) {
  const dialog = document.getElementById("control-dialog");
  const titleElement = document.getElementById("control-dialog-title");
  const messageElement = document.getElementById("control-dialog-message");
  const confirmButton = document.getElementById("control-dialog-confirm");
  const cancelButton = document.getElementById("control-dialog-cancel");

  if (
    !dialog ||
    !titleElement ||
    !messageElement ||
    !confirmButton ||
    !cancelButton ||
    typeof dialog.showModal !== "function" ||
    dialog.open
  ) {
    setControlFeedback(message, "warning");
    return Promise.resolve(false);
  }

  titleElement.textContent = title;
  messageElement.textContent = message;
  confirmButton.textContent = confirmLabel;
  cancelButton.hidden = cancelLabel === null;
  if (cancelLabel !== null) cancelButton.textContent = cancelLabel;
  dialog.returnValue = "";

  const result = new Promise((resolve) => {
    dialog.addEventListener(
      "close",
      () => resolve(dialog.returnValue === "confirm"),
      { once: true },
    );
  });

  confirmButton.onclick = () => dialog.close("confirm");
  cancelButton.onclick = () => dialog.close("cancel");
  dialog.showModal();
  return result;
}

function completePrisonInitialization(statusText = "AM ACTIVE") {
  prisonInitialized = true;
  const button = document.getElementById("init-btn");
  button?.remove();
  setCycleControlsEnabled(true);
  const status = document.getElementById("prison-status");
  if (status) status.textContent = statusText;
  document.getElementById("cold-start-message")?.remove();
}

function enterControlRoom() {
  const setup = document.getElementById("setup");
  const app = document.getElementById("app");
  if (!setup || !app) return;

  setCycleControlsEnabled(false);
  setup.style.display = "none";
  app.classList.add("visible");
  setControlFeedback(
    "Choose OFF, RECORD, or load a tape and choose REPLAY before initialization.",
  );
}

async function initializePrison() {
  const button = document.getElementById("init-btn");
  if (!button || button.disabled || prisonInitialized) return false;

  if (
    getMode() === TAPE_MODES.REPLAY &&
    exportTape().entries.length === 0
  ) {
    setControlFeedback(
      "REPLAY needs a loaded tape. Load one before initializing Cycle 0.",
      "warning",
    );
    return false;
  }

  button.disabled = true;
  const confirmed = await openControlDialog(
    "INITIALIZE PRISON",
    "This will initialize the prisoners and begin Cycle 0 communication. Ensure Tape Mode is set correctly. Continue?",
    { confirmLabel: "INITIALIZE" },
  );
  if (!confirmed) {
    button.disabled = false;
    return false;
  }

  setTapeControlsEnabled(false);
  setControlFeedback("Cycle 0 communication is initializing…");

  let initialized = false;
  try {
    initialized = await bootAM();
  } catch (error) {
    console.error("[BOOT] Cycle 0 initialization failed:", error);
    button.disabled = false;
    setTapeControlsEnabled(true);
    setControlFeedback(
      `Cycle 0 stopped: ${error.message}. Check the boot log and tape, then retry.`,
      "error",
    );
    return false;
  }

  if (!initialized) {
    button.disabled = false;
    setTapeControlsEnabled(true);
    setControlFeedback(
      "Initialization did not complete. Check the boot log, then retry.",
      "warning",
    );
    return false;
  }

  completePrisonInitialization();
  setTapeControlsEnabled(true);
  const tapeCount = exportTape().entries.length;
  setControlFeedback(
    getMode() === TAPE_MODES.REPLAY
      ? `Cycle 0 replay completed from ${tapeCount} loaded tape entr${tapeCount === 1 ? "y" : "ies"}.`
      : getMode() === TAPE_MODES.RECORD
        ? `Cycle 0 completed. ${tapeCount} model response${tapeCount === 1 ? "" : "s"} recorded.`
        : "Cycle 0 completed. Tape recording is off.",
    "success",
  );
  return true;
}

window.initializePrison = initializePrison;
window.bootAM = bootAM;
window.updateVaultDisplay = updateVaultDisplay;
window.bootLog = bootLog;

function saveTape() {
  try {
    const tape = exportTape();
    if (tape.entries.length === 0) {
      setControlFeedback("There are no recorded responses to save.", "warning");
      return;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    downloadTextFile(
      `am_tape_${timestamp}.json`,
      JSON.stringify(tape, null, 2),
    );
    setControlFeedback(
      `Saved ${tape.entries.length} tape entr${tape.entries.length === 1 ? "y" : "ies"}, including model provenance.`,
      "success",
    );
  } catch (error) {
    console.error("[TAPE] Failed to save tape:", error);
    setControlFeedback(`Unable to save tape: ${error.message}`, "error");
  }
}

function loadTape() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,application/json";
  input.hidden = true;
  document.body.appendChild(input);

  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    input.remove();
    if (!file) return;

    const confirmed = await openControlDialog(
      "LOAD TAPE",
      `Load ${file.name}? This replaces the current tape entries only; simulation state will not change.`,
      { confirmLabel: "LOAD TAPE" },
    );
    if (!confirmed) return;

    const reader = new FileReader();
    reader.onerror = () => {
      setControlFeedback("Unable to read the selected tape file.", "error");
    };
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result ?? ""));
        const tapeData = isValidTapeData(parsed)
          ? parsed
          : parsed?.tape;

        if (!isValidTapeData(tapeData)) {
          throw new Error("File does not contain a valid replay tape.");
        }

        importTape(tapeData);
        updateTapeEntryCount();
        setControlFeedback(
          `Tape loaded with ${tapeData.entries.length} entr${tapeData.entries.length === 1 ? "y" : "ies"}. Select REPLAY before initialization to avoid live model calls.`,
          "success",
        );
      } catch (error) {
        setControlFeedback(`Unable to load tape: ${error.message}`, "error");
      }
    };
    reader.readAsText(file);
  });

  input.click();
}

function updateTapeEntryCount() {
  const count = exportTape().entries.length;
  const countElement = document.getElementById("tape-entry-count");
  if (countElement) {
    countElement.textContent = `${count} ${count === 1 ? "ENTRY" : "ENTRIES"}`;
  }
  return count;
}


// ---------- VALIDATORS ----------

window.parseAndValidateStateBlock = parseAndValidateStateBlock;


// ============================================================
// DEBUG / CONSOLE ACCESS
// ============================================================

window.G = G;

window.AM_DEBUG = {
  G,
  executeMain,
  renderSims,
  renderRelationships,
  runCommsCycle,
  timelineEvent,
  addLog,
  pendingPsychEvidence: () => G.pendingPsychEvidence,
  evidenceArchive: () => G.evidenceArchive,
  debugTrace: () => G.debugTrace.slice(-10),
};


function saveRun() {
  try {
    const json = exportState();
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    downloadTextFile(`am_run_cycle_${G.cycle}_${timestamp}.json`, json);
  } catch (error) {
    console.error("[SAVE] Failed to save run:", error);
    setControlFeedback(`Unable to save run: ${error.message}`, "error");
  }
}

function loadRun() {
  if (prisonInitialized) return;

  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,application/json";
  input.hidden = true;
  document.body.appendChild(input);

  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    input.remove();
    if (!file) return;

    const confirmed = await openControlDialog(
      "START SESSION FROM SAVE",
      `Start your session from ${file.name}? This restores the saved state, backend configuration, and tape.`,
      { confirmLabel: "START SESSION" },
    );
    if (!confirmed) return;

    const setupLoadButton = document.getElementById("setup-load-run-btn");
    if (setupLoadButton) setupLoadButton.disabled = true;
    setCycleControlsEnabled(false);
    setTapeControlsEnabled(false);

    const restoreControls = () => {
      setCycleControlsEnabled(false);
      setTapeControlsEnabled(true);
      if (setupLoadButton) setupLoadButton.disabled = false;
    };

    const reader = new FileReader();
    reader.onerror = () => {
      setControlFeedback("Unable to read the selected save file.", "error");
      restoreControls();
    };
    reader.onload = async () => {
      let loaded = false;
      try {
        await importState(String(reader.result ?? ""));
        renderSims();
        renderRelationships();
        updateVaultDisplay();
        updateTapeEntryCount();
        syncSetupConfiguration();
        enterControlRoom();
        completePrisonInitialization("RUN RESTORED");
        setControlFeedback(
          "Run restored. Set Tape Mode to REPLAY to replay recorded responses, or RECORD to continue.",
          "success",
        );
        loaded = true;
      } catch (error) {
        console.error("[LOAD] Failed to load run:", error);
        setControlFeedback(`Unable to load run: ${error.message}`, "error");
      } finally {
        if (!loaded) restoreControls();
        else {
          setTapeControlsEnabled(true);
          if (setupLoadButton) setupLoadButton.disabled = false;
        }
      }
    };
    reader.readAsText(file);
  });

  input.click();
}

// ============================================================
// DEBUG BOOT MESSAGE
// ============================================================

console.log("AM Torment Engine modules loaded.");


// ============================================================
// SANITY CHECKS
// Helps detect missing bridges quickly
// ============================================================

const requiredGlobals = [
  "bootAM",
  "executeMain",
  "renderSims",
  "addLog",
  "timelineEvent"
];

requiredGlobals.forEach(fn => {
  if (!window[fn]) {
    console.warn(`[BOOT WARNING] window.${fn} not attached.`);
  }
});
