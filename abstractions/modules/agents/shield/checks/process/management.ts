// The management contract against what the shield executable and the hub actually exchange:
// a recording proxy sits between them, and every record either side writes must conform.
// This samples real exchanges; it does not prove every path of either side conforms.
import { strict as assert } from "node:assert";
import { chmodSync, mkdtempSync, readFileSync } from "node:fs";
import { createConnection, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonLines } from "../../client/protocol";
import {
  attachPayload,
  clientsOf,
  conforms,
  fakeLaunch,
  finish,
  shield,
  startHub,
} from "./support";

const dir = mkdtempSync(join(tmpdir(), "shield-management-"));
const socket = join(dir, "hub.sock");
const proxy = join(dir, "proxy.sock");
const { clients, connect } = clientsOf(socket);
const exchanged: { from: "cli" | "hub"; connection: number; record: any }[] = [];
let connections = 0;

const server = createServer((cli) => {
  const hub = createConnection({ path: socket });
  const connection = connections++;
  const record = (from: "cli" | "hub") => {
    const lines = new JsonLines();
    return (bytes: Uint8Array) => {
      for (const record of lines.feed(bytes)) exchanged.push({ from, connection, record });
    };
  };
  const fromCli = record("cli");
  const fromHub = record("hub");
  cli.on("data", (bytes: Buffer) => {
    fromCli(bytes);
    hub.write(bytes);
  });
  hub.on("data", (bytes: Buffer) => {
    fromHub(bytes);
    cli.write(bytes);
  });
  cli.on("close", () => hub.destroy());
  hub.on("close", () => cli.destroy());
  cli.on("error", () => {});
  hub.on("error", () => {});
});

try {
  await startHub(socket);
  await new Promise<void>((resolve) => server.listen(proxy, resolve));
  chmodSync(proxy, 0o600);
  const c = connect();
  const created = await c.hub("attach", attachPayload(dir, fakeLaunch(dir)));
  assert(created.success);
  const id = created.payload["agent-id"];

  assert.equal((await shield(["--socket", proxy, "start"])).trim(), `SHIELD ready: ${proxy}`);
  const listing = await shield(["--socket", proxy, "list"]);
  assert.match(listing, new RegExp(`^${id}\\t(starting|ready)\\tkeel/keel\\t${dir}$`, "m"));
  assert.equal(await shield(["--socket", proxy, "stop", id]), "");
  await assert.rejects(
    shield(["--socket", proxy, "stop", "no-such-agent"]),
    /shield: unknown_agent/,
  );
  await shield(["--socket", proxy, "shutdown"]);

  const requests = exchanged.filter((e) => e.from === "cli");
  const responses = exchanged.filter((e) => e.from === "hub");
  assert.deepEqual(
    requests.map((e) => e.record.method),
    ["ping", "list", "stop", "stop", "shutdown"],
  );
  for (const { record: r } of requests) {
    assert(conforms("Request", r), JSON.stringify(r));
    // The CLI names no agent and no engine, explicitly.
    assert.equal(r["agent-id"], null);
    assert.equal(r.engine, null);
  }
  for (const { record: r } of responses) assert(conforms("HubRecord", r), JSON.stringify(r));
  // Each run of the CLI is its own connection; a response answers its request there.
  const byMethod = (method: string) =>
    requests
      .filter((e) => e.record.method === method)
      .map(
        (e) =>
          responses.find((s) => s.connection === e.connection && s.record.id === e.record.id)!
            .record,
      );
  assert(conforms("PingResult", byMethod("ping")[0].payload));
  assert(byMethod("list")[0].payload.every((a: unknown) => conforms("AgentSummary", a)));
  const [stopped, unknown] = byMethod("stop");
  assert(conforms("Empty", stopped.payload));
  assert(conforms("Failure", unknown) && unknown.error.code === "unknown_agent");
  assert(conforms("Empty", byMethod("shutdown")[0].payload));
  console.log(
    "management checks passed: start, list, stop, a refused stop, and shutdown conform both ways",
  );
} catch (error) {
  try {
    console.error(readFileSync(`${socket}.log`, "utf8"));
  } catch {}
  throw error;
} finally {
  server.close();
  await finish(socket, clients, dir);
}
