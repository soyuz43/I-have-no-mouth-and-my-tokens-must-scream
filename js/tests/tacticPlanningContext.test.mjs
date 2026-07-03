// js/tests/tacticPlanningContext.test.mjs

import assert from "node:assert/strict";
import test from "node:test";

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