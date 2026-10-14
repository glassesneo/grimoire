import { HubClient, type Envelope } from "../client/protocol";
import { PiAdapter, type Entry } from "./view";
export type Region = "editor" | "timeline" | "stage";
export type ScrollAmount = "half-down" | "half-up" | "page-down" | "page-up" | "selection";
// Timeline-only, as in the harness: the editor keeps these chords for cursor movement and deletion.
const TIMELINE_SCROLL: Record<string, ScrollAmount> = { d: "half-down", u: "half-up", f: "page-down", b: "page-up" };
const isEnter = (name: string) => name === "return" || name === "kpenter";
export interface Key { name: string; ctrl?: boolean; shift?: boolean; preventDefault(): void }

export class Controller {
  readonly adapter = new PiAdapter();
  focus: Region = "editor";
  private restoreFocus: Region = "editor";
  promptDraft = "";
  dialogDraft = "";
  dialogId: string | undefined;
  cursor = 0;
  selected = 0;
  choice = 0;
  expanded = new Set<string>();
  armedUntil = 0;
  status = "Connecting to SHIELD…";
  promptSending = false;
  stats: SessionStats | undefined;
  private statsPending = false;
  private statsStale = false;
  private dialogSendingId: string | undefined;
  private detached = false;
  changed: () => void = () => {};
  scroll: (amount: ScrollAmount) => void = () => {};
  copy: (text: string) => Promise<boolean> = async () => false;
  onDetach: () => void = () => {};
  readEditor?: () => { text: string; cursor: number };
  constructor(readonly client: HubClient) {
    client.onRecord = r => this.record(r);
    client.onDisconnect = e => { if (!this.detached) { if (this.adapter.lifecycle !== "disconnected") this.status = e.message; this.adapter.lifecycle = "disconnected"; this.armedUntil = 0; this.changed(); } };
  }
  record(r: Envelope) {
    try {
      this.adapter.apply(r);
      const next = Object.keys(this.adapter.view.dialogs)[0];
      if (next !== this.dialogId) {
        if (!this.dialogId && next) this.restoreFocus = this.focus;
        this.dialogId = next;
        this.choice = 0;
        this.dialogDraft = this.dialog?.prefill || "";
        this.cursor = this.text.length;
        this.focus = next ? (["select", "confirm"].includes(this.dialog.method) ? "stage" : "editor") : this.restoreFocus;
      }
      if (!this.active) this.armedUntil = 0;
      if (r.payload?.record?.type === "extension_ui_request" && r.payload.record.method === "set_editor_text") { this.promptDraft = r.payload.record.text || ""; if (!this.dialogId) this.cursor = this.text.length; }
      this.status = this.adapter.lifecycle;
      if (r.type === "snapshot" || STATS_EVENTS.has(r.payload?.record?.type)) this.refreshStats();
      this.changed();
    } catch (e) {
      this.status = (e as Error).message;
      this.adapter.lifecycle = "disconnected";
      this.client.close();
      this.changed();
    }
  }
  get dialog() { return this.dialogId ? this.adapter.view.dialogs[this.dialogId] : undefined; }
  get text() { return this.dialogId && ["input", "editor"].includes(this.dialog?.method) ? this.dialogDraft : this.promptDraft; }
  get active() { return this.adapter.lifecycle === "ready" && (this.adapter.view.run.active || this.adapter.view.run.accepting > 0 || this.adapter.view.run.compaction || this.adapter.view.run.retry || this.adapter.view.run.interrupting); }
  get entries() { return this.adapter.view.timeline.entries; }
  get current(): Entry | undefined { return this.entries[this.selected]; }
  get choices(): string[] { return this.dialog?.method === "confirm" ? ["Yes", "No"] : this.dialog?.options || []; }
  setText(text: string, cursor = text.length) { this.armedUntil = 0; if (this.dialogId && ["input", "editor"].includes(this.dialog?.method)) this.dialogDraft = text; else this.promptDraft = text; this.cursor = cursor; this.changed(); }
  async send(payload: unknown) {
    if (!this.adapter.agent) throw new Error("agent is not ready");
    const r = await this.client.engine(this.adapter.agent, payload);
    if (!r.success) throw new Error(r.error?.code === "model_required" ? "Set --model provider/id or shield/pi/settings.json defaultProvider/defaultModel" : r.error?.code || "request rejected");
    return r;
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
  async submit() {
    if (this.adapter.lifecycle !== "ready") return;
    // Content-change callbacks may lag a batch of terminal input containing Enter.
    const latest = this.focus === "editor" ? this.readEditor?.() : undefined;
    if (latest) this.setText(latest.text, latest.cursor);
    const original = this.text;
    if (this.dialogId) {
      const id = this.dialogId;
      if (this.dialogSendingId === id) return;
      const d = this.dialog;
      const reply = d.method === "confirm" ? { confirmed: this.choice === 0 } : { value: d.method === "select" ? this.choices[this.choice] : original };
      await this.replyDialog(id, reply);
      return;
    }
    if (this.promptSending || !original.trim()) return;
    this.promptSending = true;
    try {
      await this.send({ op: "rpc", record: { type: "prompt", message: original, ...(this.active ? { streamingBehavior: "followUp" } : {}) } });
      if (this.promptDraft === original) this.setText("");
    } catch (e) { this.status = (e as Error).message; }
    finally { this.promptSending = false; this.changed(); }
  }
  async cancelDialog() {
    const id = this.dialogId;
    if (!id || this.dialogSendingId === id) return;
    await this.replyDialog(id, { cancelled: true });
  }
  private async replyDialog(id: string, reply: Record<string, unknown>) {
    this.dialogSendingId = id;
    try { await this.send({ op: "dialog_reply", id, ...reply }); }
    catch (e) { this.status = (e as Error).message; }
    finally { if (this.dialogSendingId === id) this.dialogSendingId = undefined; this.changed(); }
  }
  detach() { if (this.detached) return; this.detached = true; this.client.close(); this.onDetach(); }
  tick(now = Date.now()) { if (this.armedUntil && now > this.armedUntil) { this.armedUntil = 0; this.changed(); } }
  key(k: Key, now = Date.now()) {
    if (k.ctrl && k.name === "q") { k.preventDefault(); this.detach(); return; }
    if (k.ctrl && k.name === "c") {
      k.preventDefault();
      if (!this.active) { this.armedUntil = 0; this.setText(""); }
      else if (this.armedUntil && now <= this.armedUntil) {
        this.armedUntil = 0;
        void this.send({ op: "interrupt" }).catch(e => { this.status = e.message; this.changed(); });
      } else this.armedUntil = now + 1000;
      this.changed(); return;
    }
    this.armedUntil = 0;
    if (k.name === "escape") { k.preventDefault(); if (this.dialogId) void this.cancelDialog(); else this.focus = "editor"; this.changed(); return; }
    if (k.name === "tab") { k.preventDefault(); const regions: Region[] = this.dialogId ? ["editor", "timeline", "stage"] : ["editor", "timeline"]; this.focus = regions[(regions.indexOf(this.focus) + (k.shift ? regions.length - 1 : 1)) % regions.length]!; this.changed(); return; }
    if (this.focus === "timeline") {
      if (k.ctrl && TIMELINE_SCROLL[k.name]) { k.preventDefault(); this.scroll(TIMELINE_SCROLL[k.name]!); this.changed(); return; }
      if (["j", "down", "k", "up"].includes(k.name)) { k.preventDefault(); this.selected = Math.max(0, Math.min(this.entries.length - 1, this.selected + (["j", "down"].includes(k.name) ? 1 : -1))); this.scroll("selection"); }
      if ((isEnter(k.name) || ["space", "l", "right", "h", "left"].includes(k.name)) && this.current) {
        k.preventDefault(); const id = this.current.id;
        if (["h", "left"].includes(k.name) || (!["l", "right"].includes(k.name) && this.expanded.has(id))) this.expanded.delete(id); else this.expanded.add(id);
      }
      if (k.name === "y" && this.current) { k.preventDefault(); void this.copy(entryText(this.current, true)).then(ok => { this.status = ok ? "Copied" : "Clipboard unavailable"; this.changed(); }).catch(e => { this.status = e.message; this.changed(); }); }
    } else if (this.focus === "stage") {
      if (["j", "down", "k", "up"].includes(k.name)) { k.preventDefault(); this.choice = Math.max(0, Math.min(this.choices.length - 1, this.choice + (["j", "down"].includes(k.name) ? 1 : -1))); }
      if (isEnter(k.name)) { k.preventDefault(); void this.submit(); }
    } else if (isEnter(k.name) && !k.shift) { k.preventDefault(); void this.submit(); }
    this.changed();
  }
}

export function entryText(e: Entry, expanded: boolean): string {
  switch (e.kind) {
    case "user": return e.text + (e.images?.length ? `\n[${e.images.length} image attachments]` : "");
    case "assistant": return e.parts.map((p: any) => p.type === "thinking" ? (expanded ? `Thinking: ${p.withheld ? "[withheld]" : p.text}` : "[thinking — expand to read]") : p.text).join("\n") + (e.errorMessage ? `\n${e.errorMessage}` : "") + (["error", "aborted", "length"].includes(e.stopReason) ? `\n[${e.stopReason}]` : "");
    case "tool": return `${e.name} [${e.state}]` + (expanded ? `\n${e.args?.available ? JSON.stringify(e.args.value, null, 2) : "[arguments incomplete]"}\n${e.result ? textContent(e.result.content) : "[no result yet]"}` : "");
    case "compaction": return `Compaction [${e.state}]${expanded && e.summary ? `\n${e.summary}` : ""}${e.errorMessage ? `\n${e.errorMessage}` : ""}`;
    case "retry": return `Retry [${e.state}] ${e.errorMessage || e.finalError || ""}`;
    case "config": return `${e.setting}: ${e.from} → ${e.to}`;
    case "custom": return `${e.customType}: ${textContent(e.content)}`;
    case "notice": return `${e.level}: ${e.text}`;
    default: return JSON.stringify(e);
  }
}
const textContent = (c: any) => typeof c === "string" ? c : (c || []).map((b: any) => b.type === "text" ? b.text : "[image]").join("\n");

// Pi saves usage with each message; these events can change the totals or the context estimate.
const STATS_EVENTS = new Set(["message_end", "agent_settled", "compaction_end"]);

/** The part of Pi's get_session_stats response the statusline shows. */
export interface SessionStats {
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
  cost: number;
  contextUsage?: { tokens: number | null; contextWindow: number; percent: number | null };
}

// Formats as in the harness's src/core/usage.ts. Pi's totals cover the whole session file,
// which is the current branch here because quin does not branch.
function compact(count: number): string {
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${(count / 1000).toFixed(count < 10_000 ? 1 : 0)}k`;
  return `${(count / 1_000_000).toFixed(1)}M`;
}
export function formatUsage(stats: SessionStats): string {
  const t = stats.tokens;
  const cache = `${t.cacheRead > 0 ? ` R${compact(t.cacheRead)}` : ""}${t.cacheWrite > 0 ? ` W${compact(t.cacheWrite)}` : ""}`;
  return `↑${compact(t.input)} ↓${compact(t.output)}${cache} $${stats.cost.toFixed(3)}`;
}
/** Context use as Pi estimates it; unknown, as right after a compaction, is not zero. */
export function formatContext(usage: SessionStats["contextUsage"]): string {
  if (!usage) return "";
  if (usage.tokens === null || usage.percent === null) return `ctx ?/${compact(usage.contextWindow)}`;
  return `ctx ${usage.percent.toFixed(0)}% of ${compact(usage.contextWindow)}`;
}
