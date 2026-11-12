import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { callTool, serve } from "./server.ts";

function client(execute: typeof callTool) {
  const input = new PassThrough();
  const output = new PassThrough();
  const replies: Array<Record<string, any>> = [];
  output.on("data", (chunk) => replies.push(JSON.parse(String(chunk))));
  serve(input, output, execute);
  return {
    replies,
    send: (message: unknown) => input.write(`${JSON.stringify(message)}\n`),
    close: () => input.end(),
    tick: () => new Promise<void>((resolve) => setImmediate(resolve)),
  };
}

const call = (
  id: string | number,
  name = "web_search",
  args: unknown = { query: "synthetic" },
) => ({
  jsonrpc: "2.0",
  id,
  method: "tools/call",
  params: { name, arguments: args },
});

void test("stdio rejects malformed messages as protocol errors and remains usable", () => {
  const messages = [
    "{",
    "null",
    "[]",
    "42",
    JSON.stringify({ jsonrpc: "1.0", id: 8, method: "ping" }),
    JSON.stringify({ jsonrpc: "2.0", id: false, method: "ping" }),
    JSON.stringify({ jsonrpc: "2.0", id: "unknown", method: "missing" }),
    JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/call", params: [] }),
    JSON.stringify(call(10, "missing")),
    JSON.stringify(call(11, "web_search", null)),
    JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    JSON.stringify({ jsonrpc: "2.0", id: "alive", method: "ping" }),
  ];
  const stdout = execFileSync(
    process.execPath,
    ["--experimental-strip-types", new URL("./server.ts", import.meta.url).pathname],
    {
      input: `${messages.join("\n")}\n`,
      encoding: "utf8",
      timeout: 3000,
    },
  );
  const replies = stdout
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    replies.slice(0, -1).map((reply) => reply.error.code),
    [-32700, -32600, -32600, -32600, -32600, -32600, -32601, -32602, -32602, -32602],
  );
  for (const reply of replies.slice(0, -1)) {
    assert.equal(reply.jsonrpc, "2.0");
    assert.equal("result" in reply, false);
  }
  assert.equal(replies[0].id, null);
  assert.equal(replies[6].id, "unknown");
  assert.deepEqual(replies.at(-1), { jsonrpc: "2.0", id: "alive", result: {} });
});

void test("MCP clients initialize, discover schemas, call both tools, and distinguish execution errors", async () => {
  const seen: unknown[] = [];
  const c = client(async (name, args) => {
    seen.push({ name, args });
    if ((args as { query?: string }).query === "failure") throw new Error("backend unavailable");
    return { supplied: args };
  });
  c.send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    },
  });
  c.send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  assert.equal(c.replies[0]!.result.protocolVersion, "2025-11-25");
  assert.ok(c.replies[0]!.result.capabilities.tools);
  const schemas = c.replies[1]!.result.tools;
  for (const name of ["web_search", "web_fetch"]) {
    assert.equal(
      schemas.find((tool: { name: string }) => tool.name === name).inputSchema.type,
      "object",
    );
  }
  c.send(call("search"));
  c.send(call("fetch", "web_fetch", { urls: ["https://example.test"], mode: "full" }));
  c.send(call("failed", "web_search", { query: "failure" }));
  await c.tick();
  for (const id of ["search", "fetch"]) {
    const reply = c.replies.find((reply) => reply.id === id)!;
    assert.equal("error" in reply, false);
    assert.deepEqual(JSON.parse(reply.result.content[0].text), reply.result.structuredContent);
    assert.deepEqual(
      reply.result.structuredContent.supplied,
      (seen[id === "search" ? 0 : 1] as { args: unknown }).args,
    );
  }
  const failed = c.replies.find((reply) => reply.id === "failed")!;
  assert.equal("error" in failed, false);
  assert.equal(failed.result.isError, true);
  assert.match(failed.result.content[0].text, /backend/);
  c.close();
});

void test(
  "tool calls propagate deadline and client cancellation to backend work",
  { timeout: 4000 },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "web-contract-"));
    const previous = process.env.WEB_RETRIEVAL_CONFIG;
    t.after(async () => {
      if (previous === undefined) delete process.env.WEB_RETRIEVAL_CONFIG;
      else process.env.WEB_RETRIEVAL_CONFIG = previous;
      await rm(directory, { recursive: true, force: true });
    });
    const key = join(directory, "key");
    await writeFile(key, "synthetic-key");
    const file = join(directory, "config.json");
    await writeFile(
      file,
      JSON.stringify({
        schemaVersion: 2,
        providers: [
          "parallel-search",
          "brave-llm-context",
          "brave-web-search",
          "exa-search",
          "parallel-extract",
          "exa-contents",
        ].map((id) => ({
          id,
          kind: id,
          endpoint: "https://example.test/retrieval",
          apiKeyFile: id === "parallel-search" ? key : null,
        })),
        routing: {
          generalFamilies: { parallel: 5, brave: 1 },
          braveProviders: { "brave-llm-context": 2, "brave-web-search": 1 },
        },
        deadlinesMs: { search: 1000, fetch: 1000 },
        retry: { maxRetries: 1, defaultWaitMs: 0 },
      }),
    );
    process.env.WEB_RETRIEVAL_CONFIG = file;
    let signal: AbortSignal | undefined;
    t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
      signal = init.signal ?? undefined;
      return new Promise(() => {});
    });
    const c = client(callTool);
    c.send(call(1));
    const until = Date.now() + 2500;
    while (c.replies.length === 0 && Date.now() < until)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(signal?.aborted, true);
    assert.equal(c.replies[0]?.result.isError, true);
    assert.match(c.replies[0]!.result.content[0].text, /timeout|deadline/i);
    const previousSignal = signal;
    c.send(call(2));
    const startedBy = Date.now() + 500;
    while (signal === previousSignal && Date.now() < startedBy)
      await new Promise((resolve) => setTimeout(resolve, 5));
    assert.notEqual(signal, previousSignal);
    c.send({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 2 } });
    assert.equal(signal?.aborted, true);
    await c.tick();
    assert.deepEqual(
      c.replies.map((reply) => reply.id),
      [1],
    );
    c.close();
  },
);

void test("cancellation targets only the matching call, propagates abort, and suppresses late replies", async () => {
  const signals: AbortSignal[] = [];
  let rejectLate: (error: Error) => void = () => {};
  const c = client(async (_name, args, signal) => {
    signals.push(signal!);
    if ((args as { query?: string }).query === "pending")
      return new Promise((_resolve, reject) => {
        rejectLate = reject;
      });
    return { ok: true };
  });
  c.send(call("pending", "web_search", { query: "pending" }));
  c.send({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: "absent" } });
  assert.equal(signals[0]!.aborted, false);
  c.send({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: "pending" } });
  assert.equal(signals[0]!.aborted, true);
  c.send(call(2));
  await c.tick();
  rejectLate(new Error("late failure"));
  await c.tick();
  assert.deepEqual(
    c.replies.map((reply) => reply.id),
    [2],
  );
  assert.equal(signals[1]!.aborted, false);
  c.close();
});
