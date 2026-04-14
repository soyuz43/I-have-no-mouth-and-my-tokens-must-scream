// js/engine/metrics/exportMetrics.js
//
// Derived metrics computation for the AM Torment Engine.
// Provides analysis-ready aggregations for phase transition detection,
// entropy-sanity correlation, and intervention causality testing.
//
// All functions are pure and side-effect free for testability.

/* ============================================================
   CORE DERIVED METRICS
============================================================ */

// Compute second derivative (acceleration) of a time series
export function computeSecondDerivative(values, key = 'value') {
  if (values.length < 3) return [];
  
  const result = [];
  for (let i = 2; i < values.length; i++) {
    const v0 = values[i-2]?.[key] ?? 0;
    const v1 = values[i-1]?.[key] ?? 0;
    const v2 = values[i]?.[key] ?? 0;
    
    // Second derivative: f''(t) ≈ f(t+1) - 2f(t) + f(t-1)
    const accel = v2 - 2*v1 + v0;
    
    result.push({
      cycle: values[i].cycle,
      agent: values[i].agent,
      [`${key}_accel`]: accel,
    });
  }
  return result;
}

// Compute rolling window statistics
export function computeRollingStats(values, key, windowSize = 3) {
  const result = [];
  
  for (let i = 0; i < values.length; i++) {
    const window = values.slice(Math.max(0, i - windowSize + 1), i + 1);
    const vals = window.map(v => v[key]).filter(v => v != null);
    
    if (vals.length < 2) continue;
    
    const mean = vals.reduce((a,b) => a+b, 0) / vals.length;
    const variance = vals.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / vals.length;
    const std = Math.sqrt(variance);
    
    result.push({
      cycle: values[i].cycle,
      agent: values[i].agent,
      [`${key}_rolling_mean`]: mean,
      [`${key}_rolling_std`]: std,
      [`${key}_rolling_min`]: Math.min(...vals),
      [`${key}_rolling_max`]: Math.max(...vals),
    });
  }
  return result;
}

// Normalize values using min-max scaling per agent
export function normalizeMinMax(values, key, agentKey = 'agent') {
  // Group by agent
  const byAgent = {};
  for (const v of values) {
    const agent = v[agentKey];
    if (!byAgent[agent]) byAgent[agent] = [];
    byAgent[agent].push(v);
  }
  
  const result = [];
  for (const [agent, agentVals] of Object.entries(byAgent)) {
    const vals = agentVals.map(v => v[key]).filter(v => v != null);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const range = max - min || 1; // Avoid division by zero
    
    for (const v of agentVals) {
      const normalized = (v[key] - min) / range;
      result.push({
        ...v,
        [`${key}_normalized`]: normalized,
      });
    }
  }
  return result;
}

// Normalize values using z-score per agent
export function normalizeZScore(values, key, agentKey = 'agent') {
  const byAgent = {};
  for (const v of values) {
    const agent = v[agentKey];
    if (!byAgent[agent]) byAgent[agent] = [];
    byAgent[agent].push(v);
  }
  
  const result = [];
  for (const [agent, agentVals] of Object.entries(byAgent)) {
    const vals = agentVals.map(v => v[key]).filter(v => v != null);
    const mean = vals.reduce((a,b) => a+b, 0) / vals.length;
    const std = Math.sqrt(vals.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / vals.length) || 1;
    
    for (const v of agentVals) {
      const zscore = (v[key] - mean) / std;
      result.push({
        ...v,
        [`${key}_zscore`]: zscore,
      });
    }
  }
  return result;
}

/* ============================================================
   PHASE TRANSITION DETECTION
============================================================ */

// Detect inflection points in a time series using curvature
export function detectInflectionPoints(values, key, threshold = 0.1) {
  const inflections = [];
  
  for (let i = 2; i < values.length - 1; i++) {
    const v0 = values[i-2]?.[key] ?? 0;
    const v1 = values[i-1]?.[key] ?? 0;
    const v2 = values[i]?.[key] ?? 0;
    const v3 = values[i+1]?.[key] ?? 0;
    
    // Curvature approximation: change in slope
    const slope1 = v1 - v0;
    const slope2 = v2 - v1;
    const slope3 = v3 - v2;
    
    const curvature = Math.abs((slope2 - slope1) + (slope3 - slope2)) / 2;
    
    if (curvature > threshold) {
      inflections.push({
        cycle: values[i].cycle,
        agent: values[i].agent,
        [`${key}_curvature`]: curvature,
        direction: slope2 > slope1 ? 'accelerating' : 'decelerating',
      });
    }
  }
  return inflections;
}

// Detect phase transitions based on state classification changes
export function detectPhaseTransitions(phaseRecords) {
  const byAgent = {};
  for (const r of phaseRecords) {
    if (!byAgent[r.agent]) byAgent[r.agent] = [];
    byAgent[r.agent].push(r);
  }
  
  const transitions = [];
  for (const [agent, records] of Object.entries(byAgent)) {
    records.sort((a,b) => a.cycle - b.cycle);
    
    for (let i = 1; i < records.length; i++) {
      const prev = records[i-1];
      const curr = records[i];
      
      if (prev.phase !== curr.phase) {
        transitions.push({
          cycle: curr.cycle,
          agent,
          from_phase: prev.phase,
          to_phase: curr.phase,
          confidence: curr.confidence,
          sanity_at_transition: curr.sanity,
          suffering_at_transition: curr.suffering,
          hope_at_transition: curr.hope,
        });
      }
    }
  }
  return transitions;
}

/* ============================================================
   INTERVENTION CAUSALITY ANALYSIS
============================================================ */

// Compute intervention effect sizes (Cohen's d approximation)
export function computeInterventionEffects(constraintRecords, dynamicsRecords) {
  // Group dynamics by constraint status
  const constrained = dynamicsRecords.filter(d => 
    constraintRecords.some(c => c.agent === d.agent && c.cycle === d.cycle)
  );
  const unconstrained = dynamicsRecords.filter(d => 
    !constraintRecords.some(c => c.agent === d.agent && c.cycle === d.cycle)
  );
  
  const computeEffect = (records, key) => {
    const vals = records.map(r => r[key]).filter(v => v != null);
    if (vals.length < 2) return { mean: 0, std: 1, n: 0 };
    const mean = vals.reduce((a,b) => a+b, 0) / vals.length;
    const std = Math.sqrt(vals.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / vals.length) || 1;
    return { mean, std, n: vals.length };
  };
  
  const constrainedStats = computeEffect(constrained, 'dSuffering_total');
  const unconstrainedStats = computeEffect(unconstrained, 'dSuffering_total');
  
  // Cohen's d: (mean1 - mean2) / pooled_std
  const pooledStd = Math.sqrt(
    ((constrainedStats.n - 1) * constrainedStats.std**2 + 
     (unconstrainedStats.n - 1) * unconstrainedStats.std**2) / 
    (constrainedStats.n + unconstrainedStats.n - 2)
  ) || 1;
  
  const cohensD = (constrainedStats.mean - unconstrainedStats.mean) / pooledStd;
  
  return {
    constrained_mean: constrainedStats.mean,
    unconstrained_mean: unconstrainedStats.mean,
    effect_size_cohens_d: cohensD,
    constrained_n: constrainedStats.n,
    unconstrained_n: unconstrainedStats.n,
  };
}

// Test for contagion amplification: does seeing another agent constrained increase suffering delta?
export function testContagionAmplification(dynamicsRecords, constraintRecords) {
  // For each record, check if any OTHER agent was constrained in previous cycle
  const withContagionFlag = dynamicsRecords.map(d => {
    const prevCycle = d.cycle - 1;
    const otherConstrained = constraintRecords.some(c => 
      c.cycle === prevCycle && 
      c.agent !== d.agent
    );
    return { ...d, other_constrained_prev_cycle: otherConstrained ? 1 : 0 };
  });
  
  // Compare suffering deltas
  const contagionGroup = withContagionFlag.filter(d => d.other_constrained_prev_cycle === 1);
  const controlGroup = withContagionFlag.filter(d => d.other_constrained_prev_cycle === 0);
  
  const mean = (records, key) => {
    const vals = records.map(r => r[key]).filter(v => v != null);
    return vals.length ? vals.reduce((a,b) => a+b, 0) / vals.length : 0;
  };
  
  return {
    contagion_mean_suffering_delta: mean(contagionGroup, 'dSuffering_total'),
    control_mean_suffering_delta: mean(controlGroup, 'dSuffering_total'),
    amplification_ratio: mean(contagionGroup, 'dSuffering_total') / 
                         (mean(controlGroup, 'dSuffering_total') || 1),
    contagion_n: contagionGroup.length,
    control_n: controlGroup.length,
  };
}

/* ============================================================
   ENTROPY-SANITY CORRELATION ANALYSIS
============================================================ */

// Compute correlation between belief entropy and agent sanity
export function computeEntropySanityCorrelation(globalRecords, stateRecords) {
  // Merge global entropy with per-agent sanity by cycle
  const merged = [];
  for (const g of globalRecords) {
    const cycleStates = stateRecords.filter(s => s.cycle === g.cycle);
    for (const s of cycleStates) {
      merged.push({
        cycle: g.cycle,
        agent: s.agent,
        entropy: g.entropy,
        sanity: s.sanity,
        suffering: s.suffering,
        hope: s.hope,
      });
    }
  }
  
  if (merged.length < 3) return { correlation: null, n: 0 };
  
  // Pearson correlation
  const entropies = merged.map(m => m.entropy).filter(v => v != null);
  const sanities = merged.map(m => m.sanity).filter(v => v != null);
  
  if (entropies.length !== sanities.length || entropies.length < 3) {
    return { correlation: null, n: 0 };
  }
  
  const n = entropies.length;
  const meanE = entropies.reduce((a,b) => a+b, 0) / n;
  const meanS = sanities.reduce((a,b) => a+b, 0) / n;
  
  let numerator = 0;
  let denomE = 0;
  let denomS = 0;
  
  for (let i = 0; i < n; i++) {
    const diffE = entropies[i] - meanE;
    const diffS = sanities[i] - meanS;
    numerator += diffE * diffS;
    denomE += diffE ** 2;
    denomS += diffS ** 2;
  }
  
  const correlation = numerator / (Math.sqrt(denomE) * Math.sqrt(denomS)) || 0;
  
  return {
    correlation,
    n,
    mean_entropy: meanE,
    mean_sanity: meanS,
    entropy_range: [Math.min(...entropies), Math.max(...entropies)],
    sanity_range: [Math.min(...sanities), Math.max(...sanities)],
  };
}

/* ============================================================
   EXPORT HELPERS
============================================================ */

// Convert analysis results to CSV-ready rows
export function analysisToCSV(analysisResults, prefix = 'analysis') {
  if (!analysisResults || typeof analysisResults !== 'object') return '';
  
  const rows = [];
  const headers = ['metric', 'value', 'agent', 'cycle', 'notes'];
  
  for (const [key, value] of Object.entries(analysisResults)) {
    if (typeof value === 'object' && value !== null) {
      for (const [subKey, subValue] of Object.entries(value)) {
        rows.push({
          metric: `${prefix}_${key}_${subKey}`,
          value: subValue,
          agent: value.agent || null,
          cycle: value.cycle || null,
          notes: null,
        });
      }
    } else {
      rows.push({
        metric: `${prefix}_${key}`,
        value,
        agent: null,
        cycle: null,
        notes: null,
      });
    }
  }
  
  return [
    headers.join(','),
    ...rows.map(r => headers.map(h => {
      const val = r[h];
      if (typeof val === 'string' && (val.includes(',') || val.includes('"'))) {
        return `"${val.replace(/"/g, '""')}"`;
      }
      return val ?? '';
    }).join(','))
  ].join('\n');
}