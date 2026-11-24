import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import type { ModelRef } from "@earendil-works/pi-durable";
import type { Held } from "./control.ts";
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

export const followDefault = "default";

export type Parsed<T> = { readonly value: T | null } | { readonly error: string };

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

export const sessionStarted = (session: Pick<SessionInfo, "started">): string | undefined =>
  session.started === null ? undefined : new Date(session.started).toISOString().slice(0, 16);

export const sessionLabel = (session: SessionInfo, index: number): string =>
  `${index + 1}. ${session.current ? "(current) " : ""}${session.allowed ? "" : "🔒 "}${
    session.preview || "(empty)"
  }`;

export function describeSessions(sessions: readonly SessionInfo[]): string {
  return sessions
    .map((session, index) => {
      const started = sessionStarted(session);
      return `${sessionLabel(session, index)}${started === undefined ? "" : ` (${started})`}`;
    })
    .join("\n");
}

export const describeHold = (held: Held): string =>
  `⏸️ Paused before ${held.kind === "tool" ? "the next tool call" : "the next model request"}`;

export const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export function split(text: string, limit: number): string[] {
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    let end = rest.lastIndexOf("\n", limit);
    if (end <= 0) end = limit;
    if (/[\uD800-\uDBFF]/.test(rest[end - 1] ?? "")) end--;
    chunks.push(rest.slice(0, end));
    rest = rest.slice(end).replace(/^\n/, "");
  }
  if (rest !== "" || chunks.length === 0) chunks.push(rest);
  return chunks;
}
