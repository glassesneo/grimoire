/**
 * The hub view's entries as timeline items, and a plain view of them. Items
 * keep the view's ids, so disclosure and the cursor survive every update; a
 * nested tool is a child of its parent tool. The harness's per-kind
 * presentation is not ported yet; one item type renders every entry as text.
 */
import type { ScrollBoxRenderable } from "@opentui/core";
import type { JSX } from "@opentui/solid";
import { For } from "solid-js";
import { type ItemType, type ItemTypeRegistry, materializeItem, type TimelineItem } from "./ui/controllers";
import { useVersion } from "./ui/state";
import { palette } from "./ui/style";
import type { Entry } from "./view";

export type ScrollAmount = "half-down" | "half-up" | "page-down" | "page-up";

export const entryType: ItemType<Entry, JSX.Element> = {
  kind: "pi-entry",
  render: (props) => (
    <box flexDirection="column">
      <text fg={props.value.kind === "user" ? palette.user : palette.accent}>{`${props.value.kind}${props.value.streaming ? " [streaming]" : ""}`}</text>
      <text fg={palette.text}>{entryText(props.value, props.expanded)}</text>
    </box>
  ),
  expandable: (value) => entryText(value, true) !== entryText(value, false),
  sourceText: (value) => entryText(value, true),
  actions: {},
};

/** Feeds the registry from the view; an entry is materialized again only when its version changes. */
export function timelineSync(registry: ItemTypeRegistry<JSX.Element>, type: ItemType<Entry, JSX.Element>) {
  const cache = new Map<string, TimelineItem<JSX.Element>>();
  return (entries: readonly Entry[]) => {
    const items = entries.map(entry => {
      const cached = cache.get(entry.id);
      if (cached && cached.version === entry.version) return cached;
      return materializeItem({ id: entry.id, version: entry.version, type, value: { ...entry }, parentId: entry.parentId ?? undefined });
    });
    cache.clear();
    for (const item of items) cache.set(item.id, item);
    registry.replace(items);
  };
}

export function TimelineView(props: {
  timeline: ItemTypeRegistry<JSX.Element>;
  focused: boolean;
  queued: string;
  /** Rows the screen's overlays cover at the top and bottom; the viewport stays clear of them. */
  topInset: number;
  overlayHeight: number;
  scrollRef(scroll: ScrollBoxRenderable): void;
}): JSX.Element {
  const version = useVersion(props.timeline);
  const items = () => (version(), props.timeline.visibleItems());
  const cursor = () => (version(), props.timeline.cursor());
  return (
    <scrollbox ref={props.scrollRef} flexGrow={1} minHeight={1} paddingTop={props.topInset} paddingBottom={props.overlayHeight} stickyScroll stickyStart="bottom">
      <For each={items()}>{item => {
        const selected = () => props.focused && cursor() === item.id;
        const depth = () => (version(), props.timeline.depth(item.id));
        const disclosure = () => (version(), props.timeline.isExpandable(item.id) ? (props.timeline.isExpanded(item.id) ? "▾ " : "▸ ") : "  ");
        return <box id={item.id} flexDirection="row" paddingLeft={1 + depth() * 2} paddingRight={1} paddingBottom={1} backgroundColor={selected() ? "#24273a" : undefined}>
          <text fg={palette.dim}>{`${selected() ? "▶" : " "}${disclosure()}`}</text>
          <box flexGrow={1} flexDirection="column">{(version(), item.render(props.timeline.isExpanded(item.id)))}</box>
        </box>;
      }}</For>
      {props.queued ? <text fg={palette.warning}>{props.queued}</text> : null}
    </scrollbox>
  );
}

/** Scrolls by half or a whole viewport, or brings the cursor item to the middle. */
export function scrollTimeline(scroll: ScrollBoxRenderable | undefined, amount: ScrollAmount | { reveal: string }) {
  if (!scroll) return;
  if (typeof amount === "object") {
    const row = scroll.getRenderable(amount.reveal);
    if (row) scroll.scrollTop = Math.max(0, row.y - scroll.y + scroll.scrollTop - Math.floor(scroll.height / 2));
    return;
  }
  const step = Math.max(1, amount.startsWith("half") ? Math.floor(scroll.height / 2) : scroll.height);
  scroll.scrollBy(amount.endsWith("down") ? step : -step, "absolute");
}

export function entryText(e: Entry, expanded: boolean): string {
  switch (e.kind) {
    case "user": return e.text + (e.images?.length ? `\n[${e.images.length} image attachments]` : "");
    case "assistant": return e.parts.map((p: any) => p.type === "thinking" ? (expanded ? `Thinking: ${p.withheld ? "[withheld]" : p.text}` : "[thinking — expand to read]") : p.text).join("\n") + (e.errorMessage ? `\n${e.errorMessage}` : "") + (["error", "aborted", "length"].includes(e.stopReason) ? `\n[${e.stopReason}]` : "");
    case "tool": return `${e.name} [${e.state}]` + (expanded ? `\n${e.args?.available ? JSON.stringify(e.args.value, null, 2) : "[arguments incomplete]"}\n${e.result ? textContent(e.result.content) : "[no result yet]"}` : "");
    case "compaction": return `Compaction [${e.state}]${expanded && e.summary ? `\n${e.summary}` : ""}${e.errorMessage ? `\n${e.errorMessage}` : ""}`;
    case "retry": return `Retry [${e.state}] ${e.errorMessage || e.finalError || ""}`;
    case "config": return `${e.setting}: ${e.from} → ${e.to}`;
    case "custom": return `${e.customType}: ${textContent(e.content)}`;
    case "notice": return `${e.level}: ${e.text}`;
    default: return JSON.stringify(e);
  }
}
const textContent = (c: any) => typeof c === "string" ? c : (c || []).map((b: any) => b.type === "text" ? b.text : "[image]").join("\n");

