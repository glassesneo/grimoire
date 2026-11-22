import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { Edith } from "./core.ts";
import { FileCredentialStore } from "./credentials.ts";
import { edithModels } from "./models.ts";

const context = BACKGROUND_CONTEXT;
const directory = mkdtempSync(join(tmpdir(), "edith-models-"));
after(() => rmSync(directory, { recursive: true, force: true }));

void test("a profile's AI MOP model is answered through AI MOP's endpoint with its key", async () => {
  const seen: { path?: string; authorization?: string }[] = [];
  const server = createServer((request, response) => {
    seen.push({ path: request.url, authorization: request.headers.authorization });
    request.resume();
    response.writeHead(200, { "content-type": "text/event-stream" });
    const chunk = (delta: object, finish: string | null) =>
      `data: ${JSON.stringify({ id: "mock", object: "chat.completion.chunk", model: "gpt-6-astra", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
    response.write(chunk({ role: "assistant", content: "through AI MOP" }, null));
    response.write(chunk({}, "stop"));
    response.end("data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  process.env["AI_MOP_OPENAI_BASE_URL"] = `http://127.0.0.1:${port}/api/v1`;
  process.env["AI_MOP_API_KEY"] = "test-key";
  try {
    const profile = {
      model: { provider: "ai-mop-chat", modelId: "gpt-6-astra" },
      thinkingLevel: "off",
      tools: [],
      mcpServers: [],
      maxTurns: null,
    } as const;
    const edith = await Edith.open(
      await openNodeSqliteStorage(join(directory, "session.sqlite")),
      {
        models: edithModels(new FileCredentialStore(join(directory, "auth.json"))),
        profiles: { restricted: profile },
        namespaces: {},
      },
      context,
    );
    const answer = await edith.ask("cli", "hello", context);
    await edith.close(context);
    assert.deepEqual(answer.status === "done" ? answer.text : answer, "through AI MOP");
    assert.deepEqual(seen, [
      { path: "/api/v1/chat/completions", authorization: "Bearer test-key" },
    ]);
  } finally {
    server.close();
  }
});
