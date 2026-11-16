import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCommand, split } from "./commands.ts";

void test("text that does not start with ! is a message, not a command", () => {
  assert.equal(parseCommand("hello !model x/y"), undefined);
  assert.equal(parseCommand(""), undefined);
});

void test("!model takes the provider before the first slash and keeps the rest as the model id", () => {
  assert.deepEqual(parseCommand("!model openrouter/anthropic/claude-haiku-5.5"), {
    kind: "model",
    value: { provider: "openrouter", modelId: "anthropic/claude-haiku-5.5" },
  });
  assert.deepEqual(parseCommand("!model default"), { kind: "model", value: null });
  for (const bad of ["!model", "!model openrouter", "!model /x", "!model x/", "!model a/b c"])
    assert.equal(parseCommand(bad)?.kind, "invalid", bad);
});

void test("!thinking accepts only known levels or default", () => {
  assert.deepEqual(parseCommand("!thinking high"), { kind: "thinking", value: "high" });
  assert.deepEqual(parseCommand("!thinking default"), { kind: "thinking", value: null });
  assert.equal(parseCommand("!thinking loud")?.kind, "invalid");
  assert.equal(parseCommand("!unknown")?.kind, "invalid");
});

void test("split keeps every chunk within the limit and loses no text", () => {
  // The emoji straddles the third chunk's limit, which must not cut it in half.
  const text = `${"a".repeat(1500)}\n${"b".repeat(1500)}\n${"c".repeat(1999)}😀${"d".repeat(10)}`;
  const chunks = split(text, 2000);
  for (const chunk of chunks) assert.ok(chunk.length <= 2000, String(chunk.length));
  assert.equal(chunks.join("").replaceAll("\n", ""), text.replaceAll("\n", ""));
  assert.equal(chunks[0], "a".repeat(1500));
  assert.ok(chunks.every((chunk) => !/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(chunk)));
  assert.deepEqual(split("", 2000), [""]);
});
