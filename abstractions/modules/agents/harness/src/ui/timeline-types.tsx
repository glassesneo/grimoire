/**
 * The harness's compiled timeline item types and the shared pieces they draw
 * with. Each type renders only what its value holds: a value without a result
 * says so instead of showing an empty one, and no type reads files, reruns
 * tools, or derives text the session did not supply.
 */
import { contentText, type ImageContent, type StopReason } from "@earendil-works/pi-ai";
import { fg, type ImageRenderable, RGBA, StyledText, SyntaxStyle, type TextRenderable } from "@opentui/core";
import { createEffect, createSignal, For, type JSX } from "solid-js";
import { codemodeErrorLocation, codemodeOutput } from "../core/codemode-result";
import {
  type CompactionState,
  imagesOf,
  isRecord,
  isResultContent,
  type NoticeLevel,
  type ResultContent,
  type RetryAttempt,
  type RetryCategory,
  type RetryState,
  type ToolArguments,
  type ToolState,
} from "../core/session-entries";
import type { ItemType } from "./controllers";
import { PiImage } from "./pi-image";

export const PREVIEW_ROWS = 4;

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

const noticeColor: Record<NoticeLevel, string> = {
  info: palette.accent,
  warning: palette.warning,
  error: palette.error,
};

let syntax: SyntaxStyle | undefined;
/** One style for Markdown and code, created on first use because it needs the native library. */
export function syntaxStyle(): SyntaxStyle {
  syntax ??= SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromHex(palette.text) },
    keyword: { fg: RGBA.fromHex("#cba6f7") },
    string: { fg: RGBA.fromHex("#a6e3a1") },
    comment: { fg: RGBA.fromHex(palette.dim), italic: true },
    number: { fg: RGBA.fromHex("#fab387") },
    constant: { fg: RGBA.fromHex("#fab387") },
    function: { fg: RGBA.fromHex("#89b4fa") },
    type: { fg: RGBA.fromHex("#f9e2af") },
    operator: { fg: RGBA.fromHex("#89dceb") },
    variable: { fg: RGBA.fromHex(palette.text) },
    property: { fg: RGBA.fromHex("#b4befe") },
    punctuation: { fg: RGBA.fromHex("#9399b2") },
    "markup.heading": { fg: RGBA.fromHex("#89b4fa"), bold: true },
    "markup.strong": { bold: true },
    "markup.italic": { italic: true },
    "markup.raw": { fg: RGBA.fromHex("#f5c2e7") },
    "markup.link": { fg: RGBA.fromHex("#89dceb"), underline: true },
    "markup.list": { fg: RGBA.fromHex("#fab387") },
    "markup.quote": { fg: RGBA.fromHex("#9399b2"), italic: true },
    conceal: { fg: RGBA.fromHex(palette.dim) },
  });
  return syntax;
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

/** One line of differently colored segments, wrapped as a whole. */
export function styled(...parts: (readonly [text: string, color?: string] | false | undefined)[]): StyledText {
  return new StyledText(parts.flatMap((part) => (part ? [fg(part[1] ?? palette.text)(part[0])] : [])));
}

/**
 * The first rows of `text` as the terminal lays them out, and a line saying
 * how many rows follow. The rows are measured from the rendered content, so
 * the count matches what expanding shows at this width.
 */
export function Preview(props: { text: string; fg?: string; rows?: number; markdown?: boolean }): JSX.Element {
  const [height, setHeight] = createSignal(0);
  const rows = () => props.rows ?? PREVIEW_ROWS;
  // The limit is a layout constraint, so the first frame already has the
  // final height; only the count below waits for the measurement.
  return (
    <box flexDirection="column" flexShrink={0}>
      <box maxHeight={rows()} overflow="hidden" flexShrink={0}>
        <box flexDirection="column" flexShrink={0} onSizeChange={function (this: { height: number }) { setHeight(this.height); }}>
          {props.markdown ? <Markdown text={props.text} fg={props.fg} /> : <text fg={props.fg} wrapMode="word">{props.text}</text>}
        </box>
      </box>
      {height() > rows() ? <text fg={palette.dim}>{`… ${height() - rows()} more rows`}</text> : null}
    </box>
  );
}

/** A line of colored segments; see `styled`. */
export function Line(props: { parts: Parameters<typeof styled>; wrap?: "none" | "word" }): JSX.Element {
  // Styled text is assigned to the renderable: the JSX `content` prop
  // stringifies it, and as a child each update would be appended.
  return <text wrapMode={props.wrap ?? "word"} ref={(element: TextRenderable) => createEffect(() => { element.content = styled(...props.parts); })} />;
}

export function Markdown(props: { text: string; streaming?: boolean; fg?: string }): JSX.Element {
  return <markdown content={props.text} syntaxStyle={syntaxStyle()} streaming={props.streaming ?? false} conceal fg={props.fg} />;
}

export function CodeBlock(props: { body: string; language: string }): JSX.Element {
  return (
    <box border borderColor="#45475a" flexDirection="column" paddingX={1}>
      {props.language ? <text fg={palette.accent}>{props.language}</text> : null}
      <code content={props.body} filetype={filetypeOf(props.language)} syntaxStyle={syntaxStyle()} wrapMode="word" />
    </box>
  );
}

function filetypeOf(language: string): string | undefined {
  const name = language.split(/\s+/)[0]?.toLowerCase() ?? "";
  if (["js", "javascript", "jsx", "mjs", "cjs"].includes(name)) return "javascript";
  if (["ts", "typescript", "tsx", "mts", "cts"].includes(name)) return "typescript";
  if (["md", "markdown"].includes(name)) return "markdown";
  if (name === "zig") return "zig";
  return name || undefined;
}

/** Up to `limit` characters of a JSON value on one line. */
export function compactJson(value: unknown, limit = 80): string {
  let text: string;
  try {
    text = JSON.stringify(value) ?? String(value);
  } catch {
    text = String(value);
  }
  text = text.replace(/\s+/g, " ");
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

const stateText: Record<ToolState, string> = {
  pending: "queued",
  running: "running…",
  done: "done",
  error: "failed",
  unfinished: "unfinished",
  missing: "no result recorded",
};

const stateColor: Record<ToolState, string> = {
  pending: palette.dim,
  running: palette.accent,
  done: palette.dim,
  error: palette.error,
  unfinished: palette.warning,
  missing: palette.warning,
};

const textOf = (content: ResultContent | undefined): string => contentText(content ?? []);

/** Size of base64 data in bytes, without decoding it. */
function base64Bytes(data: string): number {
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((data.length * 3) / 4) - padding);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

export function imageMetadata(image: ImageContent): string {
  return `${image.mimeType}, ${formatBytes(base64Bytes(image.data))}`;
}

const MAX_IMAGE_ROWS = 20;

function decodeError(data: string): string | undefined {
  try {
    atob(data);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * An image fitted to the row width with its aspect kept. Its height is known
 * only once the image loads, so the row grows then; a decoding failure is
 * reported in place as text.
 */
export function FittedImage(props: { content: ImageContent; label: string }): JSX.Element {
  const [error, setError] = createSignal<string | undefined>(decodeError(props.content.data));
  const [height, setHeight] = createSignal(1);
  let node: ImageRenderable | undefined;
  const fit = () => {
    if (node?.image) setHeight(Math.max(1, node.getFittedSize(node.width, MAX_IMAGE_ROWS).height));
  };
  return (
    <box flexDirection="column" flexShrink={0}>
      {error()
        ? <text fg={palette.error}>{`${props.label}: could not be shown: ${error()}`}</text>
        : <PiImage content={props.content} ref={(element: ImageRenderable) => { node = element; }} width="100%" height={height()} fit="fit"
            onLoad={fit} onSizeChange={fit} onError={(cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause))} />}
    </box>
  );
}

/** More than a preview's worth of logical lines or characters; wrapping can only add rows. */
function exceedsPreview(text: string): boolean {
  if (text.length > PREVIEW_ROWS * 80) return true;
  let breaks = 0;
  for (let at = text.indexOf("\n"); at !== -1; at = text.indexOf("\n", at + 1)) {
    if (++breaks >= PREVIEW_ROWS) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

export interface UserValue {
  text: string;
  /** Attachment metadata; the images themselves are child items. */
  images: string[];
}

export interface ImageValue {
  /** A genuine path or name when the source gave one, otherwise the MIME type and size. */
  label: string;
  content: ImageContent;
}

export interface ResponseValue {
  /** Thinking text joined, for the collapsed preview. */
  thinking: string;
  hasThinking: boolean;
  /** Every thinking block was withheld; there is nothing to preview. */
  thinkingWithheld: boolean;
  /** The original prose and code, as the model wrote them. */
  body: string;
  streaming: boolean;
  stopReason: StopReason | undefined;
  errorMessage: string | undefined;
}

export interface ThinkingValue {
  text: string;
  withheld: boolean;
}

export interface ProseValue {
  text: string;
  streaming: boolean;
}

export interface CodeValue {
  language: string;
  body: string;
  /** The raw fenced block, fences included. */
  sourceText: string;
  open: boolean;
}

export interface NestedCallSummary {
  name: string;
  args: ToolArguments;
  state: ToolState;
}

/**
 * What a tool item knows about one call, live or restored. Extensions receive
 * it from the harness and may hand it to any tool kind.
 */
export interface ToolSnapshot {
  id: string;
  callId: string;
  name: string;
  parentCallId: string | undefined;
  args: ToolArguments;
  state: ToolState;
  /** Undefined when no result was received or recorded; not an empty result. */
  result: { content: ResultContent; details: unknown; partial: boolean } | undefined;
  errorSummary: string | undefined;
  /** Calls this tool made, and calls those made, in the order they started. */
  calls: NestedCallSummary[];
  /** The saved list of calls is known to be incomplete. */
  callsIncomplete: boolean;
}

export interface CompactionValue {
  state: CompactionState;
  reason: string | undefined;
  summary: string | undefined;
  tokensBefore: number | undefined;
  errorMessage: string | undefined;
}

export interface RetryValue {
  category: RetryCategory;
  state: RetryState;
  attempts: RetryAttempt[];
  finalError: string | undefined;
}

export interface SummaryValue {
  summary: string;
}

export interface CustomValue {
  customType: string;
  content: string | ResultContent;
  details: unknown;
}

export interface ConfigValue {
  setting: "model" | "thinking";
  from: string;
  to: string;
}

export interface NoticeValue {
  level: NoticeLevel;
  text: string;
}


function isArguments(value: unknown): value is ToolArguments {
  return isRecord(value) && (value.available === true ? "value" in value : value.available === false && (value.bytes === undefined || typeof value.bytes === "number"));
}

const TOOL_STATES = new Set<unknown>(["pending", "running", "done", "error", "unfinished", "missing"]);

export function isToolSnapshot(value: unknown): value is ToolSnapshot {
  if (!isRecord(value)) return false;
  const { id, callId, name, parentCallId, args, state, result, errorSummary, calls, callsIncomplete } = value;
  return typeof id === "string" && typeof callId === "string" && typeof name === "string" &&
    (parentCallId === undefined || typeof parentCallId === "string") && isArguments(args) && TOOL_STATES.has(state) &&
    (result === undefined || (isRecord(result) && isResultContent(result.content) && typeof result.partial === "boolean")) &&
    (errorSummary === undefined || typeof errorSummary === "string") &&
    Array.isArray(calls) && calls.every((call) => isRecord(call) && typeof call.name === "string" && isArguments(call.args) && TOOL_STATES.has(call.state)) &&
    typeof callsIncomplete === "boolean";
}

export function isCustomValue(value: unknown): value is CustomValue {
  return isRecord(value) && typeof value.customType === "string" && (typeof value.content === "string" || isResultContent(value.content));
}

// ---------------------------------------------------------------------------
// Tool presentations
// ---------------------------------------------------------------------------

function argsRecord(args: ToolArguments): Record<string, unknown> | undefined {
  return args.available && isRecord(args.value) ? args.value : undefined;
}

function argField(snapshot: ToolSnapshot, field: string): string | undefined {
  const value = argsRecord(snapshot.args)?.[field];
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : undefined;
}

/** Text on one line, its line breaks shown as `joiner`. */
export function singleLine(text: string, joiner = " "): string {
  return text.replace(/\s*\n\s*/g, joiner);
}

/** Arguments as `key=value` pairs, strings unquoted, on one line. */
function argsText(args: ToolArguments, limit = 80): string {
  if (!args.available) return args.bytes === undefined ? "(arguments unavailable)" : `(arguments not saved: ${formatBytes(args.bytes)})`;
  const record = argsRecord(args);
  const text = record
    ? Object.entries(record).map(([key, field]) => `${key}=${typeof field === "string" ? field : compactJson(field, Number.POSITIVE_INFINITY)}`).join(" ")
    : compactJson(args.value, Number.POSITIVE_INFINITY);
  const line = singleLine(text, " ⏎ ");
  return line.length > limit ? `${line.slice(0, limit - 1)}…` : line;
}

/** The error a tool reported, from its result or a bounded record. */
function toolError(snapshot: ToolSnapshot): string | undefined {
  if (snapshot.state !== "error") return undefined;
  return (snapshot.result ? textOf(snapshot.result.content) : undefined) || snapshot.errorSummary;
}

function longError(snapshot: ToolSnapshot): boolean {
  const error = toolError(snapshot);
  return error !== undefined && exceedsPreview(error);
}

function toolSource(snapshot: ToolSnapshot): string | undefined {
  // Running output is not yet the original result, and an empty one has nothing to copy.
  if (snapshot.result?.partial) return undefined;
  return (snapshot.result ? textOf(snapshot.result.content) : snapshot.errorSummary) || undefined;
}

// The pieces below are mounted once per row and read `props.snapshot` inside
// JSX, so a running tool's updates change them in place.

function ToolHeader(props: { label: string; detail: string; snapshot: ToolSnapshot }): JSX.Element {
  const state = () => props.snapshot.result?.partial && props.snapshot.state === "running" ? "running…" : stateText[props.snapshot.state];
  return (
    <Line parts={[[props.label, palette.accent],
      props.detail ? [` ${props.detail}`] : undefined,
      [` · ${state()}`, stateColor[props.snapshot.state]]]} />
  );
}

function ErrorPreview(props: { snapshot: ToolSnapshot }): JSX.Element {
  return <>{toolError(props.snapshot) ? <Preview text={toolError(props.snapshot) ?? ""} fg={palette.error} /> : null}</>;
}

/** States that are not an outcome yet, or never became one. */
function ResultUnavailable(props: { snapshot: ToolSnapshot }): JSX.Element {
  const unavailable = () =>
    (props.snapshot.state === "done" || props.snapshot.state === "error") && !props.snapshot.result && !props.snapshot.errorSummary;
  return <>{unavailable() ? <text fg={palette.warning}>result not recorded</text> : null}</>;
}

function ErrorLine(props: { snapshot: ToolSnapshot }): JSX.Element {
  return <>{toolError(props.snapshot) ? <text fg={palette.error}>{toolError(props.snapshot)}</text> : null}</>;
}

function ImagesDetail(props: { images: ImageContent[]; label: string }): JSX.Element {
  return (
    <For each={props.images}>
      {(image, index) => (
        <box flexDirection="column">
          <text fg={palette.dim}>{`${props.label} ${index() + 1}: ${imageMetadata(image)}`}</text>
          <FittedImage content={image} label={`${props.label} ${index() + 1}`} />
        </box>
      )}
    </For>
  );
}

interface ToolSpec {
  /** The header's label; the tool's name when omitted. */
  label?: string;
  /** The call in a few words, for its header and for a codemode overview line. */
  summary(call: { args: ToolArguments; calls?: readonly NestedCallSummary[] }): string;
  /** Rows under the header while collapsed; the error preview when omitted. */
  Preview?: (props: { snapshot: ToolSnapshot }) => JSX.Element;
  details(snapshot: ToolSnapshot): JSX.Element;
  expandable(snapshot: ToolSnapshot): boolean;
}

function toolType(kind: string, spec: ToolSpec): ItemType<ToolSnapshot, JSX.Element> {
  const Collapsed = spec.Preview ?? ErrorPreview;
  return {
    kind,
    live: true,
    render: (props) => (
      <box flexDirection="column">
        <ToolHeader label={spec.label ?? props.value.name} detail={spec.summary(props.value)} snapshot={props.value} />
        {props.expanded ? null : <Collapsed snapshot={props.value} />}
        <ResultUnavailable snapshot={props.value} />
      </box>
    ),
    renderDetails: ({ value }) => spec.details(value),
    expandable: spec.expandable,
    // The original result text, not the header or compact arguments.
    sourceText: toolSource,
    actions: {},
    validate: isToolSnapshot,
  };
}

const genericSpec: ToolSpec = {
  summary: (call) => argsText(call.args),
  details: (snapshot) => (
    <box flexDirection="column">
      <text fg={palette.dim}>arguments</text>
      <text>{snapshot.args.available ? prettyJson(snapshot.args.value) : argsText(snapshot.args)}</text>
      {snapshot.result ? (
        <box flexDirection="column">
          <text fg={palette.dim}>{snapshot.state === "error" ? "error" : "result"}</text>
          <text fg={snapshot.state === "error" ? palette.error : undefined}>{textOf(snapshot.result.content) || "(no text)"}</text>
          {snapshot.result.details !== undefined ? <text fg={palette.dim}>details</text> : null}
          {snapshot.result.details !== undefined ? <text>{prettyJson(snapshot.result.details)}</text> : null}
          <ImagesDetail images={imagesOf(snapshot.result.content)} label="image" />
        </box>
      ) : null}
    </box>
  ),
  expandable: (snapshot) =>
    argsText(snapshot.args, Number.POSITIVE_INFINITY).length > 80 ||
    (snapshot.result !== undefined && (snapshot.result.content.length > 0 || snapshot.result.details !== undefined)) ||
    longError(snapshot),
};

const readSpec: ToolSpec = {
  label: "read",
  summary: ({ args }) => {
    const record = argsRecord(args);
    if (typeof record?.path !== "string") return argsText(args);
    const { path, offset, limit } = record;
    return `${path}${offset !== undefined || limit !== undefined ? `:${offset ?? 1}${limit !== undefined ? `+${limit}` : ""}` : ""}`;
  },
  Preview: (props) => (
    <>
      <ErrorPreview snapshot={props.snapshot} />
      <For each={imagesOf(props.snapshot.result?.content)}>{(image) => <text fg={palette.dim}>{`image: ${imageMetadata(image)}`}</text>}</For>
    </>
  ),
  details: (snapshot) => (
    <box flexDirection="column">
      <ErrorLine snapshot={snapshot} />
      <ImagesDetail images={imagesOf(snapshot.result?.content)} label={argField(snapshot, "path") ?? "image"} />
    </box>
  ),
  // Read text is the model's to see; only images and long errors add to the row.
  expandable: (snapshot) => imagesOf(snapshot.result?.content).length > 0 || longError(snapshot),
};

function bashDetails(snapshot: ToolSnapshot): { exitCode?: number; fullOutputPath?: string; truncated?: string; cancelled?: boolean } {
  const details = snapshot.result?.details;
  if (!isRecord(details)) return {};
  const truncation = isRecord(details.truncation) && details.truncation.truncated === true
    ? `truncated by ${String(details.truncation.truncatedBy)}: ${String(details.truncation.outputLines)} of ${String(details.truncation.totalLines)} lines`
    : details.truncated === true ? "truncated" : undefined;
  return {
    exitCode: typeof details.exitCode === "number" ? details.exitCode : undefined,
    fullOutputPath: typeof details.fullOutputPath === "string" ? details.fullOutputPath : undefined,
    truncated: truncation,
    cancelled: details.cancelled === true,
  };
}

const bashSpec: ToolSpec = {
  label: "$",
  summary: ({ args }) => {
    const command = argsRecord(args)?.command;
    return typeof command === "string" ? singleLine(command, " ⏎ ") : argsText(args);
  },
  Preview: (props) => {
    const output = () => textOf(props.snapshot.result?.content);
    return (
      <>
        {output()
          ? <Preview text={output()} fg={props.snapshot.state === "error" ? palette.error : palette.dim} />
          : <ErrorPreview snapshot={props.snapshot} />}
      </>
    );
  },
  details: (snapshot) => {
    const extra = bashDetails(snapshot);
    return (
      <box flexDirection="column">
        <text fg={snapshot.state === "error" ? palette.error : undefined}>{textOf(snapshot.result?.content) || snapshot.errorSummary || "(no output)"}</text>
        {extra.exitCode !== undefined ? <text fg={palette.dim}>{`exit code ${extra.exitCode}`}</text> : null}
        {extra.cancelled ? <text fg={palette.warning}>cancelled</text> : null}
        {extra.truncated ? <text fg={palette.dim}>{extra.truncated}</text> : null}
        {extra.fullOutputPath ? <text fg={palette.dim}>{`full output: ${extra.fullOutputPath}`}</text> : null}
      </box>
    );
  },
  expandable: (snapshot) => {
    const extra = bashDetails(snapshot);
    return exceedsPreview(textOf(snapshot.result?.content)) || longError(snapshot) ||
      extra.exitCode !== undefined || extra.fullOutputPath !== undefined || extra.truncated !== undefined;
  },
};

function editDiff(snapshot: ToolSnapshot): string | undefined {
  const details = snapshot.result?.details;
  return isRecord(details) && typeof details.diff === "string" && details.diff !== "" ? details.diff : undefined;
}

const pathSummary: ToolSpec["summary"] = ({ args }) => {
  const path = argsRecord(args)?.path;
  return typeof path === "string" ? path : argsText(args);
};

const editSpec: ToolSpec = {
  label: "edit",
  summary: pathSummary,
  details: (snapshot) => (
    <box flexDirection="column">
      <ErrorLine snapshot={snapshot} />
      {editDiff(snapshot) ? <code content={editDiff(snapshot)} filetype="diff" syntaxStyle={syntaxStyle()} wrapMode="word" /> : null}
    </box>
  ),
  expandable: (snapshot) => editDiff(snapshot) !== undefined || longError(snapshot),
};

const writeSpec: ToolSpec = {
  label: "write",
  summary: pathSummary,
  details: (snapshot) => (
    <box flexDirection="column">
      <ErrorLine snapshot={snapshot} />
      {argField(snapshot, "content") !== undefined ? <text>{argField(snapshot, "content")}</text> : null}
    </box>
  ),
  expandable: (snapshot) => argField(snapshot, "content") !== undefined || longError(snapshot),
};

/** A call line inside a collapsed codemode item, numbered in the order the calls started; not an item itself. */
function CallOverview(props: { call: NestedCallSummary; index: number }): JSX.Element {
  return (
    <Line wrap="none" parts={[[`${props.index + 1}. `, palette.dim],
      [props.call.name, palette.accent],
      [` ${(builtInTools[props.call.name]?.spec ?? genericSpec).summary(props.call)}`],
      [` · ${stateText[props.call.state]}`, stateColor[props.call.state]]]} />
  );
}

function codemodeSource(snapshot: ToolSnapshot): string | undefined {
  return argField(snapshot, "code");
}

/** The submitted script with the line a supplied error location names marked in text, not color alone. */
function ScriptSource(props: { code: string; errorLine: number | undefined }): JSX.Element {
  const lines = () => props.code.split("\n");
  const width = () => String(lines().length).length;
  return (
    <box flexDirection="column" border borderColor="#45475a" paddingX={1}>
      <text fg={palette.accent}>javascript</text>
      <For each={lines()}>
        {(line, index) => {
          const marked = () => props.errorLine === index() + 1;
          return (
            <Line parts={[[`${marked() ? "▶" : " "}${String(index() + 1).padStart(width())} `, marked() ? palette.error : palette.dim],
              [line, marked() ? palette.error : palette.text],
              marked() && ["  ← error", palette.error]]} />
          );
        }}
      </For>
    </box>
  );
}

const codemodeSpec: ToolSpec = {
  label: "codemode",
  summary: ({ calls = [] }) => (calls.length > 0 ? `${calls.length} call${calls.length === 1 ? "" : "s"}` : ""),
  Preview: (props) => {
    const output = () => codemodeOutput(props.snapshot.result?.content ?? []);
    return (
      <>
        {props.snapshot.callsIncomplete ? <text fg={palette.warning}>the saved call list is incomplete</text> : null}
        <For each={props.snapshot.calls}>{(call, index) => <CallOverview call={call} index={index()} />}</For>
        {output().output ? <text fg={palette.dim}>output</text> : null}
        {output().output ? <Preview text={output().output} /> : null}
        {output().error ? <Preview text={output().error ?? ""} fg={palette.error} /> : null}
        {!props.snapshot.result ? <ErrorPreview snapshot={props.snapshot} /> : null}
      </>
    );
  },
  details: (snapshot) => {
    const code = codemodeSource(snapshot);
    const content = snapshot.result?.content ?? [];
    const output = codemodeOutput(content);
    const location = code === undefined ? undefined : codemodeErrorLocation(code, { content, isError: snapshot.state === "error" });
    return (
      <box flexDirection="column">
        {snapshot.callsIncomplete ? <text fg={palette.warning}>the saved call list is incomplete</text> : null}
        {code !== undefined ? <ScriptSource code={code} errorLine={location?.kind === "located" ? location.line : undefined} /> : <text fg={palette.warning}>script source unavailable</text>}
        {location?.kind === "located" ? <text fg={palette.error}>{`error at line ${location.line}`}</text> : null}
        {location?.kind === "unrecognized" ? <text fg={palette.warning}>the error's format is not recognized, so no line is marked</text> : null}
        {output.header ? <text fg={palette.dim}>{output.header}</text> : null}
        {output.output ? <text>{output.output}</text> : null}
        <ImagesDetail images={output.images} label="output image" />
        {output.error ? <text fg={palette.error}>{output.error}</text> : null}
      </box>
    );
  },
  expandable: (snapshot) => snapshot.calls.length > 0 || codemodeSource(snapshot) !== undefined || snapshot.result !== undefined,
};

/** Tools with a dedicated presentation, by tool name; any other tool uses the generic one. */
const builtInTools: Readonly<Record<string, { kind: string; spec: ToolSpec }>> = {
  codemode: { kind: "tool:codemode", spec: codemodeSpec },
  read: { kind: "tool:read", spec: readSpec },
  bash: { kind: "tool:bash", spec: bashSpec },
  edit: { kind: "tool:edit", spec: editSpec },
  write: { kind: "tool:write", spec: writeSpec },
};

// ---------------------------------------------------------------------------
// The built-in types
// ---------------------------------------------------------------------------

function stopLine(value: ResponseValue): JSX.Element {
  if (value.streaming) return null;
  if (value.stopReason === "error") return <text fg={palette.error}>{`error: ${value.errorMessage ?? "the response failed"}`}</text>;
  if (value.stopReason === "aborted") return <text fg={palette.warning}>{value.errorMessage ? `aborted: ${value.errorMessage}` : "aborted"}</text>;
  if (value.stopReason === "length") return <text fg={palette.warning}>stopped at the output limit</text>;
  return null;
}

const retryText: Record<RetryState, string> = {
  waiting: "waiting to retry",
  retrying: "retrying…",
  succeeded: "succeeded",
  failed: "failed",
  ended: "ended",
};

const compactionText: Record<CompactionState, string> = {
  running: "compacting…",
  completed: "compacted",
  failed: "compaction failed",
  aborted: "compaction aborted",
};


export function createTimelineTypes(options: { hiddenThinkingLabel?: () => string | undefined } = {}) {
  const withheld = () => options.hiddenThinkingLabel?.() ?? "thinking withheld";
  const user: ItemType<UserValue, JSX.Element> = {
    kind: "user",
    render: ({ value }) => (
      <box flexDirection="column">
        <text fg={palette.user}>{`> ${value.text}`}</text>
        {value.images.length > 0 ? <text fg={palette.dim}>{`attachments: ${value.images.join("; ")}`}</text> : null}
      </box>
    ),
    sourceText: (value) => value.text || undefined,
    actions: {},
  };
  const image: ItemType<ImageValue, JSX.Element> = {
    kind: "image",
    render: ({ value, expanded }) => (
      <box flexDirection="column">
        <text fg={palette.dim}>{`image: ${value.label}`}</text>
        {expanded ? <FittedImage content={value.content} label={value.label} /> : null}
      </box>
    ),
    expandable: () => true,
    // A path or metadata, never the image's bytes.
    sourceText: (value) => value.label,
    actions: {},
  };
  const response: ItemType<ResponseValue, JSX.Element> = {
    kind: "response",
    live: true,
    render: (props) => (
      <box flexDirection="column">
        {props.expanded ? <text fg={palette.dim}>{`response${props.value.streaming ? " · streaming…" : ""}`}</text> : null}
        {!props.expanded && props.value.hasThinking ? <text fg={palette.dim}>thinking</text> : null}
        {!props.expanded && props.value.hasThinking
          ? props.value.thinkingWithheld || props.value.thinking === ""
            ? <text fg={palette.thinking}>{withheld()}</text>
            : <Preview text={props.value.thinking} fg={palette.thinking} markdown />
          : null}
        {!props.expanded && props.value.body ? <Markdown text={props.value.body} streaming={props.value.streaming} /> : null}
        {stopLine(props.value)}
      </box>
    ),
    // The prose and code as written, without thinking.
    sourceText: (value) => value.body || undefined,
    actions: {},
  };
  const thinking: ItemType<ThinkingValue, JSX.Element> = {
    kind: "thinking",
    live: true,
    render: (props) => (
      <box flexDirection="column">
        <text fg={palette.dim}>thinking</text>
        {props.value.withheld || props.value.text === ""
          ? <text fg={palette.thinking}>{withheld()}</text>
          : <Markdown text={props.value.text} fg={palette.thinking} />}
      </box>
    ),
    // Withheld thinking has no text to copy, and its signature is never copied.
    sourceText: (value) => (value.withheld ? undefined : value.text),
    actions: {},
  };
  const prose: ItemType<ProseValue, JSX.Element> = {
    kind: "prose",
    live: true,
    render: (props) => <Markdown text={props.value.text.replace(/^\s*\n/, "").replace(/\n\s*$/, "")} streaming={props.value.streaming} />,
    sourceText: (value) => value.text,
    actions: {},
  };
  const code: ItemType<CodeValue, JSX.Element> = {
    kind: "code",
    live: true,
    render: (props) => <CodeBlock body={props.value.body} language={props.value.language} />,
    // The raw fenced block, fences included, not the rendered body.
    sourceText: (value) => value.sourceText,
    actions: {},
  };
  const compaction: ItemType<CompactionValue, JSX.Element> = {
    kind: "compaction",
    render: ({ value }) => (
      <box flexDirection="column">
        <text fg={value.state === "failed" ? palette.error : value.state === "aborted" ? palette.warning : palette.dim}>
          {`${compactionText[value.state]}${value.reason ? ` (${value.reason})` : ""}${value.tokensBefore !== undefined ? ` · ${value.tokensBefore} tokens before` : ""}`}
        </text>
        {value.errorMessage ? <Preview text={value.errorMessage} fg={palette.error} /> : null}
      </box>
    ),
    renderDetails: ({ value }) => <Markdown text={value.summary ?? ""} />,
    expandable: (value) => Boolean(value.summary),
    sourceText: (value) => value.summary ?? value.errorMessage,
    actions: {},
  };
  const retry: ItemType<RetryValue, JSX.Element> = {
    kind: "retry",
    render: ({ value }) => {
      const last = value.attempts.at(-1);
      return (
        <box flexDirection="column">
          <text fg={value.state === "failed" ? palette.error : palette.warning}>
            {`${value.category === "summary" ? "summary retry" : "retry"} ${last ? `${last.attempt}/${last.maxAttempts}` : ""} · ${retryText[value.state]}${value.state === "waiting" && last ? ` (${Math.round(last.delayMs / 100) / 10}s)` : ""}`}
          </text>
          {value.finalError ? <text fg={palette.error}>{value.finalError}</text> : null}
        </box>
      );
    },
    renderDetails: ({ value }) => (
      <For each={value.attempts}>
        {(attempt) => <text fg={palette.dim}>{`attempt ${attempt.attempt}/${attempt.maxAttempts}: ${attempt.error}`}</text>}
      </For>
    ),
    expandable: (value) => value.attempts.length > 0,
    sourceText: (value) => value.attempts.map((attempt) => attempt.error).join("\n") || undefined,
    actions: {},
  };
  const branchSummary: ItemType<SummaryValue, JSX.Element> = {
    kind: "branch-summary",
    render: ({ value, expanded }) => (
      <box flexDirection="column">
        <text fg={palette.dim}>branch summary</text>
        {expanded ? null : <Preview text={value.summary} />}
      </box>
    ),
    renderDetails: ({ value }) => <Markdown text={value.summary} />,
    expandable: (value) => exceedsPreview(value.summary),
    sourceText: (value) => value.summary,
    actions: {},
  };
  const custom: ItemType<CustomValue, JSX.Element> = {
    kind: "custom",
    render: ({ value, expanded }) => (
      <box flexDirection="column">
        <text fg={palette.accent}>{value.customType}</text>
        {expanded ? null : <Preview text={contentText(value.content)} />}
      </box>
    ),
    renderDetails: ({ value }) => (
      <box flexDirection="column">
        <text>{contentText(value.content)}</text>
        {value.details !== undefined ? <text fg={palette.dim}>{prettyJson(value.details)}</text> : null}
        <ImagesDetail images={typeof value.content === "string" ? [] : imagesOf(value.content)} label="image" />
      </box>
    ),
    expandable: (value) => exceedsPreview(contentText(value.content)) || value.details !== undefined ||
      (typeof value.content !== "string" && imagesOf(value.content).length > 0),
    sourceText: (value) => contentText(value.content),
    actions: {},
    validate: isCustomValue,
  };
  const config: ItemType<ConfigValue, JSX.Element> = {
    kind: "config",
    render: ({ value }) => <text fg={palette.dim}>{`── ${value.setting}: ${value.from} → ${value.to}`}</text>,
    sourceText: (value) => `${value.setting}: ${value.from} → ${value.to}`,
    actions: {},
  };
  const notice: ItemType<NoticeValue, JSX.Element> = {
    kind: "notice",
    render: ({ value }) => <text fg={noticeColor[value.level]}>{value.text}</text>,
    sourceText: (value) => value.text,
    actions: {},
  };
  return {
    user, image, response, thinking, prose, code, compaction, retry, branchSummary, custom, config, notice,
    tool: toolType("tool", genericSpec),
    ...Object.fromEntries(Object.entries(builtInTools).map(([name, { kind, spec }]) => [name, toolType(kind, spec)])),
  };
}

export type TimelineTypes = ReturnType<typeof createTimelineTypes>;

/** The kind that shows a tool without an extension binding. */
export const builtInToolKind = (name: string): string => builtInTools[name]?.kind ?? "tool";
