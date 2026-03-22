// filepath: js/engine/strategy/analysis/parserMetricsVisualizer.js

export function visualizeParserCycle(cycle, G) {

  const metrics = G.parserMetrics?.cycles?.[cycle];
  const totals = G.parserMetrics?.totals || {};
  const repairLevel = G.parserConfig?.repairLevel ?? 1;

  if (!metrics) {
    console.warn("[VISUALIZER] No metrics for cycle", cycle);
    return;
  }

  const attempts = metrics.attempts || 1;
  const success = metrics.success || 0;
  const failures = metrics.failures || 0;
  const repairs = metrics.repairs || 0;

  const successRate = (success / attempts).toFixed(2);
  const failureRate = (failures / attempts).toFixed(2);
  const repairRate = (repairs / attempts).toFixed(2);

  // -----------------------------
  // dominant error
  // -----------------------------
  let dominantError = "none";
  let maxError = 0;

  for (const [type, count] of Object.entries(metrics.errorTypes || {})) {
    if (count > maxError) {
      dominantError = type;
      maxError = count;
    }
  }

  // -----------------------------
  // most used extractor
  // -----------------------------
  let topExtractor = "none";
  let maxUsage = 0;

  for (const [name, count] of Object.entries(metrics.extractorUsage || {})) {
    if (count > maxUsage) {
      topExtractor = name;
      maxUsage = count;
    }
  }

  // -----------------------------
  // OUTPUT
  // -----------------------------
  console.group(`📊 [PARSER][CYCLE ${cycle}]`);

  console.table({
    attempts,
    success,
    failures,
    repairs,
    successRate,
    failureRate,
    repairRate,
    repairLevel
  });

  console.log("Dominant Error:", dominantError);
  console.log("Top Extractor:", topExtractor);

  console.log("Error Breakdown:", metrics.errorTypes);
  console.log("Extractor Usage:", metrics.extractorUsage);

  console.groupEnd();
}