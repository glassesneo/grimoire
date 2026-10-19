/**
 * The one-row status lines and the run indicator. They only inform: neither
 * takes focus. A line too narrow for its segments drops or shortens the
 * lowest priorities first.
 */
import { createEffect, createMemo, createSignal, onCleanup, type JSX } from "solid-js";
import { Line, palette } from "./renderers";

/** Terminal columns a string occupies. */
const displayWidth = (text: string): number => Bun.stringWidth(text);

/** User-perceived characters, so a cut never splits an emoji sequence or a combining mark. */
const graphemes = (text: string): string[] =>
  Array.from(new Intl.Segmenter().segment(text), ({ segment }) => segment);

/** Cut `text` to `width` columns, keeping its start or, for paths, its end. */
function fitText(text: string, width: number, keep: "start" | "end" = "start"): string {
  if (width <= 0) return "";
  if (displayWidth(text) <= width) return text;
  const characters = graphemes(text);
  let result = "";
  if (keep === "end") {
    for (let index = characters.length - 1; index >= 0; index--) {
      const next = characters[index] + result;
      if (displayWidth(`…${next}`) > width) break;
      result = next;
    }
    return `…${result}`;
  }
  for (const character of characters) {
    if (displayWidth(`${result}${character}…`) > width) break;
    result += character;
  }
  return `${result}…`;
}

export interface StatusSegment {
  text: string;
  color?: string;
  /** Lower numbers are kept first when the line is too narrow. */
  priority: number;
  /** Shortened instead of dropped, keeping this end. */
  shrink?: "start" | "end";
}

const SEPARATOR = " · ";

/** Segments that fit `width`, in their original order, dropping or shortening the lowest priorities first. */
function composeLine(
  segments: readonly StatusSegment[],
  width: number,
): { text: string; color?: string }[] {
  const present = segments
    .map((segment, index) => ({ segment, index }))
    .filter(({ segment }) => segment.text !== "");
  const fitted = new Map<number, string>();
  let used = 0;
  for (const { segment, index } of [...present].sort(
    (a, b) => a.segment.priority - b.segment.priority,
  )) {
    const separator = fitted.size > 0 ? displayWidth(SEPARATOR) : 0;
    const textWidth = displayWidth(segment.text);
    if (used + separator + textWidth <= width) {
      fitted.set(index, segment.text);
      used += separator + textWidth;
    } else if (segment.shrink && width - used - separator >= 8) {
      // Any shorter and a shortened segment says nothing.
      const text = fitText(segment.text, width - used - separator, segment.shrink);
      fitted.set(index, text);
      used += separator + displayWidth(text);
    }
  }
  return present.flatMap(({ segment, index }) => {
    const text = fitted.get(index);
    return text === undefined ? [] : [{ text, color: segment.color }];
  });
}

export function StatuslineView(props: {
  segments: readonly StatusSegment[];
  width: number;
}): JSX.Element {
  const line = () => composeLine(props.segments, Math.max(0, props.width - 2));
  return (
    <box height={1} width="100%" paddingX={1} flexShrink={0}>
      <Line
        wrap="none"
        parts={line().flatMap((segment, index) => [
          index > 0 ? ([SEPARATOR, palette.dim] as const) : undefined,
          [segment.text, segment.color ?? palette.dim] as const,
        ])}
      />
    </box>
  );
}

const WORKING_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const WORKING_INTERVAL_MS = 80;

/** A borderless spinner and message; the timer runs only while a message is shown. */
export function RunStateIndicator(props: { message: () => string | undefined }): JSX.Element {
  const running = createMemo(() => props.message() !== undefined);
  const [frame, setFrame] = createSignal(0);
  createEffect(() => {
    setFrame(0);
    if (!running()) return;
    const timer = setInterval(
      () => setFrame((value) => (value + 1) % WORKING_FRAMES.length),
      WORKING_INTERVAL_MS,
    );
    onCleanup(() => clearInterval(timer));
  });
  return (
    <Line
      wrap="none"
      parts={[
        running() ? [`${WORKING_FRAMES[frame()]} `, palette.accent] : undefined,
        [props.message() ?? "", palette.dim],
      ]}
    />
  );
}
