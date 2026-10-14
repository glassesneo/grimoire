// Framing/routing/failure behavior is owned by the hub, observed at two socket clients.
import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, symlinkSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConnection } from "node:net";
import { HubClient, JsonLines, type Envelope } from "../../abstractions/modules/agents/shield/client/protocol";
import { startHub } from "../../abstractions/modules/agents/shield/client/shield";
import { PiAdapter } from "../../abstractions/modules/agents/shield/quin/view";

const dir = mkdtempSync(join(tmpdir(), "shield-hub-"));
const socket = join(dir, "hub.sock");
const wait = async (predicate: () => boolean, timeout = 15000) => { const end = Date.now() + timeout; while (!predicate()) { if (Date.now() > end) throw new Error("wait_timeout"); await Bun.sleep(20); } };
const clients: HubClient[] = [];
const connect = () => { const c = new HubClient(socket); clients.push(c); return c; };
const fakeOptions = (mode = "normal", pidFile = join(dir, `child-${mode}.pid`)) => ({ mode: "mock", model: "fixture/fixed", launch: { executable: process.execPath, argv: [join(import.meta.dir, "fake-rpc.ts"), mode], env: { PATH: "/usr/bin:/bin", FIXTURE_PID: pidFile } } });
const attach = (c: HubClient, cwd = dir, opts = fakeOptions()) => c.hub("attach", { cwd, harness: "quin", options: opts });
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
try {
  const decoder = new JsonLines();
  const unicode = Buffer.from('{"text":"日本\u2028語\u2029"}\r\n');
  const decoded = [...unicode].flatMap(byte => decoder.feed(Uint8Array.of(byte)));
  assert.deepEqual(decoded, [{ text: "日本\u2028語\u2029" }]);
  await startHub(socket);
  const inode = statSync(`${socket}.lock`).ino;
  const a = connect(), b = connect();
  const viewA = new PiAdapter(), viewB = new PiAdapter();
  const eventsA: Envelope[] = [], eventsB: Envelope[] = [];
  a.onRecord = r => { eventsA.push(r); viewA.apply(r); };
  b.onRecord = r => { eventsB.push(r); viewB.apply(r); };
  console.log("hub: atomic attach");
  const [first, second] = await Promise.all([attach(a), attach(b)]);
  assert(first.success && second.success);
  const id = first.payload["agent-id"];
  assert.equal(second.payload["agent-id"], id);
  const listing = await a.hub("list");
  assert.equal(listing.payload.length, 1);
  assert.equal(listing.payload[0]["parent-id"], null);
  const raw = createConnection({ path: socket });
  const incoming = new JsonLines(); const rawRecords: any[] = [];
  raw.on("data", bytes => rawRecords.push(...incoming.feed(bytes as Uint8Array)));
  await new Promise<void>(resolve => raw.once("connect", resolve));
  raw.write(JSON.stringify({ v: 0, type: "hub_request", id: "bad", "agent-id": null, engine: "pi", method: "ping", payload: {} }) + "\n");
  await wait(() => rawRecords.length > 0); assert.equal(rawRecords[0].error.code, "invalid_protocol");
  const rawClosed = new Promise<void>(resolve => raw.once("close", resolve));
  raw.write("{malformed\n"); await rawClosed;
  assert((await a.hub("ping")).success);
  // An envelope may omit its engine; it means Pi both when creating and when joining an agent.
  const bare = createConnection({ path: socket }); const bareIn = new JsonLines(); const bareRecords: any[] = [];
  bare.on("data", bytes => bareRecords.push(...bareIn.feed(bytes as Uint8Array)));
  await new Promise<void>(resolve => bare.once("connect", resolve));
  const bareAttach = async (cwd: string) => {
    const requestId = `bare-${bareRecords.length}-${cwd.length}`;
    bare.write(JSON.stringify({ v: 1, type: "hub_request", id: requestId, "agent-id": null, method: "attach", payload: { cwd, harness: "quin", options: fakeOptions() } }) + "\n");
    await wait(() => bareRecords.some(r => r.id === requestId));
    return bareRecords.find(r => r.id === requestId);
  };
  assert.equal((await bareAttach(dir)).payload?.["agent-id"], id);
  const bareCwd = join(dir, "bare"); mkdirSync(bareCwd);
  const bareId = (await bareAttach(bareCwd)).payload?.["agent-id"];
  assert(bareId);
  assert.equal((await attach(connect(), bareCwd)).payload["agent-id"], bareId);
  bare.destroy();
  const rpc = { op: "rpc", record: { type: "get_state" } };
  const [ra, rb] = await Promise.all([a.request("engine_request", id, rpc, undefined, "same"), b.request("engine_request", id, rpc, undefined, "same")]);
  assert(ra.success && rb.success); assert.equal(ra.id, "same"); assert.equal(rb.id, "same"); assert.equal(ra.payload.id, "same"); assert.equal(rb.payload.id, "same");
  assert(!(await attach(b, dir, { ...fakeOptions(), mode: "live" })).success);
  // A model chooses only a new root's model; naming another one still joins this agent.
  assert.equal((await attach(b, dir, { ...fakeOptions(), model: "fixture/other" })).payload?.["agent-id"], id);
  assert.equal((await a.engine(id, { op: "rpc", record: { type: "prompt", message: "/new" } })).error?.code, "unsupported_or_invalid_rpc");
  for (let i = 0; i < 2; i++) {
    assert((await a.engine(id, { op: "rpc", record: { type: "prompt", message: "same" } })).success);
    await wait(() => eventsA.filter(r => r.payload?.record?.type === "agent_settled").length === i + 1);
  }
  assert.equal(viewA.view.timeline.entries.filter(e => e.kind === "assistant").length, 2);
  assert.deepEqual(viewA.view, viewB.view);
  assert(eventsA.some(e => e.payload?.record?.type === "agent_end"));
  console.log("hub: preflight interrupt");
  const preflight = a.engine(id, { op: "rpc", record: { type: "prompt", message: "preflight" } });
  await wait(() => !!viewA.view.dialogs["preflight-dialog"]);
  const interrupt = b.engine(id, { op: "interrupt" });
  await wait(() => viewA.view.run.interrupting);
  const refused = await a.engine(id, { op: "rpc", record: { type: "prompt", message: "not accepted" } });
  assert.equal(refused.error?.code, "interrupting");
  assert((await preflight).success); assert((await interrupt).success);
  await Bun.sleep(300);
  assert.equal(viewA.view.run.active, false);
  const sequence = eventsA.map(e => e.payload?.record?.type);
  const closed = sequence.lastIndexOf("dialog_closed");
  assert(closed >= 0);
  // Snapshot backlog is independent of live backlog; 40 MiB view plus response is valid.
  console.log("hub: large snapshot");
  await a.engine(id, { op: "rpc", record: { type: "prompt", message: "large" } }).catch(() => undefined);
  await Bun.sleep(1200);
  const large = connect(); let snapshot: Envelope | undefined;
  large.onRecord = r => { if (r.type === "snapshot") snapshot = r; };
  assert((await attach(large)).success);
  assert(snapshot!.payload.view.timeline.entries.some((e: any) => e.kind === "assistant" && e.parts.some((p: any) => p.text?.length === 20 * 1024 * 1024)));
  // The blocked stdin owner must not prevent another agent progressing, or TERM/KILL.
  console.log("hub: blocked stdin");
  const blockedCwd = join(dir, "blocked"); mkdirSync(blockedCwd);
  const blocked = connect();
  const created = await attach(blocked, blockedCwd, fakeOptions("ignore-term")); assert(created.success);
  const blockedId = created.payload["agent-id"];
  assert((await blocked.engine(blockedId, { op: "rpc", record: { type: "prompt", message: "stall" } })).success);
  const pending = blocked.engine(blockedId, { op: "rpc", record: { type: "prompt", message: "a".repeat(2 * 1024 * 1024) } }).catch(() => undefined);
  await Bun.sleep(100);
  const rejected = blocked.engine(blockedId, { op: "rpc", record: { type: "prompt", message: "b".repeat(2 * 1024 * 1024) } }).catch(() => undefined);
  const otherCwd = join(dir, "other"); mkdirSync(otherCwd);
  const other = connect(); const otherRoot = await attach(other, otherCwd); assert(otherRoot.success);
  assert((await other.engine(otherRoot.payload["agent-id"], rpc)).success);
  const [uncertain, notSent] = await Promise.all([pending, rejected]);
  assert.equal(uncertain?.error?.code, "acceptance_unknown");
  assert.equal(notSent?.error?.code, "pi_write_rejected");
  const pid = Number(readFileSync(join(dir, "child-ignore-term.pid"), "utf8"));
  const oldHubPid = Number((await other.hub("ping")).payload["hub-pid"]);
  const start = Date.now(); await other.hub("shutdown");
  await wait(() => !alive(pid), 7000);
  assert(Date.now() - start <= 6500);
  assert.equal(statSync(`${socket}.lock`).ino, inode);
  // Reboot does not restore roots or reuse agent IDs.
  await wait(() => !existsSync(socket) && !alive(oldHubPid), 7000); await startHub(socket);
  const reboot = connect(); assert.deepEqual((await reboot.hub("list")).payload, []);
  const fresh = await attach(reboot); assert(fresh.success); assert.notEqual(fresh.payload["agent-id"], id);
  await reboot.hub("shutdown");
  const unsafe = join(dir, "unsafe.sock"); writeFileSync(unsafe, "untouched", { mode: 0o600 });
  await assert.rejects(startHub(unsafe), /unsafe socket/); assert.equal(readFileSync(unsafe, "utf8"), "untouched");
  const linked = join(dir, "link.sock"); symlinkSync(unsafe, `${linked}.lock`);
  await assert.rejects(startHub(linked), /unsafe file/);
  console.log("hub checks passed: atomic attach, two clients, exact IDs, convergence, preflight fencing, large snapshot, stdin stall, shutdown barrier, reboot, unsafe paths");
} catch (e) { try { console.error(readFileSync(`${socket}.log`, "utf8")); } catch {} throw e; }
finally {
  const cleanup = connect(); try { await cleanup.hub("shutdown"); } catch {} finally { cleanup.close(); }
  for (const c of clients) c.close();
  await Bun.sleep(300);
  rmSync(dir, { recursive: true, force: true });
}
