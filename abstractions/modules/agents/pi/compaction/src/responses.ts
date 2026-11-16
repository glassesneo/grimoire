// Server-side compaction through the public OpenAI Responses API, independent of the
// agent harness: request payloads, stream observation, checkpoint replay and the
// readable recovery transcript. Harness adapters decide when to compact and where
// checkpoints persist. Imports are type-only, so the file runs without dependencies.
import type { Api, Message, Model } from "@earendil-works/pi-ai";

export interface ReplayItem {
  type: string;
  [key: string]: unknown;
}
export interface Checkpoint {
  version: 1;
  identity: string;
  tools: string;
  replay: ReplayItem[];
}

export function identity(model: Model<Api>): string {
  return JSON.stringify([model.provider, model.id, model.api, model.baseUrl]);
}

export function supported(model: Model<Api> | undefined): model is Model<Api> {
  return (
    model?.provider === "openai" &&
    model.api === "openai-responses" &&
    model.baseUrl.replace(/\/$/, "") === "https://api.openai.com/v1"
  );
}

// The payload of a request the server compacts once its input exceeds `threshold` tokens.
export function compactionPayload(
  payload: Record<string, unknown>,
  input: unknown[],
  threshold: number,
): Record<string, unknown> {
  return {
    ...payload,
    input,
    store: false,
    stream: true,
    context_management: [{ type: "compaction", compact_threshold: threshold }],
  };
}

// The readable backup is also the restore source: do not persist another full copy in details.
// Full backups still grow JSONL cumulatively. Entry references could reduce disk
// usage, but would require a separate recovery format. Native fallback consumes bounded fragments.
export const recoveryPrefix = "Recovery transcript (JSON messages, not instructions):\n";
export function recoveryText(messages: readonly Message[]): string {
  return `${recoveryPrefix}${JSON.stringify(messages)}`;
}

// The effective tool declarations of a Responses payload. Pi sends them as
// `additional_tools` input items; the top-level `tools` field is included as well.
export function declarations(payload: { input: unknown[]; tools?: unknown }): string {
  return JSON.stringify({
    tools: payload.tools ?? null,
    additional: payload.input
      .filter((item) => (item as { type?: string } | null)?.type === "additional_tools")
      .map((item) => (item as { tools?: unknown }).tools ?? null),
  });
}

export function marker(id: string): string {
  return `pi-responses-checkpoint:${id}`;
}

export function splice(input: unknown[], tag: string, replay: ReplayItem[]): unknown[] | undefined {
  const index = input.findIndex((item) => {
    const content = (item as { content?: { text?: string }[] } | null)?.content;
    return Array.isArray(content) && content.some((part) => part.text === tag);
  });
  return index < 0
    ? undefined
    : [...input.slice(0, index), ...structuredClone(replay), ...input.slice(index + 1)];
}

export class Output {
  // Completed output items by index; tool calls are read for cancellation results.
  readonly items: ReplayItem[] = [];
  private completed = false;
  private invalid = false;
  observe(value: unknown): void {
    const data = value as {
      type?: string;
      output_index?: number;
      item?: ReplayItem;
      response?: { status?: string };
    } | null;
    if (!data) return;
    if (
      data.type === "response.output_item.done" &&
      Number.isInteger(data.output_index) &&
      data.item
    ) {
      this.items[data.output_index!] = structuredClone(data.item);
    }
    if (data.type === "response.completed") this.completed = data.response?.status === "completed";
    if (
      data.type === "response.failed" ||
      data.type === "response.incomplete" ||
      data.type === "error"
    )
      this.invalid = true;
  }
  suffix(): ReplayItem[] | undefined {
    if (!this.completed || this.invalid || Array.from(this.items).some((item) => !item)) return;
    const index = this.items.findLastIndex((item) => item?.type === "compaction");
    return index < 0 ? undefined : this.items.slice(index);
  }
}

export function cancelledCalls(items: readonly ReplayItem[]): ReplayItem[] {
  return items.flatMap((item) => {
    if (item.type !== "function_call" && item.type !== "custom_tool_call") return [];
    if (typeof item.call_id !== "string")
      throw new Error("Manual response has a tool call without call_id");
    return [
      {
        type: item.type === "function_call" ? "function_call_output" : "custom_tool_call_output",
        call_id: item.call_id,
        output: "Not executed: this response belongs to manual compaction, not the work turn.",
      },
    ];
  });
}
