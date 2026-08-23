// js/engine/social/coalitionDetection.js

import { SIM_IDS } from "../../core/constants.js";

export const COALITION_CONFIG = Object.freeze({
  threshold: 0.3,
  minSize: 2
});

function isFiniteTrust(value) {
  return Number.isFinite(value);
}

function findRoot(parent, id) {
  let root = id;
  while (parent.get(root) !== root) {
    root = parent.get(root);
  }

  let current = id;
  while (parent.get(current) !== current) {
    const next = parent.get(current);
    parent.set(current, root);
    current = next;
  }

  return root;
}

function union(parent, a, b) {
  const rootA = findRoot(parent, a);
  const rootB = findRoot(parent, b);

  if (rootA === rootB) return;

  parent.set(rootB, rootA);
}

export function detectCoalitions(sims, config = COALITION_CONFIG) {
  if (!sims || typeof sims !== "object") {
    return [];
  }

  if (
    !Number.isFinite(config?.threshold) ||
    !Number.isInteger(config?.minSize) ||
    config.minSize < 2
  ) {
    return [];
  }

  const parent = new Map();
  for (const id of SIM_IDS) {
    parent.set(id, id);
  }

  for (const fromId of SIM_IDS) {
    const relationships = sims[fromId]?.relationships;
    if (!relationships || typeof relationships !== "object") continue;

    for (const toId of SIM_IDS) {
      if (fromId === toId) continue;

      const trust = relationships[toId];
      if (!isFiniteTrust(trust) || trust < config.threshold) continue;

      union(parent, fromId, toId);
    }
  }

  const components = new Map();
  for (const id of SIM_IDS) {
    const root = findRoot(parent, id);
    if (!components.has(root)) {
      components.set(root, []);
    }
    components.get(root).push(id);
  }

  const coalitions = [];
  for (const members of components.values()) {
    if (members.length < config.minSize) continue;

    const edges = [];
    for (const fromId of members) {
      for (const toId of members) {
        if (fromId === toId) continue;

        const trust = sims[fromId]?.relationships?.[toId];
        edges.push({
          from: fromId,
          to: toId,
          trust: isFiniteTrust(trust) ? trust : null
        });
      }
    }

    coalitions.push({ members, edges });
  }

  return coalitions.sort((a, b) =>
    SIM_IDS.indexOf(a.members[0]) - SIM_IDS.indexOf(b.members[0])
  );
}