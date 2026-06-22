// js/models/callModel.js
//
// Unified Model API Layer
//
// Supports:
//  - Anthropic
//  - Ollama
//  - Colab endpoint (OpenAI-compatible)
//
// Handles:
//  - role → model routing
//  - provider normalization
//  - queued model execution
//  - full prompt/response debug logging
//  - informative model-call identifiers

import { G } from "../core/state.js";
import { stripThinkTags } from "../core/utils.js";
import { enqueueModelCall } from "./modelQueue.js";

/* ============================================================
   MODEL CALL DEBUG HELPERS
   ============================================================ */

let modelCallSequence = 0;

/**
 * Convert provider-specific or structured message content
 * into a plain string for debug logging and non-Anthropic providers.
 */
function normalizeMessageContent(content) {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }

        if (
          part &&
          typeof part === "object" &&
          typeof part.text === "string"
        ) {
          return part.text;
        }

        try {
          return JSON.stringify(part);
        } catch {
          return String(part ?? "");
        }
      })
      .join("");
  }

  if (
    content &&
    typeof content === "object"
  ) {
    if (typeof content.text === "string") {
      return content.text;
    }

    try {
      return JSON.stringify(content);
    } catch {
      return String(content);
    }
  }

  if (content == null) {
    return "";
  }

  return String(content);
}

/**
 * Create detached message objects for logging so later mutation
 * does not make an old console entry appear to change.
 */
function normalizeMessagesForDebug(messages) {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages.map((message, index) => ({
    index,
    role: message?.role || "unknown",
    content: normalizeMessageContent(
      message?.content
    )
  }));
}

function createPreview(
  value,
  maxLength = 300
) {
  if (typeof value !== "string") {
    return "[non-string content]";
  }

  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}...`;
}

/**
 * Convert arbitrary names into readable, consistent call-ID parts.
 */
function normalizeCallLabel(value) {
  return String(value || "UNKNOWN")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, "_");
}

/**
 * Infer the kind of model task when the caller does not explicitly
 * provide metadata.purpose.
 */
function inferModelCallPurpose(
  role,
  systemPrompt,
  messages,
  metadata = {}
) {
  if (metadata?.purpose) {
    return normalizeCallLabel(
      metadata.purpose
    );
  }

  const normalizedRole =
    normalizeCallLabel(role);

  const systemText =
    String(systemPrompt || "")
      .toLowerCase();

  const messageText =
    (Array.isArray(messages)
      ? messages
      : []
    )
      .map((message) =>
        normalizeMessageContent(
          message?.content
        )
      )
      .join("\n")
      .toLowerCase();

  if (
    normalizedRole === "FORENSIC_STATS"
  ) {
    return "STATS";
  }

  if (
    messageText.includes(
      "generate strategic plan"
    )
  ) {
    return "PLANNING";
  }

  if (
    messageText.includes(
      "execute torment cycle"
    )
  ) {
    return "EXECUTION";
  }

  if (
    messageText.includes(
      "write your private journal entry"
    )
  ) {
    return "JOURNAL";
  }

  if (
    messageText.includes(
      "analyze and output json only"
    )
  ) {
    return "STRUCTURED_ANALYSIS";
  }

  if (
    systemText.includes(
      "deciding whether to reach out"
    )
  ) {
    return "OUTREACH";
  }

  if (
    messageText.includes(
      "says to you:"
    )
  ) {
    return "REPLY";
  }

  return "MODEL_CALL";
}

/**
 * Produce a readable correlation ID such as:
 *
 * C0-ELLEN-OUTREACH-CALL001
 * C1-TED-JOURNAL-CALL012
 * C1-FORENSIC_STATS-SUBJECT-NIMDOK-STATS-CALL013
 */
function makeModelCallContext(
  role,
  systemPrompt,
  messages,
  metadata = {}
) {
  modelCallSequence += 1;

  const cycle =
    Number.isFinite(G?.cycle)
      ? G.cycle
      : "NA";

  const normalizedRole =
    normalizeCallLabel(role);

  const purpose =
    inferModelCallPurpose(
      role,
      systemPrompt,
      messages,
      metadata
    );

  const subject =
    metadata?.subject
      ? normalizeCallLabel(
        metadata.subject
      )
      : null;

  const sequenceLabel =
    String(modelCallSequence)
      .padStart(3, "0");

  const idParts = [
    `C${cycle}`,
    normalizedRole,
    subject
      ? `SUBJECT-${subject}`
      : null,
    purpose,
    `CALL${sequenceLabel}`
  ].filter(Boolean);

  return {
    id: idParts.join("-"),
    cycle,
    role: normalizedRole,
    subject,
    purpose,
    sequence: modelCallSequence
  };
}

function getClockMilliseconds() {
  if (
    typeof performance !== "undefined" &&
    typeof performance.now === "function"
  ) {
    return performance.now();
  }

  return Date.now();
}

/* ============================================================
   PUBLIC ENTRY
   ============================================================ */

/**
 * Call the model assigned to a logical simulation role.
 *
 * @param {string} role
 *   Model-routing key such as AM, TED, ELLEN, or FORENSIC_STATS.
 *
 * @param {string} systemPrompt
 *   Complete system prompt.
 *
 * @param {Array} messages
 *   Provider-normalized conversation messages.
 *
 * @param {number} maxTokens
 *   Output-token limit. Explicit call-site values override the
 *   5000-token default.
 *
 * @param {Object} metadata
 *   Optional debug metadata:
 *   {
 *     purpose: "STATS",
 *     subject: "NIMDOK"
 *   }
 */
export async function callModel(
  role,
  systemPrompt,
  messages,
  maxTokens = 5000,
  metadata = {}
) {
  const model =
    resolveModel(role);

  const callContext =
    makeModelCallContext(
      role,
      systemPrompt,
      messages,
      metadata
    );

  return enqueueModelCall(
    async () => {
      const debugEnabled =
        Boolean(G?.DEBUG_PROMPTS);

      const normalizedMessages =
        normalizeMessagesForDebug(
          messages
        );

      const latestUserMessage =
        [...normalizedMessages]
          .reverse()
          .find(
            (message) =>
              message.role === "user"
          );

      const startTime =
        getClockMilliseconds();

      if (debugEnabled) {
        console.groupCollapsed(
          `[MODEL INPUT][DEBUG][${callContext.id}] ${role} → ${model}`
        );

        console.debug(
          "CALL CONTEXT:",
          {
            call_id:
              callContext.id,

            cycle:
              callContext.cycle,

            role:
              callContext.role,

            subject:
              callContext.subject,

            purpose:
              callContext.purpose,

            model,

            backend:
              G.backend,

            max_tokens:
              maxTokens,

            message_count:
              normalizedMessages.length,

            system_prompt_characters:
              typeof systemPrompt ===
                "string"
                ? systemPrompt.length
                : 0,

            message_characters:
              normalizedMessages.reduce(
                (
                  total,
                  message
                ) =>
                  total +
                  message.content.length,
                0
              ),

            system_preview:
              createPreview(
                systemPrompt
              ),

            latest_user_preview:
              createPreview(
                latestUserMessage
                  ?.content || ""
              ),

            metadata:
              { ...metadata }
          }
        );

        console.debug(
          "SYSTEM PROMPT:",
          systemPrompt
        );

        console.debug(
          "MESSAGES:",
          normalizedMessages
        );

        console.groupEnd();
      }

      try {
        let result;

        if (
          G.backend === "anthropic"
        ) {
          result =
            await callAnthropic(
              model,
              systemPrompt,
              messages,
              maxTokens
            );
        } else if (
          G.backend === "ollama"
        ) {
          result =
            await callOllama(
              model,
              systemPrompt,
              messages,
              maxTokens
            );
        } else if (
          G.backend === "colab"
        ) {
          result =
            await callColab(
              model,
              systemPrompt,
              messages,
              maxTokens
            );
        } else {
          throw new Error(
            `Unknown backend: ${G.backend}`
          );
        }

        const endTime =
          getClockMilliseconds();

        const durationMs =
          Math.round(
            (endTime - startTime) *
            100
          ) / 100;

        if (debugEnabled) {
          console.groupCollapsed(
            `[MODEL RESPONSE][DEBUG][${callContext.id}] ${role} ← ${model} (${durationMs} ms)`
          );

          console.debug(
            "RESPONSE CONTEXT:",
            {
              call_id:
                callContext.id,

              cycle:
                callContext.cycle,

              role:
                callContext.role,

              subject:
                callContext.subject,

              purpose:
                callContext.purpose,

              model,

              backend:
                G.backend,

              duration_ms:
                durationMs,

              raw_characters:
                result.raw.length,

              cleaned_characters:
                result.cleaned.length,

              response_was_cleaned:
                result.raw !==
                result.cleaned
            }
          );

          console.debug(
            "RAW MODEL RESPONSE:",
            result.raw
          );

          if (
            result.cleaned !==
            result.raw
          ) {
            console.debug(
              "CLEANED MODEL RESPONSE:",
              result.cleaned
            );
          }

          console.debug(
            "RAW PROVIDER RESPONSE:",
            result.providerResponse
          );

          console.groupEnd();
        }

        return result.cleaned;
      } catch (error) {
        const endTime =
          getClockMilliseconds();

        const durationMs =
          Math.round(
            (endTime - startTime) *
            100
          ) / 100;

        console.group(
          `[MODEL ERROR][${callContext.id}] ${role} → ${model}`
        );

        console.error({
          call_id:
            callContext.id,

          cycle:
            callContext.cycle,

          role:
            callContext.role,

          subject:
            callContext.subject,

          purpose:
            callContext.purpose,

          model,

          backend:
            G.backend,

          duration_ms:
            durationMs,

          error
        });

        console.groupEnd();

        throw error;
      }
    },
    `${callContext.id}:${model}`
  );
}

/* ============================================================
   MODEL ROUTING
   ============================================================ */

function resolveModel(role) {
  return (
    G.models?.[role] ||
    G.models?.am
  );
}

/* ============================================================
   ANTHROPIC
   ============================================================ */

async function callAnthropic(
  model,
  systemPrompt,
  messages,
  maxTokens
) {
  const body = {
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages
  };

  const response = await fetch(
    "https://api.anthropic.com/v1/messages",
    {
      method: "POST",

      headers: {
        "Content-Type":
          "application/json",

        "x-api-key":
          G.anthropicKey,

        "anthropic-version":
          "2023-06-01"
      },

      body:
        JSON.stringify(body)
    }
  );

  let data;

  try {
    data =
      await response.json();
  } catch {
    throw new Error(
      `Anthropic returned non-JSON data with HTTP ${response.status}.`
    );
  }

  if (
    !response.ok ||
    data?.error
  ) {
    throw new Error(
      data?.error?.message ||
      `Anthropic request failed with HTTP ${response.status}.`
    );
  }

  const raw =
    data.content
      ?.map((contentBlock) => {
        if (
          typeof contentBlock?.text ===
          "string"
        ) {
          return contentBlock.text;
        }

        return "";
      })
      .join("") || "";

  return {
    raw,
    cleaned: raw,
    providerResponse: data
  };
}

/* ============================================================
   OLLAMA
   ============================================================ */

async function callOllama(
  model,
  systemPrompt,
  messages,
  maxTokens
) {
  const normalizedMessages =
    Array.isArray(messages)
      ? messages
      : [];

  const ollamaMessages = [
    {
      role: "system",
      content:
        typeof systemPrompt ===
          "string"
          ? systemPrompt
          : String(
            systemPrompt ?? ""
          )
    },

    ...normalizedMessages.map(
      (message) => ({
        role:
          message?.role ||
          "user",

        content:
          normalizeMessageContent(
            message?.content
          )
      })
    )
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

  const response = await fetch(
    "http://localhost:11434/api/chat",
    {
      method: "POST",

      headers: {
        "Content-Type":
          "application/json"
      },

      body:
        JSON.stringify(body)
    }
  );

  let data;

  try {
    data =
      await response.json();
  } catch {
    throw new Error(
      `Ollama returned non-JSON data with HTTP ${response.status}.`
    );
  }

  if (
    !response.ok ||
    data?.error
  ) {
    throw new Error(
      data?.error ||
      `Ollama request failed with HTTP ${response.status}.`
    );
  }

  if (
    !data.message ||
    typeof data.message.content !==
    "string"
  ) {
    console.warn(
      "[OLLAMA WARNING] Invalid response shape",
      data
    );
  }

  const raw =
    data.message?.content || "";

  const cleaned =
    stripThinkTags(raw);

  return {
    raw,
    cleaned,
    providerResponse: data
  };
}

/* ============================================================
   COLAB
   OpenAI-compatible remote inference endpoint
   ============================================================ */

async function callColab(
  model,
  systemPrompt,
  messages,
  maxTokens
) {
  const endpoint =
    String(
      G.colabEndpoint || ""
    )
      .trim()
      .replace(/\/+$/, "");

  const bearerToken =
    String(
      G.colabBearerToken || ""
    ).trim();

  if (!endpoint) {
    throw new Error(
      "Colab endpoint is not configured."
    );
  }

  if (
    !/^https?:\/\//i.test(endpoint)
  ) {
    throw new Error(
      "Colab endpoint must begin with http:// or https://."
    );
  }

  if (!bearerToken) {
    throw new Error(
      "Colab bearer token is not configured."
    );
  }

  const normalizedMessages =
    Array.isArray(messages)
      ? messages
      : [];

  const colabMessages = [
    {
      role: "system",

      content:
        typeof systemPrompt ===
          "string"
          ? systemPrompt
          : String(
            systemPrompt ?? ""
          )
    },

    ...normalizedMessages.map(
      (message) => ({
        role:
          message?.role ||
          "user",

        content:
          normalizeMessageContent(
            message?.content
          )
      })
    )
  ];

  const body = {
    model,
    messages: colabMessages,
    max_tokens: maxTokens,
    temperature: 0.85,
    stream: false
  };

  const timeoutMs =
    Number.isFinite(
      G.colabRequestTimeoutMs
    ) &&
      G.colabRequestTimeoutMs > 0
      ? G.colabRequestTimeoutMs
      : 15 * 60 * 1000;

  const controller =
    new AbortController();

  const timeoutId =
    setTimeout(
      () => controller.abort(),
      timeoutMs
    );

  let response;
  let responseText;

  try {
    response = await fetch(
      `${endpoint}/v1/chat/completions`,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",

          Accept:
            "application/json",

          Authorization:
            `Bearer ${bearerToken}`
        },

        body:
          JSON.stringify(body),

        signal:
          controller.signal
      }
    );

    responseText =
      await response.text();
  } catch (error) {
    if (
      error?.name === "AbortError"
    ) {
      throw new Error(
        `Colab inference timed out after ${Math.round(timeoutMs / 60000)} minutes.`
      );
    }

    throw new Error(
      `Colab inference endpoint could not be reached: ${error?.message ||
      String(error)
      }`
    );
  } finally {
    clearTimeout(timeoutId);
  }

  let data = null;

  if (responseText) {
    try {
      data =
        JSON.parse(responseText);
    } catch {
      data = null;
    }
  }

  const providerError =
    data?.error?.message ??
    data?.error ??
    data?.detail ??
    data?.message ??
    responseText;

  const providerMessage =
    typeof providerError ===
      "string"
      ? providerError.trim()
      : providerError != null
        ? JSON.stringify(
          providerError
        )
        : "";

  const errorDetail =
    providerMessage
      ? `: ${createPreview(
        providerMessage,
        500
      )}`
      : "";

  if (
    response.status === 401 ||
    response.status === 403
  ) {
    throw new Error(
      `Colab authentication failed with HTTP ${response.status}${errorDetail}`
    );
  }

  if (!response.ok) {
    throw new Error(
      `Colab request failed with HTTP ${response.status}${errorDetail}`
    );
  }

  if (
    !data ||
    typeof data !== "object"
  ) {
    throw new Error(
      `Colab returned non-JSON data with HTTP ${response.status}.`
    );
  }

  if (data?.error) {
    throw new Error(
      providerMessage ||
      "Colab returned an unspecified provider error."
    );
  }

  const responseContent =
    data?.choices?.[0]
      ?.message?.content;

  if (
    responseContent == null
  ) {
    console.warn(
      "[COLAB WARNING] Invalid response shape",
      data
    );

    throw new Error(
      "Colab returned an invalid OpenAI-compatible response shape."
    );
  }

  const raw =
    normalizeMessageContent(
      responseContent
    );

  const cleaned =
    stripThinkTags(raw);

  return {
    raw,
    cleaned,
    providerResponse: data
  };
}