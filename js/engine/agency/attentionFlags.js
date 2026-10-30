// js/engine/agency/attentionFlags.js
//
// The attention-flag channel that AM reads.
//
// WHY THIS MODULE EXISTS
// ----------------------
// Two independent engine paths can make a held resource salient to
// AM, and they write to the SAME channel:
//
//   1. The attention ROLL in commit.js, which samples every held
//      resource and may or may not draw attention to each.
//   2. The capability-concealment rule, which OPENS a resource its
//      holder can no longer hide.
//
// Before this module, only the roll wrote flags, so the flag shape
// was whatever the roll happened to produce. Now that a second
// writer exists, both writers must agree on the shape and on what
// counts as a duplicate, so that agreement lives here rather than
// being re-decided at each call site.
//
// THE FLAG SHAPE
// --------------
//   cycle         the cycle the flag was raised in
//   actorId       the prisoner who HOLDS the resource
//   resourceId    the resource instance
//   definitionId  the resource definition
//   source        optional provenance; absent for roll flags
//
// `actorId` names the HOLDER, not the agent that raised the flag.
// The concealment rule is executed by the engine, but the flag
// describes whose holdings AM should look at. This matches the roll,
// whose `actorId` is the holder of the sampled resource.
//
// Every field a consumer reads is already produced by the roll, so
// a flag written by either path is interchangeable downstream.
//
// DEDUPLICATION
// -------------
// A flag is identified by cycle + actorId + resourceId. Two flags
// with the same identity describe the same attention event, so only
// the first is kept.
//
// Without this, a resource that becomes exposed and then also wins
// the attention roll in the same cycle would appear twice in AM's
// prompt: once for each reason it became salient. The flag channel
// is a salience signal, and one salient item should read as one
// signal.
//
// DETERMINISM
// -----------
// Nothing here consumes randomness. The concealment rule is
// deterministic, so its flag must be too.

/**
 * The identity of an attention flag.
 *
 * Two flags with the same identity describe the same attention
 * event and are treated as one.
 */
function flagIdentity(flag) {
  const cycle = Number.isFinite(Number(flag?.cycle))
    ? Number(flag.cycle)
    : null;
  const actorId = typeof flag?.actorId === "string"
    ? flag.actorId.trim()
    : "";
  const resourceId = typeof flag?.resourceId === "string"
    ? flag.resourceId.trim()
    : "";

  if (cycle === null || !actorId || !resourceId) {
    return null;
  }

  return `${cycle}|${actorId}|${resourceId}`;
}

/**
 * Raise one attention flag on the pending channel.
 *
 * @param {Object} G    The authoritative game state.
 * @param {Object} flag The flag to raise.
 * @return {boolean} True when a new flag was appended, false when
 *          the flag was malformed or a duplicate of a flag already
 *          raised.
 *
 * THE RETURN VALUE IS A REPORT, NOT A CONTROL FLOW
 * -----------------------------------------------
 * The caller decides what to do with it. The attention roll uses
 * it to avoid logging an attention event that no flag was actually
 * raised for: if the roll drew a resource the concealment rule had
 * already flagged this cycle, nothing new was inserted and the
 * debug line would be misleading.
 */
export function appendAttentionFlag(G, flag) {
  if (!G || typeof G !== "object") {
    return false;
  }

  const identity = flagIdentity(flag);

  if (!identity) {
    return false;
  }

  if (!Array.isArray(G.pendingResourceDiscoveries)) {
    G.pendingResourceDiscoveries = [];
  }

  const alreadyRaised = G.pendingResourceDiscoveries.some(
    (entry) => flagIdentity(entry) === identity
  );

  if (alreadyRaised) {
    return false;
  }

  const record = {
    cycle: Number(flag.cycle),
    actorId: flag.actorId.trim(),
    resourceId: flag.resourceId.trim(),
    definitionId: typeof flag.definitionId === "string"
      ? flag.definitionId
      : null
  };

  /*
   * The source is optional provenance. It is added only when the
   * caller supplies one, so a flag written by the attention roll
   * keeps exactly the shape it had before this module existed.
   */
  if (typeof flag.source === "string" && flag.source.length > 0) {
    record.source = flag.source;
  }

  G.pendingResourceDiscoveries.push(record);

  return true;
}
