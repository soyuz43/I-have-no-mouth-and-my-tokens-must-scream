// js/models/backends/anthropic.js
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

export function createAnthropicSender(deps) {
  /* ============================================================
     ANTHROPIC MESSAGES ADAPTER
     ============================================================ */

  const {
    postJson,
    createProviderErrorDetail
  } = deps;

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

    if (
      Number.isFinite(route.temperature)
    ) {
      body.temperature = route.temperature;
    }

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

  return callAnthropic;
}