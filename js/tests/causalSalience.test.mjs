import assert from "node:assert/strict";
import { test } from "node:test";

import { G } from "../core/state.js";
import { SIM_IDS } from "../core/constants.js";
import { engineRng } from "../core/prng.js";
import { commitResourceInterventions } from "../engine/analysis/commitResourceInterventions.js";
import { commitAgencyResolution } from "../engine/agency/commit.js";
import { createAgencyState } from "../engine/agency/state/createAgencyState.js";

const GAME_FIELDS = [
  "cycle",
  "sims",
  "resources",
  "agency",
  "pendingResourceDiscoveries",
  "recentResourceDiscoveries",
  "resourceEvents",
  "resourceEventSequence",
  "claimState",
  "claimEvents",
  "claimDivergence",
  "pendingEvidence",
  "timeline"
];

function resource(resourceId, holderId, quantity, provenance = { source: "scenario_seed" }) {
  return {
    resourceId,
    definitionId: "cigarette",
    quantity,
    holderId,
    locationId: null,
    accessible: true,
    concealed: false,
    provenance
  };
}

function createGame(cycle, instances) {
  const sims = Object.fromEntries(
    SIM_IDS.map((id) => [id, {
      id,
      hope: 50,
      sanity: 60,
      suffering: 10,
      scratchpad: { initialized: true }
    }])
  );

  return {
    cycle,
    sims,
    resources: { instances },
    agency: createAgencyState(),
    pendingResourceDiscoveries: [],
    recentResourceDiscoveries: [],
    resourceEvents: [],
    resourceEventSequence: { cycle: null, next: 1 },
    claimState: {},
    claimEvents: [],
    claimDivergence: {},
    pendingEvidence: { resourceInterventions: Object.create(null) },
    timeline: []
  };
}

async function withGame(game, body) {
  const previous = Object.fromEntries(
    GAME_FIELDS.map((field) => [field, G[field]])
  );
  const rngState = engineRng.getState();
  Object.assign(G, game);

  try {
    return await body(G);
  } finally {
    Object.assign(G, previous);
    engineRng.setState(rngState);
  }
}

function useResolution(actorId) {
  return {
    actorId,
    action: { type: "USE" },
    status: "success",
    operations: [],
    provenance: { source: "agency_resolver" }
  };
}

function flagsFor(state, actorId) {
  return state.pendingResourceDiscoveries.filter(
    (flag) => flag.actorId === actorId
  );
}

test("SEARCH salience is limited to current-cycle acquisitions", async () => {
  const cycle = 12;
  const game = createGame(cycle, [
    resource("stale_search", "TED", 1, {
      source: "environment_search",
      cycle: cycle - 1
    }),
    resource("untouched_seed", "TED", 1)
  ]);

  await withGame(game, async (state) => {
    commitAgencyResolution(state, [{
      ...useResolution("TED"),
      action: { type: "SEARCH" },
      operations: [{ type: "find", definitionId: "match", quantity: 1 }],
      provenance: { source: "agency_resolver", searchAttempted: true }
    }]);

    const found = state.resources.instances.find(
      (instance) =>
        instance.provenance?.source === "environment_search" &&
        instance.provenance?.cycle === cycle
    );

    assert.equal(found.provenance.cycle, cycle);
    assert.deepEqual(
      flagsFor(state, "TED").map((flag) => flag.resourceId),
      [found.resourceId]
    );
  });
});

test("current-cycle AM full and split transfers are salient", async () => {
  const cycle = 13;
  const game = createGame(cycle, [
    resource("am_full", "ELLEN", 2),
    resource("am_split", "ELLEN", 3)
  ]);

  await withGame(game, async (state) => {
    const result = commitResourceInterventions(state, [
      {
        intervention_type: "transfer",
        resource_id: "am_full",
        holder_id: "ELLEN",
        target_holder_id: "TED",
        quantity: 2
      },
      {
        intervention_type: "transfer",
        resource_id: "am_split",
        holder_id: "ELLEN",
        target_holder_id: "TED",
        quantity: 1
      }
    ]);

    assert.equal(result.committed.length, 2);

    const split = state.resources.instances.find(
      (instance) => instance.provenance?.transferredFrom === "am_split"
    );
    assert.ok(split);
    assert.equal(split.provenance.interventionCycle, cycle);

    commitAgencyResolution(state, [useResolution("TED")]);

    assert.deepEqual(
      flagsFor(state, "TED").map((flag) => flag.resourceId).sort(),
      ["am_full", split.resourceId].sort()
    );
  });
});

test("same-cycle prisoner full and split transfers are salient", async () => {
  const cycle = 14;
  const game = createGame(cycle, [
    resource("prisoner_full", "ELLEN", 2),
    resource("prisoner_split", "ELLEN", 3)
  ]);

  await withGame(game, async (state) => {
    commitAgencyResolution(state, [
      {
        actorId: "ELLEN",
        action: { type: "TRANSFER" },
        status: "success",
        operations: [
          {
            kind: "transfer",
            resourceId: "prisoner_full",
            quantity: 2,
            targetId: "TED"
          },
          {
            kind: "transfer",
            resourceId: "prisoner_split",
            quantity: 1,
            targetId: "TED"
          }
        ],
        provenance: { source: "agency_resolver" }
      },
      useResolution("TED")
    ]);

    const split = state.resources.instances.find(
      (instance) => instance.holderId === "TED" &&
        instance.provenance?.transferredFrom === "prisoner_split"
    );
    assert.ok(split);

    assert.deepEqual(
      flagsFor(state, "TED").map((flag) => flag.resourceId).sort(),
      ["prisoner_full", split.resourceId].sort()
    );
  });
});

test("salience is deterministic and does not consume engine RNG", async () => {
  async function run(nextValue) {
    const game = createGame(15, [
      resource("current_search", "TED", 1, {
        source: "environment_search",
        cycle: 15
      }),
      resource("untouched", "TED", 1)
    ]);

    return withGame(game, async (state) => {
      const originalNext = engineRng.next;
      let draws = 0;
      engineRng.next = () => {
        draws += 1;
        return nextValue;
      };

      try {
        commitAgencyResolution(state, [useResolution("TED")]);
        return {
          draws,
          flags: structuredClone(state.pendingResourceDiscoveries)
        };
      } finally {
        engineRng.next = originalNext;
      }
    });
  }

  const lowRngValue = await run(0);
  const highRngValue = await run(0.99);

  assert.equal(lowRngValue.draws, 0);
  assert.equal(highRngValue.draws, 0);
  assert.deepEqual(highRngValue.flags, lowRngValue.flags);
  assert.deepEqual(
    lowRngValue.flags.map((flag) => flag.resourceId),
    ["current_search"]
  );
});
