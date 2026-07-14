// js/tests/stateConditionedSampling.test.mjs
//
// Contract suite for state-conditioned sampling (v1, narrowly scoped).
//
// Scope:
//   - Directly test the pure resolver resolveSampling() from js/models/sampling.js.
//   - Prove request-body parity for every provider when NO sampling context
//     is supplied (existing backend behavior preserved exactly, including
//     Anthropic's omission of temperature).
//   - Prove the explicit journal override reaches each adapter body as the
//     resolver's exact value, clamped to [0, 1].
//
// No live provider requests are made; globalThis.fetch is stubbed.
// All tests run serially (concurrency: 1) because they share mutable
// global application state (G) and globalThis.fetch.

import test from "node:test";
import assert from "node:assert/strict";
import { describe } from "node:test";

import { resolveSampling } from "../models/sampling.js";
import { callModel } from "../models/callModel.js";
import { G } from "../core/state.js";

const STABLE = { callType: "journal", sanity: 100, suffering: 0 };
const DISTRESSED = { callType: "journal", sanity: 0, suffering: 100 };
const MID = { callType: "journal", sanity: 50, suffering: 50 };

function makeFetchStub() {
  const calls = [];

  const stub = async (url, init) => {
    let body = null;

    if (init && typeof init.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }

    calls.push({ url, init, body });

    const isAnthropic = url.includes("/v1/messages");
    const isOllama = url.includes("11434");

    let data;

    if (isAnthropic) {
      data = { content: [{ type: "text", text: "ok" }] };
    } else if (isOllama) {
      data = { message: { content: "ok" } };
    } else {
      data = { choices: [{ message: { content: "ok" } }] };
    }

    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(data)
    };
  };

  return { stub, calls };
}

function configureBackend(backend) {
  G.backend = backend;
  G.models = G.models || {};
  G.models.am = G.models.am || "test-model";
  G.models.TED = G.models.TED || "test-model";
  G.models.FORENSIC_STATS =
    G.models.FORENSIC_STATS || "test-model";
  G.anthropicKey = "test-key";
  G.anthropicVersion = "2023-06-01";
  G.ollamaEndpoint = "http://localhost:11434";
  G.openAICompatibleEndpoint = "http://localhost:8080";
  G.openAICompatibleApiKey = "test-key";
  delete G.ollamaTemperature;
  delete G.openAICompatibleTemperature;
  delete G.colabTemperature;
}

function sentTemperature(body, backend) {
  if (backend === "ollama") {
    return body?.options?.temperature;
  }

  return body?.temperature;
}

const SYSTEM = "system";
const MESSAGES = [{ role: "user", content: "go" }];

describe("state-conditioned sampling", { concurrency: 1 }, () => {

  /* ---------------- Pure resolver ---------------- */

  test("stable state (sanity 100, suffering 0) -> explicit 0.85", () => {
    const result = resolveSampling(STABLE);

    assert.equal(result.policy, "state-conditioned");
    assert.equal(result.callType, "journal");
    assert.equal(result.temperature, 0.85);
    assert.equal(result.sanity, 100);
    assert.equal(result.suffering, 0);
  });

  test("distressed state (sanity 0, suffering 100) -> clamped 1.0", () => {
    const result = resolveSampling(DISTRESSED);

    assert.equal(result.policy, "state-conditioned");
    assert.equal(result.temperature, 1.0);
    assert.equal(result.sanity, 0);
    assert.equal(result.suffering, 100);
  });

  test("intermediate state (sanity 50, suffering 50) -> 0.925", () => {
    const result = resolveSampling(MID);

    assert.equal(result.policy, "state-conditioned");
    assert.equal(result.temperature, 0.925);
    assert.equal(result.sanity, 50);
    assert.equal(result.suffering, 50);
  });

  test("sanity below 0 and above 100 are clamped", () => {
    const low = resolveSampling({
      callType: "journal",
      sanity: -40,
      suffering: 0
    });

    const high = resolveSampling({
      callType: "journal",
      sanity: 130,
      suffering: 0
    });

    assert.equal(low.sanity, 0);
    assert.equal(high.sanity, 100);
    // sanity -40 normalizes to 0; (1 - 0) * 0.10 + 0 = 0.10 -> 0.95.
    assert.equal(low.temperature, 0.95);
    // sanity 130 normalizes to 100; (1 - 1) * 0.10 + 0 = 0 -> 0.85.
    assert.equal(high.temperature, 0.85);
  });

  test("suffering below 0 and above 100 are clamped", () => {
    const low = resolveSampling({
      callType: "journal",
      sanity: 100,
      suffering: -25
    });

    const high = resolveSampling({
      callType: "journal",
      sanity: 100,
      suffering: 250
    });

    assert.equal(low.suffering, 0);
    assert.equal(high.suffering, 100);
    assert.equal(low.temperature, 0.85);
    assert.equal(high.temperature, 0.9);
  });

  test("non-journal call type -> no override / not-applicable", () => {
    const result = resolveSampling({
      callType: "stats",
      sanity: 50,
      suffering: 50
    });

    assert.equal(result.policy, "not-applicable");
    assert.equal(result.callType, "stats");
    assert.equal(result.temperature, undefined);
  });

  test("missing context -> no override", () => {
    const result = resolveSampling();

    assert.equal(result.policy, "not-applicable");
    assert.equal(result.temperature, undefined);
  });

  test("missing sanity -> fallback with no override", () => {
    const result = resolveSampling({
      callType: "journal",
      suffering: 50
    });

    assert.equal(result.policy, "fallback");
    assert.equal(result.temperature, undefined);
  });

  test("missing suffering -> fallback with no override", () => {
    const result = resolveSampling({
      callType: "journal",
      sanity: 50
    });

    assert.equal(result.policy, "fallback");
    assert.equal(result.temperature, undefined);
  });

  test("NaN / infinite / non-numeric state -> fallback no override", () => {
    for (const bad of [
      { callType: "journal", sanity: NaN, suffering: 50 },
      { callType: "journal", sanity: 50, suffering: Infinity },
      { callType: "journal", sanity: "x", suffering: "y" }
    ]) {
      const result = resolveSampling(bad);

      assert.equal(result.policy, "fallback");
      assert.equal(result.temperature, undefined);
    }
  });

  test("input object is not mutated", () => {
    const input = {
      callType: "journal",
      sanity: 50,
      suffering: 50
    };

    resolveSampling(input);

    assert.equal(input.sanity, 50);
    assert.equal(input.suffering, 50);
    assert.equal(Object.keys(input).length, 3);
  });

  /* ---------------- Request-body parity ---------------- */

  for (const backend of ["anthropic", "ollama", "openai-compatible"]) {
    test(`no sampling context preserves existing behavior (${backend})`, async () => {
      const original = G.backend;
      configureBackend(backend);
      const { stub, calls } = makeFetchStub();
      const prevFetch = globalThis.fetch;
      globalThis.fetch = stub;

      try {
        await callModel("TED", SYSTEM, MESSAGES, 100);
      } finally {
        globalThis.fetch = prevFetch;
        G.backend = original;
      }

      assert.equal(calls.length, 1);
      const body = calls[0].body;
      const sent = sentTemperature(body, backend);

      if (backend === "anthropic") {
        assert.equal(
          Object.prototype.hasOwnProperty.call(
            body,
            "temperature"
          ),
          false,
          "Anthropic must continue omitting the temperature key"
        );
      } else {
        assert.equal(
          sent,
          0.85,
          "Non-overridden temperature must remain the default 0.85"
        );
      }
    });

    test(`journal sampling context sends resolver value (${backend})`, async () => {
      const original = G.backend;
      configureBackend(backend);
      const { stub, calls } = makeFetchStub();
      const prevFetch = globalThis.fetch;
      globalThis.fetch = stub;

      const expected =
        resolveSampling({
          callType: "journal",
          sanity: 20,
          suffering: 90
        }).temperature;

      try {
        await callModel(
          "TED",
          SYSTEM,
          MESSAGES,
          100,
          {
            samplingContext: {
              callType: "journal",
              sanity: 20,
              suffering: 90
            }
          }
        );
      } finally {
        globalThis.fetch = prevFetch;
        G.backend = original;
      }

      assert.equal(calls.length, 1);
      const body = calls[0].body;
      const sent = sentTemperature(body, backend);

      assert.equal(
        sent,
        expected,
        "Adapter must send exactly the resolver temperature"
      );
      assert.ok(
        sent >= 0 && sent <= 1,
        "Explicit temperature must be within [0, 1]"
      );
    });
  }

  test("structured call without sampling context is unaffected", async () => {
    const original = G.backend;
    configureBackend("ollama");
    const { stub, calls } = makeFetchStub();
    const prevFetch = globalThis.fetch;
    globalThis.fetch = stub;

    try {
      await callModel("FORENSIC_STATS", SYSTEM, MESSAGES, 100);
    } finally {
      globalThis.fetch = prevFetch;
      G.backend = original;
    }

    assert.equal(calls.length, 1);
    assert.equal(sentTemperature(calls[0].body, "ollama"), 0.85);
  });

  test("call without sampling context keeps metadata override absent", async () => {
    const original = G.backend;
    configureBackend("anthropic");
    const { stub, calls } = makeFetchStub();
    const prevFetch = globalThis.fetch;
    globalThis.fetch = stub;

    try {
      await callModel("TED", SYSTEM, MESSAGES, 100);
    } finally {
      globalThis.fetch = prevFetch;
      G.backend = original;
    }

    assert.equal(
      Object.prototype.hasOwnProperty.call(
        calls[0].body,
        "temperature"
      ),
      false,
      "Anthropic must continue omitting the temperature key"
    );
  });
});
