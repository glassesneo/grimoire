/**
 * Screens linked to a scripted agent through a stand-in for the hub that keeps the hub's
 * rules screens rely on: the first live screen writes, take_write moves the right, a screen
 * that leaves frees it, events reach only live screens, and a snapshot goes to the screen
 * that asked. The agent's state is a minimal fixture the test changes with `publish`; every
 * invocation is recorded and answered by the test's handlers. What keel's model decides is
 * tested in Elixir; this covers what the screen shows and sends.
 */
import type { Envelope, HubClient } from "../../client/protocol";
import shared from "../../contracts/state.json";
import type { ActionInfo, Changes, InvokeResult, State } from "../protocol/wire";
import { Connection } from "./connection";

type Action = [
  id: string,
  keys?: string[],
  options?: { class?: ActionInfo["class"]; local?: boolean },
];

/** The run control the driver always declares. */
const DRIVER: Action[] = [
  ["global.stop", [], { class: "control" }],
  ["global.pause", [], { class: "control" }],
  ["global.resume", [], { class: "control" }],
];

/** The timeline extension's actions, for tests that use the timeline region. */
export const TIMELINE: Action[] = [
  ["timeline.cursor_down", ["j", "down"], { class: "view", local: true }],
  ["timeline.cursor_up", ["k", "up"], { class: "view", local: true }],
  ["timeline.focus_editor", ["escape"], { class: "view", local: true }],
  ["editor.command_open", ["ctrl+g"], { class: "view", local: true }],
];

/**
 * A state as the model publishes it: keel's own actions as the model declares them (the
 * shared fixture contracts/state.json, which the hub's tests check against the model), the
 * driver's run control, and `extra` actions, with `keys` replacing chords.
 */
export function fixture(extra: Action[] = [], keys: Record<string, string[]> = {}): State {
  const state = structuredClone(shared.snapshot.state) as unknown as State;
  for (const [id, chords, options] of [...DRIVER, ...extra]) {
    state.actions.push({ id, class: options?.class ?? "write", local: options?.local ?? false });
    state.keys[id] = id.startsWith("global.") ? [] : (chords ?? []);
  }
  Object.assign(state.keys, keys);
  return state;
}

interface Invocation {
  connection: string;
  action: string;
  args: any;
  writerEpoch: number | undefined;
}

type Handler = (invocation: Invocation) => InvokeResult | Promise<InvokeResult>;

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
    this.owner.snapshot(this);
    return this.#ok({});
  }

  #ok(payload: unknown): Envelope {
    return { v: 1, type: "response", "agent-id": "agent", engine: "keel", success: true, payload };
  }

  async engine(_agent: string, payload: any): Promise<Envelope> {
    if (payload.op === "snapshot") {
      this.owner.snapshot(this);
      return this.#ok({});
    }
    return this.#ok(
      await this.owner.invoke({
        connection: this.id,
        action: payload.action,
        args: payload.args,
        writerEpoch: payload.writerEpoch,
      }),
    );
  }

  async request(_type: string, _agent: string | null, _payload: unknown, method?: string) {
    if (method !== "take_write") throw new Error(`unexpected request ${method}`);
    this.owner.setWriter(this);
    return this.#ok({});
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
  seq = 0;
  instance = "model-1";
  readonly invocations: Invocation[] = [];
  readonly handlers = new Map<string, Handler>();

  constructor(public state: State = fixture()) {
    // Typing reaches the draft it started from, as the model keeps it.
    this.handlers.set("draft.set", ({ args }) => {
      const draft = this.state.drafts[args.destination];
      if (!draft) return { outcome: "rejected", code: "closed_destination" };
      if (draft.revision !== args.base) return { outcome: "rejected", code: "stale_revision" };
      const revision = draft.revision + 1;
      this.publish({
        drafts: { ...this.state.drafts, [args.destination]: { text: args.text, revision } },
      });
      return { outcome: "done", appliedSeq: this.seq, detail: { revision } };
    });
  }

  /** Changes the state as one event, which live screens receive. */
  publish(changes: Changes): void {
    const { items, order, ...sections } = changes;
    const upserts = new Map((items ?? []).map((item) => [item.id, item]));
    const previous = new Map(this.state.items.map((item) => [item.id, item]));
    const next = order
      ? order.map((id) => upserts.get(id) ?? previous.get(id)!)
      : this.state.items.map((item) => upserts.get(item.id) ?? item);
    this.state = { ...this.state, ...sections, items: next } as State;
    this.seq++;
    for (const client of this.clients)
      if (client.live)
        client.deliver({
          type: "event",
          payload: { instance: this.instance, seq: this.seq, changes },
        });
  }

  /** The snapshots screens asked for, a first attach included. */
  snapshots = 0;

  snapshot(client: FakeClient): void {
    this.snapshots++;
    if (!this.writer) this.setWriter(client);
    client.live = true;
    client.deliver({
      type: "snapshot",
      connection: client.id,
      lifecycle: "ready",
      writer: { connection: this.writer?.id ?? null, epoch: this.epoch },
      payload: { instance: this.instance, seq: this.seq, state: this.state },
    });
  }

  async invoke(invocation: Invocation): Promise<InvokeResult> {
    this.invocations.push(invocation);
    const handler = this.handlers.get(invocation.action);
    return handler ? handler(invocation) : { outcome: "done", appliedSeq: this.seq };
  }

  /** The recorded invocations of `action`. */
  sent(action: string): Invocation[] {
    return this.invocations.filter((invocation) => invocation.action === action);
  }

  setWriter(client: FakeClient | undefined): void {
    this.writer = client;
    this.epoch++;
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

/** Resolves once `check` holds, polling; fails after `timeout` milliseconds. */
export async function until(check: () => boolean, timeout = 5000): Promise<void> {
  const end = Date.now() + timeout;
  while (!check()) {
    if (Date.now() > end) throw new Error("condition not reached");
    await Bun.sleep(5);
  }
}
