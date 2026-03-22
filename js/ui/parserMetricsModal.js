// filepath: js/ui/parserMetricsModal.js

import { G } from "../core/state.js";

export function openParserMetricsModal() {
  renderParserMetricsModal();
  const modal = document.getElementById("parser-metrics-modal");
  if (modal) modal.style.display = "flex";
}

export function closeParserMetricsModal() {
  const modal = document.getElementById("parser-metrics-modal");
  if (modal) modal.style.display = "none";
}

export function renderParserMetricsModal() {

  const body = document.getElementById("parser-metrics-body");
  const meta = document.getElementById("parser-metrics-meta");

  if (!body || !meta) return;

  // -------------------------------
  // GUARD: metrics not initialized
  // -------------------------------
  if (!G?.parserMetrics) {
    body.innerHTML = '<div class="jm-empty">No parser metrics initialized.</div>';
    meta.textContent = `Cycle ${G.cycle} · no metrics`;
    return;
  }

  const cycles = Object.entries(G.parserMetrics.cycles || {})
    .map(([cycle, m]) => {

      const attempts = m.attempts || 1;

      return {
        cycle: Number(cycle),
        failureRate: m.failures / attempts,
        repairRate: m.repairs / attempts
      };
    })
    .sort((a, b) => a.cycle - b.cycle)
    .slice(-20);

  // -------------------------------
  // GUARD: no cycle data yet
  // -------------------------------
  if (!cycles.length) {
    body.innerHTML = '<div class="jm-empty">No parser data yet.</div>';
    meta.textContent = `Cycle ${G.cycle} · 0 entries`;
    return;
  }

  function rollingAvg(data, index, key, window = 5) {
    const start = Math.max(0, index - window + 1);
    const slice = data.slice(start, index + 1);
    const sum = slice.reduce((acc, d) => acc + (d[key] || 0), 0);
    return sum / slice.length;
  }

  function isSpike(value, avg) {
    return avg > 0 && value > avg * 2;
  }

  const rows = cycles.map((c, i) => {

    const fAvg = rollingAvg(cycles, i, "failureRate");
    const rAvg = rollingAvg(cycles, i, "repairRate");

    const fSpike = isSpike(c.failureRate, fAvg);
    const rSpike = isSpike(c.repairRate, rAvg);

    return `
      <div class="jm-entry">
        <div class="jm-entry-header">
          CYCLE ${c.cycle}
        </div>
        <div class="jm-entry-body">
          failure: ${(c.failureRate * 100).toFixed(1)}%
          (avg ${(fAvg * 100).toFixed(1)}%)
          ${fSpike ? "[SPIKE]" : ""}

          <br>

          repair: ${(c.repairRate * 100).toFixed(1)}%
          (avg ${(rAvg * 100).toFixed(1)}%)
          ${rSpike ? "[SPIKE]" : ""}
        </div>
      </div>
    `;
  });

  body.innerHTML = rows.join("");

  meta.textContent =
    `Cycle ${G.cycle} · ${cycles.length} entries · repairLevel ${G.parserConfig?.repairLevel ?? 1}`;
}