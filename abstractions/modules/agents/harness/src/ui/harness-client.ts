/**
 * `ctx.ui.harness`: the data-only API extensions use to reach the harness's
 * compiled presentation types. Extensions hand over plain values; the kind a
 * value names validates it before anything changes, and nothing an extension
 * passes is rendered as code. A client belongs to one generation of the
 * session's extensions: once that generation ends, its mutations throw, its
 * disposals do nothing, and everything it contributed is removed.
 */
import type { ResultContent } from "../core/session-entries";
import {
  Emitter,
  type ItemTypeRegistry,
  type Registration,
  type StageController,
  type StageHandle,
  type StageResult,
} from "./controllers";
import type { TimelineItemSink } from "./harness-ui";
import type { StatuslineController, StatuslinePosition, StatuslineSegment } from "./statusline";
import { singleLine, type ToolSnapshot } from "./timeline-types";

export type { ToolSnapshot } from "./timeline-types";

export interface CustomMessageSnapshot {
  id: string;
  customType: string;
  content: string | ResultContent;
  details: unknown;
}

export interface TimelineItemHandle {
  readonly id: string;
  /** Replace the item's whole value. */
  update(value: unknown): void;
  dispose(): void;
}

export interface StatuslineHandle<T> {
  /** Replace the contribution's whole value. */
  update(value: T): void;
  dispose(): void;
}

export interface HarnessUIClient {
  readonly version: 1;
  timeline: {
    /** Show calls of `toolName` with the compiled `kind`; `project` maps each call's snapshot to that kind's value. */
    bindTool(
      toolName: string,
      kind: string,
      project?: (snapshot: ToolSnapshot) => unknown,
    ): Registration;
    bindCustomMessage(
      customType: string,
      kind: string,
      project?: (snapshot: CustomMessageSnapshot) => unknown,
    ): Registration;
    /** An item that lasts while this client does; durable messages go through pi's `sendMessage()`. */
    append(item: { kind: string; value: unknown }): TimelineItemHandle;
  };
  stage: {
    show(request: {
      kind: string;
      value: unknown;
      preferredHeight: number;
      signal?: AbortSignal;
      onPromptSubmitted?: (event: { text: string; handle: StageHandle }) => void | Promise<void>;
    }): StageHandle<unknown>;
  };
  statusline: {
    setText(input: {
      position: StatuslinePosition;
      key: string;
      text: string;
    }): StatuslineHandle<string>;
    setItem(input: {
      position: StatuslinePosition;
      key: string;
      kind: string;
      value: unknown;
    }): StatuslineHandle<unknown>;
  };
}

export class StaleClientError extends Error {
  constructor() {
    super("This harness UI client belongs to extensions that have been reloaded or shut down");
    this.name = "StaleClientError";
  }
}

// ---------------------------------------------------------------------------
// Bindings
// ---------------------------------------------------------------------------

export interface TimelineBinding<S> {
  kind: string;
  project?: (snapshot: S) => unknown;
}

interface BindingEntry<S> {
  name: string;
  binding: TimelineBinding<S>;
}

/** Which kind shows a tool or custom message; the latest live binding of a name wins. */
export class TimelineBindings extends Emitter {
  readonly #tools: BindingEntry<ToolSnapshot>[] = [];
  readonly #custom: BindingEntry<CustomMessageSnapshot>[] = [];

  bindTool(toolName: string, binding: TimelineBinding<ToolSnapshot>): Registration {
    return this.#add(this.#tools, { name: toolName, binding });
  }

  bindCustomMessage(
    customType: string,
    binding: TimelineBinding<CustomMessageSnapshot>,
  ): Registration {
    return this.#add(this.#custom, { name: customType, binding });
  }

  tool(toolName: string): TimelineBinding<ToolSnapshot> | undefined {
    return this.#tools.findLast((entry) => entry.name === toolName)?.binding;
  }

  custom(customType: string): TimelineBinding<CustomMessageSnapshot> | undefined {
    return this.#custom.findLast((entry) => entry.name === customType)?.binding;
  }

  #add<S>(list: BindingEntry<S>[], entry: BindingEntry<S>): Registration {
    list.push(entry);
    this.changed();
    return {
      // By identity, so disposing an old binding never removes a newer one.
      dispose: () => {
        const index = list.indexOf(entry);
        if (index === -1) return;
        list.splice(index, 1);
        this.changed();
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Generations
// ---------------------------------------------------------------------------

export interface ClientDependencies<Render> {
  /** Looks up the kinds extensions name. */
  timeline: ItemTypeRegistry<Render>;
  /** Receives the items extensions append. */
  items: TimelineItemSink;
  bindings: TimelineBindings;
  stage: StageController<Render>;
  statusline: StatuslineController;
}

export interface ClientHost {
  /** The client of the current generation, creating one if the last was retired. */
  prepare(): HarnessUIClient;
  current(): HarnessUIClient | undefined;
  /** End the current generation: revoke its contributions and make its client stale. */
  retire(): void;
}

let nextGeneration = 0;

export function createClientHost<Render>(dependencies: ClientDependencies<Render>): ClientHost {
  let current: { client: HarnessUIClient; retire(): void } | undefined;
  return {
    prepare() {
      current ??= createGeneration(dependencies);
      return current.client;
    },
    current: () => current?.client,
    retire() {
      current?.retire();
      current = undefined;
    },
  };
}

/** A registered kind that extensions may use; with `value`, also a valid value of it. */
function requireType<Type extends { validate?: (value: unknown) => boolean }>(
  type: Type | undefined,
  kind: string,
  ...value: [unknown?]
): Type {
  if (!type) throw new Error(`No harness type is registered as ${JSON.stringify(kind)}`);
  if (!type.validate)
    throw new Error(`The harness type ${JSON.stringify(kind)} is not available to extensions`);
  if (value.length > 0 && !type.validate(value[0]))
    throw new TypeError(`The value is not valid for the harness type ${JSON.stringify(kind)}`);
  return type;
}

function createGeneration<Render>(dependencies: ClientDependencies<Render>): {
  client: HarnessUIClient;
  retire(): void;
} {
  const generation = nextGeneration++;
  const disposers = new Set<() => void>();
  let live = true;
  let nextItem = 0;
  const assertLive = () => {
    if (!live) throw new StaleClientError();
  };
  /** Track a contribution so retiring removes it; its own disposal is idempotent. */
  const own = (dispose: () => void) => {
    let disposed = false;
    const once = () => {
      if (disposed) return;
      disposed = true;
      disposers.delete(once);
      dispose();
    };
    disposers.add(once);
    return { once, disposed: () => disposed };
  };

  const statuslineKeys = new Map<string, () => void>();
  const contribute = <T>(
    position: StatuslinePosition,
    key: string,
    toSegment: (value: T) => StatuslineSegment,
    value: T,
  ): StatuslineHandle<T> => {
    if (position !== "top" && position !== "bottom")
      throw new TypeError("position must be top or bottom");
    const slot = `${position}\u0000${key}`;
    // A key names one contribution of this client; setting it again replaces it.
    statuslineKeys.get(slot)?.();
    const contribution = dependencies.statusline.contribute(position, toSegment(value));
    const owned = own(() => {
      contribution.dispose();
      if (statuslineKeys.get(slot) === owned.once) statuslineKeys.delete(slot);
    });
    statuslineKeys.set(slot, owned.once);
    return {
      update: (next) => {
        assertLive();
        if (owned.disposed()) return;
        contribution.update(toSegment(next));
      },
      dispose: owned.once,
    };
  };

  const bind = (kind: string, project: unknown, register: () => Registration): Registration => {
    assertLive();
    requireType(dependencies.timeline.lookup(kind), kind);
    if (project !== undefined && typeof project !== "function")
      throw new TypeError("project must be a function");
    const registration = register();
    return { dispose: own(() => registration.dispose()).once };
  };

  const client: HarnessUIClient = {
    version: 1,
    timeline: {
      bindTool: (toolName, kind, project) =>
        bind(kind, project, () => dependencies.bindings.bindTool(toolName, { kind, project })),
      bindCustomMessage: (customType, kind, project) =>
        bind(kind, project, () =>
          dependencies.bindings.bindCustomMessage(customType, { kind, project }),
        ),
      append({ kind, value }) {
        assertLive();
        requireType(dependencies.timeline.lookup(kind), kind, value);
        const id = `client-${generation}-${nextItem++}`;
        dependencies.items.put(id, kind, value);
        const owned = own(() => dependencies.items.remove(id));
        return {
          id,
          update(next) {
            assertLive();
            if (owned.disposed()) return;
            requireType(dependencies.timeline.lookup(kind), kind, next);
            dependencies.items.put(id, kind, next);
          },
          dispose: owned.once,
        };
      },
    },
    stage: {
      show({ kind, value, preferredHeight, signal, onPromptSubmitted }) {
        assertLive();
        const type = requireType(dependencies.stage.lookup(kind), kind, value);
        if (!Number.isFinite(preferredHeight))
          throw new TypeError("preferredHeight must be a number");
        const handle = dependencies.stage.show({
          requester: "extension",
          type,
          value,
          preferredHeight,
          signal,
          onPromptSubmitted,
        });
        const owned = own(() => handle.cancel("extensions reloaded"));
        void handle.closed.then(() => owned.once());
        const guarded: StageHandle<unknown> = {
          id: handle.id,
          requester: handle.requester,
          value: () => handle.value(),
          update: (next) => {
            assertLive();
            requireType(type, kind, next);
            handle.update(next);
          },
          close: (next) => {
            assertLive();
            if (next !== undefined) requireType(type, kind, next);
            handle.close(next);
          },
          cancel: (reason) => handle.cancel(reason),
          closed: handle.closed as Promise<StageResult<unknown>>,
        };
        return guarded;
      },
    },
    statusline: {
      setText({ position, key, text }) {
        assertLive();
        if (typeof key !== "string" || typeof text !== "string")
          throw new TypeError("key and text must be strings");
        return contribute(
          position,
          key,
          (value: string) => {
            if (typeof value !== "string") throw new TypeError("text must be a string");
            return { text: singleLine(value) };
          },
          text,
        );
      },
      setItem({ position, key, kind, value }) {
        assertLive();
        if (typeof key !== "string") throw new TypeError("key must be a string");
        const type = requireType(dependencies.statusline.lookup(kind), kind, value);
        return contribute(
          position,
          key,
          (next: unknown) => requireType(type, kind, next).segment(next),
          value,
        );
      },
    },
  };

  return {
    client,
    retire() {
      if (!live) return;
      live = false;
      for (const dispose of disposers) dispose();
    },
  };
}
