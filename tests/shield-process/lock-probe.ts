// The actual Nix foreground release must retain fd9, while a Port child must not.
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { strict as assert } from "node:assert";
import { HubClient } from "../../abstractions/modules/agents/shield/client/protocol";
import { startHub } from "../../abstractions/modules/agents/shield/client/shield";

const directory = mkdtempSync(join(tmpdir(), "shield-lock-"));
const socket = join(directory, "hub.sock");
let client: HubClient | undefined;
let beam: number | undefined;
let child: number | undefined;
const lock = () => spawnSync("/bin/sh", ["-c", 'exec 9<>"$1"; /usr/bin/lockf -s -t 0 9', "probe", `${socket}.lock`]).status;
try {
  await Promise.all([startHub(socket), startHub(socket)]);
  assert.notEqual(lock(), 0, "foreground release lost its lock");
  client = new HubClient(socket);
  await client.connected;
  const fake = join(directory, "fake-rpc.mjs");
  writeFileSync(fake, `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(join(directory, "child.pid"))}, String(process.pid)); process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);`);
  const r = client.hub("attach", { cwd: directory, harness: "quin", options: { mode: "mock", model: "fixture/fixed", launch: { executable: process.env.SHIELD_NODE || process.execPath, argv: [fake], env: {} } } }).catch(() => undefined);
  await Bun.sleep(200);
  beam = Number((await client.hub("ping")).payload["hub-pid"]);
  child = Number(readFileSync(join(directory, "child.pid"), "utf8"));
  assert(beam && child);
  process.kill(beam!, "SIGKILL");
  await Bun.sleep(300);
  assert.equal(lock(), 0, "Port child retained fd9 after BEAM died");
  process.kill(child!, 0);
  // This crash leaves a refused stale socket. Next start must recover it.
  await startHub(socket);
  const reopened = new HubClient(socket);
  await reopened.connected;
  assert((await reopened.hub("ping")).success);
  await reopened.hub("shutdown");
  reopened.close();
  await r;
  console.log("lock probe passed: concurrent start, foreground retention, Port exclusion, KILL/stale recovery");
} finally {
  client?.close();
  if (child) { try { process.kill(child, "SIGKILL"); } catch {} }
  rmSync(directory, { recursive: true, force: true });
}
