/**
 * The keel extension API. A Pi extension loaded by keel calls `keel(ctx)` with
 * the context Pi passes to its handlers, such as `session_start`'s, and
 * receives the capabilities bound to that session. Pi's own `ctx.ui` is not
 * keel's UI: keel answers it without showing anything and logs the call.
 *
 * Extensions are trusted code in the runtime process. An action's class is a
 * contract about who may run it from a screen (anyone for `view` and
 * `control`, only the writer for `write`), not a sandbox.
 *
 * This module holds no state of its own: the runtime installs the host under
 * a global symbol, so an extension that imports a separate copy of this file
 * reaches the same host. An extension outside this repository may import the
 * copy the package ships beside the runtime (`libexec/keel/runtime/api.ts`).
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ActionClass, Candidate, RunInfo } from "./protocol/wire";
import type { NoticeLevel, ToolData } from "./protocol/items";
import type { ResultContent } from "./runtime/content";

/**
 * Adds the presentation an extension owns to a tool item, under the
 * extension's name in `data.extra`. It runs in the runtime; only its result
 * is sent.
 */
export type ToolDecorator = (tool: Readonly<ToolData>, content: Readonly<ResultContent>) => unknown;

export interface Disposable {
  dispose(): void;
}

/** What a running action receives. */
export interface Invocation {
  args: unknown;
  /** The connection that asked, as the hub names it. */
  connection: string;
  /** Whether that connection holds the write right now. */
  writer: boolean;
}

export interface ActionDefinition {
  /** `<layer>.<name>`; a layer that is a region (`editor`, `timeline`, `stage`) scopes its keys. */
  id: string;
  /** `write` when omitted. */
  class?: ActionClass;
  title?: string;
  /** Default chords; global actions take none. */
  keys?: readonly string[];
  /**
   * Runs in the runtime. An action without `run` is carried out by the
   * screen's own code for this id, and the runtime only declares it.
   */
  run?(invocation: Invocation): unknown;
}

export type RequestAnswer<T> =
  | { status: "answered"; value: T; supplement: string }
  | { status: "cancelled" };

export interface ChoiceOptions {
  title: string;
  message?: string;
  options: readonly string[];
  signal?: AbortSignal;
}

export interface ConfirmOptions {
  title: string;
  message?: string;
  signal?: AbortSignal;
}

export interface AssistProvider {
  /** Unique among assists; also the name a command input finds it by. */
  id: string;
  title: string;
  /**
   * Candidates for the assist's draft. Called again whenever the draft
   * changes; a result for an older draft is discarded.
   */
  candidates(text: string): readonly Candidate[] | Promise<readonly Candidate[]>;
}

export interface KeelContext {
  actions: {
    register(definitions: readonly ActionDefinition[]): Disposable;
    /** Runs a registered action as if `invocation`'s connection had asked for it. */
    invoke(id: string, invocation: Invocation): Promise<unknown>;
  };
  items: {
    /** Shows items of `kind` (or `kind/variant`) with the screen renderer named `renderer`. */
    present(kind: string, renderer: string): Disposable;
    /** Adds data to tool items of the named tool under `owner` in `data.extra`. */
    decorateTool(tool: string, owner: string, decorate: ToolDecorator): Disposable;
    notice(level: NoticeLevel, text: string): void;
  };
  requests: {
    choice(options: ChoiceOptions): Promise<RequestAnswer<string>>;
    confirm(options: ConfirmOptions): Promise<RequestAnswer<boolean>>;
  };
  drafts: {
    get(destination: string): string;
    /** Replaces a draft as the runtime; it does not check a writer. */
    set(destination: string, text: string): void;
  };
  assists: {
    register(provider: AssistProvider): Disposable;
    /** Ids of registered assists. */
    list(): readonly string[];
    /** The candidates of another assist for `text`, as a command input delegates to it. */
    query(id: string, text: string): Promise<readonly Candidate[]>;
  };
  run: {
    info(): RunInfo;
  };
  session: {
    /** The thinking levels the current model accepts. */
    thinkingLevels(): readonly string[];
    /**
     * Starts compacting the history, only while nothing runs; the result is
     * shown in the timeline.
     */
    compact(instructions?: string): void;
  };
  /** The queued instructions, as one operation each; see the runtime's control. */
  queue: {
    /** Takes every queued instruction and sends it again as steering. */
    steerAll(): Promise<{ resent: number }>;
    /** Takes every queued instruction into the prompt draft, replacing it. */
    editAll(): Promise<{ taken: number }>;
  };
}

const HOST = Symbol.for("keel.host");

interface Host {
  context(ctx: ExtensionContext): KeelContext;
}

/** The keel capabilities of the session `ctx` belongs to. */
export function keel(ctx: ExtensionContext): KeelContext {
  const host = (globalThis as { [HOST]?: Host })[HOST];
  if (!host) throw new Error("keel(ctx) is available only to extensions keel loads");
  return host.context(ctx);
}

/** Installs the runtime's host; only the runtime calls this. */
export function installHost(host: Host): () => void {
  const slot = globalThis as { [HOST]?: Host };
  if (slot[HOST]) throw new Error("a keel host is already installed in this process");
  slot[HOST] = host;
  return () => {
    if (slot[HOST] === host) delete slot[HOST];
  };
}
