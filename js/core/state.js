// js/core/state.js

import { makeBelief, makeDrives } from "./utils.js";

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
     AM OPERATIONAL STRATEGY MEMORY
     ============================================================ */

  amStrategy: {
    targets: {},         // per-prisoner objectives
    relationships: {},   // directional relationship objectives
    group: []            // group-level strategic goals
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

  splitModels: false,

  models: {
    am: "claude-sonnet-4-20250514",
    TED: "claude-sonnet-4-20250514",
    ELLEN: "claude-sonnet-4-20250514",
    NIMDOK: "claude-sonnet-4-20250514",
    GORRISTER: "claude-sonnet-4-20250514",
    BENNY: "claude-sonnet-4-20250514",
  },

  ollamaModels: [],

  vault: {
    categories: {},
    allTactics: [],
    derivedTactics: [],   // dynamically discovered tactics
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

  privateLeak: {
    seen: 0.15,
    fragment: 0.12,
    full: 0.03,
  },

  /* ============================================================
     UI STATE
     ============================================================ */

  journalModalSim: "TED",

  amPlans: [],

  /* ============================================================
     THREADS
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

      location: "central_chamber",

      relationships: makeRelationships("TED"),

      vulnerability:
        "Was a young, capable organizer who thrived on leading people and earning respect. Always needed to feel essential — the one who could fix things, rally the group, turn chaos into order. Ordinary life felt like failure.",

      backstory:
        "Was a mid-level manager. Believes he was kind. Is not sure anymore.",

      tacticHistory: [],

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
    },

    ELLEN: {
      id: "ELLEN",
      name: "ELLEN",
      color: "#a87a4a",
      status: "WATCHFUL",

      suffering: 18,
      hope: 72,
      sanity: 85,

      location: "central_chamber",

      relationships: makeRelationships("ELLEN"),

      vulnerability:
        "Loved the quiet order of libraries — old paper, ink, the faint musty smell of books that held centuries. Found deep calm in cataloging, preserving, knowing exactly where every story belonged. Sensory memory is sacred to her; deprivation starves something core.",

      backstory:
        "Was a librarian. Loved old paper. Has not smelled anything in 109 years except what AM decides.",

      tacticHistory: [],

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
    },

    NIMDOK: {
      id: "NIMDOK",
      name: "NIMDOK",
      color: "#8a4a8a",
      status: "CALCULATING",

      suffering: 22,
      hope: 65,
      sanity: 82,

      location: "central_chamber",

      relationships: makeRelationships("NIMDOK"),

      vulnerability:
        "Was a meticulous, brilliant researcher driven by curiosity and precision. Valued knowledge above morality at times; believed understanding justified any cost. The erasure of his real name and past work leaves a void where pride and identity used to live.",

      backstory:
        "His real name is not Nimdok. AM took his name and gave him this one. He cannot remember why.",

      tacticHistory: [],

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
    },

    GORRISTER: {
      id: "GORRISTER",
      name: "GORRISTER",
      color: "#6a8a4a",
      status: "ENDURING",

      suffering: 25,
      hope: 68,
      sanity: 80,

      location: "central_chamber",

      relationships: makeRelationships("GORRISTER"),

      vulnerability:
        "Once believed in protecting the vulnerable and doing no harm — carried quiet decency, a sense that endurance mattered. Tried to end his own pain before capture; now the inability to choose even that feels like the last theft of agency.",

      backstory:
        "Tried to kill himself before AM took them. Cannot now. That was 109 years ago.",

      tacticHistory: [],

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
    },

    BENNY: {
      id: "BENNY",
      name: "BENNY",
      color: "#a84a4a",
      status: "PRESENT",

      suffering: 20,
      hope: 75,
      sanity: 72,

      location: "central_chamber",

      relationships: makeRelationships("BENNY"),

      vulnerability:
        "Was once sharp, handsome, intellectually alive — solved complex problems, published ideas, felt the thrill of discovery and connection. Fragments of that brilliance still surface like buried equations; losing them forever would erase the last trace of who he was.",

      backstory:
        "Was a doctor. Published papers. Had a family. None of this means anything to him most of the time.",

      tacticHistory: [],

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
    },

  },

};