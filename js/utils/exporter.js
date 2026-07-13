// js/utils/exporter.js
//
// Structured measurement/export layer for the AM Torment Engine.
// Records intent, execution, observation, journaling, state changes,
// constraints, relationships, communication, and assessment provenance.
//
// This module is a barrel that preserves the historical public API while
// the implementation is organized under ./exporter/. See:
//   exporter/state.js             singleton buffers + lifecycle
//   exporter/format.js            stateless formatting helpers
//   exporter/metadata.js          run/cycle metadata + record envelope
//   exporter/executionContext.js  AM execution provenance helpers
//   exporter/streams/*.js         per-domain telemetry recorders
//   exporter/aggregate.js         CSV, overview retention, export, cycle hooks

export { initExporter, getExporterOverviewData } from "./exporter/state.js";

export { recordRunMetadata, recordCycleMetadata } from "./exporter/metadata.js";

export {
  recordState,
  recordDynamics,
  recordPhases,
} from "./exporter/streams/psychology.js";

export {
  recordConstraints,
  recordRelationships,
  recordMessages,
} from "./exporter/streams/social.js";

export {
  recordGlobal,
  recordDecisions,
} from "./exporter/streams/system.js";

export {
  recordTactics,
  recordStrategies,
  recordExecutions,
} from "./exporter/streams/tactics.js";

export {
  recordObservations,
  recordJournalEvents,
  recordBeliefEvidence,
} from "./exporter/streams/subjective.js";

export {
  recordAssessments,
  recordObservabilityUnknowns,
} from "./exporter/streams/assessment.js";

export {
  toCSV,
  exportAllAsJSON,
  snapshotPrevState,
  finalizeCycle,
  recordCycle,
} from "./exporter/aggregate.js";
