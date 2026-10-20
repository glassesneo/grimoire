// The keel runtime through the real hub: Pi through its SDK with the faux provider, no
// credentials, and screens that only follow the runtime's snapshot and events.
import { strict as assert } from "node:assert";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HubClient } from "../../client/protocol";
import { startHub } from "../../client/shield";
import { Connection } from "../../keel/screen/connection";
import { launchOptions } from "../../keel/screen/launch";
import type { Item } from "../../keel/protocol/wire";
import { alive, attachPayload, finish, wait } from "./support";

const dir = mkdtempSync(join(tmpdir(), "shield-keel-"));
const socket = join(dir, "hub.sock");
Object.assign(process.env, {
  HOME: dir,
  XDG_CONFIG_HOME: join(dir, "config"),
  XDG_STATE_HOME: join(dir, "state"),
  PI_TELEMETRY: "off",
  PI_OFFLINE: "1",
  PI_SKIP_VERSION_CHECK: "1",
});
const faux = process.env.KEEL_FAUX!;
const bashFixture = process.env.KEEL_BASH_FIXTURE!;
assert(
  faux && bashFixture && process.env.KEEL_RUNTIME,
  "the packaged runtime's paths are required",
);
const clients: HubClient[] = [];

/** A configuration directory listing `extensions`, with the faux provider's model. */
function config(name: string, extensions: string[]) {
  const path = join(dir, "config", name);
  mkdirSync(path, { recursive: true });
  writeFileSync(
    join(path, "settings.json"),
    JSON.stringify({ defaultProvider: "shield-faux", defaultModel: "fixed" }),
  );
  writeFileSync(join(path, "models.json"), JSON.stringify({ providers: {} }));
  writeFileSync(join(path, "extensions.json"), JSON.stringify({ extensions }));
  return path;
}
const standard = config("standard", [faux, "codemode", "markdown", "tools", "model", "queue"]);

/** A screen's connection: it follows the agent and runs actions, as the screen does. */
async function screen(cwd = dir, configDir = standard, env: Record<string, string> = {}) {
  const client = new HubClient(socket, "keel");
  clients.push(client);
  await client.connected;
  const connection = new Connection(client);
  const options = launchOptions(cwd, configDir);
  Object.assign(options.launch.env, env);
  await connection.attach(attachPayload(cwd, options));
  return connection;
}
const state = (c: Connection) => c.mirror.state!;
const items = (c: Connection, kind?: string): Item[] =>
  state(c).items.filter((item) => kind === undefined || item.kind === kind);
const idle = (c: Connection) => state(c).run.phase === "idle";
async function send(c: Connection, text: string) {
  const draft = state(c).drafts.prompt!;
  const set = await c.invoke("draft.set", { destination: "prompt", text, base: draft.revision });
  assert.equal(set.outcome, "done", JSON.stringify(set));
  const result = await c.invoke("editor.submit", {
    destination: "prompt",
    revision: (set as { detail: { revision: number } }).detail.revision,
  });
  assert.notEqual(result.outcome, "rejected", JSON.stringify(result));
  return result;
}

try {
  await startHub(socket);
  console.log("keel: stream, detach, and reattach");
  const a = await screen();
  assert(a.writable);
  await send(a, "hello");
  await wait(() => items(a, "response").some((item) => (item.data as any).streaming));
  const agent = a.agent;
  a.detach();
  const b = await screen();
  assert.equal(b.agent, agent);
  // The same run continues, and the new screen has it from its snapshot alone.
  assert(items(b, "response").length === 1);
  await wait(() => idle(b) && items(b, "response").every((item) => !(item.data as any).streaming));
  assert(b.writable, "the writer left, so the next screen writes");

  console.log("keel: a late snapshot equals the followed state");
  const c = await screen();
  assert.equal(c.mirror.seq, b.mirror.seq);
  assert.deepEqual(state(c), state(b));
  await send(b, "again");
  await wait(() => idle(b) && items(b, "user").length === 2);
  await wait(() => c.mirror.seq === b.mirror.seq);
  assert.deepEqual(state(c), state(b));

  console.log("keel: one writer");
  assert(!c.writable);
  const refused = await c.invoke("draft.set", {
    destination: "prompt",
    text: "x",
    base: state(c).drafts.prompt!.revision,
  });
  assert.equal(refused.outcome === "rejected" && refused.code, "not_writer");
  // A viewer may still change the thinking level, a control action.
  assert.equal((await c.invoke("global.thinking_set", { level: "high" })).outcome, "done");
  await wait(() => state(b).session.thinking === "high");
  await c.takeWrite();
  await wait(() => c.writable && !b.writable);
  const late = await b.invoke("draft.set", {
    destination: "prompt",
    text: "late",
    base: state(b).drafts.prompt!.revision,
  });
  assert.equal(late.outcome === "rejected" && late.code, "not_writer");

  console.log("keel: a running tool survives reattaching, and a queued follow-up is stopped");
  await send(c, "/fixture-tool");
  await wait(() => items(c, "tool").some((item) => (item.data as any).state === "running"));
  const d = await screen();
  assert(items(d, "tool").some((item) => (item.data as any).state === "running"));
  await send(c, "follow-up");
  await wait(() => state(c).queue.followUp.length === 1);
  assert.equal((await d.invoke("global.stop")).outcome, "accepted");
  await wait(() => idle(c) && state(c).queue.followUp.length === 0);
  assert.equal(
    (await c.client.hub("list")).payload.find((x: any) => x["agent-id"] === agent).state,
    "ready",
  );
  assert(!items(c, "user").some((item) => item.text === "> follow-up"));

  console.log("keel: pause between steps and resume");
  await send(c, "/fixture-tool");
  await wait(
    () => items(c, "tool").filter((item) => (item.data as any).state === "running").length === 1,
  );
  await c.invoke("global.pause");
  await wait(() => state(c).run.phase === "paused");
  const finishedTools = () =>
    items(c, "tool").filter((item) => (item.data as any).state === "done").length;
  const held = finishedTools();
  await Bun.sleep(300);
  assert.equal(state(c).run.phase, "paused");
  assert(!items(c, "response").some((item) => item.text.includes("Fixture finished.")));
  await c.invoke("global.resume");
  await wait(
    () => idle(c) && items(c, "response").some((item) => item.text.includes("Fixture finished.")),
  );
  assert(finishedTools() >= held);

  console.log("keel: codemode scripts and their presentation");
  await send(c, "/fixture-codemode");
  const scripts = () => items(c, "tool").filter((item) => item.variant === "codemode");
  await wait(() => scripts().length === 2 && idle(c));
  for (const script of scripts()) {
    const nested = items(c, "tool").filter((item) => item.parentId === script.id);
    assert.equal(nested.length, 1);
    assert.equal(nested[0]!.variant, "shield_fixture");
  }
  const failed = (scripts()[1]!.data as any).extra.codemode;
  assert.deepEqual(failed.location, { kind: "located", line: 2 });
  assert.match(failed.wallTime, /^[\d.]+s$/);
  assert.equal(state(c).kinds["tool/codemode"], "tool.codemode");

  console.log("keel: a request, answered with a supplement");
  await send(c, "/fixture-request");
  await wait(() => state(c).requests.length === 1);
  const request = state(c).requests[0]!;
  const supplement = await c.invoke("draft.set", {
    destination: request.destination,
    text: "because",
    base: 0,
  });
  await c.invoke("request.answer", {
    request: request.id,
    value: "two",
    revision: (supplement as any).detail.revision,
  });
  await wait(() => items(c, "notice").some((item) => item.text.includes('"supplement":"because"')));

  console.log("keel: a new runtime starts a new session");
  const session = state(c).session.id;
  await c.client.hub("stop", { id: agent });
  await wait(() => c.lifecycle === "exited");
  const e = await screen();
  assert.notEqual(e.agent, agent);
  assert.notEqual(state(e).session.id, session);
  assert.equal(state(e).drafts.prompt!.text, "");
  assert.equal(items(e).filter((item) => item.kind === "user").length, 0);

  // Real Pi's detached bash child is stopped by its TERM handler.
  console.log("keel: real bash TERM");
  const bashCwd = join(dir, "bash");
  mkdirSync(bashCwd);
  const pidFile = join(dir, "bash.pid");
  const bash = await screen(bashCwd, config("bash", [bashFixture]), {
    SHIELD_FIXTURE_PID: pidFile,
  });
  await send(bash, "wait");
  await wait(() => existsSync(pidFile));
  const pid = Number(readFileSync(pidFile, "utf8"));
  assert(alive(pid));
  await bash.client.hub("stop", { id: bash.agent });
  await wait(() => bash.lifecycle === "exited" && !alive(pid), 6000);

  console.log("keel: codemode only, the creator's environment, a dedicated PATH, unchanged files");
  const liveCwd = join(dir, "live");
  mkdirSync(liveCwd);
  const liveConfig = config("live", [faux, "codemode", "model"]);
  const keyFile = join(dir, "synthetic-secret");
  writeFileSync(keyFile, "shield-test-runtime-key");
  const settingsText = readFileSync(join(liveConfig, "settings.json"), "utf8");
  const modelsText = JSON.stringify({
    providers: { anthropic: { apiKey: `!/bin/cat '${keyFile}'` } },
  });
  writeFileSync(join(liveConfig, "models.json"), modelsText);
  chmodSync(join(liveConfig, "settings.json"), 0o444);
  chmodSync(join(liveConfig, "models.json"), 0o444);
  const userBin = join(dir, "user-bin"),
    agentBin = join(dir, "agent-bin");
  for (const [bin, value] of [
    [userBin, "ordinary"],
    [agentBin, "dedicated"],
  ] as const) {
    mkdirSync(bin);
    writeFileSync(join(bin, "shield-env-probe"), `#!/bin/sh\nprintf '%s' '${value}'\n`, {
      mode: 0o755,
    });
  }
  const originalPath = process.env.PATH;
  Object.assign(process.env, {
    SHIELD_TEST_CREATOR: "creator",
    CMD_API_KEY: "shield-test-creator-key",
    SHIELD_TOOLS_PATH: agentBin,
    PATH: `${userBin}:${originalPath || "/usr/bin:/bin"}`,
  });
  const live = await screen(liveCwd, liveConfig);
  delete process.env.SHIELD_TEST_CREATOR;
  delete process.env.CMD_API_KEY;
  delete process.env.SHIELD_TOOLS_PATH;
  process.env.PATH = originalPath;
  const report = (marker: string) =>
    items(live, "response")
      .filter((item) => !(item.data as any).streaming)
      .map((item) => (item.data as any).body as string)
      .filter((body) => body.includes(marker));
  await send(live, "/fixture-tools");
  await wait(() => report('"declared"').length === 1);
  assert.deepEqual(JSON.parse(report('"declared"')[0]!), { declared: ["codemode"], codemode: 1 });
  await send(live, "/fixture-environment");
  await wait(() => report('"creator"').length === 1 && idle(live));
  assert.deepEqual(JSON.parse(report('"creator"')[0]!), {
    creator: "creator",
    hubOnly: null,
    creatorKey: true,
    runtimeKey: true,
    probe: "dedicated",
  });
  // Attaching from another environment joins the agent without changing its environment.
  const other = await screen(liveCwd, liveConfig, { SHIELD_TEST_CREATOR: "replacement" });
  assert.equal(other.agent, live.agent);
  await other.takeWrite();
  await wait(() => other.writable);
  await send(other, "/fixture-environment");
  await wait(() => report('"creator"').length === 2 && idle(live));
  assert.equal(JSON.parse(report('"creator"')[1]!).creator, "creator");
  assert.equal(
    (await live.invoke("global.model_set", { model: "shield-faux/fixed" })).outcome,
    "done",
  );
  assert.equal((await live.invoke("global.thinking_set", { level: "high" })).outcome, "done");
  assert.equal(readFileSync(join(liveConfig, "settings.json"), "utf8"), settingsText);
  assert.equal(readFileSync(join(liveConfig, "models.json"), "utf8"), modelsText);

  console.log("keel: reboot without restoring agents");
  const oldHubPid = Number((await live.client.hub("ping")).payload["hub-pid"]);
  await live.client.hub("shutdown");
  await wait(() => !existsSync(socket) && !alive(oldHubPid));
  await startHub(socket);
  const reboot = await screen();
  assert.notEqual(reboot.agent, e.agent);
  assert.equal(items(reboot, "user").length, 0);
  await reboot.client.hub("shutdown");
  console.log(
    "keel compatibility passed: streaming reattach, snapshot equality, one writer, tool reattach, stop, pause, codemode scripts, requests, new session per runtime, real bash TERM, codemode-only tools, creator environment, reboot",
  );
} catch (error) {
  try {
    console.error(readFileSync(`${socket}.log`, "utf8"));
  } catch {}
  throw error;
} finally {
  await finish(socket, clients, dir);
}
