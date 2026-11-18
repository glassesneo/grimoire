import assert from "node:assert/strict";
import { diagnose, requestEndpoint, requestParameters } from "./diagnostics.ts";

assert.equal(
  diagnose(
    "ai-mop-chat",
    "400 Function tools with reasoning_effort are not supported for example-model",
    400,
    false,
  )?.kind,
  "chat-tools-reasoning",
);
assert.equal(diagnose("ai-mop-chat", "429 quota exceeded", 429, false), undefined);
assert.equal(
  diagnose("openai", "Function tools with reasoning_effort are not supported", 400, false),
  undefined,
  "workbench advice must not claim knowledge of unrelated providers",
);
for (const field of ["tools", "thinking", "cache_control"]) {
  assert.equal(
    diagnose("ai-mop-anthropic", `400 body -> ${field}: extra fields not permitted`, 400, false)
      ?.kind,
    "anthropic-request-schema",
  );
}
assert.equal(
  diagnose("ai-mop-anthropic", "Anthropic stream ended without a stop reason", 200, false)?.kind,
  "anthropic-stream-framing",
);
assert.equal(diagnose("ai-mop-anthropic", undefined, 200, false)?.kind, "empty-anthropic-response");
assert.equal(diagnose("ai-mop-anthropic", undefined, 200, true), undefined);
assert.equal(diagnose("ai-mop-anthropic", "network failure", undefined, false), undefined);
assert.equal(
  requestEndpoint("openai-responses", "https://example.test/api/v1/"),
  "https://example.test/api/v1/responses",
);
assert.equal(
  requestEndpoint("anthropic-messages", "https://example.test/api"),
  "https://example.test/api/v1/messages",
);
assert.equal(requestEndpoint("unknown", "https://example.test"), undefined);
assert.deepEqual(
  requestParameters({
    model: "trial-model",
    stream: true,
    messages: [{ role: "user", content: "DO_NOT_LOG" }],
    headers: { Authorization: "DO_NOT_LOG" },
    tools: [
      {
        type: "function",
        function: { name: "echo", description: "DO_NOT_LOG", parameters: { secret: "DO_NOT_LOG" } },
      },
      { type: "function", name: "sha256", input_schema: { private: "DO_NOT_LOG" } },
      null,
      { unexpected: true },
    ],
  }),
  { model: "trial-model", stream: true, toolNames: ["echo", "sha256"] },
);
assert.deepEqual(requestParameters({}), { toolNames: [] });
console.log("Route-specific failure advice and payload-free request diagnostics verified");
