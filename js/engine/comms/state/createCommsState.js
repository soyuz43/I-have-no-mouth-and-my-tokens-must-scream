// js/engine/comms/state/createCommsState.js

/*
================================================================
COMMS STATE FACTORY

Creates per-cycle ephemeral state for the communication system.

CRITICAL DESIGN:
- State is FLAT for engine compatibility
- Some fields are ALSO grouped for organization
- All references point to the SAME underlying objects

================================================================
*/

export function createCommsState() {
  /* ============================================================
     SHARED OBJECTS (single source of truth)
  ============================================================ */

  const sentMessagesThisCycle = new Map();
  const replyTargetsThisCycle = new Map();

  const exchangeCount = new Map();
  const lastSenderToRecipient = {};

  const lastIntentByPair = {};
  const intentHistoryByPair = {};
  const negotiationFlags = {};

  const escalationLevel = {};
  const lastReplyByPair = {};

  /* ============================================================
     RETURN STATE
  ============================================================ */

  return {
    /* ---------------- GLOBAL ---------------- */

    counters: {
      messageCount: 0,
    },

    /* ---------------- CYCLE ---------------- */

    cycle: {
      activeThisCycle: new Set(),
    },

    /* ---------------- FLAT ACCESS (ENGINE USES THESE) ---------------- */

    sentMessagesThisCycle,
    replyTargetsThisCycle,

    lastSenderToRecipient,

    intentHistoryByPair,
    negotiationFlags,

    escalationLevel,
    lastReplyByPair,

    /* ---------------- GROUPED (OPTIONAL ORGANIZATION) ---------------- */

    exchanges: {
      exchangeCount,
      lastSenderToRecipient,
    },

    intent: {
      lastIntentByPair,
      intentHistoryByPair,
      negotiationFlags,
    },

    escalation: {
      escalationLevel,
    },

    reply: {
      lastReplyByPair,
    },
  };
}