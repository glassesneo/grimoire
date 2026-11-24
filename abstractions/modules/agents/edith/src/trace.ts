import {
  AssistantEntry,
  ToolResultEntry,
  type EntryRecord,
  type LiveState,
} from "@earendil-works/pi-durable";
import type { CodemodeNestedCall, CodemodeToolDetails } from "@earendil-works/pi-durable/codemode";

export type Call = Omit<CodemodeNestedCall, "id" | "status"> & {
  readonly status: CodemodeNestedCall["status"] | "pending";
};

export type Item =
  | { readonly kind: "thinking"; readonly part: number; readonly text: string }
  | { readonly kind: "commentary"; readonly part: number; readonly text: string }
  | {
      readonly kind: "tool";
      readonly part: number;
      readonly callId: string;
      readonly name: string;
      readonly code?: string;
    };

export type Result = {
  readonly callId: string;
  readonly isError: boolean;
  readonly calls: readonly Call[];
};

export function itemsOf(entry: EntryRecord): Item[] {
  if (!AssistantEntry.is(entry)) return [];
  const parts = (entry.model ?? []).flatMap((message) =>
    message.role === "assistant" ? message.content : [],
  );
  const answers = !parts.some((part) => part.type === "toolCall");
  return parts.flatMap((part, index): Item[] => {
    if (part.type === "thinking" && part.thinking.trim())
      return [{ kind: "thinking", part: index, text: part.thinking.trim() }];
    if (part.type === "text" && !answers && part.text.trim())
      return [{ kind: "commentary", part: index, text: part.text.trim() }];
    if (part.type === "toolCall") {
      const code = part.arguments["code"];
      return [
        {
          kind: "tool",
          part: index,
          callId: part.id,
          name: part.name,
          ...(typeof code === "string" && { code }),
        },
      ];
    }
    return [];
  });
}

export function itemAt(entry: EntryRecord, part: number): Item | undefined {
  return itemsOf(entry).find((item) => item.part === part);
}

const shortName = (name: string) => name.replace(/^mcp__[^_]+(?:_[^_]+)*?__/, "");

export function resultOf(entry: EntryRecord): Result | undefined {
  if (!ToolResultEntry.is(entry)) return undefined;
  const message = (entry.model ?? []).find((candidate) => candidate.role === "toolResult");
  if (message?.role !== "toolResult") return undefined;
  const details = message.details as Partial<CodemodeToolDetails> | undefined;
  return {
    callId: message.toolCallId,
    isError: message.isError,
    calls: (details?.calls ?? []).map((call) => ({
      name: shortName(call.name),
      args: call.args,
      status: call.status,
      ...(call.durationMs !== undefined && { durationMs: call.durationMs }),
      ...(call.error !== undefined && { error: call.error }),
    })),
  };
}

export function liveCalls(live: LiveState | undefined, callId: string): Call[] {
  return (live?.nestedTools ?? [])
    .filter((slot) => slot.parentCallId === callId)
    .map((slot) => {
      const summary = slot.summary;
      const done = summary?.isError ? "error" : "ok";
      return {
        name: shortName(slot.name),
        args: JSON.stringify(slot.arguments),
        status: slot.status === "done" ? done : slot.status === "running" ? "running" : "pending",
        ...(summary?.durationMs !== undefined && { durationMs: summary.durationMs }),
        ...(summary?.error !== undefined && { error: summary.error }),
      };
    });
}

const clip = (text: string, limit: number) =>
  text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;

const mark: Record<Call["status"], string> = {
  pending: "⏳",
  running: "⏳",
  ok: "✓",
  error: "✗",
  cancelled: "⊘",
};

export type ToolState = "running" | "paused" | "ok" | "error";
const stateMark: Record<ToolState, string> = { ...mark, paused: "⏸️" };

function callLine(call: Call): string {
  const time = call.durationMs === undefined ? "" : ` ${(call.durationMs / 1000).toFixed(1)}s`;
  const error = call.error ? ` — ${clip(call.error.replace(/\s+/g, " "), 120)}` : "";
  return `\`${call.name}\` ${clip(call.args.replace(/\s+/g, " "), 80)} ${mark[call.status]}${time}${error}`;
}

export function renderTool(
  item: Extract<Item, { kind: "tool" }>,
  state: ToolState,
  calls: readonly Call[],
  expanded: boolean,
  limit: number,
): string {
  const lines = [`🔧 **${item.name}** ${stateMark[state]}`, ...calls.map(callLine)].join("\n");
  if (!expanded || item.code === undefined) return clip(lines, limit);
  const fence = item.code.includes("```") ? "~~~" : "```";
  const room = limit - lines.length - 16;
  return `${lines}\n${fence}js\n${clip(item.code, Math.max(room, 0))}\n${fence}`;
}

function headings(text: string): string[] {
  const bold = text
    .split("\n")
    .map((line) => /^\s*\*\*(.+?)\*\*\s*$/.exec(line)?.[1]?.trim())
    .filter((line): line is string => Boolean(line));
  return bold.length > 0 ? bold : [clip(text.split("\n")[0] ?? "", 200)];
}

export function renderThinking(text: string, expanded: boolean, limit: number): string {
  if (expanded) return clip(`💭\n${text}`, limit);
  return clip(`💭 ${headings(text).join(" · ")}`, limit);
}
