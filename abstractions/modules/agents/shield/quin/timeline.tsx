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
  splitFencedBlocks,
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
import type { Entry } from "./view";

/** An item of a registered type; the registry holds every type erased. */
function item<T>(id: string, version: number, type: ItemType<T, JSX.Element>, value: T, options: { parentId?: string; initiallyExpanded?: boolean } = {}): TimelineItem<JSX.Element> {
  return materializeItem({ id, version, type: type as unknown as ItemType<unknown, JSX.Element>, value, ...options });
}

/** The view keeps absent fields as null; the item values use undefined. */
const optional = <T,>(value: T | null | undefined): T | undefined => value ?? undefined;

/** Tool results reach the view as a message content, a string, or a wrapper; only text and image blocks are kept. */
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
function projectResponse(entry: Entry, types: TimelineTypes): TimelineItem<JSX.Element>[] {
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
    for (const [block, fenced] of splitFencedBlocks(part.text, { openFences: true }).entries()) {
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

/** The view records one retry entry per scheduled attempt, of either category. */
function retryValue(entry: Entry): RetryValue {
  return {
    category: "response",
    state: entry.state as RetryState,
    attempts: typeof entry.attempt === "number"
      ? [{ attempt: entry.attempt, maxAttempts: entry.maxAttempts, delayMs: entry.delayMs ?? 0, error: entry.errorMessage ?? "" }]
      : [],
    finalError: optional(entry.finalError),
  };
}

interface Projected {
  version: number;
  /** Ids and versions of the calls the items list, to notice a call that changed. */
  calls: string;
  items: readonly TimelineItem<JSX.Element>[];
}

/**
 * Turns the view's entries into timeline items, reusing an entry's items while
 * neither it nor the calls it lists changed, so unchanged rows keep their
 * renderables. The view updates entries in place, so versions, not identity,
 * tell what changed.
 */
class TimelineProjector {
  #cache = new Map<string, Projected>();
  #last: TimelineItem<JSX.Element>[] = [];

  constructor(readonly types: TimelineTypes, readonly registry: Pick<ItemTypeRegistry<JSX.Element>, "lookup">) {}

  /** The items for `entries`; the previous array itself when no item changed, so the caller can skip replacing them. */
  project(entries: readonly Entry[]): TimelineItem<JSX.Element>[] {
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
      const key = calls.map((call) => `${call.id}@${call.version}`).join(",");
      let cached = this.#cache.get(entry.id);
      if (!cached || cached.version !== entry.version || cached.calls !== key) {
        cached = { version: entry.version, calls: key, items: this.#projectEntry(entry, calls, tools) };
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
    if (result.length === this.#last.length && result.every((item, index) => item === this.#last[index])) return this.#last;
    return this.#last = result;
  }

  #projectEntry(entry: Entry, calls: readonly Entry[], tools: ReadonlyMap<string, Entry>): TimelineItem<JSX.Element>[] {
    const { types } = this;
    switch (entry.kind) {
      case "user":
        return projectUser(entry, types);
      case "assistant":
        return responseVisible(entry) ? projectResponse(entry, types) : [];
      case "tool": {
        const parent = entry.parentId == null ? undefined : tools.get(entry.parentId);
        const snapshot: ToolSnapshot = {
          id: entry.id,
          callId: entry.callId,
          name: entry.name,
          parentCallId: parent?.callId,
          args: entry.args ?? { available: false },
          state: entry.state,
          result: toolResult(entry.result),
          errorSummary: undefined,
          calls: calls.map((call): NestedCallSummary => ({ name: call.name, args: call.args ?? { available: false }, state: call.state })),
          callsIncomplete: entry.nestedIncomplete === true,
        };
        const type = this.registry.lookup(builtInToolKind(entry.name)) ?? (types.tool as ItemType<unknown, JSX.Element>);
        return [item(entry.id, entry.version, type, snapshot, { parentId: parent?.id })];
      }
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
