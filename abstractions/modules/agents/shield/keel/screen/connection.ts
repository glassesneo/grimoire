/**
 * This screen's connection to one agent through the hub. It mirrors keel's
 * model from a snapshot and the events after it, follows the hub's management
 * records (lifecycle, writer), and sends invocations.
 *
 * When an event does not continue the mirror's sequence, the screen stops
 * sending changes, asks for a new snapshot, and replaces its mirror; no event
 * is replayed. A snapshot, event, or result that does not conform to the keel
 * contract is not applied at all: the screen closes the connection, which
 * frees its write right, and keeps showing the last state it applied with the
 * error. It neither reconnects nor resends, and edits the model had not
 * confirmed are not recovered. An invocation that was sent but not answered
 * when the connection ended has unknown acceptance, and is never sent again.
 */
import { HubClient, type Envelope } from "../../client/protocol";
import { type Applied, Mirror, SequenceGap } from "../protocol/apply";
import { firstError, validator } from "../protocol/contract";
import type { InvokeResult } from "../protocol/wire";
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
  /** Why the connection was closed for a record that does not conform. */
  #invalid: string | undefined;

  constructor(readonly client: HubClient) {
    super();
    client.onRecord = (record) => this.#record(record);
    client.onDisconnect = (error) => {
      if (this.#detached || this.#invalid) return;
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
    // A screen closed for an invalid record keeps what it showed; nothing later applies, the
    // rest of the read the record came in included.
    if (this.#invalid) return;
    try {
      if (r.type === "agent_failed") {
        if (this.agent === undefined || r["agent-id"] === this.agent) {
          this.lifecycle = "failed";
          this.phase = "ended";
        }
      } else if (r.type === "snapshot") {
        const snapshot = r.payload;
        if (!validator("Snapshot").Check(snapshot))
          return this.#reject(`snapshot: ${firstError("Snapshot", snapshot)}`);
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
        // Only the event is checked; the state it applies to already was. One that arrives
        // while the screen resynchronizes is checked too, then dropped.
        if (!validator("StateEvent").Check(r.payload))
          return this.#reject(`event: ${firstError("StateEvent", r.payload)}`);
        if (this.phase !== "live") return;
        const applied = this.mirror.apply(r.payload);
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

  /** Stops following the agent after a record that does not conform. */
  #reject(problem: string): void {
    this.#invalid = problem;
    this.notice = `closed: the agent sent an invalid ${problem}`;
    this.phase = "ended";
    this.client.close();
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

  /** Runs an action through the model and resolves with its result. */
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
      if (!validator("InvokeResult").Check(r.payload)) {
        this.#reject(`result: ${firstError("InvokeResult", r.payload)}`);
        return {
          outcome: "unknown",
          code: "invalid_result",
          message: "the agent's answer was invalid",
        };
      }
      return r.payload;
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
