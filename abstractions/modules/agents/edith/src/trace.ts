// What a run shows besides its answer, read from a conversation's entries and live document:
// thinking, text the model writes alongside tool calls, and code mode calls with the tool calls
// their scripts make. Clients choose how to present it; the renderings here are Markdown.
import type { EntryRecord, JsonObject } from "@earendil-works/pi-durable";

export type Call = {
  readonly name: string;
  readonly args: string;
  readonly status: "pending" | "running" | "ok" | "error" | "cancelled";
  readonly durationMs?: number;
  readonly error?: string;
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

type Part = { readonly type: string; readonly [key: string]: unknown };

function parts(entry: EntryRecord): readonly Part[] {
  if (entry.kind !== "pi.assistant") return [];
  return (entry.model ?? []).flatMap((message) =>
    message.role === "assistant" ? (message.content as unknown as readonly Part[]) : [],
  );
}

// The items of an assistant entry, in order. The text of an entry without tool calls is the
// answer, which is not an item.
export function itemsOf(entry: EntryRecord): Item[] {
  const all = parts(entry);
  const answers = !all.some((part) => part.type === "toolCall");
  return all.flatMap((part, index): Item[] => {
    if (part.type === "thinking" && typeof part["thinking"] === "string" && part["thinking"].trim())
      return [{ kind: "thinking", part: index, text: part["thinking"].trim() }];
    if (part.type === "text" && !answers && typeof part["text"] === "string" && part["text"].trim())
      return [{ kind: "commentary", part: index, text: part["text"].trim() }];
    if (part.type === "toolCall") {
      const args = (part["arguments"] ?? {}) as Record<string, unknown>;
      const code = typeof args["code"] === "string" ? args["code"] : undefined;
      return [
        {
          kind: "tool",
          part: index,
          callId: String(part["id"]),
          name: String(part["name"]),
          ...(code !== undefined && { code }),
        },
      ];
    }
    return [];
  });
}

export function itemAt(entry: EntryRecord, part: number): Item | undefined {
  return itemsOf(entry).find((item) => item.part === part);
}

// Strips the `mcp__<server>__` prefix of an MCP tool's name.
const shortName = (name: string) => name.replace(/^mcp__[^_]+(?:_[^_]+)*?__/, "");

function asCalls(value: unknown): Call[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw): Call[] => {
    if (typeof raw !== "object" || raw === null) return [];
    const call = raw as Record<string, unknown>;
    const status = call["status"];
    return [
      {
        name: shortName(String(call["name"])),
        args: typeof call["args"] === "string" ? call["args"] : JSON.stringify(call["args"] ?? ""),
        status:
          status === "ok" || status === "error" || status === "cancelled" || status === "running"
            ? status
            : "pending",
        ...(typeof call["durationMs"] === "number" && { durationMs: call["durationMs"] }),
        ...(typeof call["error"] === "string" && { error: call["error"] }),
      },
    ];
  });
}

export function resultOf(entry: EntryRecord): Result | undefined {
  if (entry.kind !== "pi.tool-result") return undefined;
  const message = (entry.model ?? []).find((candidate) => candidate.role === "toolResult");
  if (message?.role !== "toolResult") return undefined;
  const details = message.details as { calls?: unknown } | undefined;
  return { callId: message.toolCallId, isError: message.isError, calls: asCalls(details?.calls) };
}

// The calls a running code mode call's script has made so far.
export function liveCalls(live: JsonObject | undefined, callId: string): Call[] {
  const nested = live?.["nestedTools"];
  if (!Array.isArray(nested)) return [];
  return nested.flatMap((raw): Call[] => {
    const slot = raw as {
      parentCallId?: string;
      name?: string;
      status?: string;
      arguments?: unknown;
      summary?: { isError?: boolean; durationMs?: number; error?: string };
    };
    if (slot.parentCallId !== callId) return [];
    const done = slot.status === "done";
    return [
      {
        name: shortName(String(slot.name)),
        args: JSON.stringify(slot.arguments ?? {}),
        status: !done
          ? slot.status === "running"
            ? "running"
            : "pending"
          : slot.summary?.isError
            ? "error"
            : "ok",
        ...(slot.summary?.durationMs !== undefined && { durationMs: slot.summary.durationMs }),
        ...(slot.summary?.error !== undefined && { error: slot.summary.error }),
      },
    ];
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

function callLine(call: Call): string {
  const time = call.durationMs === undefined ? "" : ` ${(call.durationMs / 1000).toFixed(1)}s`;
  const error = call.error ? ` — ${clip(call.error.replace(/\s+/g, " "), 120)}` : "";
  return `\`${call.name}\` ${clip(call.args.replace(/\s+/g, " "), 80)} ${mark[call.status]}${time}${error}`;
}

// A tool item's rendering: its state and calls, and when expanded, its script.
export function renderTool(
  item: Extract<Item, { kind: "tool" }>,
  state: "running" | "ok" | "error",
  calls: readonly Call[],
  expanded: boolean,
  limit: number,
): string {
  const head = `🔧 **${item.name}** ${state === "running" ? "⏳" : state === "ok" ? "✓" : "✗"}`;
  const lines = [head, ...calls.map(callLine)].join("\n");
  if (!expanded || item.code === undefined) return clip(lines, limit);
  const fence = item.code.includes("```") ? "~~~" : "```";
  const room = limit - lines.length - 16;
  return `${lines}\n${fence}js\n${clip(item.code, Math.max(room, 0))}\n${fence}`;
}

// The headings of a thinking summary, its bold lines, or else its first line.
export function headings(text: string): string[] {
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
