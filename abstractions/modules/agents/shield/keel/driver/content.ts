/**
 * Pi's message content as the driver and the extensions read it: text and image blocks,
 * their text, and image descriptions. They read the content as JSON, so they also serve code
 * that never loads Pi. The raw content stays in the driver; only text and descriptions reach
 * the model.
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
