// Isolated failed/slow peers must not stop another agent or postpone finite startup/stop deadlines.
import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConnection } from "node:net";
import { HubClient, JsonLines, type Envelope } from "../../abstractions/modules/agents/shield/client/protocol";
import { startHub } from "../../abstractions/modules/agents/shield/client/shield";
import { PiAdapter } from "../../abstractions/modules/agents/shield/quin/view";
const dir = mkdtempSync(join(tmpdir(), "shield-fail-")), socket = join(dir, "hub.sock");
const clients: HubClient[] = [];
const connect = () => { const c = new HubClient(socket); clients.push(c); return c; };
const wait = async (p: () => boolean, timeout = 8000) => { const end = Date.now() + timeout; while (!p()) { if (Date.now() > end) throw new Error("wait_timeout"); await Bun.sleep(20); } };
const fake = (mode: string) => ({ mode: "mock", model: "fixture/fixed", launch: { executable: process.execPath, argv: [join(import.meta.dir, "fake-rpc.ts"), mode], env: { FIXTURE_PID: join(dir, `${mode}.pid`) } } });
const cwd = (name: string) => { const p = join(dir, name); mkdirSync(p); return p; };
const attach = (c: HubClient, path: string, mode = "normal") => c.hub("attach", { cwd: path, harness: "quin", options: fake(mode) });
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
try {
  await startHub(socket);
  const bootCwd = cwd("boot"), boot = connect();
  const started = Date.now();
  const bootRequest = attach(boot, bootCwd, "startup-hang");
  const healthyCwd = cwd("healthy"), healthy = connect();
  const normal = await attach(healthy, healthyCwd); assert(normal.success);
  const id = normal.payload["agent-id"];
  const get = () => healthy.engine(id, { op: "rpc", record: { type: "get_state" } });
  assert((await get()).success);
  const broken = connect(); const events: Envelope[] = []; broken.onRecord = r => events.push(r);
  const brokenRoot = await attach(broken, cwd("broken"), "invalid-ignore"); assert(brokenRoot.success);
  const brokenPid = Number(readFileSync(join(dir, "invalid-ignore.pid"), "utf8"));
  const bad = await broken.engine(brokenRoot.payload["agent-id"], { op: "rpc", record: { type: "prompt", message: "invalid" } });
  assert.equal(bad.error?.code, "acceptance_unknown");
  await wait(() => events.some(r => r.payload?.detail?.error === "invalid_pi_frame"));
  assert((await get()).success);
  await wait(() => !alive(brokenPid), 6500);
  // A paused socket subscriber is disposable; the Port owner continues draining stdout.
  const slow = createConnection({ path: socket });
  const frames = new JsonLines(); let subscribed = false, disconnected = false;
  slow.on("error", () => {});
  slow.on("close", () => { disconnected = true; });
  slow.on("data", bytes => { for (const r of frames.feed(bytes as Uint8Array) as Envelope[]) if (r.type === "snapshot") { subscribed = true; slow.pause(); } });
  await new Promise<void>(resolve => slow.once("connect", resolve));
  slow.write(JSON.stringify({ v: 1, type: "hub_request", id: "slow", "agent-id": null, engine: "pi", method: "attach", payload: { cwd: healthyCwd, harness: "quin", options: fake("normal") } }) + "\n");
  await wait(() => subscribed);
  await healthy.engine(id, { op: "rpc", record: { type: "prompt", message: "flood" } }).catch(() => undefined);
  await Bun.sleep(2000); slow.resume(); await wait(() => disconnected);
  const fresh = connect(); assert((await attach(fresh, healthyCwd)).success);
  assert((await fresh.engine(id, { op: "rpc", record: { type: "get_state" } })).success);
  // Unexpected process exit keeps the old view and does not silently replace the root.
  const exitClient = connect(), exitCwd = cwd("exit"), exitEvents: Envelope[] = [];
  exitClient.onRecord = r => exitEvents.push(r);
  const before = await attach(exitClient, exitCwd); assert(before.success);
  await exitClient.engine(before.payload["agent-id"], { op: "rpc", record: { type: "prompt", message: "exit" } });
  await wait(() => exitEvents.some(r => r.payload?.state === "failed" && r.payload?.detail?.exitCode === 17));
  const after = await attach(exitClient, exitCwd); assert(after.success); assert.notEqual(before.payload["agent-id"], after.payload["agent-id"]);
  // However an agent ends, its clients' records stay in sequence, the end is reported as a
  // lifecycle that the listing keeps, the connection stays usable, and the directory gets a new agent.
  const ends: [string, string, (c: HubClient, id: string) => Promise<unknown>][] = [
    ["stopped", "exited", c => c.hub("stop", { id: ended.id })],
    ["crashed", "failed", (c, id) => c.engine(id, { op: "rpc", record: { type: "prompt", message: "exit" } }).catch(() => undefined)],
    ["inapplicable", "failed", (c, id) => c.engine(id, { op: "rpc", record: { type: "prompt", message: "mixed" } }).catch(() => undefined)],
  ];
  const ended = { id: "" };
  for (const [name, state, end] of ends) {
    const c = connect(), path = cwd(`end-${name}`), adapter = new PiAdapter(), problems: string[] = [];
    c.onRecord = r => {
      if (r.type === "agent_failed") problems.push("agent_failed");
      try { adapter.apply(r); } catch (e) { problems.push((e as Error).message); }
    };
    const root = await attach(c, path); assert(root.success);
    ended.id = root.payload["agent-id"];
    await end(c, ended.id);
    await wait(() => ["exited", "failed"].includes(adapter.lifecycle));
    await Bun.sleep(500);
    assert.deepEqual(problems, [], name);
    assert.equal(adapter.lifecycle, state, name);
    assert((await c.hub("ping")).success, name);
    assert.equal((await c.hub("list")).payload.find((a: any) => a["agent-id"] === ended.id)?.state, state, name);
    const next = await attach(c, path); assert(next.success, name); assert.notEqual(next.payload["agent-id"], ended.id, name);
  }
  const failedBoot = await bootRequest;
  assert.equal(failedBoot.error?.code, "pi_start_timeout");
  assert(Date.now() - started >= 59000 && Date.now() - started < 64000);
  const pid = Number(readFileSync(join(dir, "startup-hang.pid"), "utf8"));
  await wait(() => !alive(pid));
  await fresh.hub("shutdown");
  console.log("failure checks passed: 60s startup deadline, malformed Pi frame, TERM/KILL, slow-reader isolation, unexpected exit/no replacement, consistent ends");
} catch (e) { try { console.error(readFileSync(`${socket}.log`, "utf8")); } catch {} throw e; }
finally {
  const c = connect(); try { await c.hub("shutdown"); } catch {} finally { c.close(); }
  for (const client of clients) client.close();
  await Bun.sleep(300); rmSync(dir, { recursive: true, force: true });
}
