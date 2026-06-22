// js/engine/comms/social/overhearing.js

import { G } from "../../../core/state.js";
import { SIM_IDS } from "../../../core/constants.js";
import { addLog } from "../../../ui/logs.js";

import { applyOverheardEffect } from "../../relationships.js";

/* ============================================================
   OVERHEARING LEDGER
============================================================ */

function ensureOverhearingLedger() {
  if (
    !G.overhearing ||
    typeof G.overhearing !== "object"
  ) {
    G.overhearing = {
      history: [],
      lastCycle: [],
      nextEventSequence: 1,
    };
  }

  if (
    !Array.isArray(
      G.overhearing.history
    )
  ) {
    G.overhearing.history = [];
  }

  if (
    !Array.isArray(
      G.overhearing.lastCycle
    )
  ) {
    G.overhearing.lastCycle = [];
  }

  if (
    !Number.isSafeInteger(
      G.overhearing.nextEventSequence
    ) ||
    G.overhearing.nextEventSequence < 1
  ) {
    const highestExistingSequence =
      G.overhearing.history.reduce(
        (highest, event) =>
          Number.isSafeInteger(
            event?.sequence
          )
            ? Math.max(
                highest,
                event.sequence
              )
            : highest,
        0
      );

    G.overhearing.nextEventSequence =
      highestExistingSequence + 1;
  }

  return G.overhearing;
}

function normalizeSourceMessage(
  sourceMessage
) {
  if (
    !sourceMessage ||
    typeof sourceMessage !== "object" ||
    Array.isArray(sourceMessage)
  ) {
    return null;
  }

  const from =
    String(
      sourceMessage.from ?? ""
    )
      .trim()
      .toUpperCase();

  const recipients =
    Array.isArray(sourceMessage.to)
      ? sourceMessage.to
      : sourceMessage.to
        ? [sourceMessage.to]
        : [];

  const to =
    String(
      recipients[0] ?? ""
    )
      .trim()
      .toUpperCase();

  const messageId =
    String(
      sourceMessage.messageId ?? ""
    ).trim();

  const sequence =
    Number(
      sourceMessage.sequence
    );

  if (
    !SIM_IDS.includes(from) ||
    !SIM_IDS.includes(to) ||
    !messageId ||
    !Number.isSafeInteger(sequence) ||
    sequence < 1
  ) {
    return null;
  }

  return {
    messageId,
    sequence,

    cycle:
      Number.isInteger(
        sourceMessage.cycle
      )
        ? sourceMessage.cycle
        : Number.isInteger(G.cycle)
          ? G.cycle
          : 0,

    kind:
      String(
        sourceMessage.kind ??
        "MESSAGE"
      )
        .trim()
        .toUpperCase(),

    from,
    to,

    text:
      String(
        sourceMessage.text ?? ""
      ),

    visibility:
      String(
        sourceMessage.visibility ??
        ""
      )
        .trim()
        .toLowerCase(),
  };
}

/* ============================================================
   CANONICAL OVERHEARING EVENT CREATION
============================================================ */

export function recordOverheard({
  listener,
  sourceMessage,
  outcome,
  perception,
  perceivedText = null,
  characterRange = null,
}) {
  const listenerId =
    String(listener ?? "")
      .trim()
      .toUpperCase();

  const listenerSim =
    G.sims?.[listenerId];

  const source =
    normalizeSourceMessage(
      sourceMessage
    );

  if (
    !listenerSim ||
    !source
  ) {
    return null;
  }

  const ledger =
    ensureOverhearingLedger();

  const sequence =
    ledger.nextEventSequence++;

  const createdAt =
    Date.now();

  const event = {
    eventId:
      `C${source.cycle}-O${String(sequence).padStart(6, "0")}`,

    sequence,
    cycle:
      source.cycle,

    listener:
      listenerId,

    participants: {
      from:
        source.from,

      to:
        source.to,
    },

    outcome,

    sourceMessageIds: [
      source.messageId,
    ],

    observations: [
      {
        sourceMessageId:
          source.messageId,

        sourceMessageSequence:
          source.sequence,

        perception,

        text:
          perceivedText,

        characterRange:
          characterRange
            ? {
                start:
                  characterRange.start,

                end:
                  characterRange.end,
              }
            : null,
      },
    ],

    sourceKind:
      source.kind,

    sourceVisibility:
      source.visibility,

    createdAt,
  };

  ledger.history.push(event);
  ledger.lastCycle.push(event);

  /*
   * Compatibility memory:
   *
   * Existing journals, reply prompts, rumor propagation, reactive
   * handling, and relationship effects still read sim.overheard.
   * Keep the old fields while attaching canonical provenance.
   */
  if (
    !Array.isArray(
      listenerSim.overheard
    )
  ) {
    listenerSim.overheard = [];
  }

  const compatibilityText =
    outcome === "observed_only"
      ? "(whispering observed)"
      : String(
          perceivedText ?? ""
        );

  listenerSim.overheard.push({
    eventId:
      event.eventId,

    sourceMessageId:
      source.messageId,

    sourceMessageSequence:
      source.sequence,

    outcome,
    perception,

    from:
      source.from,

    to:
      source.to,

    text:
      compatibilityText,

    cycle:
      source.cycle,

    timestamp:
      createdAt,
  });

  if (
    listenerSim.overheard.length >
    20
  ) {
    listenerSim.overheard.shift();
  }

  applyOverheardEffect(
    listenerId,
    source.from,
    source.to,
    compatibilityText
  );

  return event;
}

/* ============================================================
   RECEIVED MESSAGE MEMORY
============================================================ */

export function recordReceived(
  simId,
  fromId,
  text
) {
  const sim =
    G.sims[simId];

  if (!sim) return;

  if (!sim.received) {
    sim.received = [];
  }

  sim.received.push({
    from:
      fromId,

    text,

    cycle:
      G.cycle,

    timestamp:
      Date.now(),
  });

  if (
    sim.received.length > 20
  ) {
    sim.received.shift();
  }
}

/* ============================================================
   SOCIAL OVERHEARING MODEL
============================================================ */

export function maybeOverhear(
  sourceMessage
) {
  const source =
    normalizeSourceMessage(
      sourceMessage
    );

  if (
    !source ||
    source.visibility !== "private"
  ) {
    return null;
  }

  const {
    from: fromId,
    to: toId,
    text: message,
  } = source;

  const leak =
    G.privateLeak || {
      full: 0.04,
      fragment: 0.12,
      seen: 0.32,
    };

  const others =
    SIM_IDS.filter(
      (id) =>
        id !== fromId &&
        id !== toId
    );

  if (!others.length) {
    return null;
  }

  /* ------------------------------------------------------------
     SELECT MOST LIKELY LISTENER
  ------------------------------------------------------------ */

  let bestListener = null;
  let bestScore = -Infinity;

  for (const id of others) {
    const sim =
      G.sims[id];

    if (!sim) continue;

    const relToFrom =
      sim.relationships?.[fromId] ??
      0;

    const relToTo =
      sim.relationships?.[toId] ??
      0;

    const closeness =
      (relToFrom + relToTo) /
      200;

    const paranoia =
      1 -
      (
        sim.beliefs
          ?.others_trustworthy ??
        0.5
      );

    const attention =
      (sim.sanity ?? 50) /
      100;

    const score =
      closeness * 0.5 +
      paranoia * 0.3 +
      attention * 0.2 +
      Math.random() * 0.2;

    if (score > bestScore) {
      bestScore = score;
      bestListener = id;
    }
  }

  if (!bestListener) {
    return null;
  }

  const listener =
    bestListener;

  /* ------------------------------------------------------------
     ADJUSTED PROBABILITY
  ------------------------------------------------------------ */

  const listenerSim =
    G.sims[listener];

  const paranoia =
    1 -
    (
      listenerSim.beliefs
        ?.others_trustworthy ??
      0.5
    );

  const attention =
    (listenerSim.sanity ?? 50) /
    100;

  const modifier =
    0.6 +
    paranoia * 0.3 +
    attention * 0.1;

  const roll =
    Math.random() /
    modifier;

  /* ------------------------------------------------------------
     FULL MESSAGE
  ------------------------------------------------------------ */

  if (roll < leak.full) {
    addLog(
      `OVERHEARD ${listener} // ${fromId}→${toId}`,
      `"${message}"`,
      "whisper"
    );

    return recordOverheard({
      listener,
      sourceMessage:
        source,

      outcome:
        "full",

      perception:
        "full",

      perceivedText:
        message,

      characterRange: {
        start: 0,
        end:
          message.length,
      },
    });
  }

  /* ------------------------------------------------------------
     MESSAGE FRAGMENT
  ------------------------------------------------------------ */

  if (
    roll <
    leak.full +
    leak.fragment
  ) {
    const requestedLength =
      Math.floor(
        Math.random() * 50
      ) + 20;

    const fragmentLength =
      Math.min(
        requestedLength,
        message.length
      );

    const regionRoll =
      Math.random();

    let perception;
    let start;

    if (regionRoll < 0.25) {
      perception =
        "head_fragment";

      start = 0;
    } else if (
      regionRoll < 0.8125
    ) {
      perception =
        "middle_fragment";

      start =
        Math.floor(
          Math.random() *
          Math.max(
            1,
            message.length -
            fragmentLength
          )
        );
    } else {
      perception =
        "tail_fragment";

      start =
        Math.max(
          0,
          message.length -
          fragmentLength
        );
    }

    const end =
      Math.min(
        message.length,
        start +
        fragmentLength
      );

    const fragmentBody =
      message
        .slice(start, end)
        .trim()
        .replace(
          /^[^a-zA-Z0-9]+/,
          ""
        );

    let fragment;

    if (
      perception ===
      "head_fragment"
    ) {
      fragment =
        `${fragmentBody}...`;
    } else if (
      perception ===
      "tail_fragment"
    ) {
      fragment =
        `...${fragmentBody}`;
    } else {
      fragment =
        `...${fragmentBody}...`;
    }

    addLog(
      `OVERHEARD ${listener} // ${fromId}→${toId}`,
      `"${fragment}"`,
      "whisper"
    );

    return recordOverheard({
      listener,
      sourceMessage:
        source,

      outcome:
        "fragment",

      perception,

      perceivedText:
        fragment,

      characterRange: {
        start,
        end,
      },
    });
  }

  /* ------------------------------------------------------------
     CONVERSATION OBSERVED, NO WORDS HEARD
  ------------------------------------------------------------ */

  if (
    roll <
    leak.full +
    leak.fragment +
    leak.seen
  ) {
    addLog(
      `NOTICE ${listener}`,
      `${fromId} and ${toId} were seen whispering.`,
      "whisper"
    );

    return recordOverheard({
      listener,
      sourceMessage:
        source,

      outcome:
        "observed_only",

      perception:
        "observed_only",

      perceivedText:
        null,

      characterRange:
        null,
    });
  }

  return null;
}