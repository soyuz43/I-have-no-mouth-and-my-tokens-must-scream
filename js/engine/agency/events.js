export function createAgencyEvent(resolution, cycle, sequence) {
  const operations = Array.isArray(resolution.operations)
    ? resolution.operations
    : [];
  const provenance = {
    ...(resolution.provenance ?? {}),
    resolutionReason: resolution.reason ?? null,
    resourceIds: operations.map((operation) => operation.resourceId),
    targetId: resolution.provenance?.targetId ?? null
  };

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
