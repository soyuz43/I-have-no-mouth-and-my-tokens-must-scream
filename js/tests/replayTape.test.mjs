import assert from "node:assert/strict";
import { test } from "node:test";

import { G } from "../core/state.js";
import { exportState, importState } from "../core/saveLoad.js";
import {
  clearTape,
  exportTape,
  hashRequest,
  recordRequest,
  replayRequest,
  setMode,
  TAPE_MODES,
} from "../core/replayTape.js";
import { callModel } from "../models/callModel.js";

test("request hashing is stable for equivalent request objects", () => {
  clearTape();
  const firstHash = hashRequest(
    "System prompt",
    [{ role: "user", content: "Hello", metadata: { b: 2, a: 1 } }],
    0.4,
    128,
  );
  const equivalentHash = hashRequest(
    "System prompt",
    [{ role: "user", content: "Hello", metadata: { a: 1, b: 2 } }],
    0.4,
    128,
  );

  assert.equal(firstHash, equivalentHash);
  assert.match(firstHash, /^fnv1a-[0-9a-f]{8}$/);
  assert.notEqual(
    firstHash,
    hashRequest("System prompt", [{ role: "user", content: "Hello" }], 0.5, 128),
  );
});

test("RECORD mode stores the validated callModel response by request hash", async () => {
  const previousBackend = G.backend;
  const hadTemperature = Object.hasOwn(G, "ollamaTemperature");
  const previousTemperature = G.ollamaTemperature;
  const previousFetch = globalThis.fetch;

  try {
    G.backend = "ollama";
    G.ollamaTemperature = 0.31;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        message: { content: "Mock recorded response" },
      }),
    });
    clearTape();
    setMode(TAPE_MODES.RECORD);

    const prompt = "Record system prompt";
    const messages = [{ role: "user", content: "Record me" }];
    const response = await callModel("AM", prompt, messages, 72);
    const hash = hashRequest(prompt, messages, 0.31, 72);

    assert.equal(response, "Mock recorded response");
    assert.equal(replayRequest(hash), "Mock recorded response");
    assert.deepEqual(exportTape().entries, [
      { hash, response: "Mock recorded response" },
    ]);
  } finally {
    globalThis.fetch = previousFetch;
    G.backend = previousBackend;
    if (hadTemperature) {
      G.ollamaTemperature = previousTemperature;
    } else {
      delete G.ollamaTemperature;
    }
    clearTape();
    setMode(TAPE_MODES.OFF);
  }
});

test("REPLAY returns cached text without executing the backend fetch", async () => {
  const previousBackend = G.backend;
  const hadTemperature = Object.hasOwn(G, "ollamaTemperature");
  const previousTemperature = G.ollamaTemperature;
  const previousFetch = globalThis.fetch;
  let fetchCalls = 0;

  try {
    G.backend = "ollama";
    G.ollamaTemperature = 0.23;
    globalThis.fetch = async () => {
      fetchCalls++;
      throw new Error("Replay unexpectedly reached the backend.");
    };

    const prompt = "Replay system prompt";
    const messages = [{ role: "user", content: "Replay me" }];
    const hash = hashRequest(prompt, messages, 0.23, 64);
    clearTape();
    recordRequest(hash, "Cached response");
    setMode(TAPE_MODES.REPLAY);

    assert.equal(await callModel("AM", prompt, messages, 64), "Cached response");
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = previousFetch;
    G.backend = previousBackend;
    if (hadTemperature) {
      G.ollamaTemperature = previousTemperature;
    } else {
      delete G.ollamaTemperature;
    }
    clearTape();
    setMode(TAPE_MODES.OFF);
  }
});

test("REPLAY cache misses fail closed with a deterministic error", async () => {
  const previousBackend = G.backend;
  const hadTemperature = Object.hasOwn(G, "ollamaTemperature");
  const previousTemperature = G.ollamaTemperature;

  try {
    G.backend = "ollama";
    G.ollamaTemperature = 0.23;
    clearTape();
    setMode(TAPE_MODES.REPLAY);

    const prompt = "Missing system prompt";
    const messages = [{ role: "user", content: "Not recorded" }];
    const hash = hashRequest(prompt, messages, 0.23, 64);
    await assert.rejects(callModel("AM", prompt, messages, 64), {
      message: `[REPLAY TAPE] Cache miss for hash ${hash}. Failing closed to preserve reproducibility.`,
    });
  } finally {
    G.backend = previousBackend;
    if (hadTemperature) {
      G.ollamaTemperature = previousTemperature;
    } else {
      delete G.ollamaTemperature;
    }
    clearTape();
    setMode(TAPE_MODES.OFF);
  }
});

test("REPLAY returns cached text without provider credentials", async () => {
  const previousBackend = G.backend;
  const hadApiKey = Object.hasOwn(G, "anthropicKey");
  const previousApiKey = G.anthropicKey;

  try {
    G.backend = "anthropic";
    G.anthropicKey = "";
    const prompt = "Keyless replay prompt";
    const messages = [{ role: "user", content: "Replay locally" }];
    const hash = hashRequest(prompt, messages, null, 80);
    clearTape();
    recordRequest(hash, "Keyless cached response");
    setMode(TAPE_MODES.REPLAY);

    assert.equal(
      await callModel("AM", prompt, messages, 80),
      "Keyless cached response",
    );
  } finally {
    G.backend = previousBackend;
    if (hadApiKey) {
      G.anthropicKey = previousApiKey;
    } else {
      delete G.anthropicKey;
    }
    clearTape();
    setMode(TAPE_MODES.OFF);
  }
});

test("save/load round-trip restores tape entries and replaces old entries", async () => {
  const prompt = "Saved system prompt";
  const messages = [{ role: "user", content: "Saved message" }];
  const hash = hashRequest(prompt, messages, 0.5, 96);

  try {
    clearTape();
    recordRequest(hash, "Saved response");
    const savedEnvelope = JSON.parse(exportState());

    assert.deepEqual(savedEnvelope.tape, {
      version: 1,
      entries: [{ hash, response: "Saved response" }],
    });

    clearTape();
    recordRequest(hashRequest("stale", [], 0.5, 96), "Stale response");
    await importState(JSON.stringify(savedEnvelope));

    assert.equal(replayRequest(hash), "Saved response");
    assert.equal(exportTape().entries.length, 1);
  } finally {
    clearTape();
    setMode(TAPE_MODES.OFF);
  }
});
