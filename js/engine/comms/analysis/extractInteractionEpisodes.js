// js/engine/comms/analysis/extractInteractionEpisodes.js

import { G } from "../../../core/state.js";

/*
============================================================
BUILD INTERACTION EPISODES FROM interSimLog

We use:
- same participants
- same cycle
- sequential grouping

This is intentionally SIMPLE and stable.
============================================================
*/

export function buildEpisodes(cycle) {
  const messages = G.interSimLog.filter(m => m.cycle === cycle);

  const episodes = [];
  let current = [];

  for (const msg of messages) {
    if (!current.length) {
      current.push(msg);
      continue;
    }

    const last = current[current.length - 1];

    const overlap =
      msg.from === last.from ||
      msg.to?.includes(last.from) ||
      last.to?.includes(msg.from) ||
      msg.to?.some(t => Array.isArray(last.to) && last.to.includes(t));

    if (overlap) {
      current.push(msg);
    } else {
      episodes.push(current);
      current = [msg];
    }
  }

  if (current.length) episodes.push(current);

  return episodes;
}

/*
============================================================
FILTER EPISODES RELEVANT TO A SIM

Includes:
- direct participation
- overheard participation
============================================================
*/

export function getEpisodesForSim(simId, episodes) {
  return episodes.filter(ep =>
    ep.some(msg =>
      msg.from === simId ||
      msg.to?.includes(simId)
    )
  );
}