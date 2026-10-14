// Isolated failed/slow peers must not stop another agent or postpone finite startup/stop deadlines.
import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConnection } from "node:net";
import { HubClient, JsonLines, type Envelope } from "../../abstractions/modules/agents/shield/client/protocol";
import { startHub } from "../../abstractions/modules/agents/shield/client/shield";
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
  const failedBoot = await bootRequest;
  assert.equal(failedBoot.error?.code, "pi_start_timeout");
  assert(Date.now() - started >= 59000 && Date.now() - started < 64000);
  const pid = Number(readFileSync(join(dir, "startup-hang.pid"), "utf8"));
  await wait(() => !alive(pid));
  await fresh.hub("shutdown");
  console.log("failure checks passed: 60s startup deadline, malformed Pi frame, TERM/KILL, slow-reader isolation, unexpected exit/no replacement");
} catch (e) { try { console.error(readFileSync(`${socket}.log`, "utf8")); } catch {} throw e; }
finally {
  const c = connect(); try { await c.hub("shutdown"); } catch {} finally { c.close(); }
  for (const client of clients) client.close();
  await Bun.sleep(300); rmSync(dir, { recursive: true, force: true });
}
