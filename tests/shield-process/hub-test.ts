// Framing/routing/failure behavior is owned by the hub, observed at two socket clients.
import { strict as assert } from "node:assert";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  symlinkSync,
  statSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type HubClient,
  JsonLines,
  type Envelope,
} from "../../abstractions/modules/agents/shield/client/protocol";
import { startHub } from "../../abstractions/modules/agents/shield/client/shield";
import { PiAdapter } from "../../abstractions/modules/agents/shield/quin/view";
import { alive, clientsOf, fakeLaunch, finish, rawClient, wait } from "./support";

const dir = mkdtempSync(join(tmpdir(), "shield-hub-"));
const socket = join(dir, "hub.sock");
const { clients, connect } = clientsOf(socket);
const fakeOptions = (mode = "normal") => fakeLaunch(dir, mode, { PATH: "/usr/bin:/bin" });
const attach = (c: HubClient, cwd = dir, opts = fakeOptions()) =>
  c.hub("attach", { cwd, harness: "quin", options: opts });
try {
  const decoder = new JsonLines();
  const unicode = Buffer.from('{"text":"日本\u2028語\u2029"}\r\n');
  const decoded = [...unicode].flatMap((byte) => decoder.feed(Uint8Array.of(byte)));
  assert.deepEqual(decoded, [{ text: "日本\u2028語\u2029" }]);
  await startHub(socket);
  const inode = statSync(`${socket}.lock`).ino;
  const a = connect(),
    b = connect();
  const viewA = new PiAdapter(),
    viewB = new PiAdapter();
  const eventsA: Envelope[] = [],
    eventsB: Envelope[] = [];
  a.onRecord = (r) => {
    eventsA.push(r);
    viewA.apply(r);
  };
  b.onRecord = (r) => {
    eventsB.push(r);
    viewB.apply(r);
  };
  console.log("hub: atomic attach");
  const [first, second] = await Promise.all([attach(a), attach(b)]);
  assert(first.success && second.success);
  const id = first.payload["agent-id"];
  assert.equal(second.payload["agent-id"], id);
  const listing = await a.hub("list");
  assert.equal(listing.payload.length, 1);
  assert.equal(listing.payload[0]["parent-id"], null);
  const raw = await rawClient(socket);
  raw.write({
    v: 0,
    type: "hub_request",
    id: "bad",
    "agent-id": null,
    engine: "pi",
    method: "ping",
    payload: {},
  });
  await wait(() => raw.records.length > 0);
  assert.equal(raw.records[0].error.code, "invalid_protocol");
  const rawClosed = new Promise<void>((resolve) => raw.socket.once("close", resolve));
  raw.socket.write("{malformed\n");
  await rawClosed;
  assert((await a.hub("ping")).success);
  // An envelope may omit its engine; it means Pi both when creating and when joining an agent.
  const bare = await rawClient(socket);
  const bareRecords = bare.records;
  const bareAttach = async (
    cwd: string,
    envelope: Record<string, unknown> = {},
    harness = "quin",
  ) => {
    const requestId = `bare-${bareRecords.length}-${cwd.length}`;
    bare.write({
      v: 1,
      type: "hub_request",
      id: requestId,
      "agent-id": null,
      method: "attach",
      payload: { cwd, harness, options: fakeOptions() },
      ...envelope,
    });
    await wait(() => bareRecords.some((r) => r.id === requestId));
    return bareRecords.find((r) => r.id === requestId);
  };
  assert.equal((await bareAttach(dir)).payload?.["agent-id"], id);
  const bareCwd = join(dir, "bare");
  mkdirSync(bareCwd);
  const bareId = (await bareAttach(bareCwd)).payload?.["agent-id"];
  assert(bareId);
  assert.equal((await attach(connect(), bareCwd)).payload["agent-id"], bareId);
  // Only a registered engine, with a harness it admits, can create or join an agent.
  assert.equal((await bareAttach(dir, { engine: "other" })).error?.code, "invalid_protocol");
  assert.equal((await bareAttach(dir, { engine: "pi" }, "other")).error?.code, "invalid_attach");
  bare.socket.destroy();
  const rpc = { op: "rpc", record: { type: "get_state" } };
  const [ra, rb] = await Promise.all([
    a.request("engine_request", id, rpc, undefined, undefined, "same"),
    b.request("engine_request", id, rpc, undefined, undefined, "same"),
  ]);
  assert(ra.success && rb.success);
  assert.equal(ra.id, "same");
  assert.equal(rb.id, "same");
  assert.equal(ra.payload.id, "same");
  assert.equal(rb.payload.id, "same");
  assert(!(await attach(b, dir, { ...fakeOptions(), mode: "live" })).success);
  // A model chooses only a new root's model; naming another one still joins this agent.
  assert.equal(
    (await attach(b, dir, { ...fakeOptions(), model: "fixture/other" })).payload?.["agent-id"],
    id,
  );
  assert.equal(
    (await a.engine(id, { op: "rpc", record: { type: "prompt", message: "/new" } })).error?.code,
    "unsupported_or_invalid_rpc",
  );
  for (let i = 0; i < 2; i++) {
    assert(
      (await a.engine(id, { op: "rpc", record: { type: "prompt", message: "same" } })).success,
    );
    await wait(
      () => eventsA.filter((r) => r.payload?.record?.type === "agent_settled").length === i + 1,
    );
  }
  assert.equal(viewA.view.timeline.entries.filter((e) => e.kind === "assistant").length, 2);
  assert.deepEqual(viewA.view, viewB.view);
  assert(eventsA.some((e) => e.payload?.record?.type === "agent_end"));
  console.log("hub: preflight interrupt");
  const preflight = a.engine(id, { op: "rpc", record: { type: "prompt", message: "preflight" } });
  await wait(() => !!viewA.view.dialogs["preflight-dialog"]);
  const interrupt = b.engine(id, { op: "interrupt" });
  await wait(() => viewA.view.run.interrupting);
  const refused = await a.engine(id, {
    op: "rpc",
    record: { type: "prompt", message: "not accepted" },
  });
  assert.equal(refused.error?.code, "interrupting");
  assert((await preflight).success);
  assert((await interrupt).success);
  await Bun.sleep(300);
  assert.equal(viewA.view.run.active, false);
  const sequence = eventsA.map((e) => e.payload?.record?.type);
  const closed = sequence.lastIndexOf("dialog_closed");
  assert(closed >= 0);
  // Snapshot backlog is independent of live backlog; 40 MiB view plus response is valid.
  console.log("hub: large snapshot");
  await a
    .engine(id, { op: "rpc", record: { type: "prompt", message: "large" } })
    .catch(() => undefined);
  // The 40 MiB of events exceed a subscriber's live backlog, so a client that is not subscribed waits for the run to end.
  const probe = connect();
  for (const end = Date.now() + 15000; ; await Bun.sleep(50)) {
    if ((await probe.engine(id, rpc)).payload?.data?.isStreaming === false) break;
    if (Date.now() > end) throw new Error("wait_timeout");
  }
  const large = connect();
  let snapshot: Envelope | undefined;
  large.onRecord = (r) => {
    if (r.type === "snapshot") snapshot = r;
  };
  assert((await attach(large)).success);
  assert(
    snapshot!.payload.view.timeline.entries.some(
      (e: any) =>
        e.kind === "assistant" && e.parts.some((p: any) => p.text?.length === 20 * 1024 * 1024),
    ),
  );
  // Input to a process that stopped reading stdin waits in order instead of failing the agent,
  // and neither blocks another agent progressing, or TERM/KILL.
  console.log("hub: blocked stdin");
  const blockedCwd = join(dir, "blocked");
  mkdirSync(blockedCwd);
  const blocked = connect();
  const created = await attach(blocked, blockedCwd, fakeOptions("ignore-term"));
  assert(created.success);
  const blockedId = created.payload["agent-id"];
  assert(
    (await blocked.engine(blockedId, { op: "rpc", record: { type: "prompt", message: "stall" } }))
      .success,
  );
  const pending = blocked
    .engine(blockedId, {
      op: "rpc",
      record: { type: "prompt", message: "a".repeat(2 * 1024 * 1024) },
    })
    .catch(() => undefined);
  await Bun.sleep(100);
  const queued = blocked
    .engine(blockedId, {
      op: "rpc",
      record: { type: "prompt", message: "b".repeat(2 * 1024 * 1024) },
    })
    .catch(() => undefined);
  const otherCwd = join(dir, "other");
  mkdirSync(otherCwd);
  const other = connect();
  const otherRoot = await attach(other, otherCwd);
  assert(otherRoot.success);
  assert((await other.engine(otherRoot.payload["agent-id"], rpc)).success);
  assert.equal(
    (await other.hub("list")).payload.find((agent: any) => agent["agent-id"] === blockedId)?.state,
    "ready",
  );
  const pid = Number(readFileSync(join(dir, "ignore-term.pid"), "utf8"));
  const oldHubPid = Number((await other.hub("ping")).payload["hub-pid"]);
  const start = Date.now();
  await other.hub("shutdown");
  const [written, waiting] = await Promise.all([pending, queued]);
  assert.equal(written?.error?.code, "acceptance_unknown");
  assert.equal(waiting?.error?.code, "acceptance_unknown");
  await wait(() => !alive(pid), 8000);
  // TERM, KILL after 5 s, and the exit observed within the Agent's 1 s.
  assert(Date.now() - start < 7000);
  assert.equal(statSync(`${socket}.lock`).ino, inode);
  // Reboot does not restore roots or reuse agent IDs.
  await wait(() => !existsSync(socket) && !alive(oldHubPid), 7000);
  await startHub(socket);
  const reboot = connect();
  assert.deepEqual((await reboot.hub("list")).payload, []);
  const fresh = await attach(reboot);
  assert(fresh.success);
  assert.notEqual(fresh.payload["agent-id"], id);
  await reboot.hub("shutdown");
  const unsafe = join(dir, "unsafe.sock");
  writeFileSync(unsafe, "untouched", { mode: 0o600 });
  await assert.rejects(startHub(unsafe), /unsafe socket/);
  assert.equal(readFileSync(unsafe, "utf8"), "untouched");
  const linked = join(dir, "link.sock");
  symlinkSync(unsafe, `${linked}.lock`);
  await assert.rejects(startHub(linked), /unsafe file/);
  console.log(
    "hub checks passed: atomic attach, two clients, exact IDs, convergence, preflight fencing, large snapshot, stdin stall, shutdown barrier, reboot, unsafe paths",
  );
} catch (e) {
  try {
    console.error(readFileSync(`${socket}.log`, "utf8"));
  } catch {}
  throw e;
} finally {
  await finish(socket, clients, dir);
}
