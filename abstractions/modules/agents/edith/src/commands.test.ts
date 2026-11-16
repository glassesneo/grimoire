import assert from "node:assert/strict";
import { test } from "node:test";
import { parseModel, parseThinking, split } from "./commands.ts";

void test("a model argument takes the provider before the first slash and keeps the rest as the model id", () => {
  assert.deepEqual(parseModel("openrouter/anthropic/claude-haiku-5.5"), {
    value: { provider: "openrouter", modelId: "anthropic/claude-haiku-5.5" },
  });
  assert.deepEqual(parseModel(" default "), { value: null });
  for (const bad of ["", "openrouter", "/x", "x/", "a/b c"])
    assert.ok("error" in parseModel(bad), bad);
});

void test("a thinking argument accepts only known levels or default", () => {
  assert.deepEqual(parseThinking("high"), { value: "high" });
  assert.deepEqual(parseThinking("default"), { value: null });
  assert.ok("error" in parseThinking("loud"));
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
