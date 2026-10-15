/**
 * The hub view's entries as the harness's timeline items. Items keep the
 * view's ids, so disclosure and the cursor survive every update; a nested
 * tool is a child of the tool that called it and follows its parent's subtree,
 * and a tool that made calls lists them, as the harness's projection does.
 */
import type { JSX } from "@opentui/solid";
import { type ItemType, type ItemTypeRegistry, materializeItem, type TimelineItem } from "./ui/controllers";
import {
  contentText,
  type ImageContent,
  isContentBlock,
  type ResultContent,
  type RetryState,
  StreamingFences,
} from "./ui/pi-content";
import {
  builtInToolKind,
  createTimelineTypes,
  imageMetadata,
  type NestedCallSummary,
  type RetryValue,
  type TimelineTypes,
  type ToolSnapshot,
} from "./ui/timeline-types";
import { parse, Allow } from "partial-json";
import type { Entry, View } from "./view";

/** An item of a registered type; the registry holds every type erased. */
function item<T>(id: string, version: number, type: ItemType<T, JSX.Element>, value: T, options: { parentId?: string; initiallyExpanded?: boolean } = {}): TimelineItem<JSX.Element> {
  return materializeItem({ id, version, type: type as unknown as ItemType<unknown, JSX.Element>, value, ...options });
}

/** The view keeps absent fields as null; the item values use undefined. */
const optional = <T,>(value: T | null | undefined): T | undefined => value ?? undefined;

/** The view keeps a result as a wrapper whose content is a string or blocks; only text and image blocks are kept. */
function toolResult(result: any): ToolSnapshot["result"] {
  if (!result || typeof result !== "object") return undefined;
  const partial = result.partial === true;
  const { content, details } = result;
  if (typeof content === "string") return { content: [{ type: "text", text: content }], details, partial };
  if (Array.isArray(content)) return { content: contentBlocks(content), details, partial };
  return undefined;
}

/** Whether a response has anything of its own to show; tool-only replies have not. */
function responseVisible(entry: Entry): boolean {
  if ((entry.parts ?? []).some((part: any) => part.type === "thinking" || part.text !== "")) return true;
  return !entry.streaming && ["error", "aborted", "length"].includes(entry.stopReason);
}

function projectUser(entry: Entry, types: TimelineTypes): TimelineItem<JSX.Element>[] {
  const images: ImageContent[] = (entry.images ?? []).filter(isContentBlock);
  const labels = images.map((image, index) => `image ${index + 1} (${imageMetadata(image)})`);
  return [
    item(entry.id, entry.version, types.user, { text: entry.text ?? "", images: labels }),
    // Attachments start expanded, so the first expansion of the message shows them.
    ...images.map((image, index) => item(`${entry.id}:image:${index}`, entry.version, types.image,
      { label: labels[index], content: image }, { parentId: entry.id, initiallyExpanded: true })),
  ];
}

/** A response and its parts: thinking, prose, and fenced code, each selectable in source order. */
function projectResponse(entry: Entry, types: TimelineTypes, fences: Map<number, StreamingFences>): TimelineItem<JSX.Element>[] {
  const parts: { type: "thinking" | "text"; text: string; withheld?: boolean }[] = entry.parts ?? [];
  const thinking = parts.filter((part) => part.type === "thinking");
  const body = parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
  const parent = item(entry.id, entry.version, types.response, {
    thinking: thinking.map((part) => part.text).filter((text) => text !== "").join("\n\n"),
    hasThinking: thinking.length > 0,
    thinkingWithheld: thinking.length > 0 && thinking.every((part) => part.withheld),
    body,
    streaming: entry.streaming,
    stopReason: optional(entry.stopReason),
    errorMessage: optional(entry.errorMessage),
  });
  const children: TimelineItem<JSX.Element>[] = [];
  for (const [index, part] of parts.entries()) {
    if (part.type === "thinking") {
      children.push(item(`${entry.id}:thinking:${index}`, entry.version, types.thinking,
        { text: part.text, withheld: part.withheld ?? false }, { parentId: entry.id }));
      continue;
    }
    let splitter = fences.get(index);
    if (!splitter) fences.set(index, splitter = new StreamingFences());
    for (const [block, fenced] of splitter.split(part.text).entries()) {
      const id = `${entry.id}:text:${index}:part:${block}`;
      // A blank run between fences has nothing to show or select; the part
      // index still advances so the ids after it stay stable.
      if (fenced.type === "text" && fenced.text.trim() === "") continue;
      children.push(fenced.type === "text"
        ? item(id, entry.version, types.prose, { text: fenced.text, streaming: entry.streaming }, { parentId: entry.id })
        : item(id, entry.version, types.code, {
          language: fenced.language, body: fenced.body, sourceText: fenced.sourceText, open: fenced.open ?? false,
        }, { parentId: entry.id }));
    }
  }
  return [parent, ...children];
}

function retryValue(entry: Entry): RetryValue {
  return {
    category: entry.category,
    state: entry.state as RetryState,
    attempts: (entry.attempts ?? []).map((attempt: any) => ({ ...attempt, delayMs: attempt.delayMs ?? 0, error: attempt.error ?? "" })),
    finalError: optional(entry.finalError),
  };
}

interface Projected {
  version: number;
  /** Ids and versions of the calls the items list, and arguments still streaming, to notice a change. */
  calls: string;
  items: readonly TimelineItem<JSX.Element>[];
}

/**
 * The raw argument JSON of the streaming response's calls by tool entry id.
 * The view keeps it by content index until Pi parses the arguments.
 */
function streamedArguments(stream: View["stream"] | undefined): Map<string, string> {
  const raw = new Map<string, string>();
  if (!stream?.messageId) return raw;
  for (const [index, text] of Object.entries(stream.arguments)) {
    const block = stream.message?.content?.[Number(index)];
    if (block?.type === "toolCall" && block.id != null) raw.set(`${stream.messageId}/${block.id}`, text);
  }
  return raw;
}

/** A pending call's arguments as far as they have streamed, as the harness shows them. */
function argsOf(entry: Entry, streamed: ReadonlyMap<string, string>): ToolSnapshot["args"] {
  const args = entry.args ?? { available: false };
  const raw = streamed.get(entry.id);
  if (args.available || entry.state !== "pending" || raw === undefined) return args;
  try {
    const value = parse(raw, Allow.ALL);
    return value !== null && typeof value === "object" && !Array.isArray(value) ? { available: true, value } : args;
  } catch { return args; }
}

/**
 * Turns the view's entries into timeline items, reusing an entry's items while
 * neither it nor the calls it lists changed, so unchanged rows keep their
 * renderables. Wire patches identify the changed entries; appends rebuild tree
 * order, while value-only changes replace just their items and ancestor summaries.
 */
class TimelineProjector {
  #cache = new Map<string, Projected>();
  #entries = new Map<string, Entry>();
  #tools = new Map<string, Entry>();
  #children = new Map<string, Entry[]>();
  #positions = new Map<string, number>();
  #fences = new Map<string, Map<number, StreamingFences>>();

  constructor(readonly types: TimelineTypes, readonly registry: ItemTypeRegistry<JSX.Element>) {}

  sync(entries: readonly Entry[], stream: View["stream"], dirty?: Set<string>): void {
    const structural = dirty === undefined || entries.length !== this.#entries.size || [...dirty].some(id => {
      const before = this.#entries.get(id);
      return !before;
    });
    if (structural) {
      if (dirty === undefined) { this.#cache.clear(); this.#fences.clear(); }
      const items = this.project(entries, stream);
      this.registry.replace(items);
      return;
    }
    if (!dirty?.size) return;
    const changed = new Map<string, Entry>();
    // The adapter replaces entries, so positions stay stable until an append or snapshot.
    for (const id of dirty) {
      const index = this.#positions.get(id);
      if (index === undefined) continue;
      const entry = entries[index];
      const before = this.#entries.get(id)!;
      if (entry.kind !== before.kind || entry.parentId !== before.parentId || entry.ordinal !== before.ordinal) {
        this.registry.replace(this.project(entries, stream));
        return;
      }
      this.#entries.set(id, entry);
      if (entry.kind === "tool") this.#tools.set(id, entry);
      changed.set(id, entry);
      let parent = entry.parentId;
      while (parent && this.#tools.has(parent)) {
        const ancestor = this.#tools.get(parent)!;
        changed.set(parent, ancestor);
        parent = ancestor.parentId;
      }
    }
    const streamed = streamedArguments(stream);
    const replacements: TimelineItem<JSX.Element>[] = [];
    for (const [id, entry] of changed) {
      const descendants = (id: string): Entry[] => (this.#children.get(id) ?? []).flatMap(child => [this.#tools.get(child.id)!, ...descendants(child.id)]);
      const calls = descendants(id).sort((a, b) => a.ordinal - b.ordinal);
      const items = this.#projectEntry(entry, calls, this.#tools, streamed);
      const previous = this.#cache.get(id)!;
      if (items.length !== previous.items.length || items.some((item, i) => item.id !== previous.items[i].id)) {
        this.registry.replace(this.project(entries, stream));
        return;
      }
      this.#cache.set(id, { version: entry.version, calls: this.#key(calls, streamed.get(id)), items });
      replacements.push(...items);
    }
    this.registry.update(replacements);
  }

  #key(calls: readonly Entry[], raw?: string): string {
    return calls.map(call => `${call.id}@${call.version}`).join(",") + `#${raw ?? ""}`;
  }

  /** Rebuild reading order, reusing unchanged entries' projected items. */
  project(entries: readonly Entry[], stream?: View["stream"]): TimelineItem<JSX.Element>[] {
    const streamed = streamedArguments(stream);
    const tools = new Map<string, Entry>();
    const children = new Map<string, Entry[]>();
    for (const entry of entries) if (entry.kind === "tool") tools.set(entry.id, entry);
    const nested = (entry: Entry) => entry.kind === "tool" && entry.parentId != null && tools.has(entry.parentId);
    for (const entry of entries) {
      if (!nested(entry)) continue;
      const list = children.get(entry.parentId) ?? [];
      list.push(entry);
      children.set(entry.parentId, list);
    }
    for (const list of children.values()) list.sort((a, b) => a.ordinal - b.ordinal);
    const descendants = (id: string, into: Entry[] = []): Entry[] => {
      for (const child of children.get(id) ?? []) {
        into.push(child);
        descendants(child.id, into);
      }
      return into;
    };
    const next = new Map<string, Projected>();
    const result: TimelineItem<JSX.Element>[] = [];
    const emit = (entry: Entry) => {
      // Every call a tool made, its calls' calls included, in the order they started.
      const calls = entry.kind === "tool" ? descendants(entry.id).sort((a, b) => a.ordinal - b.ordinal) : [];
      const key = this.#key(calls, streamed.get(entry.id));
      let cached = this.#cache.get(entry.id);
      if (!cached || cached.version !== entry.version || cached.calls !== key) {
        cached = { version: entry.version, calls: key, items: this.#projectEntry(entry, calls, tools, streamed) };
      }
      next.set(entry.id, cached);
      result.push(...cached.items);
      // A nested call follows its parent's subtree, wherever the view recorded it.
      for (const child of children.get(entry.id) ?? []) emit(child);
    };
    for (const entry of entries) {
      if (!nested(entry)) emit(entry);
    }
    this.#cache = next;
    this.#entries = new Map(entries.map(entry => [entry.id, entry]));
    this.#positions = new Map(entries.map((entry, index) => [entry.id, index]));
    this.#tools = tools;
    this.#children = children;
    return result;
  }

  #projectEntry(entry: Entry, calls: readonly Entry[], tools: ReadonlyMap<string, Entry>, streamed: ReadonlyMap<string, string>): TimelineItem<JSX.Element>[] {
    const { types } = this;
    switch (entry.kind) {
      case "user":
        return projectUser(entry, types);
      case "assistant": {
        if (!responseVisible(entry)) return [];
        let fences = this.#fences.get(entry.id);
        if (!fences) this.#fences.set(entry.id, fences = new Map());
        return projectResponse(entry, types, fences);
      }
      case "tool": {
        const parent = entry.parentId == null ? undefined : tools.get(entry.parentId);
        const snapshot: ToolSnapshot = {
          id: entry.id,
          callId: entry.callId,
          name: entry.name,
          parentCallId: parent?.callId,
          args: argsOf(entry, streamed),
          state: entry.state,
          result: toolResult(entry.result),
          errorSummary: optional(entry.errorSummary),
          calls: calls.map((call): NestedCallSummary => ({ name: call.name, args: call.args ?? { available: false }, state: call.state })),
          callsIncomplete: entry.nestedIncomplete === true,
        };
        return [item(entry.id, entry.version, this.#toolType(entry.name), snapshot, { parentId: parent?.id })];
      }
      // A shell command from the session, shown as the bash tool shows its call.
      case "bash": {
        const snapshot: ToolSnapshot = {
          id: entry.id,
          callId: entry.id,
          name: "bash",
          parentCallId: undefined,
          args: entry.command == null ? { available: false } : { available: true, value: { command: entry.command } },
          state: "done",
          result: {
            content: [{ type: "text", text: entry.output ?? "" }],
            details: {
              exitCode: optional(entry.exitCode), cancelled: optional(entry.cancelled), truncated: optional(entry.truncated),
              ...(entry.fullOutputPath ? { fullOutputPath: entry.fullOutputPath } : {}),
            },
            partial: false,
          },
          errorSummary: undefined,
          calls: [],
          callsIncomplete: false,
        };
        return [item(entry.id, entry.version, this.#toolType("bash"), snapshot)];
      }
      case "branch-summary":
        return [item(entry.id, entry.version, types.branchSummary, { summary: entry.summary ?? "" })];
      case "custom":
        return [item(entry.id, entry.version, types.custom, {
          customType: entry.customType, content: typeof entry.content === "string" ? entry.content : contentBlocks(entry.content), details: entry.details,
        })];
      case "compaction":
        return [item(entry.id, entry.version, types.compaction, {
          state: entry.state, reason: optional(entry.reason), summary: optional(entry.summary),
          tokensBefore: optional(entry.tokensBefore), errorMessage: optional(entry.errorMessage),
        })];
      case "retry":
        return [item(entry.id, entry.version, types.retry, retryValue(entry))];
      case "config":
        return [item(entry.id, entry.version, types.config, { setting: entry.setting, from: entry.from, to: entry.to })];
      case "notice":
        return [item(entry.id, entry.version, types.notice, { level: entry.level, text: entry.text })];
      default:
        return [item(entry.id, entry.version, types.notice, { level: "warning" as const, text: `unknown timeline entry: ${entry.kind}` })];
    }
  }

  #toolType(name: string): ItemType<unknown, JSX.Element> {
    return this.registry.lookup(builtInToolKind(name)) ?? (this.types.tool as ItemType<unknown, JSX.Element>);
  }
}

const contentBlocks = (content: unknown): ResultContent => (Array.isArray(content) ? content.filter(isContentBlock) : []);

/** Registers the harness's item types on the timeline; the returned registrations remove them. */
export function registerTimelineTypes(timeline: ItemTypeRegistry<JSX.Element>) {
  const types = createTimelineTypes();
  const registrations = Object.values(types).map((type) => timeline.registerType(type as ItemType<unknown, JSX.Element>));
  return { registrations, projector: new TimelineProjector(types, timeline) };
}

/** Prompts waiting for the current run, as the view queues them. */
export function queuedPrompts(queue: { steering: unknown[]; followUp: unknown[] }) {
  const text = (prompt: any) => typeof prompt === "string" ? prompt : prompt?.message ?? contentText(prompt?.content ?? []) ?? JSON.stringify(prompt);
  return { steering: queue.steering.map(text), followUp: queue.followUp.map(text) };
}
