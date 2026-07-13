// js/models/backends/ollama.js
/* ============================================================
   PROVIDER-SPECIFIC BACKEND ADAPTER

   Extracted from callModel.js. Receives shared transport/error/normalize
   helpers explicitly via `deps` so this leaf module stays dependency-free
   (no import of callModel.js or other application modules).

   Owns only provider-specific request construction, headers, response
   extraction, and protocol error shaping. Shared timeout/abort/retry,
   status validation, body reading, error wrapping, logging, routing,
   and cross-provider normalization remain in callModel.js.
   ============================================================ */

export function createOllamaSender(deps) {
  /* ============================================================
     OLLAMA NATIVE ADAPTER
     ============================================================ */

  const {
    postJson,
    createProviderErrorDetail,
    normalizeTextMessages,
    stripThinkTags
  } = deps;

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

  return callOllama;
}
