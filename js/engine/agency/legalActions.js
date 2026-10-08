// js/engine/agency/legalActions.js
//
// Legal-action enumeration for the Agency Foundation.
//
// WHAT THIS MODULE DOES
// ---------------------
// It answers exactly one question:
//
//   "Given what this prisoner's body can currently do, which actions
//    are open to them, which are closed, and why?"
//
// It performs NO execution, NO costing of effort, NO model call, and
// NO state write. It is a pure function of its four arguments.
//
// TWO INDEPENDENT GATES
// ---------------------
// An action can be refused for two different reasons, and they are
// not interchangeable:
//
//   capabilities  - what the BODY can do. Evaluated by meetsMinimum()
//                   against the five deriveCapabilities() keys.
//   resources     - what the prisoner POSSESSES. Evaluated against a
//                   derived resource view.
//
// The capability gate runs FIRST. A prisoner whose hands are bound is
// reported as capability-blocked even if they also lack a cigarette,
// because "your body cannot do this" is the more informative refusal
// and it is the one the posture is actually responsible for.
//
// WHY LEGAL/BLOCKED RATHER THAN A SINGLE LIST
// -------------------------------------------
// The blocked half is the scientifically interesting half. A system
// that only reported what a prisoner CAN do would be unable to
// distinguish "this prisoner has nothing to say" from "this prisoner
// is physically unable to say it". Keeping the refusals, with the
// specific unmet threshold attached, is what makes the phase
// interpretable in the timeline rather than merely quiet.
//
// MODE LADDER SEMANTICS
// ---------------------
// A mode is a DEGRADED VARIANT of one action, not a separate action.
// A prisoner who cannot hold a DETAILED thought can still emit a
// SIGNAL. So a mode-blocked action is reported TWICE: once as legal
// with the modes that remain open, and once as blocked with the
// specific modes that closed. That pairing is what lets a consumer
// see both "he can still speak" and "he cannot be verbose tonight"
// without inferring one from the other's absence.
//
// When ALL modes close, the action is not legal at all — there is no
// variant left to perform — so it appears only in `blocked`.
//
// PURITY CONTRACT
// ---------------
// No mutation of any argument, no reads from `G`, no `Math.random()`,
// no `Date` access, no I/O. Same arguments in, structurally equal
// result out, every time. The resource view is PASSED IN, never read
// from global state, precisely to keep this contract true.

/*
 * Comparison tolerance.
 *
 * Capability values are authored as single decimals, but `mobility`
 * is a floating-point subtraction (`1 - mobility_restriction`) and so
 * is not exactly representable. A strict `>=` against a literal minimum
 * can therefore reject a prisoner sitting exactly on the threshold.
 *
 * 1e-9 mirrors `BAND_EPSILON` in capabilities.js so the band label and
 * the availability verdict cannot disagree about whether a value is on
 * a boundary. The tolerance absorbs representation error without
 * merging genuinely distinct authored values.
 */
const REQUIREMENT_EPSILON = 1e-9;

/* ============================================================
   INTERNALS
============================================================ */

/*
 * A minimum is satisfied when the capability is at least the
 * threshold, within tolerance.
 *
 * A capability key that is ABSENT is treated as UNMET, not as met.
 * `deriveCapabilities()` always emits all five keys, so absence means
 * a malformed or truncated capability set; failing closed keeps a
 * broken input from silently granting every action.
 */
function meetsMinimum(capabilities, key, minimum) {
  if (
    !capabilities ||
    typeof capabilities !== "object"
  ) {
    return false;
  }

  if (!Object.prototype.hasOwnProperty.call(capabilities, key)) {
    return false;
  }

  const actual = Number(capabilities[key]);
  const required = Number(minimum);

  if (!Number.isFinite(actual) || !Number.isFinite(required)) {
    return false;
  }

  return actual >= required - REQUIREMENT_EPSILON;
}

/*
 * Split a `{ key: minimum }` block into the entries that pass and the
 * entries that fail, preserving declaration order in both.
 *
 * The returned `missing` map holds the threshold that was NOT met,
 * not the capability value, because the threshold is what the action
 * author declared and therefore what a consumer needs in order to
 * reason about the refusal.
 */
function evaluateRequirements(requirements, capabilities) {
  const satisfied = {};
  const missing = {};

  if (
    !requirements ||
    typeof requirements !== "object"
  ) {
    return { satisfied, missing };
  }

  for (const key of Object.keys(requirements)) {
    const minimum = requirements[key];

    if (meetsMinimum(capabilities, key, minimum)) {
      satisfied[key] = minimum;
      continue;
    }

    missing[key] = minimum;
  }

  return { satisfied, missing };
}

/*
 * True when nothing is unmet.
 *
 * An empty requirements block is vacuously satisfied. WAIT depends
 * on this: it must stay legal no matter how badly the prisoner is
 * restrained.
 */
function isFullySatisfied(result) {
  return Object.keys(result.missing).length === 0;
}

/*
 * Collect the UNMET minimums across every mode that closed.
 *
 * Two rules govern this, and conflating them is the easy mistake:
 *
 *   1. ONLY the unmet key is reported. DETAILED declares both
 *      concentration 0.5 and stability 0.2; a prisoner who is stable
 *      but unfocused failed the concentration bar, not the stability
 *      one. Recording both would tell a reader their stability is
 *      impaired when it is at full.
 *
 *   2. When the SAME key fails in several modes (concentration 0.4
 *      in COHERENT, 0.5 in DETAILED), the MAXIMUM is reported. That
 *      is the real bar they fell short of: had they reached it, every
 *      one of those modes would have opened. Reporting 0.4 would
 *      understate the gap by a whole mode tier.
 *
 * `closedModes` maps mode name -> the evaluated { satisfied, missing }
 * pair produced by evaluateRequirements, not the raw definition.
 */
function aggregateMissingModes(closedModes) {
  const missing = {};

  for (const modeName of Object.keys(closedModes)) {
    const unmet = closedModes[modeName]?.missing;

    if (
      !unmet ||
      typeof unmet !== "object"
    ) {
      continue;
    }

    for (const key of Object.keys(unmet)) {
      const minimum = unmet[key];
      const existing = missing[key];

      if (existing === undefined) {
        missing[key] = minimum;
        continue;
      }

      if (Number(minimum) > Number(existing)) {
        missing[key] = minimum;
      }
    }
  }

  return missing;
}

/*
 * Evaluate the RESOURCE half of an action's requirements.
 *
 * WHY THIS IS NOT meetsMinimum()
 * ------------------------------
 * `ignition` is a resource prerequisite, not a capability. A
 * capability requirement is a numeric floor compared against one of
 * five derived floats; a resource requirement is a question about
 * possession. meetsMinimum() FAILS CLOSED on an absent key, and
 * deriveCapabilities() will never emit `ignition`, so routing this
 * through the capability path would refuse every resource-bearing
 * action for every prisoner, silently and permanently.
 *
 * FAIL-CLOSED RULES (all deliberate)
 * ----------------------------------
 *   - No view supplied            -> everything declared is unmet.
 *   - `ignition: true` but no
 *     ignition source held        -> unmet.
 *   - `consume: [{...}]` and the
 *     prisoner holds too few      -> unmet.
 *   - `holdAny: true` and the
 *     prisoner holds no stack     -> unmet.
 *
 * A prisoner must never be GRANTED an action because the engine could
 * not read their inventory. Refusing is recoverable and visible;
 * silently granting is neither.
 *
 * Returns the same { satisfied, missing } shape the capability path
 * uses, so both halves report through one field downstream.
 */
function evaluateResourceRequirements(resourceRequirements, view) {
  const satisfied = {};
  const missing = {};

  if (
    !resourceRequirements ||
    typeof resourceRequirements !== "object"
  ) {
    return { satisfied, missing };
  }

  const safeView =
    view && typeof view === "object"
      ? view
      : null;

  const byDefinition =
    safeView &&
    safeView.byDefinition &&
    typeof safeView.byDefinition === "object"
      ? safeView.byDefinition
      : {};

  if (resourceRequirements.ignition === true) {
    const hasIgnition = safeView?.hasIgnition === true;

    if (hasIgnition) {
      satisfied.ignition = true;
    } else {
      missing.ignition = true;
    }
  }

  /*
   * `consume` is a list of { definitionId, quantity } entries: the
   * stacks an action would draw down. Every entry must be satisfied.
   * A shortfall is recorded as the REQUIRED quantity, matching the
   * capability path's convention of reporting the declared bar
   * rather than the observed value.
   */
  const consume = Array.isArray(resourceRequirements.consume)
    ? resourceRequirements.consume
    : [];

  for (const entry of consume) {
    const definitionId = entry?.definitionId;

    if (typeof definitionId !== "string") {
      continue;
    }

    const required = Number(entry?.quantity);

    if (!Number.isFinite(required)) {
      continue;
    }

    const stacks = Array.isArray(byDefinition[definitionId])
      ? byDefinition[definitionId]
      : [];

    let held = 0;

    for (const stack of stacks) {
      const quantity = Number(stack?.quantity);

      if (Number.isFinite(quantity)) {
        held += quantity;
      }
    }

    if (held >= required) {
      satisfied[definitionId] = required;
      continue;
    }

    missing[definitionId] = required;
  }

  /*
   * `holdAny` means "possesses at least one accessible stack".
   *
   * The target resource is IMPLICIT: this slice does not name
   * specific resourceIds, because choosing one is a proposal-pipeline
   * concern that does not exist yet. The gate is the possession
   * precondition only.
   */
  if (resourceRequirements.holdAny === true) {
    const stackCount =
      Array.isArray(safeView?.stacks)
        ? safeView.stacks.length
        : 0;

    if (stackCount > 0) {
      satisfied.holdAny = true;
    } else {
      missing.holdAny = true;
    }
  }

  return { satisfied, missing };
}

/* ============================================================
   PUBLIC API
============================================================ */

/*
 * Enumerate every action in `registry` against one prisoner's
 * capabilities.
 *
 * `sim` is accepted for interface symmetry with the rest of the agency
 * machinery and is read for `sim.id` ONLY. It is never read for
 * suffering, hope, sanity, constraints, or any other field: physical
 * availability is a question about the body, and reading mood here
 * would make "can he speak" answerable by "how badly does he want
 * to", which is a different question and belongs to a later slice.
 *
 * The id is used only to reject a caller that supplied no sim at
 * all. A nameless sim has nowhere to write a result, so returning an
 * empty enumeration is the honest answer.
 */
export function enumerateLegalActions(
  sim,
  capabilities,
  registry,
  resourceView = null
) {
  const empty = { legal: [], blocked: [] };

  if (!sim || typeof sim !== "object" || !sim.id) {
    return empty;
  }

  if (
    !registry ||
    typeof registry !== "object"
  ) {
    return empty;
  }

  /*
   * A null or malformed view is NOT a reason to return early.
   *
   * Every action still has to be classified: WAIT and OBSERVE have no
   * resource requirements and must stay legal for a prisoner whose
   * inventory could not be read. Only the actions that DECLARE a
   * resource requirement fail closed against the missing view.
   */
  const safeResourceView =
    resourceView && typeof resourceView === "object"
      ? resourceView
      : null;

  const legal = [];
  const blocked = [];

  const capabilitySet =
    capabilities &&
    typeof capabilities === "object"
      ? capabilities
      : {};

  for (const type of Object.keys(registry)) {
    const definition = registry[type];

    if (
      !definition ||
      typeof definition !== "object"
    ) {
      continue;
    }

    const modes =
      definition.executionModes &&
      typeof definition.executionModes === "object"
        ? definition.executionModes
        : {};

    const modeNames = Object.keys(modes);

    const topLevel = evaluateRequirements(
      definition.requirements,
      capabilitySet
    );

    if (!isFullySatisfied(topLevel)) {
      /*
       * The top-level gate closed, so the action itself is refused
       * regardless of its mode ladder. Every mode is reported as
       * blocked so the consumer does not have to look the ladder up
       * in the registry to see that nothing survives.
       */
      const entry = {
        type,
        title: definition.title ?? type,
        reason: "capability_below_minimum",
        missingRequirements: { ...topLevel.missing }
      };

      if (modeNames.length > 0) {
        entry.blockedModes = [...modeNames];
      }

      blocked.push(entry);

      continue;
    }

    /*
     * SECOND GATE: resources.
     *
     * Reached only when the body is capable, so a hands-bound
     * prisoner is reported above as capability-blocked rather than
     * here as resource-blocked.
     */
    const resourceGate = evaluateResourceRequirements(
      definition.resourceRequirements,
      safeResourceView
    );

    if (!isFullySatisfied(resourceGate)) {
      blocked.push({
        type,
        title: definition.title ?? type,
        reason: "resource_requirement_unmet",
        missingRequirements: { ...resourceGate.missing }
      });

      continue;
    }

    if (modeNames.length === 0) {
      /*
       * No mode ladder: the action is available at its base cost in
       * exactly one form, which is reported as an empty mode list
       * rather than a synthetic mode name. Consumers can then treat
       * `availableModes.length === 0` uniformly as "single-form
       * action" without special-casing WAIT.
       */
      legal.push({
        type,
        title: definition.title ?? type,
        cost: definition.baseCost ?? 0,
        availableModes: []
      });

      continue;
    }

    const availableModes = [];
    const closedModes = [];

    /* mode name -> the { satisfied, missing } pair for that mode, so
       the refusal can report unmet thresholds rather than every
       threshold the mode happens to declare. */
    const closedEvaluations = {};

    for (const modeName of modeNames) {
      const modeRequirements = evaluateRequirements(
        modes[modeName]?.minimums,
        capabilitySet
      );

      if (isFullySatisfied(modeRequirements)) {
        availableModes.push(modeName);
        continue;
      }

      closedModes.push(modeName);
      closedEvaluations[modeName] = modeRequirements;
    }

    if (availableModes.length === 0) {
      /*
       * Every variant closed. There is no degraded form left to
       * perform, so the action is not legal — it is reported once,
       * in `blocked`, with the highest threshold that was missed.
       */
      blocked.push({
        type,
        title: definition.title ?? type,
        reason: "capability_below_minimum",
        missingRequirements: aggregateMissingModes(closedEvaluations),
        blockedModes: [...closedModes]
      });

      continue;
    }

    legal.push({
      type,
      title: definition.title ?? type,
      cost: definition.baseCost ?? 0,
      availableModes: [...availableModes]
    });

    if (closedModes.length > 0) {
      /*
       * The paired refusal. Its presence is the only thing that makes
       * "he can still speak, but not at length" legible downstream.
       */
      blocked.push({
        type,
        title: definition.title ?? type,
        reason: "capability_below_minimum",
        missingRequirements: aggregateMissingModes(closedEvaluations),
        blockedModes: [...closedModes]
      });
    }
  }

  return { legal, blocked };
}

