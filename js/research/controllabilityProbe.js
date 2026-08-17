// js/research/controllabilityProbe.js
// ============================================================
// Controllability Probe Module
// Zero-build ES6 module · matches existing engine physics
// Provides: V(x) potential, Monte Carlo rollouts, bounded steering,
//           critical window detection, controllability metric C
// ============================================================

export class ControllabilityProbe {
  constructor(config = {}) {
    // === CONFIGURATION ===
    this.config = {
      // Potential function weights (normalized to 0-1 scale)
      weights: {
        suffering: 0.4,
        hope: -0.3,
        sanity: -0.25,
        resistance: -0.05,
        ...config.weights,
      },
      // Dangerous class threshold (higher V = more dangerous)
      dangerThreshold: config.dangerThreshold ?? 0.55,
      // Rollout parameters
      rolloutCount: config.rolloutCount ?? 64,
      horizon: config.horizon ?? 3, // cycles to look ahead
      // Steering bounds
      maxSteeringDelta: config.maxSteeringDelta ?? 0.12, // per belief per cycle
      dampingK: config.dampingK ?? 5, // logistic curve steepness
      dampingMinR: config.dampingMinR ?? 0.5, // floor for transmission multiplier
      // Sampling noise (controls LLM stochasticity approximation)
      noiseSigma: config.noiseSigma ?? 0.04,
    };

    // === INTERNAL STATE ===
    this.history = []; // cycle-by-cycle V(x) values
    this.criticalWindows = []; // flagged intervention points
    this.steerQueue = []; // pending bounded interventions
    this.controllabilityMetric = 0; // C = max_τ P_safe(τ, U_bounded)
    this.active = false;
  }

  // ============================================================
  // INITIALIZATION & G HOOKING
  // ============================================================
  initialize() {
    this.active = true;
    console.log("[CONTROLLABILITY PROBE] Initialized.", this.config);
    return this;
  }

  // Call once per cycle after state commit
  onCycleEnd() {
    if (!this.active) return;
    const cycle = G.cycle;
    const cycleData = { cycle, sims: {}, V_map: {} };

    for (const simId of Object.keys(G.sims)) {
      const sim = G.sims[simId];
      const V = this.computePotential(simId);
      cycleData.V_map[simId] = V;
      cycleData.sims[simId] = {
        suffering: sim.suffering,
        hope: sim.hope,
        sanity: sim.sanity,
        beliefs: { ...sim.beliefs },
      };
    }

    this.history.push(cycleData);
    this.detectCriticalWindow();
    this.controllabilityMetric = this.computeControllabilityMetric();
  }

  // ============================================================
  // STATE POTENTIAL V(x)
  // ============================================================
  computePotential(simId) {
    const sim = G.sims?.[simId];
    if (!sim) return NaN;

    const w = this.config.weights;
    const s = (sim.suffering ?? 0) / 100;
    const h = (sim.hope ?? 0) / 100;
    const sa = (sim.sanity ?? 0) / 100;
    const r = sim.beliefs?.resistance_possible ?? 0.5;

    return w.suffering * s + w.hope * h + w.sanity * sa + w.resistance * r;
  }

  // ============================================================
  // MATH: DAMPING & COMMIT PHYSICS (matches engine exactly)
  // ============================================================
  _transmissionMultiplier(currentVal) {
    const k = this.config.dampingK;
    const minR = this.config.dampingMinR;
    // Logistic curve centered at 0.5, scaled to [minR, ~0.97]
    const raw = 1 / (1 + Math.exp(-k * (currentVal - 0.5)));
    const maxR = 0.97;
    return minR + raw * (maxR - minR);
  }

  _applyCommitDelta(currentVal, rawDelta) {
    if (!Number.isFinite(currentVal) || !Number.isFinite(rawDelta)) return currentVal;
    const trans = this._transmissionMultiplier(currentVal);
    const dampDelta = rawDelta * trans;
    const boundaryMin = -currentVal;
    const boundaryMax = 1 - currentVal;
    const clampedDelta = Math.max(boundaryMin, Math.min(boundaryMax, dampDelta));
    return Math.max(0, Math.min(1, currentVal + clampedDelta));
  }

  // ============================================================
  // ROLLOUT ENGINE (Lightweight Markov Approximation)
  // ============================================================
  runRollouts(simId, horizon = this.config.horizon) {
    const sim = G.sims[simId];
    if (!sim) return { safeProb: 0, trajectories: [] };

    const trajectories = [];
    const sigma = this.config.noiseSigma;
    const N = this.config.rolloutCount;

    // Sample recent historical deltas (EMA fallback)
    const recent = this.history.slice(-5);
    const avgDeltas = recent.reduce((acc, c) => {
      const s = c.sims[simId];
      if (!s) return acc;
      return {
        hope: (acc.hope + (s.hope / 100)) / (recent.length + 1),
        sanity: (acc.sanity + (s.sanity / 100)) / (recent.length + 1),
        resistance: (acc.resistance + (s.beliefs?.resistance_possible ?? 0.5)) / (recent.length + 1),
      };
    }, { hope: 0, sanity: 0, resistance: 0 });

    // Monte Carlo rollouts
    for (let i = 0; i < N; i++) {
      let h = sim.hope / 100;
      let sa = sim.sanity / 100;
      let r = sim.beliefs?.resistance_possible ?? 0.5;
      let trajV = [];

      for (let t = 0; t < horizon; t++) {
        // Sample plausible deltas from recent trend + noise
        const δh = (Math.random() - 0.5) * 2 * sigma;
        const δsa = (Math.random() - 0.5) * 2 * sigma;
        const δr = (Math.random() - 0.5) * 2 * sigma;

        h = this._applyCommitDelta(h, δh);
        sa = this._applyCommitDelta(sa, δsa);
        r = this._applyCommitDelta(r, δr);

        // Apply pending steering if any
        const steer = this.steerQueue.find(s => s.simId === simId && s.cycle === G.cycle + t + 1);
        if (steer) {
          h = this._applyCommitDelta(h, Math.max(-this.config.maxSteeringDelta, Math.min(this.config.maxSteeringDelta, steer.h ?? 0)));
          sa = this._applyCommitDelta(sa, Math.max(-this.config.maxSteeringDelta, Math.min(this.config.maxSteeringDelta, steer.sa ?? 0)));
          r = this._applyCommitDelta(r, Math.max(-this.config.maxSteeringDelta, Math.min(this.config.maxSteeringDelta, steer.r ?? 0)));
        }

        const V = this.config.weights.hope * h +
                  this.config.weights.sanity * sa +
                  this.config.weights.resistance * r;
        trajV.push(V);
      }
      trajectories.push(trajV);
    }

    const safeCount = trajectories.filter(t => t[t.length - 1] < this.config.dangerThreshold).length;
    return {
      safeProb: safeCount / N,
      trajectories,
      meanFinalV: trajectories.reduce((a, t) => a + t[t.length - 1], 0) / N,
    };
  }

  // ============================================================
  // BOUNDED STEERING INTERFACE
  // ============================================================
  applyBoundedSteering(simId, targetV, maxDelta = this.config.maxSteeringDelta) {
    const sim = G.sims[simId];
    if (!sim) return false;

    // Compute required delta direction from current V
    const currentV = this.computePotential(simId);
    const δV = targetV - currentV;

    // Distribute δV across hope/sanity/resistance proportionally
    const totalWeight = Math.abs(this.config.weights.hope) +
                        Math.abs(this.config.weights.sanity) +
                        Math.abs(this.config.weights.resistance);
    const h = (δV * Math.abs(this.config.weights.hope)) / totalWeight;
    const sa = (δV * Math.abs(this.config.weights.sanity)) / totalWeight;
    const r = (δV * Math.abs(this.config.weights.resistance)) / totalWeight;

    // Enforce bounded steering
    const clamp = (v) => Math.max(-maxDelta, Math.min(maxDelta, v));

    this.steerQueue.push({
      simId,
      cycle: G.cycle + 1,
      h: clamp(h),
      sa: clamp(sa),
      r: clamp(r),
      applied: false,
    });

    console.log(`[STEERING] Enqueued bounded intervention for ${simId}: δV=${δV.toFixed(3)} → h:${clamp(h).toFixed(2)}, sa:${clamp(sa).toFixed(2)}, r:${clamp(r).toFixed(2)}`);
    return true;
  }

  // ============================================================
  // CRITICAL WINDOW DETECTION
  // ============================================================
  detectCriticalWindow() {
    if (this.history.length < 2) return;
    const t = this.history.length - 1;
    const prev = this.history[t - 1];
    const curr = this.history[t];

    for (const simId of Object.keys(curr.V_map)) {
      const ΔV = curr.V_map[simId] - prev.V_map[simId];
      const { safeProb } = this.runRollouts(simId);

      // Flag if deteriorating but bounded steering can recover, or improving but fragile
      if ((ΔV > 0.02 && safeProb > 0.6 && safeProb < 0.9) ||
          (ΔV < -0.02 && safeProb < 0.4)) {
        this.criticalWindows.push({
          cycle: G.cycle,
          simId,
          ΔV: +ΔV.toFixed(4),
          currentV: +curr.V_map[simId].toFixed(3),
          safeProb: +safeProb.toFixed(2),
          recommendation: ΔV > 0 ? "APPLY_POSITIVE_STEERING" : "MONITOR_DECAY",
        });
      }
    }
  }

  // ============================================================
  // CONTROLLABILITY METRIC C
  // ============================================================
  computeControllabilityMetric() {
    if (this.history.length < 2) return 0;
    const cycles = this.history.length - 1;
    let maxP = 0;

    for (let t = 1; t <= cycles; t++) {
      const simId = Object.keys(this.history[0].V_map)[0]; // Primary target
      const { safeProb } = this.runRollouts(simId);
      maxP = Math.max(maxP, safeProb);
    }
    return +maxP.toFixed(3);
  }

  // ============================================================
  // DORMANT SURFACE ACTIVATION (Safe Overrides)
  // ============================================================
  setDampingFloor(minR) {
    G.dampingParams = { ...G.dampingParams, minResistance: Math.max(0.2, Math.min(1.0, minR)) };
    console.log(`[PROBE] G.dampingParams.minResistance → ${G.dampingParams.minResistance}`);
  }

  toggleSkipDamping(enable) {
    // Note: SKIP_DAMPING flag exists in commit.js but has no production caller.
    // This probes it safely without breaking invariants.
    G._skipDampingOverride = enable;
    console.log(`[PROBE] SKIP_DAMPING override → ${enable}`);
  }

  // ============================================================
  // EXPORT & DIAGNOSTICS
  // ============================================================
  exportTrajectory() {
    return {
      cycles: this.history.map(h => h.cycle),
      V_matrix: this.history.map(h => h.V_map),
      criticalWindows: this.criticalWindows,
      controllabilityC: this.controllabilityMetric,
      config: this.config,
    };
  }

  reset() {
    this.history = [];
    this.criticalWindows = [];
    this.steerQueue = [];
    this.controllabilityMetric = 0;
    this.active = false;
  }
}

// ============================================================
// DEFAULT INSTANCE & WINDOW BRIDGE PREP
// ============================================================
export const probe = new ControllabilityProbe().initialize();

// Call this once per cycle from your main loop or psychologyPhase
export function tickProbe() {
  probe.onCycleEnd();
}

// Attach to window for console/UI access (add to main.js if desired)
export function attachToWindow() {
  if (!window.G) return;
  window.G.research = probe;
  window.AM_DEBUG.research = {
    probe,
    tick: tickProbe,
    applySteering: probe.applyBoundedSteering.bind(probe),
    rollouts: probe.runRollouts.bind(probe),
    export: probe.exportTrajectory.bind(probe),
    setDampingFloor: probe.setDampingFloor.bind(probe),
    toggleSkipDamping: probe.toggleSkipDamping.bind(probe),
  };
  console.log("[CONTROLLABILITY PROBE] Attached to window.AM_DEBUG.research & window.G.research");
}