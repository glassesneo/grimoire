import type { Api, Model } from "@earendil-works/pi-ai";
import {
  type AgentSession,
  type AgentSessionRuntime,
  type AgentSessionServices,
  type CreateAgentSessionRuntimeFactory,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  createCodemodeExtension,
  type ExtensionError,
  type ExtensionFactory,
  type ExtensionUIContext,
  SessionManager,
  type SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { DisplayRecorder, readDisplayRecords } from "./display-records";
import {
  modelName,
  type NoticeLevel,
  restoreTimeline,
  type SessionEntry,
  type TimelineEvent,
} from "./session-entries";

export interface SessionHost {
  readonly runtime: AgentSessionRuntime;
  /**
   * Bind the UI to the active session, and again to every session that
   * replaces it, since subscriptions and extension bindings belong to one
   * AgentSession.
   */
  bind(options: SessionBindings): Promise<void>;
  /** Timeline entries for the active session's current branch, with its display records. */
  history(): SessionEntry[];
  /** True once a session write failed; the session must be reopened from disk to be trusted again. */
  readonly storageFailed: boolean;
  newSession(
    options?: Parameters<AgentSessionRuntime["newSession"]>[0],
  ): Promise<{ cancelled: boolean }>;
  reload(): Promise<void>;
  /** Finish or abort active work, write what is pending, and release the runtime. */
  dispose(): Promise<void>;
}

export interface SessionBindings {
  uiContext: ExtensionUIContext;
  onEvent: (event: TimelineEvent) => void;
  onExtensionError: (error: ExtensionError) => void;
  onShutdownRequest: () => void;
  /** Called after another session or branch replaces the bound history. */
  onHistoryReplaced: (session: AgentSession) => void;
  /**
   * Returns the extension client of the generation about to bind; the host
   * checks that pi hands that same client to extensions.
   */
  prepareClient?: () => unknown;
  /** The session's extensions are shutting down, before pi replaces or reloads them. */
  onShutdown?: (reason: "quit" | "reload" | "new" | "resume" | "fork") => void;
  /** A session write failed; nothing more is written and the run is aborted. */
  onStorageFailure?: (error: Error) => void;
  notify?: (level: NoticeLevel, text: string) => void;
}

const announced = new WeakSet<AgentSession>();
let nextBash = 0;

/**
 * pi streams a direct shell command's output as `bash_execution_update`
 * events but announces neither its start nor its end, and saves its record
 * later while a run streams. Wrapping the session's public `executeBash`
 * reports both, tagged with the id its output carries; the replacement
 * forwards to pi's method, so recording and events are unchanged.
 */
function announceBash(session: AgentSession, emit: (event: TimelineEvent) => void): void {
  if (announced.has(session)) return;
  announced.add(session);
  const execute = session.executeBash.bind(session);
  session.executeBash = async (command, onChunk, options) => {
    const id = options?.id ?? `harness-bash-${nextBash++}`;
    emit({ type: "bash_started", id, command });
    let result: Awaited<ReturnType<typeof execute>> | undefined;
    try {
      result = await execute(command, onChunk, { ...options, id });
      return result;
    } finally {
      emit({ type: "bash_finished", id, result });
    }
  };
}

/**
 * pi copies the bound UI context into each extension runner with object spread
 * (ExtensionRunner.setUIContext and wrapUIPromptContext in pi 1.0.2's
 * dist/core/extensions/runner.js), so `ctx.ui.harness` is the value the
 * context's getter returned at that moment. pi does not document this; a
 * change that drops or freezes the property must fail here, not leave
 * extensions with a missing or stale client.
 */
export function verifyClientCopy(session: AgentSession, expected: unknown): void {
  if (expected === undefined) return;
  const copied = (session.extensionRunner.getUIContext() as unknown as { harness?: unknown })
    .harness;
  if (copied !== expected) {
    throw new Error(
      "pi no longer passes ctx.ui.harness to extensions as the harness bound it; the harness extension client is unavailable",
    );
  }
}

/**
 * Lets a caller substitute parts of every session the runtime creates, the
 * first and each replacement alike.
 */
export interface SessionCustomization {
  /** Runs before a session is created; a returned model replaces the settings' default. */
  prepare?(services: AgentSessionServices): Model<Api> | undefined;
  /** Runs once the session exists, before the UI binds to it. */
  onSession?(session: AgentSession): void;
}

/** Applies each customization in order; the first model returned wins. */
export function combineCustomizations(
  ...customizations: SessionCustomization[]
): SessionCustomization {
  return {
    prepare: (services) => {
      let model: Model<Api> | undefined;
      for (const customization of customizations) {
        const prepared = customization.prepare?.(services);
        model ??= prepared;
      }
      return model;
    },
    onSession: (session) => {
      for (const customization of customizations) customization.onSession?.(session);
    },
  };
}

export async function createSessionHost(options: {
  cwd: string;
  agentDir: string;
  settingsManager: SettingsManager;
  /** Defaults to a session persisted in pi's default session directory for `cwd`, which does not follow `agentDir`. */
  sessionManager?: SessionManager;
  customization?: SessionCustomization;
}): Promise<SessionHost> {
  const { cwd, agentDir, settingsManager, customization } = options;
  let bound: SessionBindings | undefined;
  let recorder: DisplayRecorder | undefined;
  let storageFailed = false;

  // Observes what session events do not carry: model selection and the end of
  // a generation of extensions, which comes before pi reloads or replaces them.
  const observer: ExtensionFactory = (pi) => {
    pi.on("model_select", (event) => {
      bound?.onEvent({
        type: "model_changed",
        previous: event.previousModel ? modelName(event.previousModel) : undefined,
        model: modelName(event.model),
      });
    });
    pi.on("session_shutdown", (event) => {
      recorder?.flush();
      bound?.onShutdown?.(event.reason);
    });
  };

  const createRuntime: CreateAgentSessionRuntimeFactory = async ({
    cwd,
    agentDir,
    sessionManager,
    sessionStartEvent,
  }) => {
    const services = await createAgentSessionServices({
      cwd,
      agentDir,
      settingsManager,
      resourceLoaderOptions: { extensionFactories: [createCodemodeExtension(), observer] },
    });
    const model = customization?.prepare?.(services);
    const created = await createAgentSessionFromServices({
      services,
      sessionManager,
      sessionStartEvent,
      model,
    });
    customization?.onSession?.(created.session);
    return {
      ...created,
      services,
      diagnostics: services.diagnostics,
    };
  };

  const runtime = await createAgentSessionRuntime(createRuntime, {
    cwd,
    agentDir,
    sessionManager: options.sessionManager ?? SessionManager.create(cwd),
  });

  let unsubscribe: (() => void) | undefined;
  const writable = () => {
    recorder?.flush();
    return !storageFailed;
  };
  const newSession: SessionHost["newSession"] = async (options) =>
    writable() ? runtime.newSession(options) : { cancelled: true };
  const reload = async () => {
    const session = runtime.session;
    if (session.isStreaming || session.isCompacting)
      throw new Error("Cannot reload while streaming or compacting");
    if (!writable())
      throw new Error("The session could not be saved; reopen it before reloading extensions");
    await session.reload({
      beforeSessionStart: () => verifyClientCopy(session, bound?.prepareClient?.()),
    });
  };

  return {
    newSession,
    reload,
    runtime,
    get storageFailed() {
      return storageFailed;
    },
    history() {
      const branch = runtime.session.sessionManager.getBranch();
      return restoreTimeline(
        branch,
        readDisplayRecords(branch, { unconfirmed: recorder?.unconfirmed }),
      );
    },
    async bind(bindings) {
      bound = bindings;
      const rebind = async (session: AgentSession) => {
        unsubscribe?.();
        const sessionRecorder = new DisplayRecorder(session, {
          failed: storageFailed,
          notify: (level, text) => bindings.notify?.(level, text),
          onStorageFailure: (error) => {
            storageFailed = true;
            void session.abort().catch(() => {});
            bindings.onStorageFailure?.(error);
          },
        });
        recorder = sessionRecorder;
        // pi calls listeners without a guard and before it saves the message
        // (AgentSession._emit, then appendMessage, in pi 1.0.2), so a throwing
        // listener would cost the message; each step reports its own failure.
        const guarded = (step: string, run: () => void) => {
          try {
            run();
          } catch (error) {
            bindings.notify?.(
              "error",
              `The harness failed while ${step}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        };
        announceBash(session, (event) =>
          guarded("showing a shell command", () => bindings.onEvent(event)),
        );
        // Subscribed before extensions bind, so nothing they start goes unrecorded.
        unsubscribe = session.subscribe((event) => {
          guarded("recording an event", () => sessionRecorder.observe(event));
          guarded("showing an event", () => bindings.onEvent(event));
          // Idle boundaries: native messages are persisted and no run is active.
          if (
            event.type === "agent_settled" ||
            (event.type === "compaction_end" && session.isIdle)
          ) {
            guarded("saving display records", () => sessionRecorder.flush());
          }
        });
        const writable = () => {
          guarded("saving display records", () => sessionRecorder.flush());
          return !storageFailed;
        };
        const client = bindings.prepareClient?.();
        await session.bindExtensions({
          uiContext: bindings.uiContext,
          // Extensions guard pi-tui features with `mode === "tui"`; the harness
          // implements only the terminal-independent UI, as pi's RPC mode does.
          mode: "rpc",
          commandContextActions: {
            waitForIdle: () => session.waitForIdle(),
            // Pending records are written before a replacement begins, and a
            // session whose storage failed is never replaced or moved.
            newSession,
            fork: async (entryId, forkOptions) => ({
              cancelled: !writable() || (await runtime.fork(entryId, forkOptions)).cancelled,
            }),
            navigateTree: async (targetId, options) => {
              if (!writable()) return { cancelled: true };
              const { cancelled } = await session.navigateTree(targetId, options);
              if (!cancelled) {
                // A summary of the branch left behind was retried before the
                // leaf moved; keep that record on the branch the summary joins.
                sessionRecorder.flush({ adoptOrphans: true });
                bindings.onHistoryReplaced(session);
              }
              return { cancelled };
            },
            switchSession: async (sessionPath, options) =>
              writable() ? runtime.switchSession(sessionPath, options) : { cancelled: true },
            // The client of the reloaded generation is prepared while the old
            // one shuts down, before pi copies the context again.
            reload,
          },
          shutdownHandler: bindings.onShutdownRequest,
          onError: bindings.onExtensionError,
        });
        verifyClientCopy(session, client);
      };
      runtime.setRebindSession(async (session) => {
        await rebind(session);
        bindings.onHistoryReplaced(session);
      });
      await rebind(runtime.session);
    },
    async dispose() {
      const session = runtime.session;
      if (!session.isIdle) await session.abort().catch(() => {});
      recorder?.flush();
      unsubscribe?.();
      await runtime.dispose();
    },
  };
}
