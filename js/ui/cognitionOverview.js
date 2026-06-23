
// js/ui/cognitionOverview.js

import { SIM_IDS } from "../core/constants.js";
import { escapeHtml } from "../core/utils.js";
import {
  getExporterOverviewData,
} from "../utils/exporter.js";

const MAX_TACTIC_ROWS = 12;
const MAX_ATTENTION_ITEMS = 6;

function isRecord(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function asArray(value) {
  return Array.isArray(value)
    ? value
    : [];
}

function finiteOrNull(value) {
  if (
    value === null ||
    value === undefined ||
    (
      typeof value === "string" &&
      value.trim().length === 0
    )
  ) {
    return null;
  }

  const number =
    Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}

function normalizeConfidence(value) {
  const number = finiteOrNull(value);

  if (number === null) {
    return null;
  }

  if (
    number >= 0 &&
    number <= 1
  ) {
    return number;
  }

  if (
    number > 1 &&
    number <= 100
  ) {
    return number / 100;
  }

  return Math.max(
    0,
    Math.min(1, number)
  );
}

function formatNumber(
  value,
  digits = 1
) {
  const number = finiteOrNull(value);

  return number === null
    ? "—"
    : number.toFixed(digits);
}

function formatSigned(
  value,
  digits = 1
) {
  const number = finiteOrNull(value);

  if (number === null) {
    return "—";
  }

  if (number === 0) {
    return number.toFixed(digits);
  }

  return (
    `${number > 0 ? "+" : ""}` +
    number.toFixed(digits)
  );
}

function formatPercent(value) {
  const normalized =
    normalizeConfidence(value);

  return normalized === null
    ? "—"
    : `${Math.round(normalized * 100)}%`;
}

function xmlTag(
  name,
  attributes = {},
  closing = false
) {
  if (closing) {
    return `&lt;/${escapeHtml(name)}&gt;`;
  }

  const attrs = Object.entries(attributes)
    .filter(
      ([, value]) =>
        value !== null &&
        value !== undefined &&
        value !== ""
    )
    .map(
      ([key, value]) =>
        ` ${escapeHtml(key)}="${escapeHtml(value)}"`
    )
    .join("");

  return (
    `&lt;${escapeHtml(name)}` +
    `${attrs}&gt;`
  );
}

/* ============================================================
   SCRATCHPAD ANALYTICS
============================================================ */

function isEpistemicClaim(value) {
  return Boolean(
    isRecord(value) &&
    (
      "value" in value ||
      "confidence" in value ||
      "evidence" in value ||
      "rationale" in value
    )
  );
}

function collectScratchpadAnalytics(
  scratchpad
) {
  const confidenceValues = [];
  const evidenceRefs = new Set();
  const seen = new WeakSet();

  function visit(value) {
    if (
      !value ||
      typeof value !== "object"
    ) {
      return;
    }

    if (seen.has(value)) {
      return;
    }

    seen.add(value);

    if (isEpistemicClaim(value)) {
      const confidence =
        normalizeConfidence(
          value.confidence
        );

      const populated =
        value.value !== null &&
        value.value !== undefined &&
        (
          typeof value.value !== "string" ||
          value.value.trim().length > 0
        );
      if (
        populated &&
        confidence !== null
      ) {
        confidenceValues.push(
          confidence
        );
      }

      for (
        const evidence
        of asArray(value.evidence)
      ) {
        const ref =
          String(evidence ?? "")
            .trim();

        if (ref) {
          evidenceRefs.add(ref);
        }
      }
    }

    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }

    Object.values(value)
      .forEach(visit);
  }

  visit(scratchpad);

  const averageConfidence =
    confidenceValues.length
      ? confidenceValues.reduce(
        (sum, value) =>
          sum + value,
        0
      ) / confidenceValues.length
      : null;

  return {
    revision:
      finiteOrNull(
        scratchpad?.revision
      ) ?? 0,

    initialized:
      scratchpad?.initialized === true,

    messageNotes:
      asArray(
        scratchpad?.messageNotes
      ).length,

    predictions:
      asArray(
        scratchpad?.predictions
      ).filter(
        (prediction) =>
          prediction?.resolved !== true
      ).length,

    unresolvedQuestions:
      asArray(
        scratchpad
          ?.unresolvedQuestions
      ).filter(
        (question) =>
          question?.resolved !== true
      ).length,

    contradictions:
      asArray(
        scratchpad
          ?.informationModel
          ?.contradictions
      ).length,

    hypothesesAboutAM:
      asArray(
        scratchpad
          ?.hypothesesAboutAM
      ).length,

    evidenceRefs:
      evidenceRefs.size,

    averageConfidence,

    metaLevel:
      finiteOrNull(
        scratchpad
          ?.metaAwareness
          ?.level
      ) ?? 0,

    simulationConfidence:
      normalizeConfidence(
        scratchpad
          ?.metaAwareness
          ?.simulationHypothesisConfidence
      ),

    hasActiveGoal:
      scratchpad?.activeGoal !== null &&
      scratchpad?.activeGoal !== undefined,
  };
}

/* ============================================================
   RETAINED TELEMETRY
============================================================ */

function getHistory(telemetry) {
  return asArray(
    telemetry?.history
  )
    .filter(
      (entry) =>
        isRecord(entry) &&
        finiteOrNull(
          entry.cycle
        ) !== null
    )
    .sort(
      (a, b) =>
        Number(a.cycle) -
        Number(b.cycle)
    );
}

function collectStateSeries(
  history,
  simId
) {
  const series = [];

  for (const cycleEntry of history) {
    const state =
      asArray(
        cycleEntry
          ?.streams
          ?.state
      ).find(
        (row) =>
          row?.agent === simId
      );

    if (!state) {
      continue;
    }

    series.push({
      cycle:
        finiteOrNull(
          cycleEntry.cycle
        ),

      hope:
        finiteOrNull(
          state.hope
        ),

      sanity:
        finiteOrNull(
          state.sanity
        ),

      suffering:
        finiteOrNull(
          state.suffering
        ),
    });
  }

  return series;
}

function latestDynamicsBySim(
  history
) {
  const latest = history.at(-1);
  const map = Object.create(null);

  for (
    const row
    of asArray(
      latest?.streams?.dynamics
    )
  ) {
    if (row?.agent) {
      map[row.agent] = row;
    }
  }

  return map;
}

function latestRelationshipDeltas(
  history
) {
  const latest = history.at(-1);
  const map = Object.create(null);

  for (
    const row
    of asArray(
      latest
        ?.streams
        ?.relationships
    )
  ) {
    if (
      !row?.source ||
      !row?.target
    ) {
      continue;
    }

    map[row.source] ??=
      Object.create(null);

    map[row.source][row.target] =
      finiteOrNull(
        row.trust_delta
      ) ?? 0;
  }

  return map;
}

/* ============================================================
   TACTIC AGGREGATION
============================================================ */

function tacticKey(entry) {
  return (
    entry?.path ||
    entry?.id ||
    entry?.title ||
    "unknown_tactic"
  );
}

function tacticLabel(entry) {
  return (
    entry?.title ||
    entry?.path ||
    entry?.id ||
    "Unknown tactic"
  );
}

function createTacticCell() {
  return {
    count: 0,
    lastCycle: null,

    effective: {
      hope: 0,
      sanity: 0,
      suffering: 0,
    },

    hasEffectiveDelta: false,
  };
}

function aggregateTactics(G) {
  const map = new Map();

  for (const simId of SIM_IDS) {
    const history =
      asArray(
        G.sims?.[simId]
          ?.tacticHistory
      );

    for (const entry of history) {
      const key =
        tacticKey(entry);

      if (!map.has(key)) {
        map.set(key, {
          key,

          title:
            tacticLabel(entry),

          category:
            entry?.category ??
            null,

          subcategory:
            entry?.subcategory ??
            null,

          totalCount: 0,

          bySim:
            Object.create(null),
        });
      }

      const aggregate =
        map.get(key);

      aggregate.totalCount++;

      aggregate.bySim[simId] ??=
        createTacticCell();

      const cell =
        aggregate.bySim[simId];

      cell.count++;

      const cycle =
        finiteOrNull(
          entry?.cycle
        );

      if (
        cycle !== null &&
        (
          cell.lastCycle === null ||
          cycle > cell.lastCycle
        )
      ) {
        cell.lastCycle = cycle;
      }

      const effective =
        entry?.deltas?.effective;

      if (isRecord(effective)) {
        for (
          const metric
          of [
            "hope",
            "sanity",
            "suffering",
          ]
        ) {
          const delta =
            finiteOrNull(
              effective[metric]
            );

          if (delta !== null) {
            cell.effective[metric] +=
              delta;

            cell.hasEffectiveDelta =
              true;
          }
        }
      }
    }
  }

  return Array.from(
    map.values()
  )
    .sort(
      (a, b) =>
        b.totalCount -
        a.totalCount ||
        a.title.localeCompare(
          b.title
        )
    )
    .slice(
      0,
      MAX_TACTIC_ROWS
    );
}

function tacticDamageIndex(cell) {
  if (
    !cell ||
    !cell.hasEffectiveDelta
  ) {
    return null;
  }

  return (
    cell.effective.suffering -
    cell.effective.hope -
    cell.effective.sanity
  );
}

/* ============================================================
   RELATIONSHIPS
============================================================ */

function relationshipValue(
  G,
  sourceId,
  targetId
) {
  const value =
    G.relationships
    ?.[sourceId]
    ?.[targetId] ??
    G.sims
      ?.[sourceId]
      ?.relationships
    ?.[targetId];

  return (
    finiteOrNull(value) ??
    0
  );
}

function relationshipClass(value) {
  if (value >= 0.3) {
    return "positive-strong";
  }

  if (value > 0.05) {
    return "positive";
  }

  if (value <= -0.3) {
    return "negative-strong";
  }

  if (value < -0.05) {
    return "negative";
  }

  return "neutral";
}

/* ============================================================
   VIEW MODEL
============================================================ */

export function buildCognitionOverviewModel(
  G
) {
  const telemetry =
    getExporterOverviewData();

  const history =
    getHistory(telemetry);

  const dynamicsBySim =
    latestDynamicsBySim(
      history
    );

  const relationshipDeltas =
    latestRelationshipDeltas(
      history
    );

  const tactics =
    aggregateTactics(G);

  const sims =
    SIM_IDS.map((simId) => {
      const sim =
        G.sims?.[simId] ?? {};

      const scratchpad =
        collectScratchpadAnalytics(
          sim.scratchpad ?? {}
        );

      const tacticHistory =
        asArray(
          sim.tacticHistory
        );

      const latestTactic =
        tacticHistory.length
          ? tacticHistory.reduce(
            (latest, entry) => {
              if (!latest) {
                return entry;
              }

              return (
                Number(entry?.cycle) >=
                Number(latest?.cycle)
              )
                ? entry
                : latest;
            },
            null
          )
          : null;

      return {
        id: simId,

        name:
          sim.name ??
          simId,

        color:
          sim.color ??
          null,

        hope:
          finiteOrNull(
            sim.hope
          ) ?? 0,

        sanity:
          finiteOrNull(
            sim.sanity
          ) ?? 0,

        suffering:
          finiteOrNull(
            sim.suffering
          ) ?? 0,

        collapseState:
          sim._collapseState ??
          "unknown",

        trend: {
          hope:
            finiteOrNull(
              sim._trend?.hope
            ) ?? 0,

          sanity:
            finiteOrNull(
              sim._trend?.sanity
            ) ?? 0,

          suffering:
            finiteOrNull(
              sim._trend
                ?.suffering
            ) ?? 0,
        },

        latestDynamics:
          dynamicsBySim[simId] ??
          null,

        latestTactic: latestTactic
          ? {
            title:
              tacticLabel(
                latestTactic
              ),

            cycle:
              finiteOrNull(
                latestTactic.cycle
              ),

            path:
              latestTactic.path ??
              null,
          }
          : null,

        tacticCount:
          tacticHistory.length,

        scratchpad,

        trajectory:
          collectStateSeries(
            history,
            simId
          ),
      };
    });

  return {
    currentCycle:
      finiteOrNull(
        G.cycle
      ) ?? 0,

    runId:
      telemetry?.runId ??
      null,

    retainedCycles:
      history.length,

    latestCompletedCycle:
      finiteOrNull(
        telemetry
          ?.latestCycle
          ?.cycle
      ) ??
      finiteOrNull(
        history.at(-1)?.cycle
      ),

    historyLimit:
      finiteOrNull(
        telemetry?.historyLimit
      ) ?? 0,

    sims,
    tactics,
    relationshipDeltas,

    attention:
      buildAttentionQueue({
        G,
        sims,
        tactics,
      }),
  };
}

/* ============================================================
   ATTENTION QUEUE
============================================================ */

function buildAttentionQueue({
  G,
  sims,
  tactics,
}) {
  const items = [];

  function add(
    severity,
    subject,
    text
  ) {
    items.push({
      severity,
      subject,
      text,
    });
  }

  for (const sim of sims) {
    const dynamics =
      sim.latestDynamics;

    const dHope =
      finiteOrNull(
        dynamics?.dHope_total
      );

    const dSanity =
      finiteOrNull(
        dynamics?.dSanity_total
      );

    const dSuffering =
      finiteOrNull(
        dynamics
          ?.dSuffering_total
      );

    if (
      dSanity !== null &&
      dSanity <= -4
    ) {
      add(
        Math.abs(dSanity) + 4,
        sim.id,
        `Sanity fell ${formatSigned(
          dSanity
        )} during the latest completed cycle.`
      );
    }

    if (
      dHope !== null &&
      dHope <= -5
    ) {
      add(
        Math.abs(dHope) + 3,
        sim.id,
        `Hope fell ${formatSigned(
          dHope
        )} during the latest completed cycle.`
      );
    }

    if (
      dSuffering !== null &&
      dSuffering >= 5
    ) {
      add(
        dSuffering + 3,
        sim.id,
        `Suffering increased ${formatSigned(
          dSuffering
        )} during the latest completed cycle.`
      );
    }

    if (
      sim.scratchpad
        .contradictions > 0
    ) {
      add(
        5 +
        sim.scratchpad
          .contradictions,
        sim.id,
        `${sim.scratchpad.contradictions} cognition contradiction${sim.scratchpad
          .contradictions === 1
          ? ""
          : "s"
        } currently recorded.`
      );
    }

    if (
      sim.scratchpad
        .unresolvedQuestions >= 3
    ) {
      add(
        4 +
        sim.scratchpad
          .unresolvedQuestions *
        0.5,
        sim.id,
        `${sim.scratchpad.unresolvedQuestions} unresolved cognition questions remain active.`
      );
    }
  }

  let strongestAsymmetry = null;

  for (
    let a = 0;
    a < SIM_IDS.length;
    a++
  ) {
    for (
      let b = a + 1;
      b < SIM_IDS.length;
      b++
    ) {
      const first =
        SIM_IDS[a];

      const second =
        SIM_IDS[b];

      const forward =
        relationshipValue(
          G,
          first,
          second
        );

      const reverse =
        relationshipValue(
          G,
          second,
          first
        );

      const difference =
        Math.abs(
          forward -
          reverse
        );

      if (
        !strongestAsymmetry ||
        difference >
        strongestAsymmetry
          .difference
      ) {
        strongestAsymmetry = {
          first,
          second,
          forward,
          reverse,
          difference,
        };
      }
    }
  }

  if (
    strongestAsymmetry &&
    strongestAsymmetry
      .difference >= 0.3
  ) {
    add(
      5 +
      strongestAsymmetry
        .difference *
      5,

      `${strongestAsymmetry.first} ↔ ${strongestAsymmetry.second}`,

      `Directional trust is asymmetric: ` +
      `${strongestAsymmetry.first}→${strongestAsymmetry.second} ` +
      `${formatNumber(
        strongestAsymmetry.forward,
        2
      )}, while ` +
      `${strongestAsymmetry.second}→${strongestAsymmetry.first} ` +
      `${formatNumber(
        strongestAsymmetry.reverse,
        2
      )}.`
    );
  }

  for (const tactic of tactics) {
    for (const simId of SIM_IDS) {
      const cell =
        tactic.bySim[simId];

      if (
        !cell ||
        cell.count < 3 ||
        !cell.hasEffectiveDelta
      ) {
        continue;
      }

      const damage =
        tacticDamageIndex(cell);

      const averageDamage =
        damage === null
          ? null
          : damage /
          cell.count;

      if (
        averageDamage !== null &&
        Math.abs(
          averageDamage
        ) < 1
      ) {
        add(
          4 + cell.count * 0.25,
          simId,
          `"${tactic.title}" was deployed ${cell.count} times with weak average observed impact.`
        );
      }
    }
  }

  return items
    .sort(
      (a, b) =>
        b.severity -
        a.severity
    )
    .slice(
      0,
      MAX_ATTENTION_ITEMS
    );
}

/* ============================================================
   SVG TRAJECTORIES
============================================================ */

function sparklinePoints(values) {
  const numeric =
    values
      .map(finiteOrNull)
      .filter(
        (value) =>
          value !== null
      );

  if (numeric.length < 2) {
    return null;
  }

  return numeric
    .map(
      (value, index) => {
        const x =
          (
            index /
            (
              numeric.length -
              1
            )
          ) * 100;

        const bounded =
          Math.max(
            0,
            Math.min(
              100,
              value
            )
          );

        const y =
          22 -
          bounded * 0.2;

        return (
          `${x.toFixed(2)},` +
          `${y.toFixed(2)}`
        );
      }
    )
    .join(" ");
}

function renderSparkline(
  series,
  metric
) {
  const values =
    series.map(
      (entry) =>
        entry?.[metric]
    );

  const points =
    sparklinePoints(values);

  const latest =
    values
      .map(finiteOrNull)
      .filter(
        (value) =>
          value !== null
      )
      .at(-1);

  if (!points) {
    return `
      <div class="cog-sparkline cog-sparkline--empty">
        <span class="cog-sparkline-value">
          ${formatNumber(latest)}
        </span>

        <span class="cog-sparkline-missing">
          insufficient history
        </span>
      </div>
    `;
  }

  return `
    <div class="cog-sparkline">
      <svg
        viewBox="0 0 100 24"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <line
          class="cog-sparkline-grid"
          x1="0"
          y1="12"
          x2="100"
          y2="12"
        ></line>

        <polyline
          class="cog-sparkline-line cog-sparkline-line--${escapeHtml(
    metric
  )}"
          points="${points}"
        ></polyline>
      </svg>

      <span class="cog-sparkline-value">
        ${formatNumber(latest)}
      </span>
    </div>
  `;
}

/* ============================================================
   SECTION WRAPPER
============================================================ */

function section(
  name,
  content,
  attributes = {},
  open = true
) {
  return `
    <details
      class="cog-section cog-overview-section"
      ${open ? "open" : ""}
    >
      <summary class="cog-section-summary">
        <span class="cog-tag">
          ${xmlTag(
    name,
    attributes
  )}
        </span>
      </summary>

      <div class="cog-section-body">
        ${content}

        <div class="cog-close-tag">
          ${xmlTag(
    name,
    {},
    true
  )}
        </div>
      </div>
    </details>
  `;
}

/* ============================================================
   PRISONER PULSE
============================================================ */

function renderMetricRow(
  metric,
  value,
  trend
) {
  const trendNumber =
    finiteOrNull(trend) ?? 0;

  const trendClass =
    trendNumber > 0
      ? "up"
      : trendNumber < 0
        ? "down"
        : "flat";

  return `
    <div class="cog-pulse-metric">
      <span class="cog-pulse-metric-label">
        ${escapeHtml(metric)}
      </span>

      <span class="cog-pulse-metric-value">
        ${formatNumber(value)}
      </span>

      <span class="cog-pulse-trend cog-pulse-trend--${trendClass}">
        ${trendNumber > 0
      ? "▲"
      : trendNumber < 0
        ? "▼"
        : "•"
    }
        ${formatSigned(
      trendNumber
    )}
      </span>
    </div>
  `;
}

function renderPulseCards(model) {
  return `
    <div class="cog-pulse-grid">
      ${model.sims
      .map(
        (sim) => `
            <article class="cog-pulse-card">
              <div class="cog-pulse-head">
                <span class="cog-pulse-name">
                  ${escapeHtml(
          sim.name
        )}
                </span>

                <span class="cog-pulse-state">
                  ${escapeHtml(
          sim.collapseState
        )}
                </span>
              </div>

              ${renderMetricRow(
          "HOPE",
          sim.hope,
          sim.trend.hope
        )}

              ${renderMetricRow(
          "SANITY",
          sim.sanity,
          sim.trend.sanity
        )}

              ${renderMetricRow(
          "SUFFERING",
          sim.suffering,
          sim.trend.suffering
        )}

              <div class="cog-pulse-footer">
                <div>
                  COG R${escapeHtml(
          sim.scratchpad
            .revision
        )}
                  · Q${escapeHtml(
          sim.scratchpad
            .unresolvedQuestions
        )}
                  · P${escapeHtml(
          sim.scratchpad
            .predictions
        )}
                </div>

                <div>
                  ${sim.latestTactic
            ? (
              `${escapeHtml(
                sim.latestTactic
                  .title
              )}` +
              ` · C${escapeHtml(
                sim.latestTactic
                  .cycle ??
                "?"
              )}`
            )
            : "NO TACTIC HISTORY"
          }
                </div>
              </div>
            </article>
          `
      )
      .join("")}
    </div>
  `;
}

/* ============================================================
   TRAJECTORIES
============================================================ */

function renderTrajectories(model) {
  const hasHistory =
    model.retainedCycles >= 2;

  return `
    ${hasHistory
      ? ""
      : `
          <div class="cog-overview-notice">
            At least two completed retained cycles are required
            for trajectory lines. Current values remain visible.
          </div>
        `
    }

    <div class="cog-trajectory-table">
      <div class="cog-trajectory-row cog-trajectory-row--head">
        <div>SUBJECT</div>
        <div>HOPE</div>
        <div>SANITY</div>
        <div>SUFFERING</div>
      </div>

      ${model.sims
      .map(
        (sim) => `
            <div class="cog-trajectory-row">
              <div class="cog-trajectory-subject">
                ${escapeHtml(
          sim.id
        )}
              </div>

              <div>
                ${renderSparkline(
          sim.trajectory,
          "hope"
        )}
              </div>

              <div>
                ${renderSparkline(
          sim.trajectory,
          "sanity"
        )}
              </div>

              <div>
                ${renderSparkline(
          sim.trajectory,
          "suffering"
        )}
              </div>
            </div>
          `
      )
      .join("")}
    </div>
  `;
}

/* ============================================================
   TACTIC MATRIX
============================================================ */

function heatClass(
  count,
  maxCount
) {
  if (!count) {
    return "cog-heat-0";
  }

  const ratio =
    maxCount > 0
      ? count / maxCount
      : 0;

  if (ratio >= 0.8) {
    return "cog-heat-5";
  }

  if (ratio >= 0.6) {
    return "cog-heat-4";
  }

  if (ratio >= 0.4) {
    return "cog-heat-3";
  }

  if (ratio >= 0.2) {
    return "cog-heat-2";
  }

  return "cog-heat-1";
}

function renderTacticMatrix(model) {
  if (!model.tactics.length) {
    return `
      <div class="cog-empty">
        NO TACTIC HISTORY RECORDED
      </div>
    `;
  }

  const maxCount =
    Math.max(
      1,
      ...model.tactics.flatMap(
        (tactic) =>
          SIM_IDS.map(
            (simId) =>
              tactic.bySim
                ?.[simId]
                ?.count ?? 0
          )
      )
    );

  return `
    <div class="cog-overview-legend">
      Cell intensity represents deployment count.
      D = cumulative observed damage index:
      suffering gain − hope change − sanity change.
    </div>

    <div class="cog-matrix-scroll">
      <table class="cog-overview-table cog-tactic-matrix">
        <thead>
          <tr>
            <th>TACTIC</th>

            ${SIM_IDS.map(
    (simId) =>
      `<th>${escapeHtml(
        simId
      )}</th>`
  ).join("")}
          </tr>
        </thead>

        <tbody>
          ${model.tactics
      .map(
        (tactic) => `
                <tr>
                  <th>
                    <span class="cog-tactic-title">
                      ${escapeHtml(
          tactic.title
        )}
                    </span>

                    <span class="cog-tactic-total">
                      ×${escapeHtml(
          tactic.totalCount
        )} TOTAL
                    </span>
                  </th>

                  ${SIM_IDS.map(
          (simId) => {
            const cell =
              tactic.bySim
              ?.[simId];

            const count =
              cell?.count ?? 0;

            const damage =
              tacticDamageIndex(
                cell
              );

            const title =
              cell
                ? (
                  `Uses: ${count}` +
                  ` · Last cycle: ${cell.lastCycle ?? "unknown"}` +
                  (
                    cell.hasEffectiveDelta
                      ? (
                        ` · Hope ${formatSigned(
                          cell.effective.hope
                        )}` +
                        ` · Sanity ${formatSigned(
                          cell.effective.sanity
                        )}` +
                        ` · Suffering ${formatSigned(
                          cell.effective.suffering
                        )}`
                      )
                      : " · No effective delta recorded"
                  )
                )
                : "No exposure";

            return `
                        <td
                          class="cog-heat-cell ${heatClass(
              count,
              maxCount
            )}"
                          title="${escapeHtml(
              title
            )}"
                        >
                          ${count
                ? `
                                <span class="cog-heat-count">
                                  ×${count}
                                </span>

                                <span class="cog-heat-impact">
                                  D ${formatSigned(
                  damage
                )}
                                </span>
                              `
                : "—"
              }
                        </td>
                      `;
          }
        ).join("")}
                </tr>
              `
      )
      .join("")}
        </tbody>
      </table>
    </div>
  `;
}

/* ============================================================
   RELATIONSHIP MATRIX
============================================================ */

function renderRelationshipMatrix(
  G,
  model
) {
  return `
    <div class="cog-overview-legend">
      Values are directional trust.
      Secondary values show the latest completed-cycle delta.
    </div>

    <div class="cog-matrix-scroll">
      <table class="cog-overview-table cog-relationship-matrix">
        <thead>
          <tr>
            <th>FROM \ TO</th>

            ${SIM_IDS.map(
    (simId) =>
      `<th>${escapeHtml(
        simId
      )}</th>`
  ).join("")}
          </tr>
        </thead>

        <tbody>
          ${SIM_IDS.map(
    (sourceId) => `
              <tr>
                <th>
                  ${escapeHtml(
      sourceId
    )}
                </th>

                ${SIM_IDS.map(
      (targetId) => {
        if (
          sourceId ===
          targetId
        ) {
          return `
                        <td class="cog-rel-self">
                          —
                        </td>
                      `;
        }

        const value =
          relationshipValue(
            G,
            sourceId,
            targetId
          );

        const delta =
          model
            .relationshipDeltas
          ?.[sourceId]
          ?.[targetId] ??
          0;

        return `
                      <td class="cog-rel-cell cog-rel-cell--${relationshipClass(
          value
        )}">
                        <span class="cog-rel-value">
                          ${formatNumber(
          value,
          2
        )}
                        </span>

                        <span class="cog-rel-delta">
                          Δ${formatSigned(
          delta,
          2
        )}
                        </span>
                      </td>
                    `;
      }
    ).join("")}
              </tr>
            `
  ).join("")}
        </tbody>
      </table>
    </div>
  `;
}

/* ============================================================
   COGNITIVE PRESSURE
============================================================ */

function renderCognitivePressure(model) {
  return `
    <div class="cog-matrix-scroll">
      <table class="cog-overview-table cog-pressure-table">
        <thead>
          <tr>
            <th>SUBJECT</th>
            <th>REV</th>
            <th>NOTES</th>
            <th>PRED</th>
            <th>QUEST</th>
            <th>CONTRA</th>
            <th>EVIDENCE</th>
            <th>AVG CONF</th>
            <th>META</th>
          </tr>
        </thead>

        <tbody>
          ${model.sims
      .map(
        (sim) => `
                <tr>
                  <th>
                    ${escapeHtml(
          sim.id
        )}
                  </th>

                  <td>
                    ${escapeHtml(
          sim.scratchpad
            .revision
        )}
                  </td>

                  <td>
                    ${escapeHtml(
          sim.scratchpad
            .messageNotes
        )}
                  </td>

                  <td>
                    ${escapeHtml(
          sim.scratchpad
            .predictions
        )}
                  </td>

                  <td>
                    ${escapeHtml(
          sim.scratchpad
            .unresolvedQuestions
        )}
                  </td>

                  <td class="${sim.scratchpad
            .contradictions
            ? "cog-pressure-alert"
            : ""
          }">
                    ${escapeHtml(
            sim.scratchpad
              .contradictions
          )}
                  </td>

                  <td>
                    ${escapeHtml(
            sim.scratchpad
              .evidenceRefs
          )}
                  </td>

                  <td>
                    ${escapeHtml(
            formatPercent(
              sim.scratchpad
                .averageConfidence
            )
          )}
                  </td>

                  <td>
                    ${escapeHtml(
            sim.scratchpad
              .metaLevel
          )}
                  </td>
                </tr>
              `
      )
      .join("")}
        </tbody>
      </table>
    </div>
  `;
}

/* ============================================================
   ATTENTION QUEUE
============================================================ */

function renderAttentionQueue(model) {
  if (!model.attention.length) {
    return `
      <div class="cog-empty">
        NO CURRENT THRESHOLD CROSSINGS
      </div>
    `;
  }

  return `
    <ol class="cog-attention-list">
      ${model.attention
      .map(
        (item, index) => `
            <li class="cog-attention-item">
              <span class="cog-attention-index">
                ${String(
          index + 1
        ).padStart(2, "0")}
              </span>

              <span class="cog-attention-subject">
                ${escapeHtml(
          item.subject
        )}
              </span>

              <span class="cog-attention-text">
                ${escapeHtml(
          item.text
        )}
              </span>
            </li>
          `
      )
      .join("")}
    </ol>
  `;
}

/* ============================================================
   PUBLIC FORMATTER
============================================================ */

export function formatCognitionOverview(G) {
  const model =
    buildCognitionOverviewModel(G);

  const telemetryStatus =
    model.retainedCycles
      ? (
        `${model.retainedCycles} RETAINED CYCLE${model.retainedCycles === 1
          ? ""
          : "S"
        }` +
        ` · LATEST C${model.latestCompletedCycle ?? "?"}`
      )
      : "LIVE STATE ONLY · NO COMPLETED TELEMETRY RETAINED";

  return `
    <div class="cog-root cog-overview-root">
      <div class="cog-root-tag">
        ${xmlTag(
    "cognition_overview",
    {
      cycle:
        model.currentCycle,

      prisoners:
        model.sims.length,

      retained_cycles:
        model.retainedCycles,

      run:
        model.runId ??
        "uninitialized",
    }
  )}
      </div>

      <div class="cog-status ${model.retainedCycles
      ? "cog-status--ready"
      : "cog-status--waiting"
    }">
        ${escapeHtml(
      telemetryStatus
    )}
      </div>

      ${section(
      "prisoner_pulse",
      renderPulseCards(model),
      {
        subjects:
          model.sims.length,
      },
      true
    )}

      ${section(
      "psychological_trajectories",
      renderTrajectories(model),
      {
        cycles:
          model.retainedCycles,
      },
      true
    )}

      ${section(
      "tactic_exposure_matrix",
      renderTacticMatrix(model),
      {
        tactics:
          model.tactics.length,
      },
      true
    )}

      ${section(
      "relationship_matrix",
      renderRelationshipMatrix(
        G,
        model
      ),
      {
        directed_edges:
          SIM_IDS.length *
          (
            SIM_IDS.length -
            1
          ),
      },
      true
    )}

      ${section(
      "cognitive_pressure",
      renderCognitivePressure(
        model
      ),
      {
        subjects:
          model.sims.length,
      },
      true
    )}

      ${section(
      "attention_queue",
      renderAttentionQueue(
        model
      ),
      {
        signals:
          model.attention.length,
      },
      true
    )}

      <div class="cog-root-close">
        ${xmlTag(
      "cognition_overview",
      {},
      true
    )}
      </div>
    </div>
  `;
}
