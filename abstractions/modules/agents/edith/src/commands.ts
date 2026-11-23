// Arguments of chat clients' commands, the status they report, and the splitting of answers
// into a client's message limit.
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import type { ModelRef } from "@earendil-works/pi-durable";
import type { SessionInfo, Status } from "./core.ts";

export const levels: readonly ModelThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

// `default` clears a conversation's own choice, so that it follows its namespace or persona again.
export const followDefault = "default";

export type Parsed<T> = { readonly value: T | null } | { readonly error: string };

// The provider is the part before the first slash; model ids may contain slashes.
export function parseModel(argument: string): Parsed<ModelRef> {
  const text = argument.trim();
  if (text === followDefault) return { value: null };
  const slash = text.indexOf("/");
  if (slash <= 0 || slash === text.length - 1 || /\s/.test(text))
    return { error: `expected \`<provider>/<model id>\` or \`${followDefault}\`` };
  return { value: { provider: text.slice(0, slash), modelId: text.slice(slash + 1) } };
}

export function parseThinking(argument: string): Parsed<ModelThinkingLevel> {
  const text = argument.trim();
  if (text === followDefault) return { value: null };
  const level = levels.find((candidate) => candidate === text);
  return level
    ? { value: level }
    : { error: `expected one of ${[...levels, followDefault].join(", ")}` };
}

export function describe(status: Status): string {
  const model = `${status.model.provider}/${status.model.modelId}`;
  const origin = (overridden: boolean, otherwise: string) => (overridden ? "set here" : otherwise);
  return [
    `access: ${status.access} (${origin(status.overrides.access !== null, "default")})`,
    `persona: ${status.persona} (${origin(status.overrides.persona !== null, "default")})`,
    `model: ${model} (${origin(status.overrides.model !== null, "persona")})`,
    `thinking: ${status.thinkingLevel} (${origin(status.overrides.thinkingLevel !== null, "persona")})`,
    `tools: ${status.tools.length === 0 ? "(none)" : status.tools.join(", ")}`,
    `mcp servers: ${status.mcpServers.length === 0 ? "(none)" : status.mcpServers.join(", ")}`,
    ...(status.paused ? ["paused: resume to go on"] : []),
  ].join("\n");
}

// When a session started, if known, to the minute.
export const sessionStarted = (session: Pick<SessionInfo, "started">): string | undefined =>
  session.started === null ? undefined : new Date(session.started).toISOString().slice(0, 16);

// A session's line in a list numbered from 1: its number, whether it is current or not allowed,
// and its title or the start of its first input.
export const sessionLabel = (session: SessionInfo, index: number): string =>
  `${index + 1}. ${session.current ? "(current) " : ""}${session.allowed ? "" : "🔒 "}${
    session.preview || "(empty)"
  }`;

// One line per session, the current one first.
export function describeSessions(sessions: readonly SessionInfo[]): string {
  return sessions
    .map((session, index) => {
      const started = sessionStarted(session);
      return `${sessionLabel(session, index)}${started === undefined ? "" : ` (${started})`}`;
    })
    .join("\n");
}

// Where a paused run holds, as a line in its output.
export const describeHold = (held: "tool" | "request"): string =>
  `⏸️ Paused before ${held === "tool" ? "the next tool call" : "the next model request"}`;

// An error's message, for a reply.
export const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

// Splits text into chunks of at most `limit` UTF-16 units, preferring line breaks.
export function split(text: string, limit: number): string[] {
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    let end = rest.lastIndexOf("\n", limit);
    if (end <= 0) end = limit;
    // Never split a surrogate pair.
    if (/[\uD800-\uDBFF]/.test(rest[end - 1] ?? "")) end--;
    chunks.push(rest.slice(0, end));
    rest = rest.slice(end).replace(/^\n/, "");
  }
  if (rest !== "" || chunks.length === 0) chunks.push(rest);
  return chunks;
}
