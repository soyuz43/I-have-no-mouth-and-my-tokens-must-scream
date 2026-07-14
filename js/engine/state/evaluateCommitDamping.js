// js/engine/state/evaluateCommitDamping.js
//
// Pure commit-layer damping evaluator.
//
// Reproduces, exactly, the commit-damping transmission coefficient currently
// hard-coded inside dampBeliefDelta.js (the historical "current-production-v1"
// hybrid formula, plus the constant and none modes introduced by the explicit
// policy). It mutates nothing: not the policy, not the sim, not any global. It
// performs no boundary clamp and no belief mutation. Hard clamps are the
// responsibility of the commit path.
//
// Source facts preserved from dampBeliefDelta.js:
//   - coefficient = max(coefficientFloor, blend*logistic + (1-blend)*quadratic)
//   - stress = (sim.suffering ?? 0) / 100
//   - trust = sim.beliefs?.others_trustworthy ?? 0.5
//   - adjustedMid = logisticMid - stress*0.12 + trust*0.1
//   - logistic = 1 / (1 + exp(k * (d - adjustedMid)))
//   - quadratic = (1 - d)^2, where d = |currentValue - 0.5| / 0.5
// Missing/non-finite context uses the SAME production fallbacks; no stricter
// coercion is introduced (preserving current default behavior).

export function evaluateCommitDamping(policy, sim, beliefKey, currentValue, inputDelta) {
  const { commitDamping } = policy;
  const mode = commitDamping.mode;
  const params = commitDamping.params || {};

  if (mode === "hybrid") {
    const k = params.logisticK;
    const mid = params.logisticMid;
    const blend = params.hybridBlend;
    const coefficientFloor = params.coefficientFloor;

    const distance = Math.abs(currentValue - 0.5);
    const d = distance / 0.5;

    const stress = (sim.suffering ?? 0) / 100;
    const trust = sim.beliefs?.others_trustworthy ?? 0.5;

    const adjustedMid = mid - stress * 0.12 + trust * 0.1;

    const logistic = 1 / (1 + Math.exp(k * (d - adjustedMid)));
    const quadratic = (1 - d) * (1 - d);

    const blendComponent = blend * logistic + (1 - blend) * quadratic;
    const coefficient = Math.max(coefficientFloor, blendComponent);
    const outputDelta = inputDelta * coefficient;

    return {
      mode,
      coefficient,
      coefficientFloor,
      inputDelta,
      outputDelta,
      calculation: {
        normalizedDistance: d,
        distanceFromMidpoint: distance,
        stress,
        trust,
        adjustedMid,
        logistic,
        quadratic,
        blend,
        coefficientBeforeFloor: blendComponent,
        finalCoefficient: coefficient
      }
    };
  }

  if (mode === "constant") {
    const coefficient = params.constantCoefficient;
    const coefficientFloor = params.coefficientFloor;
    const outputDelta = inputDelta * coefficient;
    return {
      mode,
      coefficient,
      coefficientFloor,
      inputDelta,
      outputDelta,
      calculation: {
        coefficient
      }
    };
  }

  if (mode === "none") {
    const coefficient = 1;
    const coefficientFloor = null;
    const outputDelta = inputDelta * coefficient;
    return {
      mode,
      coefficient,
      coefficientFloor,
      inputDelta,
      outputDelta,
      calculation: {}
    };
  }

  throw new Error("evaluateCommitDamping: unsupported commit-damping mode: " + String(mode));
}