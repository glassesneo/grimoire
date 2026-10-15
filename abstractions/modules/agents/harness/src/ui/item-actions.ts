/**
 * Cursor movement, disclosure, scrolling, and clipboard for the structured
 * timeline. The service never touches focus: the screen owns the focused
 * region and calls these actions, so `j`/`k` scroll the scrollbox that the
 * view exposes while the screen keeps the native focus.
 *
 * The viewport is in one of three states. Following keeps the end of the
 * history in view. Explicit navigation animates the selected item's first
 * line to the middle of the usable rows; a new move first finishes the
 * scroll still in flight, so held keys keep the view at most one step behind.
 * Otherwise one item is anchored: its first line stays on its screen row
 * while content above or inside it changes height, which is what keeps
 * disclosure, late image and Markdown layout, and streaming from moving what
 * the reader is looking at. Manual scrolling never recenters the selection;
 * scrolling to the real end resumes following.
 */
import {
  type HostClipboardService,
  type RendererClipboardBoundary,
  type Timeline,
  createHostClipboard,
  createRendererClipboardAdapter,
  createTimeline,
  engine,
} from "@opentui/core";
import type { NoticeLevel } from "../core/session-entries";
import type { ItemTypeRegistry } from "./controllers";

export const ITEM_SCROLL_DURATION_MS = 120;

export type ItemScrollKind = "page-down" | "page-up" | "half-down" | "half-up";

/** The part of a ScrollBoxRenderable the actions need. */
export interface ItemRow {
  readonly y: number;
  readonly height: number;
}

export interface TimelineScrollBox {
  scrollTop: number;
  readonly scrollHeight: number;
  readonly height: number;
  readonly y: number;
  getRenderable(id: string): ItemRow | undefined;
}

export interface ClipboardWriter {
  /** True when a backend accepted the text; false when none could. */
  writeText(text: string): Promise<boolean>;
  dispose(): Promise<void>;
}

export interface ItemActions<Render = unknown> {
  /** Move the cursor among visible items and center its first line in the usable rows. */
  move(delta: number): void;
  /** Put an off-screen cursor on the last visible item, as when the timeline gains focus. */
  reveal(): void;
  /** Page or half-page scroll, interpolated over the configured duration. */
  scroll(kind: ItemScrollKind): void;
  /** Expand or collapse the cursor item, keeping its first line in place. */
  toggle(): void;
  /** Expand the cursor item; an expanded or non-expandable item is left alone. */
  expand(): void;
  /** Collapse the cursor item, or else its nearest expanded ancestor, which becomes selected. */
  collapse(): void;
  /** Follow the latest output again, as when a prompt is accepted. */
  follow(): void;
  following(): boolean;
  /** Apply following or anchoring to the laid-out rows; the view calls it every frame. */
  frame(): void;
  /** Copy the cursor item's `sourceText()` to the clipboard. */
  copy(): Promise<boolean>;
  dispose(): Promise<void>;
}

export interface ItemActionsOptions<Render = unknown> {
  timeline: ItemTypeRegistry<Render>;
  scrollbox: () => TimelineScrollBox | undefined;
  /** Rows the editor, stage, and indicator cover over the scrollbox's bottom edge. */
  overlayHeight: () => number;
  /** Rows the top status line covers over the scrollbox's top edge. */
  topInset?: () => number;
  /** Blank rows to keep after the history so an anchored item need not move; see `frame`. */
  onSlackChange?: (rows: number) => void;
  /** Overrides the native clipboard; used by tests and non-terminal hosts. */
  clipboard?: ClipboardWriter;
  /** The renderer whose OSC52 API is the clipboard fallback. */
  renderer?: RendererClipboardBoundary;
  notify?: (level: NoticeLevel, text: string) => void;
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

/**
 * The real clipboard: the host service first, and the renderer's OSC52 when the
 * host has no native backend. "Attempted" OSC52 counts because the terminal
 * cannot confirm delivery; only both failing is a failure.
 */
export function createNativeClipboard(renderer: RendererClipboardBoundary): ClipboardWriter {
  let host: HostClipboardService | undefined;
  try {
    host = createHostClipboard();
  } catch {
    host = undefined;
  }
  const terminal = createRendererClipboardAdapter(renderer);
  return {
    async writeText(text: string): Promise<boolean> {
      if (host) {
        try {
          if ((await host.writeText(text, { selection: "clipboard" })).status === "written")
            return true;
        } catch {
          /* The terminal backend is still available after host failure. */
        }
      }
      return terminal.writeText(text, "clipboard").status === "attempted";
    },
    async dispose(): Promise<void> {
      await host?.dispose();
    },
  };
}

/**
 * Interpolates scrollTop toward a target with the native Timeline, which the
 * TimelineEngine drives on the renderer's own clock. The duration is fixed so
 * the design's 120 ms motion is the only behavior production can show.
 */
class SmoothScroll {
  readonly #scrollbox: () => TimelineScrollBox | undefined;
  readonly #onStep: () => void;
  #timeline: Timeline | undefined;
  #target: number | undefined;

  constructor(scrollbox: () => TimelineScrollBox | undefined, onStep: () => void) {
    this.#scrollbox = scrollbox;
    this.#onStep = onStep;
  }

  /** The in-flight destination, so a repeated input keeps adding to it. */
  target(): number | undefined {
    return this.#timeline ? this.#target : undefined;
  }

  animating(): boolean {
    return this.#timeline !== undefined;
  }

  /**
   * Animate to `value`, clamped; `onSettle` runs once the position is reached.
   * A scroll still in flight is finished at its destination first: restarting
   * from wherever it had got to would, with input faster than frames such as
   * a held key, leave no frame to move in, and the view would stand still
   * until the input stopped.
   */
  scrollTo(value: number, onSettle?: () => void): void {
    const box = this.#scrollbox();
    if (!box) {
      return;
    }
    if (this.#timeline && this.#target !== undefined) box.scrollTop = this.#target;
    this.stop();
    const max = Math.max(0, box.scrollHeight - box.height);
    this.#target = Math.max(0, Math.min(max, value));
    const from = box.scrollTop;
    if (from === this.#target) {
      this.#onStep();
      onSettle?.();
      return;
    }
    const state = { top: from };
    let timeline!: Timeline;
    timeline = createTimeline({
      duration: ITEM_SCROLL_DURATION_MS,
      onComplete: () => {
        engine.unregister(timeline);
        if (this.#timeline === timeline) {
          this.#timeline = undefined;
          // The animation is over, so a manual scroll becomes the next base.
          this.#target = undefined;
          onSettle?.();
        }
      },
    });
    timeline.add(state, {
      top: this.#target,
      duration: ITEM_SCROLL_DURATION_MS,
      ease: "outQuad",
      onUpdate: () => {
        const current = this.#scrollbox();
        if (current) {
          current.scrollTop = Math.round(state.top);
          this.#onStep();
        }
      },
    });
    this.#timeline = timeline;
  }

  stop(): void {
    if (this.#timeline) {
      engine.unregister(this.#timeline);
      this.#timeline = undefined;
    }
  }
}

export function createItemActions<Render>(
  options: ItemActionsOptions<Render>,
): ItemActions<Render> {
  const { timeline, scrollbox, overlayHeight } = options;
  const topInset = options.topInset ?? (() => 0);
  const notify = options.notify;
  const clipboard =
    options.clipboard ?? (options.renderer ? createNativeClipboard(options.renderer) : undefined);

  let follow = true;
  let anchor: { id: string; offset: number } | undefined;
  let slack = 0;
  /** The scroll position the actions last left, to notice scrolling they did not do. */
  let expected: number | undefined;

  const setSlack = (rows: number) => {
    if (rows === slack) return;
    slack = rows;
    options.onSlackChange?.(rows);
  };

  const usableRows = (box: TimelineScrollBox): number =>
    Math.max(1, box.height - Math.max(0, topInset()) - Math.max(0, overlayHeight()));
  /** The last scroll position with real content, not counting slack. */
  const contentEnd = (box: TimelineScrollBox): number =>
    Math.max(0, box.scrollHeight - slack - box.height);
  const clamp = (box: TimelineScrollBox, value: number): number =>
    Math.max(0, Math.min(contentEnd(box), value));
  // Renderable coordinates include the current scroll translation.
  const rowTop = (box: TimelineScrollBox, row: ItemRow): number => row.y - box.y + box.scrollTop;
  /** The position that puts a row's first line in the middle of the usable rows. */
  const centered = (box: TimelineScrollBox, top: number): number =>
    clamp(box, top - topInset() - Math.floor((usableRows(box) - 1) / 2));
  const headerVisible = (box: TimelineScrollBox, top: number): boolean =>
    top >= box.scrollTop + topInset() && top < box.scrollTop + topInset() + usableRows(box);

  /** The first visible item, held at its screen row while content above changes. */
  const anchorTopVisible = (box: TimelineScrollBox) => {
    const viewTop = box.scrollTop + topInset();
    for (const candidate of timeline.visibleItems()) {
      const row = box.getRenderable(candidate.id);
      if (!row) continue;
      const top = rowTop(box, row);
      if (top + row.height > viewTop) {
        anchor = { id: candidate.id, offset: top - box.scrollTop };
        return;
      }
    }
    anchor = undefined;
  };

  /** After the reader's own scrolling: keep reading in place, or follow again at the real end. */
  const settleManual = () => {
    const box = scrollbox();
    if (!box) return;
    if (box.scrollTop >= contentEnd(box)) {
      follow = true;
      anchor = undefined;
      setSlack(0);
    } else {
      anchorTopVisible(box);
    }
    expected = box.scrollTop;
  };

  const scroll = new SmoothScroll(scrollbox, () => {
    const box = scrollbox();
    expected = box?.scrollTop;
  });

  const pause = () => {
    follow = false;
    scroll.stop();
  };

  /** Center the cursor's first line, as explicit navigation does. */
  const centerCursor = () => {
    const box = scrollbox();
    const id = timeline.cursor();
    if (!box || id === undefined) return;
    const row = box.getRenderable(id);
    if (!row) return;
    anchor = undefined;
    setSlack(0);
    scroll.scrollTo(centered(box, rowTop(box, row)), () => {
      const current = scrollbox();
      const settled = current?.getRenderable(id);
      if (current && settled) anchor = { id, offset: rowTop(current, settled) - current.scrollTop };
    });
  };

  /**
   * Hold `target`'s first line where it is while `act` changes the items; an
   * off-screen target is first brought to the center, in the same step.
   */
  const disclose = (target: string | undefined, act: () => string | undefined, closing = false) => {
    if (target === undefined) return;
    pause();
    const box = scrollbox();
    const row = box?.getRenderable(target);
    if (box && row) {
      const top = rowTop(box, row);
      if (!headerVisible(box, top)) {
        setSlack(0);
        box.scrollTop = centered(box, top);
      }
      anchor = { id: target, offset: top - box.scrollTop };
      expected = box.scrollTop;
      // Closing can remove at most what the item shows below its own row. Add
      // the blank rows that keeps the scroll range from pulling the item up
      // now, so they are laid out in the same frame as the shrink.
      if (closing) {
        const inside = timeline
          .visibleItems()
          .filter((item) => timeline.ancestors(item.id).includes(target))
          .map((item) => item.id);
        const shown = [...inside, ...[target, ...inside].map((id) => `${id}::details`)].reduce(
          (sum, id) => sum + (box.getRenderable(id)?.height ?? 0),
          0,
        );
        const needed = box.scrollTop - (contentEnd(box) - shown);
        if (needed > slack) setSlack(needed);
      }
    }
    act();
  };

  return {
    move(delta: number): void {
      // The next centering takes over the scroll in flight; see `scrollTo`.
      follow = false;
      timeline.moveCursor(delta);
      centerCursor();
    },

    reveal(): void {
      const box = scrollbox();
      const id = timeline.cursor();
      const last = timeline.visibleItems().at(-1)?.id;
      if (!box || last === undefined) {
        return;
      }
      const row = id === undefined ? undefined : box.getRenderable(id);
      if (row) {
        const top = rowTop(box, row) - box.scrollTop;
        if (top + row.height > topInset() && top < topInset() + usableRows(box)) return;
      }
      pause();
      timeline.setCursor(last);
      centerCursor();
    },

    scroll(kind: ItemScrollKind): void {
      const box = scrollbox();
      if (!box) {
        return;
      }
      // Repeated input adds to the destination still in flight.
      const base = scroll.target() ?? box.scrollTop;
      pause();
      anchor = undefined;
      setSlack(0);
      const visible = usableRows(box);
      const amount =
        kind === "page-down" || kind === "page-up" ? visible : Math.max(1, Math.floor(visible / 2));
      scroll.scrollTo(
        base + (kind === "page-down" || kind === "half-down" ? amount : -amount),
        settleManual,
      );
    },

    toggle(): void {
      const id = timeline.cursor();
      disclose(
        id !== undefined && timeline.isExpandable(id) ? id : undefined,
        () => timeline.toggle(),
        id !== undefined && timeline.isExpanded(id),
      );
    },

    expand(): void {
      const id = timeline.cursor();
      disclose(
        id !== undefined && timeline.isExpandable(id) && !timeline.isExpanded(id) ? id : undefined,
        () => timeline.expand(),
      );
    },

    collapse(): void {
      disclose(timeline.collapseTarget(), () => timeline.collapse(), true);
    },

    follow(): void {
      scroll.stop();
      follow = true;
      anchor = undefined;
      setSlack(0);
    },

    following: () => follow,

    frame(): void {
      const box = scrollbox();
      if (!box || scroll.animating()) {
        return;
      }
      const limit = Math.max(0, box.scrollHeight - box.height);
      // Content that shrinks makes the scrollbox clamp its position; that is not the reader scrolling.
      const clamped = expected !== undefined && expected > limit && box.scrollTop === limit;
      if (expected !== undefined && box.scrollTop !== expected && !clamped) {
        // Scrolled by something else, such as the mouse wheel: that is reading too.
        follow = false;
        settleManual();
      }
      if (follow) {
        box.scrollTop = contentEnd(box);
      } else if (anchor) {
        const row = box.getRenderable(anchor.id);
        if (!row) {
          anchor = undefined;
        } else {
          const desired = Math.max(0, rowTop(box, row) - anchor.offset);
          // Blank rows at the end keep the scroll range from pulling the item up.
          const shortfall = desired - Math.max(0, box.scrollHeight - slack - box.height);
          if (shortfall > slack) setSlack(shortfall);
          box.scrollTop = desired;
        }
      }
      expected = box.scrollTop;
    },

    async copy(): Promise<boolean> {
      const item = timeline.currentItem();
      if (!item) {
        return false;
      }
      const text = item.sourceText();
      if (text === undefined) {
        notify?.("warning", "This item has no original text to copy");
        return false;
      }
      if (!clipboard) {
        notify?.("error", "Clipboard is unavailable");
        return false;
      }
      try {
        const copied = await clipboard.writeText(text);
        if (!copied) {
          notify?.("error", "Clipboard copy failed");
        }
        return copied;
      } catch (error) {
        notify?.("error", `Clipboard copy failed: ${asError(error).message}`);
        return false;
      }
    },

    dispose(): Promise<void> {
      scroll.stop();
      return clipboard?.dispose() ?? Promise.resolve();
    },
  };
}
