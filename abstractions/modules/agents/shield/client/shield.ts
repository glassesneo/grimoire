import { spawn } from "node:child_process";
import { parseArgs } from "node:util";
import { openSync, closeSync, constants } from "node:fs";
import { HubClient } from "./protocol";
import { prepareSocket, socketPath } from "./paths";

/** Whether a hub answers at `path`; a missing or refusing socket means none does. */
async function ping(path: string): Promise<boolean> {
  const c = new HubClient(path);
  try {
    await c.connected;
    return (await c.hub("ping")).success === true;
  } catch (e: any) {
    if (["ENOENT", "ECONNREFUSED"].includes(e.code)) return false;
    throw e;
  } finally {
    c.close();
  }
}

export async function startHub(path: string) {
  prepareSocket(path);
  if (await ping(path)) return;
  const executable = process.env.SHIELD_LAUNCHER;
  if (!executable)
    throw new Error("SHIELD_LAUNCHER is missing; use the packaged shield executable");
  const log = openSync(
    `${path}.log`,
    constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW,
    0o600,
  );
  const child = spawn(executable, [], {
    detached: true,
    stdio: ["ignore", log, log],
    env: { ...process.env, SHIELD_SOCKET: path },
  });
  closeSync(log);
  let failure: Error | undefined;
  child.on("error", (e) => {
    failure = e;
  });
  child.unref();
  for (let i = 0; i < 100; i++) {
    if (failure) throw failure;
    await Bun.sleep(100);
    if (await ping(path)) return;
  }
  throw new Error(`hub not ready; another start may hold the lock. Inspect ${path}.log`);
}

export async function main(args = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      version: { type: "boolean" },
      help: { type: "boolean" },
      socket: { type: "string" },
    },
  });
  if (values.version) {
    console.log("shield 0.1.0");
    return;
  }
  if (values.help || args.length === 0) {
    console.log(`shield [--socket /absolute/hub.sock] start|list|stop <id>|shutdown
Starts and manages the SHIELD hub that runs Pi agents for quin. Pass the same --socket to quin.
Agents end with the hub; Pi's session files remain. After shutdown, wait for the hub to exit before starting another.
CommandCode keys come from CMD_API_KEY or COMMAND_CODE_API_KEY in the environment of shield start.`);
    return;
  }
  const path = socketPath(values.socket);
  const [method, id] = positionals;
  if (
    !["start", "list", "stop", "shutdown"].includes(method!) ||
    (method === "stop" ? positionals.length !== 2 : positionals.length !== 1)
  )
    throw new Error("invalid arguments; see shield --help");
  if (method === "start") {
    await startHub(path);
    console.log(`SHIELD ready: ${path}`);
    return;
  }
  const client = new HubClient(path);
  try {
    await client.connected;
    const r = await client.hub(method!, method === "stop" ? { id } : {});
    if (!r.success) throw new Error(r.error?.code || "request failed");
    if (method === "list")
      for (const a of r.payload)
        console.log(`${a["agent-id"]}\t${a.state}\t${a.harness}/${a.engine}\t${a.cwd}`);
  } finally {
    client.close();
  }
}
if (import.meta.main)
  main().catch((e) => {
    console.error(`shield: ${e.message}`);
    process.exitCode = 1;
  });
