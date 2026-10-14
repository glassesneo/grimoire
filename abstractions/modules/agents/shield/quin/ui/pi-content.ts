/**
 * The parts of Pi's message and timeline shapes the harness-derived timeline
 * reads, copied from pi-ai and the harness's core/session-entries. quin
 * receives them as JSON from the hub and does not load Pi.
 */

export interface TextContent {
  type: "text";
  text: string;
}

export interface ImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

export type StopReason = "pending" | "stop" | "length" | "toolUse" | "error" | "aborted" | "deferred";

export type ResultContent = (TextContent | ImageContent)[];

/** pi-ai's `contentText`: the text blocks joined. */
export function contentText(content: string | readonly { type: string; text?: string }[], separator = "\n"): string {
  if (typeof content === "string") return content;
  return content.filter((block): block is TextContent => block.type === "text").map((block) => block.text).join(separator);
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

export type CompactionState = "running" | "completed" | "failed" | "aborted";

export type RetryCategory = "response" | "summary";
export type RetryState = "waiting" | "retrying" | "succeeded" | "failed" | "ended";

export interface RetryAttempt {
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  error: string;
}

export type NoticeLevel = "info" | "warning" | "error";

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A text or image block, the content tool results and user messages carry. */
export function isContentBlock(value: unknown): value is TextContent | ImageContent {
  return isRecord(value) && (
    (value.type === "text" && typeof value.text === "string") ||
    (value.type === "image" && typeof value.data === "string" && typeof value.mimeType === "string"));
}


export function imagesOf(content: string | readonly (TextContent | ImageContent)[] | undefined): ImageContent[] {
  return typeof content === "string" || !content ? [] : content.filter((block): block is ImageContent => block.type === "image");
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
export function splitFencedBlocks(text: string, options: { openFences?: boolean } = {}): FencedBlock[] {
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
