/**
 * The screen's own state that needs no terminal: focus among the regions, and
 * the timeline as a tree of items with its cursor and disclosure. The items
 * come from the runtime; the cursor and disclosure are this screen's alone.
 * Nothing here imports OpenTUI, Solid, or a terminal.
 */

import { type Region, REGIONS } from "../../protocol/keys";

export type RegionId = Region;

function notify(listeners: ReadonlySet<() => void>): void {
  for (const listener of listeners) {
    listener();
  }
}

/** Shared listener plumbing; controllers expose `subscribe` and call `changed`. */
export class Emitter {
  readonly #listeners = new Set<() => void>();

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  protected changed(): void {
    notify(this.#listeners);
  }
}

// ---------------------------------------------------------------------------
// Regions and focus
// ---------------------------------------------------------------------------

/**
 * The only source of focus truth. A region that is unavailable, such as the
 * stage while it shows nothing, cannot take focus, and losing availability
 * moves focus to the editor, or else to the first available region.
 */
export class RegionController extends Emitter {
  readonly #available = new Map<RegionId, boolean>(REGIONS.map((region) => [region, true]));
  #focused: RegionId = "editor";

  current(): RegionId {
    return this.#focused;
  }

  /** Focus an available region; an unavailable one leaves focus alone. */
  requestFocus(region: RegionId): boolean {
    if (!this.#available.get(region)) return false;
    if (this.#focused !== region) {
      this.#focused = region;
      this.changed();
    }
    return true;
  }

  isAvailable(region: RegionId): boolean {
    return this.#available.get(region) ?? false;
  }

  /** Toggle availability; if the focused region becomes unavailable, move it. */
  setAvailable(region: RegionId, available: boolean): void {
    if (this.#available.get(region) === available) return;
    this.#available.set(region, available);
    if (!available && this.#focused === region)
      this.#focused = this.#available.get("editor")
        ? "editor"
        : (REGIONS.find((candidate) => this.#available.get(candidate)) ?? region);
    this.changed();
  }
}

// ---------------------------------------------------------------------------
// Structured timeline
// ---------------------------------------------------------------------------

interface TimelineItemInput<T, Render = unknown> {
  id: string;
  version: number;
  type: ItemType<T, Render>;
  value: T;
  /**
   * The item this one is a selectable part of. A child is shown, and can be
   * selected, only while every ancestor is expanded; it must come after its
   * parent in the timeline's order.
   */
  parentId?: string;
}

export interface ItemType<T, Render = unknown> {
  kind: string;
  /**
   * The item's own rows: what it shows collapsed, or its header when expanded.
   * It reads `props` lazily, inside JSX, so the view keeps an item's
   * renderables while its value changes, as a streamed reply does.
   */
  render: (props: ItemRenderProps<T>) => Render;
  /** Expanded content drawn after the item's selectable children. */
  renderDetails?: (props: ItemRenderProps<T>) => Render;
  /**
   * Whether the value has more to show expanded. Selectable children make an
   * item expandable regardless, so this answers only for the value's content.
   */
  expandable?: (value: T) => boolean;
  /** What the copy action writes; undefined when the item holds no original text. */
  sourceText: (value: T) => string | undefined;
  /**
   * The color of the item's mark in the timeline's gutter, for its kind or,
   * for work with an outcome, that outcome. The view chooses one when it is
   * omitted.
   */
  marker?: (value: T) => string | undefined;
}

interface ItemRenderProps<T> {
  value: T;
  id: string;
  version: number;
  expanded: boolean;
}

/**
 * The stored form of a timeline item: its typed render and source are
 * captured in closures so `T` stays internal and never leaks as `any`.
 */
export interface TimelineItem<Render = unknown> {
  readonly id: string;
  readonly version: number;
  readonly kind: string;
  readonly parentId: string | undefined;
  /** The definition and value, which the view renders reactively. */
  readonly type: ItemType<unknown, Render>;
  readonly value: unknown;
  /** Whether the value itself has more to show; see `ItemType.expandable`. */
  readonly expandable: boolean;
  /** Present only when the type draws expanded content after the children. */
  readonly renderDetails: (() => Render) | undefined;
  sourceText(): string | undefined;
  /** See `ItemType.marker`. */
  readonly marker: string | undefined;
}

export function materializeItem<T, Render>(
  input: TimelineItemInput<T, Render>,
): TimelineItem<Render> {
  const { id, version, type, value } = input;
  const renderDetails = type.renderDetails;
  let expandable: boolean | undefined;
  return {
    id,
    version,
    kind: type.kind,
    type: type as unknown as ItemType<unknown, Render>,
    value,
    parentId: input.parentId,
    // Asked only of visible items, once per value.
    get expandable() {
      return (expandable ??= type.expandable?.(value) ?? false);
    },
    renderDetails: renderDetails
      ? () => renderDetails({ value, id, version, expanded: true })
      : undefined,
    sourceText: () => type.sourceText(value),
    get marker() {
      return type.marker?.(value);
    },
  };
}

/**
 * Timeline items as a tree in reading order. `replace` reconciles a whole
 * history, keeping items by id, and moves the cursor to the nearest surviving ancestor or neighbour.
 *
 * Disclosure is held here, by item id, for as long as the registry lives; it is
 * never persisted. Only items whose ancestors are all expanded are visible, and the
 * cursor only ever rests on a visible item.
 */
export class TimelineTree<Render = unknown> extends Emitter {
  readonly #items: TimelineItem<Render>[] = [];
  readonly #indexById = new Map<string, number>();
  readonly #expanded = new Map<string, boolean>();
  #children: Map<string, string[]> | undefined;
  #cursor: string | undefined;
  #revision = 0;

  /**
   * Counts every change except a cursor move, so a view can tell when its
   * rows may differ and skip that work while the cursor alone moves. A move
   * notifies through `super.changed()`, past the count.
   */
  revision(): number {
    return this.#revision;
  }

  protected override changed(): void {
    this.#revision++;
    super.changed();
  }

  /**
   * Replace all items. A cursor that no longer exists moves to its nearest
   * surviving ancestor, then to the item before or after its old index.
   */
  replace(items: readonly TimelineItem<Render>[]): void {
    const previousIndex =
      this.#cursor === undefined ? undefined : this.#indexById.get(this.#cursor);
    const previousAncestors = this.#cursor === undefined ? [] : this.#ancestors(this.#cursor);
    this.#items.length = 0;
    this.#indexById.clear();
    for (const item of items) {
      this.#indexById.set(item.id, this.#items.length);
      this.#items.push(item);
    }
    this.#children = undefined;
    if (this.#cursor !== undefined && !this.#indexById.has(this.#cursor)) {
      const ancestor = previousAncestors.find((id) => this.#indexById.has(id));
      if (ancestor !== undefined) {
        this.#cursor = ancestor;
      } else if (previousIndex !== undefined) {
        // Fall back to the exact prior index: previous item, then next, then no cursor.
        const previous = previousIndex > 0 ? items[previousIndex - 1] : undefined;
        const next = items[previousIndex];
        this.#cursor = previous?.id ?? next?.id;
      }
    }
    this.#normalizeCursor(previousIndex);
    this.changed();
  }

  /** Replace values without rebuilding an unchanged tree or moving its cursor. */
  update(items: readonly TimelineItem<Render>[]): void {
    if (!items.length) return;
    for (const item of items) {
      const index = this.#indexById.get(item.id);
      if (index === undefined) throw new Error(`unknown timeline item: ${item.id}`);
      this.#items[index] = item;
    }
    this.changed();
  }

  items(): readonly TimelineItem<Render>[] {
    return this.#items;
  }

  /** Items whose ancestors are all expanded, in reading order. */
  visibleItems(): readonly TimelineItem<Render>[] {
    const visible = new Set<string>();
    const result: TimelineItem<Render>[] = [];
    for (const item of this.#items) {
      const parent = item.parentId;
      if (parent !== undefined && !(visible.has(parent) && this.isExpanded(parent))) {
        continue;
      }
      visible.add(item.id);
      result.push(item);
    }
    return result;
  }

  find(id: string): TimelineItem<Render> | undefined {
    const index = this.#indexById.get(id);
    return index === undefined ? undefined : this.#items[index];
  }

  children(id: string): readonly string[] {
    return this.#childMap().get(id) ?? [];
  }

  /** Ancestor ids, nearest first. */
  ancestors(id: string): readonly string[] {
    return this.#ancestors(id);
  }

  isExpandable(id: string): boolean {
    const item = this.find(id);
    return item !== undefined && (item.expandable || this.children(id).length > 0);
  }

  isExpanded(id: string): boolean {
    return this.#expanded.get(id) ?? false;
  }

  isVisible(id: string): boolean {
    if (!this.#indexById.has(id)) {
      return false;
    }
    return this.#ancestors(id).every((ancestor) => this.isExpanded(ancestor));
  }

  /**
   * Whether the cursor may rest on a visible item. An expanded item whose
   * children show is not selectable: its children are,
   * and collapsing returns the cursor to it.
   */
  isSelectable(id: string): boolean {
    return this.isVisible(id) && !(this.isExpanded(id) && this.children(id).length > 0);
  }

  /** Visible items the cursor may rest on, in reading order. */
  selectableItems(): readonly TimelineItem<Render>[] {
    return this.visibleItems().filter((item) => this.isSelectable(item.id));
  }

  cursor(): string | undefined {
    return this.#cursor;
  }

  currentItem(): TimelineItem<Render> | undefined {
    return this.#cursor === undefined ? undefined : this.find(this.#cursor);
  }

  /** Select a selectable item; any other leaves the cursor alone. */
  setCursor(id: string): boolean {
    if (!this.isSelectable(id)) {
      return false;
    }
    if (this.#cursor !== id) {
      this.#cursor = id;
      super.changed();
    }
    return true;
  }

  /** Move the cursor by `delta` selectable items, clamped; choose an end if unset. */
  moveCursor(delta: number): void {
    const visible = this.selectableItems();
    if (visible.length === 0) {
      return;
    }
    const current =
      this.#cursor === undefined ? -1 : visible.findIndex((item) => item.id === this.#cursor);
    const base = current === -1 ? (delta < 0 ? visible.length : -1) : current;
    const next = Math.max(0, Math.min(visible.length - 1, base + delta));
    const id = visible[next]?.id;
    if (id !== undefined && id !== this.#cursor) {
      this.#cursor = id;
      super.changed();
    }
  }

  /**
   * Expand or collapse the cursor item. Returns the item whose disclosure
   * changed, or undefined when the item has nothing to disclose.
   */
  toggle(): string | undefined {
    const id = this.#cursor;
    if (id === undefined || !this.isExpandable(id)) {
      return undefined;
    }
    this.#setExpanded(id, !this.isExpanded(id));
    return id;
  }

  /** Expand the cursor item; expanding an expanded item changes nothing. */
  expand(): string | undefined {
    const id = this.#cursor;
    if (id === undefined || !this.isExpandable(id) || this.isExpanded(id)) {
      return undefined;
    }
    this.#setExpanded(id, true);
    return id;
  }

  /**
   * Collapse the cursor item when it is expanded; otherwise collapse its
   * nearest expanded ancestor and select it, in the same step. Returns the
   * collapsed item, or undefined when there was none.
   */
  collapse(): string | undefined {
    const target = this.collapseTarget();
    if (target === undefined) {
      return undefined;
    }
    this.#cursor = target;
    this.#setExpanded(target, false);
    return target;
  }

  /** The item `collapse` would collapse, without collapsing it. */
  collapseTarget(): string | undefined {
    const id = this.#cursor;
    if (id === undefined) {
      return undefined;
    }
    if (this.isExpandable(id) && this.isExpanded(id)) {
      return id;
    }
    return this.#ancestors(id).find((candidate) => this.isExpanded(candidate));
  }

  #setExpanded(id: string, expanded: boolean): void {
    this.#expanded.set(id, expanded);
    this.#normalizeCursor(undefined);
    this.changed();
  }

  #childMap(): Map<string, string[]> {
    if (!this.#children) {
      const children = new Map<string, string[]>();
      for (const item of this.#items) {
        if (item.parentId === undefined) continue;
        const list = children.get(item.parentId);
        if (list) list.push(item.id);
        else children.set(item.parentId, [item.id]);
      }
      this.#children = children;
    }
    return this.#children;
  }

  #ancestors(id: string): string[] {
    const ancestors: string[] = [];
    const seen = new Set([id]);
    let parent = this.find(id)?.parentId;
    while (parent !== undefined && !seen.has(parent)) {
      ancestors.push(parent);
      seen.add(parent);
      parent = this.find(parent)?.parentId;
    }
    return ancestors;
  }

  /**
   * Keep the cursor on a selectable item: a hidden cursor moves to its nearest
   * visible ancestor, and an expanded one to the first selectable item it
   * shows; with no cursor, the first selectable item takes it.
   */
  #normalizeCursor(previousIndex: number | undefined): void {
    if (this.#cursor !== undefined && this.#indexById.has(this.#cursor)) {
      if (!this.isVisible(this.#cursor)) {
        const ancestors = this.#ancestors(this.#cursor);
        this.#cursor =
          ancestors.find((ancestor) => this.isVisible(ancestor)) ??
          ancestors.findLast((ancestor) => this.#indexById.has(ancestor));
      }
      if (
        this.#cursor !== undefined &&
        this.isVisible(this.#cursor) &&
        !this.isSelectable(this.#cursor)
      ) {
        // An expanded item shows its children right after it, so the next selectable item is inside it.
        const visible = this.visibleItems();
        const at = visible.findIndex((item) => item.id === this.#cursor);
        this.#cursor = visible.slice(at + 1).find((item) => this.isSelectable(item.id))?.id;
      }
      return;
    }
    if (this.#cursor === undefined && previousIndex === undefined) {
      this.#cursor = this.selectableItems()[0]?.id;
    } else if (this.#cursor !== undefined) {
      this.#cursor = undefined;
    }
  }
}
