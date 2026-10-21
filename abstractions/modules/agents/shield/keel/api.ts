/**
 * The keel extension API. A Pi extension loaded by keel calls `keel(ctx)` with the context Pi
 * passes to its handlers, such as `session_start`'s, and receives the capabilities bound to
 * that session. Pi's own `ctx.ui` is not keel's UI: keel answers it without showing anything
 * and logs the call.
 *
 * Extensions are trusted code in the driver process. keel's model, in the hub, owns what
 * screens show; what an extension declares or changes there is asynchronous and resolves once
 * the model took it, or rejects with its refusal, which the model also shows in the timeline
 * whether or not the extension waits for it. The functions an extension declares run here.
 * An action's class is a contract about who may run it from a screen (anyone for `view` and
 * `control`, only the writer for `write`), not a sandbox.
 *
 * This module holds no state of its own: the driver installs the host under a global symbol,
 * so an extension that imports a separate copy of this file reaches the same host. An
 * extension outside this repository may import the copy the package ships beside the driver
 * (`libexec/keel/driver/api.ts`).
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ActionClass, Candidate, RunInfo } from "./protocol/wire";
import type { NoticeLevel, ToolArguments, ToolResultData, ToolState } from "./protocol/items";
import type { ResultContent } from "./driver/content";

/** The tool call a decorator presents: its own entry, without what decorators added. */
export interface ToolCall {
  callId: string;
  name: string;
  args: ToolArguments;
  state: ToolState;
  /** Absent when no result arrived; not an empty result. */
  result?: ToolResultData;
}

/**
 * Adds the presentation an extension owns to a tool item, under the extension's name in
 * `data.extra`. It runs in the driver whenever the call changes; only its result is sent.
 */
export type ToolDecorator = (tool: Readonly<ToolCall>, content: Readonly<ResultContent>) => unknown;

export interface Disposable {
  dispose(): void;
}

/** A declaration in the model; withdrawing it resolves once the model withdrew it. */
export interface Registration {
  dispose(): Promise<void>;
}

/** What a running action receives. */
export interface Invocation {
  args: unknown;
  /** The connection that asked, as the hub names it. */
  connection: string;
  /** Whether that connection held the write right when it asked. */
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
   * Runs in the driver. An action without `run` is carried out by the screen's own code for
   * this id, and the model only declares it.
   */
  run?(invocation: Invocation): unknown;
}

export type RequestAnswer<T> =
  /** `supplement` is what the screen typed with the answer, absent when the request took none. */
  { status: "answered"; value: T; supplement?: string } | { status: "cancelled" };

export interface ConfirmOptions {
  title: string;
  message?: string;
  signal?: AbortSignal;
  /** Whether the screen types a supplement with the answer; true when omitted. */
  supplement?: boolean;
}

export interface ChoiceOptions extends ConfirmOptions {
  options: readonly string[];
}

export interface AssistProvider {
  /** Unique among assists; also the name a command input finds it by. */
  id: string;
  title: string;
  /**
   * Candidates for the assist's draft. Called again whenever the draft changes; a result for
   * an older draft is discarded.
   */
  candidates(text: string): readonly Candidate[] | Promise<readonly Candidate[]>;
}

export interface KeelContext {
  actions: {
    /** Declares actions together; all are refused when one is invalid or already declared. */
    register(definitions: readonly ActionDefinition[]): Promise<Registration>;
  };
  items: {
    /** Shows items of `kind` (or `kind/variant`) with the screen renderer named `renderer`. */
    present(kind: string, renderer: string): Promise<Registration>;
    /** Adds data to tool items of the named tool under `owner` in `data.extra`. */
    decorateTool(tool: string, owner: string, decorate: ToolDecorator): Disposable;
    notice(level: NoticeLevel, text: string): void;
  };
  requests: {
    choice(options: ChoiceOptions): Promise<RequestAnswer<string>>;
    confirm(options: ConfirmOptions): Promise<RequestAnswer<boolean>>;
  };
  drafts: {
    /** Replaces an open draft; it does not check a writer. Resolves once the model holds it. */
    set(destination: string, text: string): Promise<void>;
  };
  assists: {
    register(provider: AssistProvider): Promise<Registration>;
    /** Ids of the assists the model holds. */
    list(): Promise<readonly string[]>;
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
     * Starts compacting the history, only while nothing runs; the result is shown in the
     * timeline.
     */
    compact(instructions?: string): void;
  };
  /** The queued instructions, as one operation each; see the driver's control. */
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

/** Installs the driver's host; only the driver calls this. */
export function installHost(host: Host): () => void {
  const slot = globalThis as { [HOST]?: Host };
  if (slot[HOST]) throw new Error("a keel host is already installed in this process");
  slot[HOST] = host;
  return () => {
    if (slot[HOST] === host) delete slot[HOST];
  };
}
