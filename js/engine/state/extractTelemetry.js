// js/engine/state/extractTelemetry.js

// Import-free leaf module: exports a single dependency-injected factory.
// Contains no base-parser logic, no global lookups beyond injected deps,
// and no console output. All telemetry behavior lives here, supplied the
// parsers and shared state through explicit dependencies.

export function createExtractionTelemetry(deps) {
  const {
    G,
    parseStatDeltas,
    parseBeliefUpdates,
    getLastBeliefParseMethod,
    performanceNow,
    dateNow,
  } = deps;

  /**
   * Record a single extraction outcome for later analysis.
   */
  function recordExtractionOutcome(simId, fieldType, details = {}) {
    if (!G || !G.extractionStats) return;

    const cycle = details.cycle ?? (G.cycle ?? 0);

    if (!G.extractionStats.cycles[cycle]) {
      G.extractionStats.cycles[cycle] = [];
    }

    G.extractionStats.cycles[cycle].push({
      simId,
      fieldType,
      parseMethod: details.parseMethod ?? "unknown",
      durationMs: details.durationMs ?? 0,
      keysRecovered: details.keysRecovered ?? 0,
      timestamp: dateNow()
    });
  }

  /**
   * Parse stat deltas and record extraction outcome.
   */
  function parseStatDeltasWithStats(text, sim) {
    const start = performanceNow();
    const result = parseStatDeltas(text, sim);
    const duration = performanceNow() - start;

    const keysRecovered =
      ["suffering", "hope", "sanity"].filter(
        (key) => result._parseMethod !== "none"
      ).length;

    recordExtractionOutcome(sim.id, "stats", {
      parseMethod: result._parseMethod ?? "direct",
      durationMs: Math.round(duration),
      keysRecovered
    });
    return result;
  }

  /**
   * Parse belief updates and record extraction outcome.
   * Reads the last belief parse method after the parser call.
   */
  function parseBeliefUpdatesWithStats(text, sim) {
    const start = performanceNow();
    const updates = parseBeliefUpdates(text, sim);
    const duration = performanceNow() - start;

    recordExtractionOutcome(sim.id, "belief_deltas", {
      parseMethod: getLastBeliefParseMethod(),
      durationMs: Math.round(duration),
      keysRecovered: Object.keys(updates).length
    });

    return updates;
  }

  return {
    recordExtractionOutcome,
    parseStatDeltasWithStats,
    parseBeliefUpdatesWithStats
  };
}
