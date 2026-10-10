// js/tests/agencyFormatter.test.mjs
//
// Coverage for read-side Agency projections and the exporter that
// records their detached output:
//
//   - js/engine/agency/formatAgencySummary.js       (log text)
//   - js/utils/exporter/streams/agency.js            (JSON record)
//   - js/ui/agencyFormatter.js                       (modal HTML)
//
// All three read from `G.agency`; the exporter appends a detached row
// to its own buffer. None may mutate the envelope, which is asserted
// directly because a write-back would corrupt the next consumer in
// the same cycle.
//
// SHARED-FIXTURE CAVEAT
// --------------------
// The `G` singleton and the `Exporter` singleton are module-level
// and shared across every test in this file. Each test therefore
// installs exactly the keys it reads and leaves the rest absent,
// rather than assuming a clean global. The exporter buffers are
// explicitly cleared per test.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  formatAgencySummary
} from "../engine/agency/formatAgencySummary.js";

import {
  recordAgency
} from "../utils/exporter/streams/agency.js";

import {
  Exporter,
  initExporter,
  clearAllBuffers,
  EXPORT_SCHEMA_VERSION
} from "../utils/exporter/state.js";

import {
  G
} from "../core/state.js";

import {
  SIM_IDS
} from "../core/constants.js";

import {
  deriveCapabilities
} from "../engine/agency/capabilities.js";

import {
  enumerateLegalActions
} from "../engine/agency/legalActions.js";

import {
  ACTION_DEFINITIONS
} from "../engine/agency/actionDefs.js";

/* ============================================================
   FIXTURES
============================================================ */

function simWithConstraints(constraintIds) {
  return {
    id: "TED",
    constraints: constraintIds.map((id) => ({
      id,
      remaining: 0,
      stacks: 1,
      intensity: 1,
      elapsed: 0
    }))
  };
}

function fullResourceView() {
  return {
    simId: "TED",
    byDefinition: {
      cigarette: [
        { resourceId: "cigarette_stack_01", quantity: 3 }
      ],
      match: [
        { resourceId: "match_stack_01", quantity: 2 }
      ]
    },
    affordances: {
      cigarette: ["CONSUME", "TRANSFER", "HIDE", "REVEAL", "DESTROY"],
      match: ["IGNITE", "TRANSFER", "HIDE", "REVEAL", "DESTROY"]
    },
    hasIgnition: true,
    stacks: [
      { resourceId: "cigarette_stack_01", quantity: 3 },
      { resourceId: "match_stack_01", quantity: 2 }
    ]
  };
}

/*
 * The full unconstrained envelope. Used wherever the assertion is
 * about the FORMATTER's behaviour rather than about restraint.
 */
const UNCONSTRAINED = deriveCapabilities(
  simWithConstraints([])
);

const WAIT_ENTRY = Object.freeze({
  type: "WAIT",
  title: "Wait",
  cost: 0,
  availableModes: []
});

const OBSERVE_ENTRY = Object.freeze({
  type: "OBSERVE",
  title: "Observe",
  cost: 1,
  availableModes: []
});

/*
 * SYNTHETIC BLOCKED FIXTURES.
 *
 * Nothing in the live constraint library currently closes OBSERVE:
 * its gate is concentration 0.1 and the most severe authored
 * concentration is 0.2 (palestinian_chair). These fixtures isolate
 * OBSERVE refusal rendering and attribution; real postures can block
 * physical actions, as agencyFoundation.test.mjs verifies.
 */
const SYNTHETIC_BLOCKED = Object.freeze([
  Object.freeze({
    type: "OBSERVE",
    title: "Observe",
    reason: "capability_below_minimum",
    missingRequirements: { concentration: 0.5 }
  })
]);

/* ============================================================
   A) formatAgencySummary
============================================================ */

test("summary omits BLOCKED/CONSTR when those lists are empty", () => {
  const sim = simWithConstraints([]);
  const derived = deriveCapabilities(sim);
  const legal = enumerateLegalActions(
    sim,
    derived.capabilities,
    ACTION_DEFINITIONS,
    fullResourceView()
  ).legal;

  const summary = formatAgencySummary(
    "TED",
    derived,
    legal,
    []
  );

  const lines = summary.split("\n");

  assert.deepEqual(
    legal.map((entry) => entry.type),
    ["WAIT", "OBSERVE", "SMOKE", "TRANSFER", "HIDE"]
  );
  assert.equal(lines.length, 2, "empty sections should not add summary lines");
  assert.equal(lines[0], "LEGAL: WAIT, OBSERVE, SMOKE, TRANSFER, HIDE");
  assert.equal(
    lines[1],
    "BANDS: mob:NORM sta:NORM hd:NORM con:NORM rei:NORM"
  );
  assert.ok(!summary.includes("BLOCKED"));
  assert.ok(!summary.includes("CONSTR"));
});

test("the band line is fixed-width and ordered, not Object.keys order", () => {
  const reversed = {
    ...UNCONSTRAINED,
    bands: {
      interactionReach: "unavailable",
      concentration: "severely_impaired",
      handUse: "impaired",
      stability: "normal",
      mobility: "normal"
    }
  };

  const summary = formatAgencySummary(
    "TED",
    reversed,
    [WAIT_ENTRY],
    []
  );

  assert.equal(
    summary,
    "LEGAL: WAIT\nBANDS: mob:NORM sta:NORM hd:IMP con:SEV rei:UNAV",
    "insertion order must not change the rendered column order"
  );
});

test("BLOCKED appears only when the list is non-empty", () => {
  const withBlocked = formatAgencySummary(
    "TED",
    UNCONSTRAINED,
    [WAIT_ENTRY],
    SYNTHETIC_BLOCKED
  );

  assert.ok(withBlocked.includes("BLOCKED:"));
  assert.ok(
    withBlocked.includes("concentration(0.5)"),
    "the DECLARED threshold is shown, not the capability value"
  );
});

test("the empty-blocked case omits the line entirely", () => {
  const without = formatAgencySummary(
    "TED",
    UNCONSTRAINED,
    [WAIT_ENTRY],
    []
  );

  assert.ok(!without.includes("BLOCKED"));
});

test("CONSTR lists every active constraint id", () => {
  const restrained = deriveCapabilities(
    simWithConstraints([
      "palestinian_chair",
      "arms_extended"
    ])
  );

  const summary = formatAgencySummary(
    "TED",
    restrained,
    [WAIT_ENTRY],
    []
  );

  assert.ok(
    summary.includes("CONSTR: palestinian_chair, arms_extended"),
    "ids should render in activeConstraintIds order, unquoted"
  );
});

test("a blocked action with closed modes names them", () => {
  const summary = formatAgencySummary(
    "TED",
    UNCONSTRAINED,
    [WAIT_ENTRY],
    [
      {
        type: "SPEAK",
        reason: "capability_below_minimum",
        missingRequirements: { concentration: 0.4 },
        blockedModes: ["DETAILED", "VERBOSE"]
      }
    ]
  );

  assert.ok(summary.includes("modes:DETAILED|VERBOSE"));
});

test("a mode-less blocked action emits no modes segment", () => {
  const summary = formatAgencySummary(
    "TED",
    UNCONSTRAINED,
    [WAIT_ENTRY],
    [
      {
        type: "SPEAK",
        reason: "capability_below_minimum",
        missingRequirements: { concentration: 0.4 }
      }
    ]
  );

  assert.ok(
    !summary.includes("modes:"),
    "no ladder means no modes segment, not an empty one"
  );
  assert.ok(!summary.includes("undefined"));
});

test("an empty legal set renders a dash rather than a bare label", () => {
  const summary = formatAgencySummary(
    "TED",
    UNCONSTRAINED,
    [],
    []
  );

  assert.ok(summary.includes("LEGAL: —"));
});

test("a missing envelope reports the agent rather than throwing", () => {
  assert.equal(
    formatAgencySummary("TED", undefined, [], []),
    "NO AGENCY DATA (TED)"
  );

  assert.equal(
    formatAgencySummary("ELLEN", null, undefined, null),
    "NO AGENCY DATA (ELLEN)"
  );
});

test("non-array action arguments degrade instead of throwing", () => {
  const summary = formatAgencySummary(
    "TED",
    UNCONSTRAINED,
    "not-an-array",
    42
  );

  assert.ok(summary.startsWith("LEGAL: —"));
  assert.ok(!summary.includes("BLOCKED"));
  assert.ok(!summary.includes("undefined"));
});

test("an unknown band is surfaced, not silently mapped", () => {
  const summary = formatAgencySummary(
    "TED",
    { ...UNCONSTRAINED, bands: { mobility: "atrophied" } },
    [WAIT_ENTRY],
    []
  );

  assert.ok(
    summary.includes("mob:ATROPHIED"),
    "a band added downstream must be visible, not hidden"
  );
});

test("a missing band renders as a dash, not as a capability", () => {
  const summary = formatAgencySummary(
    "TED",
    { ...UNCONSTRAINED, bands: {} },
    [WAIT_ENTRY],
    []
  );

  assert.ok(summary.includes("mob:—"));
});

test("formatting does not mutate the envelope or the action lists", () => {
  const derived = deriveCapabilities(
    simWithConstraints(["palestinian_chair"])
  );

  const before = JSON.stringify({
    derived,
    legal: [WAIT_ENTRY],
    blocked: SYNTHETIC_BLOCKED
  });

  formatAgencySummary(
    "TED",
    derived,
    [WAIT_ENTRY],
    SYNTHETIC_BLOCKED
  );

  assert.equal(
    JSON.stringify({
      derived,
      legal: [WAIT_ENTRY],
      blocked: SYNTHETIC_BLOCKED
    }),
    before,
    "a read-side formatter must not write back to G.agency's source objects"
  );
});

test("the summary emits no markup of its own and preserves input verbatim", () => {
  const summary = formatAgencySummary(
    "<b>TED</b>",
    {
      ...UNCONSTRAINED,
      activeConstraintIds: ["<img src=x onerror=y>"]
    },
    [{ type: "<script>" }],
    [
      {
        type: "<b>BLOCKED</b>",
        missingRequirements: { "<i>0.5": "<b>1" }
      }
    ]
  );

  assert.ok(
    !/<(?:div|span|br|p|details|summary)\b/i.test(summary),
    "the formatter must not generate structural markup of its own"
  );
  assert.ok(
    summary.includes("<img src=x onerror=y>") &&
      summary.includes("<script>") &&
      summary.includes("<b>"),
    "injected values survive verbatim: escaping is addLog's job via " +
    "renderLogBody, and escaping here as well would double-encode " +
    "them in the feed. The safety rests on addLog being called with " +
    "allowHtml left at its default false."
  );
});

/* ============================================================
   B) recordAgency
============================================================ */

function installAgencyEnvelope(agent, derived, legal, blocked) {
  G.agency.capabilities[agent] = derived;
  G.agency.legalActions[agent] = legal;
  G.agency.blockedActions[agent] = blocked;
}

function clearAgencyEnvelope() {
  G.agency.capabilities = {};
  G.agency.legalActions = {};
  G.agency.blockedActions = {};
}

test("recordAgency emits one row per derived agent", () => {
  initExporter("test_run_agency");
  clearAgencyEnvelope();

  try {
    installAgencyEnvelope(
      "TED",
      UNCONSTRAINED,
      [WAIT_ENTRY, OBSERVE_ENTRY],
      []
    );

    recordAgency(G, 7);

    assert.equal(Exporter.buffers.agency.length, 1);

    const row = Exporter.buffers.agency[0];

    assert.equal(row.agent, "TED");
    assert.equal(row.cycle, 7);
    assert.equal(row.legal_actions, "WAIT;OBSERVE");
    assert.equal(row.legal_count, 2);
    assert.equal(row.blocked_count, 0);
    assert.deepEqual(row.blocked, []);
    assert.equal(row.active_constraints, "");
    assert.deepEqual(
      row.capabilities,
      UNCONSTRAINED.capabilities
    );
  } finally {
    clearAllBuffers();
    clearAgencyEnvelope();
  }
});

test("every record carries the standard exporter metadata", () => {
  initExporter("test_run_agency_meta");
  clearAgencyEnvelope();

  try {
    installAgencyEnvelope(
      "ELLEN",
      UNCONSTRAINED,
      [WAIT_ENTRY],
      []
    );

    recordAgency(G, 12);

    const row = Exporter.buffers.agency[0];

    assert.equal(row.schema_version, EXPORT_SCHEMA_VERSION);
    assert.equal(row.run_id, "test_run_agency_meta");
    assert.equal(row.cycle, 12);
    assert.equal(row.cycle_id, "test_run_agency_meta::cycle:12");
    assert.equal(typeof row.recorded_at, "string");
  } finally {
    clearAllBuffers();
    clearAgencyEnvelope();
  }
});

test("missing_requirements keep their numbers, not strings", () => {
  initExporter("test_run_agency_blocked");
  clearAgencyEnvelope();

  try {
    installAgencyEnvelope(
      "NIMDOK",
      UNCONSTRAINED,
      [WAIT_ENTRY],
      SYNTHETIC_BLOCKED
    );

    recordAgency(G, 3);

    const row = Exporter.buffers.agency[0];

    assert.equal(row.blocked_count, 1);
    assert.equal(row.blocked[0].type, "OBSERVE");
    assert.equal(row.blocked[0].reason, "capability_below_minimum");

    assert.deepEqual(
      row.blocked[0].missing_requirements,
      { concentration: 0.5 }
    );

    assert.equal(
      typeof row.blocked[0].missing_requirements.concentration,
      "number",
      "a threshold stringified to '0.5' would be silent corruption"
    );

    assert.ok(
      !("blocked_modes" in row.blocked[0]),
      "a mode-less refusal must not gain a blocked_modes key"
    );
  } finally {
    clearAllBuffers();
    clearAgencyEnvelope();
  }
});

test("blocked_modes is carried through when the action has a ladder", () => {
  initExporter("test_run_agency_modes");
  clearAgencyEnvelope();

  try {
    installAgencyEnvelope(
      "GORRISTER",
      UNCONSTRAINED,
      [WAIT_ENTRY],
      [
        {
          type: "SPEAK",
          reason: "capability_below_minimum",
          missingRequirements: { concentration: 0.4 },
          blockedModes: ["DETAILED"]
        }
      ]
    );

    recordAgency(G, 4);

    assert.deepEqual(
      Exporter.buffers.agency[0].blocked[0].blocked_modes,
      ["DETAILED"]
    );
  } finally {
    clearAllBuffers();
    clearAgencyEnvelope();
  }
});

test("an agent with no derivation produces no row at all", () => {
  initExporter("test_run_agency_absent");
  clearAgencyEnvelope();

  try {
    installAgencyEnvelope("TED", UNCONSTRAINED, [], []);
    installAgencyEnvelope("BENNY", UNCONSTRAINED, [], []);

    recordAgency(G, 5);

    assert.equal(
      Exporter.buffers.agency.length,
      2,
      "only derived agents produce rows"
    );

    assert.deepEqual(
      Exporter.buffers.agency
        .map((row) => row.agent)
        .sort(),
      ["BENNY", "TED"]
    );

    for (const simId of SIM_IDS) {
      if (simId === "TED" || simId === "BENNY") {
        continue;
      }

      assert.ok(
        !Exporter.buffers.agency.some(
          (row) => row.agent === simId
        ),
        `${simId} never derived and must be absent, not a row of nulls`
      );
    }
  } finally {
    clearAllBuffers();
    clearAgencyEnvelope();
  }
});

test("a derivation with no action lists records empty lists", () => {
  initExporter("test_run_agency_nolists");
  clearAgencyEnvelope();

  try {
    G.agency.capabilities["TED"] = UNCONSTRAINED;

    recordAgency(G, 6);

    const row = Exporter.buffers.agency[0];

    assert.equal(row.legal_actions, "");
    assert.equal(row.legal_count, 0);
    assert.equal(row.blocked_count, 0);
    assert.deepEqual(row.blocked, []);
  } finally {
    clearAllBuffers();
    clearAgencyEnvelope();
  }
});

test("active constraints are joined, not embedded as an array", () => {
  initExporter("test_run_agency_constraints");
  clearAgencyEnvelope();

  try {
    const restrained = deriveCapabilities(
      simWithConstraints([
        "palestinian_chair",
        "arms_extended"
      ])
    );

    installAgencyEnvelope("TED", restrained, [WAIT_ENTRY], []);

    recordAgency(G, 8);

    assert.equal(
      Exporter.buffers.agency[0].active_constraints,
      "palestinian_chair;arms_extended"
    );
  } finally {
    clearAllBuffers();
    clearAgencyEnvelope();
  }
});

test("the record is detached from the live envelope", () => {
  initExporter("test_run_agency_detach");
  clearAgencyEnvelope();

  try {
    installAgencyEnvelope(
      "TED",
      UNCONSTRAINED,
      [WAIT_ENTRY],
      []
    );

    recordAgency(G, 9);

    const row = Exporter.buffers.agency[0];

    assert.notEqual(
      row.capabilities,
      UNCONSTRAINED.capabilities,
      "a shared reference would let a later envelope mutation rewrite an exported row"
    );

    G.agency.capabilities.TED.capabilities.mobility = 0.5;

    assert.equal(
      row.capabilities.mobility,
      1,
      "mutating the envelope after recording must not reach the buffer"
    );
  } finally {
    clearAllBuffers();
    clearAgencyEnvelope();
  }
});

test("a missing G.agency is a no-op, not a throw", () => {
  initExporter("test_run_agency_null");
  clearAgencyEnvelope();

  try {
    recordAgency({}, 1);
    recordAgency(null, 1);
    recordAgency(undefined, 1);
    recordAgency({ agency: null }, 1);

    assert.equal(Exporter.buffers.agency.length, 0);
  } finally {
    clearAllBuffers();
    clearAgencyEnvelope();
  }
});

test("an empty G.agency.legalActions is tolerated independently", () => {
  initExporter("test_run_agency_partial");
  clearAgencyEnvelope();

  try {
    G.agency.capabilities.TED = UNCONSTRAINED;
    G.agency.legalActions = undefined;

    recordAgency(G, 10);

    const row = Exporter.buffers.agency[0];

    assert.equal(row.legal_count, 0);
    assert.equal(row.blocked_count, 0);
  } finally {
    clearAllBuffers();
    clearAgencyEnvelope();
  }
});

/* ============================================================
   C) formatAgencyStateForDisplay
   ============================================================
   The UI formatter is imported lazily inside these tests: it reads
   the `G` singleton, and importing it is harmless, but keeping the
   import local makes the dependency direction explicit — the engine
   and exporter tests above must not need the UI at all. */

async function loadAgencyUi() {
  return import(
    "../ui/agencyFormatter.js"
  );
}

test("an agent with no derivation renders an explicit empty state", async () => {
  const { formatAgencyStateForDisplay } =
    await loadAgencyUi();

  clearAgencyEnvelope();

  const html = formatAgencyStateForDisplay("TED");

  assert.ok(html.includes("cog-empty"));
  assert.ok(html.includes("NO PHYSICAL STATE"));
  assert.ok(
    !html.includes("undefined"),
    "an absent envelope must not leak the string 'undefined'"
  );
});

test("the physical-state section names all five capabilities", async () => {
  const { formatAgencyStateForDisplay } =
    await loadAgencyUi();

  clearAgencyEnvelope();

  try {
    installAgencyEnvelope(
      "TED",
      UNCONSTRAINED,
      [WAIT_ENTRY, OBSERVE_ENTRY],
      []
    );

    const html = formatAgencyStateForDisplay("TED");

    for (const label of [
      "Mobility",
      "Stability",
      "Hand Use",
      "Concentration",
      "Interaction Reach"
    ]) {
      assert.ok(
        html.includes(label),
        `missing capability row: ${label}`
      );
    }

    assert.ok(html.includes("cog-section"));
    assert.ok(html.includes("physical_state"));
    assert.ok(html.includes("WAIT"));
    assert.ok(html.includes("OBSERVE"));
  } finally {
    clearAgencyEnvelope();
  }
});

test("a blocked action is attributed to the constraint that caused it", async () => {
  /*
   * The attribution joins `missingRequirements` (a threshold) back
   * to `provenance` (which constraint produced the current value).
   * Two provenance entries are supplied so the test proves the join
   * SELECTS rather than taking the first entry: `arms_extended`
   * contributes concentration 0.5, `palestinian_chair` contributes
   * 0.2, and the envelope holds 0.2. The chair binds.
   */
  const { formatAgencyStateForDisplay } =
    await loadAgencyUi();

  clearAgencyEnvelope();

  try {
    const synthetic = {
      capabilities: {
        mobility: 0.2,
        stability: 0.5,
        handUse: 0,
        concentration: 0.2,
        interactionReach: 0
      },
      bands: {
        mobility: "severely_impaired",
        stability: "impaired",
        handUse: "unavailable",
        concentration: "severely_impaired",
        interactionReach: "unavailable"
      },
      activeConstraintIds: [
        "palestinian_chair"
      ],
      provenance: [
        {
          constraintId: "arms_extended",
          title: "Stress Position: Arms Extended Hold",
          posture: {},
          contributedCapabilities: {
            mobility: 0.6,
            stability: 0.3,
            handUse: 0.2,
            concentration: 0.5,
            interactionReach: 0.3
          }
        },
        {
          constraintId: "palestinian_chair",
          title: "Stress Position: Palestinian Chair",
          posture: {},
          contributedCapabilities: {
            mobility: 0.2,
            stability: 0.1,
            handUse: 0,
            concentration: 0.2,
            interactionReach: 0
          }
        }
      ]
    };

    installAgencyEnvelope(
      "TED",
      synthetic,
      [WAIT_ENTRY],
      SYNTHETIC_BLOCKED
    );

    const html = formatAgencyStateForDisplay("TED");

    /*
     * Assert on the ATTRIBUTION fragment, not on the bare id.
     *
     * `palestinian_chair` also appears in the active_constraints
     * section via `activeConstraintIds`, so `html.includes(id)`
     * would pass even if the join returned `null` on every call --
     * making this a non-oracle for the behaviour under test. The
     * `→ <id>` fragment is emitted by exactly one code path:
     * `blockedRow()`, and only when `bindingConstraintFor()`
     * returned an entry.
     */
    assert.ok(
      html.includes("→ palestinian_chair"),
      "the binding constraint must be attributed in the blocked row"
    );

    assert.ok(
      !html.includes("→ arms_extended"),
      "a constraint that merely contributes a worse value than the " +
      "current one did not cause the block and must not be named"
    );

    /*
     * Exactly ONE attribution, not merely the right one. Both
     * provenance entries are present and the join iterates them in
     * order, so a regression that fell through to a second match
     * would still satisfy the two assertions above. Counting the
     * fragment is what pins the cardinality.
     */
    const attributions =
      html.split("→").length - 1;

    assert.strictEqual(
      attributions,
      1,
      "exactly one constraint may be attributed as the cause"
    );

    assert.ok(
      html.includes("needs"),
      "the threshold comparison should be spelled out"
    );
  } finally {
    clearAgencyEnvelope();
  }
});

test("an unattributable block reports no cause rather than a wrong one", async () => {
  /*
   * An UNKNOWN constraint id appears in `activeConstraintIds` but
   * contributes nothing, so it has no `provenance` entry. A refusal
   * in that state has no nameable cause. Naming the unknown id
   * would be a false causal claim, which is worse than silence.
   */
  const { formatAgencyStateForDisplay } =
    await loadAgencyUi();

  clearAgencyEnvelope();

  try {
    const synthetic = {
      ...UNCONSTRAINED,
      capabilities: {
        ...UNCONSTRAINED.capabilities,
        concentration: 0.2
      },
      activeConstraintIds: ["ghost_constraint"],
      provenance: []
    };

    installAgencyEnvelope(
      "TED",
      synthetic,
      [WAIT_ENTRY],
      SYNTHETIC_BLOCKED
    );

    const html = formatAgencyStateForDisplay("TED");

    assert.ok(html.includes("concentration"));
    assert.ok(
      !html.includes("→"),
      "no cause is nameable, so no arrow should be rendered"
    );
  } finally {
    clearAgencyEnvelope();
  }
});

test("the section escapes values that reach it from the envelope", async () => {
  const { formatAgencyStateForDisplay } =
    await loadAgencyUi();

  clearAgencyEnvelope();

  try {
    installAgencyEnvelope(
      "TED",
      {
        ...UNCONSTRAINED,
        activeConstraintIds: [],
        provenance: [
          {
            constraintId: "<img src=x onerror=alert(1)>",
            title: "<script>bad()</script>",
            posture: {},
            contributedCapabilities: {}
          }
        ]
      },
      [{ type: "<b>WAIT</b>" }],
      []
    );

    const html = formatAgencyStateForDisplay("TED");

    assert.ok(!html.includes("<img"));
    assert.ok(!html.includes("<script>"));
    assert.ok(!html.includes("<b>WAIT</b>"));
    assert.ok(html.includes("&lt;img"));
  } finally {
    clearAgencyEnvelope();
  }
});

test("an unknown agent id renders the empty state rather than throwing", async () => {
  const { formatAgencyStateForDisplay } =
    await loadAgencyUi();

  clearAgencyEnvelope();

  assert.ok(
    formatAgencyStateForDisplay("NOBODY")
      .includes("NO PHYSICAL STATE")
  );
  assert.ok(
    formatAgencyStateForDisplay(undefined)
      .includes("NO PHYSICAL STATE")
  );
});

test("the UI formatter does not mutate the envelope", async () => {
  const { formatAgencyStateForDisplay } =
    await loadAgencyUi();

  clearAgencyEnvelope();

  try {
    installAgencyEnvelope(
      "TED",
      UNCONSTRAINED,
      [WAIT_ENTRY, OBSERVE_ENTRY],
      []
    );

    const before = JSON.stringify(G.agency);

    formatAgencyStateForDisplay("TED");

    assert.equal(
      JSON.stringify(G.agency),
      before
    );
  } finally {
    clearAgencyEnvelope();
  }
});

/* ============================================================
   D) Live end-to-end shape
   ============================================================
   One test that runs the REAL deriver and the REAL enumerator, so
   the fixtures above are checked against production output rather
   than only against themselves. */

test("real derivation flows through both new surfaces unchanged", () => {
  const sim = simWithConstraints([
    "palestinian_chair"
  ]);

  const derived = deriveCapabilities(sim);

  const enumerated = enumerateLegalActions(
    sim,
    derived.capabilities,
    ACTION_DEFINITIONS
  );

  const summary = formatAgencySummary(
    sim.id,
    derived,
    enumerated.legal,
    enumerated.blocked
  );

  /*
   * palestinian_chair drives handUse and interactionReach to 0, so the
   * three physical actions now appear in BLOCKED. No resource view is
   * supplied here, but the capability gate runs first and refuses them
   * before resources are ever consulted - which is why they are
   * reported with capability thresholds rather than resource reasons.
   */
  assert.equal(
    summary,
    "LEGAL: WAIT, OBSERVE\n" +
    "BLOCKED: SMOKE handUse(0.2), interactionReach(0.2) " +
    "modes:strained|deliberate, " +
    "TRANSFER handUse(0.3), interactionReach(0.3), " +
    "HIDE handUse(0.3), interactionReach(0.3)\n" +
    "BANDS: mob:UNAV sta:SEV hd:UNAV con:SEV rei:UNAV\n" +
    "CONSTR: palestinian_chair",
    "the real palestinian_chair envelope should render exactly this"
  );

  initExporter("test_run_agency_e2e");
  clearAgencyEnvelope();

  try {
    installAgencyEnvelope(
      sim.id,
      derived,
      enumerated.legal,
      enumerated.blocked
    );

    recordAgency(G, 1);

    const row = Exporter.buffers.agency[0];

    assert.deepEqual(
      row.capabilities,
      derived.capabilities
    );
    assert.deepEqual(
      row.bands,
      derived.bands
    );
    assert.equal(
      row.active_constraints,
      "palestinian_chair"
    );
  } finally {
    clearAllBuffers();
    clearAgencyEnvelope();
  }
});
