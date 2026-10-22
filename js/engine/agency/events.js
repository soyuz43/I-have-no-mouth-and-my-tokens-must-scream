export function createAgencyEvent(resolution, cycle, sequence) {
  const operations = Array.isArray(resolution.operations)
    ? resolution.operations
    : [];

  /*
   * The resource the prisoner REACHED FOR, as distinct from the
   * resources the action actually moved.
   *
   * `resourceIds` is empty for a refused action, because nothing
   * moved. That left the prisoner's review with no way to say WHICH
   * thing was missing: "you reached for it and there was nothing
   * there" is much weaker than "you reached for cigarette_stack_01
   * and there was nothing there". This is the field that lets the
   * review name it.
   *
   * It is added ONLY when the action named a resource. An action
   * that picks its own target (SMOKE chooses the stack itself) has
   * no such name, and an absent field says that honestly, whereas a
   * null field would sit in the provenance as a null where every
   * other field carries a real value.
   */
  const actionResourceId = resolution.action?.resourceId ?? null;

  const provenance = {
    ...(resolution.provenance ?? {}),
    resolutionReason: resolution.reason ?? null,
    resourceIds: operations.map((operation) => operation.resourceId),
    targetId: resolution.provenance?.targetId ?? null
  };

  if (actionResourceId) {
    provenance.actionResourceId = actionResourceId;
  }

  return {
    eventId: `agency:${cycle}:${sequence}`,
    cycle,
    actorId: resolution.actorId,
    actionType: resolution.action?.type ?? "WAIT",
    status: resolution.status === "success" ? "success" : "blocked",
    provenance
  };
}

export function getAgencyEventsForReview(events, simId, reviewCycle) {
  if (!Array.isArray(events) || !Number.isSafeInteger(reviewCycle)) {
    return [];
  }

  return events.filter((event) =>
    event &&
    event.cycle === reviewCycle - 1 &&
    (
      event.actorId === simId ||
      (
        event.status === "success" &&
        event.provenance?.targetId === simId
      )
    )
  );
}
