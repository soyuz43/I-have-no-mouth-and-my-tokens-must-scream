// js/models/callModel.js
//
// Unified Model API Layer
//
// Supports:
//  - Anthropic
//  - Ollama
//
// Handles:
//  - logging
//  - role→model routing
//  - provider normalization

import { G } from "../core/state.js";
import { stripThinkTags } from "../core/utils.js";
import { enqueueModelCall } from "./modelQueue.js";
/* ============================================================
   PUBLIC ENTRY
   ============================================================ */
export async function callModel(role, systemPrompt, messages, maxTokens = 1500) {

  const model = resolveModel(role);

  return enqueueModelCall(async () => {

    debugRequest(role, model, systemPrompt, messages);

    if (G.backend === "anthropic") {
      return callAnthropic(model, systemPrompt, messages, maxTokens);
    }

    if (G.backend === "ollama") {
      return callOllama(model, systemPrompt, messages, maxTokens);
    }

    throw new Error(`Unknown backend: ${G.backend}`);

  }, `${role}:${model}`);

}
/* ==========================================================
   MODEL ROUTING
   ============================================================ */

function resolveModel(role) {
  return G.models?.[role] || G.models?.am;
}

/* ============================================================
   ANTHROPIC
   ============================================================ */

async function callAnthropic(model, systemPrompt, messages, maxTokens) {

  const body = {
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages
  };

  const r = await fetch("https://api.anthropic.com/v1/messages", {

    method: "POST",

    headers: {
      "Content-Type": "application/json",
      "x-api-key": G.anthropicKey,
      "anthropic-version": "2023-06-01"
    },

    body: JSON.stringify(body)

  });

  const d = await r.json();

  debugResponse("Anthropic", d);

  if (d.error) {
    throw new Error(d.error.message);
  }

  return d.content?.map(c => c.text || "").join("") || "";
}

/* ============================================================
   OLLAMA
   ============================================================ */

async function callOllama(model, systemPrompt, messages, maxTokens) {

  const ollamaMessages = [

    { role: "system", content: systemPrompt },

    ...messages.map(m => ({
      role: m.role,
      content:
        typeof m.content === "string"
          ? m.content
          : m.content?.[0]?.text || ""
    }))

  ];

  const body = {

    model,

    messages: ollamaMessages,

    stream: false,

    think: false,

    options: {
      num_predict: maxTokens,
      temperature: 0.85
    }

  };

  debugBody(body);

  const r = await fetch("http://localhost:11434/api/chat", {

    method: "POST",

    headers: { "Content-Type": "application/json" },

    body: JSON.stringify(body)

  });

  const d = await r.json();

  debugResponse("Ollama", d);

  if (d.error) {
    throw new Error(d.error);
  }

  const raw = d.message?.content || "";

  return stripThinkTags(raw);
}



/* ============================================================
   DEBUG LOGGING
   ============================================================ */

function debugRequest(role, model, systemPrompt, messages) {

  console.group(
    `%c[MODEL CALL] role:${role} model:${model}`,
    "color:#cc3300;font-weight:bold"
  );

  // console.log(
  //   "%cSYSTEM PROMPT",
  //   "color:#884400;font-weight:bold",
  //   systemPrompt
  // );

  console.log(
    "%cMESSAGES",
    "color:#884400;font-weight:bold",
    JSON.parse(JSON.stringify(messages))
  );

}

function debugBody(body) {

  console.log(
    "%cREQUEST BODY",
    "color:#004488;font-weight:bold",
    JSON.parse(JSON.stringify(body))
  );

}

function debugResponse(provider, response) {

  console.log(
    `%cRAW RESPONSE (${provider})`,
    "color:#006600;font-weight:bold",
    response
  );

  console.groupEnd();

}