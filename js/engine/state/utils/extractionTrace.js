// js/engine/state/utils/extractionTrace.js

export function createExtractionTrace(simId, fieldType) {
  const steps = [];

  function record(state, status, details = {}) {
    steps.push({
      state,
      status,
      ...details,
    });
  }

  return {
    enter(state, details) {
      record(state, "enter", details);
    },

    success(state, details) {
      record(state, "success", details);
    },

    failure(state, details) {
      record(state, "failure", details);
    },

    finish(method, details = {}) {
      record("FINISH", method, details);

      console.groupCollapsed(
        `[EXTRACTION FSM][${simId}][${fieldType}] ${method}`
      );
      console.table(steps);
      console.groupEnd();

      return {
        method,
        steps,
      };
    },
  };
}