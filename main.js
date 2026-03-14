"use strict";

// main.js
// Root module loader + global bridge for inline HTML handlers


// ============================================================
// ENGINE
// ============================================================

import {
  processSimJournalCycle,
  executeMain
} from "./js/engine/cycle.js";

import {
  parseAndValidateStateBlock
} from "./js/engine/validators.js";

import {
  runAutonomousInterSim
} from "./js/engine/comms.js";


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
  selTarget,
  selMode,
  setFrom,
  toggleTo,
  sendInterSimUI
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


// ---------- ENGINE ----------

window.processSimJournalCycle = processSimJournalCycle;
window.executeMain = executeMain;
window.runAutonomousInterSim = runAutonomousInterSim;


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

window.selTarget = selTarget;
window.selMode = selMode;

window.setFrom = setFrom;
window.toggleTo = toggleTo;
window.sendInterSim = sendInterSimUI;


// ---------- BOOT ----------

window.bootAM = bootAM;
window.updateVaultDisplay = updateVaultDisplay;
window.bootLog = bootLog;


// ---------- VALIDATORS ----------

window.parseAndValidateStateBlock = parseAndValidateStateBlock;


// ============================================================
// DEBUG / CONSOLE ACCESS
// ============================================================

window.AM_DEBUG = {
  executeMain,
  renderSims,
  renderRelationships,
  runAutonomousInterSim,
  timelineEvent,
  addLog
};


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