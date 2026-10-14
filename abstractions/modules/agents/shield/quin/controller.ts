/**
 * The connection to one agent: applies the hub's records to the Pi view and
 * sends prompts, dialog replies, and interrupts. Focus, drafts, selection, and
 * disclosure belong to the UI controllers, not here.
 */
import { HubClient, type Envelope } from "../client/protocol";
import { Emitter } from "./ui/controllers";
import { STATS_EVENTS, type SessionStats } from "./usage";
import { PiAdapter } from "./view";

/** Lifecycles that end an agent, or this connection to it. */
const TERMINAL = new Set(["exited", "failed", "disconnected"]);

export class Controller extends Emitter {
  readonly adapter = new PiAdapter();
  /** Until this time, the interrupt key confirms instead of arming. */
  armedUntil = 0;
  /** A transient message for the status line, replaced by the next record. */
  notice: string | undefined = "Connecting to SHIELD…";
  stats: SessionStats | undefined;
  onDetach: () => void = () => {};
  /** Pi's set_editor_text request. */
  onEditorText: (text: string) => void = () => {};
  private statsPending = false;
  private statsStale = false;
  private detached = false;

  constructor(readonly client: HubClient) {
    super();
    client.onRecord = r => this.record(r);
    client.onDisconnect = e => {
      if (this.detached) return;
      this.armedUntil = 0;
      // The hub closes the socket after reporting a failure; the end it reported stays.
      if (TERMINAL.has(this.adapter.lifecycle)) { this.changed(); return; }
      this.notice = e.message;
      this.adapter.lifecycle = "disconnected";
      this.armedUntil = 0;
      this.changed();
    };
  }

  record(r: Envelope) {
    try {
      this.adapter.apply(r);
      if (!this.active) this.armedUntil = 0;
      const record = r.payload?.record;
      if (record?.type === "extension_ui_request" && record.method === "set_editor_text") this.onEditorText(record.text || "");
      this.notice = undefined;
      if (r.type === "snapshot" || STATS_EVENTS.has(record?.type)) this.refreshStats();
    } catch (e) {
      this.notice = (e as Error).message;
      this.adapter.lifecycle = "disconnected";
      this.client.close();
    }
    this.changed();
  }

  get active() {
    const run = this.adapter.view.run;
    return this.adapter.lifecycle === "ready" && (run.active || run.accepting > 0 || run.compaction || run.retry || run.interrupting);
  }

  /** Lifecycle and the latest notice, for the status line; empty while ready and quiet. */
  get status(): string {
    return [this.adapter.lifecycle === "ready" ? undefined : this.adapter.lifecycle, this.notice].filter(Boolean).join(" · ");
  }

  fail(message: string) {
    this.notice = message;
    this.changed();
  }

  async send(payload: unknown) {
    if (!this.adapter.agent) throw new Error("agent is not ready");
    const r = await this.client.engine(this.adapter.agent, payload);
    if (!r.success) {
      const pi = (r as any).payload?.error;
      throw new Error(r.error?.code === "model_required" ? "Set --model provider/id or shield/pi/settings.json defaultProvider/defaultModel"
        : r.error?.code === "pi_rejected" && typeof pi === "string" ? pi : r.error?.code || "request rejected");
    }
    return r;
  }

  /** Resolves whether Pi accepted the prompt; while a run is active it becomes a follow-up. */
  async sendPrompt(text: string): Promise<boolean> {
    if (this.adapter.lifecycle !== "ready") return false;
    try {
      await this.send({ op: "rpc", record: { type: "prompt", message: text, ...(this.active ? { streamingBehavior: "followUp" } : {}) } });
      return true;
    } catch (e) {
      this.fail((e as Error).message);
      return false;
    }
  }

  async replyDialog(id: string, reply: Record<string, unknown>) {
    try { await this.send({ op: "dialog_reply", id, ...reply }); }
    catch (e) { this.fail((e as Error).message); }
  }

  /**
   * The interrupt key: idle, it reports `idle` so the caller clears the input;
   * during a run the first press arms and a second within a second interrupts.
   */
  interrupt(now = Date.now()): "idle" | "armed" | "sent" {
    if (!this.active) {
      this.disarm();
      return "idle";
    }
    if (this.armedUntil && now <= this.armedUntil) {
      this.armedUntil = 0;
      void this.send({ op: "interrupt" }).catch(e => this.fail(e.message));
      this.changed();
      return "sent";
    }
    this.armedUntil = now + 1000;
    this.changed();
    return "armed";
  }

  /** Any other operation cancels a pending confirmation. */
  disarm() {
    if (!this.armedUntil) return;
    this.armedUntil = 0;
    this.changed();
  }

  tick(now = Date.now()) {
    if (this.armedUntil && now > this.armedUntil) this.disarm();
  }

  detach() {
    if (this.detached) return;
    this.detached = true;
    this.client.close();
    this.onDetach();
  }

  /** Reads Pi's totals again; requests never overlap, and a refresh asked for meanwhile runs once afterwards. */
  refreshStats() {
    if (this.adapter.lifecycle !== "ready" || !this.adapter.agent) return;
    if (this.statsPending) { this.statsStale = true; return; }
    this.statsPending = true;
    this.send({ op: "rpc", record: { type: "get_session_stats" } })
      .then(r => { this.stats = (r as any).payload?.data; this.changed(); })
      .catch(() => {})
      .finally(() => { this.statsPending = false; if (this.statsStale) { this.statsStale = false; this.refreshStats(); } });
  }
}
