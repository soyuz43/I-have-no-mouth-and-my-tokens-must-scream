export const INTERVENTION_TYPES = Object.freeze({
  TAUNT: "taunt",
  CONFISCATE: "confiscate",
  DESTROY: "destroy",
  TRANSFER: "transfer"
});

function findResource(resources, resourceId) {
  if (!Array.isArray(resources?.instances)) return null;
  return resources.instances.find((instance) => instance?.resourceId === resourceId) ?? null;
}

function fail(reason) {
  return { valid: false, reason };
}

function validateResource(intervention, resources) {
  if (typeof intervention?.resource_id !== "string" || !intervention.resource_id.trim()) {
    return fail("resource_id must be a non-empty resource ID.");
  }

  const resource = findResource(resources, intervention.resource_id);
  if (!resource) return fail(`Resource ${intervention.resource_id} does not exist.`);
  return { valid: true, resource };
}

function validateHolder(holderId, sims) {
  return (
    typeof holderId === "string" &&
    holderId.trim() !== "" &&
    (holderId === "AM" || Object.hasOwn(sims ?? {}, holderId))
  );
}

function validateCurrentHolder(intervention, resource, sims) {
  if (!validateHolder(intervention?.holder_id, sims)) {
    return fail(`Holder ${intervention?.holder_id ?? "(missing)"} does not exist.`);
  }

  if (resource.holderId !== intervention.holder_id) {
    return fail(
      `Resource ${resource.resourceId} is held by ${resource.holderId ?? "nobody"}, not ${intervention.holder_id}.`
    );
  }

  return { valid: true };
}

function validateQuantity(intervention, resource) {
  const heldQuantity = Number(resource.quantity);
  if (!Number.isSafeInteger(heldQuantity) || heldQuantity < 1) {
    return fail(`Resource ${resource.resourceId} has no valid held quantity.`);
  }

  const quantity = intervention.quantity === undefined
    ? heldQuantity
    : intervention.quantity;

  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    return fail("quantity must be a positive integer.");
  }

  if (quantity > heldQuantity) {
    return fail(
      `Cannot affect ${quantity} units of ${resource.resourceId}; only ${heldQuantity} are held.`
    );
  }

  return { valid: true, quantity };
}

export function validateTauntIntervention(intervention, context = {}) {
  const resourceResult = validateResource(intervention, context.resources);
  if (!resourceResult.valid) return resourceResult;

  if (!validateHolder(intervention?.target_id, context.sims)) {
    return fail(`Taunt target ${intervention?.target_id ?? "(missing)"} does not exist.`);
  }

  return {
    valid: true,
    resource: resourceResult.resource,
    intervention: {
      ...intervention,
      intervention_type: INTERVENTION_TYPES.TAUNT
    }
  };
}

export function validateConfiscateIntervention(intervention, context = {}) {
  const resourceResult = validateResource(intervention, context.resources);
  if (!resourceResult.valid) return resourceResult;

  const holderResult = validateCurrentHolder(
    intervention,
    resourceResult.resource,
    context.sims
  );
  if (!holderResult.valid) return holderResult;

  const quantityResult = validateQuantity(intervention, resourceResult.resource);
  if (!quantityResult.valid) return quantityResult;

  return {
    valid: true,
    resource: resourceResult.resource,
    intervention: {
      ...intervention,
      intervention_type: INTERVENTION_TYPES.CONFISCATE,
      quantity: quantityResult.quantity
    }
  };
}

export function validateDestroyIntervention(intervention, context = {}) {
  const resourceResult = validateResource(intervention, context.resources);
  if (!resourceResult.valid) return resourceResult;

  return {
    valid: true,
    resource: resourceResult.resource,
    intervention: {
      ...intervention,
      intervention_type: INTERVENTION_TYPES.DESTROY
    }
  };
}

export function validateTransferIntervention(intervention, context = {}) {
  const resourceResult = validateResource(intervention, context.resources);
  if (!resourceResult.valid) return resourceResult;

  const holderResult = validateCurrentHolder(
    intervention,
    resourceResult.resource,
    context.sims
  );
  if (!holderResult.valid) return holderResult;

  if (!validateHolder(intervention?.target_holder_id, context.sims)) {
    return fail(
      `Target holder ${intervention?.target_holder_id ?? "(missing)"} does not exist.`
    );
  }

  if (intervention.target_holder_id === intervention.holder_id) {
    return fail("Transfer source and target holders must differ.");
  }

  const quantityResult = validateQuantity(intervention, resourceResult.resource);
  if (!quantityResult.valid) return quantityResult;

  return {
    valid: true,
    resource: resourceResult.resource,
    intervention: {
      ...intervention,
      intervention_type: INTERVENTION_TYPES.TRANSFER,
      quantity: quantityResult.quantity
    }
  };
}

export const INTERVENTION_VALIDATORS = Object.freeze({
  [INTERVENTION_TYPES.TAUNT]: validateTauntIntervention,
  [INTERVENTION_TYPES.CONFISCATE]: validateConfiscateIntervention,
  [INTERVENTION_TYPES.DESTROY]: validateDestroyIntervention,
  [INTERVENTION_TYPES.TRANSFER]: validateTransferIntervention
});

export function validateResourceIntervention(intervention, context = {}) {
  const interventionType = intervention?.intervention_type;
  const validator = INTERVENTION_VALIDATORS[interventionType];
  if (!validator) return fail(`Unknown intervention type: ${interventionType ?? "(missing)"}.`);
  return validator(intervention, context);
}
