import { contentText, type ImageContent, type TextContent } from "@earendil-works/pi-ai";
import { imagesOf } from "./session-entries";

/**
 * Where a failed codemode script stopped, read from the result text of pi
 * 1.1.0's codemode tool (dist/extensions/codemode/execute.js), which returns
 * no structured error: a "Script failed" header item, then the script's output
 * with "Script error:\n<stack or reason>\n\n<call summary>" appended. pi joins
 * adjacent text items, so the error starts on its own line of the last item,
 * after any text the script emitted, and an unshown-images note may follow it
 * on one more line. Images come before the error unless the output was
 * truncated. The QuickJS worker (pi-codemode dist/runtime/worker.js) evaluates
 * the script as `codemode.js` on the submitted lines, with a `// @options:`
 * line replaced by an empty one, so a frame's line is the line of the
 * submitted code.
 *
 * Only that error is read, never the script's own output, which precedes the
 * last error marker. A result that does not have this shape is reported as
 * unrecognized instead of guessed at.
 */
export type ScriptErrorLocation =
  | { kind: "located"; line: number; error: string }
  | { kind: "unlocated"; error: string }
  | { kind: "unrecognized" };

const ERROR_PREFIX = "Script error:\n";
const CALL_SUMMARIES = ["No tool calls were made.", "Tool calls made before the failure"];
const NON_SCRIPT_FAILURES = ["Script timed out:", "Script aborted:", "Script sandbox failed:"];
const GENERATED_IMAGES_NOTE = /\n(Note: models\.generateImages\(\) returned [^\n]*)$/;
// `    at f (codemode.js:3:13)` or, for a syntax error, `    at codemode.js:1:39`.
const USER_FRAME = /^\s+at (?:.* \()?codemode\.js:(\d+):\d+\)?$/;

type Content = TextContent | ImageContent;

interface Failure {
  /** The script's output and the unshown-images note, without the error. */
  body: Content[];
  /** The error without its prefix: the stack or reason, a blank line, and the call summary. */
  section: string;
  /** The stack or reason alone. */
  error: string;
}

/** Split the content after a "Script failed" header into the script's output and the appended error. */
function splitFailure(rest: readonly Content[]): Failure | undefined {
  const last = rest.at(-1);
  if (last?.type !== "text") return undefined;
  const note = GENERATED_IMAGES_NOTE.exec(last.text);
  const text = note ? last.text.slice(0, note.index) : last.text;
  // The marker starts a line: the first one, or one after a newline.
  const start = `\n${text}`.lastIndexOf(`\n${ERROR_PREFIX}`);
  if (start === -1) return undefined;
  const section = text.slice(start + ERROR_PREFIX.length);
  const split = section.lastIndexOf("\n\n");
  if (split === -1 || !CALL_SUMMARIES.some((summary) => section.slice(split + 2).startsWith(summary))) return undefined;
  // pi separates the error from the output with a newline unless the output already ended with one.
  const output = text.slice(0, Math.max(0, start - 1));
  const body: Content[] = rest.slice(0, -1);
  if (output) body.push({ type: "text", text: output });
  if (note) body.push({ type: "text", text: note[1]! });
  return { body, section, error: section.slice(0, split) };
}

export function codemodeErrorLocation(
  code: string,
  result: { content: readonly Content[]; isError: boolean },
): ScriptErrorLocation | undefined {
  if (!result.isError) return undefined;
  const [header, ...rest] = result.content;
  if (header?.type !== "text" || !header.text.startsWith("Script failed\n")) return { kind: "unrecognized" };
  const failure = splitFailure(rest);
  if (!failure) return { kind: "unrecognized" };
  const { error } = failure;
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
  /**
   * What the script emitted or returned, apart from the error, as pi laid it
   * out for the model: item markers, the console block, and image paths stay.
   */
  output: string;
  images: ImageContent[];
  /** The error's text, without its prefix. */
  error: string | undefined;
}

/** Split a codemode result into the script's own output and the error the tool appended. */
export function codemodeOutput(content: readonly Content[]): CodemodeOutput {
  const first = content[0];
  const header = first?.type === "text" ? /^Script (completed|failed)\n/.exec(first.text) : null;
  const rest = header ? content.slice(1) : [...content];
  // Only a failed script has an error; a completed one may print the same words.
  const failure = header?.[1] === "failed" ? splitFailure(rest) : undefined;
  const body = failure?.body ?? rest;
  return {
    header: header ? header.input.replace(/\nOutput:\n$/, "").trim() : undefined,
    output: contentText(body),
    images: imagesOf(body),
    error: failure?.section,
  };
}
