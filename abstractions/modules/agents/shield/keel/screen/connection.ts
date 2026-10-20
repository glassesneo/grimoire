/**
 * This screen's connection to one agent through the hub. It mirrors the
 * runtime's state from a snapshot and the events after it, follows the hub's
 * management records (lifecycle, writer), and sends invocations.
 *
 * When an event does not continue the mirror's sequence, the screen stops
 * sending changes, asks for a new snapshot, and replaces its mirror; no event
 * is replayed. An invocation that was sent but not answered when the
 * connection ended has unknown acceptance, and is never sent again.
 */
import { HubClient, type Envelope } from "../../client/protocol";
import { type Applied, Mirror, SequenceGap } from "../protocol/apply";
import type { InvokeResult, Snapshot, StateEvent } from "../protocol/wire";
import { Emitter } from "./ui/controllers";

/** Lifecycles that end an agent, or this connection to it. */
const TERMINAL = new Set(["exited", "failed", "disconnected"]);

export type ConnectionPhase = "connecting" | "syncing" | "live" | "ended";

export class Connection extends Emitter {
  readonly mirror = new Mirror();
  agent: string | undefined;
  /** This connection's name at the hub, as the writer is named. */
  id: string | undefined;
  writer: { connection: string | null; epoch: number } = { connection: null, epoch: 0 };
  lifecycle = "connecting";
  phase: ConnectionPhase = "connecting";
  /** A transient message for the status line. */
  notice: string | undefined;
  /** Called with what an applied event changed, or undefined after a new snapshot. */
  onState: (applied: Applied | undefined) => void = () => {};
  /** Called once, when this screen detaches. */
  onDetach: () => void = () => {};
  #detached = false;

  constructor(readonly client: HubClient) {
    super();
    client.onRecord = (record) => this.#record(record);
    client.onDisconnect = (error) => {
      if (this.#detached) return;
      if (!TERMINAL.has(this.lifecycle)) {
        this.notice = error.message;
        this.lifecycle = "disconnected";
      }
      this.phase = "ended";
      this.changed();
    };
  }

  get writable(): boolean {
    return this.phase === "live" && this.id !== undefined && this.writer.connection === this.id;
  }

  /** Attaches, creating the agent if the directory has none; resolves once the snapshot arrived. */
  async attach(payload: Record<string, unknown>): Promise<void> {
    const r = await this.client.hub("attach", payload);
    if (!r.success) throw new Error(r.error?.code ?? "attach refused");
  }

  #record(r: Envelope): void {
    try {
      if (r.type === "agent_failed") {
        if (this.agent === undefined || r["agent-id"] === this.agent) {
          this.lifecycle = "failed";
          this.phase = "ended";
        }
      } else if (r.type === "snapshot") {
        const snapshot = r.payload as Snapshot;
        this.agent = r["agent-id"] ?? undefined;
        this.id = r.connection;
        this.lifecycle = r.lifecycle ?? this.lifecycle;
        const writer = r.writer;
        if (writer) this.writer = writer;
        this.mirror.reset(snapshot);
        this.phase = "live";
        this.notice = undefined;
        this.onState(undefined);
      } else if (r.type === "event") {
        if (this.phase !== "live") return;
        const applied = this.mirror.apply(r.payload as StateEvent);
        this.onState(applied);
      } else if (r.type === "management") {
        const payload = r.payload as { op: string; [key: string]: any };
        if (payload.op === "lifecycle") {
          this.lifecycle = payload.state;
          if (TERMINAL.has(payload.state)) this.phase = "ended";
        } else if (payload.op === "writer") {
          this.writer = { connection: payload.connection, epoch: payload.epoch };
        }
      }
    } catch (error) {
      if (error instanceof SequenceGap) {
        this.notice = `resynchronizing: ${error.message}`;
        void this.resync();
      } else {
        this.notice = (error as Error).message;
      }
    }
    this.changed();
  }

  /** Replaces the mirror from a new snapshot; nothing is changed meanwhile. */
  async resync(): Promise<void> {
    if (!this.agent || this.phase === "syncing" || this.phase === "ended") return;
    this.phase = "syncing";
    this.changed();
    try {
      const r = await this.client.engine(this.agent, { op: "snapshot" });
      if (!r.success) throw new Error(r.error?.code ?? "snapshot refused");
    } catch (error) {
      this.notice = `resynchronizing failed: ${(error as Error).message}`;
      this.phase = "ended";
      this.changed();
    }
  }

  /** Why nothing can be sent now, or undefined. */
  get unavailable(): string | undefined {
    if (this.phase === "syncing") return "resynchronizing with the agent";
    if (this.phase !== "live" || !this.agent) return `the agent is ${this.lifecycle}`;
    if (this.lifecycle !== "ready") return `the agent is ${this.lifecycle}`;
    return undefined;
  }

  /** Runs an action in the runtime and resolves with its result. */
  async invoke(action: string, args?: unknown): Promise<InvokeResult> {
    const unavailable = this.unavailable;
    if (unavailable) return { outcome: "rejected", code: "unavailable", message: unavailable };
    try {
      const r = await this.client.engine(this.agent!, {
        op: "invoke",
        action,
        writerEpoch: this.writer.epoch,
        ...(args === undefined ? {} : { args }),
      });
      if (!r.success)
        return { outcome: "rejected", code: r.error?.code ?? "refused", message: r.error?.code };
      return r.payload as InvokeResult;
    } catch (error) {
      return { outcome: "rejected", code: "unknown", message: (error as Error).message };
    }
  }

  async takeWrite(): Promise<void> {
    if (!this.agent) return;
    const r = await this.client.request("hub_request", this.agent, {}, "take_write");
    if (!r.success) throw new Error(r.error?.code ?? "take_write refused");
  }

  /** Closes this screen's connection; the agent keeps running. */
  detach(): void {
    if (this.#detached) return;
    this.#detached = true;
    this.client.close();
    this.onDetach();
  }
}
