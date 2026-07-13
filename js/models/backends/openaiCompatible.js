// js/models/backends/openaiCompatible.js
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

export function createOpenAICompatibleSender(deps) {
  /* ============================================================
     OPENAI-COMPATIBLE CHAT COMPLETIONS ADAPTER
     ============================================================ */

  const {
    postJson,
    createProviderErrorDetail,
    extractProviderError,
    normalizeTextMessages,
    normalizeMessageContent,
    stripThinkTags
  } = deps;

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

  return callOpenAICompatible;
}
