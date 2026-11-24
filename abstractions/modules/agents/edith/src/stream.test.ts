import assert from "node:assert/strict";
import { test } from "node:test";
import { StreamReader } from "./stream.ts";

void test("a growing partial yields only what each block gained, and its committed entry the rest", () => {
  const reader = new StreamReader();
  assert.deepEqual(reader.read([{ type: "thinking", thinking: "Plan" }], 1).pieces, [
    { kind: "thinking", index: 0, text: "Plan", starts: true },
  ]);
  assert.deepEqual(
    reader.read(
      [
        { type: "thinking", thinking: "Planning" },
        { type: "text", text: "Hel" },
      ],
      1,
    ).pieces,
    [
      { kind: "thinking", index: 0, text: "ning", starts: false },
      { kind: "text", index: 1, text: "Hel", starts: true },
    ],
  );
  assert.deepEqual(
    reader.read(
      [
        { type: "thinking", thinking: "Planning" },
        { type: "text", text: "Hel" },
      ],
      1,
    ).pieces,
    [],
  );
  assert.deepEqual(
    reader.read([
      { type: "thinking", thinking: "Planning" },
      { type: "text", text: "Hello." },
      { type: "toolCall" },
    ]).pieces,
    [{ kind: "text", index: 1, text: "lo.", starts: false }],
  );
  reader.reset();
  assert.deepEqual(reader.read([{ type: "text", text: "Next" }], 1).pieces, [
    { kind: "text", index: 0, text: "Next", starts: true },
  ]);
});

void test("a new attempt starts its blocks over", () => {
  const reader = new StreamReader();
  reader.read([{ type: "text", text: "First try" }], 1);
  const retried = reader.read([{ type: "text", text: "Sec" }], 2);
  assert.equal(retried.restarted, true);
  assert.deepEqual(retried.pieces, [{ kind: "text", index: 0, text: "Sec", starts: true }]);
});
