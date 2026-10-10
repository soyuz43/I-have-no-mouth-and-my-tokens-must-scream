import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { G } from "../core/state.js";
import { engineRng } from "../core/prng.js";
import { maybeOverhear, recordOverheard } from "../engine/comms/social/overhearing.js";

const GLOBAL_KEYS = ["sims", "cycle", "overhearing", "privateLeak"];
let savedGlobals;
let savedDocument;
let savedEngineRngNext;

function makeSim(id) {
  return {
    id,
    sanity: 70,
    suffering: 20,
    beliefs: { others_trustworthy: 0.5 },
    relationships: { TED: 0, ELLEN: 0, NIMDOK: 0 },
  };
}

function makeSourceMessage(overrides = {}) {
  return {
    messageId: "C7-M000014",
    sequence: 14,
    cycle: 7,
    kind: "OUTREACH",
    from: "TED",
    to: ["ELLEN"],
    text: "The exit key is behind the furnace.",
    visibility: "private",
    ...overrides,
  };
}

beforeEach(() => {
  savedGlobals = Object.fromEntries(GLOBAL_KEYS.map((key) => [key, G[key]]));
  savedDocument = globalThis.document;
  savedEngineRngNext = engineRng.next;

  G.sims = {
    TED: makeSim("TED"),
    ELLEN: makeSim("ELLEN"),
    NIMDOK: makeSim("NIMDOK"),
  };
  G.cycle = 7;
  G.overhearing = {
    history: [],
    lastCycle: [],
    nextEventSequence: 1,
  };
  G.privateLeak = { full: 1, fragment: 0, seen: 0 };
  globalThis.document = { getElementById: () => null };
});

afterEach(() => {
  for (const [key, value] of Object.entries(savedGlobals)) G[key] = value;
  engineRng.next = savedEngineRngNext;
  if (savedDocument === undefined) delete globalThis.document;
  else globalThis.document = savedDocument;
});

test("recordOverheard creates linked canonical events for each outcome", () => {
  const outcomes = [
    { outcome: "full", perception: "full", text: "The exit key is behind the furnace." },
    { outcome: "fragment", perception: "middle_fragment", text: "...key is behind..." },
    { outcome: "observed_only", perception: "observed_only", text: null },
  ];

  for (const [index, result] of outcomes.entries()) {
    const sourceMessage = makeSourceMessage({
      messageId: `C7-M${String(index + 14).padStart(6, "0")}`,
      sequence: index + 14,
    });
    const event = recordOverheard({
      listener: "nimdok",
      sourceMessage,
      outcome: result.outcome,
      perception: result.perception,
      perceivedText: result.text,
      characterRange: result.text ? { start: 0, end: result.text.length } : null,
    });

    assert.equal(event.eventId, `C7-O${String(index + 1).padStart(6, "0")}`);
    assert.equal(event.listener, "NIMDOK");
    assert.equal(event.outcome, result.outcome);
    assert.deepEqual(event.sourceMessageIds, [sourceMessage.messageId]);
    assert.equal(event.observations[0].sourceMessageId, sourceMessage.messageId);
    assert.equal(event.observations[0].perception, result.perception);

    const compatibilityEntry = G.sims.NIMDOK.overheard[index];
    assert.equal(compatibilityEntry.eventId, event.eventId);
    assert.equal(compatibilityEntry.sourceMessageId, sourceMessage.messageId);
    assert.equal(compatibilityEntry.outcome, result.outcome);
    assert.equal(
      compatibilityEntry.text,
      result.outcome === "observed_only" ? "(whispering observed)" : result.text,
    );
  }

  assert.equal(G.overhearing.history.length, outcomes.length);
  assert.equal(G.overhearing.lastCycle.length, outcomes.length);
});

test("maybeOverhear returns the canonical event generated from a private message", () => {
  engineRng.next = () => 0;

  const event = maybeOverhear(makeSourceMessage());

  assert.ok(event);
  assert.equal(event.eventId, "C7-O000001");
  assert.equal(event.listener, "NIMDOK");
  assert.equal(event.outcome, "full");
  assert.deepEqual(event.sourceMessageIds, ["C7-M000014"]);
  assert.equal(event.observations[0].sourceMessageId, "C7-M000014");
  assert.equal(G.sims.NIMDOK.overheard[0].eventId, event.eventId);
});
