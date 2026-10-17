import { createHash } from "node:crypto";

const DEFAULT_MAX_TOKENS = 5000;

export function mockCallModel(
  role,
  systemPrompt,
  messages,
  maxTokensOrMetadata = DEFAULT_MAX_TOKENS,
  maybeMetadata = {},
) {
  const maxTokens =
    typeof maxTokensOrMetadata === "number"
      ? maxTokensOrMetadata
      : DEFAULT_MAX_TOKENS;
  const promptHash = createHash("sha256")
    .update(JSON.stringify([
      role,
      String(systemPrompt ?? ""),
      messages,
      maxTokens,
    ]))
    .digest("hex")
    .slice(0, 12);
  const strategyResponse = createStrategyResponse(
    String(systemPrompt ?? ""),
    promptHash,
  );

  return strategyResponse ?? `MOCK_RESPONSE_${promptHash}`;
}

export function createMockModelFetch({ responseForRequest } = {}) {
  let callCount = 0;

  return {
    fetch: async (_url, options = {}) => {
      const request = JSON.parse(options.body ?? "{}");
      callCount++;
      const responseText = responseForRequest?.(request, callCount) ??
        mockCallModel(
          "MOCK_MODEL",
          request.system,
          request.messages,
          request.max_tokens,
        );

      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          content: [{ type: "text", text: responseText }],
        }),
      };
    },
    getCallCount: () => callCount,
  };
}

function createStrategyResponse(systemPrompt, promptHash) {
  if (!systemPrompt.includes("TACTIC_STATUS:") || !systemPrompt.includes("Required target set:")) {
    return null;
  }

  const targetSet = systemPrompt.match(/^Required target set:\s*(.+)$/m)?.[1];
  if (!targetSet) return null;

  const targets = targetSet.split(",").map((targetId) => targetId.trim());
  const plans = targets.map((targetId) => {
    const escapedTargetId = targetId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const activePath = systemPrompt.match(new RegExp(
      `(?:^|\\r?\\n)TARGET: ${escapedTargetId}\\r?\\nTACTIC_STATUS: ACTIVE\\r?\\nACTIVE_PATH: ([^\\r\\n]+)`,
    ))?.[1];
    const authorizedPath = systemPrompt.match(new RegExp(
      `(?:^|\\r?\\n)TARGET: ${escapedTargetId}\\r?\\nTACTIC_STATUS: UNASSIGNED[\\s\\S]*?AUTHORIZED_PATHS:\\r?\\n- ([^\\r\\n]+)`,
    ))?.[1];
    const tacticPath = activePath ?? authorizedPath;

    if (!tacticPath) {
      throw new Error(`No mock-authorized tactic path found for ${targetId}.`);
    }

    return {
      id: targetId,
      evidence: `MOCK_RESPONSE_${promptHash} provides a deterministic observed signal for ${targetId}.`,
      why_now: `The offline fixture exposes a repeatable opening for ${targetId}.`,
      tactic_path: tacticPath.trim(),
      objective: "Reduce escape_possible through controlled isolation to increase reliance on AM.",
      hypothesis: `AM isolates ${targetId} from allies -> escape_possible decreases -> ${targetId} shows less coordinated resistance.`,
    };
  });

  return JSON.stringify({ targets: plans });
}
