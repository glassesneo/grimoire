import type {
  AssistantMessage,
  ImageContent,
  NestedToolCalls,
  StopReason,
  TextContent,
  ToolResultMessage,
} from "@earendil-works/pi-ai";
import { contentText } from "@earendil-works/pi-ai";
import type {
  AgentSessionEvent,
  SessionEntry as PiSessionEntry,
} from "@earendil-works/pi-coding-agent";
import type { DisplayRecords, NestedToolRecord } from "./display-records";

/**
 * What the timeline shows, derived from session events and, for an existing
 * history, from the branch's entries. Each entry carries a monotonic `version`
 * so the projection can replace an item in place without changing its
 * identity. Nothing here is invented: data the session did not supply is
 * marked unavailable rather than filled in.
 */
export type SessionEntry =
  | UserEntry
  | AssistantEntry
  | ToolEntry
  | BashEntry
  | CompactionEntry
  | RetryEntry
  | BranchSummaryEntry
  | CustomMessageEntry
  | ConfigEntry
  | NoticeEntry
  | ContributionEntry;

export type ResultContent = (TextContent | ImageContent)[];

export interface UserEntry {
  kind: "user";
  id: string;
  version: number;
  text: string;
  images: ImageContent[];
}

export type AssistantPart =
  | {
      type: "thinking";
      text: string;
      /** The provider withheld or redacted the text. */ withheld: boolean;
    }
  | { type: "text"; text: string };

export interface AssistantEntry {
  kind: "assistant";
  id: string;
  version: number;
  parts: AssistantPart[];
  streaming: boolean;
  stopReason: StopReason | undefined;
  errorMessage: string | undefined;
}

/**
 * `pending`: the model issued the call but it has not started. `unfinished`:
 * the run settled while it was pending or running. `missing`: the history has
 * the call but no result for it.
 */
export type ToolState = "pending" | "running" | "done" | "error" | "unfinished" | "missing";

export type ToolArguments =
  | { available: true; value: unknown }
  | { available: false; /** Size of arguments a bounded record left out. */ bytes?: number };

export interface ToolEntry {
  kind: "tool";
  id: string;
  version: number;
  callId: string;
  /** The response that issued the root call; call ids are unique only within it. */
  scope: string;
  /** Entry id of the tool that made this call through `ctx.executeTool()`. */
  parentId: string | undefined;
  name: string;
  /** Start order among the calls of one scope. */
  ordinal: number;
  args: ToolArguments;
  state: ToolState;
  /** Absent when no result was received or recorded. */
  result: ToolResult | undefined;
  /** Error text from a bounded record that kept no result. */
  errorSummary: string | undefined;
  /** For a calling tool whose nested calls came from a bounded record. */
  nestedIncomplete: boolean;
}

export interface ToolResult {
  content: ResultContent;
  details: unknown;
  /** A streamed update rather than the final result. */
  partial: boolean;
}

/** A shell command the session ran outside a tool call. */
export interface BashEntry {
  kind: "bash";
  id: string;
  version: number;
  /** The id pi tags this run's output with, while it runs. */
  stream: string | undefined;
  command: string | undefined;
  output: string;
  exitCode: number | undefined;
  cancelled: boolean;
  truncated: boolean;
  fullOutputPath: string | undefined;
  running: boolean;
}

export type CompactionState = "running" | "completed" | "failed" | "aborted";

export interface CompactionEntry {
  kind: "compaction";
  id: string;
  version: number;
  state: CompactionState;
  reason: string | undefined;
  summary: string | undefined;
  tokensBefore: number | undefined;
  errorMessage: string | undefined;
}

export type RetryCategory = "response" | "summary";
export type RetryState = "waiting" | "retrying" | "succeeded" | "failed" | "ended";

export interface RetryAttempt {
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  error: string;
}

export interface RetryEntry {
  kind: "retry";
  id: string;
  version: number;
  category: RetryCategory;
  state: RetryState;
  attempts: RetryAttempt[];
  finalError: string | undefined;
}

export interface BranchSummaryEntry {
  kind: "branch-summary";
  id: string;
  version: number;
  summary: string;
}

export interface CustomMessageEntry {
  kind: "custom";
  id: string;
  version: number;
  customType: string;
  content: string | ResultContent;
  details: unknown;
}

export interface ConfigEntry {
  kind: "config";
  id: string;
  version: number;
  setting: "model" | "thinking";
  from: string;
  to: string;
}

export interface NoticeEntry {
  kind: "notice";
  id: string;
  version: number;
  level: NoticeLevel;
  text: string;
}

export type NoticeLevel = "info" | "warning" | "error";

/**
 * An item a contribution or extension added apart from the session, shown
 * with the registered kind it names. It is not part of the saved history.
 */
export interface ContributionEntry {
  kind: "contribution";
  id: string;
  version: number;
  type: string;
  value: unknown;
}

let nextId = 0;
const newId = (prefix = "entry") => `${prefix}-${nextId++}`;

export function notice(level: NoticeLevel, text: string): NoticeEntry {
  return { kind: "notice", id: newId(), version: 0, level, text };
}

export const toolEntryId = (scope: string, callId: string) => `${scope}/${callId}`;

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A text or image block, the content tool results and user messages carry. */
export function isContentBlock(value: unknown): value is TextContent | ImageContent {
  return (
    isRecord(value) &&
    ((value.type === "text" && typeof value.text === "string") ||
      (value.type === "image" &&
        typeof value.data === "string" &&
        typeof value.mimeType === "string"))
  );
}

export const isResultContent = (value: unknown): value is ResultContent =>
  Array.isArray(value) && value.every(isContentBlock);

export function imagesOf(
  content: string | readonly (TextContent | ImageContent)[] | undefined,
): ImageContent[] {
  return typeof content === "string" || !content
    ? []
    : content.filter((block): block is ImageContent => block.type === "image");
}

export function modelName(model: { provider: string; id: string }): string {
  return `${model.provider}/${model.id}`;
}

function userEntry(id: string, content: string | (TextContent | ImageContent)[]): UserEntry {
  return { kind: "user", id, version: 0, text: contentText(content), images: imagesOf(content) };
}

function toolEntry(
  scope: string,
  callId: string,
  fields: Pick<ToolEntry, "name" | "ordinal" | "args" | "state"> & Partial<ToolEntry>,
): ToolEntry {
  return {
    kind: "tool",
    id: toolEntryId(scope, callId),
    version: 0,
    callId,
    scope,
    parentId: undefined,
    result: undefined,
    errorSummary: undefined,
    nestedIncomplete: false,
    ...fields,
  };
}
// ---------------------------------------------------------------------------
// Live state
// ---------------------------------------------------------------------------

/** Events the timeline follows: the session's, plus changes the harness observes elsewhere. */
export type TimelineEvent =
  | AgentSessionEvent
  | { type: "model_changed"; previous: string | undefined; model: string }
  /**
   * A shell command the session runs directly. pi streams its output tagged
   * with `id` but announces neither start nor end, so the host does; a
   * missing result means the run threw.
   */
  | { type: "bash_started"; id: string; command: string }
  | { type: "bash_finished"; id: string; result: BashResult | undefined };

export interface BashResult {
  output: string;
  exitCode: number | undefined;
  cancelled: boolean;
  truncated: boolean;
  fullOutputPath?: string;
}

function runningBash(entries: Entries, stream: string | undefined): number {
  return entries.findLastIndex(
    (entry) => entry.kind === "bash" && entry.running && entry.stream === stream,
  );
}

function newBash(
  stream: string | undefined,
  command: string | undefined,
  output: string,
): BashEntry {
  return {
    kind: "bash",
    id: newId("bash"),
    version: 0,
    stream,
    command,
    output,
    exitCode: undefined,
    cancelled: false,
    truncated: false,
    fullOutputPath: undefined,
    running: true,
  };
}

export interface TimelineState {
  readonly entries: readonly SessionEntry[];
  /** Scope of the response being streamed, or whose tools run. */
  readonly response: string | undefined;
  readonly nextOrdinal: number;
  /** Settings as last seen, so a change can name what it replaced. */
  readonly model: string | undefined;
  readonly thinking: string | undefined;
}

export function timelineState(
  entries: readonly SessionEntry[],
  settings: { model?: string; thinking?: string } = {},
): TimelineState {
  return {
    entries,
    response: undefined,
    nextOrdinal: 0,
    model: settings.model,
    thinking: settings.thinking,
  };
}

type Entries = readonly SessionEntry[];

function bump<E extends SessionEntry>(entry: E, changes: Partial<E>): E {
  return { ...entry, ...changes, version: entry.version + 1 };
}

function replaceAt(entries: Entries, index: number, entry: SessionEntry): Entries {
  const next = [...entries];
  next[index] = entry;
  return next;
}

/** The index after the last entry of `index`'s subtree, where a new child goes. */
function subtreeEnd(entries: Entries, index: number): number {
  const members = new Set([entries[index]!.id]);
  let end = index + 1;
  while (end < entries.length) {
    const entry = entries[end]!;
    if (entry.kind !== "tool" || entry.parentId === undefined || !members.has(entry.parentId))
      break;
    members.add(entry.id);
    end++;
  }
  return end;
}

function findTool(entries: Entries, predicate: (entry: ToolEntry) => boolean): number {
  return entries.findLastIndex((entry) => entry.kind === "tool" && predicate(entry));
}

function assistantParts(message: AssistantMessage): AssistantPart[] {
  return message.content.flatMap((block): AssistantPart[] => {
    if (block.type === "text") return [{ type: "text", text: block.text }];
    if (block.type === "thinking") {
      return [
        {
          type: "thinking",
          text: block.redacted ? "" : block.thinking,
          withheld:
            Boolean(block.redacted) || (block.thinking === "" && Boolean(block.thinkingSignature)),
        },
      ];
    }
    return [];
  });
}

/** Whether a response has anything of its own to show; tool-only replies have not. */
function responseVisible(
  parts: AssistantPart[],
  stopReason: StopReason | undefined,
  streaming: boolean,
): boolean {
  if (parts.some((part) => part.type === "thinking" || part.text !== "")) return true;
  return (
    !streaming && (stopReason === "error" || stopReason === "aborted" || stopReason === "length")
  );
}

function upsertAssistant(
  state: TimelineState,
  scope: string,
  message: AssistantMessage,
  streaming: boolean,
): TimelineState {
  const parts = assistantParts(message);
  let entries = state.entries;
  // The streamed response is near the end.
  const index = entries.findLastIndex((entry) => entry.kind === "assistant" && entry.id === scope);
  if (index !== -1) {
    const previous = entries[index] as AssistantEntry;
    const samePart = (part: AssistantPart, at: number) => {
      const before = previous.parts[at];
      return (
        before?.type === part.type &&
        before.text === part.text &&
        (part.type === "text" || (before as { withheld: boolean }).withheld === part.withheld)
      );
    };
    const changed =
      previous.parts.length !== parts.length ||
      !parts.every(samePart) ||
      previous.streaming !== streaming ||
      previous.stopReason !== message.stopReason ||
      previous.errorMessage !== message.errorMessage;
    if (changed) {
      entries = replaceAt(
        entries,
        index,
        bump(previous, {
          parts,
          streaming,
          stopReason: streaming ? undefined : message.stopReason,
          errorMessage: message.errorMessage,
        }),
      );
    }
  } else if (responseVisible(parts, message.stopReason, streaming)) {
    const entry: AssistantEntry = {
      kind: "assistant",
      id: scope,
      version: 0,
      parts,
      streaming,
      stopReason: streaming ? undefined : message.stopReason,
      errorMessage: message.errorMessage,
    };
    // Tools the response already announced stay after its text.
    const firstTool = entries.findIndex(
      (candidate) => candidate.kind === "tool" && candidate.scope === scope,
    );
    entries =
      firstTool === -1
        ? [...entries, entry]
        : [...entries.slice(0, firstTool), entry, ...entries.slice(firstTool)];
  }

  let nextOrdinal = state.nextOrdinal;
  for (const block of message.content) {
    if (block.type !== "toolCall") continue;
    const id = toolEntryId(scope, block.id);
    const existing = entries.findLastIndex((entry) => entry.id === id);
    if (existing === -1) {
      entries = [
        ...entries,
        toolEntry(scope, block.id, {
          name: block.name,
          ordinal: nextOrdinal++,
          args: { available: true, value: block.arguments },
          state: "pending",
        }),
      ];
    } else {
      const tool = entries[existing] as ToolEntry;
      const before = tool.args.available ? tool.args.value : undefined;
      // The same object serializes the same; only a new one needs comparing.
      if (
        tool.state === "pending" &&
        before !== block.arguments &&
        JSON.stringify(before) !== JSON.stringify(block.arguments)
      ) {
        entries = replaceAt(
          entries,
          existing,
          bump(tool, { args: { available: true, value: block.arguments } }),
        );
      }
    }
  }
  return { ...state, entries, nextOrdinal };
}

/** Text and image blocks only; tools from extensions can return anything. */
const contentBlocks = (content: readonly unknown[]): ResultContent =>
  content.filter(isContentBlock);

/** Tool results reach the session as a message content, a string, or a wrapper. */
function toolResult(result: unknown, partial: boolean): ToolResult | undefined {
  if (typeof result === "string")
    return { content: [{ type: "text", text: result }], details: undefined, partial };
  if (Array.isArray(result)) return { content: contentBlocks(result), details: undefined, partial };
  if (result && typeof result === "object" && "content" in result) {
    const { content, details } = result as { content: unknown; details?: unknown };
    if (typeof content === "string")
      return { content: [{ type: "text", text: content }], details, partial };
    if (Array.isArray(content)) return { content: contentBlocks(content), details, partial };
  }
  return undefined;
}

function finishToolResult(entries: Entries, index: number, message: ToolResultMessage): Entries {
  const tool = entries[index] as ToolEntry;
  return replaceAt(
    entries,
    index,
    bump(tool, {
      state: message.isError ? "error" : "done",
      result: { content: contentBlocks(message.content), details: message.details, partial: false },
    }),
  );
}

/** The retry sequence of a category that has not ended yet. */
function openRetry(entries: Entries, category: RetryCategory): number {
  return entries.findLastIndex(
    (entry) =>
      entry.kind === "retry" &&
      entry.category === category &&
      (entry.state === "waiting" || entry.state === "retrying"),
  );
}

function upsertRetry(
  entries: Entries,
  category: RetryCategory,
  update: (entry: RetryEntry | undefined) => RetryEntry,
): Entries {
  const index = openRetry(entries, category);
  if (index === -1) return [...entries, update(undefined)];
  return replaceAt(entries, index, update(entries[index] as RetryEntry));
}

/** Change an open retry sequence; without one, nothing changes. */
function endRetry(
  state: TimelineState,
  category: RetryCategory,
  changes: Partial<RetryEntry>,
): TimelineState {
  const index = openRetry(state.entries, category);
  return index === -1
    ? state
    : {
        ...state,
        entries: replaceAt(state.entries, index, bump(state.entries[index] as RetryEntry, changes)),
      };
}

function newRetry(category: RetryCategory): RetryEntry {
  return {
    kind: "retry",
    id: newId("retry"),
    version: 0,
    category,
    state: "waiting",
    attempts: [],
    finalError: undefined,
  };
}

function newCompaction(reason: string): CompactionEntry {
  return {
    kind: "compaction",
    id: newId("compaction"),
    version: 0,
    state: "running",
    reason,
    summary: undefined,
    tokensBefore: undefined,
    errorMessage: undefined,
  };
}

function configChange(
  state: TimelineState,
  setting: "model" | "thinking",
  value: string,
  previous: string | undefined,
): TimelineState {
  const from = previous ?? state[setting];
  const next = { ...state, [setting]: value };
  // A first value is the initial configuration, not a change.
  if (from === undefined || from === value) return next;
  return {
    ...next,
    entries: [
      ...state.entries,
      { kind: "config", id: newId("config"), version: 0, setting, from, to: value },
    ],
  };
}

/** Advance the live timeline by one event. */
export function reduceTimeline(state: TimelineState, event: TimelineEvent): TimelineState {
  const { entries } = state;
  switch (event.type) {
    case "message_start": {
      const { message } = event;
      if (message.role === "user") {
        return { ...state, entries: [...entries, userEntry(newId("user"), message.content)] };
      }
      if (message.role === "assistant") {
        const scope = newId("response");
        return upsertAssistant({ ...state, response: scope }, scope, message, true);
      }
      return state;
    }
    case "message_update":
    case "message_end": {
      const { message } = event;
      if (message.role === "assistant") {
        const scope = state.response ?? newId("response");
        return upsertAssistant(
          { ...state, response: scope },
          scope,
          message,
          event.type === "message_update",
        );
      }
      if (event.type === "message_end" && message.role === "toolResult") {
        const index = findTool(
          entries,
          (tool) => tool.parentId === undefined && tool.callId === message.toolCallId,
        );
        return index === -1
          ? state
          : { ...state, entries: finishToolResult(entries, index, message) };
      }
      if (event.type === "message_end" && message.role === "custom" && message.display) {
        return {
          ...state,
          entries: [
            ...entries,
            {
              kind: "custom",
              id: newId("custom"),
              version: 0,
              customType: message.customType,
              content: message.content,
              details: message.details,
            },
          ],
        };
      }
      return state;
    }
    case "tool_execution_start": {
      if (event.parentToolCallId !== undefined) {
        const parentIndex = findTool(entries, (tool) => tool.callId === event.parentToolCallId);
        if (parentIndex === -1) return state;
        const parent = entries[parentIndex] as ToolEntry;
        const child = toolEntry(parent.scope, event.toolCallId, {
          parentId: parent.id,
          name: event.toolName,
          ordinal: state.nextOrdinal,
          args: { available: true, value: event.args },
          state: "running",
        });
        const at = subtreeEnd(entries, parentIndex);
        return {
          ...state,
          nextOrdinal: state.nextOrdinal + 1,
          entries: [...entries.slice(0, at), child, ...entries.slice(at)],
        };
      }
      const index = findTool(
        entries,
        (tool) => tool.parentId === undefined && tool.callId === event.toolCallId,
      );
      if (index !== -1) {
        const tool = entries[index] as ToolEntry;
        return {
          ...state,
          entries: replaceAt(
            entries,
            index,
            bump(tool, { state: "running", args: { available: true, value: event.args } }),
          ),
        };
      }
      const scope = state.response ?? newId("response");
      return {
        ...state,
        response: scope,
        nextOrdinal: state.nextOrdinal + 1,
        entries: [
          ...entries,
          toolEntry(scope, event.toolCallId, {
            name: event.toolName,
            ordinal: state.nextOrdinal,
            args: { available: true, value: event.args },
            state: "running",
          }),
        ],
      };
    }
    case "tool_execution_update":
    case "tool_execution_end": {
      const nested = event.parentToolCallId !== undefined;
      const index = findTool(
        entries,
        (tool) => tool.callId === event.toolCallId && (tool.parentId !== undefined) === nested,
      );
      if (index === -1) return state;
      const tool = entries[index] as ToolEntry;
      if (event.type === "tool_execution_update") {
        const result = toolResult(event.partialResult, true);
        return result
          ? { ...state, entries: replaceAt(entries, index, bump(tool, { result })) }
          : state;
      }
      return {
        ...state,
        entries: replaceAt(
          entries,
          index,
          bump(tool, {
            state: event.isError ? "error" : "done",
            result: toolResult(event.result, false),
          }),
        ),
      };
    }
    case "auto_retry_start":
    case "summarization_retry_scheduled": {
      const category: RetryCategory = event.type === "auto_retry_start" ? "response" : "summary";
      const attempt: RetryAttempt = {
        attempt: event.attempt,
        maxAttempts: event.maxAttempts,
        delayMs: event.delayMs,
        error: event.errorMessage,
      };
      return {
        ...state,
        entries: upsertRetry(entries, category, (entry) => {
          const base = entry ?? newRetry(category);
          return bump(base, { state: "waiting", attempts: [...base.attempts, attempt] });
        }),
      };
    }
    case "summarization_retry_attempt_start":
      return {
        ...state,
        entries: upsertRetry(entries, "summary", (entry) =>
          bump(entry ?? newRetry("summary"), { state: "retrying" }),
        ),
      };
    case "summarization_retry_finished":
      return endRetry(state, "summary", { state: "ended" });
    case "auto_retry_end":
      return endRetry(state, "response", {
        state: event.success ? "succeeded" : "failed",
        finalError: event.finalError,
      });
    case "agent_start": {
      const index = entries.findLastIndex(
        (entry) =>
          entry.kind === "retry" && entry.category === "response" && entry.state === "waiting",
      );
      return index === -1
        ? state
        : {
            ...state,
            entries: replaceAt(
              entries,
              index,
              bump(entries[index] as RetryEntry, { state: "retrying" }),
            ),
          };
    }
    case "compaction_start":
      return {
        ...state,
        entries: [...entries, newCompaction(event.reason)],
      };
    case "compaction_end": {
      const index = entries.findLastIndex(
        (entry) => entry.kind === "compaction" && entry.state === "running",
      );
      const base = index === -1 ? newCompaction(event.reason) : (entries[index] as CompactionEntry);
      const finished = bump(base, {
        state: event.result ? "completed" : event.aborted ? "aborted" : "failed",
        summary: event.result?.summary,
        tokensBefore: event.result?.tokensBefore,
        errorMessage: event.errorMessage,
      });
      return {
        ...state,
        entries: index === -1 ? [...entries, finished] : replaceAt(entries, index, finished),
      };
    }
    case "bash_started":
      return { ...state, entries: [...entries, newBash(event.id, event.command, "")] };
    case "bash_execution_update": {
      const index = runningBash(entries, event.id);
      if (index === -1)
        return { ...state, entries: [...entries, newBash(event.id, undefined, event.delta)] };
      const bash = entries[index] as BashEntry;
      return {
        ...state,
        entries: replaceAt(entries, index, bump(bash, { output: bash.output + event.delta })),
      };
    }
    case "bash_finished": {
      const index = runningBash(entries, event.id);
      if (index === -1) return state;
      const { result } = event;
      return {
        ...state,
        entries: replaceAt(
          entries,
          index,
          bump(
            entries[index] as BashEntry,
            result
              ? {
                  running: false,
                  stream: undefined,
                  output: result.output,
                  exitCode: result.exitCode,
                  cancelled: result.cancelled,
                  truncated: result.truncated,
                  fullOutputPath: result.fullOutputPath,
                }
              : { running: false, stream: undefined },
          ),
        ),
      };
    }
    case "thinking_level_changed":
      return configChange(state, "thinking", event.level, undefined);
    case "model_changed":
      return configChange(state, "model", event.model, event.previous);
    case "agent_settled": {
      let changed = false;
      const next = entries.map((entry) => {
        if (entry.kind === "tool" && (entry.state === "pending" || entry.state === "running")) {
          changed = true;
          return bump(entry, { state: "unfinished" as const });
        }
        if (entry.kind === "assistant" && entry.streaming) {
          changed = true;
          return bump(entry, { streaming: false });
        }
        return entry;
      });
      return { ...state, response: undefined, entries: changed ? next : entries };
    }
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Restoring a branch
// ---------------------------------------------------------------------------

/** Nested calls of one root call, from captured records where present, else from the bounded summary. */
function restoreNested(
  scope: string,
  root: ToolEntry,
  summary: NestedToolCalls | undefined,
  records: readonly NestedToolRecord[],
): { children: ToolEntry[]; incomplete: boolean } {
  const children: ToolEntry[] = [];
  const seen = new Set<string>();
  const ordered = [...records].sort((a, b) => a.ordinal - b.ordinal);
  for (const record of ordered) {
    seen.add(record.callId);
    children.push(
      toolEntry(scope, record.callId, {
        parentId: toolEntryId(scope, record.parentCallId),
        name: record.name,
        ordinal: record.ordinal,
        args:
          record.args === undefined
            ? { available: false }
            : { available: true, value: record.args },
        state: record.state,
        result: { content: record.content, details: record.details, partial: false },
      }),
    );
  }
  for (const [position, call] of (summary?.calls ?? []).entries()) {
    if (seen.has(call.id)) continue;
    // The summary records parents only through the id: `<parent>/<n>`.
    const slash = call.id.lastIndexOf("/");
    const parentCall = slash === -1 ? root.callId : call.id.slice(0, slash);
    children.push(
      toolEntry(scope, call.id, {
        parentId: toolEntryId(scope, parentCall),
        name: call.name,
        // The summary lists a root's calls in start order, as record ordinals count them.
        ordinal: position,
        args:
          call.arguments === undefined
            ? { available: false, bytes: call.argumentsBytes }
            : { available: true, value: call.arguments },
        state: call.status === "ok" ? "done" : call.status === "error" ? "error" : "unfinished",
        errorSummary: call.error,
      }),
    );
  }
  // Depth-first, start order among siblings, so each child follows its parent.
  const ids = new Set(children.map((child) => child.id));
  const byParent = new Map<string, ToolEntry[]>();
  for (const child of children) {
    const parent = child.parentId && ids.has(child.parentId) ? child.parentId : root.id;
    const list = byParent.get(parent) ?? [];
    list.push(child.parentId === parent ? child : { ...child, parentId: parent });
    byParent.set(parent, list);
  }
  const result: ToolEntry[] = [];
  const visit = (parent: string) => {
    for (const child of (byParent.get(parent) ?? []).sort((a, b) => a.ordinal - b.ordinal)) {
      result.push(child);
      visit(child.id);
    }
  };
  visit(root.id);
  return {
    children: result,
    incomplete: records.length === 0 && summary !== undefined && !summary.complete,
  };
}

/**
 * Timeline entries for the active branch: its native entries joined with the
 * harness's display records by actual ids. Data neither supplies stays
 * unavailable; records from other branches are never consulted.
 */
export function restoreTimeline(
  branch: readonly PiSessionEntry[],
  records: DisplayRecords,
): SessionEntry[] {
  const entries: SessionEntry[] = [];
  let model: string | undefined;
  let thinking: string | undefined;
  const pushConfig = (
    id: string,
    setting: "model" | "thinking",
    from: string | undefined,
    to: string,
  ) => {
    // A first value is the initial configuration, not a change.
    if (from !== undefined && from !== to)
      entries.push({ kind: "config", id, version: 0, setting, from, to });
  };

  for (const entry of branch) {
    switch (entry.type) {
      case "message": {
        const { message } = entry;
        switch (message.role) {
          case "user":
            entries.push(userEntry(entry.id, message.content));
            break;
          case "assistant": {
            const parts = assistantParts(message);
            if (responseVisible(parts, message.stopReason, false)) {
              entries.push({
                kind: "assistant",
                id: entry.id,
                version: 0,
                parts,
                streaming: false,
                stopReason: message.stopReason,
                errorMessage: message.errorMessage,
              });
            }
            let ordinal = 0;
            for (const block of message.content) {
              if (block.type !== "toolCall") continue;
              entries.push(
                toolEntry(entry.id, block.id, {
                  name: block.name,
                  ordinal: ordinal++,
                  args: { available: true, value: block.arguments },
                  state: "missing",
                }),
              );
            }
            break;
          }
          case "toolResult": {
            const index = entries.findLastIndex(
              (candidate) =>
                candidate.kind === "tool" &&
                candidate.parentId === undefined &&
                candidate.callId === message.toolCallId,
            );
            if (index === -1) break;
            const root = entries[index] as ToolEntry;
            const nested = restoreNested(
              root.scope,
              root,
              message.nestedCalls,
              records.nested(root.scope, root.callId),
            );
            entries[index] = {
              ...root,
              state: message.isError ? "error" : "done",
              result: { content: message.content, details: message.details, partial: false },
              nestedIncomplete: nested.incomplete,
            };
            entries.splice(index + 1, 0, ...nested.children);
            break;
          }
          case "bashExecution":
            entries.push({
              kind: "bash",
              id: entry.id,
              version: 0,
              stream: undefined,
              command: message.command,
              output: message.output,
              exitCode: message.exitCode,
              cancelled: message.cancelled,
              truncated: message.truncated,
              fullOutputPath: message.fullOutputPath,
              running: false,
            });
            break;
          default:
            break;
        }
        break;
      }
      case "custom_message":
        if (entry.display) {
          entries.push({
            kind: "custom",
            id: entry.id,
            version: 0,
            customType: entry.customType,
            content: entry.content,
            details: entry.details,
          });
        }
        break;
      case "compaction":
        entries.push({
          kind: "compaction",
          id: entry.id,
          version: 0,
          state: "completed",
          reason: undefined,
          summary: entry.summary,
          tokensBefore: entry.tokensBefore,
          errorMessage: undefined,
        });
        break;
      case "branch_summary":
        entries.push({ kind: "branch-summary", id: entry.id, version: 0, summary: entry.summary });
        break;
      case "model_change": {
        const next = modelName({ provider: entry.provider, id: entry.modelId });
        pushConfig(entry.id, "model", model, next);
        model = next;
        break;
      }
      case "thinking_level_change":
        pushConfig(entry.id, "thinking", thinking, entry.thinkingLevel);
        thinking = entry.thinkingLevel;
        break;
      default:
        break;
    }
    // Operations recorded at this point of the branch follow it.
    entries.push(...records.operationsAfter(entry.id));
  }
  // Roots whose result never arrived leave their nested calls only in records.
  for (const [index, candidate] of [...entries.entries()].reverse()) {
    if (
      candidate.kind !== "tool" ||
      candidate.parentId !== undefined ||
      candidate.state !== "missing"
    )
      continue;
    const recorded = records.nested(candidate.scope, candidate.callId);
    if (recorded.length === 0) continue;
    entries.splice(
      index + 1,
      0,
      ...restoreNested(candidate.scope, candidate, undefined, recorded).children,
    );
  }
  entries.push(...records.diagnostics());
  return entries;
}

// ---------------------------------------------------------------------------
// Fenced block splitting
// ---------------------------------------------------------------------------

export type FencedBlock = TextRun | FencedCode;

export interface TextRun {
  type: "text";
  text: string;
}

export interface FencedCode {
  type: "code";
  language: string;
  body: string;
  /** The whole block including its opening and, when present, closing fence lines. */
  sourceText: string;
  /** No closing fence yet, as while a reply streams. */
  open?: boolean;
}

const FENCE_OPEN = /^[ \t]*(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^[ \t]*(`{3,}|~{3,})[ \t]*$/;

/**
 * Split text into plain runs and fenced code blocks. Only a line-start triple
 * backtick or tilde starts a block; this is not a CommonMark parser, so fences
 * inside a block are closed only by a matching fence of the same character.
 * An unclosed fence is ordinary text unless `openFences` makes it a block that
 * runs to the end, which keeps a streamed block's part ids from shifting when
 * its closing fence arrives.
 */
export function splitFencedBlocks(
  text: string,
  options: { openFences?: boolean } = {},
): FencedBlock[] {
  const lines = text.split("\n");
  const blocks: FencedBlock[] = [];
  let pending: string[] = [];
  const flushText = () => {
    const run = pending.join("\n");
    pending = [];
    if (run.length > 0) {
      blocks.push({ type: "text", text: run });
    }
  };

  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    const open = FENCE_OPEN.exec(line);
    const marker = open?.[1];
    if (!marker) {
      pending.push(line);
      index += 1;
      continue;
    }
    const character = marker[0];
    let close = index + 1;
    while (close < lines.length) {
      const candidate = FENCE_CLOSE.exec(lines[close] ?? "")?.[1];
      if (candidate && candidate[0] === character && candidate.length >= marker.length) {
        break;
      }
      close += 1;
    }
    if (close >= lines.length) {
      if (options.openFences) {
        flushText();
        blocks.push({
          type: "code",
          language: (open?.[2] ?? "").trim(),
          body: lines.slice(index + 1).join("\n"),
          sourceText: lines.slice(index).join("\n"),
          open: true,
        });
        return blocks;
      }
      // No closing fence: the opening line is ordinary text.
      pending.push(line);
      index += 1;
      continue;
    }
    flushText();
    blocks.push({
      type: "code",
      language: (open?.[2] ?? "").trim(),
      body: lines.slice(index + 1, close).join("\n"),
      sourceText: lines.slice(index, close + 1).join("\n"),
    });
    index = close + 1;
  }
  flushText();
  return blocks;
}
