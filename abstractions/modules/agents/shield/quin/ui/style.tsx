/** Palette and styled-line helpers copied from the harness's timeline types. */
import { fg, StyledText, type TextRenderable } from "@opentui/core";
import { createEffect, type JSX } from "solid-js";

export const palette = {
  text: "#cdd6f4",
  dim: "#6c7086",
  accent: "#89b4fa",
  user: "#a6e3a1",
  warning: "#f9e2af",
  error: "#f38ba8",
  thinking: "#9399b2",
  success: "#a6e3a1",
} as const;

export function styled(...parts: (readonly [text: string, color?: string] | false | undefined)[]): StyledText {
  return new StyledText(parts.flatMap((part) => (part ? [fg(part[1] ?? palette.text)(part[0])] : [])));
}

/** A line of colored segments; see `styled`. */
export function Line(props: { parts: Parameters<typeof styled>; wrap?: "none" | "word" }): JSX.Element {
  // Styled text is assigned to the renderable: the JSX `content` prop
  // stringifies it, and as a child each update would be appended.
  return <text wrapMode={props.wrap ?? "word"} ref={(element: TextRenderable) => createEffect(() => { element.content = styled(...props.parts); })} />;
}

export function singleLine(text: string, joiner = " "): string {
  return text.replace(/\s*\n\s*/g, joiner);
}
