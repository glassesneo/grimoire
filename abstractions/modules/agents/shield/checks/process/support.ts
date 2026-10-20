// What every SHIELD process script needs: polling, a fake runtime launch, raw socket peers, and teardown.
import { rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { createConnection, type Socket } from "node:net";
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

/** Attach options that run `fake-runtime.ts` in `mode`, writing its pid to `<dir>/<mode>.pid`. */
export const fakeLaunch = (dir: string, mode = "normal", env: Record<string, string> = {}) => ({
  configDir: dir,
  launch: {
    executable: process.execPath,
    argv: [join(import.meta.dir, "fake-runtime.ts"), mode],
    env: { FIXTURE_PID: join(dir, `${mode}.pid`), ...env },
  },
});

export const attachPayload = (cwd: string, options: unknown, kind = "cwd", key = randomUUID()) => ({
  cwd,
  harness: "keel",
  options,
  selection: { kind, key },
});

/** An invocation's engine request payload. */
export const invoke = (action: string, args?: unknown) => ({
  op: "invoke",
  action,
  ...(args === undefined ? {} : { args }),
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
