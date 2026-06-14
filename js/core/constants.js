// js/core/constants.js

export const SIM_IDS = ["TED", "ELLEN", "NIMDOK", "GORRISTER", "BENNY"];

export const SIM_NAMES = {
  TED: "TED",
  ELLEN: "ELLEN",
  NIMDOK: "NIMDOK",
  GORRISTER: "GORRISTER",
  BENNY: "BENNY",
};

/*
============================================================
EVIDENCE SOURCES

These are controlled labels for WHERE an evidence object came from.

This is not a special JavaScript enum.
It is just one shared dictionary so the codebase does not drift into:
"journal", "Journal", "diary", "journals", etc.
============================================================
*/

export const EVIDENCE_SOURCES = {
  JOURNAL: "journal",
  AM_ACTION: "am_action",
  CONSTRAINT: "constraint",
  PRIVATE_MESSAGE: "private_message",
  PUBLIC_MESSAGE: "public_message",
  OVERHEARD_MESSAGE: "overheard_message",
  BELIEF_CONTAGION: "belief_contagion",
  RELATIONSHIP_DRIFT: "relationship_drift",
  SYSTEM_INFERENCE: "system_inference",
};

/*
============================================================
EVIDENCE ATTRIBUTIONS

These describe WHY/HOW the system thinks the evidence affected state.
============================================================
*/

export const EVIDENCE_ATTRIBUTIONS = {
  CONTAGION: "contagion",
  JOURNAL_INFERENCE: "journal_inference",
  FORENSIC_INFERENCE: "forensic_inference",
  CONSTRAINT_STRESS: "constraint_stress",
  AM_PRESSURE: "am_pressure",
  SOCIAL_PRESSURE: "social_pressure",
  RELATIONSHIP_DRIFT: "relationship_drift",
};