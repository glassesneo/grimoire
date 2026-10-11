import type { ScrollBoxRenderable } from "@opentui/core";
import { type Accessor, createEffect, createMemo, For, type JSX, untrack } from "solid-js";
import {
  type AssistantEntry,
  type BashEntry,
  type SessionEntry,
  splitFencedBlocks,
  type ToolEntry,
  type UserEntry,
} from "../core/session-entries";
import { type ItemType, type ItemTypeRegistry, materializeItem, type TimelineItem } from "./controllers";
import type { CustomMessageSnapshot, TimelineBindings } from "./harness-client";
import type { TimelineScrollBox } from "./item-actions";
import { useVersion } from "./state";
import {
  builtInToolKind,
  imageMetadata,
  type NestedCallSummary,
  palette,
  type TimelineTypes,
  type ToolSnapshot,
} from "./timeline-types";

const CURSOR_MARKER = "#89b4fa";
/** Behind an expanded item and everything it shows, to mark where the expansion ends. */
const EXPANDED_BACKGROUND = "#24273a";

export interface ProjectionContext {
  types: TimelineTypes;
  /** Registered kinds, for bindings that name one. */
  registry: Pick<ItemTypeRegistry<JSX.Element>, "lookup">;
  bindings: TimelineBindings;
  /** Reports a binding that could not present its value; the item falls back to the generic type. */
  diagnose?(message: string): void;
}

type Typed = ItemType<unknown, JSX.Element>;
function erase<T>(type: ItemType<T, JSX.Element>): Typed {
  return type as unknown as Typed;
}

function item(id: string, version: number, type: Typed, value: unknown, options: { parentId?: string; initiallyExpanded?: boolean } = {}): TimelineItem<JSX.Element> {
  return materializeItem({ id, version, type, value, ...options });
}

function toolSnapshot(entry: ToolEntry, calls: readonly ToolEntry[], parentCallId: string | undefined): ToolSnapshot {
  return {
    id: entry.id,
    callId: entry.callId,
    name: entry.name,
    parentCallId,
    args: entry.args,
    state: entry.state,
    result: entry.result,
    errorSummary: entry.errorSummary,
    calls: calls.map((call): NestedCallSummary => ({ name: call.name, args: call.args, state: call.state })),
    callsIncomplete: entry.nestedIncomplete,
  };
}

function bashSnapshot(entry: BashEntry): ToolSnapshot {
  return {
    id: entry.id,
    callId: entry.id,
    name: "bash",
    parentCallId: undefined,
    args: entry.command === undefined ? { available: false } : { available: true, value: { command: entry.command } },
    state: entry.running ? "running" : "done",
    result: {
      content: [{ type: "text", text: entry.output }],
      details: entry.running ? undefined : {
        exitCode: entry.exitCode, cancelled: entry.cancelled, truncated: entry.truncated,
        ...(entry.fullOutputPath ? { fullOutputPath: entry.fullOutputPath } : {}),
      },
      partial: entry.running,
    },
    errorSummary: undefined,
    calls: [],
    callsIncomplete: false,
  };
}

/**
 * The value a binding produces, checked by the kind it names. Anything that
 * fails falls back to the generic presentation with the same identity.
 */
function bound<S>(
  context: ProjectionContext,
  binding: { kind: string; project?: (snapshot: S) => unknown } | undefined,
  snapshot: S,
  fallback: Typed,
  label: string,
): { type: Typed; value: unknown } {
  if (!binding) return { type: fallback, value: snapshot };
  const type = context.registry.lookup(binding.kind);
  try {
    const value = binding.project ? binding.project(snapshot) : snapshot;
    if (type?.validate?.(value)) return { type, value };
    context.diagnose?.(`${label}: the ${binding.kind} presentation rejected its value`);
  } catch (error) {
    context.diagnose?.(`${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { type: fallback, value: snapshot };
}

function toolKind(context: ProjectionContext, name: string, snapshot: ToolSnapshot): { type: Typed; value: unknown } {
  const generic = erase(context.types.tool);
  const binding = context.bindings.tool(name);
  if (binding) return bound(context, binding, snapshot, generic, `tool ${name}`);
  return { type: context.registry.lookup(builtInToolKind(name)) ?? generic, value: snapshot };
}

function projectUser(entry: UserEntry, context: ProjectionContext): TimelineItem<JSX.Element>[] {
  const labels = entry.images.map((image, index) => `image ${index + 1} (${imageMetadata(image)})`);
  return [
    item(entry.id, entry.version, erase(context.types.user), { text: entry.text, images: labels }),
    // Attachments start expanded, so the first expansion of the message shows them.
    ...entry.images.map((image, index) => item(`${entry.id}:image:${index}`, entry.version, erase(context.types.image),
      { label: labels[index], content: image }, { parentId: entry.id, initiallyExpanded: true })),
  ];
}

/** A response and its parts: thinking, prose, and fenced code, each selectable in source order. */
function projectResponse(entry: AssistantEntry, context: ProjectionContext): TimelineItem<JSX.Element>[] {
  const thinking = entry.parts.filter((part) => part.type === "thinking");
  const body = entry.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
  const parent = item(entry.id, entry.version, erase(context.types.response), {
    thinking: thinking.map((part) => part.text).filter((text) => text !== "").join("\n\n"),
    hasThinking: thinking.length > 0,
    thinkingWithheld: thinking.length > 0 && thinking.every((part) => part.withheld),
    body,
    streaming: entry.streaming,
    stopReason: entry.stopReason,
    errorMessage: entry.errorMessage,
  });
  const children: TimelineItem<JSX.Element>[] = [];
  for (const [index, part] of entry.parts.entries()) {
    if (part.type === "thinking") {
      children.push(item(`${entry.id}:thinking:${index}`, entry.version, erase(context.types.thinking),
        { text: part.text, withheld: part.withheld }, { parentId: entry.id }));
      continue;
    }
    for (const [block, fenced] of splitFencedBlocks(part.text, { openFences: true }).entries()) {
      const id = `${entry.id}:text:${index}:part:${block}`;
      // A blank run between fences has nothing to show or select; the part
      // index still advances so the ids after it stay stable.
      if (fenced.type === "text" && fenced.text.trim() === "") continue;
      children.push(fenced.type === "text"
        ? item(id, entry.version, erase(context.types.prose), { text: fenced.text, streaming: entry.streaming }, { parentId: entry.id })
        : item(id, entry.version, erase(context.types.code), {
          language: fenced.language, body: fenced.body, sourceText: fenced.sourceText, open: fenced.open ?? false,
        }, { parentId: entry.id }));
    }
  }
  return [parent, ...children];
}

interface Projected {
  entry: SessionEntry;
  bindings: number;
  calls: readonly ToolEntry[];
  items: readonly TimelineItem<JSX.Element>[];
}

/**
 * Turns session entries into timeline items, reusing an entry's items while
 * nothing they depend on changed, so unchanged rows keep their renderables.
 */
export class TimelineProjector {
  readonly #context: ProjectionContext;
  #cache = new Map<string, Projected>();
  #bindingsVersion = 0;

  constructor(context: ProjectionContext) {
    this.#context = context;
    context.bindings.subscribe(() => {
      this.#bindingsVersion++;
    });
  }

  /** Forget cached items, for a history that replaces this one. */
  reset(): void {
    this.#cache.clear();
  }

  project(entries: readonly SessionEntry[]): TimelineItem<JSX.Element>[] {
    const children = new Map<string, ToolEntry[]>();
    const tools = new Map<string, ToolEntry>();
    for (const entry of entries) {
      if (entry.kind !== "tool") continue;
      tools.set(entry.id, entry);
      if (entry.parentId === undefined) continue;
      const list = children.get(entry.parentId) ?? [];
      list.push(entry);
      children.set(entry.parentId, list);
    }
    const collect = (id: string, into: ToolEntry[]): ToolEntry[] => {
      for (const child of children.get(id) ?? []) {
        into.push(child);
        collect(child.id, into);
      }
      return into;
    };
    // Every call a tool made, its calls' calls included, in the order they started.
    const descendants = (id: string) => collect(id, []).sort((a, b) => a.ordinal - b.ordinal);
    const next = new Map<string, Projected>();
    const result: TimelineItem<JSX.Element>[] = [];
    for (const entry of entries) {
      // Entries are immutable, so an unchanged one keeps its items while its calls do too.
      const calls = entry.kind === "tool" && children.has(entry.id) ? descendants(entry.id) : [];
      let cached = this.#cache.get(entry.id);
      if (
        !cached || cached.entry !== entry || cached.bindings !== this.#bindingsVersion ||
        cached.calls.length !== calls.length || cached.calls.some((call, index) => call !== calls[index])
      ) {
        cached = { entry, bindings: this.#bindingsVersion, calls, items: this.#projectEntry(entry, calls, tools) };
      }
      next.set(entry.id, cached);
      result.push(...cached.items);
    }
    this.#cache = next;
    return result;
  }

  #projectEntry(entry: SessionEntry, calls: readonly ToolEntry[], tools: ReadonlyMap<string, ToolEntry>): TimelineItem<JSX.Element>[] {
    const context = this.#context;
    const { types } = context;
    switch (entry.kind) {
      case "user":
        return projectUser(entry, context);
      case "assistant":
        return projectResponse(entry, context);
      case "tool": {
        const parent = entry.parentId === undefined ? undefined : tools.get(entry.parentId);
        const snapshot = toolSnapshot(entry, calls, parent?.callId);
        const { type, value } = toolKind(context, entry.name, snapshot);
        return [item(entry.id, entry.version, type, value, { parentId: parent?.id })];
      }
      case "bash": {
        const snapshot = bashSnapshot(entry);
        const { type, value } = toolKind(context, "bash", snapshot);
        return [item(entry.id, entry.version, type, value)];
      }
      case "custom": {
        const snapshot: CustomMessageSnapshot = { id: entry.id, customType: entry.customType, content: entry.content, details: entry.details };
        const { type, value } = bound(context, context.bindings.custom(entry.customType), snapshot, erase(types.custom), `message ${entry.customType}`);
        return [item(entry.id, entry.version, type, value)];
      }
      case "compaction":
        return [item(entry.id, entry.version, erase(types.compaction), {
          state: entry.state, reason: entry.reason, summary: entry.summary, tokensBefore: entry.tokensBefore, errorMessage: entry.errorMessage,
        })];
      case "retry":
        return [item(entry.id, entry.version, erase(types.retry), {
          category: entry.category, state: entry.state, attempts: entry.attempts, finalError: entry.finalError,
        })];
      case "branch-summary":
        return [item(entry.id, entry.version, erase(types.branchSummary), { summary: entry.summary })];
      case "config":
        return [item(entry.id, entry.version, erase(types.config), { setting: entry.setting, from: entry.from, to: entry.to })];
      case "notice":
        return [item(entry.id, entry.version, erase(types.notice), { level: entry.level, text: entry.text })];
      case "contribution": {
        // The contributor validated the value; a kind registered since then is gone, and so is the item.
        const type = context.registry.lookup(entry.type);
        return type ? [item(entry.id, entry.version, type, entry.value)] : [];
      }
    }
  }
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

export interface QueuedPrompts {
  steering: readonly string[];
  followUp: readonly string[];
}

export interface TimelineViewProps {
  timeline: ItemTypeRegistry<JSX.Element>;
  /** Rows the screen's overlays cover over the scrollbox's bottom edge. */
  overlayHeight: number;
  /** Rows the top status line covers over the scrollbox's top edge. */
  topInset?: number;
  /** Temporary blank rows that keep an anchored item in place at the end of the history. */
  slack?: number;
  /** Whether the timeline region holds focus; the cursor row is marked only then. */
  focused?: boolean;
  /** Prompts waiting for the current run; shown after the history, not selectable. */
  queued?: QueuedPrompts;
  scrollRef?: (scrollbox: TimelineScrollBox | undefined) => void;
  /** Runs each frame after layout and before positions are applied, where following and anchoring happen. */
  onFrame?: () => void;
}

interface Row {
  type: "item" | "details";
  id: string;
  depth: number;
  /** A blank row before it separates top-level items. */
  gap: boolean;
  /** Inside an expanded item, which is shaded to show where its expansion ends. */
  shaded: boolean;
}

/**
 * Visible items in reading order, with each expanded item's details placed
 * after its last visible descendant.
 */
function rowsOf<Render>(timeline: ItemTypeRegistry<Render>): Row[] {
  const rows: Row[] = [];
  const open: { id: string; depth: number }[] = [];
  // In reading order, reaching an item no deeper than an open one means its
  // subtree has ended, so its details come here.
  const close = (depth: number) => {
    while (open.length > 0 && open.at(-1)!.depth >= depth) {
      const top = open.pop()!;
      rows.push({ type: "details", id: top.id, depth: top.depth, gap: false, shaded: true });
    }
  };
  // A parent comes before its children, so depths fill in as the walk goes.
  const depths = new Map<string, number>();
  let first = true;
  for (const current of timeline.visibleItems()) {
    const depth = current.parentId === undefined ? 0 : (depths.get(current.parentId) ?? -1) + 1;
    depths.set(current.id, depth);
    close(depth);
    const isOpen = timeline.isExpanded(current.id) && timeline.isExpandable(current.id);
    // A visible child means its ancestors are expanded.
    rows.push({ type: "item", id: current.id, depth, gap: depth === 0 && !first, shaded: depth > 0 || isOpen });
    if (depth === 0) first = false;
    if (isOpen && current.renderDetails) open.push({ id: current.id, depth });
  }
  close(0);
  return rows;
}

/**
 * Scroll geometry from this frame's computed layout. The view applies
 * following and anchoring while the scrollbox updates, after layout and
 * before positions are applied, so a correction is painted in the same frame
 * as the change it corrects; renderable positions would still be last frame's.
 */
function layoutScrollBox(box: ScrollBoxRenderable): TimelineScrollBox {
  return {
    get scrollTop() {
      return box.scrollTop;
    },
    set scrollTop(value: number) {
      box.scrollTop = value;
    },
    get scrollHeight() {
      return box.content.getLayout().height;
    },
    get height() {
      return box.viewport.getLayout().height;
    },
    y: 0,
    getRenderable(id) {
      const row = box.getRenderable(id);
      if (!row) return undefined;
      const layout = row.getLayout();
      return { y: layout.top - box.scrollTop, height: layout.height };
    },
  };
}

interface RowProps {
  row: Row;
  timeline: ItemTypeRegistry<JSX.Element>;
  version: Accessor<number>;
}

/**
 * One item's row. It renders again only when its own item or disclosure
 * changes; a live type is rendered once and follows its value through props.
 */
function ItemRow(props: RowProps & { focused: () => boolean }): JSX.Element {
  const { id, depth } = props.row;
  const item = createMemo(() => (props.version(), props.timeline.find(id)));
  const expandable = createMemo(() => (props.version(), props.timeline.isExpandable(id)));
  const open = createMemo(() => expandable() && (props.version(), props.timeline.isExpanded(id)));
  const selected = createMemo(() => props.focused() && (props.version(), props.timeline.cursor() === id));
  const liveType = createMemo(() => {
    const type = item()?.type;
    return type?.live ? type : undefined;
  });
  const liveProps = {
    get value() {
      return item()?.value;
    },
    id,
    get version() {
      return item()?.version ?? 0;
    },
    get expanded() {
      return open();
    },
  };
  const content = createMemo(() => {
    const type = liveType();
    if (type) return untrack(() => type.render(liveProps));
    const current = item();
    const isOpen = open();
    return current ? untrack(() => current.render(isOpen)) : null;
  });
  return (
    <box
      id={id}
      flexDirection="row"
      flexShrink={0}
      marginTop={props.row.gap ? 1 : 0}
      backgroundColor={props.row.shaded ? EXPANDED_BACKGROUND : "transparent"}
    >
      <text fg={CURSOR_MARKER} flexShrink={0}>
        {`${selected() ? "❯" : " "}${"  ".repeat(depth)}${expandable() ? (open() ? "▾" : "▸") : " "} `}
      </text>
      {/* Shrinkable so wrapped text stays left of the scrollbar column. */}
      <box flexGrow={1} flexShrink={1} minWidth={0} flexDirection="column">
        {content()}
      </box>
    </box>
  );
}

function DetailsRow(props: RowProps): JSX.Element {
  const { id, depth } = props.row;
  const item = createMemo(() => (props.version(), props.timeline.find(id)));
  const content = createMemo(() => {
    const current = item();
    return current?.renderDetails ? untrack(() => current.renderDetails!()) : null;
  });
  return (
    <box id={`${id}::details`} flexDirection="row" flexShrink={0} backgroundColor={EXPANDED_BACKGROUND}>
      {/* As wide as an item row's gutter, so details align with the item's content. */}
      <text flexShrink={0}>{` ${"  ".repeat(depth)}  `}</text>
      <box flexGrow={1} flexShrink={1} minWidth={0} flexDirection="column">
        {content()}
      </box>
    </box>
  );
}

/**
 * The agent's history as a tree of selectable items. Only visible items are
 * drawn, one row box each, so a row's id finds its item for scrolling. The
 * scrollbox keeps the full screen; spacers as tall as the top status line and
 * the bottom overlays let the first and last items scroll clear of them. The
 * vertical scrollbar stops at the overlay's top edge and its thumb is sized to
 * the rows left visible, so it is never painted under the editor.
 */
export function TimelineView(props: TimelineViewProps): JSX.Element {
  const version = useVersion(props.timeline);
  // Rows keep their identity while their place in the tree is unchanged, so
  // <For> keeps their renderables.
  let rowCache = new Map<string, Row>();
  const rows = createMemo(() => {
    version();
    const next = new Map<string, Row>();
    const result = rowsOf(props.timeline).map((row) => {
      const key = `${row.type}:${row.id}:${row.depth}:${row.gap}:${row.shaded}`;
      const kept = rowCache.get(key) ?? row;
      next.set(key, kept);
      return kept;
    });
    rowCache = next;
    return result;
  });
  const focused = () => Boolean(props.focused);
  let scrollbox: ScrollBoxRenderable | undefined;

  createEffect(() => {
    if (scrollbox) {
      scrollbox.verticalScrollBar.marginBottom = props.overlayHeight;
      scrollbox.verticalScrollBar.marginTop = props.topInset ?? 0;
    }
  });

  return (
    <scrollbox
      id="timeline-scrollbox"
      ref={(element) => {
        scrollbox = element;
        // The scrollbox updates first in its subtree each frame, after layout:
        // sync the bar to the computed sizes so its clamp uses this frame's
        // range, then let the actions place the content.
        // OpenTUI 0.6.0 calls the protected `onUpdate` through its native scene
        // update hook with current layout; fail here if that hook goes.
        const hooked = element as unknown as { onUpdate?: (deltaTime: number) => void };
        if (typeof hooked.onUpdate !== "function") throw new Error("OpenTUI's ScrollBoxRenderable no longer has onUpdate; the timeline cannot anchor its scrolling");
        const update = hooked.onUpdate.bind(element);
        const layout = layoutScrollBox(element);
        hooked.onUpdate = (deltaTime) => {
          update(deltaTime);
          element.verticalScrollBar.scrollSize = layout.scrollHeight;
          element.verticalScrollBar.viewportSize = layout.height;
          props.onFrame?.();
        };
        props.scrollRef?.(layout);
      }}
      flexGrow={1}
      paddingX={1}
      renderBefore={function (this: ScrollBoxRenderable) {
        // The native bar resets its thumb to the full viewport on resize, so
        // re-apply the visible height after layout and before the bar paints.
        this.verticalScrollBar.slider.viewPortSize = Math.max(1, this.viewport.height - props.overlayHeight - (props.topInset ?? 0));
      }}
    >
      {(props.topInset ?? 0) > 0 ? <box id="timeline-top-spacer" height={props.topInset} flexShrink={0} /> : null}
      <For each={rows()}>
        {(row) => row.type === "item"
          ? <ItemRow row={row} timeline={props.timeline} version={version} focused={focused} />
          : <DetailsRow row={row} timeline={props.timeline} version={version} />}
      </For>
      <For each={props.queued?.steering ?? []}>
        {(text) => <text fg={palette.warning} paddingX={2} flexShrink={0}>{`steering: ${text}`}</text>}
      </For>
      <For each={props.queued?.followUp ?? []}>
        {(text) => <text fg={palette.dim} paddingX={2} flexShrink={0}>{`queued: ${text}`}</text>}
      </For>
      {props.overlayHeight + (props.slack ?? 0) > 0 ? (
        <box id="timeline-spacer" height={props.overlayHeight + (props.slack ?? 0)} flexShrink={0} />
      ) : null}
    </scrollbox>
  );
}
