// js/models/callModel.js
//
// Unified Model API Layer
//
// Supports:
//  - Anthropic
//  - Ollama
//
// Handles:
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

    // ========================================================================
    // DEBUG: Log prompts sent to model (optional, guarded by debug flag)
    // ========================================================================
    if (globalThis?.G?.DEBUG_PROMPTS) {
      const userContent = messages?.[0]?.content || "";
      const userPreview = typeof userContent === "string" 
        ? userContent.slice(0, 300) + (userContent.length > 300 ? "..." : "")
        : "[non-string content]";
      
      const systemPreview = typeof systemPrompt === "string"
        ? systemPrompt.slice(0, 300) + (systemPrompt.length > 300 ? "..." : "")
        : "[non-string system]";
      
      console.debug("[PROMPT][DEBUG]", {
        role,
        model,
        backend: G.backend,
        system_preview: systemPreview,
        user_preview: userPreview,
        max_tokens: maxTokens,
        message_count: messages?.length || 0
      });
    }
    // ========================================================================

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
      num_ctx: 10240,
      num_predict: maxTokens,
      temperature: 0.85
    }
  };

  const r = await fetch("http://localhost:11434/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  const d = await r.json();

  if (!d.message || typeof d.message.content !== "string") {
    console.warn(
      "[OLLAMA WARNING] Invalid response shape",
      d
    );
  }

  const raw = d.message?.content || "";
  const cleaned = stripThinkTags(raw);

  if (d.error) {
    throw new Error(d.error);
  }

  return cleaned;
}