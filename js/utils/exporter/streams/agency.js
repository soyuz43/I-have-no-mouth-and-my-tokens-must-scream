// js/utils/exporter/streams/agency.js
//
// Physical capability and action-availability stream.
//
// WHAT THIS STREAM IS FOR
// -----------------------
// `runAgencyPhase()` derives five physical capabilities and two
// action lists per agent, every cycle, and stores them in
// `G.agency`. Nothing else consumes that envelope, and
// `G.agency` is reset field-by-field in `beginCycle()`. So before
// this stream existed the derivation was computed and then
// discarded: a run produced no durable record that a prisoner's
// body could not do something, and the researcher had no way to
// correlate a refusal with a posture.
//
// This stream is that durable record. It is the ONLY persistence
// for agency data, which is why no history array was added to
// `G.agency`. The causal link that makes the record interpretable
// lives in its `provenance` field.
//
// WHY A SEPARATE STREAM RATHER THAN COLUMNS ON `state`
// ------------------------------------------------------
// The `state` stream is deliberately flat and narrow: four
// psychological scalars per agent per cycle. Agency data is
// high-cardinality and structural — five capabilities, five
// bands, a constraint list, a legal list, and a blocked list
// whose entries carry nested `missingRequirements` maps. Widening
// `state` would have required either nested objects in a flat
// stream (breaking every `.map` and CSV consumer of it) or
// column-flattening ~15 fields (unreadable, and lossy for the
// blocked reasons, which are the analytically interesting half).
//
// FLAT-ABOVE, NARRATIVE-BELOW
// ---------------------------
// The scalar and identifier fields are flat so the row survives a
// CSV round-trip and a pandas join without parsing. The `blocked`
// array stays a real nested array because `missingRequirements`
// maps a capability to a THRESHOLD, and a researcher asking "how
// far below the bar was he" needs those as numbers. Stringifying
// it would destroy exactly the field that makes a refusal
// interpretable.
//
// NOT IN THE BOUNDED OVERVIEW HISTORY
// ------------------------------------
// `blocked` and `provenance` are the nested fields here. Both are
// bounded
// by the action catalogue (currently two entries) rather than by
// journal text or message bodies. It is still deliberately left
// out of `buildOverviewHistoryEntry()` in aggregate.js: that
// allowlist exists to keep the live cognition projection light, and
// the cognition modal reads current-cycle agency data directly
// from `G.agency` rather than from retained history. Adding it
// there would be an unused copy.

import { Exporter } from "../state.js";
import { attachRecordMeta } from "../metadata.js";
import { asArray, cloneValue, joinList } from "../format.js";
import { SIM_IDS } from "../../../core/constants.js";

/* ============================================================
   AGENCY STREAM
   Physical possibility space, one record per agent per cycle
============================================================ */

/*
 * Copy a `{ key: threshold }` map with its values still NUMBERS.
 *
 * `cloneValue()` is used rather than a spread so the shape cannot
 * drift from what `legalActions.js` emits, and so a future field
 * added to a blocked entry survives without a change here. The
 * threshold values are never stringified: a missing minimum
 * recorded as "0.5" instead of 0.5 is a silent corruption of the
 * field the whole stream exists to preserve.
 */
function normalizeBlockedEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const record = {
    type: entry.type ?? null,
    title: entry.title ?? null,
    reason: entry.reason ?? null,
    missing_requirements: cloneValue(
      entry.missingRequirements ?? {}
    )
  };

  /*
   * `blockedModes` is ABSENT rather than null when the action has
   * no mode ladder. A mode-less refusal and a refusal with zero
   * open modes are different claims, and collapsing both to `[]`
   * would erase that distinction.
   */
  if (Array.isArray(entry.blockedModes)) {
    record.blocked_modes = [...entry.blockedModes];
  }

  return record;
}

/**
 * Record this cycle's agency derivation for every agent that has
 * one.
 *
 * An agent with no `G.agency.capabilities[simId]` entry produced no
 * record at all, rather than a row of nulls. That happens when the
 * phase `continue`d past a missing sim or swallowed a per-sim
 * failure; a row of nulls would be indistinguishable from an
 * unconstrained prisoner in a flattened analysis.
 *
 * @param {object} G
 * @param {number} cycle
 */
export function recordAgency(G, cycle) {
  const capabilitiesById =
    G?.agency?.capabilities ??
    {};

  const legalById = G?.agency?.legalActions ?? {};
  const blockedById = G?.agency?.blockedActions ?? {};

  for (const simId of SIM_IDS) {
    const derived = capabilitiesById[simId];

    if (!derived || typeof derived !== "object") {
      continue;
    }

    /*
     * A missing action list is recorded as an EMPTY list, not
     * omitted. `legal` and `blocked` are two independent maps, and
     * an agent with a derivation but no legal entry means the
     * enumerator produced nothing — an empty legal set is a real
     * state worth recording, distinct from a phase that never ran.
     * The presence of the capabilities row already tells the two
     * apart.
     */
    const legal = asArray(legalById[simId]);
    const blocked = asArray(blockedById[simId]);

    /*
     * The resource VIEW for this agent. Absent when the phase never
     * got as far as building one, in which case every derived field
     * below records as empty rather than null: an agent with no view
     * possesses nothing gatable, and a null would be read as
     * "unknown" rather than "none".
     */
    const resourceView =
      G?.agency?.resources?.[simId] ?? null;

    const heldByDefinition =
      resourceView &&
      resourceView.byDefinition &&
      typeof resourceView.byDefinition === "object"
        ? resourceView.byDefinition
        : {};

    const hasIgnition =
      resourceView?.hasIgnition === true;

    const blockedRecords = blocked
      .map(normalizeBlockedEntry)
      .filter(Boolean);

    Exporter.buffers.agency.push(
      attachRecordMeta(
        {
          run_id: Exporter.runId,
          cycle,
          agent: simId,

          /*
           * `cloneValue()` rather than a live reference. The
           * exporter is cleared at the end of every cycle while
           * `G.agency` survives until the next `beginCycle()`, so
           * a shared reference would let a later mutation of the
           * envelope rewrite an already-exported record in a
           * retained buffer.
           */
          capabilities: cloneValue(
            derived.capabilities ?? {}
          ),
          bands: cloneValue(derived.bands ?? {}),
          active_constraints: joinList(
            derived.activeConstraintIds
          ),

          /*
           * `provenance` is the ONLY place the causal chain from a
           * posture to a refusal survives the run. The capability
           * scalars above record the max-restriction-wins RESULT;
           * `active_constraints` records only WHICH restraints were
           * present. Neither says which restraint produced the
           * winning value, so a row with two simultaneous positions
           * is consistent with either being the binding cause.
           *
           * `js/ui/agencyFormatter.js` performs exactly this join,
           * but it is recomputed from `G.agency` on every modal open
           * and never persisted. Without this field the exported
           * record supports correlation (`concentration` 0.2 while
           * `palestinian_chair` was active) but NOT attribution, and
           * the stream header above claims attribution.
           *
           * Nested and array-valued, unlike the flat fields above,
           * for the same reason `blocked` is: each entry carries a
           * `contributedCapabilities` map of five numbers, and
           * column-flattening that would be both unreadable and
           * lossy. The values are NUMBERS, never strings, so the
           * exported floats stay comparable to `capabilities` above.
           */
          provenance: cloneValue(
            asArray(derived.provenance)
          ),

          legal_actions: joinList(
            legal.map(
              (entry) => entry?.type
            )
          ),
          legal_count: legal.length,

          blocked_count: blockedRecords.length,
          blocked: blockedRecords,

          /*
           * The per-prisoner resource VIEW, not the ledger.
           *
           * `held_resources` is flat ("cigarette:3|match:1") so the
           * row survives a CSV round-trip; `has_ignition` is a flat
           * boolean because it is the single field the
           * cigarette-and-match dependency turns on. `held_stacks`
           * stays nested because each stack carries provenance and
           * accessibility flags a researcher needs as separate
           * values.
           *
           * Consumed quantities are NOT recorded here: this slice
           * never mutates the ledger, so a change across cycles can
           * only ever be a seeding or import-order artifact.
           */
          /*
           * `joinList()` always joins on ";" and takes no separator
           * argument, so the counts are formatted here rather than by
           * passing one that would be silently ignored.
           */
          held_resources: joinList(
            Object.keys(heldByDefinition).map(
              (definitionId) =>
                definitionId +
                ":" +
                heldByDefinition[definitionId].reduce(
                  (sum, stack) =>
                    sum + (Number(stack?.quantity) || 0),
                  0
                )
            )
          ),
          has_ignition: hasIgnition,
          held_stacks: cloneValue(
            asArray(resourceView?.stacks)
          )
        },
        cycle
      )
    );
  }
}
