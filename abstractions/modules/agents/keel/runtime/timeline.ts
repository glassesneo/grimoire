/**
 * Pi's session events as timeline items. `reduce` follows the events into
 * entries; `items` splits the entries into the items screens show:
 * a response into its thinking, prose, and fenced
 * code, and a nested tool call under the tool that made it. Nothing is
 * invented: what the session did not supply is marked unavailable.
 *
 * keel always starts a new session, so there is no saved branch to restore.
 */
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type {
  CompactionData,
  CompactionState,
  ConfigData,
  CustomData,
  NestedCallSummary,
  NoticeData,
  NoticeLevel,
  ResponseData,
  RetryAttempt,
  RetryData,
  ToolArguments,
  ToolData,
  ToolResultData,
  ToolState,
  UserData,
} from "../protocol/items";
import { argsLine, isRecord, stopText, toolStateText } from "../protocol/format";
import type { Item } from "../protocol/wire";
import type { ToolDecorator } from "../api";
import {
  contentText,
  imageLabel,
  imagesOf,
  isContentBlock,
  StreamingFences,
  type ResultContent,
} from "./content";

type Part = { type: "thinking"; text: string; withheld: boolean } | { type: "text"; text: string };

interface Base {
  id: string;
  version: number;
}
interface UserEntry extends Base {
  kind: "user";
  text: string;
  images: string[];
}
interface AssistantEntry extends Base {
  kind: "assistant";
  parts: Part[];
  streaming: boolean;
  stopReason: string | undefined;
  errorMessage: string | undefined;
}
interface ToolEntry extends Base {
  kind: "tool";
  callId: string;
  /** The response that issued the root call; call ids are unique only within it. */
  scope: string;
  parentId: string | undefined;
  name: string;
  args: ToolArguments;
  state: ToolState;
  result: ToolResultData | undefined;
  /** The result's content as Pi gave it, for decorators; never sent. */
  content: ResultContent;
}
interface CompactionEntry extends Base, CompactionData {
  kind: "compaction";
}
interface RetryEntry extends Base, RetryData {
  kind: "retry";
}
interface CustomEntry extends Base, CustomData {
  kind: "custom";
}
interface ConfigEntry extends Base, ConfigData {
  kind: "config";
}
interface NoticeEntry extends Base, NoticeData {
  kind: "notice";
}

type Entry =
  | UserEntry
  | AssistantEntry
  | ToolEntry
  | CompactionEntry
  | RetryEntry
  | CustomEntry
  | ConfigEntry
  | NoticeEntry;

/** Events the timeline follows: the session's, and what the host observes elsewhere. */
export type TimelineEvent =
  | AgentSessionEvent
  | { type: "model_changed"; previous: string | undefined; model: string };

/** Whether two part lists are equal, stopping at the first difference. */
function sameParts(a: readonly Part[], b: readonly Part[]): boolean {
  return (
    a.length === b.length &&
    a.every((part, index) => {
      const other = b[index]!;
      return (
        part.type === other.type &&
        part.text === other.text &&
        (part.type === "text" || part.withheld === (other as typeof part).withheld)
      );
    })
  );
}

function bump<E extends Entry>(entry: E, changes: Partial<E>): E {
  return { ...entry, ...changes, version: entry.version + 1 };
}

function contentBlocks(content: readonly unknown[]): ResultContent {
  return content.filter(isContentBlock);
}

function resultData(content: readonly unknown[], details: unknown, partial: boolean) {
  const blocks = contentBlocks(content);
  return {
    text: contentText(blocks),
    images: imagesOf(blocks).map(imageLabel),
    ...(details === undefined ? {} : { details }),
    partial,
  };
}

/** Tool results reach the session as message content, a string, or a wrapper. */
function toolResult(
  result: unknown,
  partial: boolean,
): { data: ToolResultData; content: ResultContent } | undefined {
  const of = (content: unknown[], details: unknown) => ({
    data: resultData(content, details, partial),
    content: contentBlocks(content),
  });
  if (typeof result === "string") return of([{ type: "text", text: result }], undefined);
  if (Array.isArray(result)) return of(result, undefined);
  if (isRecord(result) && "content" in result) {
    const { content, details } = result as { content: unknown; details?: unknown };
    if (typeof content === "string") return of([{ type: "text", text: content }], details);
    if (Array.isArray(content)) return of(content, details);
  }
  return undefined;
}

function assistantParts(message: {
  content: readonly { type: string; [key: string]: unknown }[];
}): Part[] {
  return message.content.flatMap((block): Part[] => {
    if (block.type === "text")
      return [{ type: "text", text: typeof block.text === "string" ? block.text : "" }];
    if (block.type === "thinking") {
      const redacted = Boolean(block.redacted);
      const thinking = typeof block.thinking === "string" ? block.thinking : "";
      return [
        {
          type: "thinking",
          text: redacted ? "" : thinking,
          withheld: redacted || (thinking === "" && Boolean(block.thinkingSignature)),
        },
      ];
    }
    return [];
  });
}

/** Whether a response has anything of its own to show; tool-only replies have not. */
function responseVisible(entry: Pick<AssistantEntry, "parts" | "stopReason" | "streaming">) {
  if (entry.parts.some((part) => part.type === "thinking" || part.text !== "")) return true;
  return !entry.streaming && ["error", "aborted", "length"].includes(entry.stopReason ?? "");
}

export class Timeline {
  #entries: Entry[] = [];
  #next = 0;
  /** Scope of the response being streamed, or whose tools run. */
  #response: string | undefined;
  #model: string | undefined;
  #thinking: string | undefined;
  readonly #decorators = new Map<string, Map<string, ToolDecorator>>();
  readonly #cache = new Map<string, { key: string; items: Item[] }>();
  /** Fence splitters of responses still streaming, by entry and part. */
  readonly #fences = new Map<string, Map<number, StreamingFences>>();
  /** The items of fenced blocks a splitter finished, which stay the same objects while it streams on. */
  readonly #blocks = new WeakMap<object, { streaming: boolean; item: Item }>();
  readonly #published = new Map<string, { json: string; version: number; item: Item }>();
  #publishedOrder: string[] = [];
  #itemVersion = 0;

  constructor(settings: { model?: string; thinking?: string } = {}) {
    this.#model = settings.model;
    this.#thinking = settings.thinking;
  }

  #id(prefix: string) {
    return `${prefix}-${this.#next++}`;
  }

  /** Adds a presentation for the tool named `tool`; the item shows it while registered. */
  decorate(tool: string, owner: string, decorator: ToolDecorator): () => void {
    const byOwner = this.#decorators.get(tool) ?? new Map<string, ToolDecorator>();
    this.#decorators.set(tool, byOwner);
    byOwner.set(owner, decorator);
    this.#invalidateTools(tool);
    return () => {
      if (byOwner.get(owner) !== decorator) return;
      byOwner.delete(owner);
      this.#invalidateTools(tool);
    };
  }

  #invalidateTools(name: string) {
    for (const entry of this.#entries)
      if (entry.kind === "tool" && entry.name === name) this.#cache.delete(entry.id);
  }

  notice(level: NoticeLevel, text: string): void {
    this.#entries.push({ kind: "notice", id: this.#id("notice"), version: 0, level, text });
  }

  #replace(index: number, entry: Entry) {
    this.#entries[index] = entry;
  }

  #findTool(predicate: (entry: ToolEntry) => boolean): number {
    return this.#entries.findLastIndex((entry) => entry.kind === "tool" && predicate(entry));
  }

  /** The index after the last entry of `index`'s subtree, where a new child goes. */
  #subtreeEnd(index: number): number {
    const members = new Set([this.#entries[index]!.id]);
    let end = index + 1;
    while (end < this.#entries.length) {
      const entry = this.#entries[end]!;
      if (entry.kind !== "tool" || entry.parentId === undefined || !members.has(entry.parentId))
        break;
      members.add(entry.id);
      end++;
    }
    return end;
  }

  #upsertAssistant(scope: string, message: any, streaming: boolean) {
    const parts = assistantParts(message);
    const stopReason = streaming ? undefined : message.stopReason;
    const index = this.#entries.findLastIndex(
      (entry) => entry.kind === "assistant" && entry.id === scope,
    );
    if (index !== -1) {
      const previous = this.#entries[index] as AssistantEntry;
      if (
        !sameParts(previous.parts, parts) ||
        previous.streaming !== streaming ||
        previous.stopReason !== stopReason ||
        previous.errorMessage !== message.errorMessage
      )
        this.#replace(
          index,
          bump(previous, { parts, streaming, stopReason, errorMessage: message.errorMessage }),
        );
    } else {
      const entry: AssistantEntry = {
        kind: "assistant",
        id: scope,
        version: 0,
        parts,
        streaming,
        stopReason,
        errorMessage: message.errorMessage,
      };
      if (responseVisible(entry)) {
        // Tools the response already announced stay after its text.
        const firstTool = this.#entries.findIndex(
          (candidate) => candidate.kind === "tool" && candidate.scope === scope,
        );
        if (firstTool === -1) this.#entries.push(entry);
        else this.#entries.splice(firstTool, 0, entry);
      }
    }
    for (const block of message.content ?? []) {
      if (block?.type !== "toolCall") continue;
      const id = `${scope}/${block.id}`;
      const existing = this.#entries.findLastIndex((entry) => entry.id === id);
      const args: ToolArguments = { available: true, value: block.arguments ?? {} };
      if (existing === -1) {
        this.#entries.push({
          kind: "tool",
          id,
          version: 0,
          callId: block.id,
          scope,
          parentId: undefined,
          name: block.name,
          args,
          state: "pending",
          result: undefined,
          content: [],
        });
      } else {
        const tool = this.#entries[existing] as ToolEntry;
        if (tool.state === "pending" && JSON.stringify(tool.args) !== JSON.stringify(args))
          this.#replace(existing, bump(tool, { args }));
      }
    }
  }

  #openRetry(category: RetryData["category"]): number {
    return this.#entries.findLastIndex(
      (entry) =>
        entry.kind === "retry" &&
        entry.category === category &&
        (entry.state === "waiting" || entry.state === "retrying"),
    );
  }

  #retry(category: RetryData["category"], update: (entry: RetryEntry) => RetryEntry) {
    const index = this.#openRetry(category);
    if (index === -1)
      this.#entries.push(
        update({
          kind: "retry",
          id: this.#id("retry"),
          version: 0,
          category,
          state: "waiting",
          attempts: [],
        }),
      );
    else this.#replace(index, update(this.#entries[index] as RetryEntry));
  }

  #endRetry(category: RetryData["category"], changes: Partial<RetryEntry>) {
    const index = this.#openRetry(category);
    if (index !== -1) this.#replace(index, bump(this.#entries[index] as RetryEntry, changes));
  }

  #config(setting: "model" | "thinking", value: string, previous: string | undefined) {
    const current = setting === "model" ? this.#model : this.#thinking;
    const from = previous ?? current;
    if (setting === "model") this.#model = value;
    else this.#thinking = value;
    // A first value is the initial configuration, not a change.
    if (from === undefined || from === value) return;
    this.#entries.push({
      kind: "config",
      id: this.#id("config"),
      version: 0,
      setting,
      from,
      to: value,
    });
  }

  /** Advances the timeline by one event. */
  reduce(event: TimelineEvent): void {
    switch (event.type) {
      case "message_start": {
        const { message } = event as any;
        if (message.role === "user") {
          const images = imagesOf(contentBlocks(message.content ?? []));
          this.#entries.push({
            kind: "user",
            id: this.#id("user"),
            version: 0,
            text: contentText(message.content ?? []),
            images: images.map(imageLabel),
          });
        } else if (message.role === "assistant") {
          this.#response = this.#id("response");
          this.#upsertAssistant(this.#response, message, true);
        }
        return;
      }
      case "message_update":
      case "message_end": {
        const { message } = event as any;
        if (message.role === "assistant") {
          this.#response ??= this.#id("response");
          this.#upsertAssistant(this.#response, message, event.type === "message_update");
        } else if (event.type === "message_end" && message.role === "toolResult") {
          const index = this.#findTool(
            (tool) => tool.parentId === undefined && tool.callId === message.toolCallId,
          );
          if (index !== -1)
            this.#replace(
              index,
              bump(this.#entries[index] as ToolEntry, {
                state: message.isError ? "error" : "done",
                result: resultData(message.content ?? [], message.details, false),
                content: contentBlocks(message.content ?? []),
              }),
            );
        } else if (event.type === "message_end" && message.role === "custom" && message.display) {
          this.#entries.push({
            kind: "custom",
            id: this.#id("custom"),
            version: 0,
            customType: message.customType,
            text: contentText(
              contentBlocks(
                typeof message.content === "string"
                  ? [{ type: "text", text: message.content }]
                  : (message.content ?? []),
              ),
            ),
            ...(message.details === undefined ? {} : { details: message.details }),
          });
        }
        return;
      }
      case "tool_execution_start": {
        const parentCallId = (event as { parentToolCallId?: string }).parentToolCallId;
        const args: ToolArguments = { available: true, value: event.args };
        if (parentCallId !== undefined) {
          const parentIndex = this.#findTool((tool) => tool.callId === parentCallId);
          if (parentIndex === -1) return;
          const parent = this.#entries[parentIndex] as ToolEntry;
          this.#entries.splice(this.#subtreeEnd(parentIndex), 0, {
            kind: "tool",
            id: `${parent.scope}/${event.toolCallId}`,
            version: 0,
            callId: event.toolCallId,
            scope: parent.scope,
            parentId: parent.id,
            name: event.toolName,
            args,
            state: "running",
            result: undefined,
            content: [],
          });
          return;
        }
        const index = this.#findTool(
          (tool) => tool.parentId === undefined && tool.callId === event.toolCallId,
        );
        if (index !== -1) {
          this.#replace(index, bump(this.#entries[index] as ToolEntry, { state: "running", args }));
          return;
        }
        this.#response ??= this.#id("response");
        this.#entries.push({
          kind: "tool",
          id: `${this.#response}/${event.toolCallId}`,
          version: 0,
          callId: event.toolCallId,
          scope: this.#response,
          parentId: undefined,
          name: event.toolName,
          args,
          state: "running",
          result: undefined,
          content: [],
        });
        return;
      }
      case "tool_execution_update":
      case "tool_execution_end": {
        const nested = (event as { parentToolCallId?: string }).parentToolCallId !== undefined;
        const index = this.#findTool(
          (tool) => tool.callId === event.toolCallId && (tool.parentId !== undefined) === nested,
        );
        if (index === -1) return;
        const tool = this.#entries[index] as ToolEntry;
        if (event.type === "tool_execution_update") {
          const result = toolResult(event.partialResult, true);
          if (result)
            this.#replace(index, bump(tool, { result: result.data, content: result.content }));
          return;
        }
        const result = toolResult(event.result, false);
        this.#replace(
          index,
          bump(tool, {
            state: event.isError ? "error" : "done",
            result: result?.data,
            content: result?.content ?? [],
          }),
        );
        return;
      }
      case "auto_retry_start":
      case "summarization_retry_scheduled": {
        const category = event.type === "auto_retry_start" ? "response" : "summary";
        const attempt: RetryAttempt = {
          attempt: event.attempt,
          maxAttempts: event.maxAttempts,
          delayMs: event.delayMs,
          error: event.errorMessage,
        };
        this.#retry(category, (entry) =>
          bump(entry, { state: "waiting", attempts: [...entry.attempts, attempt] }),
        );
        return;
      }
      case "summarization_retry_attempt_start":
        this.#retry("summary", (entry) => bump(entry, { state: "retrying" }));
        return;
      case "summarization_retry_finished":
        this.#endRetry("summary", { state: "ended" });
        return;
      case "auto_retry_end":
        this.#endRetry("response", {
          state: event.success ? "succeeded" : "failed",
          finalError: event.finalError,
        });
        return;
      case "agent_start": {
        const index = this.#entries.findLastIndex(
          (entry) =>
            entry.kind === "retry" && entry.category === "response" && entry.state === "waiting",
        );
        if (index !== -1)
          this.#replace(index, bump(this.#entries[index] as RetryEntry, { state: "retrying" }));
        return;
      }
      case "compaction_start":
        this.#entries.push({
          kind: "compaction",
          id: this.#id("compaction"),
          version: 0,
          state: "running",
          reason: event.reason,
        });
        return;
      case "compaction_end": {
        const index = this.#entries.findLastIndex(
          (entry) => entry.kind === "compaction" && entry.state === "running",
        );
        const state: CompactionState = event.result
          ? "completed"
          : event.aborted
            ? "aborted"
            : "failed";
        const base: CompactionEntry =
          index === -1
            ? {
                kind: "compaction",
                id: this.#id("compaction"),
                version: 0,
                state: "running",
                reason: event.reason,
              }
            : (this.#entries[index] as CompactionEntry);
        const finished = bump(base, {
          state,
          summary: event.result?.summary,
          tokensBefore: event.result?.tokensBefore,
          errorMessage: event.errorMessage,
        });
        if (index === -1) this.#entries.push(finished);
        else this.#replace(index, finished);
        return;
      }
      case "thinking_level_changed":
        this.#config("thinking", event.level, undefined);
        return;
      case "model_changed":
        this.#config("model", event.model, event.previous);
        return;
      case "agent_settled": {
        this.#response = undefined;
        for (const [index, entry] of this.#entries.entries()) {
          if (entry.kind === "tool" && (entry.state === "pending" || entry.state === "running"))
            this.#replace(index, bump(entry, { state: "unfinished" }));
          else if (entry.kind === "assistant" && entry.streaming)
            this.#replace(index, bump(entry, { streaming: false }));
        }
        return;
      }
      default:
        return;
    }
  }

  /**
   * The items in reading order, the ones that differ from the last call's, and
   * whether the order changed. Items keep their ids, and an unchanged item
   * keeps its version.
   */
  publish(): { items: Item[]; changed: Item[]; order: string[] | undefined } {
    const children = new Map<string, ToolEntry[]>();
    for (const entry of this.#entries) {
      if (entry.kind !== "tool") continue;
      if (entry.parentId !== undefined) {
        const list = children.get(entry.parentId) ?? [];
        list.push(entry);
        children.set(entry.parentId, list);
      }
    }
    const descendants = (id: string, into: ToolEntry[] = []): ToolEntry[] => {
      for (const child of children.get(id) ?? []) {
        into.push(child);
        descendants(child.id, into);
      }
      return into;
    };
    const items: Item[] = [];
    for (const entry of this.#entries) {
      const calls = entry.kind === "tool" ? descendants(entry.id) : [];
      const key = `${entry.version}#${calls.map((call) => `${call.id}@${call.version}`).join(",")}`;
      let cached = this.#cache.get(entry.id);
      if (!cached || cached.key !== key) {
        cached = { key, items: this.#project(entry, calls) };
        this.#cache.set(entry.id, cached);
      }
      items.push(...cached.items);
    }
    const changed: Item[] = [];
    const ids = items.map((item) => item.id);
    for (const item of items) {
      const before = this.#published.get(item.id);
      // A cached entry's items are the same objects as last time.
      if (before?.item === item) continue;
      const { version: _, ...rest } = item;
      const json = JSON.stringify(rest);
      if (before?.json === json) {
        item.version = before.version;
        this.#published.set(item.id, { ...before, item });
        continue;
      }
      item.version = ++this.#itemVersion;
      this.#published.set(item.id, { json, version: item.version, item });
      changed.push(item);
    }
    const order =
      ids.length === this.#publishedOrder.length &&
      ids.every((id, index) => id === this.#publishedOrder[index])
        ? undefined
        : ids;
    if (order) {
      const kept = new Set(ids);
      for (const id of this.#published.keys()) if (!kept.has(id)) this.#published.delete(id);
      this.#publishedOrder = ids;
    }
    return { items, changed, order };
  }

  #project(entry: Entry, calls: readonly ToolEntry[]): Item[] {
    switch (entry.kind) {
      case "user": {
        const data: UserData = { text: entry.text, images: entry.images };
        const attachments = entry.images.length ? `\nattachments: ${entry.images.join("; ")}` : "";
        return [
          item(entry.id, "user", data, `> ${entry.text}${attachments}`, {
            source: entry.text || undefined,
            tone: "user",
          }),
        ];
      }
      case "assistant":
        return this.#projectResponse(entry);
      case "tool":
        return [this.#projectTool(entry, calls)];
      case "compaction": {
        const { kind: _, id: __, version: ___, ...data } = entry;
        const label = {
          running: "compacting…",
          completed: "compacted",
          failed: "compaction failed",
          aborted: "compaction aborted",
        }[entry.state];
        const head = `${label}${entry.reason ? ` (${entry.reason})` : ""}${entry.tokensBefore !== undefined ? ` · ${entry.tokensBefore} tokens before` : ""}`;
        return [
          item(
            entry.id,
            "compaction",
            data,
            [head, entry.errorMessage, entry.summary].filter(Boolean).join("\n"),
            {
              source: entry.summary ?? entry.errorMessage,
              tone:
                entry.state === "failed" ? "error" : entry.state === "aborted" ? "warning" : "dim",
            },
          ),
        ];
      }
      case "retry": {
        const { kind: _, id: __, version: ___, ...data } = entry;
        const last = entry.attempts.at(-1);
        const state = {
          waiting: "waiting to retry",
          retrying: "retrying…",
          succeeded: "succeeded",
          failed: "failed",
          ended: "ended",
        }[entry.state];
        const head = `${entry.category === "summary" ? "summary retry" : "retry"}${last ? ` ${last.attempt}/${last.maxAttempts}` : ""} · ${state}`;
        return [
          item(
            entry.id,
            "retry",
            data,
            [
              head,
              entry.finalError,
              ...entry.attempts.map((a) => `attempt ${a.attempt}/${a.maxAttempts}: ${a.error}`),
            ]
              .filter(Boolean)
              .join("\n"),
            { tone: entry.state === "failed" ? "error" : "warning" },
          ),
        ];
      }
      case "custom": {
        const { kind: _, id: __, version: ___, ...data } = entry;
        return [
          item(entry.id, "custom", data, `${entry.customType}\n${entry.text}`, {
            source: entry.text,
            tone: "accent",
          }),
        ];
      }
      case "config": {
        const { kind: _, id: __, version: ___, ...data } = entry;
        const text = `── ${entry.setting}: ${entry.from} → ${entry.to}`;
        return [item(entry.id, "config", data, text, { source: text, tone: "dim" })];
      }
      case "notice": {
        const { kind: _, id: __, version: ___, ...data } = entry;
        return [
          item(entry.id, "notice", data, entry.text, {
            source: entry.text,
            tone: entry.level === "info" ? "accent" : entry.level,
          }),
        ];
      }
    }
  }

  #projectResponse(entry: AssistantEntry): Item[] {
    const thinking = entry.parts.filter((part) => part.type === "thinking");
    const body = contentText(entry.parts);
    const data: ResponseData = {
      thinking: thinking
        .map((part) => part.text)
        .filter((text) => text !== "")
        .join("\n\n"),
      hasThinking: thinking.length > 0,
      thinkingWithheld: thinking.length > 0 && thinking.every((part) => part.withheld),
      body,
      streaming: entry.streaming,
      stopReason: entry.stopReason,
      errorMessage: entry.errorMessage,
    };
    const stop = stopText(data);
    const parent = item(
      entry.id,
      "response",
      data,
      [body, stop].filter(Boolean).join("\n") || (data.hasThinking ? "thinking…" : ""),
      {
        source: body || undefined,
        tone:
          data.stopReason === "error"
            ? "error"
            : data.stopReason === "aborted"
              ? "warning"
              : undefined,
      },
    );
    let fences = this.#fences.get(entry.id);
    if (!fences) this.#fences.set(entry.id, (fences = new Map()));
    const children: Item[] = [];
    for (const [index, part] of entry.parts.entries()) {
      if (part.type === "thinking") {
        children.push(
          item(
            `${entry.id}:thinking:${index}`,
            "thinking",
            { text: part.text, withheld: part.withheld },
            part.withheld || part.text === "" ? "thinking withheld" : `thinking\n${part.text}`,
            { parentId: entry.id, source: part.withheld ? undefined : part.text, tone: "dim" },
          ),
        );
        continue;
      }
      let splitter = fences.get(index);
      if (!splitter) fences.set(index, (splitter = new StreamingFences()));
      for (const [block, fenced] of splitter.split(part.text).entries()) {
        const id = `${entry.id}:text:${index}:part:${block}`;
        // A blank run between fences has nothing to show; later ids stay stable.
        if (fenced.type === "text" && fenced.text.trim() === "") continue;
        const kept = this.#blocks.get(fenced);
        if (kept && kept.streaming === entry.streaming) {
          children.push(kept.item);
          continue;
        }
        const projected =
          fenced.type === "text"
            ? item(id, "prose", { text: fenced.text, streaming: entry.streaming }, fenced.text, {
                parentId: entry.id,
                source: fenced.text,
              })
            : item(
                id,
                "code",
                {
                  language: fenced.language,
                  body: fenced.body,
                  sourceText: fenced.sourceText,
                  open: fenced.open ?? false,
                },
                fenced.sourceText,
                { parentId: entry.id, source: fenced.sourceText },
              );
        this.#blocks.set(fenced, { streaming: entry.streaming, item: projected });
        children.push(projected);
      }
    }
    // A finished response is split once more at most, from scratch, with the same ids.
    if (!entry.streaming) this.#fences.delete(entry.id);
    return [parent, ...children];
  }

  #projectTool(entry: ToolEntry, calls: readonly ToolEntry[]): Item {
    const data: ToolData = {
      callId: entry.callId,
      name: entry.name,
      args: entry.args,
      state: entry.state,
      ...(entry.result ? { result: entry.result } : {}),
      calls: calls.map((call): NestedCallSummary => ({
        name: call.name,
        args: call.args,
        state: call.state,
      })),
    };
    const decorators = this.#decorators.get(entry.name);
    if (decorators?.size) {
      const extra: Record<string, unknown> = {};
      for (const [owner, decorate] of decorators) {
        try {
          const value = decorate(data, entry.content);
          if (value !== undefined) extra[owner] = value;
        } catch (error) {
          extra[owner] = { error: error instanceof Error ? error.message : String(error) };
        }
      }
      data.extra = extra;
    }
    const state = toolStateText[entry.state];
    const result = entry.result
      ? [entry.result.text, ...entry.result.images.map((label) => `[image: ${label}]`)]
          .filter(Boolean)
          .join("\n")
      : "";
    return item(
      entry.id,
      "tool",
      data,
      `${entry.name} ${argsLine(entry.args, 120)} · ${state}${result ? `\n${result}` : ""}`,
      {
        variant: entry.name,
        parentId: entry.parentId,
        source: entry.result && !entry.result.partial ? entry.result.text || undefined : undefined,
        tone:
          entry.state === "error" ? "error" : entry.state === "unfinished" ? "warning" : undefined,
      },
    );
  }
}

function item(
  id: string,
  kind: string,
  data: unknown,
  text: string,
  options: Partial<Pick<Item, "variant" | "parentId" | "source" | "tone">> = {},
): Item {
  const result: Item = { id, version: 0, kind, text, data };
  for (const [key, value] of Object.entries(options))
    if (value !== undefined) (result as unknown as Record<string, unknown>)[key] = value;
  return result;
}
