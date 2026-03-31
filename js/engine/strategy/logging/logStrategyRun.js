// js/engine/strategy/logging/logStrategyRun.js

import { G } from "../../../core/state.js";

/* ============================================================
   STRATEGY RUN LOGGER (SESSION-BASED, STAGE-AWARE)

   PURPOSE:
   - Track runs per session
   - Allow incremental stage logging
   - Assemble full event at finalize
   - Enable replay + CI evolution

============================================================ */

/* ============================================================
   SESSION MANAGEMENT
============================================================ */

function createSession() {

  const timestamp = Date.now();
  const sessionId = `strategy_session_${timestamp}`;

  const sessionData = {
    session: {
      sessionId,
      startedAt: timestamp,
      totalRuns: 0
    },
    runs: []
  };

  localStorage.setItem(sessionId, JSON.stringify(sessionData));

  return sessionId;
}

function getSessionId() {
  if (!G.strategySessionId) {
    G.strategySessionId = createSession();
  }
  return G.strategySessionId;
}

function readSession(sessionId) {
  const raw = localStorage.getItem(sessionId);
  return raw ? JSON.parse(raw) : null;
}

function writeSession(sessionId, data) {
  localStorage.setItem(sessionId, JSON.stringify(data));
}

/* ============================================================
   RUN LIFECYCLE (NEW)
============================================================ */

/**
 * Initialize a new run
 */
export function startStrategyRun(rawText, { DEBUG = false } = {}) {

  G._currentStrategyRun = {
    runId: Date.now(),
    timestamp: Date.now(),
    cycle: G.cycle,
    input: {
      raw: rawText,
      cleaned: null
    },
    stages: [],
    final: null
  };

  if (DEBUG) {
    console.debug("[LOG] run started", G._currentStrategyRun.runId);
  }
}

/**
 * Attach cleaned input
 */
export function setCleanedInput(cleaned) {
  if (G._currentStrategyRun) {
    G._currentStrategyRun.input.cleaned = cleaned;
  }
}

/**
 * Log a stage
 */
export function logStrategyStage(stageName, data, { DEBUG = false } = {}) {

  if (!G._currentStrategyRun) return;

  G._currentStrategyRun.stages.push({
    stage: stageName,
    ...data
  });

  if (DEBUG) {
    console.debug(`[LOG] stage recorded: ${stageName}`);
  }
}

/**
 * Finalize and persist run
 */
export function finalizeStrategyRun(finalData, { DEBUG = false } = {}) {

  try {

    if (!G._currentStrategyRun) {
      console.warn("[LOG] no active run to finalize");
      return;
    }

    const run = {
      ...G._currentStrategyRun,
      final: finalData
    };

    const sessionId = getSessionId();
    const sessionData = readSession(sessionId);

    if (!sessionData) {
      console.warn("[LOG] session missing, recreating");
      G.strategySessionId = createSession();
      return;
    }

    /* ------------------------------------------------------------
       APPEND RUN
    ------------------------------------------------------------ */

    sessionData.runs.push(run);
    sessionData.session.totalRuns += 1;

    /* ------------------------------------------------------------
       WRITE BACK (ATOMIC)
    ------------------------------------------------------------ */

    writeSession(sessionId, sessionData);

    if (DEBUG) {
      console.debug("[LOG] run finalized", {
        sessionId,
        totalRuns: sessionData.session.totalRuns
      });
    }

    /* ------------------------------------------------------------
       CLEANUP
    ------------------------------------------------------------ */

    G._currentStrategyRun = null;

  } catch (err) {
    console.error("[LOG] failed to finalize run:", err.message);
  }
}