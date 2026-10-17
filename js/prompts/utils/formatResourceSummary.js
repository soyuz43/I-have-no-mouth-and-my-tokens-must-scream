export function formatResourceSummary(instances, holderId) {
  const quantitiesByDefinition = new Map();

  for (const instance of Array.isArray(instances) ? instances : []) {
    if (
      !instance ||
      instance.holderId !== holderId ||
      typeof instance.definitionId !== "string" ||
      instance.definitionId.length === 0
    ) {
      continue;
    }

    const quantity = Number(instance.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      continue;
    }

    quantitiesByDefinition.set(
      instance.definitionId,
      (quantitiesByDefinition.get(instance.definitionId) || 0) + quantity
    );
  }

  const entries = [...quantitiesByDefinition.entries()].sort(
    ([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)
  );

  return entries.length > 0
    ? `[YOUR RESOURCES] ${entries.map(([definitionId, quantity]) => `${definitionId}: ${quantity}`).join(", ")}`
    : "[YOUR RESOURCES] None";
}
