/**
 * Screens linked to a real in-process runtime through a stand-in for the hub
 * that keeps the hub's rules screens rely on: the first live screen writes,
 * take_write moves the right, a screen that leaves frees it, events reach
 * only live screens, and a snapshot goes to the screen that asked. The hub's
 * own implementation of these rules is tested in Elixir.
 */
import type { Envelope, HubClient } from "../../client/protocol";
import type { InvokeResult, RuntimeOutput } from "../protocol/wire";
import { type Harness, harness } from "../runtime/test-support";
import { Connection } from "./connection";

class FakeClient {
  onRecord: (record: Envelope) => void = () => {};
  onDisconnect: (error: Error) => void = () => {};
  readonly connected = Promise.resolve();
  live = false;
  closed = false;
  constructor(
    readonly owner: FakeHub,
    readonly id: string,
  ) {}

  deliver(record: Record<string, unknown>): void {
    if (this.closed) return;
    this.onRecord({ v: 1, "agent-id": "agent", engine: "keel", ...record } as Envelope);
  }

  async hub(method: string): Promise<Envelope> {
    if (method !== "attach") throw new Error(`unexpected hub method ${method}`);
    await this.owner.snapshot(this);
    return {
      v: 1,
      type: "response",
      "agent-id": "agent",
      engine: "keel",
      success: true,
      payload: {},
    };
  }

  async engine(_agent: string, payload: any): Promise<Envelope> {
    const ok = (value: unknown): Envelope => ({
      v: 1,
      type: "response",
      "agent-id": "agent",
      engine: "keel",
      success: true,
      payload: value,
    });
    if (payload.op === "snapshot") {
      await this.owner.snapshot(this);
      return ok({});
    }
    return ok(await this.owner.invoke(this, payload.action, payload.args, payload.writerEpoch));
  }

  async request(
    _type: string,
    _agent: string | null,
    _payload: unknown,
    method?: string,
  ): Promise<Envelope> {
    if (method !== "take_write") throw new Error(`unexpected request ${method}`);
    this.owner.setWriter(this);
    return {
      v: 1,
      type: "response",
      "agent-id": "agent",
      engine: "keel",
      success: true,
      payload: {},
    };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.owner.leave(this);
  }
}

export class FakeHub {
  readonly clients: FakeClient[] = [];
  writer: FakeClient | undefined;
  epoch = 0;
  #next = 0;
  readonly #snapshots = new Map<string, { client: FakeClient; resolve: () => void }>();
  readonly #invokes = new Map<string, (result: InvokeResult) => void>();
  h!: Harness;

  record(record: RuntimeOutput): void {
    if (record.type === "event") {
      for (const client of this.clients)
        if (client.live) client.deliver({ type: "event", payload: record.event });
    } else if (record.type === "snapshot") {
      const pending = this.#snapshots.get(record.id);
      if (!pending) return;
      this.#snapshots.delete(record.id);
      if (!this.writer) this.setWriter(pending.client);
      pending.client.live = true;
      pending.client.deliver({
        type: "snapshot",
        connection: pending.client.id,
        lifecycle: "ready",
        writer: { connection: this.writer?.id ?? null, epoch: this.epoch },
        payload: record.snapshot,
      });
      pending.resolve();
    } else if (record.type === "result") {
      this.#invokes.get(record.id)?.(record.result);
      this.#invokes.delete(record.id);
    }
  }

  snapshot(client: FakeClient): Promise<void> {
    const id = `s${this.#next++}`;
    client.live = false;
    return new Promise((resolve) => {
      this.#snapshots.set(id, { client, resolve });
      this.h.runtime.handle({ type: "snapshot_request", id });
    });
  }

  invoke(
    client: FakeClient,
    action: string,
    args: unknown,
    writerEpoch?: number,
  ): Promise<InvokeResult> {
    const id = `i${this.#next++}`;
    return new Promise((resolve) => {
      this.#invokes.set(id, resolve);
      this.h.runtime.handle({
        type: "invoke",
        id,
        connection: client.id,
        invoke: { action, ...(args === undefined ? {} : { args }), writerEpoch },
      });
    });
  }

  setWriter(client: FakeClient | undefined): void {
    this.writer = client;
    this.epoch++;
    this.h.runtime.handle({ type: "writer", connection: client?.id ?? null, epoch: this.epoch });
    for (const other of this.clients)
      other.deliver({
        type: "management",
        payload: { op: "writer", connection: client?.id ?? null, epoch: this.epoch },
      });
  }

  leave(client: FakeClient): void {
    const index = this.clients.indexOf(client);
    if (index !== -1) this.clients.splice(index, 1);
    if (this.writer === client) this.setWriter(undefined);
  }

  /** A new screen's connection, attached. */
  async connect(): Promise<Connection> {
    const client = new FakeClient(this, `c${this.clients.length + 1}`);
    this.clients.push(client);
    const connection = new Connection(client as unknown as HubClient);
    await connection.attach({});
    return connection;
  }
}

/** A runtime and a hub stand-in; screens connect through `hub.connect()`. */
export async function linked(options: Parameters<typeof harness>[0] = {}) {
  const hub = new FakeHub();
  const h = await harness({ ...options, observe: (record) => hub.record(record) });
  hub.h = h;
  // The runtime harness took the write for itself; screens start from nobody.
  h.runtime.handle({ type: "writer", connection: null, epoch: 0 });
  return { hub, h };
}
