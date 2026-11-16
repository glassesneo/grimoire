// Text commands of chat clients and the splitting of answers into a client's message limit.
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import type { ModelRef } from "@earendil-works/pi-durable";
import type { Status } from "./core.ts";

const levels: readonly ModelThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

export type Command =
  | { readonly kind: "help" }
  | { readonly kind: "status" }
  | { readonly kind: "model"; readonly value: ModelRef | null }
  | { readonly kind: "thinking"; readonly value: ModelThinkingLevel | null }
  | { readonly kind: "invalid"; readonly message: string };

export const help = [
  "`!status` shows this channel's model and thinking level.",
  "`!model <provider>/<model id>` sets the model; `!model default` follows the default again.",
  `\`!thinking <${levels.join("|")}>\` sets the thinking level; \`!thinking default\` follows the default again.`,
].join("\n");

// Undefined when the text is not a command: it is a message for the agent.
export function parseCommand(text: string): Command | undefined {
  const match = /^!(\S+)\s*(.*)$/s.exec(text.trim());
  if (!match) return;
  const [, name, rest] = match as unknown as [string, string, string];
  const argument = rest.trim();
  switch (name) {
    case "help":
      return { kind: "help" };
    case "status":
      return { kind: "status" };
    case "model": {
      if (argument === "default") return { kind: "model", value: null };
      const slash = argument.indexOf("/");
      if (slash <= 0 || slash === argument.length - 1 || /\s/.test(argument))
        return {
          kind: "invalid",
          message: "usage: `!model <provider>/<model id>` or `!model default`",
        };
      return {
        kind: "model",
        value: { provider: argument.slice(0, slash), modelId: argument.slice(slash + 1) },
      };
    }
    case "thinking": {
      if (argument === "default") return { kind: "thinking", value: null };
      const level = levels.find((candidate) => candidate === argument);
      return level
        ? { kind: "thinking", value: level }
        : {
            kind: "invalid",
            message: `usage: \`!thinking <${levels.join("|")}>\` or \`!thinking default\``,
          };
    }
    default:
      return { kind: "invalid", message: `unknown command \`!${name}\`; see \`!help\`` };
  }
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
