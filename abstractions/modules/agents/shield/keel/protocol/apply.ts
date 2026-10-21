/**
 * Following the model's state from a snapshot and its events. The screen
 * keeps a mirror; it never interprets Pi. A mirror refuses an event that does
 * not continue its sequence, and then needs a new snapshot.
 */
import type { Changes, Item, Snapshot, State, StateEvent } from "./wire";

export class SequenceGap extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SequenceGap";
  }
}

export interface Applied {
  /** Item ids whose value changed or that are new. */
  items: Set<string>;
  /** Whether the order of items changed, including removals. */
  order: boolean;
  /** Other sections that were replaced. */
  sections: Set<Exclude<keyof Changes, "items" | "order">>;
}

export class Mirror {
  state: State | undefined;
  instance: string | undefined;
  seq = -1;
  #index = new Map<string, number>();

  reset(snapshot: Snapshot): void {
    this.state = structuredClone(snapshot.state);
    this.instance = snapshot.instance;
    this.seq = snapshot.seq;
    this.#reindex();
  }

  /** Applies the next event; anything else throws `SequenceGap` and leaves the mirror as it was. */
  apply(event: StateEvent): Applied {
    const state = this.state;
    if (!state) throw new SequenceGap("no snapshot");
    if (event.instance !== this.instance) throw new SequenceGap("model instance changed");
    if (event.seq !== this.seq + 1)
      throw new SequenceGap(`expected seq ${this.seq + 1}, got ${event.seq}`);
    const { items, order, ...sections } = event.changes;
    const applied: Applied = { items: new Set(), order: false, sections: new Set() };
    const upserts = new Map<string, Item>();
    for (const item of items ?? []) {
      upserts.set(item.id, item);
      applied.items.add(item.id);
    }
    if (order) {
      const previous = new Map(state.items.map((item) => [item.id, item]));
      state.items = order.map((id) => {
        const item = upserts.get(id) ?? previous.get(id);
        if (!item) throw new SequenceGap(`order names unknown item ${id}`);
        return item;
      });
      applied.order = true;
      this.#reindex();
    } else {
      for (const id of upserts.keys())
        if (!this.#index.has(id)) throw new SequenceGap(`new item ${id} without an order`);
      for (const [id, item] of upserts) state.items[this.#index.get(id)!] = item;
    }
    for (const [key, value] of Object.entries(sections)) {
      if (value === undefined) continue;
      (state as unknown as Record<string, unknown>)[key] = value;
      applied.sections.add(key as Exclude<keyof Changes, "items" | "order">);
    }
    this.seq = event.seq;
    return applied;
  }

  item(id: string): Item | undefined {
    const index = this.#index.get(id);
    return index === undefined ? undefined : this.state?.items[index];
  }

  #reindex(): void {
    this.#index = new Map((this.state?.items ?? []).map((item, index) => [item.id, index]));
  }
}
