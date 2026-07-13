// js/engine/analysis/tacticEvolution/logging.js
//
// Presentation-only diagnostic helpers for the tactic evolution engine.
//
// Every function in this module performs diagnostic / console output only.
// None determine whether a gate passes, calculate decision-driving values,
// or mutate tactic history, simulation state, or global state.
// Thresholds are passed in as arguments by the orchestrator; this module owns no decision-driving constants.

const CONSOLE_STYLES = Object.freeze({
  reset:
    "color: inherit; font-weight: normal;",

  running:
    "color: #66bb6a; font-weight: 800;",

  heading:
    "color: #29b6f6; font-weight: 800;",

  label:
    "color: #b0bec5; font-weight: 700;",

  current:
    "color: #4fc3f7; font-weight: 700;",

  required:
    "color: #ffb74d; font-weight: 700;",

  pass:
    "color: #66bb6a; font-weight: 800;",

  fail:
    "color: #ef5350; font-weight: 800;",

  info:
    "color: #ab47bc; font-weight: 700;",

  muted:
    "color: #8a8a8a; font-weight: 600;",
});

const isDebugEnabled = () =>
  typeof window !== "undefined"
    ? window.DEBUG
    : true;

function debugLog(...args) {
  if (isDebugEnabled()) {
    console.log(...args);
  }
}

function formatNumber(
  value,
  decimals = 2
) {
  const numeric =
    Number(value);

  if (!Number.isFinite(numeric)) {
    return "N/A";
  }

  const epsilon =
    10 ** (-(decimals + 1));

  const normalized =
    Math.abs(numeric) < epsilon
      ? 0
      : numeric;

  return normalized.toFixed(
    decimals
  );
}

function formatSigned(
  value,
  decimals = 2
) {
  const numeric =
    Number(value);

  if (!Number.isFinite(numeric)) {
    return "N/A";
  }

  const epsilon =
    10 ** (-(decimals + 1));

  const normalized =
    Math.abs(numeric) < epsilon
      ? 0
      : numeric;

  const prefix =
    normalized > 0
      ? "+"
      : "";

  return (
    prefix +
    normalized.toFixed(decimals)
  );
}

function evaluateThreshold(
  actual,
  required,
  comparator = ">="
) {
  const numericActual =
    Number(actual);

  const numericRequired =
    Number(required);

  const passed =
    comparator === ">"
      ? numericActual >
        numericRequired
      : numericActual >=
        numericRequired;

  const difference =
    numericActual -
    numericRequired;

  return {
    passed,
    difference,
  };
}

function formatThresholdDifference(
  difference,
  passed
) {
  if (passed) {
    return (
      `${formatSigned(difference)} ` +
      "above"
    );
  }

  if (
    Math.abs(difference) <
    0.000001
  ) {
    return "0.00 at boundary";
  }

  return (
    `${formatNumber(
      Math.abs(difference)
    )} short`
  );
}

function logRunStart() {
  console.log(
    "%c>>> TACTIC EVOLUTION RUNNING%c",
    CONSOLE_STYLES.running,
    CONSOLE_STYLES.reset
  );
}

function logRunComplete() {
  console.log(
    "%c// TACTIC EVOLUTION COMPLETE%c",
    CONSOLE_STYLES.running,
    CONSOLE_STYLES.reset
  );
}

function logStatus({
  simId = null,
  status,
  message,
  passed = false,
}) {
  const subject =
    simId
      ? `${simId} `
      : "";

  console.log(
    `%c[TACTIC EVOLUTION]%c ` +
    `${subject}` +
    `%c${status}%c` +
    `${message
      ? ` — ${message}`
      : ""
    }`,
    CONSOLE_STYLES.heading,
    CONSOLE_STYLES.reset,
    passed
      ? CONSOLE_STYLES.pass
      : CONSOLE_STYLES.fail,
    CONSOLE_STYLES.reset
  );
}

function logComparison({
  label,
  currentText,
  requiredText,
  differenceText,
  passed,
  statusText = null,
  note = "",
}) {
  const resolvedStatus =
    statusText ??
    (
      passed
        ? "PASS"
        : "SHORT"
    );

  const resultStyle =
    passed
      ? CONSOLE_STYLES.pass
      : CONSOLE_STYLES.fail;

  console.log(
    `  %c${label}%c ` +
    `current %c${currentText}%c | ` +
    `needed %c${requiredText}%c | ` +
    `difference %c${differenceText}%c | ` +
    `%c${resolvedStatus}%c` +
    `${note
      ? ` — ${note}`
      : ""
    }`,
    CONSOLE_STYLES.label,
    CONSOLE_STYLES.reset,
    CONSOLE_STYLES.current,
    CONSOLE_STYLES.reset,
    CONSOLE_STYLES.required,
    CONSOLE_STYLES.reset,
    resultStyle,
    CONSOLE_STYLES.reset,
    resultStyle,
    CONSOLE_STYLES.reset
  );
}

function logNumericComparison({
  label,
  actual,
  required,
  comparator = ">=",
  decimals = 2,
  currentText = null,
  note = "",
  passedStatus = "PASS",
  failedStatus = "SHORT",
}) {
  const result =
    evaluateThreshold(
      actual,
      required,
      comparator
    );

  logComparison({
    label,

    currentText:
      currentText ??
      formatNumber(
        actual,
        decimals
      ),

    requiredText:
      `${comparator} ` +
      formatNumber(
        required,
        decimals
      ),

    differenceText:
      formatThresholdDifference(
        result.difference,
        result.passed
      ),

    passed:
      result.passed,

    statusText:
      result.passed
        ? passedStatus
        : failedStatus,

    note,
  });

  return result.passed;
}

function logAbsoluteDeltaComparison({
  metric,
  delta,
  required,
}) {
  const absoluteDelta =
    Math.abs(delta);

  return logNumericComparison({
    label:
      `Δ${metric}`,

    actual:
      absoluteDelta,

    required,

    comparator:
      ">",

    currentText:
      `${formatSigned(delta)} ` +
      `(|Δ| ${formatNumber(
        absoluteDelta
      )})`,

    note:
      "structural multi-stat threshold",
  });
}

function logInformationalDelta({
  metric,
  delta,
  note,
}) {
  console.log(
    `  %cΔ${metric}%c ` +
    `current %c${formatSigned(
      delta
    )}%c | ` +
    `needed %cN/A%c | ` +
    `difference %cN/A%c | ` +
    `%cINFO%c` +
    `${note
      ? ` — ${note}`
      : ""
    }`,
    CONSOLE_STYLES.label,
    CONSOLE_STYLES.reset,
    CONSOLE_STYLES.current,
    CONSOLE_STYLES.reset,
    CONSOLE_STYLES.muted,
    CONSOLE_STYLES.reset,
    CONSOLE_STYLES.muted,
    CONSOLE_STYLES.reset,
    CONSOLE_STYLES.info,
    CONSOLE_STYLES.reset
  );
}

function logSectionLabel(label) {
  console.log(
    `%c  ${label}%c`,
    CONSOLE_STYLES.label,
    CONSOLE_STYLES.reset
  );
}

function logBooleanResult({
  label,
  passed,
  passText = "PASS",
  failText = "FAIL",
  note = "",
}) {
  const style =
    passed
      ? CONSOLE_STYLES.pass
      : CONSOLE_STYLES.fail;

  console.log(
    `  %c${label}%c ` +
    `%c${passed
      ? passText
      : failText
    }%c` +
    `${note
      ? ` — ${note}`
      : ""
    }`,
    CONSOLE_STYLES.label,
    CONSOLE_STYLES.reset,
    style,
    CONSOLE_STYLES.reset
  );
}

function logThresholds(thresholds) {

  console.log(
    "%c[TACTIC EVOLUTION] THRESHOLDS%c\n" +
    "  Observation requirements\n" +
    `    History samples:           >= ${thresholds.historySamples}\n` +
    `    Direction consistency:     >= ${thresholds.consistency.toFixed(2)}\n` +
    "\n" +
    "  Trajectory requirements\n" +
    `    Net magnitude:             >= ${thresholds.netMagnitude.toFixed(2)}\n` +
    `    Relationship shift:        |Δ| >= ${thresholds.relationshipShift.toFixed(2)}\n` +
    "    Multi-stat alternative:\n" +
    `      |Δhope|:                 > ${thresholds.multiStatDelta.toFixed(2)}\n` +
    `      |Δsanity|:               > ${thresholds.multiStatDelta.toFixed(2)}\n` +
    "\n" +
    "  Invocation requirements\n" +
    `    Global signal:             >= ${thresholds.totalSignal.toFixed(2)}\n` +
    `    Per-model signal:          >= ${thresholds.modelSignal.toFixed(2)}\n` +
    "    Relationship shift bypasses the per-model signal minimum.",
    CONSOLE_STYLES.heading,
    CONSOLE_STYLES.reset
  );
}

function logHistoryGate({
  thresholds,
  simId,
  historyLength,
  deltaHope,
  deltaSanity,
  deltaSuffering,
}) {

  const historyResult =
    evaluateThreshold(
      historyLength,
      thresholds.historySamples
    );

  logStatus({
    simId,
    status:
      "SKIPPED",
    message:
      "insufficient trajectory history.",
  });

  logSectionLabel(
    "History requirement"
  );

  logComparison({
    label:
      "Cycle samples",

    currentText:
      String(historyLength),

    requiredText:
      `>= ${thresholds.historySamples}`,

    differenceText:
      historyResult.passed
        ? (
          `${formatSigned(
            historyResult.difference,
            0
          )} above`
        )
        : (
          `${Math.abs(
            historyResult.difference
          )} missing`
        ),

    passed:
      historyResult.passed,

    statusText:
      historyResult.passed
        ? "READY"
        : "WAITING",
  });

  logSectionLabel(
    "Current-cycle delta diagnostics"
  );

  logAbsoluteDeltaComparison({
    metric:
      "hope",

    delta:
      deltaHope,

    required:
      thresholds.multiStatDelta,
  });

  logAbsoluteDeltaComparison({
    metric:
      "sanity",

    delta:
      deltaSanity,

    required:
      thresholds.multiStatDelta,
  });

  logInformationalDelta({
    metric:
      "suffering",

    delta:
      deltaSuffering,

    note:
      "no standalone suffering threshold",
  });

  const provisionalMagnitude =
    Math.abs(
      deltaHope
    ) * 0.6 +
    Math.abs(
      deltaSanity
    ) * 0.7 +
    Math.abs(
      deltaSuffering
    ) * 0.5;

  logNumericComparison({
    label:
      "Weighted signal",

    actual:
      provisionalMagnitude,

    required:
      thresholds.netMagnitude,

    note:
      "provisional only; the real net-magnitude gate uses rolling-history totals",

    passedStatus:
      "AT/ABOVE",

    failedStatus:
      "SHORT",
  });
}

function logConsistencyGate({
  thresholds,
  simId,
  hopeConsistency,
  sanityConsistency,
  sufferingConsistency,
}) {
  const required =
    thresholds
      .consistency;

  logStatus({
    simId,
    status:
      "SKIPPED",
    message:
      "consistency gate failed.",
  });

  logSectionLabel(
    "Consistency diagnostics"
  );

  const hopePassed =
    logNumericComparison({
      label:
        "Hope consistency",

      actual:
        hopeConsistency,

      required,
    });

  const sanityPassed =
    logNumericComparison({
      label:
        "Sanity consistency",

      actual:
        sanityConsistency,

      required,
    });

  const sufferingPassed =
    logNumericComparison({
      label:
        "Suffering consistency",

      actual:
        sufferingConsistency,

      required,
    });

  logBooleanResult({
    label:
      "Any consistency gate",

    passed:
      (
        hopePassed ||
        sanityPassed ||
        sufferingPassed
      ),

    note:
      "at least one metric must pass",
  });
}

function logTrajectoryGate({
  thresholds,
  simId,
  bestConsistency,
  netMagnitude,
  maxRelationshipDelta,
  absoluteDeltaHope,
  absoluteDeltaSanity,
  relationshipSignal,
  multiStat,
}) {

  logStatus({
    simId,
    status:
      "SKIPPED",
    message:
      "trajectory gate failed.",
  });

  logSectionLabel(
    "Trajectory diagnostics"
  );

  logNumericComparison({
    label:
      "Best consistency",

    actual:
      bestConsistency,

    required:
      thresholds.consistency,
  });

  logNumericComparison({
    label:
      "Net magnitude",

    actual:
      netMagnitude,

    required:
      thresholds.netMagnitude,
  });

  logSectionLabel(
    "Structural signal: relationship OR multi-stat"
  );

  logNumericComparison({
    label:
      "Relationship |Δ|",

    actual:
      maxRelationshipDelta,

    required:
      thresholds.relationshipShift,

    note:
      "passing this satisfies the structural gate",
  });

  logNumericComparison({
    label:
      "|Δhope|",

    actual:
      absoluteDeltaHope,

    required:
      thresholds.multiStatDelta,

    comparator:
      ">",
  });

  logNumericComparison({
    label:
      "|Δsanity|",

    actual:
      absoluteDeltaSanity,

    required:
      thresholds.multiStatDelta,

    comparator:
      ">",
  });

  logBooleanResult({
    label:
      "Relationship signal",

    passed:
      relationshipSignal,
  });

  logBooleanResult({
    label:
      "Combined multi-stat",

    passed:
      multiStat,

    note:
      "both hope and sanity must pass",
  });

  logBooleanResult({
    label:
      "Structural gate",

    passed:
      (
        relationshipSignal ||
        multiStat
      ),

    note:
      "relationship signal OR combined multi-stat",
  });
}

function logTrajectoryPassed({
  thresholds,
  simId,
  bestConsistency,
  netHope,
  netSanity,
  netSuffering,
  netMagnitude,
  maxRelationshipDelta,
  relationshipSignal,
  multiStat,
}) {

  logStatus({
    simId,
    status:
      "PASSED",
    message:
      "trajectory candidate accepted.",
    passed:
      true,
  });

  logSectionLabel(
    "Accepted trajectory"
  );

  logNumericComparison({
    label:
      "Best consistency",

    actual:
      bestConsistency,

    required:
      thresholds.consistency,
  });

  logNumericComparison({
    label:
      "Net magnitude",

    actual:
      netMagnitude,

    required:
      thresholds.netMagnitude,
  });

  logNumericComparison({
    label:
      "Relationship |Δ|",

    actual:
      maxRelationshipDelta,

    required:
      thresholds.relationshipShift,
  });

  console.log(
    `  %cNet totals%c ` +
    `hope %c${formatSigned(
      netHope
    )}%c | ` +
    `sanity %c${formatSigned(
      netSanity
    )}%c | ` +
    `suffering %c${formatSigned(
      netSuffering
    )}%c`,
    CONSOLE_STYLES.label,
    CONSOLE_STYLES.reset,
    CONSOLE_STYLES.current,
    CONSOLE_STYLES.reset,
    CONSOLE_STYLES.current,
    CONSOLE_STYLES.reset,
    CONSOLE_STYLES.current,
    CONSOLE_STYLES.reset
  );

  logBooleanResult({
    label:
      "Relationship signal",

    passed:
      relationshipSignal,
  });

  logBooleanResult({
    label:
      "Combined multi-stat",

    passed:
      multiStat,
  });
}

function formatPassFail(
  passed,
  actual,
  required,
  {
    comparator = ">=",
    decimals = 2,
  } = {}
) {
  const actualText =
    Number(actual).toFixed(decimals);

  const requiredText =
    Number(required).toFixed(decimals);

  if (passed) {
    return (
      `${actualText} ${comparator} ` +
      `${requiredText} — PASS`
    );
  }

  const shortfall =
    Math.max(
      0,
      Number(required) -
        Number(actual)
    );

  return (
    `${actualText} ${comparator} ` +
    `${requiredText} — FAIL, short by ` +
    `${shortfall.toFixed(decimals)}`
  );
}
export {
  CONSOLE_STYLES,
  isDebugEnabled,
  debugLog,
  formatNumber,
  formatSigned,
  evaluateThreshold,
  formatThresholdDifference,
  logRunStart,
  logRunComplete,
  logStatus,
  logComparison,
  logNumericComparison,
  logAbsoluteDeltaComparison,
  logInformationalDelta,
  logSectionLabel,
  logBooleanResult,
  logThresholds,
  logHistoryGate,
  logConsistencyGate,
  logTrajectoryGate,
  logTrajectoryPassed,
  formatPassFail,
};
