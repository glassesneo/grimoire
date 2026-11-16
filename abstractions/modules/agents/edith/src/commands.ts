// Arguments of chat clients' commands, the status they report, and the splitting of answers
// into a client's message limit.
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import type { ModelRef } from "@earendil-works/pi-durable";
import type { Status } from "./core.ts";

export const levels: readonly ModelThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

// `default` clears a conversation's own choice, so that it follows its profile again.
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
  const model = status.model ? `${status.model.provider}/${status.model.modelId}` : "(none)";
  const thinking = status.thinkingLevel ?? "(provider default)";
  const origin = (overridden: boolean) => (overridden ? "set here" : "default");
  return [
    `model: ${model} (${origin(status.overrides.model !== null)})`,
    `thinking: ${thinking} (${origin(status.overrides.thinkingLevel !== null)})`,
  ].join("\n");
}

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
