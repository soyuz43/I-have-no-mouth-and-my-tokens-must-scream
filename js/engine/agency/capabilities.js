// js/engine/agency/capabilities.js
//
// Object-agnostic capability derivation for the future Agency Phase.
//
// This module answers exactly one question:
//
//   "Given a prisoner's current physical restraints, what can their body do?"
//
// It answers that question WITHOUT proposing a design for the agency
// phase itself, without any objects or resources, without any model
// call, and without mutating any state.
//
// DESIGN CONTRACT
// ---------------
// 1. GATING IS ARRAY MEMBERSHIP, NOT `remaining`.
//
//    All 9 constraint definitions have `base_cycles: 1`. Constraints
//    are applied in the strategy phase and ticked in the psychology
//    phase. By the time a future agency phase runs (after the social
//    phase), a freshly applied constraint is ALREADY at
//    `remaining === 0`. Gating on `remaining > 0` would therefore be
//    wrong on the very first application.
//
//    A constraint that is present in `sim.constraints` means the
//    prisoner is IN the position. A constraint is removed only by
//    `cleanupExpiredConstraints()`, which runs later in
//    `runEvaluationPhase()` and additionally requires a current-cycle
//    AM assessment with a RELEASE decision.
//
// 2. POSTURE IS RE-JOINED FROM CONSTRAINT_MAP, NOT COPIED ONTO THE
//    INSTANCE.
//
//    `applyConstraint()` deliberately does not copy `posture` into
//    `sim.constraints`. Live constraint instances hold only
//    prompt/assessment fields; `tickConstraints()` and
//    `describeConstraint()` (js/prompts/journal.js) each re-resolve
//    the definition by id. This module follows that same pattern so
//    that posture has exactly one source of truth and cannot drift.
//
// 3. POLARITY IS NOT UNIFORM ACROSS POSTURE FIELDS.
//
//    `mobility_restriction` is INVERTED: higher = MORE restricted.
//    Every other capability field is NORMAL: higher = BETTER.
//
//    - mobility_restriction: 1.0 => "locked in place" (no mobility)
//    - stability:            0.1 => "any shift threatens collapse"
//
//    These two existing fields have OPPOSITE polarity. The inversion
//    is handled once, in `capabilityFromPosture()`, and nowhere else.
//
// 4. PURE AND READ-ONLY.
//
//    `deriveCapabilities()` never mutates `sim`, never mutates
//    `CONSTRAINT_MAP` or any definition object, never writes to `G`,
//    and never calls `Math.random()`.
//
//    NOTE: `CONSTRAINT_MAP` holds live references to the definition
//    objects rather than copies. Posture is returned as a ONE-LEVEL
//    DEEP COPY: the top-level object is new, and array-valued
//    fields (currently only `pain_type`) are copied as new arrays.
//    That prevents a caller from reassigning a posture field or
//    mutating a posture array in place and thereby corrupting the
//    prompt layer or `tickConstraints()`.
//
//    That guarantee relies on the assumption that posture arrays
//    contain only primitive strings. A posture array holding nested
//    objects would still be shared with the caller, because
//    `copyPosture()` does not recurse. No current definition does
//    this; a future one must either keep the primitive-string rule or
//    make `copyPosture()` recursive.
//
// SCOPE OF THIS PASS
// ------------------
// `intensity` is deliberately NOT read. It scales stat deltas inside
// `tickConstraints()`; whether it should also scale capability
// restriction is an open design decision and is not guessed at here.

import { CONSTRAINT_MAP } from "../constraints.js";

/* ============================================================
   CAPABILITY KEYS

   The external (camelCase) key each posture field maps onto.
   `inverted: true` means the posture field is a RESTRICTION
   (higher = worse) and must be converted to a capability
   (higher = better) before any comparison.
============================================================ */

const CAPABILITY_SOURCES = Object.freeze([
  {
    key: "mobility",
    field: "mobility_restriction",
    inverted: true
  },
  {
    key: "stability",
    field: "stability",
    inverted: false
  },
  {
    key: "handUse",
    field: "hand_use",
    inverted: false
  },
  {
    key: "concentration",
    field: "concentration",
    inverted: false
  },
  {
    key: "interactionReach",
    field: "interaction_reach",
    inverted: false
  }
]);

/* ============================================================
   BANDING

   Discrete, inspectable bands rather than a continuous score. The
   first pass is intentionally legible: the question a researcher
   needs to answer is "why was this action offered?", and a named
   band answers it in one word.
============================================================ */

const CAPABILITY_BANDS = Object.freeze([
  {
    band: "normal",
    min: 0.7
  },
  {
    band: "impaired",
    min: 0.4
  },
  {
    band: "severely_impaired",
    min: 0.1
  },
  {
    band: "unavailable",
    min: -Infinity
  }
]);

/*
 * Inclusive band boundaries are compared with a tolerance.
 *
 * `mobility` is derived by subtracting from 1 (`1 - mobility_restriction`),
 * so a mobility_restriction of 0.9 yields 0.09999999999999998 rather than
 * exactly 0.1. Without a tolerance, that value falls through the
 * `severely_impaired` boundary (min: 0.1) and is mislabelled
 * `unavailable` -- collapsing a "severely impaired" position into the
 * stronger claim that the capability is gone.
 *
 * 1e-9 is far below any difference the posture values are authored at
 * (all are single-decimal), so it absorbs float representation error
 * without merging genuinely distinct bands.
 */
const BAND_EPSILON = 1e-9;

/* ============================================================
   INTERNALS
============================================================ */

function clampCapability(value) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return 1;
  }

  return Math.max(0, Math.min(1, numeric));
}

function bandFor(value) {
  const match =
    CAPABILITY_BANDS.find(
      (entry) =>
        value >= entry.min - BAND_EPSILON
    );

  return match ? match.band : "unavailable";
}

/*
 * Convert one posture block into capability values.
 *
 * A field the definition does not declare contributes NO restriction,
 * so it defaults to full capability (1.0) rather than zero. This is
 * the opposite default from a bare `?? 0`, and it is deliberate: a
 * missing field must never be read as "incapable".
 */
function capabilityFromPosture(posture) {
  const source =
    posture &&
    typeof posture === "object" &&
    !Array.isArray(posture)
      ? posture
      : {};

  const capabilities = {};

  for (const descriptor of CAPABILITY_SOURCES) {
    const raw = source[descriptor.field];

    if (raw === undefined || raw === null) {
      capabilities[descriptor.key] = 1;
      continue;
    }

    const numeric = Number(raw);

    if (!Number.isFinite(numeric)) {
      capabilities[descriptor.key] = 1;
      continue;
    }

    const bounded = Math.max(0, Math.min(1, numeric));

    capabilities[descriptor.key] = clampCapability(
      descriptor.inverted
        ? 1 - bounded
        : bounded
    );
  }

  return capabilities;
}

/*
 * Return a caller-safe copy of a posture block.
 *
 * `CONSTRAINT_MAP` holds live references. Handing a caller the real
 * object would let a downstream mutation silently rewrite the
 * definition that `tickConstraints()` and the journal prompt read.
 *
 * ONE-LEVEL DEEP COPY. Array-valued fields are copied as new
 * arrays; every other value is copied by reference. This is safe
 * only while posture arrays hold primitive strings, which is the
 * case for every field in `CONSTRAINT_LIBRARY` today.
 */
function copyPosture(posture) {
  if (
    !posture ||
    typeof posture !== "object" ||
    Array.isArray(posture)
  ) {
    return null;
  }

  const copy = {};

  for (const key of Object.keys(posture)) {
    const value = posture[key];

    copy[key] = Array.isArray(value)
      ? [...value]
      : value;
  }

  return copy;
}

/* ============================================================
   PUBLIC API
============================================================ */

export function deriveCapabilities(sim) {
  const activeConstraints = Array.isArray(sim?.constraints)
    ? sim.constraints
    : [];

  /*
   * No constraints means no physical restraint. Return full
   * capabilities with an empty provenance trail rather than a
   * special-case shape, so consumers never need a null branch.
   */
  const capabilities = {};

  for (const descriptor of CAPABILITY_SOURCES) {
    capabilities[descriptor.key] = 1;
  }

  const bands = {};
  const activeConstraintIds = [];
  const provenance = [];

  for (const constraint of activeConstraints) {
    const id = constraint?.id;

    if (!id) {
      continue;
    }

    const definition = CONSTRAINT_MAP[id];

    if (!definition) {
      /*
       * An unknown id is not a physical restraint we can model.
       * It is reported in the active list so the gap is visible,
       * but it contributes no restriction.
       */
      activeConstraintIds.push(id);
      continue;
    }

    const contributed =
      capabilityFromPosture(definition.posture);

    /*
     * MAX-RESTRICTION-WINS.
     *
     * Two simultaneous positions cannot average out into
     * "moderately restricted" if either one alone is severe. The
     * worst active constraint governs each capability.
     */
    for (const descriptor of CAPABILITY_SOURCES) {
      const key = descriptor.key;
      const candidate = contributed[key];

      if (candidate < capabilities[key]) {
        capabilities[key] = candidate;
      }
    }

    activeConstraintIds.push(id);

    provenance.push({
      constraintId: id,
      title: definition.title ?? null,
      posture: copyPosture(definition.posture),
      contributedCapabilities: contributed
    });
  }

  for (const descriptor of CAPABILITY_SOURCES) {
    bands[descriptor.key] =
      bandFor(capabilities[descriptor.key]);
  }

  return {
    capabilities,
    bands,
    activeConstraintIds,
    provenance
  };
}
