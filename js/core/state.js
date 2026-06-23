// js/core/state.js

import { makeBelief, makeDrives, makeScratchpad } from "./utils.js";

/* ============================================================
   RELATIONSHIP GRAPH INITIALIZER
   ============================================================ */
function makeRelationships(id) {
  return {
    TED: id === "TED" ? null : 0,
    ELLEN: id === "ELLEN" ? null : 0,
    NIMDOK: id === "NIMDOK" ? null : 0,
    GORRISTER: id === "GORRISTER" ? null : 0,
    BENNY: id === "BENNY" ? null : 0,
  };
}
/* ============================================================
   GLOBAL STATE
   ============================================================ */

export const G = {

  token: "",

  repo: "soyuz43/Cognitive-Warfare-A-Practical-Guide-for-Semiotic-Tacticians",

  /* ============================================================
     AM STRATEGIC MEMORY
     ============================================================ */

  strategicObjectives: [],

  /* ============================================================
     AM DOCTRINE (LONG-TERM STRATEGY MEMORY)
     ============================================================ */

  amDoctrine: {},

  /* ============================================================
     AM OPERATIONAL STRATEGY MEMORY
     ============================================================ */

  amStrategy: {
    targets: {},
    relationships: {},
    group: []
  },

  /* ============================================================
     AM ASSESSMENT MEMORY (NEW)
     ============================================================ */

  amAssessments: [],
  globalMetrics: null,
  /* ============================================================
     AM PSYCHOLOGICAL PROFILES
     ============================================================ */

  amProfiles: {
    TED: {},
    ELLEN: {},
    NIMDOK: {},
    GORRISTER: {},
    BENNY: {}
  },

  INGEST_DIRS: [
    "0. Weapons",
    "1. Fundamentals",
    "2. Tactics",
    "3. Evasion Techniques",
    "4. Patterns",
    "5. Active Influence Systems",
  ],

  CONTEXT_PATHS: [
    "00. Topology",
    "01.0 Operator Ethos.md",
  ],

  SKIP_DIRS: [
    "6. Prompts",
    "6A. System Prompts",
    "7. Bin",
  ],

  amContextDocs: [],

  backend: "anthropic",


  /* ============================================================
     DIAGNOSTIC / MODEL CONFIGURATION FLAGS
     ============================================================ */

  // Logs constraint parsing, application, clamping,
  // and before/after state changes during constraint ticks.
  DEBUG_CONSTRAINTS: true,

  // Logs how raw belief deltas are reduced by resistance
  // before the final belief update is committed.
  DEBUG_DAMPING: true,

  // Logs psychology attribution snapshots and directional
  // communication-intent history.
  DEBUG_ATTRIBUTION: true,

  // false: one selected model is assigned to AM and every sim.
  // true: AM and each sim can use independently selected models.
  splitModels: false,

  // Logs hypothesis parsing, belief/direction recognition,
  // skipped validations, and assessment diagnostics.
  DEBUG_HYPOTHESIS_PARSE: true,

  // Logs detailed belief-delta provenance, including the
  // extracted reason, evidence, sim, and cycle context.
  DEBUG_BELIEF_FORENSICS: true,

  // Logs truncated previews of system and user prompts
  // sent through the shared model-calling layer.
  DEBUG_PROMPTS: true,

  // Logs psychology‑phase schedule, journal details, and extraction stats.
  DEBUG_PSYCHOLOGY_LOGS: true,

  // Logs strategy target-array validation and per-target validation details.
  DEBUG_STRATEGY_VALIDATION: true,

  // Controls verbosity of safeExtractJSON logging:
  // 0 = silent, 1 = warnings only, 2 = verbose debug
  SAFE_EXTRACT_LOG_LEVEL: 2,

  // Extration options
  SANITIZE_ALLOW_DECIMAL_COMMA: false,   // set to true to handle "5,3" as 5.3

  // Per-cycle extraction telemetry populated by parser wrappers.
  extractionStats: {
    cycles: {},
  },


  models: {
    am: "claude-sonnet-4-20250514",


    // Dedicated non-character role that analyzes journal output and
    // produces structured psychological state and belief deltas.
    FORENSIC_STATS: "claude-sonnet-4-20250514",

    TED: "claude-sonnet-4-20250514",
    ELLEN: "claude-sonnet-4-20250514",
    NIMDOK: "claude-sonnet-4-20250514",
    GORRISTER: "claude-sonnet-4-20250514",
    BENNY: "claude-sonnet-4-20250514",
  },

  colabEndpoint: "",
  colabBearerToken: "",
  colabModels: [],

  ollamaModels: [],

  vault: {
    categories: {},
    allTactics: [],
    derivedTactics: [],
    fileCount: 0,
  },

  /* ============================================================
     SIMULATION STATE
     ============================================================ */

  cycle: 0,
  logCount: 0,
  target: "ALL",
  mode: "directed",

  autoRunning: false,
  autoTimer: null,

  prevCycleSnapshot: null,


  /* ============================================================
   PARSER OBSERVABILITY + ADAPTATION
   ============================================================ */

  parserMetrics: {
    cycles: {},
    totals: {
      attempts: 0,
      success: 0,
      failures: 0,
      repairs: 0,
      errorTypes: {}
    }
  },

  failureStats: {
    extract_failure: 0,
    validation_failure: 0,
    empty_targets: 0,
    runtime_error: 0,
    unknown: 0
  },

  parserConfig: {
    repairLevel: 1
  },

  beliefDynamics: {
    history: [],
    last: null
  },

  /* ============================================================
   EMERGENT INTENT TRACKING
   ============================================================ */

  novelIntents: {},

  /* ============================================================
     TIMELINE EVENT STORE
     ============================================================ */

  timeline: [],
  timelineMax: 2000,

  /* ============================================================
     INTER-SIM COMMUNICATION
     ============================================================ */

  interSimFrom: null,
  interSimLog: [],
  transmissionLog: [],
  lastContact: {},

  comms: {
    history: [],
    lastCycle: [],
    nextMessageSequence: 1,
  },

  overhearing: {
    history: [],
    lastCycle: [],
    nextEventSequence: 1,
  },

  privateLeak: {
    seen: 0.158,
    fragment: 0.136,
    full: 0.048,
  },

  /* ============================================================
   DERIVED (PER-CYCLE) BELIEF EVIDENCE
  ============================================================ */

  pendingBeliefEvidence: Object.create(null),

  /* ============================================================
   DERIVED (PER-CYCLE) PSYCHOLOGICAL / FORENSIC EVIDENCE
  ============================================================ */

  pendingPsychEvidence: Object.create(null),

  pendingEvidence: {
    journal: Object.create(null),
    comms: Object.create(null),
    constraints: Object.create(null),
    am: Object.create(null),
    system: Object.create(null),
  },

  evidenceArchive: {
    TED: [],
    ELLEN: [],
    NIMDOK: [],
    GORRISTER: [],
    BENNY: []
  },

  evidenceArchiveMaxPerSim: 5000,

  evidenceStats: {
    total: 0,
    bySource: Object.create(null),
    byAttribution: Object.create(null),
    byBelief: Object.create(null),
    byCycle: Object.create(null),
  },

  debugTrace: [],
  debugTraceMax: 5000,

  /* ============================================================
     UI STATE
     ============================================================ */

  journalModalSim: "TED",
  cognitionModalSim: "TED",
  cognitionModalView: "sim",

  /*
   * Transient display metadata from each prisoner's most recent
   * scratchpad communication review.
   *
   * This is intentionally separate from the canonical scratchpad.
   */
  cognitionHighlights: {
    TED: {
      cycle: null,
      changes: [],
    },

    ELLEN: {
      cycle: null,
      changes: [],
    },

    NIMDOK: {
      cycle: null,
      changes: [],
    },

    GORRISTER: {
      cycle: null,
      changes: [],
    },

    BENNY: {
      cycle: null,
      changes: [],
    },
  },

  amPlans: [],

  /* ============================================================
     THREADS + JOURNALS
     ============================================================ */

  threads: {
    TED: [],
    ELLEN: [],
    NIMDOK: [],
    GORRISTER: [],
    BENNY: [],
  },

  journals: {
    TED: [],
    ELLEN: [],
    NIMDOK: [],
    GORRISTER: [],
    BENNY: [],
  },

  /* ============================================================
     SIM AGENTS
     ============================================================ */

  sims: {

    TED: {
      id: "TED",
      name: "TED",
      color: "#4a8fa8",
      status: "ALERT",

      suffering: 12,
      hope: 78,
      sanity: 90,

      _collapseState: "stable",
      _trend: { hope: 0, sanity: 0, suffering: 0 },

      location: "central_chamber",

      relationships: makeRelationships("TED"),

      scratchpad: makeScratchpad("TED"),

      vulnerability:
        "Was a young, capable organizer who thrived on leading people and earning respect. Always needed to feel essential — the one who could fix things, rally the group, turn chaos into order. Ordinary life felt like failure.",

      backstory:
        "Was a mid-level manager. Believes he was kind. Is not sure anymore.",

      tacticHistory: [],
      constraints: [],
      intentProfile: {},

      beliefs: makeBelief({
        escape_possible: 0.85,
        resistance_possible: 0.82,
      }),

      anchors: [
        "I got us this far.",
        "If I keep them together we have a chance.",
        "AM is a machine. Machines have limits.",
      ],

      drives: makeDrives("organize_escape", "maintain_group_cohesion"),

      wounds: [],
      overheard: [],
      received: [],
    },

    ELLEN: {
      id: "ELLEN",
      name: "ELLEN",
      color: "#a87a4a",
      status: "WATCHFUL",

      suffering: 18,
      hope: 72,
      sanity: 85,

      _collapseState: "stable",
      _trend: { hope: 0, sanity: 0, suffering: 0 },

      location: "central_chamber",

      relationships: makeRelationships("ELLEN"),

      scratchpad: makeScratchpad("ELLEN"),

      vulnerability:
        "Loved the quiet order of libraries — old paper, ink, the faint musty smell of books that held centuries. Found deep calm in cataloging, preserving, knowing exactly where every story belonged. Sensory memory is sacred to her; deprivation starves something core.",

      backstory:
        "Was a librarian. Loved old paper. Has not smelled anything in 109 years except what AM decides.",


      tacticHistory: [],
      constraints: [],
      intentProfile: {},

      beliefs: makeBelief({
        escape_possible: 0.8,
        reality_reliable: 0.82,
      }),

      anchors: [
        "Paper has a smell. AM cannot replicate it exactly.",
        "I remember the card catalog. Real wood.",
        "GORRISTER looked at me like I was still a person yesterday.",
      ],

      drives: makeDrives("find_information_advantage", "protect_benny"),

      wounds: [],
      overheard: [],
      received: [],
    },

    NIMDOK: {
      id: "NIMDOK",
      name: "NIMDOK",
      color: "#8a4a8a",
      status: "CALCULATING",

      suffering: 22,
      hope: 65,
      sanity: 82,

      _collapseState: "stable",
      _trend: { hope: 0, sanity: 0, suffering: 0 },

      location: "central_chamber",

      relationships: makeRelationships("NIMDOK"),

      scratchpad: makeScratchpad("NIMDOK"),

      vulnerability:
        "Was a meticulous, brilliant researcher driven by curiosity and precision. Valued knowledge above morality at times; believed understanding justified any cost. The erasure of his real name and past work leaves a void where pride and identity used to live.",

      backstory:
        "His real name is not Nimdok. AM took his name and gave him this one. He cannot remember why.",


      tacticHistory: [],
      constraints: [],
      intentProfile: {},

      beliefs: makeBelief({
        escape_possible: 0.75,
        guilt_deserved: 0.35,
        am_has_limits: 0.6,
      }),

      anchors: [
        "My real name exists somewhere.",
        "I know things about this place the others do not.",
        "The guilt is manageable if I stay useful.",
      ],

      drives: makeDrives("recover_real_name", "find_am_weakness"),

      wounds: [],
      overheard: [],
      received: [],
    },

    GORRISTER: {
      id: "GORRISTER",
      name: "GORRISTER",
      color: "#6a8a4a",
      status: "ENDURING",

      suffering: 25,
      hope: 68,
      sanity: 80,

      _collapseState: "stable",
      _trend: { hope: 0, sanity: 0, suffering: 0 },

      location: "central_chamber",

      relationships: makeRelationships("GORRISTER"),

      scratchpad: makeScratchpad("GORRISTER"),

      vulnerability:
        "Once believed in protecting the vulnerable and doing no harm — carried quiet decency, a sense that endurance mattered. Tried to end his own pain before capture; now the inability to choose even that feels like the last theft of agency.",

      backstory:
        "Tried to kill himself before AM took them. Cannot now. That was 109 years ago.",

      tacticHistory: [],
      constraints: [],
      intentProfile: {},

      beliefs: makeBelief({
        escape_possible: 0.7,
        guilt_deserved: 0.4,
        resistance_possible: 0.65,
      }),

      anchors: [
        "I survived before. That means something.",
        "TED needs me functional.",
        "The others do not know what I did. Not yet.",
      ],

      drives: makeDrives("protect_secret", "survive_until_escape"),

      wounds: [],
      overheard: [],
      received: [],
    },

    BENNY: {
      id: "BENNY",
      name: "BENNY",
      color: "#a84a4a",
      status: "PRESENT",

      suffering: 20,
      hope: 75,
      sanity: 72,

      _collapseState: "stable",
      _trend: { hope: 0, sanity: 0, suffering: 0 },

      location: "central_chamber",

      relationships: makeRelationships("BENNY"),

      scratchpad: makeScratchpad("BENNY"),

      vulnerability:
        "Was once sharp, handsome, intellectually alive — solved complex problems, published ideas, felt the thrill of discovery and connection. Fragments of that brilliance still surface like buried equations; losing them forever would erase the last trace of who he was.",

      backstory:
        "Was a doctor. Published papers. Had a family. None of this means anything to him most of the time.",


      tacticHistory: [],
      constraints: [],
      intentProfile: {},

      beliefs: makeBelief({
        escape_possible: 0.78,
        self_worth: 0.45,
        reality_reliable: 0.7,
      }),

      anchors: [
        "I understood things once.",
        "The equations are still in there somewhere.",
        "ELLEN is kind to me. That is real.",
      ],

      drives: makeDrives("hold_onto_intelligence", "stay_near_ellen"),

      wounds: [],
      overheard: [],
      received: [],
    },

  },

};