// filepath: js/engine/strategy/analysis/parserMetricsVisualizer.js

function safeRate(numerator, denominator) {
  if (
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    denominator <= 0
  ) {
    return "0.00";
  }

  return (numerator / denominator).toFixed(2);
}

export function visualizeParserCycle(cycle, G) {
  const metrics =
    G.parserMetrics?.cycles?.[cycle];

  const repairLevel =
    G.parserConfig?.repairLevel ?? 1;

  if (!metrics) {
    console.warn(
      "[VISUALIZER] No metrics for cycle",
      cycle
    );
    return;
  }

  /*
   * attempts counts extractStrategy() passes.
   *
   * success counts successful individual extractor outputs,
   * not successful strategy-pipeline runs.
   *
   * pipelineSuccess and pipelineFailures describe the terminal
   * result of the extraction operation for this cycle.
   */
  const extractionPasses =
    metrics.attempts || 0;

  const pipelineSuccesses =
    metrics.pipelineSuccess || 0;

  const pipelineFailures =
    metrics.pipelineFailures ??
    metrics.failures ??
    0;

  const pipelineRuns =
    pipelineSuccesses +
    pipelineFailures;

  const extractorUsage =
    metrics.extractorUsage || {};

  const extractorAttempts =
    Object.values(extractorUsage).reduce(
      (sum, count) =>
        sum + (Number(count) || 0),
      0
    );

  const extractorSuccesses =
    metrics.success || 0;

  const extractorFailures =
    Math.max(
      0,
      extractorAttempts -
        extractorSuccesses
    );

  const repairs =
    metrics.repairs || 0;

  const pipelineSuccessRate =
    safeRate(
      pipelineSuccesses,
      pipelineRuns
    );

  const pipelineFailureRate =
    safeRate(
      pipelineFailures,
      pipelineRuns
    );

  const extractorSuccessRate =
    safeRate(
      extractorSuccesses,
      extractorAttempts
    );

  const repairRate =
    safeRate(
      repairs,
      pipelineRuns
    );

  let dominantError = "none";
  let maxError = 0;

  for (const [type, count] of Object.entries(
    metrics.errorTypes || {}
  )) {
    if (count > maxError) {
      dominantError = type;
      maxError = count;
    }
  }

  let topExtractor = "none";
  let maxUsage = 0;

  for (const [name, count] of Object.entries(
    extractorUsage
  )) {
    if (count > maxUsage) {
      topExtractor = name;
      maxUsage = count;
    }
  }

  console.group(
    `[PARSER][CYCLE ${cycle}]`
  );

  console.table({
    pipelineRuns,
    extractionPasses,
    pipelineSuccesses,
    pipelineFailures,
    extractorAttempts,
    extractorSuccesses,
    extractorFailures,
    repairs,
    pipelineSuccessRate,
    pipelineFailureRate,
    extractorSuccessRate,
    repairRate,
    repairLevel
  });

  console.log(
    "Dominant Error:",
    dominantError
  );

  console.log(
    "Top Extractor:",
    topExtractor
  );

  console.log(
    "Error Breakdown:",
    metrics.errorTypes
  );

  console.log(
    "Extractor Usage:",
    extractorUsage
  );

  console.groupEnd();
}