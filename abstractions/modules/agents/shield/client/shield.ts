import { spawn } from "node:child_process";
import { openSync, closeSync, constants } from "node:fs";
import { HubClient } from "./protocol";
import { prepareSocket, socketPath } from "./paths";

export async function startHub(path: string) {
  prepareSocket(path);
  try {
    const c = new HubClient(path);
    try { await c.connected; const r = await c.hub("ping"); if (r.success) return; }
    finally { c.close(); }
  } catch (e: any) {
    if (!["ENOENT", "ECONNREFUSED"].includes(e.code)) throw e;
  }
  const executable = process.env.SHIELD_LAUNCHER;
  if (!executable) throw new Error("SHIELD_LAUNCHER is missing; use the packaged shield executable");
  const log = openSync(`${path}.log`, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
  const child = spawn(executable, [], { detached: true, stdio: ["ignore", log, log], env: { ...process.env, SHIELD_SOCKET: path } });
  closeSync(log);
  let failure: Error | undefined;
  child.on("error", e => { failure = e; });
  child.unref();
  for (let i = 0; i < 100; i++) {
    if (failure) throw failure;
    await Bun.sleep(100);
    const c = new HubClient(path);
    try { await c.connected; const r = await c.hub("ping"); if (r.success) return; }
    catch (e: any) { if (!["ENOENT", "ECONNREFUSED"].includes(e.code)) throw e; }
    finally { c.close(); }
  }
  throw new Error(`hub not ready; another start may hold the lock. Inspect ${path}.log`);
}

export async function main(args = process.argv.slice(2)) {
  if (args.includes("--version")) { console.log("shield 0.1.0"); return; }
  if (args.includes("--help") || args.length === 0) { console.log("shield [--socket /absolute/hub.sock] start|list|stop <id>|shutdown"); return; }
  const index = args.indexOf("--socket");
  let socket: string | undefined;
  if (index !== -1) { socket = args[index + 1]; if (!socket) throw new Error("--socket requires a path"); args.splice(index, 2); }
  const path = socketPath(socket);
  const [method, id] = args;
  if (!["start", "list", "stop", "shutdown"].includes(method!) || (method === "stop" ? args.length !== 2 : args.length !== 1)) throw new Error("invalid arguments; see shield --help");
  if (method === "start") { await startHub(path); console.log(`SHIELD ready: ${path}`); return; }
  const client = new HubClient(path);
  try {
    await client.connected;
    const r = await client.hub(method!, method === "stop" ? { id } : {});
    if (!r.success) throw new Error(r.error?.code || "request failed");
    if (method === "list") for (const a of r.payload) console.log(`${a["agent-id"]}\t${a.state}\t${a.harness}/${a.engine}\t${a.cwd}`);
  } finally { client.close(); }
}
if (import.meta.main) main().catch(e => { console.error(`shield: ${e.message}`); process.exitCode = 1; });
