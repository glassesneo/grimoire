/**
 * The screen's renderers, by the names the runtime's `kinds` map items to.
 * Each reads only its item's `data` in the shape protocol/items.ts gives it;
 * none reads Pi's messages. `text` shows any item as its plain text, and
 * serves every kind that has no renderer here or no mapping in the state.
 */
import {
  type CliRenderer,
  fg,
  RGBA,
  StyledText,
  SyntaxStyle,
  type TextRenderable,
} from "@opentui/core";
import { useRenderer } from "@opentui/solid";
import { createEffect, createSignal, For, type JSX } from "solid-js";
import type {
  CodeData,
  NestedCallSummary,
  ProseData,
  ResponseData,
  ThinkingData,
  ToolArguments,
  ToolData,
  ToolState,
} from "../../protocol/items";
import { argsLine, isRecord, stopText, toolStateText } from "../../protocol/format";
import type { Item } from "../../protocol/wire";
import type { CodemodeSummary } from "../../extensions/codemode";
import type { ItemType } from "./controllers";

const PREVIEW_ROWS = 4;

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

const toneColor: Record<NonNullable<Item["tone"]>, string> = {
  user: palette.user,
  dim: palette.dim,
  accent: palette.accent,
  warning: palette.warning,
  error: palette.error,
};

const syntaxStyles = new WeakMap<CliRenderer["nativeScene"], Map<string, SyntaxStyle>>();
/**
 * One style for Markdown and code per renderer and plain-text color, owned by
 * its native resource context. Highlighted chunks take the plain-text color
 * from the style, not from a renderable's `fg`, so a muted text needs its own.
 */
function syntaxStyle(text: string = palette.text): SyntaxStyle {
  const scene = useRenderer().nativeScene;
  let styles = syntaxStyles.get(scene);
  if (!styles) syntaxStyles.set(scene, (styles = new Map()));
  const existing = styles.get(text);
  if (existing) return existing;
  const syntax = SyntaxStyle.fromStyles(
    {
      default: { fg: RGBA.fromHex(text) },
      keyword: { fg: RGBA.fromHex("#cba6f7") },
      string: { fg: RGBA.fromHex("#a6e3a1") },
      comment: { fg: RGBA.fromHex(palette.dim), italic: true },
      number: { fg: RGBA.fromHex("#fab387") },
      constant: { fg: RGBA.fromHex("#fab387") },
      function: { fg: RGBA.fromHex("#89b4fa") },
      type: { fg: RGBA.fromHex("#f9e2af") },
      operator: { fg: RGBA.fromHex("#89dceb") },
      variable: { fg: RGBA.fromHex(text) },
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
    },
    scene,
  );
  styles.set(text, syntax);
  return syntax;
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

/** One line of differently colored segments, wrapped as a whole. */
function styled(
  ...parts: (readonly [text: string, color?: string] | false | undefined)[]
): StyledText {
  return new StyledText(
    parts.flatMap((part) => (part ? [fg(part[1] ?? palette.text)(part[0])] : [])),
  );
}

/**
 * The first rows of `text` as the terminal lays them out, and a line saying
 * how many rows follow. The rows are measured from the rendered content, so
 * the count matches what expanding shows at this width.
 */
function Preview(props: {
  text: string;
  fg?: string;
  rows?: number;
  markdown?: boolean;
}): JSX.Element {
  const [height, setHeight] = createSignal(0);
  const rows = () => props.rows ?? PREVIEW_ROWS;
  return (
    <box flexDirection="column" flexShrink={0}>
      <box maxHeight={rows()} overflow="hidden" flexShrink={0}>
        <box
          flexDirection="column"
          flexShrink={0}
          onSizeChange={function (this: { height: number }) {
            setHeight(this.height);
          }}
        >
          {props.markdown ? (
            <Markdown text={props.text} fg={props.fg} />
          ) : (
            <text fg={props.fg} wrapMode="word">
              {props.text}
            </text>
          )}
        </box>
      </box>
      {height() > rows() ? (
        <text fg={palette.dim}>{`… ${height() - rows()} more rows`}</text>
      ) : null}
    </box>
  );
}

/** A line of colored segments; see `styled`. */
export function Line(props: {
  parts: Parameters<typeof styled>;
  wrap?: "none" | "word";
}): JSX.Element {
  // Styled text is assigned to the renderable: the JSX `content` prop
  // stringifies it, and as a child each update would be appended.
  return (
    <text
      wrapMode={props.wrap ?? "word"}
      ref={(element: TextRenderable) =>
        createEffect(() => {
          element.content = styled(...props.parts);
        })
      }
    />
  );
}

/**
 * Markdown with its syntax concealed. While streaming, OpenTUI previews the
 * trailing block from an inline parse of its tokens until highlighting lands.
 * In the default coalesced mode that token is the raw text of several blocks,
 * so the preview keeps markers such as `#` that the highlight conceals and each
 * update flickers between the two; top-level blocks preview what the highlight
 * shows. `internalBlockMode` is marked internal in OpenTUI 0.6, and its table
 * default differs, so the grid style is set to match the coalesced output.
 */
function Markdown(props: { text: string; streaming?: boolean; fg?: string }): JSX.Element {
  return (
    <markdown
      content={props.text}
      syntaxStyle={syntaxStyle(props.fg)}
      streaming={props.streaming ?? false}
      internalBlockMode="top-level"
      tableOptions={{ style: "grid" }}
      conceal
      fg={props.fg}
    />
  );
}

function CodeBlock(props: { body: string; language: string }): JSX.Element {
  return (
    <box border borderColor="#45475a" flexDirection="column" paddingX={1}>
      {props.language ? <text fg={palette.accent}>{props.language}</text> : null}
      <code
        content={props.body}
        filetype={filetypeOf(props.language)}
        syntaxStyle={syntaxStyle()}
        wrapMode="word"
      />
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

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
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
// The fallback
// ---------------------------------------------------------------------------

/** Any item as its plain text: the first rows, and all of it when expanded. */
const text: ItemType<Item, JSX.Element> = {
  kind: "text",
  render: (props) => {
    const color = () => (props.value.tone ? toneColor[props.value.tone] : palette.text);
    return (
      <box flexDirection="column">
        {props.expanded ? (
          <text fg={color()} wrapMode="word">
            {props.value.text}
          </text>
        ) : (
          <Preview text={props.value.text} fg={color()} />
        )}
      </box>
    );
  },
  expandable: (value) => exceedsPreview(value.text),
  sourceText: (value) => value.source,
  marker: (value) => (value.tone ? toneColor[value.tone] : undefined),
};

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

const stopColor: Record<string, string> = {
  error: palette.error,
  aborted: palette.warning,
  length: palette.warning,
};

function stopLine(value: ResponseData): JSX.Element {
  const line = stopText(value);
  return line ? <text fg={value.stopReason && stopColor[value.stopReason]}>{line}</text> : null;
}

const data = <T,>(item: Item) => item.data as T;

const response: ItemType<Item, JSX.Element> = {
  kind: "markdown.response",
  render: (props) => {
    const value = () => data<ResponseData>(props.value);
    return (
      <box flexDirection="column">
        {props.expanded ? (
          <text fg={palette.dim}>{`response${value().streaming ? " · streaming…" : ""}`}</text>
        ) : null}
        {!props.expanded && value().hasThinking ? <text fg={palette.dim}>thinking</text> : null}
        {!props.expanded && value().hasThinking ? (
          value().thinkingWithheld || value().thinking === "" ? (
            <text fg={palette.thinking}>thinking withheld</text>
          ) : (
            <Preview text={value().thinking} fg={palette.thinking} markdown />
          )
        ) : null}
        {!props.expanded && value().body ? (
          <Markdown text={value().body} streaming={value().streaming} />
        ) : null}
        {stopLine(value())}
      </box>
    );
  },
  sourceText: (value) => value.source,
  marker: (value) => {
    const response = data<ResponseData>(value);
    return response.streaming
      ? palette.accent
      : ((response.stopReason && stopColor[response.stopReason]) ?? palette.text);
  },
};

const thinking: ItemType<Item, JSX.Element> = {
  kind: "markdown.thinking",
  render: (props) => (
    <box flexDirection="column">
      <text fg={palette.dim}>thinking</text>
      {data<ThinkingData>(props.value).withheld || data<ThinkingData>(props.value).text === "" ? (
        <text fg={palette.thinking}>thinking withheld</text>
      ) : (
        <Markdown text={data<ThinkingData>(props.value).text} fg={palette.thinking} />
      )}
    </box>
  ),
  sourceText: (value) => value.source,
};

const prose: ItemType<Item, JSX.Element> = {
  kind: "markdown.prose",
  render: (props) => (
    <Markdown
      text={data<ProseData>(props.value)
        .text.replace(/^\s*\n/, "")
        .replace(/\n\s*$/, "")}
      streaming={data<ProseData>(props.value).streaming}
    />
  ),
  sourceText: (value) => value.source,
};

const code: ItemType<Item, JSX.Element> = {
  kind: "markdown.code",
  render: (props) => (
    <CodeBlock
      body={data<CodeData>(props.value).body}
      language={data<CodeData>(props.value).language}
    />
  ),
  sourceText: (value) => value.source,
};

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

const stateColor: Record<ToolState, string> = {
  pending: palette.dim,
  running: palette.accent,
  done: palette.dim,
  error: palette.error,
  unfinished: palette.warning,
};

/** A tool's gutter mark: its state's color, except that success is green rather than muted. */
const markerColor: Record<ToolState, string> = { ...stateColor, done: palette.success };

function argsRecord(args: ToolArguments): Record<string, unknown> | undefined {
  return args.available && isRecord(args.value) ? args.value : undefined;
}

/** Text on one line, its line breaks shown as `joiner`. */
function singleLine(value: string, joiner = " "): string {
  return value.replace(/\s*\n\s*/g, joiner);
}

function toolError(tool: ToolData): string | undefined {
  return tool.state === "error" ? tool.result?.text || undefined : undefined;
}

function ToolHeader(props: {
  label: string;
  detail: string;
  status?: string;
  tool: ToolData;
}): JSX.Element {
  const state = () =>
    props.status ??
    (props.tool.result?.partial && props.tool.state === "running"
      ? "running…"
      : toolStateText[props.tool.state]);
  return (
    <Line
      parts={[
        [props.label, palette.accent],
        props.detail ? [` ${props.detail}`] : undefined,
        [` · ${state()}`, stateColor[props.tool.state]],
      ]}
    />
  );
}

function ErrorPreview(props: { tool: ToolData }): JSX.Element {
  return (
    <>
      {toolError(props.tool) ? (
        <Preview text={toolError(props.tool) ?? ""} fg={palette.error} />
      ) : null}
    </>
  );
}

function ResultLines(props: { tool: ToolData }): JSX.Element {
  return (
    <For each={props.tool.result?.images ?? []}>
      {(label) => <text fg={palette.dim}>{`image: ${label}`}</text>}
    </For>
  );
}

interface ToolSpec {
  label?: string;
  summary: (call: { args: ToolArguments; calls?: readonly NestedCallSummary[] }) => string;
  status?: (tool: ToolData) => string;
  Preview?: (props: { tool: ToolData }) => JSX.Element;
  details: (tool: ToolData) => JSX.Element;
  expandable: (tool: ToolData) => boolean;
}

function toolType(kind: string, spec: ToolSpec): ItemType<Item, JSX.Element> {
  const Collapsed = spec.Preview ?? ErrorPreview;
  return {
    kind,
    render: (props) => {
      const tool = () => data<ToolData>(props.value);
      return (
        <box flexDirection="column">
          <ToolHeader
            label={spec.label ?? tool().name}
            detail={spec.summary(tool())}
            status={spec.status?.(tool())}
            tool={tool()}
          />
          {props.expanded ? null : <Collapsed tool={tool()} />}
        </box>
      );
    },
    renderDetails: ({ value }) => spec.details(data<ToolData>(value)),
    expandable: (value) => spec.expandable(data<ToolData>(value)),
    sourceText: (value) => value.source,
    marker: (value) => markerColor[data<ToolData>(value).state],
  };
}

const genericSpec: ToolSpec = {
  summary: (call) => argsLine(call.args),
  details: (tool) => (
    <box flexDirection="column">
      <text fg={palette.dim}>arguments</text>
      <text>{tool.args.available ? prettyJson(tool.args.value) : argsLine(tool.args)}</text>
      {tool.result ? (
        <box flexDirection="column">
          <text fg={palette.dim}>{tool.state === "error" ? "error" : "result"}</text>
          <text fg={tool.state === "error" ? palette.error : undefined}>
            {tool.result.text || "(no text)"}
          </text>
          {tool.result.details !== undefined ? <text fg={palette.dim}>details</text> : null}
          {tool.result.details !== undefined ? (
            <text>{prettyJson(tool.result.details)}</text>
          ) : null}
          <ResultLines tool={tool} />
        </box>
      ) : null}
    </box>
  ),
  expandable: (tool) =>
    argsLine(tool.args, Number.POSITIVE_INFINITY).length > 80 ||
    tool.result !== undefined ||
    toolError(tool) !== undefined,
};

function bashDetails(tool: ToolData) {
  const details = tool.result?.details;
  if (!isRecord(details)) return {};
  return {
    exitCode: typeof details.exitCode === "number" ? details.exitCode : undefined,
    fullOutputPath: typeof details.fullOutputPath === "string" ? details.fullOutputPath : undefined,
    truncated:
      isRecord(details.truncation) && details.truncation.truncated === true
        ? `truncated by ${String(details.truncation.truncatedBy)}: ${String(details.truncation.outputLines)} of ${String(details.truncation.totalLines)} lines`
        : undefined,
  };
}

const bashSpec: ToolSpec = {
  label: "$",
  summary: ({ args }) => {
    const command = argsRecord(args)?.command;
    return typeof command === "string" ? singleLine(command, " ⏎ ") : argsLine(args);
  },
  Preview: (props) => (
    <>
      {props.tool.result?.text ? (
        <Preview
          text={props.tool.result.text}
          fg={props.tool.state === "error" ? palette.error : palette.dim}
        />
      ) : (
        <ErrorPreview tool={props.tool} />
      )}
    </>
  ),
  details: (tool) => {
    const extra = bashDetails(tool);
    return (
      <box flexDirection="column">
        <text fg={tool.state === "error" ? palette.error : undefined}>
          {tool.result?.text || "(no output)"}
        </text>
        {extra.exitCode !== undefined ? (
          <text fg={palette.dim}>{`exit code ${extra.exitCode}`}</text>
        ) : null}
        {extra.truncated ? <text fg={palette.dim}>{extra.truncated}</text> : null}
        {extra.fullOutputPath ? (
          <text fg={palette.dim}>{`full output: ${extra.fullOutputPath}`}</text>
        ) : null}
      </box>
    );
  },
  expandable: (tool) => {
    const extra = bashDetails(tool);
    return (
      exceedsPreview(tool.result?.text ?? "") ||
      extra.exitCode !== undefined ||
      extra.fullOutputPath !== undefined ||
      extra.truncated !== undefined
    );
  },
};

// ---------------------------------------------------------------------------
// Codemode
// ---------------------------------------------------------------------------

/** A call line inside a codemode item, in the order the calls started. */
function CallOverview(props: { call: NestedCallSummary }): JSX.Element {
  const spec = () => (props.call.name === "bash" ? bashSpec : genericSpec);
  return (
    <Line
      wrap="none"
      parts={[
        ["· ", palette.dim],
        [spec().label ?? props.call.name, palette.accent],
        [` ${spec().summary(props.call)}`],
        [` · ${toolStateText[props.call.state]}`, stateColor[props.call.state]],
      ]}
    />
  );
}

/** The submitted script with the line the error names marked in text, not color alone. */
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
            <Line
              parts={[
                [
                  `${marked() ? "▶" : " "}${String(index() + 1).padStart(width())} `,
                  marked() ? palette.error : palette.dim,
                ],
                [line, marked() ? palette.error : palette.text],
                marked() && ["  ← error", palette.error],
              ]}
            />
          );
        }}
      </For>
    </box>
  );
}

function Outcome(props: { children: JSX.Element }): JSX.Element {
  return (
    <box flexDirection="row" flexShrink={0}>
      <text fg={palette.dim} flexShrink={0}>
        {"→ "}
      </text>
      <box flexDirection="column" flexGrow={1} flexShrink={1}>
        {props.children}
      </box>
    </box>
  );
}

const summaryOf = (tool: ToolData): CodemodeSummary | undefined => {
  const value = tool.extra?.codemode;
  return isRecord(value) && typeof value.output === "string"
    ? (value as unknown as CodemodeSummary)
    : undefined;
};

const codemodeSpec: ToolSpec = {
  label: "codemode",
  summary: ({ calls = [] }) =>
    calls.length > 0 ? `${calls.length} call${calls.length === 1 ? "" : "s"}` : "",
  status: (tool) => {
    const summary = summaryOf(tool);
    const location = summary?.location;
    const state =
      location?.kind === "located" ? `failed at line ${location.line}` : toolStateText[tool.state];
    return [summary?.wallTime, state].filter(Boolean).join(" · ");
  },
  Preview: (props) => {
    const summary = () => summaryOf(props.tool);
    return (
      <>
        <For each={props.tool.calls}>{(call) => <CallOverview call={call} />}</For>
        {summary()?.output ? (
          <Outcome>
            <Preview text={summary()!.output} />
          </Outcome>
        ) : null}
        {summary()?.error ? (
          <Outcome>
            <text fg={palette.error} wrapMode="word">
              {summary()!.error!.split("\n")[0] ?? ""}
            </text>
          </Outcome>
        ) : null}
        {!props.tool.result ? <ErrorPreview tool={props.tool} /> : null}
      </>
    );
  },
  details: (tool) => {
    const summary = summaryOf(tool);
    const location = summary?.location;
    return (
      <box flexDirection="column">
        {summary?.code !== undefined ? (
          <ScriptSource
            code={summary.code}
            errorLine={location?.kind === "located" ? location.line : undefined}
          />
        ) : (
          <text fg={palette.warning}>script source unavailable</text>
        )}
        {location?.kind === "located" ? (
          <text fg={palette.error}>{`error at line ${location.line}`}</text>
        ) : null}
        {location?.kind === "unrecognized" ? (
          <text fg={palette.warning}>
            the error's format is not recognized, so no line is marked
          </text>
        ) : null}
        {summary?.header ? <text fg={palette.dim}>{summary.header}</text> : null}
        {summary?.output ? <text>{summary.output}</text> : null}
        <For each={summary?.images ?? []}>
          {(label) => <text fg={palette.dim}>{`output image: ${label}`}</text>}
        </For>
        {summary?.error ? <text fg={palette.error}>{summary.error}</text> : null}
      </box>
    );
  },
  expandable: (tool) =>
    tool.calls.length > 0 || tool.result !== undefined || summaryOf(tool) !== undefined,
};

/** Every renderer the screen has, by name. */
export function createRenderers(): Record<string, ItemType<Item, JSX.Element>> {
  const all = [
    text,
    response,
    thinking,
    prose,
    code,
    toolType("tool.generic", genericSpec),
    toolType("tool.bash", bashSpec),
    toolType("tool.codemode", codemodeSpec),
  ];
  return Object.fromEntries(all.map((type) => [type.kind, type]));
}
