/**
 * The mirrored items in the screen's timeline store. Each item is shown with
 * the renderer its kind maps to in the state, `kind/variant` first; a kind
 * without a mapping, or mapped to a renderer this screen does not have, is
 * shown as its text. Item identity follows the model's ids, so the cursor
 * and disclosure survive every update.
 */
import type { JSX } from "solid-js";
import type { Applied, Mirror } from "../protocol/apply";
import type { Item, State } from "../protocol/wire";
import {
  type ItemType,
  type TimelineTree,
  materializeItem,
  type TimelineItem,
} from "./ui/controllers";

export class ItemProjector {
  readonly #cache = new Map<
    string,
    { version: number; renderer: string; item: TimelineItem<JSX.Element> }
  >();

  constructor(
    readonly tree: TimelineTree<JSX.Element>,
    readonly renderers: Readonly<Record<string, ItemType<Item, JSX.Element>>>,
  ) {}

  #renderer(state: State, item: Item): string {
    const mapped =
      (item.variant !== undefined ? state.kinds[`${item.kind}/${item.variant}`] : undefined) ??
      state.kinds[item.kind];
    return mapped && this.renderers[mapped] ? mapped : "text";
  }

  #materialize(state: State, item: Item): TimelineItem<JSX.Element> {
    const renderer = this.#renderer(state, item);
    const cached = this.#cache.get(item.id);
    if (cached && cached.version === item.version && cached.renderer === renderer)
      return cached.item;
    const materialized = materializeItem({
      id: item.id,
      version: item.version,
      type: this.renderers[renderer] as ItemType<unknown, JSX.Element>,
      value: item,
      parentId: item.parentId,
    });
    this.#cache.set(item.id, { version: item.version, renderer, item: materialized });
    return materialized;
  }

  /** Brings the store up to the mirror; `applied` undefined means a new snapshot. */
  sync(mirror: Mirror, applied: Applied | undefined): void {
    const state = mirror.state;
    if (!state) return;
    if (!applied || applied.order || applied.sections.has("kinds")) {
      const items = state.items.map((item) => this.#materialize(state, item));
      const live = new Set(state.items.map((item) => item.id));
      for (const id of this.#cache.keys()) if (!live.has(id)) this.#cache.delete(id);
      this.tree.replace(items);
      return;
    }
    if (applied.items.size === 0) return;
    const changed: TimelineItem<JSX.Element>[] = [];
    for (const id of applied.items) {
      const item = mirror.item(id);
      if (item) changed.push(this.#materialize(state, item));
    }
    this.tree.update(changed);
  }
}
