/**
 * Terminal-independent UI controllers, copied from the harness: the region/focus
 * model, the type registries, the unresolved stage requests, and the structured timeline store.
 * Nothing here imports OpenTUI, Solid, or a terminal; the view layer renders
 * these controllers' snapshots and calls back into them.
 */

export type RegionId = string;

/** A registration handle; `dispose` removes exactly this registration's effect. */
export interface Registration {
  dispose(): void;
}

export type RegistrationCategory = "item" | "stage" | "statusline" | "action";

export class DuplicateRegistrationError extends Error {
  constructor(
    readonly category: RegistrationCategory,
    readonly registrationName: string,
  ) {
    super(`duplicate ${category} registration: ${registrationName}`);
    this.name = "DuplicateRegistrationError";
  }
}

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

export const DEFAULT_REGIONS: readonly RegionId[] = ["timeline", "stage", "editor"];
export const EDITOR_REGION: RegionId = "editor";

interface RegionState {
  id: RegionId;
  available: boolean;
  fallback: RegionId | undefined;
}

export interface RegionControllerOptions {
  regions?: readonly RegionId[];
  fallback?: RegionId;
}

/**
 * The only source of focus truth. Regions are held in an array and looked up by
 * id, so the set is variable and no consumer encodes the three names as a union
 * or three booleans. `stage` becomes unavailable while it is empty, which
 * is what makes a focus request to an empty stage fail.
 */
export class RegionController extends Emitter {
  readonly #regions: RegionState[] = [];
  #focused: RegionId;
  readonly #fallback: RegionId;

  constructor(options: RegionControllerOptions = {}) {
    super();
    this.#fallback = options.fallback ?? EDITOR_REGION;
    for (const id of options.regions ?? DEFAULT_REGIONS) {
      this.#regions.push({ id, available: true, fallback: undefined });
    }
    const known = this.#regions.map((region) => region.id);
    this.#focused = known.includes(this.#fallback)
      ? this.#fallback
      : (known[0] ?? this.#fallback);
  }

  current(): RegionId {
    return this.#focused;
  }

  /** Focus an existing, available region; an unavailable region leaves focus alone. */
  requestFocus(region: RegionId): boolean {
    const target = this.#regions.find((candidate) => candidate.id === region);
    if (!target || !target.available) {
      return false;
    }
    if (this.#focused !== region) {
      this.#focused = region;
      this.changed();
    }
    return true;
  }

  isAvailable(region: RegionId): boolean {
    return this.#regions.find((candidate) => candidate.id === region)?.available ?? false;
  }

  /** Toggle availability; if the focused region becomes unavailable, move it. */
  setAvailable(region: RegionId, available: boolean): void {
    const target = this.#regions.find((candidate) => candidate.id === region);
    if (!target || target.available === available) {
      return;
    }
    target.available = available;
    if (!available && this.#focused === region) {
      this.#focused = this.#fallbackFor(region);
    }
    this.changed();
  }

  list(): readonly RegionId[] {
    return this.#regions.map((region) => region.id);
  }

  /** Register an additional region. Not exposed through `HarnessUI`. */
  register(region: RegionId, options: { fallback?: RegionId; available?: boolean } = {}): Registration {
    if (this.#regions.some((candidate) => candidate.id === region)) {
      throw new Error(`region already registered: ${region}`);
    }
    const state: RegionState = {
      id: region,
      available: options.available ?? true,
      fallback: options.fallback,
    };
    this.#regions.push(state);
    this.changed();
    let disposed = false;
    return {
      dispose: () => {
        if (disposed) {
          return;
        }
        disposed = true;
        // Match by identity so a stale handle cannot remove a re-registration.
        const index = this.#regions.indexOf(state);
        if (index === -1) {
          return;
        }
        this.#regions.splice(index, 1);
        if (this.#focused === region) {
          this.#focused = this.#resolveFallback(region, state.fallback);
        }
        this.changed();
      },
    };
  }

  #fallbackFor(region: RegionId): RegionId {
    const explicit = this.#regions.find((candidate) => candidate.id === region)?.fallback;
    return this.#resolveFallback(region, explicit);
  }

  #resolveFallback(region: RegionId, explicit: RegionId | undefined): RegionId {
    for (const candidate of [explicit, this.#fallback]) {
      if (
        candidate &&
        candidate !== region &&
        this.#regions.some((state) => state.id === candidate && state.available)
      ) {
        return candidate;
      }
    }
    return this.#regions.find((state) => state.available)?.id ?? this.#focused;
  }
}

// ---------------------------------------------------------------------------
// Stage requests
// ---------------------------------------------------------------------------

export interface StageContentType<T, Render = unknown> {
  kind: string;
  render(props: StageRenderProps<T, Render>): Render;
  /** Resolved value when the request is cancelled or its signal aborts. */
  defaultValue: T;
  actions?: Record<string, StageAction<T>>;
  /**
   * Checks a value that arrives from outside the harness. A type without it is
   * not reachable through the extension client.
   */
  validate?(value: unknown): value is T;
  acceptsText?(value: T): boolean;
}

export interface StageRenderProps<T, Render = unknown> {
  value: T;
  handle: StageHandle<T>;
  preferredHeight: number;
  focused: boolean;
}

export interface StageAction<T> {
  (event: StageActionEvent<T>): void | Promise<void>;
}

export interface StageActionEvent<T> {
  value: T;
  handle: StageHandle<T>;
  focused: boolean;
}

export interface StageRequest<T, Render = unknown> {
  requester: string;
  type: StageContentType<T, Render>;
  value: T;
  preferredHeight: number;
  onPromptSubmitted?(event: { text: string; handle: StageHandle }): void | Promise<void>;
  signal?: AbortSignal;
}

export type StageResult<T> =
  | { status: "closed"; value: T }
  | { status: "cancelled"; value: T; reason?: string };

export interface StageHandle<T = unknown> {
  readonly id: string;
  readonly requester: string;
  value(): T;
  update(value: T): void;
  /** Complete normally with a chosen value, defaulting to the current one. */
  close(value?: T): void;
  /** Complete with the type's default value and an optional diagnostic reason. */
  cancel(reason?: string): void;
  readonly closed: Promise<StageResult<T>>;
}

/** The active stage request in the store's erased form, for a view to render. */
export interface StageEntry<Render = unknown> {
  readonly id: string;
  readonly requester: string;
  readonly kind: string;
  readonly preferredHeight: number;
  readonly focused: boolean;
  render(track?: () => void): Render;
  readonly actions: readonly string[];
  readonly acceptsText: boolean;
  runAction(name: string): void | Promise<void>;
}

interface PendingStage<Render> {
  id: string;
  requester: string;
  kind: string;
  preferredHeight: number;
  actions: readonly string[];
  render: (track?: () => void) => Render;
  runAction: (name: string) => void | Promise<void>;
  onPromptSubmitted?: (event: { text: string; handle: StageHandle }) => void | Promise<void>;
  signal?: AbortSignal;
  onAbort?: () => void;
  resolve: (result: StageResult<unknown>) => void;
  handle: StageHandle<unknown>;
  settled: boolean;
  acceptsText(): boolean;
  returnFocus: RegionId | undefined;
}

export interface StageControllerOptions {
  regions: RegionController;
  region?: RegionId;
  /** Guards automatic focus claims; explicit `requestFocus` bypasses this. */
  canFocus?: () => boolean;
}

/** Arrival order, foreground selection and focus exceptions have one owner. */
const stageRequestPolicy = {
  arrival: <R>(pending: readonly PendingStage<R>[], foregroundId: string | undefined, next: PendingStage<R>) =>
    next.kind === "command" ? next.id : foregroundId ?? pending[0]?.id,
  successor: <R>(pending: readonly PendingStage<R>[]) => pending[0],
  restore: <R>(pending: PendingStage<R>, wasActive: boolean) => pending.kind === "command" || wasActive,
  claim: <R>(pending: PendingStage<R>, explicit: boolean, canFocus: boolean, suppress: boolean) =>
    explicit || (!suppress && pending.returnFocus === undefined && canFocus),
};

/** Unresolved requests retain their state; only the foreground receives input. */
export class StageController<Render = unknown> extends Emitter {
  readonly #regions: RegionController;
  readonly #region: RegionId;
  readonly #canFocus: () => boolean;
  readonly #kinds = new Map<string, { token: object; type: StageContentType<unknown, Render> }>();
  readonly #pending: PendingStage<Render>[] = [];
  #foregroundId: string | undefined;
  #assistAvailable = false;
  #suppressSuccessorFocus = false;
  #nextId = 0;

  constructor(options: StageControllerOptions) {
    super();
    this.#regions = options.regions;
    this.#region = options.region ?? "stage";
    this.#canFocus = options.canFocus ?? (() => true);
    this.#syncAvailability();
  }

  registerType<T>(type: StageContentType<T, Render>): Registration {
    if (this.#kinds.has(type.kind)) {
      throw new DuplicateRegistrationError("stage", type.kind);
    }
    const token = {};
    this.#kinds.set(type.kind, { token, type: type as unknown as StageContentType<unknown, Render> });
    this.changed();
    return {
      dispose: () => {
        if (this.#kinds.get(type.kind)?.token !== token) {
          return;
        }
        this.#kinds.delete(type.kind);
        this.changed();
      },
    };
  }

  /** The registered definition of a kind; its values are unchecked until validated. */
  lookup(kind: string): StageContentType<unknown, Render> | undefined {
    return this.#kinds.get(kind)?.type;
  }

  show<T>(request: StageRequest<T, Render>): StageHandle<T> {
    const id = `stage-${this.#nextId++}`;
    let current: T = request.value;
    let resolve!: (result: StageResult<T>) => void;
    const closed = new Promise<StageResult<T>>((settle) => {
      resolve = settle;
    });

    let pending!: PendingStage<Render>;
    const handle: StageHandle<unknown> = {
      id,
      requester: request.requester,
      value: () => current,
      update: (value) => {
        if (pending.settled) return;
        current = value as T;
        this.changed();
      },
      close: (value) =>
        this.#settle(pending, {
          status: "closed",
          value: value === undefined ? current : (value as T),
        }),
      cancel: (reason) =>
        this.#settle(pending, {
          status: "cancelled",
          value: request.type.defaultValue,
          reason,
        }),
      closed,
    };

    pending = {
      id,
      requester: request.requester,
      kind: request.type.kind,
      preferredHeight: request.preferredHeight,
      actions: request.type.actions ? Object.keys(request.type.actions) : [],
      render: (track) => {
        const focused = () => this.focused();
        return request.type.render({
          get value() { track?.(); return current; },
          handle: handle as StageHandle<T>,
          preferredHeight: request.preferredHeight,
          get focused() { track?.(); return focused(); },
        });
      },
      runAction: (name) => {
        if (pending.settled || this.#foregroundId !== pending.id || !this.focused()) return;
        const action = request.type.actions?.[name];
        return action
          ? action({ value: current, handle: handle as StageHandle<T>, focused: this.focused() })
          : undefined;
      },
      onPromptSubmitted: request.onPromptSubmitted,
      signal: request.signal,
      resolve: (result) => resolve(result as StageResult<T>),
      handle,
      settled: false,
      acceptsText: () => request.type.acceptsText?.(current) ?? false,
      returnFocus: undefined,
    };

    if (request.signal) {
      if (request.signal.aborted) {
        this.#settle(pending, {
          status: "cancelled",
          value: request.type.defaultValue,
          reason: "aborted",
        });
        return handle as StageHandle<T>;
      }
      pending.onAbort = () =>
        this.#settle(pending, {
          status: "cancelled",
          value: request.type.defaultValue,
          reason: "aborted",
        });
      request.signal.addEventListener("abort", pending.onAbort, { once: true });
    }

    this.#pending.push(pending);
    const frontId = stageRequestPolicy.arrival(this.#pending, this.#foregroundId, pending);
    const front = this.#pending.find((entry) => entry.id === frontId);
    if (front && frontId !== this.#foregroundId) this.#present(front, pending.kind === "command");
    this.changed();
    return handle as StageHandle<T>;
  }

  active(): StageEntry<Render> | undefined {
    const pending = this.#pending.find((entry) => entry.id === this.#foregroundId);
    if (!pending) {
      return undefined;
    }
    return {
      id: pending.id,
      requester: pending.requester,
      kind: pending.kind,
      preferredHeight: pending.preferredHeight,
      focused: this.focused(),
      render: pending.render,
      actions: pending.actions,
      acceptsText: pending.acceptsText(),
      runAction: pending.runAction,
    };
  }

  hasActive(): boolean {
    return this.#foregroundId !== undefined;
  }

  queued(): number {
    return this.#pending.length - (this.#foregroundId ? 1 : 0);
  }

  position(): { index: number; total: number } {
    return { index: this.#pending.findIndex((entry) => entry.id === this.#foregroundId) + 1, total: this.#pending.length };
  }

  activate(id: string): boolean {
    const pending = this.#pending.find((entry) => entry.id === id);
    if (!pending) return false;
    this.#present(pending, true);
    return true;
  }

  moveRequest(delta: number): void {
    if (!this.focused() || !this.#foregroundId) return;
    const index = this.#pending.findIndex((entry) => entry.id === this.#foregroundId);
    const next = this.#pending[index + delta];
    if (next) this.#present(next, true);
  }

  focused(): boolean {
    return this.#regions.current() === this.#region;
  }

  async notifyPromptSubmitted(text: string): Promise<void> {
    const active = this.#pending.find((entry) => entry.id === this.#foregroundId);
    if (!active?.onPromptSubmitted) {
      return;
    }
    try {
      await active.onPromptSubmitted({ text, handle: active.handle });
    } catch {
      // A requester callback never changes the prompt result or escapes unhandled.
    }
  }

  /**
   * Availability contributed by a transient editor assist. The region stays
   * focusable while either a request or a nonempty assist owns it.
   */
  setAssistAvailable(available: boolean): void {
    if (this.#assistAvailable === available) {
      return;
    }
    this.#assistAvailable = available;
    this.#syncAvailability();
    this.changed();
  }

  #present(pending: PendingStage<Render>, explicit = false, suppress = false): void {
    const claim = stageRequestPolicy.claim(pending, explicit, this.#canFocus(), suppress || this.#suppressSuccessorFocus);
    this.#suppressSuccessorFocus = false;
    pending.returnFocus ??= this.#regions.current();
    this.#foregroundId = pending.id;
    this.#syncAvailability();
    if (claim) this.#regions.requestFocus(this.#region);
    this.changed();
  }

  #startNext(suppress = false): void {
    if (this.#foregroundId) return;
    const next = stageRequestPolicy.successor(this.#pending);
    if (next) this.#present(next, false, suppress);
    else {
      this.#suppressSuccessorFocus = false;
      this.#syncAvailability();
    }
  }

  #settle(pending: PendingStage<Render>, result: StageResult<unknown>): void {
    if (pending.settled) {
      return;
    }
    pending.settled = true;
    if (pending.onAbort && pending.signal) {
      pending.signal.removeEventListener("abort", pending.onAbort);
    }
    const wasActive = this.#foregroundId === pending.id;
    const index = this.#pending.indexOf(pending);
    if (index !== -1) this.#pending.splice(index, 1);
    if (wasActive) {
      this.#foregroundId = undefined;
      this.#suppressSuccessorFocus = pending.kind === "command";
    }
    pending.resolve(result);
    if (stageRequestPolicy.restore(pending, wasActive) && (pending.kind === "command" || this.#canFocus())) {
      if (!this.#regions.requestFocus(pending.returnFocus ?? EDITOR_REGION)) this.#regions.requestFocus(EDITOR_REGION);
    }
    if (wasActive) queueMicrotask(() => this.#startNext(pending.kind === "command"));
    this.#syncAvailability();
    this.changed();
  }

  #syncAvailability(): void {
    this.#regions.setAvailable(this.#region, this.#pending.length > 0 || this.#assistAvailable);
  }
}

// ---------------------------------------------------------------------------
// Structured timeline
// ---------------------------------------------------------------------------

export interface TimelineItemInput<T, Render = unknown> {
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
  /** Disclosure until the user changes it. */
  initiallyExpanded?: boolean;
}

export interface ItemType<T, Render = unknown> {
  kind: string;
  /** The item's own rows: what it shows collapsed, or its header when expanded. */
  render(props: ItemRenderProps<T, Render>): Render;
  /** Expanded content drawn after the item's selectable children. */
  renderDetails?(props: ItemRenderProps<T, Render>): Render;
  /**
   * Whether the value has more to show expanded. Selectable children make an
   * item expandable regardless, so this answers only for the value's content.
   */
  expandable?(value: T): boolean;
  /** What the copy action writes; undefined when the item holds no original text. */
  sourceText(value: T): string | undefined;
  /**
   * The color of the item's mark in the timeline's gutter, for its kind or,
   * for work with an outcome, that outcome. The view chooses one when it is
   * omitted.
   */
  marker?(value: T): string | undefined;
  /**
   * The render functions read `props` lazily, inside JSX, so a view can keep
   * an item's renderables while its value changes, as a streamed reply does.
   * Without it the item is drawn again for each new value.
   */
  live?: boolean;
  actions: Record<string, ItemAction<T>>;
  /**
   * Checks a value that arrives from outside the harness. A type without it is
   * not reachable through the extension client.
   */
  validate?(value: unknown): value is T;
}

export interface ItemRenderProps<T, Render = unknown> {
  value: T;
  id: string;
  version: number;
  expanded: boolean;
}

export interface ItemAction<T> {
  (event: ItemActionEvent<T>): void | Promise<void>;
}

export interface ItemActionEvent<T> {
  value: T;
  id: string;
}

export interface ItemFactory<T, Render = unknown> extends Registration {
  readonly kind: string;
  create(value: T, options?: { parentId?: string; initiallyExpanded?: boolean }): TimelineItemInput<T, Render>;
}

/**
 * The stored form of a timeline item: its typed render/source/action are
 * captured in closures so `T` stays internal and never leaks as `any`.
 */
export interface TimelineItem<Render = unknown> {
  readonly id: string;
  readonly version: number;
  readonly kind: string;
  readonly parentId: string | undefined;
  readonly initiallyExpanded: boolean;
  /** The definition and value, for a view that renders a live type reactively. */
  readonly type: ItemType<unknown, Render>;
  readonly value: unknown;
  /** Whether the value itself has more to show; see `ItemType.expandable`. */
  readonly expandable: boolean;
  render(expanded?: boolean): Render;
  /** Present only when the type draws expanded content after the children. */
  readonly renderDetails: (() => Render) | undefined;
  sourceText(): string | undefined;
  /** See `ItemType.marker`. */
  readonly marker: string | undefined;
  readonly actions: readonly string[];
  runAction(name: string): void | Promise<void>;
}

export function materializeItem<T, Render>(input: TimelineItemInput<T, Render>): TimelineItem<Render> {
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
    initiallyExpanded: input.initiallyExpanded ?? false,
    // Asked only of visible items, once per value.
    get expandable() {
      return (expandable ??= type.expandable?.(value) ?? false);
    },
    render: (expanded = false) => type.render({ value, id, version, expanded }),
    renderDetails: renderDetails ? () => renderDetails({ value, id, version, expanded: true }) : undefined,
    sourceText: () => type.sourceText(value),
    get marker() {
      return type.marker?.(value);
    },
    actions: Object.keys(type.actions),
    runAction: async (name) => {
      const action = type.actions[name];
      if (action) {
        await action({ value, id });
      }
    },
  };
}

/**
 * Timeline items as a tree in reading order. `append` replaces by id so a
 * streamed item keeps its identity; `replace` reconciles a whole history and
 * moves the cursor to the nearest surviving ancestor or neighbour.
 *
 * Disclosure is held here, by item id, for as long as the registry lives; it is
 * never persisted, and `resetDisclosure` drops it when another history replaces
 * this one. Only items whose ancestors are all expanded are visible, and the
 * cursor only ever rests on a visible item.
 */
export class ItemTypeRegistry<Render = unknown> extends Emitter {
  readonly #kinds = new Map<string, { token: object; type: ItemType<unknown, Render> }>();
  readonly #items: TimelineItem<Render>[] = [];
  readonly #indexById = new Map<string, number>();
  readonly #expanded = new Map<string, boolean>();
  #children: Map<string, string[]> | undefined;
  #cursor: string | undefined;
  #nextId = 0;
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

  registerType<T>(type: ItemType<T, Render>): ItemFactory<T, Render> {
    if (this.#kinds.has(type.kind)) {
      throw new DuplicateRegistrationError("item", type.kind);
    }
    const token = {};
    this.#kinds.set(type.kind, { token, type: type as unknown as ItemType<unknown, Render> });
    this.changed();
    return {
      kind: type.kind,
      create: (value: T, options = {}) => ({
        id: `timeline-${this.#nextId++}`,
        version: 0,
        type,
        value,
        ...options,
      }),
      dispose: () => {
        if (this.#kinds.get(type.kind)?.token !== token) {
          return;
        }
        this.#kinds.delete(type.kind);
        this.changed();
      },
    };
  }

  /** The registered definition of a kind; its values are unchecked until validated. */
  lookup(kind: string): ItemType<unknown, Render> | undefined {
    return this.#kinds.get(kind)?.type;
  }

  append<T>(input: TimelineItemInput<T, Render>): TimelineItem<Render> {
    const item = materializeItem(input);
    const index = this.#indexById.get(item.id);
    if (index === undefined) {
      this.#indexById.set(item.id, this.#items.length);
      this.#items.push(item);
    } else {
      this.#items[index] = item;
    }
    this.#children = undefined;
    this.#normalizeCursor(undefined);
    this.changed();
    return item;
  }

  /** Remove an item and its descendants. */
  remove(id: string): boolean {
    if (!this.#indexById.has(id)) {
      return false;
    }
    const removed = new Set([id, ...this.#descendants(id)]);
    this.replace(this.#items.filter((item) => !removed.has(item.id)));
    return true;
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

  /** Forget every disclosure choice, for a history that replaces this one. */
  resetDisclosure(): void {
    if (this.#expanded.size === 0) {
      return;
    }
    this.#expanded.clear();
    this.#normalizeCursor(undefined);
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

  depth(id: string): number {
    return this.#ancestors(id).length;
  }

  isExpandable(id: string): boolean {
    const item = this.find(id);
    return item !== undefined && (item.expandable || this.children(id).length > 0);
  }

  isExpanded(id: string): boolean {
    const choice = this.#expanded.get(id);
    if (choice !== undefined) {
      return choice;
    }
    return this.find(id)?.initiallyExpanded ?? false;
  }

  isVisible(id: string): boolean {
    if (!this.#indexById.has(id)) {
      return false;
    }
    return this.#ancestors(id).every((ancestor) => this.isExpanded(ancestor));
  }

  cursor(): string | undefined {
    return this.#cursor;
  }

  currentItem(): TimelineItem<Render> | undefined {
    return this.#cursor === undefined ? undefined : this.find(this.#cursor);
  }

  /** Select a visible item; a hidden or unknown one leaves the cursor alone. */
  setCursor(id: string): boolean {
    if (!this.isVisible(id)) {
      return false;
    }
    if (this.#cursor !== id) {
      this.#cursor = id;
      super.changed();
    }
    return true;
  }

  /** Move the cursor by `delta` visible items, clamped; choose an end if unset. */
  moveCursor(delta: number): void {
    const visible = this.visibleItems();
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

  #descendants(id: string): string[] {
    const result: string[] = [];
    const pending = [...this.children(id)];
    while (pending.length > 0) {
      const next = pending.shift() as string;
      result.push(next);
      pending.push(...this.children(next));
    }
    return result;
  }

  /**
   * Keep the cursor on a visible item: a hidden cursor moves to its nearest
   * visible ancestor; with no cursor, the first item takes it.
   */
  #normalizeCursor(previousIndex: number | undefined): void {
    if (this.#cursor !== undefined && this.#indexById.has(this.#cursor)) {
      if (!this.isVisible(this.#cursor)) {
        const ancestors = this.#ancestors(this.#cursor);
        this.#cursor = ancestors.find((ancestor) => this.isVisible(ancestor)) ?? ancestors.findLast((ancestor) => this.#indexById.has(ancestor));
      }
      return;
    }
    if (this.#cursor === undefined && previousIndex === undefined) {
      this.#cursor = this.visibleItems()[0]?.id;
    } else if (this.#cursor !== undefined) {
      this.#cursor = undefined;
    }
  }
}
