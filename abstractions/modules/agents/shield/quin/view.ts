import type { Envelope } from "../client/protocol";

// Pi semantics belong to Shield.PiView. The client only applies its wire patches.
export interface View {
  schema: "shield-pi-view/2";
  timeline: { entries: Entry[]; response: string | null; nextOrdinal: number; model: string | null; thinking: string | null };
  stream: { message: any; messageId: string | null; arguments: Record<string, string> };
  nextId: number;
  run: { active: boolean; accepting: number; interrupting: boolean; retry: boolean; compaction: boolean };
  queue: { steering: any[]; followUp: any[] };
  dialogs: Record<string, any>;
  presentation: { status: Record<string, string>; title: string | null };
}
export interface Entry { id: string; kind: string; version: number; [field: string]: any }
export type ViewPatch = Partial<Omit<View, "schema" | "timeline">> & {
  entries: Entry[];
  timeline?: Omit<View["timeline"], "entries">;
};
export function emptyView(): View {
  return { schema: "shield-pi-view/2", timeline: { entries: [], response: null, nextOrdinal: 0, model: null, thinking: null }, stream: { message: null, messageId: null, arguments: {} }, nextId: 0, run: { active: false, accepting: 0, interrupting: false, retry: false, compaction: false }, queue: { steering: [], followUp: [] }, dialogs: {}, presentation: { status: {}, title: null } };
}

export class PiAdapter {
  view: View = emptyView();
  instance: string | undefined;
  agent: string | undefined;
  seq: number | undefined;
  lifecycle = "connecting";
  mode = "live";
  private positions = new Map<string, number>();
  private dirty = new Set<string>();
  private reset = true;

  /** Undefined means a new snapshot; otherwise only these entries need projection. */
  takeChanges(): Set<string> | undefined {
    const changed = this.reset ? undefined : this.dirty;
    this.reset = false;
    this.dirty = new Set();
    return changed;
  }

  apply(r: Envelope) {
    if (r.type === "agent_failed") { if (this.agent === undefined || r["agent-id"] === this.agent) this.lifecycle = "failed"; return; }
    if (r.type === "snapshot") {
      if (r.payload?.view?.schema !== "shield-pi-view/2" || typeof r.seq !== "number" || !r["hub-instance"] || !r["agent-id"]) throw new Error("invalid_snapshot");
      this.view = r.payload.view; this.instance = r["hub-instance"]; this.agent = r["agent-id"]; this.seq = r.seq; this.lifecycle = r.payload.lifecycle; this.mode = r.payload.mode;
      this.positions = new Map(this.view.timeline.entries.map((entry, index) => [entry.id, index]));
      this.reset = true;
      this.dirty.clear();
    } else if (r.type === "event") {
      if (this.instance !== r["hub-instance"] || this.agent !== r["agent-id"] || r.seq !== (this.seq ?? -1) + 1) throw new Error("snapshot_sequence_mismatch; reopen quin");
      this.seq = r.seq;
      if (r.payload.op === "lifecycle") this.lifecycle = r.payload.state;
      if (r.payload.op === "event") {
        const patch: ViewPatch = r.payload.patch;
        if (!patch || !Array.isArray(patch.entries)) throw new Error("invalid_view_patch");
        for (const entry of patch.entries) {
          if (typeof entry.id !== "string" || typeof entry.version !== "number") throw new Error("invalid_view_entry");
          const index = this.positions.get(entry.id) ?? this.view.timeline.entries.length;
          this.positions.set(entry.id, index);
          this.view.timeline.entries[index] = entry;
          this.dirty.add(entry.id);
        }
        if (patch.stream) {
          for (const stream of [this.view.stream, patch.stream]) {
            if (!stream.messageId) continue;
            for (const block of stream.message?.content ?? []) {
              if (block?.type === "toolCall") this.dirty.add(`${stream.messageId}/${block.id}`);
            }
          }
        }
        if (patch.timeline) Object.assign(this.view.timeline, patch.timeline);
        for (const key of ["stream", "nextId", "run", "queue", "dialogs", "presentation"] as const) {
          if (key in patch) (this.view as any)[key] = patch[key];
        }
      }
    }
  }
}
