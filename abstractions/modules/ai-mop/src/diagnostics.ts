export function requestEndpoint(api: string | undefined, baseUrl: string | undefined) {
  const paths: Record<string, string> = {
    "openai-responses": "/responses",
    "openai-completions": "/chat/completions",
    "anthropic-messages": "/v1/messages",
  };
  return api && baseUrl && paths[api] ? baseUrl.replace(/\/$/, "") + paths[api] : undefined;
}

function requestToolNames(payload: Record<string, unknown>): string[] {
  if (!Array.isArray(payload.tools)) return [];
  return payload.tools.flatMap((tool: unknown) => {
    if (!tool || typeof tool !== "object") return [];
    const item = tool as Record<string, unknown>;
    const nested = item.function;
    const name =
      nested && typeof nested === "object" ? (nested as Record<string, unknown>).name : item.name;
    return typeof name === "string" ? [name] : [];
  });
}

export function requestParameters(payload: Record<string, unknown>) {
  const fields = [
    "model",
    "stream",
    "reasoning",
    "reasoning_effort",
    "thinking",
    "output_config",
    "temperature",
    "top_p",
    "max_tokens",
    "max_completion_tokens",
    "max_output_tokens",
  ];
  return {
    ...Object.fromEntries(
      fields.filter((field) => field in payload).map((field) => [field, payload[field]]),
    ),
    toolNames: requestToolNames(payload),
  };
}

export function diagnose(
  provider: string,
  error: string | undefined,
  httpStatus: number | undefined,
  hasContent: boolean,
): { kind: string; hint: string } | undefined {
  if (
    provider === "ai-mop-chat" &&
    error?.includes("Function tools with reasoning_effort are not supported")
  ) {
    return {
      kind: "chat-tools-reasoning",
      hint: "AI MOP rejected Chat Completions with tools and reasoning. Select the same model under ai-mop-responses and retry. Tools and thinking were not changed automatically.",
    };
  }
  if (provider !== "ai-mop-anthropic") return;
  if (
    error?.includes("extra fields not permitted") &&
    /\b(tools|thinking|cache_control|output_config)\b/.test(error)
  ) {
    return {
      kind: "anthropic-request-schema",
      hint: "The AI MOP Anthropic proxy rejects fields in this request. Raw text works, but tools, thinking and cache_control are not accepted by the tested endpoint. No fields were silently removed.",
    };
  }
  if (httpStatus === 200 && error?.includes("stream ended without a stop reason")) {
    return {
      kind: "anthropic-stream-framing",
      hint: "HTTP succeeded but Pi could not parse the Anthropic reply. The tested proxy emits data-only SSE; Pi expects named Anthropic events. This requires a transport adapter, not a model change.",
    };
  }
  if (httpStatus === 200 && !hasContent && !error) {
    return {
      kind: "empty-anthropic-response",
      hint: "HTTP 200 produced no assistant content. Inspect SSE framing before treating this as a successful trial.",
    };
  }
}
