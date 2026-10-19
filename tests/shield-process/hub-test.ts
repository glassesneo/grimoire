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
import { Mirror } from "../../abstractions/modules/agents/keel/protocol/apply";
import {
  alive,
  attachPayload,
  clientsOf,
  fakeLaunch,
  finish,
  invoke,
  rawClient,
  wait,
} from "./support";

const dir = mkdtempSync(join(tmpdir(), "shield-hub-"));
const socket = join(dir, "hub.sock");
const { clients, connect } = clientsOf(socket);
const fakeOptions = (mode = "normal") => fakeLaunch(dir, mode, { PATH: "/usr/bin:/bin" });
const attach = (c: HubClient, cwd = dir, opts = fakeOptions()) =>
  c.hub("attach", attachPayload(cwd, opts));

/** A client that mirrors the runtime's state from its snapshot and events, as a screen does. */
function mirrored(c: HubClient) {
  const mirror = new Mirror();
  const records: Envelope[] = [];
  let connection: string | undefined;
  let writer: string | null = null;
  c.onRecord = (r) => {
    records.push(r);
    if (r.type === "snapshot") {
      mirror.reset(r.payload);
      connection = r.connection;
      writer = r.writer?.connection ?? null;
    } else if (r.type === "event") mirror.apply(r.payload);
    else if (r.type === "management" && r.payload.op === "writer") writer = r.payload.connection;
  };
  return {
    mirror,
    records,
    get connection() {
      return connection;
    },
    get writes() {
      return connection !== undefined && writer === connection;
    },
  };
}

try {
  const decoder = new JsonLines();
  const unicode = Buffer.from('{"text":"日本 語 "}\r\n');
  const decoded = [...unicode].flatMap((byte) => decoder.feed(Uint8Array.of(byte)));
  assert.deepEqual(decoded, [{ text: "日本 語 " }]);
  await startHub(socket);
  const inode = statSync(`${socket}.lock`).ino;
  const a = connect(),
    b = connect();
  const viewA = mirrored(a),
    viewB = mirrored(b);
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
    engine: "keel",
    method: "ping",
    payload: {},
  });
  await wait(() => raw.records.length > 0);
  assert.equal(raw.records[0].error.code, "invalid_protocol");
  const rawClosed = new Promise<void>((resolve) => raw.socket.once("close", resolve));
  raw.socket.write("{malformed\n");
  await rawClosed;
  assert((await a.hub("ping")).success);
  // An envelope may omit its engine; it means keel both when creating and when joining an agent.
  const bare = await rawClient(socket);
  const bareRecords = bare.records;
  const bareAttach = async (
    cwd: string,
    envelope: Record<string, unknown> = {},
    harness = "keel",
  ) => {
    const requestId = `bare-${bareRecords.length}-${cwd.length}`;
    bare.write({
      v: 1,
      type: "hub_request",
      id: requestId,
      "agent-id": null,
      method: "attach",
      payload: { ...attachPayload(cwd, fakeOptions()), harness },
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
  assert.equal((await bareAttach(dir, { engine: "pi" })).error?.code, "invalid_protocol");
  assert.equal((await bareAttach(dir, { engine: "keel" }, "other")).error?.code, "invalid_attach");
  bare.socket.destroy();
  // An agent serves one configuration directory.
  const otherConfig = join(dir, "other-config");
  mkdirSync(otherConfig);
  assert.equal(
    (await attach(b, dir, { ...fakeOptions(), configDir: otherConfig })).error?.code,
    "config_dir_mismatch",
  );
  console.log("hub: request ids per connection, writer");
  const [ra, rb] = await Promise.all([
    a.request("engine_request", id, invoke("same"), undefined, undefined, "same"),
    b.request("engine_request", id, invoke("same"), undefined, undefined, "same"),
  ]);
  assert(ra.success && rb.success);
  assert.equal(ra.id, "same");
  assert.equal(rb.id, "same");
  // The runtime sees each request with its own connection.
  assert.notEqual(ra.payload.detail, rb.payload.detail);
  // The first screen to be live writes; the other views, and its write is refused.
  assert.equal([viewA.writes, viewB.writes].filter(Boolean).length, 1);
  const [writerClient, viewerClient] = viewA.writes ? [a, b] : [b, a];
  const viewer = viewA.writes ? viewB : viewA;
  assert.equal((await viewerClient.engine(id, invoke("write"))).payload.code, "not_writer");
  assert.equal((await writerClient.engine(id, invoke("write"))).payload.outcome, "done");
  assert((await viewerClient.request("hub_request", id, {}, "take_write")).success);
  await wait(() => viewer.writes);
  assert.equal((await writerClient.engine(id, invoke("write"))).payload.code, "not_writer");
  // Events reach both screens in the runtime's sequence, and they converge.
  for (let i = 0; i < 3; i++) assert((await a.engine(id, invoke("emit", `text ${i}`))).success);
  await wait(() => viewA.mirror.seq === viewB.mirror.seq && viewA.mirror.seq > 0);
  assert.deepEqual(viewA.mirror.state, viewB.mirror.state);
  assert(!viewA.records.some((r) => r.type === "event" && "seq" in r));
  // A third screen's snapshot equals what the others followed to the same number.
  const c = connect();
  const viewC = mirrored(c);
  assert((await attach(c)).success);
  assert.equal(viewC.mirror.seq, viewA.mirror.seq);
  assert.deepEqual(viewC.mirror.state, viewA.mirror.state);
  // Snapshot backlog is independent of live backlog; a 20 MiB state plus response is valid.
  // The 20 MiB event exceeds a subscriber's live backlog, so a client that is not
  // subscribed asks for it, and the subscribed screens are disconnected.
  console.log("hub: large snapshot");
  assert((await connect().engine(id, invoke("large"))).success);
  const large = connect();
  let snapshot: Envelope | undefined;
  large.onRecord = (r) => {
    if (r.type === "snapshot") snapshot = r;
  };
  assert((await attach(large)).success);
  assert(snapshot!.payload.state.texts.some((t: string) => t.length === 20 * 1024 * 1024));
  // Input to a process that stopped reading stdin waits in order instead of failing the agent,
  // and neither blocks another agent progressing, or TERM/KILL.
  console.log("hub: blocked stdin");
  const blockedCwd = join(dir, "blocked");
  mkdirSync(blockedCwd);
  const blocked = connect();
  const created = await attach(blocked, blockedCwd, fakeOptions("ignore-term"));
  assert(created.success);
  const blockedId = created.payload["agent-id"];
  assert((await blocked.engine(blockedId, invoke("stall"))).success);
  const pending = blocked
    .engine(blockedId, invoke("emit", "a".repeat(2 * 1024 * 1024)))
    .catch(() => undefined);
  await Bun.sleep(100);
  const queued = blocked
    .engine(blockedId, invoke("emit", "b".repeat(2 * 1024 * 1024)))
    .catch(() => undefined);
  const otherCwd = join(dir, "other");
  mkdirSync(otherCwd);
  const other = connect();
  const otherRoot = await attach(other, otherCwd);
  assert(otherRoot.success);
  assert((await other.engine(otherRoot.payload["agent-id"], invoke("emit"))).success);
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
    "hub checks passed: atomic attach, two clients, exact IDs, writer, convergence, large snapshot, stdin stall, shutdown barrier, reboot, unsafe paths",
  );
} catch (e) {
  try {
    console.error(readFileSync(`${socket}.log`, "utf8"));
  } catch {}
  throw e;
} finally {
  await finish(socket, clients, dir);
}
