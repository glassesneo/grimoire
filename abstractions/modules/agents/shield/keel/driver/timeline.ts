/**
 * Pi's session events as keel entries (the keel contract's Entry): what the user sent, each
 * response with its thinking and text, each tool call with its arguments, state, and result,
 * a call a tool made under that tool, and compaction, retries, custom messages, setting
 * changes, and notices. Nothing is invented: what the session did not supply is marked
 * unavailable. The model turns entries into the items screens show.
 *
 * The timeline keeps each entry's id and counts its changes in `version`; `take` returns the
 * entries that changed since the last call, with the complete order when an entry was not
 * appended. A tool's raw result content stays here for its decorators: a decorator receives
 * the tool's own entry, without the extras, and that content, and runs again when that entry
 * changes or a decorator of its tool comes or goes; its result goes to the model in `extra`.
 *
 * keel always starts a new session, so there is no saved branch to restore.
 */
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { ToolDecorator, ToolCall } from "../api";
import type { NoticeLevel, RetryAttempt, ToolArguments } from "../protocol/items";
import type { Entry, ToolEntry } from "../protocol/wire";
import { contentText, imageLabel, imagesOf, isContentBlock, type ResultContent } from "./content";
import { isRecord } from "../protocol/format";

type Part = Extract<Entry, { kind: "assistant" }>["parts"][number];
type AssistantEntry = Extract<Entry, { kind: "assistant" }>;
type RetryEntry = Extract<Entry, { kind: "retry" }>;
type CompactionEntry = Extract<Entry, { kind: "compaction" }>;

/** A tool entry with what stays in the driver. */
interface Tool extends ToolEntry {
  /** The response that issued the root call; call ids are unique only within it. */
  scope: string;
  /** The result's content as Pi gave it, for decorators; never sent. */
  content: ResultContent;
}

type Held = Exclude<Entry, ToolEntry> | Tool;

/** Events the timeline follows: the session's, and what the driver observes elsewhere. */
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

function bump<E extends Held>(entry: E, changes: Partial<E>): E {
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
function toolResult(result: unknown, partial: boolean) {
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

/** An optional field only when it has a value, as the contract's records carry them. */
const present = <K extends string, V>(key: K, value: V | undefined) =>
  (value === undefined ? {} : { [key]: value }) as Partial<Record<K, V>>;

export class Timeline {
  #entries: Held[] = [];
  #next = 0;
  /** Scope of the response being streamed, or whose tools run. */
  #response: string | undefined;
  #model: string | undefined;
  #thinking: string | undefined;
  readonly #decorators = new Map<string, Map<string, ToolDecorator>>();
  /** Ids changed since the last `take`, and whether an entry was inserted before others. */
  #changed = new Set<string>();
  #reordered = false;

  constructor(settings: { model?: string; thinking?: string } = {}) {
    this.#model = settings.model;
    this.#thinking = settings.thinking;
  }

  /** Called when entries changed; `take` collects them. */
  onChange: () => void = () => {};

  #id(prefix: string) {
    return `${prefix}-${this.#next++}`;
  }

  /** Adds a presentation for the tool named `tool`; its entries carry it while registered. */
  decorate(tool: string, owner: string, decorator: ToolDecorator): () => void {
    const byOwner = this.#decorators.get(tool) ?? new Map<string, ToolDecorator>();
    this.#decorators.set(tool, byOwner);
    byOwner.set(owner, decorator);
    this.#redecorate(tool);
    return () => {
      if (byOwner.get(owner) !== decorator) return;
      byOwner.delete(owner);
      this.#redecorate(tool);
    };
  }

  #redecorate(name: string) {
    for (const [index, entry] of this.#entries.entries())
      if (entry.kind === "tool" && entry.name === name) this.#replace(index, bump(entry, {}));
  }

  /** The extras of a tool's decorators, computed from its own entry and raw content. */
  #decorated(entry: Tool): Tool {
    const { extra: _, scope: __, content, ...call } = entry;
    const decorators = this.#decorators.get(entry.name);
    if (!decorators?.size) return { ...call, scope: entry.scope, content } as Tool;
    const extra: Record<string, unknown> = {};
    const tool: ToolCall = {
      callId: call.callId,
      name: call.name,
      args: call.args,
      state: call.state,
      ...present("result", call.result),
    };
    for (const [owner, decorate] of decorators) {
      try {
        const value = decorate(tool, content);
        if (value !== undefined) extra[owner] = value;
      } catch (error) {
        extra[owner] = { error: error instanceof Error ? error.message : String(error) };
      }
    }
    return { ...call, extra, scope: entry.scope, content } as Tool;
  }

  #store(entry: Held): Held {
    return entry.kind === "tool" ? this.#decorated(entry) : entry;
  }

  #changedEntry(id: string) {
    this.#changed.add(id);
    this.onChange();
  }

  #push(entry: Held) {
    this.#entries.push(this.#store(entry));
    this.#changedEntry(entry.id);
  }

  #insert(index: number, entry: Held) {
    if (index < this.#entries.length) this.#reordered = true;
    this.#entries.splice(index, 0, this.#store(entry));
    this.#changedEntry(entry.id);
  }

  #replace(index: number, entry: Held) {
    this.#entries[index] = this.#store(entry);
    this.#changedEntry(entry.id);
  }

  /** An entry as the contract carries it, without what stays in the driver. */
  #wire(entry: Held): Entry {
    if (entry.kind !== "tool") return entry;
    const { scope: _, content: __, ...wire } = entry;
    return wire;
  }

  /** The entries changed since the last call, in order; undefined when none did. */
  take(): { entries: Entry[]; order?: string[] } | undefined {
    if (this.#changed.size === 0) return undefined;
    const entries = this.#entries.filter((entry) => this.#changed.has(entry.id));
    const result = {
      entries: entries.map((entry) => this.#wire(entry)),
      ...(this.#reordered ? { order: this.#entries.map((entry) => entry.id) } : {}),
    };
    this.#changed.clear();
    this.#reordered = false;
    return result;
  }

  notice(level: NoticeLevel, text: string): void {
    this.#push({ kind: "notice", id: this.#id("notice"), version: 0, level, text });
  }

  #findTool(predicate: (entry: Tool) => boolean): number {
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

  #tool(fields: {
    id: string;
    callId: string;
    scope: string;
    parentId: string | undefined;
    name: string;
    args: ToolArguments;
    state: Tool["state"];
  }): Tool {
    const { parentId, ...rest } = fields;
    return { kind: "tool", version: 0, ...rest, ...present("parentId", parentId), content: [] };
  }

  #upsertAssistant(scope: string, message: any, streaming: boolean) {
    const parts = assistantParts(message);
    const stopReason: string | undefined = streaming ? undefined : message.stopReason;
    const errorMessage: string | undefined = message.errorMessage;
    const index = this.#entries.findLastIndex(
      (entry) => entry.kind === "assistant" && entry.id === scope,
    );
    const fields = {
      parts,
      streaming,
      ...present("stopReason", stopReason),
      ...present("errorMessage", errorMessage),
    };
    if (index !== -1) {
      const previous = this.#entries[index] as AssistantEntry;
      if (
        !sameParts(previous.parts, parts) ||
        previous.streaming !== streaming ||
        previous.stopReason !== stopReason ||
        previous.errorMessage !== errorMessage
      ) {
        const { stopReason: _, errorMessage: __, ...rest } = previous;
        this.#replace(index, { ...rest, ...fields, version: previous.version + 1 });
      }
    } else {
      const entry: AssistantEntry = { kind: "assistant", id: scope, version: 0, ...fields };
      if (responseVisible(entry)) {
        // Tools the response already announced stay after its text.
        const firstTool = this.#entries.findIndex(
          (candidate) => candidate.kind === "tool" && candidate.scope === scope,
        );
        if (firstTool === -1) this.#push(entry);
        else this.#insert(firstTool, entry);
      }
    }
    for (const block of message.content ?? []) {
      if (block?.type !== "toolCall") continue;
      const id = `${scope}/${block.id}`;
      const existing = this.#entries.findLastIndex((entry) => entry.id === id);
      const args: ToolArguments = { available: true, value: block.arguments ?? {} };
      if (existing === -1) {
        this.#push(
          this.#tool({
            id,
            callId: block.id,
            scope,
            parentId: undefined,
            name: block.name,
            args,
            state: "pending",
          }),
        );
      } else {
        const tool = this.#entries[existing] as Tool;
        if (tool.state === "pending" && JSON.stringify(tool.args) !== JSON.stringify(args))
          this.#replace(existing, bump(tool, { args }));
      }
    }
  }

  #openRetry(category: RetryEntry["category"]): number {
    return this.#entries.findLastIndex(
      (entry) =>
        entry.kind === "retry" &&
        entry.category === category &&
        (entry.state === "waiting" || entry.state === "retrying"),
    );
  }

  #retry(category: RetryEntry["category"], update: (entry: RetryEntry) => RetryEntry) {
    const index = this.#openRetry(category);
    if (index === -1)
      this.#push(
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

  #endRetry(category: RetryEntry["category"], changes: Partial<RetryEntry>) {
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
    this.#push({ kind: "config", id: this.#id("config"), version: 0, setting, from, to: value });
  }

  /** Advances the timeline by one event. */
  reduce(event: TimelineEvent): void {
    switch (event.type) {
      case "message_start": {
        const { message } = event as any;
        if (message.role === "user") {
          const images = imagesOf(contentBlocks(message.content ?? []));
          this.#push({
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
              bump(this.#entries[index] as Tool, {
                state: message.isError ? "error" : "done",
                result: resultData(message.content ?? [], message.details, false),
                content: contentBlocks(message.content ?? []),
              }),
            );
        } else if (event.type === "message_end" && message.role === "custom" && message.display) {
          this.#push({
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
            ...present("details", message.details as unknown),
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
          const parent = this.#entries[parentIndex] as Tool;
          this.#insert(
            this.#subtreeEnd(parentIndex),
            this.#tool({
              id: `${parent.scope}/${event.toolCallId}`,
              callId: event.toolCallId,
              scope: parent.scope,
              parentId: parent.id,
              name: event.toolName,
              args,
              state: "running",
            }),
          );
          return;
        }
        const index = this.#findTool(
          (tool) => tool.parentId === undefined && tool.callId === event.toolCallId,
        );
        if (index !== -1) {
          this.#replace(index, bump(this.#entries[index] as Tool, { state: "running", args }));
          return;
        }
        this.#response ??= this.#id("response");
        this.#push(
          this.#tool({
            id: `${this.#response}/${event.toolCallId}`,
            callId: event.toolCallId,
            scope: this.#response,
            parentId: undefined,
            name: event.toolName,
            args,
            state: "running",
          }),
        );
        return;
      }
      case "tool_execution_update":
      case "tool_execution_end": {
        const nested = (event as { parentToolCallId?: string }).parentToolCallId !== undefined;
        const index = this.#findTool(
          (tool) => tool.callId === event.toolCallId && (tool.parentId !== undefined) === nested,
        );
        if (index === -1) return;
        const tool = this.#entries[index] as Tool;
        if (event.type === "tool_execution_update") {
          const result = toolResult(event.partialResult, true);
          if (result)
            this.#replace(index, bump(tool, { result: result.data, content: result.content }));
          return;
        }
        const result = toolResult(event.result, false);
        const { result: _, ...rest } = tool;
        this.#replace(index, {
          ...rest,
          version: tool.version + 1,
          state: event.isError ? "error" : "done",
          ...present("result", result?.data),
          content: result?.content ?? [],
        });
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
          ...present("finalError", event.finalError),
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
        this.#push({
          kind: "compaction",
          id: this.#id("compaction"),
          version: 0,
          state: "running",
          ...present("reason", event.reason as string | undefined),
        });
        return;
      case "compaction_end": {
        const index = this.#entries.findLastIndex(
          (entry) => entry.kind === "compaction" && entry.state === "running",
        );
        const state: CompactionEntry["state"] = event.result
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
                ...present("reason", event.reason as string | undefined),
              }
            : (this.#entries[index] as CompactionEntry);
        const finished: CompactionEntry = {
          ...base,
          version: base.version + 1,
          state,
          ...present("summary", event.result?.summary),
          ...present("tokensBefore", event.result?.tokensBefore),
          ...present("errorMessage", event.errorMessage),
        };
        if (index === -1) this.#push(finished);
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
}
