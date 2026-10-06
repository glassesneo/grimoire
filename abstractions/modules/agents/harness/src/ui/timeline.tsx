import type { ScrollBoxRenderable } from "@opentui/core";
import { createEffect, For, Index, type JSX } from "solid-js";
import {
  type NoticeLevel,
  splitFencedBlocks,
  type ToolStatus,
  type SessionEntry,
} from "../core/session-entries";
import { materializeItem, type TimelineItem, type ItemTypeRegistry, type ItemType } from "./controllers";
import type { TimelineScrollBox } from "./item-actions";
import { useVersion } from "./state";

const noticeColor: Record<NoticeLevel, string> = {
  info: "#89b4fa",
  warning: "#f9e2af",
  error: "#f38ba8",
};

const CURSOR_MARKER = "#89b4fa";
const CURSOR_BACKGROUND = "#3a3a3a";

/** Drop blank lines that only separate a text run from a neighbouring fence. */
function trimBlankLines(text: string): string {
  return text.replace(/^\s*\n/, "").replace(/\n\s*$/, "");
}

export interface UserValue {
  text: string;
}

export interface AssistantValue {
  text: string;
  streaming: boolean;
}

export interface CodeValue {
  language: string;
  body: string;
  sourceText: string;
}

export interface ToolValue {
  name: string;
  status: ToolStatus;
  summary: string;
  sourceText: string;
}

export interface NoticeValue {
  level: NoticeLevel;
  text: string;
}

export interface SessionItemTypes<Render> {
  user: ItemType<UserValue, Render>;
  assistant: ItemType<AssistantValue, Render>;
  code: ItemType<CodeValue, Render>;
  tool: ItemType<ToolValue, Render>;
  notice: ItemType<NoticeValue, Render>;
}

/**
 * Turn session entries into stable, selectable timeline items. An assistant
 * message splits at its fence boundaries; every part id is derived from the
 * message id and the part index, so a streamed message keeps its ids as its
 * text grows. Versions come from the entries and never decrease.
 */
export function projectSession<Render>(
  entries: readonly SessionEntry[],
  types: SessionItemTypes<Render>,
): readonly TimelineItem<Render>[] {
  const projected: TimelineItem<Render>[] = [];
  for (const entry of entries) {
    switch (entry.kind) {
      case "user":
        projected.push(materializeItem({
          id: entry.id,
          version: entry.version,
          type: types.user,
          value: { text: entry.text },
        }));
        break;
      case "assistant": {
        let part = 0;
        for (const block of splitFencedBlocks(entry.text)) {
          const id = `${entry.id}:part:${part++}`;
          // A blank run between fences has nothing to show or select; the part
          // index still advances so the ids after it stay stable.
          if (block.type === "text" && block.text.trim() === "") {
            continue;
          }
          if (block.type === "text") {
            projected.push(materializeItem({
              id,
              version: entry.version,
              type: types.assistant,
              value: { text: block.text, streaming: entry.streaming },
            }));
          } else {
            projected.push(materializeItem({
              id,
              version: entry.version,
              type: types.code,
              value: {
                language: block.language,
                body: block.body,
                sourceText: block.sourceText,
              },
            }));
          }
        }
        break;
      }
      case "tool":
        projected.push(materializeItem({
          id: entry.id,
          version: entry.version,
          type: types.tool,
          value: {
            name: entry.name,
            status: entry.status,
            summary: `${entry.name}${entry.status === "error" ? " (failed)" : ""}`,
            sourceText: entry.sourceText,
          },
        }));
        break;
      case "notice":
        projected.push(materializeItem({
          id: entry.id,
          version: entry.version,
          type: types.notice,
          value: { level: entry.level, text: entry.text },
        }));
        break;
    }
  }
  return projected;
}

/**
 * The built-in timeline types. Their render functions are the only UI concern;
 * `sourceText` returns what the `y` copy action writes, and the cursor row is
 * marked by the view, not by the type.
 */
export function createSessionItemTypes(): SessionItemTypes<JSX.Element> {
  return {
    user: {
      kind: "user",
      render: ({ value }) => <text fg="#a6e3a1">{`> ${value.text}`}</text>,
      sourceText: (value) => value.text,
      actions: {},
    },
    assistant: {
      kind: "assistant",
      render: ({ value }) => <text>{trimBlankLines(value.text)}</text>,
      sourceText: (value) => value.text,
      actions: {},
    },
    code: {
      kind: "code",
      render: ({ value }) => (
        <box border flexDirection="column" paddingX={1}>
          {value.language ? <text fg="#89b4fa">{value.language}</text> : null}
          <text>{value.body}</text>
        </box>
      ),
      // The raw fenced block, fences included, not the rendered body.
      sourceText: (value) => value.sourceText,
      actions: {},
    },
    tool: {
      kind: "tool",
      render: ({ value }) => (
        <text fg={value.status === "error" ? "#f38ba8" : "#6c7086"}>{`· ${value.summary}`}</text>
      ),
      // The raw tool result, unlike the short summary shown on the row.
      sourceText: (value) => value.sourceText,
      actions: {},
    },
    notice: {
      kind: "notice",
      render: ({ value }) => <text fg={noticeColor[value.level]}>{value.text}</text>,
      sourceText: (value) => value.text,
      actions: {},
    },
  };
}

export interface TimelineViewProps {
  timeline: ItemTypeRegistry<JSX.Element>;
  /** Rows the screen's overlays cover over the scrollbox's bottom edge. */
  overlayHeight: number;
  /** Whether the timeline region holds focus; the cursor row is marked only then. */
  focused?: boolean;
  /** Queued prompts shown after the history; not selectable timeline items. */
  queued?: readonly string[];
  scrollRef?: (scrollbox: TimelineScrollBox | undefined) => void;
}

/**
 * The agent's history as selectable timeline items. The scrollbox keeps the
 * full screen; a spacer as tall as the overlay lets the last item scroll above
 * the editor, and `scrollRef` exposes the scrollbox to item actions. The
 * vertical scrollbar stops at the overlay's top edge and its thumb is sized to
 * the rows left visible, so it is never painted under the editor.
 */
export function TimelineView(props: TimelineViewProps): JSX.Element {
  const version = useVersion(props.timeline);
  const items = (): readonly TimelineItem<JSX.Element>[] => [
    ...(version(), props.timeline.items()),
  ];
  const cursor = (): string | undefined => (version(), props.timeline.cursor());
  const selected = (id: string): boolean => Boolean(props.focused) && cursor() === id;
  let scrollbox: ScrollBoxRenderable | undefined;

  createEffect(() => {
    if (scrollbox) {
      scrollbox.verticalScrollBar.marginBottom = props.overlayHeight;
    }
  });

  return (
    <scrollbox
      ref={(element) => {
        scrollbox = element;
        props.scrollRef?.(element);
      }}
      flexGrow={1}
      stickyScroll
      stickyStart="bottom"
      paddingX={1}
      renderBefore={function (this: ScrollBoxRenderable) {
        // The native bar resets its thumb to the full viewport on resize, so
        // re-apply the visible height after layout and before the bar paints.
        this.verticalScrollBar.slider.viewPortSize = Math.max(1, this.viewport.height - props.overlayHeight);
      }}
    >
      {/* Rows are kept by position; a streamed item updates its row in place. */}
      <Index each={items()}>
        {(item) => (
          <box
            id={item().id}
            flexDirection="row"
            marginBottom={item().kind === "tool" ? 0 : 1}
            backgroundColor={selected(item().id) ? CURSOR_BACKGROUND : "transparent"}
          >
            <text fg={CURSOR_MARKER} flexShrink={0}>
              {selected(item().id) ? "▌ " : "  "}
            </text>
            {/* Shrinkable so wrapped text stays left of the scrollbar column. */}
            <box flexGrow={1} flexShrink={1} minWidth={0} flexDirection="column">
              {item().render()}
            </box>
          </box>
        )}
      </Index>
      <For each={props.queued ?? []}>
        {(text) => (
          <text fg="#6c7086" paddingX={2} flexShrink={0}>{`queued: ${text}`}</text>
        )}
      </For>
      {props.overlayHeight > 0 ? (
        <box id="timeline-spacer" height={props.overlayHeight} flexShrink={0} />
      ) : null}
    </scrollbox>
  );
}
