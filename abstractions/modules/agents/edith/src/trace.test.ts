import assert from "node:assert/strict";
import { test } from "node:test";
import type { EntryRecord, JsonObject } from "@earendil-works/pi-durable";
import { itemsOf, liveCalls, renderThinking, renderTool, resultOf } from "./trace.ts";

const assistant = (content: unknown[]) =>
  ({
    id: 1,
    conversationId: 1,
    kind: "pi.assistant",
    model: [{ role: "assistant", content }],
  }) as unknown as EntryRecord;

void test("an answer's text is no item, while thinking, text beside tool calls and the calls are", () => {
  const answer = assistant([
    { type: "thinking", thinking: "**Answering**" },
    { type: "text", text: "26.05" },
  ]);
  assert.deepEqual(itemsOf(answer), [{ kind: "thinking", part: 0, text: "**Answering**" }]);
  const working = assistant([
    { type: "text", text: "Searching." },
    { type: "toolCall", id: "call|1", name: "codemode", arguments: { code: "text(1)" } },
  ]);
  assert.deepEqual(itemsOf(working), [
    { kind: "commentary", part: 0, text: "Searching." },
    { kind: "tool", part: 1, callId: "call|1", name: "codemode", code: "text(1)" },
  ]);
});

void test("a code mode call lists its own script's calls live, then its result's, and shows its script only expanded", () => {
  const live = {
    nestedTools: [
      {
        parentCallId: "a",
        name: "mcp__web__web_search",
        status: "running",
        arguments: { query: "nix" },
      },
      { parentCallId: "b", name: "mcp__web__web_fetch", status: "running", arguments: {} },
    ],
  } as unknown as JsonObject;
  assert.deepEqual(liveCalls(live, "a"), [
    { name: "web_search", args: '{"query":"nix"}', status: "running" },
  ]);

  const result = resultOf({
    id: 2,
    conversationId: 1,
    kind: "pi.tool-result",
    model: [
      {
        role: "toolResult",
        toolCallId: "a",
        toolName: "codemode",
        content: [],
        isError: false,
        details: {
          calls: [
            {
              name: "mcp__web__web_search",
              args: '{"query":"nix"}',
              status: "ok",
              durationMs: 800,
            },
          ],
        },
      },
    ],
  } as unknown as EntryRecord);
  assert.deepEqual(result, {
    callId: "a",
    isError: false,
    calls: [{ name: "web_search", args: '{"query":"nix"}', status: "ok", durationMs: 800 }],
  });

  const item = {
    kind: "tool",
    part: 0,
    callId: "a",
    name: "codemode",
    code: "x".repeat(5000),
  } as const;
  const collapsed = renderTool(item, "ok", result?.calls ?? [], false, 3800);
  assert.equal(collapsed, '🔧 **codemode** ✓\n`web_search` {"query":"nix"} ✓ 0.8s');
  const expanded = renderTool(item, "ok", result?.calls ?? [], true, 3800);
  assert.ok(expanded.startsWith(`${collapsed}\n\`\`\`js\nxxx`));
  assert.ok(expanded.length <= 3800, String(expanded.length));
});

void test("collapsed thinking shows its bold headings and expanded thinking its whole text", () => {
  const text = "**Reading the question**\n\nDetails.\n\n**Choosing a source**\n\nMore.";
  assert.equal(renderThinking(text, false, 3800), "💭 Reading the question · Choosing a source");
  assert.equal(renderThinking(text, true, 3800), `💭\n${text}`);
});
