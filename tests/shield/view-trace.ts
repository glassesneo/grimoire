// One shared trace proves hub snapshots and the delta-only client reducer converge.
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
let view = emptyView();
for (const [index, event] of events.entries()) {
  view = applyEvent(view, event, 1000);
  assert.deepEqual(view, hub[index], `trace mismatch at ${index}: ${event.type}`);
}
assert.equal(view.timeline.entries.filter(e => e.kind === "user").length, 2);
assert.equal(view.timeline.entries.filter(e => e.kind === "assistant").length, 2);
assert.equal(view.timeline.entries.find(e => e.callId === "call")?.state, "done");
assert(!("text" in view.presentation));
console.log("shared trace passed at every revision");
