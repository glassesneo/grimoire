/**
 * The keel runtime: one Pi SDK session for one hub agent. It reads the
 * configuration directory, loads only the extensions keel requires and the
 * ones `extensions.json` lists, and answers the hub's records.
 *
 * Configuration directory. Pi reads its settings.json, models.json, and
 * auth.json there as its agent directory. keel reads:
 *   extensions.json   {"extensions": [...]}: a bundled extension's name
 *                     (lowercase letters, digits, and hyphens), or else a
 *                     file path, absolute or relative to the directory, such
 *                     as `mine.ts`. Absent means none.
 *   keybindings.json  action id to a key or a list of keys; see
 *                     protocol/keys.ts. Absent means the defaults.
 * A file that exists but is not valid JSON of that shape stops the runtime
 * before it is ready. Pi's own extension discovery (settings, packages,
 * project directories) is off, and a loaded extension keel did not ask for
 * fails the start as well.
 *
 * Writers. The hub names the connection allowed to write, and tags every
 * operation with its connection. An action of class `write` runs only for
 * that connection; the check happens here, in input order, so a write sent
 * before the writer changed but arriving after is refused.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import {
  type AgentSession,
  createAgentSessionFromServices,
  createAgentSessionServices,
  type ExtensionContext,
  type ExtensionFactory,
  type ExtensionUIContext,
  type InlineExtension,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { type ActionDefinition, installHost, type Invocation, type KeelContext } from "../api";
import {
  type Invoke,
  type InvokeResult,
  type RuntimeInput,
  type RuntimeOutput,
} from "../protocol/wire";
import { modelName } from "../protocol/format";
import { coreActions } from "./core-actions";
import { Control } from "./control";
import { Accepted, Store, StoreError } from "./store";
import type { TimelineEvent } from "./timeline";

/** A bundled extension: code inside the runtime, or a file shipped with it. */
export type Bundled = ExtensionFactory | { path: string };

export interface RuntimeOptions {
  cwd: string;
  configDir: string;
  /** Where Pi writes the session file; in memory when omitted. */
  sessionDir?: string;
  emit: (record: RuntimeOutput) => void;
  bundled: Readonly<Record<string, Bundled>>;
  /** Writes a diagnostic line, never to the protocol stream. */
  log?: (line: string) => void;
}

const REQUIRED = ["keel-projection", "keel-control", "keel-keys"];

/** How a bundled extension is named; any other entry is a file path. */
const BUNDLED_NAME = /^[a-z][a-z0-9-]*$/;

function readJson(path: string): unknown {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error: any) {
    if (error?.code === "ENOENT") return undefined;
    throw new StoreError("config_unreadable", `${path}: ${error?.message ?? error}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new StoreError("config_invalid", `${path}: ${(error as Error).message}`);
  }
}

function extensionList(configDir: string): string[] {
  const path = resolve(configDir, "extensions.json");
  const value = readJson(path);
  if (value === undefined) return [];
  const list = (value as { extensions?: unknown })?.extensions;
  if (
    typeof value !== "object" ||
    value === null ||
    !Array.isArray(list) ||
    !list.every((entry) => typeof entry === "string" && entry !== "")
  )
    throw new StoreError("config_invalid", `${path}: expected {"extensions": [names or paths]}`);
  return list;
}

export class Runtime {
  readonly store: Store;
  readonly control: Control;
  readonly session: AgentSession;
  #writer: { connection: string | null; epoch: number } = { connection: null, epoch: 0 };
  readonly #emit: (record: RuntimeOutput) => void;
  readonly #uninstall: () => void;
  readonly #unsubscribe: () => void;

  private constructor(parts: {
    store: Store;
    control: Control;
    session: AgentSession;
    emit: (record: RuntimeOutput) => void;
    uninstall: () => void;
    unsubscribe: () => void;
  }) {
    this.store = parts.store;
    this.control = parts.control;
    this.session = parts.session;
    this.#emit = parts.emit;
    this.#uninstall = parts.uninstall;
    this.#unsubscribe = parts.unsubscribe;
  }

  static async start(options: RuntimeOptions): Promise<Runtime> {
    const log = options.log ?? ((line: string) => process.stderr.write(`${line}\n`));
    const { cwd, configDir } = options;
    const requested = extensionList(configDir);
    const notices: { level: "warning" | "error"; text: string }[] = [];

    // The host's parts exist once the session does; the required extensions
    // reach them through this holder, which is filled before Pi binds them.
    const holder: Holder = { events: [], keys: undefined };

    const inline: InlineExtension[] = [
      { name: "keel-projection", factory: projection(holder) },
      { name: "keel-control", factory: gates(holder) },
      { name: "keel-keys", factory: keys(holder, configDir) },
    ];
    const paths: string[] = [];
    const allowed = new Set(REQUIRED.map((name) => `<inline:${name}>`));
    for (const entry of requested) {
      if (!BUNDLED_NAME.test(entry)) {
        const path = isAbsolute(entry) ? entry : resolve(configDir, entry);
        paths.push(path);
        allowed.add(path);
        continue;
      }
      const bundled = options.bundled[entry];
      if (!bundled) {
        notices.push({
          level: "error",
          text: `extensions.json: no bundled extension named ${entry}`,
        });
      } else if (typeof bundled === "function") {
        inline.push({ name: `keel:${entry}`, factory: bundled });
        allowed.add(`<inline:keel:${entry}>`);
      } else {
        paths.push(bundled.path);
        allowed.add(bundled.path);
      }
    }

    const settingsManager = SettingsManager.create(cwd, configDir);
    const services = await createAgentSessionServices({
      cwd,
      agentDir: configDir,
      settingsManager,
      resourceLoaderOptions: {
        noExtensions: true,
        additionalExtensionPaths: paths,
        extensionFactories: inline,
        extensionsOverride: (result) => {
          const unexpected = result.extensions.filter(
            (extension) => !allowed.has(extension.path) && !allowed.has(extension.resolvedPath),
          );
          if (unexpected.length)
            throw new StoreError(
              "unexpected_extension",
              `Pi loaded extensions keel did not ask for: ${unexpected.map((e) => e.path).join(", ")}`,
            );
          return result;
        },
      },
    });
    const loaded = services.resourceLoader.getExtensions();
    if (holder.keyError) throw holder.keyError;
    for (const error of loaded.errors) {
      if (REQUIRED.some((name) => error.path === `<inline:${name}>`))
        throw new StoreError("required_extension_failed", `${error.path}: ${error.error}`);
      notices.push({ level: "error", text: `extension ${error.path}: ${error.error}` });
    }
    for (const warning of loaded.warnings ?? [])
      notices.push({ level: "warning", text: `extension ${warning.path}: ${warning.warning}` });
    for (const name of REQUIRED)
      if (!loaded.extensions.some((extension) => extension.path === `<inline:${name}>`))
        throw new StoreError("required_extension_failed", `${name} was not loaded`);
    for (const diagnostic of services.diagnostics)
      notices.push({
        level: diagnostic.type === "error" ? "error" : "warning",
        text: diagnostic.message,
      });

    // A provider an extension registers starts its own availability check
    // without waiting (ModelRuntime.registerNativeProvider in pi-coding-agent
    // 1.1.0), and a later check supersedes the one createAgentSessionServices
    // awaited, which then leaves the model list as it was. This check starts
    // after both, so the session chooses its model from a finished list.
    await services.modelRuntime.refresh({ allowNetwork: false });
    const sessionManager = options.sessionDir
      ? SessionManager.create(cwd, options.sessionDir)
      : SessionManager.inMemory(cwd);
    const { session, modelFallbackMessage } = await createAgentSessionFromServices({
      services,
      sessionManager,
    });
    if (modelFallbackMessage) notices.push({ level: "warning", text: modelFallbackMessage });

    const store = new Store({
      emit: options.emit,
      instance: randomUUID(),
      session: {
        id: session.sessionId,
        cwd,
        model: session.model ? modelName(session.model) : null,
        thinking: session.model ? session.thinkingLevel : null,
      },
    });
    for (const notice of notices) store.notice(notice.level, notice.text);
    const control = new Control(session, store);
    const unsubscribe = session.subscribe((event) => {
      try {
        store.timeline.reduce(event as TimelineEvent);
        store.items();
        control.observe(event as { type: string });
        if (event.type === "thinking_level_changed") store.setSession({ thinking: event.level });
      } catch (error) {
        log(`keel: event ${event.type} failed: ${String(error)}`);
      }
    });
    let runtime: Runtime | undefined;
    const uninstall = installHost({
      context: (ctx) => {
        if (!runtime || ctx.sessionManager.getSessionId() !== session.sessionId)
          throw new Error("keel(ctx) was given a context of another session");
        return runtime.#context();
      },
    });
    try {
      runtime = new Runtime({
        store,
        control,
        session,
        emit: options.emit,
        uninstall,
        unsubscribe,
      });
      holder.runtime = runtime;
      for (const event of holder.events.splice(0)) store.timeline.reduce(event);
      store.registerActions(coreActions(runtime));
      await session.bindExtensions({
        uiContext: uiStub(session.extensionRunner.getUIContext(), log),
        // keel does not render Pi's UI; see uiStub.
        mode: "print",
        // keel keeps one session for the runtime's life: what would replace or
        // reload it reports itself cancelled instead of Pi's default success.
        commandContextActions: {
          waitForIdle: () => session.waitForIdle(),
          newSession: async () => ({ cancelled: true }),
          fork: async () => ({ cancelled: true }),
          navigateTree: async () => ({ cancelled: true }),
          switchSession: async () => ({ cancelled: true }),
          reload: async () => {
            throw new Error("keel does not reload extensions; start a new agent");
          },
        },
        onError: (error) => {
          const text = `extension ${error.extensionPath} (${error.event}): ${error.error}`;
          log(`keel: ${text}`);
          store.notice("error", text);
        },
        shutdownHandler: () =>
          log("keel: an extension asked to shut down; stop the agent from the hub"),
      });
      // Every extension registered its actions while Pi bound them.
      store.applyKeys(holder.keys);
      store.flush();
      options.emit({ type: "ready", runtimeInstance: store.instance });
      return runtime;
    } catch (error) {
      uninstall();
      unsubscribe();
      throw error;
    }
  }

  get writer(): { connection: string | null; epoch: number } {
    return this.#writer;
  }

  /** Handles one record from the hub. */
  handle(input: RuntimeInput): void {
    switch (input.type) {
      case "writer":
        this.#writer = { connection: input.connection, epoch: input.epoch };
        return;
      case "snapshot_request": {
        const snapshot = this.store.snapshot();
        this.#emit({ type: "snapshot", id: input.id, snapshot });
        return;
      }
      case "invoke":
        void this.#invoke(input.id, input.connection, input.invoke);
        return;
    }
  }

  async #invoke(id: string, connection: string, invoke: Invoke): Promise<void> {
    let result: InvokeResult;
    try {
      // A screen that saw an older writer epoch sent this before the write moved, even if
      // the same screen holds it again now; one that names no epoch cannot show otherwise.
      const writer =
        connection === this.#writer.connection && invoke.writerEpoch === this.#writer.epoch;
      const detail = await this.run(invoke.action, { args: invoke.args, connection, writer });
      const appliedSeq = this.store.flush();
      result =
        detail instanceof Accepted
          ? {
              outcome: "accepted",
              appliedSeq,
              ...(detail.detail === undefined ? {} : { detail: detail.detail }),
            }
          : { outcome: "done", appliedSeq, ...(detail === undefined ? {} : { detail }) };
    } catch (error) {
      this.store.flush();
      result =
        error instanceof StoreError
          ? {
              outcome: "rejected",
              code: error.code,
              ...(error.message !== error.code ? { message: error.message } : {}),
            }
          : {
              outcome: "rejected",
              code: "failed",
              message: error instanceof Error ? error.message : String(error),
            };
    }
    this.#emit({ type: "result", id, result });
  }

  /** Runs a registered action after checking that the invocation may run it. */
  async run(id: string, invocation: Invocation): Promise<unknown> {
    const action = this.store.action(id);
    if (!action) throw new StoreError("unknown_action", `no action ${id}`);
    if ((action.class ?? "write") === "write" && !invocation.writer)
      throw new StoreError("not_writer", `${id} needs the write right`);
    if (!action.run) throw new StoreError("screen_action", `${id} runs on the screen`);
    return action.run(invocation);
  }

  #context(): KeelContext {
    const { store, control } = this;
    return {
      actions: {
        register: (definitions: readonly ActionDefinition[]) => store.registerActions(definitions),
        invoke: (id, invocation) => this.run(id, invocation),
      },
      items: {
        present: (kind, renderer) => store.present(kind, renderer),
        decorateTool: (tool, owner, decorate) => {
          const remove = store.timeline.decorate(tool, owner, decorate);
          store.items();
          return {
            dispose: () => {
              remove();
              store.items();
            },
          };
        },
        notice: (level, text) => store.notice(level, text),
      },
      requests: {
        choice: (options) =>
          store.request(
            {
              kind: "choice",
              title: options.title,
              message: options.message,
              options: [...options.options],
            },
            options.signal,
          ),
        confirm: (options) =>
          store.request(
            {
              kind: "confirm",
              title: options.title,
              message: options.message,
              options: ["Yes", "No"],
            },
            options.signal,
          ),
      },
      drafts: {
        get: (destination) => store.draft(destination).text,
        set: (destination, text) => void store.setDraft(destination, text),
      },
      assists: {
        register: (provider) => store.registerAssist(provider),
        list: () => store.assistIds(),
        query: (id, text) => store.queryAssist(id, text),
      },
      run: { info: () => store.run },
      session: {
        thinkingLevels: () => this.session.getAvailableThinkingLevels(),
        compact: (instructions) => control.compact(instructions),
      },
      queue: {
        steerAll: () => control.steerAll(),
        editAll: () => control.editAll(),
      },
    };
  }

  async dispose(): Promise<void> {
    this.#unsubscribe();
    this.#uninstall();
    if (!this.session.isIdle) await this.session.abort().catch(() => {});
    this.session.dispose();
  }
}

interface Holder {
  runtime?: Runtime;
  /** Model changes Pi reported before the host existed. */
  events: TimelineEvent[];
  /** The key configuration the keys extension read. */
  keys: unknown;
  keyError?: StoreError;
}

/**
 * The required extension that reads `keybindings.json`. The host applies it
 * once every extension has registered its actions.
 */
function keys(holder: Holder, configDir: string): ExtensionFactory {
  return () => {
    try {
      holder.keys = readJson(resolve(configDir, "keybindings.json"));
    } catch (error) {
      // Pi reports a throwing factory only as a load error; keep the code.
      holder.keyError = error as StoreError;
      throw error;
    }
  };
}

/** The required extension that turns Pi's events into the timeline. */
function projection(holder: Holder): ExtensionFactory {
  return (pi) => {
    pi.on("model_select", (event) => {
      const model = modelName(event.model);
      const previous = event.previousModel ? modelName(event.previousModel) : undefined;
      const runtime = holder.runtime;
      if (!runtime) {
        holder.events.push({ type: "model_changed", previous, model });
        return;
      }
      runtime.store.timeline.reduce({ type: "model_changed", previous, model });
      runtime.store.items();
      runtime.store.setSession({ model, thinking: runtime.session.thinkingLevel });
    });
  };
}

/** The required extension that holds a paused run between steps; see control.ts. */
function gates(holder: Holder): ExtensionFactory {
  const gate = (ctx: ExtensionContext) => holder.runtime?.control.gate(ctx.signal) ?? true;
  return (pi) => {
    pi.on("tool_call", async (event, ctx) => {
      // A nested call's parent already started, and waits for it.
      if ((event as { parentToolCallId?: string }).parentToolCallId !== undefined) return undefined;
      return (await gate(ctx)) ? undefined : { block: true, reason: "keel stopped the run" };
    });
    pi.on("turn_end", async (_event, ctx) => {
      await gate(ctx);
      return undefined;
    });
    pi.on("agent_start", async (_event, ctx) => {
      await gate(ctx);
    });
    pi.on("turn_start", async (_event, ctx) => {
      await gate(ctx);
    });
    pi.on("session_before_compact", async (event, ctx) => {
      if (event.reason === "manual") return undefined;
      return (await gate(ctx)) ? undefined : { cancel: true };
    });
  };
}

/**
 * Pi's standard UI, unrendered: every call is logged by name and title, and
 * answers what Pi's own UI-less context answers, so nothing waits on it.
 * Passing a context at all makes Pi report `ctx.hasUI` as true; keel's UI is
 * reached through `keel(ctx)` instead, which extensions call explicitly.
 */
function uiStub(none: ExtensionUIContext, log: (line: string) => void): ExtensionUIContext {
  const stub: Record<string, unknown> = {};
  for (const key of Object.keys(none) as (keyof ExtensionUIContext)[]) {
    const value = (none as unknown as Record<string, unknown>)[key];
    if (typeof value !== "function") continue;
    stub[key] = (...args: unknown[]) => {
      const title = typeof args[0] === "string" ? args[0].slice(0, 60) : "";
      log(`keel: ctx.ui.${key}(${title ? JSON.stringify(title) : ""}) is not shown by keel`);
      return (value as (...args: unknown[]) => unknown).apply(none, args);
    };
  }
  Object.defineProperty(stub, "theme", { get: () => none.theme, enumerable: true });
  return stub as unknown as ExtensionUIContext;
}
