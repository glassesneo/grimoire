// One shared trace proves hub snapshots and the delta-only client reducer converge, whether
// the client copies its view per record or updates it in place.
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { applyEvent, emptyView } from "../../abstractions/modules/agents/shield/quin/view";
const source = join(import.meta.dir, "../../abstractions/modules/agents/shield/hub");
const events = JSON.parse(readFileSync(join(source, "test/view-trace.json"), "utf8"));
const result = spawnSync("mix", ["run", "--no-start", "--no-compile", "test/view_trace.exs"], { cwd: source, encoding: "utf8", env: { ...process.env, MIX_ENV: "test" } });
assert.equal(result.status, 0, result.stderr);
const hub = JSON.parse(result.stdout);
let view = emptyView(), live = emptyView();
for (const [index, event] of events.entries()) {
  const before = structuredClone(view);
  const next = applyEvent(view, event, 1000);
  assert.deepEqual(view, before, `copying apply changed its input at ${index}: ${event.type}`);
  view = next;
  live = applyEvent(live, event, 1000, true);
  assert.deepEqual(view, hub[index], `trace mismatch at ${index}: ${event.type}`);
  assert.deepEqual(live, hub[index], `in-place trace mismatch at ${index}: ${event.type}`);
}
assert.equal(view.timeline.entries.filter(e => e.kind === "user").length, 3);
assert.equal(view.timeline.entries.filter(e => e.kind === "assistant").length, 3);
assert.equal(view.timeline.entries.find(e => e.callId === "call")?.state, "done");
assert(!("text" in view.presentation));
// A compaction Pi ends without starting it is shown failed; an empty status clears its key.
assert.equal(view.timeline.entries.find(e => e.kind === "compaction" && e.reason === "overflow")?.state, "failed");
assert.deepEqual(view.presentation.status, {});
// An extension tool's string or list result becomes content instead of failing the reducers.
assert.deepEqual(view.timeline.entries.find(e => e.callId === "stringy")?.result, { content: [{ type: "text", text: "listed" }], details: null, partial: false });
console.log("shared trace passed at every revision");
