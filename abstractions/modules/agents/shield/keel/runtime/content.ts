/**
 * Content shapes and text helpers the projection and the extensions share.
 * They read Pi's message content as JSON, so they also serve code that never
 * loads Pi.
 */
import { isRecord } from "../protocol/format";

export interface TextContent {
  type: "text";
  text: string;
}

export interface ImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

export type ResultContent = (TextContent | ImageContent)[];

/** pi-ai's `contentText`: the text blocks joined. */
export function contentText(
  content: string | readonly { type: string; text?: string }[],
  separator = "\n",
): string {
  if (typeof content === "string") return content;
  return content
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.text)
    .join(separator);
}

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

export function imagesOf(
  content: string | readonly (TextContent | ImageContent)[] | undefined,
): ImageContent[] {
  return typeof content === "string" || !content
    ? []
    : content.filter((block): block is ImageContent => block.type === "image");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

/** An image's type and size, measured from its base64 data without decoding it. */
export function imageLabel(image: ImageContent): string {
  const padding = image.data.endsWith("==") ? 2 : image.data.endsWith("=") ? 1 : 0;
  const bytes = Math.max(0, Math.floor((image.data.length * 3) / 4) - padding);
  return `${image.mimeType}, ${formatBytes(bytes)}`;
}

// ---------------------------------------------------------------------------
// Fenced block splitting
// ---------------------------------------------------------------------------

type FencedBlock = TextRun | FencedCode;

interface TextRun {
  type: "text";
  text: string;
}

interface FencedCode {
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

interface FenceState {
  blocks: FencedBlock[];
  text: string;
  textLines: number;
  fence?: { marker: string; code: FencedCode; lines: number };
}

/** Reuse completed lines while a response grows; reparse only its unfinished last line. */
export class StreamingFences {
  #source = "";
  #start = 0;
  #state: FenceState = { blocks: [], text: "", textLines: 0 };

  split(text: string): FencedBlock[] {
    // Full replacement (including Pi's final message) is allowed, not just appends.
    // ponytail: prefix validation still reads the prefix; text-range wire patches would remove that cost.
    if (!text.startsWith(this.#source)) {
      this.#source = "";
      this.#start = 0;
      this.#state = { blocks: [], text: "", textLines: 0 };
    }
    let end = text.indexOf("\n", this.#source.length);
    while (end !== -1) {
      this.#line(this.#state, text.slice(this.#start, end));
      this.#start = end + 1;
      end = text.indexOf("\n", this.#start);
    }
    this.#source = text;
    const preview: FenceState = {
      ...this.#state,
      blocks: [...this.#state.blocks],
      fence: this.#state.fence && { ...this.#state.fence, code: { ...this.#state.fence.code } },
    };
    this.#line(preview, text.slice(this.#start));
    if (preview.fence) preview.blocks.push(preview.fence.code);
    else this.#flush(preview);
    return preview.blocks;
  }

  #flush(state: FenceState): void {
    if (state.text.length) state.blocks.push({ type: "text", text: state.text });
    state.text = "";
    state.textLines = 0;
  }

  #line(state: FenceState, line: string): void {
    const fence = state.fence;
    if (fence) {
      fence.code.sourceText += `\n${line}`;
      const close = FENCE_CLOSE.exec(line)?.[1];
      if (close && close[0] === fence.marker[0] && close.length >= fence.marker.length) {
        delete fence.code.open;
        state.blocks.push(fence.code);
        state.fence = undefined;
      } else {
        fence.code.body += (fence.lines++ ? "\n" : "") + line;
      }
      return;
    }
    const open = FENCE_OPEN.exec(line);
    if (open) {
      this.#flush(state);
      state.fence = {
        marker: open[1]!,
        lines: 0,
        code: { type: "code", language: open[2]!.trim(), body: "", sourceText: line, open: true },
      };
    } else {
      state.text += (state.textLines++ ? "\n" : "") + line;
    }
  }
}

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
