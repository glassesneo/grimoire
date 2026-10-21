/**
 * Plain-text forms of item data for the screen's renderers, which color them,
 * and small helpers the driver and extensions share. keel's model writes the same
 * forms into an item's `text` (Shield.Keel.Projection); change both together.
 */
import type { ResponseData, ToolArguments, ToolState } from "./items";

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A model as `provider/id`, the form keel shows and `global.model_set` takes. */
export const modelName = (model: { provider: string; id: string }) =>
  `${model.provider}/${model.id}`;

export const toolStateText: Record<ToolState, string> = {
  pending: "queued",
  running: "running…",
  done: "done",
  error: "failed",
  unfinished: "unfinished",
};

/** A JSON value on one line, its whitespace collapsed. */
function compactJson(value: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(value) ?? String(value);
  } catch {
    text = String(value);
  }
  return text.replace(/\s+/g, " ");
}

/** Arguments as `key=value` pairs, strings unquoted, on one line, cut at `limit` characters. */
export function argsLine(args: ToolArguments, limit = 80): string {
  if (!args.available) return "(arguments unavailable)";
  const value = args.value;
  const line = (
    isRecord(value)
      ? Object.entries(value)
          .map(([key, field]) => `${key}=${typeof field === "string" ? field : compactJson(field)}`)
          .join(" ")
      : compactJson(value)
  ).replace(/\s*\n\s*/g, " ⏎ ");
  return line.length > limit ? `${line.slice(0, limit - 1)}…` : line;
}

/** How a finished response stopped, when that is worth saying. */
export function stopText(data: ResponseData): string | undefined {
  if (data.streaming) return undefined;
  if (data.stopReason === "error") return `error: ${data.errorMessage ?? "the response failed"}`;
  if (data.stopReason === "aborted")
    return data.errorMessage ? `aborted: ${data.errorMessage}` : "aborted";
  if (data.stopReason === "length") return "stopped at the output limit";
  return undefined;
}
