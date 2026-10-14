// Real Pi compatibility: mock/fixtures stream, persist and restore without provider auth.
import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HubClient, type Envelope } from "../../abstractions/modules/agents/shield/client/protocol";
import { startHub } from "../../abstractions/modules/agents/shield/client/shield";
import { options } from "../../abstractions/modules/agents/shield/quin/launch";
import { PiAdapter, type View } from "../../abstractions/modules/agents/shield/quin/view";
import { codemodeErrorLocation, codemodeOutput, codemodeWallTime } from "../../abstractions/modules/agents/shield/quin/ui/codemode-result";
import { alive, finish, wait } from "./support";
const dir = mkdtempSync(join(tmpdir(), "shield-pi-"));
const socket = join(dir, "hub.sock");
Object.assign(process.env, { HOME: dir, XDG_CONFIG_HOME: join(dir, "config"), XDG_STATE_HOME: join(dir, "state") });
const clients: HubClient[] = [];
function connect() {
  const client = new HubClient(socket); clients.push(client);
  const adapter = new PiAdapter(), events: Envelope[] = [], views = new Map<number, View>();
  client.onRecord = r => { events.push(r); adapter.apply(r); if (adapter.seq != null) views.set(adapter.seq, adapter.view); };
  return { client, adapter, events, views };
}
const attach = (c: HubClient, cwd = dir, opts = options(true, undefined, cwd)) => c.hub("attach", { cwd, harness: "quin", options: opts });
const prompt = (c: HubClient, id: string, message: string) => c.engine(id, { op: "rpc", record: { type: "prompt", message } });
try {
  console.log("Pi: initial stream and reattach");
  await startHub(socket);
  const a = connect();
  const first = await attach(a.client); assert(first.success, JSON.stringify(first));
  const id = first.payload["agent-id"];
  assert((await prompt(a.client, id, "hello")).success);
  await wait(() => a.events.some(e => e.payload?.record?.type === "message_update"));
  a.client.close();
  const b = connect();
  const reopened = await attach(b.client); assert(reopened.success); assert.equal(reopened.payload["agent-id"], id);
  assert(b.adapter.view.stream.message);
  await wait(() => !b.adapter.view.run.active);
  assert((await prompt(b.client, id, "hello")).success);
  await wait(() => !b.adapter.view.run.active && b.adapter.view.timeline.entries.filter(e => e.kind === "assistant").length === 2);
  const c = connect(); assert((await attach(c.client)).success);
  await wait(() => b.views.has(c.adapter.seq!));
  assert.deepEqual(c.adapter.view, b.views.get(c.adapter.seq!));
  assert.equal(c.adapter.view.timeline.entries.filter(e => e.kind === "user").length, 2);
  // Real follow-up queue and interrupt: no implicit resend on detach.
  assert((await prompt(b.client, id, "queued first")).success);
  await wait(() => b.adapter.view.run.active);
  assert((await prompt(c.client, id, "follow-up")).success);
  await wait(() => b.adapter.view.queue.followUp.length > 0);
  assert((await c.client.engine(id, { op: "interrupt" })).success);
  await wait(() => !b.adapter.view.run.active);
  assert.deepEqual(b.adapter.view.queue.followUp, []);
  // Detach during a tool with no output; the ongoing tool must be in the snapshot.
  const toolRequest = prompt(b.client, id, "/fixture-tool");
  await wait(() => b.adapter.view.timeline.entries.some(e => e.kind === "tool" && e.state === "running"));
  b.client.close();
  const d = connect(); assert((await attach(d.client)).success);
  assert(d.adapter.view.timeline.entries.some(e => e.kind === "tool" && e.state === "running"));
  await toolRequest.catch(() => undefined);
  await wait(() => d.adapter.view.timeline.entries.some(e => e.kind === "tool" && e.state === "done") && !d.adapter.view.run.active);
  // Codemode in `only` mode: each script's calls arrive as its children, and the result
  // text keeps the format quin's timeline reads for wall time, output, and the failing line.
  console.log("Pi: codemode scripts");
  assert((await prompt(d.client, id, "/fixture-codemode")).success);
  const scripts = () => d.adapter.view.timeline.entries.filter(e => e.kind === "tool" && e.name === "codemode");
  await wait(() => scripts().length === 2 && scripts().every(e => ["done", "error"].includes(e.state)) && !d.adapter.view.run.active);
  for (const script of scripts()) {
    const calls = d.adapter.view.timeline.entries.filter(e => e.kind === "tool" && e.parentId === script.id);
    assert.deepEqual(calls.map(e => [e.name, e.state]), [["shield_fixture", "done"]]);
    assert(codemodeWallTime(script.result.content), JSON.stringify(script.result));
  }
  const [completed, failed] = scripts();
  assert.equal(completed.state, "done");
  assert.match(codemodeOutput(completed.result.content).output, /fixture complete/);
  assert.equal(failed.state, "error");
  assert.deepEqual(codemodeErrorLocation(failed.args.value.code, { content: failed.result.content, isError: true }), { kind: "located", line: 2, error: "TypeError: cannot read property 'missing' of null\n    at <anonymous> (codemode.js:2:1)" });
  // The palette's RPC commands: another client's view follows each change.
  console.log("Pi: palette commands");
  const watcher = connect(); assert((await attach(watcher.client)).success);
  const rpc = async (record: Record<string, unknown>) => { const r = await d.client.engine(id, { op: "rpc", record }); assert(r.success, JSON.stringify(r)); return r.payload.data; };
  assert((await rpc({ type: "get_available_models" })).models.some((m: any) => m.provider === "shield-faux" && m.id === "fixed"));
  assert((await rpc({ type: "get_available_thinking_levels" })).levels.includes("high"));
  await rpc({ type: "set_thinking_level", level: "high" });
  await wait(() => watcher.adapter.view.timeline.thinking === "high");
  const selected = await rpc({ type: "set_model", provider: "shield-faux", modelId: "fixed" });
  assert.equal(`${selected.provider}/${selected.id}`, "shield-faux/fixed");
  await wait(() => watcher.events.some(e => e.payload?.record?.type === "shield_model"));
  assert.equal(watcher.adapter.view.timeline.model, "shield-faux/fixed");
  await wait(() => d.adapter.seq === watcher.adapter.seq);
  assert.deepEqual(watcher.adapter.view, d.adapter.view);
  watcher.client.close();
  // Observe a dialog, disconnect its origin, then restore without extending its deadline.
  console.log("Pi: standard dialogs");
  const dialogRequest = prompt(d.client, id, "/fixture-dialog").catch(() => undefined);
  await wait(() => Object.keys(d.adapter.view.dialogs).length > 0);
  const initialDialog = Object.values(d.adapter.view.dialogs)[0];
  d.client.close(); c.client.close();
  const e = connect(), f = connect();
  assert((await attach(e.client)).success); assert((await attach(f.client)).success);
  assert.equal(Object.values(e.adapter.view.dialogs)[0].expiresAt, initialDialog.expiresAt);
  const replies = await Promise.all([e.client.engine(id, { op: "dialog_reply", id: initialDialog.id, value: "one" }), f.client.engine(id, { op: "dialog_reply", id: initialDialog.id, value: "two" })]);
  assert.equal(replies.filter(r => r.success).length, 1);
  for (const method of ["confirm", "input", "editor"]) {
    await wait(() => Object.values(e.adapter.view.dialogs).some(d => d.method === method));
    const dialog = Object.values(e.adapter.view.dialogs).find(d => d.method === method);
    assert((await e.client.engine(id, { op: "dialog_reply", id: dialog.id, ...(method === "confirm" ? { confirmed: true } : { value: "answer" }) })).success);
  }
  await wait(() => Object.keys(e.adapter.view.dialogs).length === 0);
  await dialogRequest;
  const timedRequest = prompt(e.client, id, "/fixture-timeout").catch(() => undefined);
  await wait(() => Object.keys(e.adapter.view.dialogs).length > 0);
  e.client.close(); f.client.close();
  // Pi's 250 ms timeout closes the dialog while no client is attached; a loaded builder may report it late.
  await Bun.sleep(350);
  const g = connect(); assert((await attach(g.client)).success);
  await wait(() => Object.keys(g.adapter.view.dialogs).length === 0, 5000);
  await timedRequest;
  const state = await g.client.engine(id, { op: "rpc", record: { type: "get_state" } });
  const file = state.payload.data.sessionFile; assert(existsSync(file));
  assert((await g.client.hub("stop", { id })).success);
  await wait(() => ["exited", "failed"].includes(g.adapter.lifecycle));
  assert.equal(g.adapter.lifecycle, "exited");
  assert.equal(g.events.findLast(r => r.payload?.op === "lifecycle")!.payload.detail.exitCode, 143);
  // Real Pi's detached bash child is stopped by its TERM handler, not a mock replacement.
  console.log("Pi: real bash TERM");
  const bashCwd = join(dir, "bash"); mkdirSync(bashCwd);
  const bashOptions = options(true, undefined, bashCwd);
  const pidFile = join(dir, "bash.pid");
  bashOptions.launch.env.SHIELD_FIXTURE_PID = pidFile;
  const argv = bashOptions.launch.argv;
  argv[argv.indexOf("--extension") + 1] = process.env.SHIELD_BASH_FIXTURE!;
  argv.splice(argv.indexOf("--no-builtin-tools"), 1);
  argv[argv.indexOf("--tools") + 1] = "bash";
  const bash = connect(); const created = await attach(bash.client, bashCwd, bashOptions); assert(created.success, JSON.stringify(created));
  const bashId = created.payload["agent-id"];
  assert((await prompt(bash.client, bashId, "wait")).success);
  await wait(() => existsSync(pidFile)); const pid = Number(readFileSync(pidFile, "utf8")); assert(alive(pid));
  await bash.client.hub("stop", { id: bashId });
  await wait(() => bash.adapter.lifecycle === "exited" && !alive(pid), 6000);
  // A live agent's argv, with the faux provider standing in for Command Code so it runs offline:
  // the model is given codemode alone, and quin's codemode replaces Pi's built-in one.
  console.log("Pi: live codemode-only launch");
  const liveCwd = join(dir, "live"); mkdirSync(liveCwd);
  process.env.SHIELD_COMMANDCODE = process.env.SHIELD_FAUX;
  const liveOptions = options(false, "shield-faux/fixed", liveCwd);
  Object.assign(liveOptions.launch.env, { PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1" });
  const live = connect(); const liveRoot = await attach(live.client, liveCwd, liveOptions); assert(liveRoot.success, JSON.stringify(liveRoot));
  const liveId = liveRoot.payload["agent-id"];
  assert((await prompt(live.client, liveId, "/fixture-tools")).success);
  const report = () => live.adapter.view.timeline.entries.find(e => e.kind === "assistant" && !e.streaming && e.parts.some((p: any) => p.text?.startsWith("{")));
  await wait(() => !!report());
  assert.deepEqual(JSON.parse(report()!.parts.find((p: any) => p.text?.startsWith("{")).text), { declared: ["codemode"], codemode: 1 });
  await live.client.hub("stop", { id: liveId });
  await wait(() => live.adapter.lifecycle === "exited");
  const oldHubPid = Number((await g.client.hub("ping")).payload["hub-pid"]);
  await g.client.hub("shutdown"); await wait(() => !existsSync(socket) && !alive(oldHubPid));
  console.log("Pi: reboot without restoring roots");
  await startHub(socket); const reboot = connect(); assert.deepEqual((await reboot.client.hub("list")).payload, []);
  const fresh = await attach(reboot.client); assert(fresh.success); assert.notEqual(fresh.payload["agent-id"], id);
  const newState = await reboot.client.engine(fresh.payload["agent-id"], { op: "rpc", record: { type: "get_state" } });
  assert.notEqual(newState.payload.data.sessionFile, file); assert(existsSync(file));
  await reboot.client.hub("shutdown");
  console.log("Pi compatibility passed: streaming/tool reattach, repeated text, queue/interrupt, codemode scripts, palette commands, four dialogs/first winner/timeout, history/reboot, real bash TERM, live codemode-only tools");
} catch (e) { try { console.error(readFileSync(`${socket}.log`, "utf8")); } catch {} throw e; }
finally { await finish(socket, clients, dir); }
