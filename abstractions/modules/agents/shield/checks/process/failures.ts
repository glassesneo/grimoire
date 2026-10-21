// Isolated failed/slow peers must not stop another agent or postpone finite startup/stop deadlines.
import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type HubClient, type Envelope } from "../../client/protocol";
import { Mirror } from "../../keel/protocol/apply";
import {
  alive,
  attachPayload,
  clientsOf,
  fakeLaunch,
  finish,
  invoke,
  rawClient,
  startHub,
  wait,
} from "./support";
const dir = mkdtempSync(join(tmpdir(), "shield-fail-")),
  socket = join(dir, "hub.sock");
const { clients, connect } = clientsOf(socket);
const fake = (mode: string) => fakeLaunch(dir, mode);
const cwd = (name: string) => {
  const p = join(dir, name);
  mkdirSync(p);
  return p;
};
const attach = (c: HubClient, path: string, mode = "normal") =>
  c.hub("attach", attachPayload(path, fake(mode)));
const lifecycles = (events: Envelope[]) =>
  events.filter((r) => r.type === "management" && r.payload?.op === "lifecycle");
try {
  await startHub(socket);
  const bootCwd = cwd("boot"),
    boot = connect();
  const started = Date.now();
  let bootSettled = 0;
  const bootRequest = attach(boot, bootCwd, "startup-hang").finally(() => {
    bootSettled = Date.now();
  });
  const healthyCwd = cwd("healthy"),
    healthy = connect();
  const normal = await attach(healthy, healthyCwd);
  assert(normal.success);
  const id = normal.payload["agent-id"];
  const get = () => healthy.engine(id, invoke("look"));
  assert((await get()).success);
  const broken = connect();
  const events: Envelope[] = [];
  broken.onRecord = (r) => events.push(r);
  const brokenRoot = await attach(broken, cwd("broken"), "invalid-ignore");
  assert(brokenRoot.success);
  const brokenPid = Number(readFileSync(join(dir, "invalid-ignore.pid"), "utf8"));
  const bad = await broken.engine(brokenRoot.payload["agent-id"], invoke("emit"));
  assert.equal(bad.payload?.code, "acceptance_unknown");
  await wait(() =>
    lifecycles(events).some((r) => r.payload.detail?.error === "invalid_engine_frame"),
  );
  assert((await get()).success);
  await wait(() => !alive(brokenPid), 6500);
  // The failure is reported as stopping, then once as failed with its code beside the exit.
  await wait(() => lifecycles(events).some((r) => r.payload.state === "failed"));
  await Bun.sleep(200);
  const brokenEnds = lifecycles(events).map((r) => [r.payload.state, r.payload.detail]);
  assert.deepEqual(
    brokenEnds.slice(-2).map(([state]) => state),
    ["stopping", "failed"],
  );
  assert.equal(brokenEnds.filter(([state]) => state === "failed").length, 1);
  assert.equal(brokenEnds.at(-1)![1].error, "invalid_engine_frame");
  assert.equal(typeof brokenEnds.at(-1)![1].exitCode, "number");
  // A paused socket subscriber is disposable; the Port owner continues draining stdout.
  let subscribed = false,
    disconnected = false;
  const slow = await rawClient(socket, (r: Envelope) => {
    if (r.type === "snapshot") {
      subscribed = true;
      slow.socket.pause();
    }
  });
  slow.socket.on("close", () => {
    disconnected = true;
  });
  slow.write({
    v: 1,
    type: "hub_request",
    id: "slow",
    "agent-id": null,
    engine: "keel",
    method: "attach",
    payload: attachPayload(healthyCwd, fake("normal")),
  });
  await wait(() => subscribed);
  await healthy.engine(id, invoke("flood")).catch(() => undefined);
  await Bun.sleep(2000);
  slow.socket.resume();
  await wait(() => disconnected);
  const fresh = connect();
  assert((await attach(fresh, healthyCwd)).success);
  assert((await fresh.engine(id, invoke("look"))).success);
  // Unexpected process exit keeps the old state and does not silently replace the root.
  const exitClient = connect(),
    exitCwd = cwd("exit"),
    exitEvents: Envelope[] = [];
  exitClient.onRecord = (r) => exitEvents.push(r);
  const before = await attach(exitClient, exitCwd);
  assert(before.success);
  await exitClient.engine(before.payload["agent-id"], invoke("exit")).catch(() => undefined);
  await wait(() =>
    lifecycles(exitEvents).some(
      (r) => r.payload.state === "failed" && r.payload.detail?.exitCode === 17,
    ),
  );
  const after = await attach(exitClient, exitCwd);
  assert(after.success);
  assert.notEqual(before.payload["agent-id"], after.payload["agent-id"]);
  // However an agent ends, its clients' records stay in sequence, the end is reported as a
  // lifecycle that the listing keeps, the connection stays usable, and the directory gets a new agent.
  const ended = { id: "" };
  const ends: [string, string, (c: HubClient, id: string) => Promise<unknown>][] = [
    ["stopped", "exited", (c) => c.hub("stop", { id: ended.id })],
    ["crashed", "failed", (c, id) => c.engine(id, invoke("exit")).catch(() => undefined)],
    ["inapplicable", "failed", (c, id) => c.engine(id, invoke("mixed")).catch(() => undefined)],
  ];
  for (const [name, state, end] of ends) {
    const c = connect(),
      path = cwd(`end-${name}`),
      mirror = new Mirror(),
      problems: string[] = [];
    let lifecycle = "starting";
    c.onRecord = (r) => {
      try {
        if (r.type === "agent_failed") problems.push("agent_failed");
        else if (r.type === "snapshot") mirror.reset(r.payload);
        else if (r.type === "event") mirror.apply(r.payload);
        else if (r.type === "management" && r.payload.op === "lifecycle")
          lifecycle = r.payload.state;
      } catch (e) {
        problems.push((e as Error).message);
      }
    };
    const root = await attach(c, path);
    assert(root.success);
    ended.id = root.payload["agent-id"];
    await end(c, ended.id);
    await wait(() => ["exited", "failed"].includes(lifecycle));
    await Bun.sleep(500);
    assert.deepEqual(problems, [], name);
    assert.equal(lifecycle, state, name);
    assert((await c.hub("ping")).success, name);
    assert.equal(
      (await c.hub("list")).payload.find((a: any) => a["agent-id"] === ended.id)?.state,
      state,
      name,
    );
    const next = await attach(c, path);
    assert(next.success, name);
    assert.notEqual(next.payload["agent-id"], ended.id, name);
  }
  const failedBoot = await bootRequest;
  assert.equal(failedBoot.error?.code, "engine_start_timeout");
  assert(bootSettled - started >= 59000 && bootSettled - started < 64000);
  const pid = Number(readFileSync(join(dir, "startup-hang.pid"), "utf8"));
  await wait(() => !alive(pid));
  await fresh.hub("shutdown");
  console.log(
    "failure checks passed: 60s startup deadline, malformed driver frame, TERM/KILL, slow-reader isolation, unexpected exit/no replacement, consistent ends",
  );
} catch (e) {
  try {
    console.error(readFileSync(`${socket}.log`, "utf8"));
  } catch {}
  throw e;
} finally {
  await finish(socket, clients, dir);
}
