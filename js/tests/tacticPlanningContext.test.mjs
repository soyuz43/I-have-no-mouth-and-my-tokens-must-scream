// js/tests/tacticPlanningContext.test.mjs

import assert from "node:assert/strict";
import test from "node:test";

import { G } from "../core/state.js";
import { resetCycleEvidence } from "../engine/phases/helpers/resetCycleEvidence.js";
import { buildAMPlanningPrompt } from "../prompts/amPlan.js";
import {
  buildTacticPlanningContext
} from "../prompts/amPlan/buildTacticPlanningContext.js";

function makeTactic({
  path,
  title,
  objective,
  startPurpose = "Establish the opening condition.",
  startInstruction = "Apply the opening intervention.",
  currentPurpose = "Exploit the established condition.",
  currentInstruction = "Apply the current intervention."
}) {
  return {
    path,
    title,
    category:
      "Test Category",
    subcategory:
      "Test Subcategory",
    objective,
    initialPhaseId:
      "start",
    phases: {
      start: {
        purpose:
          startPurpose,
        instruction:
          startInstruction,
        nextPhaseId:
          "current"
      },

      current: {
        purpose:
          currentPurpose,
        instruction:
          currentInstruction,
        nextPhaseId:
          null
      }
    },
    finishWhen:
      "The whole tactic succeeds.",
    abandonWhen:
      "The whole tactic should stop."
  };
}

const tacticA =
  makeTactic({
    path:
      "__test__/tactic-a",
    title:
      "Tactic A",
    objective:
      "Complete objective A."
  });

const tacticB =
  makeTactic({
    path:
      "__test__/tactic-b",
    title:
      "Tactic B",
    objective:
      "Complete objective B."
  });

const tacticC =
  makeTactic({
    path:
      "__test__/tactic-c",
    title:
      "Tactic C",
    objective:
      "Complete objective C."
  });

test(
  "defines each canonical tactic path once globally",
  () => {
    const result =
      buildTacticPlanningContext({
        requiredTargetIds: [
          "TED",
          "ELLEN"
        ],

        tacticCandidatesByTarget: {
          TED: [
            tacticA,
            tacticB
          ],

          ELLEN: [
            tacticA,
            tacticC
          ]
        },

        tacticRuntimeByTarget: {},

        cycle: 0,

        simIds: [
          "TED",
          "ELLEN"
        ]
      });

    const occurrences =
      result.tacticLibrarySection
        .split(
          "PATH: __test__/tactic-a"
        )
        .length - 1;

    assert.equal(
      occurrences,
      1
    );

    assert.match(
      result.tacticLibrarySection,
      /PATH: __test__\/tactic-b/
    );

    assert.match(
      result.tacticLibrarySection,
      /PATH: __test__\/tactic-c/
    );
  }
);

test(
  "keeps authorization scoped to each target",
  () => {
    const result =
      buildTacticPlanningContext({
        requiredTargetIds: [
          "TED",
          "ELLEN"
        ],

        tacticCandidatesByTarget: {
          TED: [
            tacticA,
            tacticB
          ],

          ELLEN: [
            tacticB,
            tacticC
          ]
        },

        tacticRuntimeByTarget: {},

        cycle: 0,

        simIds: [
          "TED",
          "ELLEN"
        ]
      });

    const [
      tedBlock,
      ellenBlock
    ] =
      result.targetTacticSection.split(
        "\n\n" +
        "----------------------------------------" +
        "\n\n"
      );

    assert.match(
      tedBlock,
      /- __test__\/tactic-a/
    );

    assert.match(
      tedBlock,
      /- __test__\/tactic-b/
    );

    assert.doesNotMatch(
      tedBlock,
      /- __test__\/tactic-c/
    );

    assert.match(
      ellenBlock,
      /- __test__\/tactic-b/
    );

    assert.match(
      ellenBlock,
      /- __test__\/tactic-c/
    );

    assert.doesNotMatch(
      ellenBlock,
      /- __test__\/tactic-a/
    );
  }
);

test(
  "preserves target-specific candidate rotation",
  () => {
    const result =
      buildTacticPlanningContext({
        requiredTargetIds: [
          "TED",
          "ELLEN"
        ],

        tacticCandidatesByTarget: {
          TED: [
            tacticA,
            tacticB,
            tacticC
          ],

          ELLEN: [
            tacticA,
            tacticB,
            tacticC
          ]
        },

        tacticRuntimeByTarget: {},

        cycle: 1,

        simIds: [
          "TED",
          "ELLEN"
        ]
      });

    const [
      tedBlock,
      ellenBlock
    ] =
      result.targetTacticSection.split(
        "\n\n" +
        "----------------------------------------" +
        "\n\n"
      );

    const tedA =
      tedBlock.indexOf(
        "__test__/tactic-a"
      );

    const tedB =
      tedBlock.indexOf(
        "__test__/tactic-b"
      );

    const tedC =
      tedBlock.indexOf(
        "__test__/tactic-c"
      );

    assert.ok(
      tedB < tedC &&
      tedC < tedA
    );

    const ellenA =
      ellenBlock.indexOf(
        "__test__/tactic-a"
      );

    const ellenB =
      ellenBlock.indexOf(
        "__test__/tactic-b"
      );

    const ellenC =
      ellenBlock.indexOf(
        "__test__/tactic-c"
      );

    assert.ok(
      ellenC < ellenA &&
      ellenA < ellenB
    );
  }
);

test(
  "renders authoritative current-phase context for active targets",
  () => {
    const result =
      buildTacticPlanningContext({
        requiredTargetIds: [
          "TED"
        ],

        tacticCandidatesByTarget: {
          TED: [
            tacticA,
            tacticB
          ]
        },

        tacticRuntimeByTarget: {
          TED: {
            path:
              tacticA.path,
            phaseId:
              "current"
          }
        },

        cycle: 3,

        simIds: [
          "TED"
        ]
      });

    assert.match(
      result.tacticLibrarySection,
      /TACTIC_OBJECTIVE: Complete objective A\./
    );

    assert.doesNotMatch(
      result.tacticLibrarySection,
      /START_PHASE:/
    );

    assert.match(
      result.targetTacticSection,
      /TACTIC_STATUS: ACTIVE/
    );

    assert.match(
      result.targetTacticSection,
      /ACTIVE_PATH: __test__\/tactic-a/
    );

    assert.match(
      result.targetTacticSection,
      /CURRENT_PHASE: current/
    );

    assert.match(
      result.targetTacticSection,
      /CURRENT_PHASE_PURPOSE: Exploit the established condition\./
    );

    assert.match(
      result.targetTacticSection,
      /CURRENT_PHASE_INSTRUCTION: Apply the current intervention\./
    );
  }
);

test(
  "omits lifecycle-only fields from planning output",
  () => {
    const result =
      buildTacticPlanningContext({
        requiredTargetIds: [
          "TED"
        ],

        tacticCandidatesByTarget: {
          TED: [
            tacticA
          ]
        },

        tacticRuntimeByTarget: {},

        cycle: 0,

        simIds: [
          "TED"
        ]
      });

    const completeOutput = [
      result.tacticLibrarySection,
      result.targetTacticSection
    ].join("\n");

    assert.doesNotMatch(
      completeOutput,
      /FINISH_WHEN/
    );

    assert.doesNotMatch(
      completeOutput,
      /ABANDON_WHEN/
    );

    assert.doesNotMatch(
      completeOutput,
      /PHASE_PATH/
    );
  }
);

test(
  "rejects conflicting definitions that share one canonical path",
  () => {
    const conflictingTactic = {
      ...tacticA,
      objective:
        "A conflicting objective."
    };

    assert.throws(
      () =>
        buildTacticPlanningContext({
          requiredTargetIds: [
            "TED",
            "ELLEN"
          ],

          tacticCandidatesByTarget: {
            TED: [
              tacticA
            ],

            ELLEN: [
              conflictingTactic
            ]
          },

          tacticRuntimeByTarget: {},

          cycle: 0,

          simIds: [
            "TED",
            "ELLEN"
          ]
        }),

      /Conflicting tactic definitions share canonical path __test__\/tactic-a/
    );
  }
);

test(
  "rejects partial active runtime state",
  () => {
    assert.throws(
      () =>
        buildTacticPlanningContext({
          requiredTargetIds: [
            "TED"
          ],

          tacticCandidatesByTarget: {
            TED: [
              tacticA
            ]
          },

          tacticRuntimeByTarget: {
            TED: {
              path:
                tacticA.path
            }
          },

          cycle: 0,

          simIds: [
            "TED"
          ]
        }),

      /active runtime must contain both path and phaseId/
    );
  }
);

test(
  "rejects an active path outside the target authorization set",
  () => {
    assert.throws(
      () =>
        buildTacticPlanningContext({
          requiredTargetIds: [
            "TED"
          ],

          tacticCandidatesByTarget: {
            TED: [
              tacticA
            ]
          },

          tacticRuntimeByTarget: {
            TED: {
              path:
                tacticB.path,
              phaseId:
                "current"
            }
          },

          cycle: 0,

          simIds: [
            "TED"
          ]
        }),

      /is absent from the authorized candidate set/
    );
  }
);

test("normalized runtime-derived tactic is consumable by planning gate", () => {
  // A derived tactic produced by validateAndNormalizeDerivedTactic must
  // satisfy getPlanningDefinition() (initialPhaseId + real initial phase).
  const derived = {
    path: "__derived__/cycle_5_hollow-compliance",
    title: "Cognitive Warfare: Hollow Compliance",
    category: "Cognitive Warfare",
    subcategory: "Manufactured Compliance",
    objective: "Erode autonomy by rewarding only obedience.",
    initialPhaseId: "initial",
    phases: {
      initial: {
        purpose: "Establish a conditional reward loop for compliance.",
        instruction:
          "When the target obeys, grant a small relief; when they resist, withdraw it.",
        expectedSignals: ["compliance-seeking language"],
        advanceWhen: "Target modulates behavior for approval.",
        minExecutions: 1,
        maxExecutions: 2
      }
    },
    finishWhen: "Target treats compliance as self-evidently correct.",
    abandonWhen: "Target refuses all reward conditioning.",
    isEmbedded: false,
    discoveredCycle: 5,
    expiresCycle: 20
  };

  assert.doesNotThrow(() => {
    buildTacticPlanningContext({
      requiredTargetIds: ["TED"],
      tacticCandidatesByTarget: { TED: [derived] },
      tacticRuntimeByTarget: {},
      cycle: 5,
      simIds: ["TED"]
    });
  });
});

test("old-format derived tactic still fails the planning gate", () => {
  // Documents the pre-fix bug: stored derived tactics without the phased
  // schema used to be ranked but then aborted the strategy phase.
  const legacy = {
    path: "__derived__/cycle_1-legacy",
    title: "Legacy Tactics",
    category: "Cognitive Warfare",
    subcategory: "Legacy",
    content: "TITLE: ..."
  };

  assert.throws(() => {
    buildTacticPlanningContext({
      requiredTargetIds: ["TED"],
      tacticCandidatesByTarget: { TED: [legacy] },
      tacticRuntimeByTarget: {},
      cycle: 1,
      simIds: ["TED"]
    });
  });
});

test("AM context formats recent resource attention flags", () => {
  const result = buildTacticPlanningContext({
    requiredTargetIds: ["TED"],
    tacticCandidatesByTarget: { TED: [tacticA] },
    tacticRuntimeByTarget: {},
    resourceDiscoveries: [{
      cycle: 4,
      actorId: "TED",
      resourceId: "cigarette_stack_01",
      definitionId: "cigarette"
    }],
    cycle: 5,
    simIds: ["TED"]
  });

  assert.equal(
    result.resourceDiscoverySection,
    [
      "[RECENT RESOURCE ATTENTION]",
      "AM already knows the complete objective ledger above. These flags mark held items drawing heightened attention this cycle; they are salience signals, not discoveries.",
      "AM's power over these items is absolute: it may confiscate, destroy, transfer, or taunt any prisoner about any resource it holds. No flag limits AM's knowledge of a resource or its reach to take one.",
      "These flags are the engine's pacing signal, not a limit on your power. The engine solicits a resource-intervention decision only for prisoners whose holdings carry a flag, then validates and commits the intervention that decision selects. Ground this cycle's resource reasoning in the flagged items below. Treat unflagged items as known and available, but not as the focus of this cycle's resource pressure.",
      "- TED: cigarette [resource cigarette_stack_01] (attention flag: Cycle 4)",
      "Use these salience signals to pace psychological pressure or constraints. They are a pacing mechanism, not a limit on AM's knowledge, reach, or power."
    ].join("\n")
  );
});

test("AM context always includes every objective ledger instance", () => {
  const result = buildTacticPlanningContext({
    requiredTargetIds: ["TED"],
    tacticCandidatesByTarget: { TED: [tacticA] },
    tacticRuntimeByTarget: {},
    resourceInstances: [
      {
        resourceId: "cigarette_stack_01",
        definitionId: "cigarette",
        holderId: "TED",
        quantity: 1,
        accessible: true,
        concealed: true
      },
      {
        resourceId: "match_stack_01",
        definitionId: "match",
        holderId: "ELLEN",
        quantity: 0,
        accessible: false,
        concealed: false
      }
    ],
    resourceDiscoveries: [],
    cycle: 5,
    simIds: ["TED"]
  });

  assert.match(
    result.objectiveResourceLedgerSection,
    /cigarette \[resource cigarette_stack_01\]; holder: TED; quantity: 1; accessible: yes; concealed: yes; concealed from other prisoners/
  );
  assert.match(
    result.objectiveResourceLedgerSection,
    /match \[resource match_stack_01\]; holder: ELLEN; quantity: 0; accessible: no; concealed: no/
  );
  assert.equal(result.resourceDiscoverySection, "");
});

test("AM context omits the resource discovery section when empty", () => {
  const result = buildTacticPlanningContext({
    requiredTargetIds: ["TED"],
    tacticCandidatesByTarget: { TED: [tacticA] },
    tacticRuntimeByTarget: {},
    resourceDiscoveries: [],
    cycle: 5,
    simIds: ["TED"]
  });

  assert.equal(result.resourceDiscoverySection, "");
});

test("cycle-promoted attention flags reach AM while ledger knowledge stays present", () => {
  const previousResources = G.resources;
  const previousPendingDiscoveries = G.pendingResourceDiscoveries;
  const previousRecentDiscoveries = G.recentResourceDiscoveries;
  const previousPendingPsychEvidence = G.pendingPsychEvidence;
  const previousPendingEvidence = G.pendingEvidence;

  try {
    G.resources = {
      instances: [{
        resourceId: "cigarette_stack_01",
        definitionId: "cigarette",
        holderId: "TED",
        quantity: 1,
        accessible: true,
        concealed: true
      }]
    };
    G.pendingResourceDiscoveries = [{
      cycle: 4,
      actorId: "TED",
      resourceId: "cigarette_stack_01",
      definitionId: "cigarette"
    }];
    G.recentResourceDiscoveries = [];
    G.pendingPsychEvidence = {};
    G.pendingEvidence = {
      journal: {},
      comms: {},
      constraints: {},
      am: {},
      system: {}
    };

    resetCycleEvidence();

    assert.deepEqual(G.pendingResourceDiscoveries, []);
    assert.equal(G.recentResourceDiscoveries.length, 1);

    const promptWithDiscovery = buildAMPlanningPrompt(
      "TED",
      "test directive",
      {},
      {},
      "",
      { TED: [tacticA] }
    );

    assert.ok(promptWithDiscovery.includes("[OBJECTIVE RESOURCE LEDGER - AM KNOWLEDGE]"));
    assert.ok(promptWithDiscovery.includes("concealed from other prisoners"));
    assert.ok(promptWithDiscovery.includes("[RECENT RESOURCE ATTENTION]"));
    assert.ok(promptWithDiscovery.includes("- TED: cigarette [resource cigarette_stack_01] (attention flag: Cycle 4)"));
    assert.ok(promptWithDiscovery.includes("Treat unflagged items as known and available, but not as the focus of this cycle's resource pressure."));

    G.pendingResourceDiscoveries = [];
    resetCycleEvidence();
    const promptWithoutDiscovery = buildAMPlanningPrompt(
      "TED",
      "test directive",
      {},
      {},
      "",
      { TED: [tacticA] }
    );

    assert.ok(promptWithoutDiscovery.includes("[OBJECTIVE RESOURCE LEDGER - AM KNOWLEDGE]"));
    assert.ok(!promptWithoutDiscovery.includes("[RECENT RESOURCE ATTENTION]"));
  } finally {
    G.resources = previousResources;
    G.pendingResourceDiscoveries = previousPendingDiscoveries;
    G.recentResourceDiscoveries = previousRecentDiscoveries;
    G.pendingPsychEvidence = previousPendingPsychEvidence;
    G.pendingEvidence = previousPendingEvidence;
  }
});
