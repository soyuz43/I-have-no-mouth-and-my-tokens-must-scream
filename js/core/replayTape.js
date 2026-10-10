const TAPE_VERSION = 1;
const TAPE_HASH_PATTERN = /^fnv1a-[0-9a-f]{8}$/;

export const TAPE_MODES = Object.freeze({
  OFF: "OFF",
  RECORD: "RECORD",
  REPLAY: "REPLAY",
});

const tape = new Map();
let mode = TAPE_MODES.OFF;

export function setMode(nextMode) {
  if (!Object.values(TAPE_MODES).includes(nextMode)) {
    throw new Error(`Unsupported replay tape mode: ${nextMode}`);
  }
  mode = nextMode;
  return mode;
}

export function getMode() {
  return mode;
}

export function hashRequest(systemPrompt, messages, temperature, maxTokens) {
  const request = stableStringify([
    systemPrompt,
    messages,
    temperature,
    maxTokens,
  ]);
  let hash = 0x811c9dc5;

  for (let index = 0; index < request.length; index++) {
    let codePoint = request.codePointAt(index);
    if (codePoint > 0xffff) index++;
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) {
      codePoint = 0xfffd;
    }

    if (codePoint <= 0x7f) {
      hash = updateHash(hash, codePoint);
    } else if (codePoint <= 0x7ff) {
      hash = updateHash(hash, 0xc0 | (codePoint >> 6));
      hash = updateHash(hash, 0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
      hash = updateHash(hash, 0xe0 | (codePoint >> 12));
      hash = updateHash(hash, 0x80 | ((codePoint >> 6) & 0x3f));
      hash = updateHash(hash, 0x80 | (codePoint & 0x3f));
    } else {
      hash = updateHash(hash, 0xf0 | (codePoint >> 18));
      hash = updateHash(hash, 0x80 | ((codePoint >> 12) & 0x3f));
      hash = updateHash(hash, 0x80 | ((codePoint >> 6) & 0x3f));
      hash = updateHash(hash, 0x80 | (codePoint & 0x3f));
    }
  }

  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function recordRequest(hash, response) {
  if (typeof hash !== "string" || !TAPE_HASH_PATTERN.test(hash)) {
    throw new TypeError("Replay tape hash must be an FNV-1a request hash.");
  }
  if (typeof response !== "string") {
    throw new TypeError("Replay tape responses must be strings.");
  }
  tape.set(hash, response);
}

export function replayRequest(hash) {
  if (tape.has(hash)) {
    return tape.get(hash);
  }
  throw new Error(
    `[REPLAY TAPE] Cache miss for hash ${hash}. Failing closed to preserve reproducibility.`,
  );
}

export function exportTape() {
  return {
    version: TAPE_VERSION,
    entries: Array.from(tape, ([hash, response]) => ({ hash, response })),
  };
}

export function importTape(tapeData) {
  const importedEntries = parseTapeData(tapeData);
  tape.clear();
  for (const [hash, response] of importedEntries) {
    tape.set(hash, response);
  }
}

export function isValidTapeData(tapeData) {
  try {
    parseTapeData(tapeData);
    return true;
  } catch {
    return false;
  }
}

export function clearTape() {
  tape.clear();
}

function updateHash(hash, byte) {
  return Math.imul(hash ^ byte, 0x01000193) >>> 0;
}

function stableStringify(value) {
  return JSON.stringify(sortObjectKeys(value));
}

function sortObjectKeys(value) {
  if (Array.isArray(value)) {
    return value.map(sortObjectKeys);
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortObjectKeys(value[key])]),
  );
}

function parseTapeData(tapeData) {
  if (
    !tapeData ||
    typeof tapeData !== "object" ||
    Array.isArray(tapeData) ||
    tapeData.version !== TAPE_VERSION ||
    !Array.isArray(tapeData.entries)
  ) {
    throw new Error("Invalid replay tape data.");
  }

  const importedEntries = [];
  const seenHashes = new Set();
  for (const entry of tapeData.entries) {
    if (
      !entry ||
      typeof entry !== "object" ||
      Array.isArray(entry) ||
      typeof entry.hash !== "string" ||
      !TAPE_HASH_PATTERN.test(entry.hash) ||
      typeof entry.response !== "string" ||
      seenHashes.has(entry.hash)
    ) {
      throw new Error("Invalid replay tape entry.");
    }
    seenHashes.add(entry.hash);
    importedEntries.push([entry.hash, entry.response]);
  }

  return importedEntries;
}
