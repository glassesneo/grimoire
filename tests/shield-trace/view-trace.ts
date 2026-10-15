// The wire patch must reconstruct the authoritative snapshot after every record,
// including appends, replacements and cleared sections. No client Pi reducer exists.
import { strict as assert } from "node:assert";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { PiAdapter, emptyView } from "../../abstractions/modules/agents/shield/quin/view";
const source = join(import.meta.dir, "../../abstractions/modules/agents/shield/hub");
const result = spawnSync("mix", ["run", "--no-start", "--no-compile", "test/view_trace.exs"], {
  cwd: source,
  encoding: "utf8",
  env: { ...process.env, MIX_ENV: "test" },
});
assert.equal(result.status, 0, result.stderr);
const frames = JSON.parse(result.stdout);
const adapter = new PiAdapter();
const envelope = { v: 1 as const, "agent-id": "a", engine: "pi", "hub-instance": "h" };
adapter.apply({
  ...envelope,
  type: "snapshot",
  seq: 0,
  payload: { view: emptyView(), lifecycle: "ready", mode: "mock" },
});
for (const [index, frame] of frames.entries()) {
  adapter.apply({
    ...envelope,
    type: "event",
    seq: index + 1,
    payload: { op: "event", record: frame.record, patch: frame.patch },
  });
  assert.deepEqual(
    adapter.view,
    frame.snapshot,
    `patch mismatch at ${index}: ${frame.record.type}`,
  );
}
const view = adapter.view;
assert.equal(view.timeline.entries.filter((e) => e.kind === "user").length, 3);
assert.equal(view.timeline.entries.filter((e) => e.kind === "assistant").length, 3);
assert.equal(view.timeline.entries.find((e) => e.callId === "call")?.state, "done");
assert.equal(
  view.timeline.entries.find((e) => e.kind === "compaction" && e.reason === "overflow")?.state,
  "failed",
);
assert.deepEqual(view.presentation.status, {});
assert.deepEqual(view.timeline.entries.find((e) => e.callId === "stringy")?.result, {
  content: [{ type: "text", text: "listed" }],
  details: null,
  partial: false,
});
console.log("view patches reproduce every snapshot");
