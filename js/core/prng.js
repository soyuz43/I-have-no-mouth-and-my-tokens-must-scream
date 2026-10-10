const UINT32_MAX = 0xffffffff;
const UINT32_RANGE = 0x100000000;
const STATE_INCREMENT = 0x6d2b79f5;

function normalizeSeed(seed) {
  if (typeof seed === "number" && Number.isFinite(seed)) {
    return Math.trunc(seed) >>> 0;
  }

  if (typeof seed === "string") {
    let hash = 0x811c9dc5;
    for (let index = 0; index < seed.length; index++) {
      hash = Math.imul(hash ^ seed.charCodeAt(index), 0x01000193);
    }
    return hash >>> 0;
  }

  throw new TypeError("Seed must be a finite number or string.");
}

function deriveSeed(seed, stream) {
  let value = (seed ^ stream) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x21f0aaad);
  value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
  return (value ^ (value >>> 15)) >>> 0;
}

export function isValidRngState(state) {
  return (
    state !== null &&
    typeof state === "object" &&
    !Array.isArray(state) &&
    Number.isInteger(state.state) &&
    state.state >= 0 &&
    state.state <= UINT32_MAX
  );
}

export function createRng(seed = Date.now()) {
  let state = normalizeSeed(seed);

  return {
    next() {
      state = (state + STATE_INCREMENT) >>> 0;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / UINT32_RANGE;
    },
    getState() {
      return { state };
    },
    setState(nextState) {
      if (!isValidRngState(nextState)) {
        throw new TypeError("RNG state must contain a uint32 state value.");
      }
      state = nextState.state;
    },
  };
}

const initialSeed = Date.now();

export const engineRng = createRng(deriveSeed(initialSeed, 0x243f6a88));
export const uiRng = createRng(deriveSeed(initialSeed, 0x85a308d3));
export const researchRng = createRng(deriveSeed(initialSeed, 0x13198a2e));

export function seedAll(seed = Date.now()) {
  const normalizedSeed = normalizeSeed(seed);
  engineRng.setState({ state: deriveSeed(normalizedSeed, 0x243f6a88) });
  uiRng.setState({ state: deriveSeed(normalizedSeed, 0x85a308d3) });
  researchRng.setState({ state: deriveSeed(normalizedSeed, 0x13198a2e) });
}
