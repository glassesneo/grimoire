import { contentText, type ImageContent, type TextContent } from "@earendil-works/pi-ai";
import { imagesOf } from "./session-entries";

/**
 * Where a failed codemode script stopped, read from the result text of pi
 * 1.0.2's codemode tool (dist/extensions/codemode/execute.js), which returns
 * no structured error: a "Script failed" header item, the script's output, and
 * a last text item "Script error:\n<stack or reason>\n\n<call summary>". The
 * QuickJS worker (pi-codemode dist/runtime/worker.js) evaluates the script as
 * `codemode.js` on the submitted lines, with a `// @options:` line replaced by
 * an empty one, so a frame's line is the line of the submitted code.
 *
 * Only that error item is read, never the script's own output. A result that
 * does not have this shape is reported as unrecognized instead of guessed at.
 */
export type ScriptErrorLocation =
  | { kind: "located"; line: number; error: string }
  | { kind: "unlocated"; error: string }
  | { kind: "unrecognized" };

const ERROR_PREFIX = "Script error:\n";
const CALL_SUMMARIES = ["No tool calls were made.", "Tool calls made before the failure"];
const NON_SCRIPT_FAILURES = ["Script timed out:", "Script aborted:", "Script sandbox failed:"];
const GENERATED_IMAGES_NOTE = "Note: models.generateImages() returned";
// `    at f (codemode.js:3:13)` or, for a syntax error, `    at codemode.js:1:39`.
const USER_FRAME = /^\s+at (?:.* \()?codemode\.js:(\d+):\d+\)?$/;

export function codemodeErrorLocation(
  code: string,
  result: { content: readonly (TextContent | ImageContent)[]; isError: boolean },
): ScriptErrorLocation | undefined {
  if (!result.isError) return undefined;
  const texts = result.content.filter((block): block is TextContent => block.type === "text");
  const header = texts[0]?.text ?? "";
  if (!header.startsWith("Script failed\n")) return { kind: "unrecognized" };

  // The error item is last; only images and the generated-images note follow it.
  let index = texts.length - 1;
  while (index > 0 && texts[index]!.text.startsWith(GENERATED_IMAGES_NOTE)) index--;
  const item = texts[index];
  if (index === 0 || !item?.text.startsWith(ERROR_PREFIX)) return { kind: "unrecognized" };
  const section = item.text.slice(ERROR_PREFIX.length);
  const split = section.lastIndexOf("\n\n");
  if (split === -1 || !CALL_SUMMARIES.some((summary) => section.slice(split + 2).startsWith(summary))) {
    return { kind: "unrecognized" };
  }
  const error = section.slice(0, split);
  if (NON_SCRIPT_FAILURES.some((prefix) => error.startsWith(prefix))) return { kind: "unlocated", error };

  for (const frame of error.split("\n").slice(1)) {
    const match = USER_FRAME.exec(frame);
    if (!match) continue;
    const line = Number(match[1]);
    const lines = code.split("\n").length;
    return line >= 1 && line <= lines ? { kind: "located", line, error } : { kind: "unlocated", error };
  }
  return { kind: "unlocated", error };
}

export interface CodemodeOutput {
  /** "Script completed" or "Script failed", with the wall time, when the header is recognized. */
  header: string | undefined;
  /** What the script emitted or returned, apart from the error item. */
  output: string;
  images: ImageContent[];
  /** The error item's text, without its prefix. */
  error: string | undefined;
}

/** Split a codemode result into the script's own output and the error the tool appended. */
export function codemodeOutput(content: readonly (TextContent | ImageContent)[]): CodemodeOutput {
  const first = content[0];
  const header = first?.type === "text" ? /^Script (completed|failed)\n/.exec(first.text) : null;
  const rest = header ? content.slice(1) : [...content];
  // Only a failed script has an error item; a completed one may print the same words.
  const errorIndex = header?.[1] === "failed"
    ? rest.findLastIndex((block) => block.type === "text" && block.text.startsWith(ERROR_PREFIX))
    : -1;
  const errorItem = errorIndex === -1 ? undefined : (rest[errorIndex] as TextContent);
  const body = rest.filter((block) => block !== errorItem);
  return {
    header: header ? header.input.replace(/\nOutput:\n$/, "").trim() : undefined,
    output: contentText(body),
    images: imagesOf(body),
    error: errorItem?.text.slice(ERROR_PREFIX.length),
  };
}
