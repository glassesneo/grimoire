// Real Pi compatibility: mock/fixtures stream, persist and restore without provider auth.
import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HubClient, type Envelope } from "../../abstractions/modules/agents/shield/client/protocol";
import { startHub } from "../../abstractions/modules/agents/shield/client/shield";
import { options } from "../../abstractions/modules/agents/shield/quin/launch";
import { PiAdapter, type View } from "../../abstractions/modules/agents/shield/quin/view";
const dir = mkdtempSync(join(tmpdir(), "shield-pi-"));
const socket = join(dir, "hub.sock");
Object.assign(process.env, { HOME: dir, XDG_CONFIG_HOME: join(dir, "config"), XDG_STATE_HOME: join(dir, "state") });
const wait = async (test: () => boolean, timeout = 15000) => { const until = Date.now() + timeout; while (!test()) { if (Date.now() > until) throw new Error("wait_timeout"); await Bun.sleep(20); } };
const clients: HubClient[] = [];
function connect() {
  const client = new HubClient(socket); clients.push(client);
  const adapter = new PiAdapter(), events: Envelope[] = [], views = new Map<number, View>();
  client.onRecord = r => { events.push(r); adapter.apply(r); if (adapter.seq != null) views.set(adapter.seq, adapter.view); };
  return { client, adapter, events, views };
}
const attach = (c: HubClient, cwd = dir, opts = options(true, undefined, cwd)) => c.hub("attach", { cwd, harness: "quin", options: opts });
const prompt = (c: HubClient, id: string, message: string) => c.engine(id, { op: "rpc", record: { type: "prompt", message } });
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
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
  await Bun.sleep(350);
  const g = connect(); assert((await attach(g.client)).success); assert.deepEqual(g.adapter.view.dialogs, {});
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
  const oldHubPid = Number((await g.client.hub("ping")).payload["hub-pid"]);
  await g.client.hub("shutdown"); await wait(() => !existsSync(socket) && !alive(oldHubPid));
  console.log("Pi: reboot without restoring roots");
  await startHub(socket); const reboot = connect(); assert.deepEqual((await reboot.client.hub("list")).payload, []);
  const fresh = await attach(reboot.client); assert(fresh.success); assert.notEqual(fresh.payload["agent-id"], id);
  const newState = await reboot.client.engine(fresh.payload["agent-id"], { op: "rpc", record: { type: "get_state" } });
  assert.notEqual(newState.payload.data.sessionFile, file); assert(existsSync(file));
  await reboot.client.hub("shutdown");
  console.log("Pi compatibility passed: streaming/tool reattach, repeated text, queue/interrupt, four dialogs/first winner/timeout, history/reboot, real bash TERM");
} catch (e) { try { console.error(readFileSync(`${socket}.log`, "utf8")); } catch {} throw e; }
finally {
  const cleanup = new HubClient(socket); try { await cleanup.hub("shutdown"); } catch {} finally { cleanup.close(); }
  for (const c of clients) c.close();
  await Bun.sleep(300); rmSync(dir, { recursive: true, force: true });
}
