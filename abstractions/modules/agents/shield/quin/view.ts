import type { Envelope } from "../client/protocol";
import { contentText } from "./ui/pi-content";

// Wire view mirrors Shield.PiView.apply/3, whose comment states the shared rules: records are
// Pi's RPC JSON events, a missing field is null, and conditions never rely on truthiness.
// Fixtures compare both implementations by value.
export interface View {
  schema: "shield-pi-view/1";
  timeline: { entries: Entry[]; response: string | null; nextOrdinal: number; model: string | null; thinking: string | null };
  stream: { message: any; messageId: string | null; arguments: Record<string, string> };
  nextId: number;
  run: { active: boolean; accepting: number; interrupting: boolean; retry: boolean; compaction: boolean };
  queue: { steering: any[]; followUp: any[] };
  dialogs: Record<string, any>;
  presentation: { status: Record<string, string>; title: string | null };
}
export interface Entry { id: string; kind: string; version: number; [field: string]: any }
export function emptyView(): View {
  return { schema: "shield-pi-view/1", timeline: { entries: [], response: null, nextOrdinal: 0, model: null, thinking: null }, stream: { message: null, messageId: null, arguments: {} }, nextId: 0, run: { active: false, accepting: 0, interrupting: false, retry: false, compaction: false }, queue: { steering: [], followUp: [] }, dialogs: {}, presentation: { status: {}, title: null } };
}
const base = (id: string, kind: string): Entry => ({ id, kind, version: 0 });
const bump = (e: Entry, fields: Record<string, any>) => Object.assign(e, fields, { version: e.version + 1 });
const take = (v: any, keys: string[]) => Object.fromEntries(keys.filter(k => k in v).map(k => [k, v[k]]));
/** Equality as Elixir's `==` sees decoded JSON: key order is irrelevant and a missing field equals null. */
const same = (a: any, b: any): boolean => {
  if (a === b || (a == null && b == null)) return true;
  if (a == null || b == null || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(k => k in b && same(a[k], b[k]));
};
/** A bump only when a field changes, so streamed deltas leave unchanged entries' versions. */
const change = (e: Entry, fields: Record<string, any>) => { if (!Object.entries(fields).every(([k, value]) => same(e[k], value))) bump(e, fields); };
/** Extension tools may return any value; a string or a list becomes the result's content. */
const toolResult = (result: any): Record<string, any> | null =>
  typeof result === "string" ? { content: [{ type: "text", text: result }], details: null }
    : Array.isArray(result) ? { content: result, details: null }
    : result !== null && typeof result === "object" ? result : null;
/**
 * The view after one Pi record. By default `before` is left untouched; `inPlace` updates
 * it instead, so a streamed token costs time independent of the history's size. A record
 * that throws may leave an in-place view partly updated, and its connection is then abandoned.
 */
export function applyEvent(before: View, r: any, now: number, inPlace = false): View {
  const v = inPlace ? before : structuredClone(before);
  const entries = v.timeline.entries;
  const newEntry = (kind: string, fields: Record<string, any>) => entries.push({ ...base(`live:${v.nextId++}`, kind), ...fields });
  const last = (p: (e: Entry) => boolean) => entries.findLast(p);
  const update = (p: (e: Entry) => boolean, fields: Record<string, any>) => { const e = last(p); if (e) bump(e, fields); };
  const assistant = (m: any, streaming: boolean) => {
    const scope = v.timeline.response;
    if (!scope) throw new Error("assistant_without_scope");
    const parts = (m.content || []).flatMap((b: any) => b?.type === "text" ? [{ type: "text", text: b.text ?? null }] : b?.type === "thinking" ? [{ type: "thinking", text: b.redacted === true ? "" : b.thinking ?? null, withheld: b.redacted === true }] : []);
    const fields = { parts, streaming, stopReason: streaming ? null : m.stopReason ?? null, errorMessage: m.errorMessage ?? null };
    const e = last(e => e.id === scope);
    if (e) change(e, fields); else entries.push({ ...base(scope, "assistant"), ...fields });
    for (const block of m.content || []) {
      if (block?.type !== "toolCall") continue;
      const id = `${scope}/${block.id}`;
      const existing = last(e => e.id === id);
      const args = "arguments" in block ? { available: true, value: block.arguments ?? null } : { available: false };
      // Once Pi runs the call, its execution's arguments stand.
      if (existing) { if (existing.state === "pending") change(existing, { args }); }
      else entries.push({ ...base(id, "tool"), callId: block.id, scope, parentId: null, name: block.name ?? null, ordinal: v.timeline.nextOrdinal++, args, state: scope.startsWith("seed:") ? "missing" : "pending", nestedIncomplete: false, result: null });
    }
  };
  // One entry per retry sequence of a category, open while waiting or retrying, as the harness keeps them.
  const openRetry = (category: string, states = ["waiting", "retrying"]) => last(e => e.kind === "retry" && e.category === category && states.includes(e.state));
  const toolUpdate = (record: any, partial: boolean) => {
    const result = toolResult(record[partial ? "partialResult" : "result"]);
    if (partial && !result) return;
    update(e => e.kind === "tool" && e.callId === record.toolCallId && (e.parentId != null) === (record.parentToolCallId != null), { result: result ? { ...result, partial } : null, ...(!partial ? { state: record.isError === true ? "error" : "done" } : {}) });
  };
  switch (r.type) {
    case "agent_start": {
      v.run.active = true;
      const waiting = openRetry("response", ["waiting"]);
      if (waiting) bump(waiting, { state: "retrying" });
      break;
    }
    case "agent_settled":
      v.run.active = false; v.run.retry = false; v.timeline.response = null;
      for (const e of entries) {
        if (e.kind === "tool" && ["pending", "running"].includes(e.state)) bump(e, { state: "unfinished" });
        if (e.kind === "assistant" && e.streaming) bump(e, { streaming: false });
      }
      break;
    case "message_start": {
      const m = r.message;
      if (m.role === "user") newEntry("user", { text: contentText(m.content || []), images: Array.isArray(m.content) ? m.content.filter((b: any) => b.type === "image") : [] });
      if (m.role === "assistant") {
        const id = `live:${v.nextId++}`;
        v.timeline.response = id; v.timeline.nextOrdinal = 0;
        v.stream = { message: m, messageId: id, arguments: {} };
        assistant(m, true);
      }
      break;
    }
    case "message_update": {
      const d = r.assistantMessageEvent;
      const m = v.stream.message;
      if (!m) throw new Error("delta_without_message");
      const i = d.contentIndex;
      if (!Number.isInteger(i) || i < 0 || i > 100_000) throw new Error("invalid_content_index");
      const content = m.content || [];
      while (content.length <= i) content.push(null);
      const b = content[i] || {};
      switch (d.type) {
        case "text_start": content[i] = { type: "text", text: "" }; break;
        case "thinking_start": content[i] = { type: "thinking", thinking: "" }; break;
        case "text_delta": content[i] = { ...b, type: "text", text: (b.text || "") + d.delta }; break;
        case "thinking_delta": content[i] = { ...b, type: "thinking", thinking: (b.thinking || "") + d.delta }; break;
        case "text_end": content[i] = { type: "text", text: d.content ?? null }; break;
        case "thinking_end": content[i] = { ...b, type: "thinking", thinking: d.content ?? null }; break;
        case "toolcall_start": content[i] = { type: "toolCall", id: d.id ?? null, name: d.toolName ?? null }; v.stream.arguments[String(i)] = ""; break;
        case "toolcall_delta": v.stream.arguments[String(i)] = (v.stream.arguments[String(i)] || "") + d.delta; content[i] = b; break;
        case "toolcall_end": content[i] = d.toolCall ?? null; break;
        default: content[i] = b;
      }
      m.content = content;
      assistant(m, true);
      break;
    }
    case "message_end": {
      const m = r.message;
      if (m.role === "assistant") { v.stream.message = m; assistant(m, false); }
      if (m.role === "toolResult") toolUpdate({ toolCallId: m.toolCallId, result: take(m, ["content", "details"]), isError: m.isError }, false);
      if (m.role === "custom" && m.display === true) newEntry("custom", take(m, ["customType", "content", "details"]));
      break;
    }
    case "tool_execution_start": {
      const parent = last(e => e.kind === "tool" && e.callId === r.parentToolCallId);
      const scope = parent?.scope ?? v.timeline.response;
      if (!scope) throw new Error("tool_without_scope");
      const id = `${scope}/${r.toolCallId}`;
      const fields = { state: "running", args: { available: true, value: r.args ?? null } };
      const e = last(e => e.id === id);
      if (e) bump(e, fields);
      else entries.push({ ...base(id, "tool"), ...fields, callId: r.toolCallId, scope, parentId: parent?.id ?? null, name: r.toolName ?? null, ordinal: v.timeline.nextOrdinal++, nestedIncomplete: false, result: null });
      break;
    }
    case "tool_execution_update": toolUpdate(r, true); break;
    case "tool_execution_end": toolUpdate(r, false); break;
    case "queue_update": v.queue = { steering: r.steering ?? [], followUp: r.followUp ?? [] }; break;
    case "thinking_level_changed": {
      const from = v.timeline.thinking, to = r.level ?? null; v.timeline.thinking = to;
      if (from != null && from !== to) newEntry("config", { setting: "thinking", from, to });
      break;
    }
    case "compaction_start": v.run.compaction = true; newEntry("compaction", { state: "running", reason: r.reason ?? null }); break;
    // Pi ends a compaction it never started when overflow recovery fails again.
    case "compaction_end": {
      v.run.compaction = false;
      const result = r.result !== null && typeof r.result === "object" && !Array.isArray(r.result) ? r.result : null;
      const fields = { ...(result || {}), state: result ? "completed" : r.aborted === true ? "aborted" : "failed", errorMessage: r.errorMessage ?? null };
      const running = last(e => e.kind === "compaction" && e.state === "running");
      if (running) bump(running, fields); else newEntry("compaction", { ...fields, reason: r.reason ?? null });
      break;
    }
    case "auto_retry_start": case "summarization_retry_scheduled": {
      v.run.retry = true;
      const category = r.type === "auto_retry_start" ? "response" : "summary";
      const attempt = { attempt: r.attempt ?? null, maxAttempts: r.maxAttempts ?? null, delayMs: r.delayMs ?? null, error: r.errorMessage ?? null };
      const open = openRetry(category);
      if (open) bump(open, { state: "waiting", attempts: [...open.attempts, attempt] });
      else newEntry("retry", { category, state: "waiting", attempts: [attempt], finalError: null });
      break;
    }
    case "summarization_retry_attempt_start": {
      const open = openRetry("summary");
      if (open) bump(open, { state: "retrying" });
      else newEntry("retry", { category: "summary", state: "retrying", attempts: [], finalError: null });
      break;
    }
    case "summarization_retry_finished": { v.run.retry = false; const open = openRetry("summary"); if (open) bump(open, { state: "ended" }); break; }
    case "auto_retry_end": { v.run.retry = false; const open = openRetry("response"); if (open) bump(open, { state: r.success === true ? "succeeded" : "failed", finalError: r.finalError ?? null }); break; }
    case "entry_appended": if (r.entry.type === "custom_message" && r.entry.display === true) newEntry("custom", take(r.entry, ["customType", "content", "details"])); break;
    case "extension_ui_request":
      switch (r.method) {
        case "select": case "confirm": case "input": case "editor": v.dialogs[r.id] = { ...r, expiresAt: typeof r.timeout === "number" && r.timeout !== 0 ? now + Math.max(0, r.timeout) : null }; break;
        // An empty status clears its key, as a missing one does.
        case "setStatus": if (r.statusText == null || r.statusText === "") delete v.presentation.status[r.statusKey]; else v.presentation.status[r.statusKey] = r.statusText; break;
        case "setTitle": v.presentation.title = r.title ?? null; break;
        case "notify": newEntry("notice", { level: r.notifyType == null || r.notifyType === "" ? "info" : r.notifyType, text: r.message ?? null }); break;
      }
      break;
    case "dialog_closed": delete v.dialogs[r.id]; break;
    case "shield_run": v.run = r.run; break;
    case "shield_model": {
      const from = v.timeline.model, to = `${r.model.provider}/${r.model.id}`;
      v.timeline.model = to;
      if (from != null && from !== to) newEntry("config", { setting: "model", from, to });
      break;
    }
    case "extension_error": newEntry("notice", { level: "error", text: r.error ?? null }); break;
  }
  return v;
}

export class PiAdapter {
  view: View = emptyView();
  instance: string | undefined;
  agent: string | undefined;
  seq: number | undefined;
  lifecycle = "connecting";
  mode = "live";
  apply(r: Envelope) {
    // The hub reports a crashed agent to every connection that used it.
    if (r.type === "agent_failed") { if (this.agent === undefined || r["agent-id"] === this.agent) this.lifecycle = "failed"; return; }
    if (r.type === "snapshot") {
      if (r.payload?.view?.schema !== "shield-pi-view/1" || typeof r.seq !== "number" || !r["hub-instance"] || !r["agent-id"]) throw new Error("invalid_snapshot");
      this.view = r.payload.view; this.instance = r["hub-instance"]; this.agent = r["agent-id"]; this.seq = r.seq; this.lifecycle = r.payload.lifecycle; this.mode = r.payload.mode;
    } else if (r.type === "event") {
      if (this.instance !== r["hub-instance"] || this.agent !== r["agent-id"] || r.seq !== (this.seq ?? -1) + 1) throw new Error("snapshot_sequence_mismatch; reopen quin");
      this.seq = r.seq;
      if (r.payload.op === "lifecycle") this.lifecycle = r.payload.state;
      if (r.payload.op === "event") this.view = applyEvent(this.view, r.payload.record, r.payload.observedAt, true);
    }
  }
}
