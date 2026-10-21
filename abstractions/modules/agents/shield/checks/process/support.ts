// What every SHIELD process script needs: the packaged shield executable, polling, a fake
// driver launch, raw socket peers, the management contract, and teardown.
import { rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { createConnection, type Socket } from "node:net";
import Schema from "typebox/schema";
import management from "../../contracts/generated/management";
import { HubClient, JsonLines } from "../../client/protocol";

export const wait = async (predicate: () => boolean, timeout = 15000) => {
  const end = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > end) throw new Error("wait_timeout");
    await Bun.sleep(20);
  }
};

export const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Runs the packaged `shield` executable; rejects with its stderr when it fails. */
export function shield(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("shield", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (bytes) => (stdout += bytes));
    child.stderr.on("data", (bytes) => (stderr += bytes));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve(stdout) : reject(new Error(stderr.trim() || `shield exited ${code}`)),
    );
  });
}

/** Starts the hub at `socket` with `shield start`, as a person does. */
export const startHub = (socket: string) => shield(["--socket", socket, "start"]);

/** Attach options that run `fake-driver.ts` in `mode`, writing its pid to `<dir>/<mode>.pid`. */
export const fakeLaunch = (dir: string, mode = "normal", env: Record<string, string> = {}) => ({
  configDir: dir,
  launch: {
    executable: process.execPath,
    argv: [join(import.meta.dir, "fake-driver.ts"), mode],
    env: { FIXTURE_PID: join(dir, `${mode}.pid`), ...env },
  },
});

export const attachPayload = (cwd: string, options: unknown, kind = "cwd", key = randomUUID()) => ({
  cwd,
  harness: "keel",
  options,
  selection: { kind, key },
});

/** An invocation of the fake driver's action `name`, under the writer epoch a screen saw. */
export const invoke = (name: string, args?: unknown, writerEpoch?: number) => ({
  op: "invoke",
  action: `fake.${name}`,
  ...(args === undefined ? {} : { args }),
  ...(writerEpoch === undefined ? {} : { writerEpoch }),
});

/** HubClients that `finish` closes. */
export function clientsOf(socket: string) {
  const clients: HubClient[] = [];
  return {
    clients,
    connect: () => {
      const c = new HubClient(socket);
      clients.push(c);
      return c;
    },
  };
}

/** A socket peer that writes records by hand and keeps every record it reads. */
export async function rawClient(path: string, onRecord: (record: any) => void = () => {}) {
  const socket: Socket = createConnection({ path });
  const decoder = new JsonLines();
  const records: any[] = [];
  socket.on("error", () => {});
  socket.on("data", (bytes) => {
    for (const r of decoder.feed(bytes as Uint8Array)) {
      records.push(r);
      onRecord(r);
    }
  });
  await new Promise<void>((resolve) => socket.once("connect", resolve));
  return {
    socket,
    records,
    write: (record: unknown) => socket.write(JSON.stringify(record) + "\n"),
  };
}

const definitions = management.$defs;
type Definition = Extract<keyof typeof definitions, string>;
const validators = new Map<string, { Check(value: unknown): boolean }>();

/** Whether `value` conforms to the management contract's definition `name`. */
export function conforms(name: Definition, value: unknown): boolean {
  let validator = validators.get(name);
  if (!validator)
    validators.set(
      name,
      (validator = Schema.Compile({ $defs: definitions, $ref: `#/$defs/${name}` } as never)),
    );
  return validator.Check(value);
}

/** Shuts the hub down, closes the clients, and removes the scratch directory. */
export async function finish(socket: string, clients: HubClient[], dir: string) {
  const cleanup = new HubClient(socket);
  try {
    await cleanup.hub("shutdown");
  } catch {
  } finally {
    cleanup.close();
  }
  for (const c of clients) c.close();
  await Bun.sleep(300);
  rmSync(dir, { recursive: true, force: true });
}
