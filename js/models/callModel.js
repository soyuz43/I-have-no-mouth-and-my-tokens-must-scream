// js/models/callModel.js
//
// Unified Model API Layer
//
// Supports:
//   - Anthropic Messages API
//   - Ollama native chat API
//   - OpenAI-compatible Chat Completions APIs
//   - Existing Colab endpoint configuration
//
// Architecture:
//   role -> model
//   backend -> protocol adapter
//
// Backward-compatible backend values:
//   - "anthropic"
//   - "ollama"
//   - "colab"
//
// Additional backend values:
//   - "openai"
//   - "openai-compatible"
//
// OpenAI-compatible configuration:
//
//   G.openAICompatibleEndpoint
//   G.openAICompatibleApiKey
//   G.openAICompatibleRequestTimeoutMs
//   G.openAICompatibleRequireApiKey
//   G.openAICompatibleTemperature
//
// Existing Colab configuration remains supported:
//
//   G.colabEndpoint
//   G.colabBearerToken
//   G.colabRequestTimeoutMs

import { G } from "../core/state.js";
import { stripThinkTags } from "../core/utils.js";
import { enqueueModelCall } from "./modelQueue.js";

/* ============================================================
   CONSTANTS
   ============================================================ */

const DEFAULT_MAX_TOKENS = 5000;
const DEFAULT_TEMPERATURE = 0.85;

const DEFAULT_REMOTE_TIMEOUT_MS =
  2 * 60 * 1000;

const DEFAULT_LONG_RUNNING_TIMEOUT_MS =
  15 * 60 * 1000;

/* ============================================================
   MODEL CALL DEBUG HELPERS
   ============================================================ */

let modelCallSequence = 0;

/**
 * Convert provider-specific or structured message content into
 * a plain string for logging and text-only providers.
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

function createModelOutputError(message, details = {}) {
  const error = new Error(message);

  error.name = "ModelOutputError";
  error.code =
    details.code ||
    "model_response_unusable";

  error.details = details;

  return error;
}

function validateModelTextResult({
  raw,
  cleaned,
  result,
  route,
  callContext,
}) {
  const rawText =
    typeof raw === "string"
      ? raw
      : "";

  const cleanedText =
    typeof cleaned === "string"
      ? cleaned
      : "";

  const providerResponse =
    result?.providerResponse &&
      typeof result.providerResponse === "object"
      ? result.providerResponse
      : {};

  const doneReason =
    providerResponse.done_reason ??
    providerResponse.doneReason ??
    providerResponse.stop_reason ??
    providerResponse.choices?.[0]?.finish_reason ??
    null;

  const outputTokenCount =
    Number(
      providerResponse.eval_count ??
      providerResponse.usage?.completion_tokens ??
      providerResponse.completion_tokens
    );

  const promptTokenCount =
    Number(
      providerResponse.prompt_eval_count ??
      providerResponse.usage?.prompt_tokens ??
      providerResponse.prompt_tokens
    );

  if (!rawText.trim()) {
    throw createModelOutputError(
      `${route.provider} returned an empty model response.`,
      {
        code: "model_response_empty",
        call_id: callContext.id,
        provider: route.provider,
        backend: route.backend,
        adapter: route.adapter,
        model: route.model,
        doneReason,
        promptTokenCount,
        outputTokenCount,
      }
    );
  }

  if (!cleanedText.trim()) {
    throw createModelOutputError(
      `${route.provider} returned no usable text after cleaning.`,
      {
        code: "model_response_empty_after_cleaning",
        call_id: callContext.id,
        provider: route.provider,
        backend: route.backend,
        adapter: route.adapter,
        model: route.model,
        doneReason,
        promptTokenCount,
        outputTokenCount,
        rawPreview:
          rawText.slice(0, 200),
      }
    );
  }

  const stoppedForLength =
    doneReason === "length" ||
    doneReason === "max_tokens";

  const generatedAlmostNothing =
    Number.isFinite(outputTokenCount) &&
    outputTokenCount <= 2;

  if (
    stoppedForLength &&
    (
      generatedAlmostNothing ||
      cleanedText.trim().length <= 8
    )
  ) {
    throw createModelOutputError(
      `${route.provider} stopped for length after producing almost no usable output.`,
      {
        code: "model_response_truncated",
        call_id: callContext.id,
        provider: route.provider,
        backend: route.backend,
        adapter: route.adapter,
        model: route.model,
        doneReason,
        promptTokenCount,
        outputTokenCount,
        rawPreview:
          rawText.slice(0, 200),
        cleanedPreview:
          cleanedText.slice(0, 200),
      }
    );
  }
}

/**
 * Snapshot messages when callModel() is invoked.
 *
 * Model calls may wait in a queue. Taking a snapshot prevents
 * later caller mutations from changing the queued request or
 * making its debug output misrepresent what was submitted.
 */
function snapshotMessages(messages) {
  if (!Array.isArray(messages)) {
    return [];
  }

  if (
    typeof structuredClone === "function"
  ) {
    try {
      return structuredClone(messages);
    } catch {
      // Fall through to a conservative manual copy.
    }
  }

  return messages.map((message) => {
    if (
      !message ||
      typeof message !== "object"
    ) {
      return message;
    }

    let content =
      message.content;

    if (Array.isArray(content)) {
      content = content.map((part) => {
        if (
          part &&
          typeof part === "object"
        ) {
          return { ...part };
        }

        return part;
      });
    } else if (
      content &&
      typeof content === "object"
    ) {
      content = { ...content };
    }

    return {
      ...message,
      content
    };
  });
}

/**
 * Create detached, text-normalized message objects for logging.
 */
function normalizeMessagesForDebug(messages) {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages.map(
    (message, index) => ({
      index,

      role:
        message?.role ||
        "unknown",

      content:
        normalizeMessageContent(
          message?.content
        )
    })
  );
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
 * Convert arbitrary names into readable call-ID components.
 */
function normalizeCallLabel(value) {
  return String(value || "UNKNOWN")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, "_");
}

/**
 * Infer the kind of model task when metadata.purpose is omitted.
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
    normalizedRole ===
    "FORENSIC_STATS"
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
    id:
      idParts.join("-"),

    cycle,

    role:
      normalizedRole,

    subject,
    purpose,

    sequence:
      modelCallSequence
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

function calculateDurationMs(startTime) {
  return (
    Math.round(
      (
        getClockMilliseconds() -
        startTime
      ) * 100
    ) / 100
  );
}

/* ============================================================
   GENERAL HELPERS
   ============================================================ */

function firstDefined(...values) {
  return values.find(
    (value) =>
      value !== undefined &&
      value !== null
  );
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    const normalized =
      String(value ?? "").trim();

    if (normalized) {
      return normalized;
    }
  }

  return "";
}

function normalizePositiveNumber(
  value,
  fallback
) {
  return (
    Number.isFinite(value) &&
    value > 0
  )
    ? value
    : fallback;
}

function normalizeMaxTokens(value) {
  return Math.max(
    1,

    Math.floor(
      normalizePositiveNumber(
        value,
        DEFAULT_MAX_TOKENS
      )
    )
  );
}

function normalizeBackendName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");
}

function parseJsonSafely(value) {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeProviderError(value) {
  if (typeof value === "string") {
    return value.trim();
  }

  if (value == null) {
    return "";
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function extractProviderError(
  data,
  responseText
) {
  return normalizeProviderError(
    data?.error?.message ??
    data?.error ??
    data?.detail ??
    data?.message ??
    responseText
  );
}

function createProviderErrorDetail(
  data,
  responseText
) {
  const message =
    extractProviderError(
      data,
      responseText
    );

  if (!message) {
    return "";
  }

  return `: ${createPreview(
    message,
    500
  )}`;
}

function formatTimeout(timeoutMs) {
  if (timeoutMs >= 60_000) {
    const minutes =
      Math.round(
        timeoutMs / 60_000
      );

    return `${minutes} minute${minutes === 1
        ? ""
        : "s"
      }`;
  }

  const seconds =
    Math.max(
      1,
      Math.round(timeoutMs / 1000)
    );

  return `${seconds} second${seconds === 1
      ? ""
      : "s"
    }`;
}

/**
 * Validate a service URL without assuming a specific provider.
 */
function parseServiceUrl(
  value,
  label
) {
  const raw =
    String(value || "").trim();

  if (!raw) {
    throw new Error(
      `${label} is not configured.`
    );
  }

  let url;

  try {
    url = new URL(raw);
  } catch {
    throw new Error(
      `${label} is not a valid URL.`
    );
  }

  if (
    url.protocol !== "http:" &&
    url.protocol !== "https:"
  ) {
    throw new Error(
      `${label} must use HTTP or HTTPS.`
    );
  }

  if (
    url.username ||
    url.password
  ) {
    throw new Error(
      `${label} must not contain embedded credentials.`
    );
  }

  if (
    url.search ||
    url.hash
  ) {
    throw new Error(
      `${label} must not contain a query string or fragment.`
    );
  }

  return url;
}

/**
 * Accept any of:
 *
 * https://api.example.com
 * https://api.example.com/v1
 * https://api.example.com/v1/chat/completions
 */
function buildChatCompletionsUrl(value) {
  const url =
    parseServiceUrl(
      value,
      "OpenAI-compatible endpoint"
    );

  const path =
    url.pathname.replace(/\/+$/, "");

  if (
    /\/chat\/completions$/i.test(path)
  ) {
    url.pathname = path;
  } else if (
    /\/v1$/i.test(path)
  ) {
    url.pathname =
      `${path}/chat/completions`;
  } else {
    url.pathname =
      `${path}/v1/chat/completions`;
  }

  return url.toString();
}

/**
 * Accept any of:
 *
 * https://api.anthropic.com
 * https://api.anthropic.com/v1
 * https://api.anthropic.com/v1/messages
 */
function buildAnthropicMessagesUrl(value) {
  const url =
    parseServiceUrl(
      value,
      "Anthropic endpoint"
    );

  const path =
    url.pathname.replace(/\/+$/, "");

  if (
    /\/v1\/messages$/i.test(path)
  ) {
    url.pathname = path;
  } else if (
    /\/v1$/i.test(path)
  ) {
    url.pathname =
      `${path}/messages`;
  } else {
    url.pathname =
      `${path}/v1/messages`;
  }

  return url.toString();
}

/**
 * Accept any of:
 *
 * http://localhost:11434
 * http://localhost:11434/api
 * http://localhost:11434/api/chat
 */
function buildOllamaChatUrl(value) {
  const url =
    parseServiceUrl(
      value,
      "Ollama endpoint"
    );

  const path =
    url.pathname.replace(/\/+$/, "");

  if (
    /\/api\/chat$/i.test(path)
  ) {
    url.pathname = path;
  } else if (
    /\/api$/i.test(path)
  ) {
    url.pathname =
      `${path}/chat`;
  } else {
    url.pathname =
      `${path}/api/chat`;
  }

  return url.toString();
}

/**
 * Execute a JSON request with timeout and network-error handling.
 *
 * The response body is read as text first so provider errors and
 * invalid JSON responses can be reported accurately.
 */
async function postJson({
  url,
  headers,
  body,
  timeoutMs,
  requestLabel
}) {
  const controller =
    new AbortController();

  const timeoutId =
    setTimeout(
      () => controller.abort(),
      timeoutMs
    );

  try {
    const response =
      await fetch(url, {
        method: "POST",
        headers,

        body:
          JSON.stringify(body),

        signal:
          controller.signal
      });

    const responseText =
      await response.text();

    return {
      response,
      responseText,

      data:
        parseJsonSafely(
          responseText
        )
    };
  } catch (error) {
    if (
      error?.name ===
      "AbortError"
    ) {
      throw new Error(
        `${requestLabel} timed out after ${formatTimeout(timeoutMs)}.`
      );
    }

    throw new Error(
      `${requestLabel} could not be completed: ${error?.message ||
      String(error)
      }`
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

function normalizeTextMessages(messages) {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages.map((message) => {
    const normalizedMessage = {
      role:
        message?.role ||
        "user",

      content:
        normalizeMessageContent(
          message?.content
        )
    };

    if (
      typeof message?.name === "string" &&
      message.name.trim()
    ) {
      normalizedMessage.name =
        message.name;
    }

    return normalizedMessage;
  });
}

/* ============================================================
   MODEL AND BACKEND RESOLUTION
   ============================================================ */

function resolveModel(role) {
  const models =
    G?.models;

  if (
    !models ||
    typeof models !== "object"
  ) {
    throw new Error(
      "Model configuration is missing."
    );
  }

  const rawRole =
    String(role || "").trim();

  const candidates = [
    rawRole,
    rawRole.toUpperCase(),
    rawRole.toLowerCase(),
    "AM",
    "am",
    "DEFAULT",
    "default"
  ];

  for (const candidate of candidates) {
    if (
      candidate &&
      typeof models[candidate] ===
      "string" &&
      models[candidate].trim()
    ) {
      return models[candidate].trim();
    }
  }

  throw new Error(
    `No model is configured for role "${rawRole || "UNKNOWN"}".`
  );
}

/**
 * Resolve and snapshot backend configuration when callModel()
 * is invoked.
 *
 * This prevents a queued request from silently switching backend
 * if global application state changes while it is waiting.
 */
function resolveBackendRoute(role) {
  const configuredBackend =
    normalizeBackendName(
      G?.backend
    );

  const model =
    resolveModel(role);

  if (configuredBackend === "anthropic") {
    const apiKey =
      firstNonEmptyString(
        G.anthropicKey
      );

    if (!apiKey) {
      throw new Error(
        "Anthropic API key is not configured."
      );
    }

    return {
      backend:
        "anthropic",

      adapter:
        "anthropic-messages",

      provider:
        "Anthropic",

      model,

      endpoint:
        buildAnthropicMessagesUrl(
          firstNonEmptyString(
            G.anthropicEndpoint,
            "https://api.anthropic.com"
          )
        ),

      apiKey,

      anthropicVersion:
        firstNonEmptyString(
          G.anthropicVersion,
          "2023-06-01"
        ),

      timeoutMs:
        normalizePositiveNumber(
          G.anthropicRequestTimeoutMs,
          DEFAULT_REMOTE_TIMEOUT_MS
        )
    };
  }

  if (configuredBackend === "ollama") {
    const configuredOptions =
      (
        G.ollamaOptions &&
        typeof G.ollamaOptions ===
        "object" &&
        !Array.isArray(G.ollamaOptions)
      )
        ? { ...G.ollamaOptions }
        : {};

    return {
      backend:
        "ollama",

      adapter:
        "ollama-native",

      provider:
        "Ollama",

      model,

      endpoint:
        buildOllamaChatUrl(
          firstNonEmptyString(
            G.ollamaEndpoint,
            "http://localhost:11434"
          )
        ),

      timeoutMs:
        normalizePositiveNumber(
          G.ollamaRequestTimeoutMs,
          DEFAULT_LONG_RUNNING_TIMEOUT_MS
        ),

      temperature:
        Number.isFinite(
          G.ollamaTemperature
        )
          ? G.ollamaTemperature
          : DEFAULT_TEMPERATURE,

      think:
        Boolean(G.ollamaThink),

      options:
        configuredOptions
    };
  }

  if (
    configuredBackend === "colab" ||
    configuredBackend === "openai" ||
    configuredBackend ===
    "openai-compatible"
  ) {
    const isColab =
      configuredBackend === "colab";

    const isOpenAI =
      configuredBackend === "openai";

    const endpoint =
      firstNonEmptyString(
        G.openAICompatibleEndpoint,
        G.openaiEndpoint,
        G.colabEndpoint,

        isOpenAI
          ? "https://api.openai.com"
          : ""
      );

    const apiKey =
      firstNonEmptyString(
        G.openAICompatibleApiKey,
        G.openAICompatibleBearerToken,
        G.openaiKey,
        G.openAIKey,
        G.colabBearerToken
      );

    const requireApiKey =
      Boolean(
        firstDefined(
          G.openAICompatibleRequireApiKey,
          G.colabRequireBearerToken,
          true
        )
      );

    if (
      requireApiKey &&
      !apiKey
    ) {
      throw new Error(
        `${isColab
          ? "Colab bearer token"
          : "OpenAI-compatible API key"
        } is not configured.`
      );
    }

    return {
      backend:
        configuredBackend,

      adapter:
        "openai-chat",

      provider:
        isColab
          ? "Colab"
          : isOpenAI
            ? "OpenAI"
            : "OpenAI-compatible",

      model,

      endpoint:
        buildChatCompletionsUrl(
          endpoint
        ),

      apiKey,

      timeoutMs:
        normalizePositiveNumber(
          firstDefined(
            G.openAICompatibleRequestTimeoutMs,
            G.colabRequestTimeoutMs
          ),

          isColab
            ? DEFAULT_LONG_RUNNING_TIMEOUT_MS
            : DEFAULT_REMOTE_TIMEOUT_MS
        ),

      temperature:
        Number.isFinite(
          firstDefined(
            G.openAICompatibleTemperature,
            G.colabTemperature
          )
        )
          ? firstDefined(
            G.openAICompatibleTemperature,
            G.colabTemperature
          )
          : DEFAULT_TEMPERATURE
    };
  }

  if (!configuredBackend) {
    throw new Error(
      "Model backend is not configured."
    );
  }

  throw new Error(
    `Unknown backend: ${G.backend}`
  );
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
 *   Conversation messages.
 *
 * @param {number} maxTokens
 *   Output-token limit.
 *
 * @param {Object} metadata
 *   Optional debug metadata:
 *
 *   {
 *     purpose: "STATS",
 *     subject: "NIMDOK"
 *   }
 *
 * @returns {Promise<string>}
 *   Cleaned model response text.
 */
export async function callModel(
  role,
  systemPrompt,
  messages,
  maxTokensOrMetadata = DEFAULT_MAX_TOKENS,
  maybeMetadata = {}
) {
  let maxTokens = DEFAULT_MAX_TOKENS;
  let metadata = {};

  if (
    typeof maxTokensOrMetadata === "object" &&
    maxTokensOrMetadata !== null
  ) {
    metadata = maxTokensOrMetadata;
  } else {
    maxTokens = maxTokensOrMetadata;
    metadata = maybeMetadata;
  }

  const normalizedSystemPrompt =
    String(systemPrompt ?? "");

  const requestMessages =
    snapshotMessages(messages);

  const normalizedMaxTokens =
    normalizeMaxTokens(maxTokens);

  const requestMetadata =
    (
      metadata &&
      typeof metadata === "object" &&
      !Array.isArray(metadata)
    )
      ? { ...metadata }
      : {};

  const route =
    resolveBackendRoute(role);

  const adapter =
    MODEL_ADAPTERS[route.adapter];

  if (typeof adapter !== "function") {
    throw new Error(
      `No adapter is registered for "${route.adapter}".`
    );
  }

  const callContext =
    makeModelCallContext(
      role,
      normalizedSystemPrompt,
      requestMessages,
      requestMetadata
    );

  return enqueueModelCall(
    async () => {
      const debugEnabled =
        Boolean(G?.DEBUG_PROMPTS);

      const normalizedMessages =
        normalizeMessagesForDebug(
          requestMessages
        );

      const latestUserMessage =
        [...normalizedMessages]
          .reverse()
          .find(
            (message) =>
              message.role === "user"
          );

      if (debugEnabled) {
        console.groupCollapsed(
          `[MODEL INPUT][DEBUG][${callContext.id}] ${role} → ${route.provider}/${route.model}`
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

            backend:
              route.backend,

            adapter:
              route.adapter,

            provider:
              route.provider,

            model:
              route.model,

            endpoint:
              route.endpoint,

            max_tokens:
              normalizedMaxTokens,

            message_count:
              normalizedMessages.length,

            system_prompt_characters:
              normalizedSystemPrompt.length,

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
                normalizedSystemPrompt
              ),

            latest_user_preview:
              createPreview(
                latestUserMessage
                  ?.content || ""
              ),

            metadata:
              requestMetadata
          }
        );

        console.debug(
          "SYSTEM PROMPT:",
          normalizedSystemPrompt
        );

        console.debug(
          "MESSAGES:",
          normalizedMessages
        );

        console.groupEnd();
      }

      const requestStartTime =
        getClockMilliseconds();

      try {
        const result =
          await adapter({
            route,

            systemPrompt:
              normalizedSystemPrompt,

            messages:
              requestMessages,

            maxTokens:
              normalizedMaxTokens
          });

        if (
          !result ||
          typeof result !== "object"
        ) {
          throw new Error(
            `Adapter "${route.adapter}" returned an invalid result.`
          );
        }

        const raw =
          typeof result.raw === "string"
            ? result.raw
            : normalizeMessageContent(
              result.raw
            );

        const cleaned =
          typeof result.cleaned ===
            "string"
            ? result.cleaned
            : raw;

        const requestDurationMs =
          calculateDurationMs(
            requestStartTime
          );

        if (debugEnabled) {
          console.groupCollapsed(
            `[MODEL RESPONSE][DEBUG][${callContext.id}] ${role} ← ${route.provider}/${route.model} (${requestDurationMs} ms)`
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

              backend:
                route.backend,

              adapter:
                route.adapter,

              provider:
                route.provider,

              model:
                route.model,

              request_duration_ms:
                requestDurationMs,

              raw_characters:
                raw.length,

              cleaned_characters:
                cleaned.length,

              response_was_cleaned:
                raw !== cleaned
            }
          );

          console.debug(
            "RAW MODEL RESPONSE:",
            raw
          );

          if (cleaned !== raw) {
            console.debug(
              "CLEANED MODEL RESPONSE:",
              cleaned
            );
          }

          console.debug(
            "RAW PROVIDER RESPONSE:",
            result.providerResponse
          );

          console.groupEnd();
        }

        validateModelTextResult({
          raw,
          cleaned,
          result,
          route,
          callContext,
        });

        return cleaned;
      } catch (error) {
        const requestDurationMs =
          calculateDurationMs(
            requestStartTime
          );

        console.group(
          `[MODEL ERROR][${callContext.id}] ${role} → ${route.provider}/${route.model}`
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

          backend:
            route.backend,

          adapter:
            route.adapter,

          provider:
            route.provider,

          model:
            route.model,

          endpoint:
            route.endpoint,

          request_duration_ms:
            requestDurationMs,

          error
        });

        console.groupEnd();

        throw error;
      }
    },

    [
      callContext.id,
      route.backend,
      route.model
    ].join(":")
  );
}

/* ============================================================
   ANTHROPIC MESSAGES ADAPTER
   ============================================================ */

async function callAnthropic({
  route,
  systemPrompt,
  messages,
  maxTokens
}) {
  const body = {
    model:
      route.model,

    max_tokens:
      maxTokens,

    system:
      systemPrompt,

    messages:
      Array.isArray(messages)
        ? messages
        : []
  };

  const {
    response,
    responseText,
    data
  } =
    await postJson({
      url:
        route.endpoint,

      headers: {
        "Content-Type":
          "application/json",

        Accept:
          "application/json",

        "x-api-key":
          route.apiKey,

        "anthropic-version":
          route.anthropicVersion
      },

      body,

      timeoutMs:
        route.timeoutMs,

      requestLabel:
        "Anthropic request"
    });

  if (
    !response.ok ||
    data?.error
  ) {
    throw new Error(
      `Anthropic request failed with HTTP ${response.status}${createProviderErrorDetail(
        data,
        responseText
      )}`
    );
  }

  if (
    !data ||
    typeof data !== "object"
  ) {
    throw new Error(
      `Anthropic returned non-JSON data with HTTP ${response.status}.`
    );
  }

  if (!Array.isArray(data.content)) {
    throw new Error(
      "Anthropic returned an invalid Messages API response shape."
    );
  }

  const raw =
    data.content
      .map((contentBlock) => {
        if (
          typeof contentBlock?.text ===
          "string"
        ) {
          return contentBlock.text;
        }

        return "";
      })
      .join("");

  return {
    raw,
    cleaned:
      raw,

    providerResponse:
      data
  };
}

/* ============================================================
   OLLAMA NATIVE ADAPTER
   ============================================================ */

async function callOllama({
  route,
  systemPrompt,
  messages,
  maxTokens
}) {
  const ollamaMessages = [
    {
      role:
        "system",

      content:
        systemPrompt
    },

    ...normalizeTextMessages(messages)
  ];

  const body = {
    model:
      route.model,

    messages:
      ollamaMessages,

    stream:
      false,

    think:
      route.think,

    options: {
      num_ctx:
        10240,

      ...route.options,

      temperature:
        route.temperature,

      num_predict:
        maxTokens
    }
  };

  const {
    response,
    responseText,
    data
  } =
    await postJson({
      url:
        route.endpoint,

      headers: {
        "Content-Type":
          "application/json",

        Accept:
          "application/json"
      },

      body,

      timeoutMs:
        route.timeoutMs,

      requestLabel:
        "Ollama request"
    });

  if (
    !response.ok ||
    data?.error
  ) {
    throw new Error(
      `Ollama request failed with HTTP ${response.status}${createProviderErrorDetail(
        data,
        responseText
      )}`
    );
  }

  if (
    !data ||
    typeof data !== "object"
  ) {
    throw new Error(
      `Ollama returned non-JSON data with HTTP ${response.status}.`
    );
  }

  if (
    typeof data.message?.content !==
    "string"
  ) {
    throw new Error(
      "Ollama returned an invalid chat response shape."
    );
  }

  const raw =
    data.message.content;

  return {
    raw,

    cleaned:
      stripThinkTags(raw),

    providerResponse:
      data
  };
}

/* ============================================================
   OPENAI-COMPATIBLE CHAT COMPLETIONS ADAPTER
   ============================================================ */

async function callOpenAICompatible({
  route,
  systemPrompt,
  messages,
  maxTokens
}) {
  const chatMessages = [
    {
      role:
        "system",

      content:
        systemPrompt
    },

    ...normalizeTextMessages(messages)
  ];

  const body = {
    model:
      route.model,

    messages:
      chatMessages,

    max_tokens:
      maxTokens,

    temperature:
      route.temperature,

    stream:
      false
  };

  const headers = {
    "Content-Type":
      "application/json",

    Accept:
      "application/json"
  };

  if (route.apiKey) {
    headers.Authorization =
      `Bearer ${route.apiKey}`;
  }

  const {
    response,
    responseText,
    data
  } =
    await postJson({
      url:
        route.endpoint,

      headers,
      body,

      timeoutMs:
        route.timeoutMs,

      requestLabel:
        `${route.provider} inference request`
    });

  if (
    response.status === 401 ||
    response.status === 403
  ) {
    throw new Error(
      `${route.provider} authentication failed with HTTP ${response.status}${createProviderErrorDetail(
        data,
        responseText
      )}`
    );
  }

  if (!response.ok) {
    throw new Error(
      `${route.provider} request failed with HTTP ${response.status}${createProviderErrorDetail(
        data,
        responseText
      )}`
    );
  }

  if (
    !data ||
    typeof data !== "object"
  ) {
    throw new Error(
      `${route.provider} returned non-JSON data with HTTP ${response.status}.`
    );
  }

  if (data.error) {
    throw new Error(
      extractProviderError(
        data,
        responseText
      ) ||
      `${route.provider} returned an unspecified provider error.`
    );
  }

  const firstChoice =
    data.choices?.[0];

  const responseContent =
    firstChoice?.message?.content ??
    firstChoice?.text;

  if (
    responseContent === undefined ||
    responseContent === null
  ) {
    throw new Error(
      `${route.provider} returned an invalid Chat Completions response shape.`
    );
  }

  const raw =
    normalizeMessageContent(
      responseContent
    );

  return {
    raw,

    cleaned:
      stripThinkTags(raw),

    providerResponse:
      data
  };
}

/* ============================================================
   ADAPTER REGISTRY
   ============================================================ */

const MODEL_ADAPTERS =
  Object.freeze({
    "anthropic-messages":
      callAnthropic,

    "ollama-native":
      callOllama,

    "openai-chat":
      callOpenAICompatible
  });