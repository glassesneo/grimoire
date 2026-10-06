import type { Api, Model } from "@earendil-works/pi-ai";
import {
  type AgentSession,
  type AgentSessionEvent,
  type AgentSessionRuntime,
  type AgentSessionServices,
  type CreateAgentSessionRuntimeFactory,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  createCodemodeExtension,
  type ExtensionError,
  type ExtensionUIContext,
  SessionManager,
  type SettingsManager,
} from "@earendil-works/pi-coding-agent";

export interface SessionHost {
  readonly runtime: AgentSessionRuntime;
  /**
   * Bind the UI to the active session, and again to every session that
   * replaces it, since subscriptions and extension bindings belong to one
   * AgentSession.
   */
  bind(options: SessionBindings): Promise<void>;
  dispose(): Promise<void>;
}

export interface SessionBindings {
  uiContext: ExtensionUIContext;
  onEvent: (event: AgentSessionEvent) => void;
  onExtensionError: (error: ExtensionError) => void;
  onShutdownRequest: () => void;
  /** Called after another session or branch replaces the bound history. */
  onHistoryReplaced: (session: AgentSession) => void;
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
export function combineCustomizations(...customizations: SessionCustomization[]): SessionCustomization {
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
  /** Defaults to a session persisted under the agent directory. */
  sessionManager?: SessionManager;
  customization?: SessionCustomization;
}): Promise<SessionHost> {
  const { cwd, agentDir, settingsManager, customization } = options;

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
      resourceLoaderOptions: { extensionFactories: [createCodemodeExtension()] },
    });
    const model = customization?.prepare?.(services);
    const created = await createAgentSessionFromServices({ services, sessionManager, sessionStartEvent, model });
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

  return {
    runtime,
    async bind(bindings) {
      const rebind = async (session: AgentSession) => {
        unsubscribe?.();
        await session.bindExtensions({
          uiContext: bindings.uiContext,
          // Extensions guard pi-tui features with `mode === "tui"`; the harness
          // implements only the terminal-independent UI, as pi's RPC mode does.
          mode: "rpc",
          commandContextActions: {
            waitForIdle: () => session.waitForIdle(),
            newSession: (options) => runtime.newSession(options),
            fork: async (entryId, forkOptions) => ({
              cancelled: (await runtime.fork(entryId, forkOptions)).cancelled,
            }),
            navigateTree: async (targetId, options) => {
              const { cancelled } = await session.navigateTree(targetId, options);
              if (!cancelled) {
                bindings.onHistoryReplaced(session);
              }
              return { cancelled };
            },
            switchSession: (sessionPath, options) => runtime.switchSession(sessionPath, options),
            reload: () => session.reload(),
          },
          shutdownHandler: bindings.onShutdownRequest,
          onError: bindings.onExtensionError,
        });
        unsubscribe = session.subscribe(bindings.onEvent);
      };
      runtime.setRebindSession(async (session) => {
        await rebind(session);
        bindings.onHistoryReplaced(session);
      });
      await rebind(runtime.session);
    },
    async dispose() {
      unsubscribe?.();
      await runtime.dispose();
    },
  };
}
