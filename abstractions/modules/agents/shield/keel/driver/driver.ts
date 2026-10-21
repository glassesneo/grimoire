/**
 * The keel driver: one Pi SDK session for one hub agent. It reads the configuration
 * directory, loads only the extensions keel requires and the ones `extensions.json` lists,
 * reports Pi's meaning to keel's model as entries, and carries out what the model tells it:
 * actions an extension declared, sending a prompt, computing an assist's candidates, and
 * closing a request an extension waits for. The model, in the hub, owns every piece of state
 * screens show and decides who may run what; the driver keeps the functions extensions
 * declared, the promises they wait on, and Pi's control (`control.ts`).
 *
 * Configuration directory. Pi reads its settings.json, models.json, and auth.json there as
 * its agent directory. keel reads:
 *   extensions.json   {"extensions": [...]}: a bundled extension's name (lowercase letters,
 *                     digits, and hyphens), or else a file path, absolute or relative to the
 *                     directory, such as `mine.ts`. Absent means none.
 *   keybindings.json  action id to a key or a list of keys, which the model applies.
 *                     Absent means the defaults.
 * A file that exists but is not valid JSON of that shape stops the driver before it is
 * ready. Pi's own extension discovery (settings, packages, project directories) is off, and a
 * loaded extension keel did not ask for fails the start as well.
 *
 * Changes made in one synchronous step reach the model together: entries and the run, queue,
 * and session are sent at the end of the current task, and before any other record, so a
 * result follows the changes its operation made.
 */
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
import {
  type ActionDefinition,
  type AssistProvider,
  installHost,
  type KeelContext,
  type Registration,
  type RequestAnswer,
} from "../api";
import { validator, firstError } from "../protocol/contract";
import { modelName } from "../protocol/format";
import type { NoticeLevel } from "../protocol/items";
import type { Instruction, Operation, OperationValue, SessionInfo } from "../protocol/wire";
import { coreActions } from "./core-actions";
import { Control } from "./control";
import type { ModelLink } from "./link";
import { Accepted, Rejection } from "./outcome";
import { Timeline, type TimelineEvent } from "./timeline";

/** A bundled extension: code inside the driver, or a file shipped with it. */
export type Bundled = ExtensionFactory | { path: string };

export interface DriverOptions {
  cwd: string;
  configDir: string;
  /** Where Pi writes the session file; in memory when omitted. */
  sessionDir?: string;
  link: ModelLink;
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
    throw new Rejection("config_unreadable", `${path}: ${error?.message ?? error}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Rejection("config_invalid", `${path}: ${(error as Error).message}`);
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
    throw new Rejection("config_invalid", `${path}: expected {"extensions": [names or paths]}`);
  return list;
}

/**
 * A promise that rejects for whoever waits on it, and is not an unhandled rejection when
 * nobody does: the model already shows its refusals in the timeline.
 */
function quiet<T>(promise: Promise<T>): Promise<T> {
  promise.catch(() => {});
  return promise;
}

export class Driver {
  readonly control: Control;
  readonly session: AgentSession;
  readonly timeline: Timeline;
  readonly #link: ModelLink;
  #info: SessionInfo;
  #infoChanged = false;
  #statusChanged = false;
  #scheduled = false;
  /** Declared actions with code here, by id; a withdrawn one is removed and runs no more. */
  readonly #actions = new Map<string, ActionDefinition>();
  readonly #assists = new Map<string, { provider: AssistProvider }>();
  /** Requests extensions wait on, by the model's id. */
  readonly #requests = new Map<string, (answer: RequestAnswer<unknown>) => void>();
  #uninstall: () => void = () => {};
  #unsubscribe: () => void = () => {};

  private constructor(parts: {
    session: AgentSession;
    timeline: Timeline;
    link: ModelLink;
    info: SessionInfo;
  }) {
    this.session = parts.session;
    this.timeline = parts.timeline;
    this.#link = parts.link;
    this.#info = parts.info;
    this.control = new Control(parts.session, {
      changed: () => this.#changed("status"),
      setDraft: (destination, text) => this.#setDraft("set_draft", destination, text),
      appendDraft: (destination, text) => this.#setDraft("append_draft", destination, text),
      notice: (level, text) => this.timeline.notice(level, text),
      cancelRequests: async () => {
        await this.#link.operation({ op: "cancel_requests" });
      },
    });
    this.timeline.onChange = () => this.#changed("entries");
    this.#link.beforeWrite = () => this.flush();
  }

  static async start(options: DriverOptions): Promise<Driver> {
    const log = options.log ?? ((line: string) => process.stderr.write(`${line}\n`));
    const { cwd, configDir, link } = options;
    const requested = extensionList(configDir);
    const notices: { level: "warning" | "error"; text: string }[] = [];

    // The driver's parts exist once the session does; the required extensions reach them
    // through this holder, which is filled before Pi binds them.
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
            throw new Rejection(
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
        throw new Rejection("required_extension_failed", `${error.path}: ${error.error}`);
      notices.push({ level: "error", text: `extension ${error.path}: ${error.error}` });
    }
    for (const warning of loaded.warnings ?? [])
      notices.push({ level: "warning", text: `extension ${warning.path}: ${warning.warning}` });
    for (const name of REQUIRED)
      if (!loaded.extensions.some((extension) => extension.path === `<inline:${name}>`))
        throw new Rejection("required_extension_failed", `${name} was not loaded`);
    for (const diagnostic of services.diagnostics)
      notices.push({
        level: diagnostic.type === "error" ? "error" : "warning",
        text: diagnostic.message,
      });

    // A provider an extension registers starts its own availability check without waiting
    // (ModelRuntime.registerNativeProvider in pi-coding-agent 1.1.0), and a later check
    // supersedes the one createAgentSessionServices awaited, which then leaves the model list
    // as it was. This check starts after both, so the session chooses its model from a
    // finished list.
    await services.modelRuntime.refresh({ allowNetwork: false });
    const sessionManager = options.sessionDir
      ? SessionManager.create(cwd, options.sessionDir)
      : SessionManager.inMemory(cwd);
    const { session, modelFallbackMessage } = await createAgentSessionFromServices({
      services,
      sessionManager,
    });
    if (modelFallbackMessage) notices.push({ level: "warning", text: modelFallbackMessage });

    const model = session.model ? modelName(session.model) : undefined;
    const timeline = new Timeline({ model, thinking: model ? session.thinkingLevel : undefined });
    const driver = new Driver({
      session,
      timeline,
      link,
      info: {
        id: session.sessionId,
        cwd,
        model: model ?? null,
        thinking: model ? session.thinkingLevel : null,
      },
    });
    for (const notice of notices) timeline.notice(notice.level, notice.text);
    driver.#unsubscribe = session.subscribe((event) => {
      try {
        timeline.reduce(event as TimelineEvent);
        driver.control.observe(event as { type: string });
        if (event.type === "thinking_level_changed") driver.#setInfo({ thinking: event.level });
      } catch (error) {
        log(`keel: event ${event.type} failed: ${String(error)}`);
      }
    });
    driver.#uninstall = installHost({
      context: (ctx) => {
        if (ctx.sessionManager.getSessionId() !== session.sessionId)
          throw new Error("keel(ctx) was given a context of another session");
        return driver.#context();
      },
    });
    try {
      holder.driver = driver;
      for (const event of holder.events.splice(0)) timeline.reduce(event);
      link.install({ instruction: (instruction) => driver.#handle(instruction) });
      await driver.#registerActions(
        coreActions(driver.control, (level, text) => timeline.notice(level, text)),
      );
      await session.bindExtensions({
        uiContext: uiStub(session.extensionRunner.getUIContext(), log),
        // keel does not render Pi's UI; see uiStub.
        mode: "print",
        // keel keeps one session for the driver's life: what would replace or reload it
        // reports itself cancelled instead of Pi's default success.
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
          timeline.notice("error", text);
        },
        shutdownHandler: () =>
          log("keel: an extension asked to shut down; stop the agent from the hub"),
      });
      // Every extension declared what it declares while Pi bound them.
      link.send({
        type: "ready",
        session: driver.#info,
        ...(holder.keys === undefined ? {} : { keys: holder.keys }),
      });
      return driver;
    } catch (error) {
      driver.#uninstall();
      driver.#unsubscribe();
      throw error;
    }
  }

  #changed(what: "entries" | "status") {
    if (what === "status") this.#statusChanged = true;
    if (this.#scheduled) return;
    this.#scheduled = true;
    queueMicrotask(() => this.flush());
  }

  #setInfo(changes: Partial<SessionInfo>) {
    const next = { ...this.#info, ...changes };
    if (JSON.stringify(next) === JSON.stringify(this.#info)) return;
    this.#info = next;
    this.#infoChanged = true;
    this.#changed("status");
  }

  /** Sends the batched changes. */
  flush(): void {
    this.#scheduled = false;
    const entries = this.timeline.take();
    if (entries) this.#link.send({ type: "entries", ...entries });
    if (this.#statusChanged) {
      this.#statusChanged = false;
      this.#link.send({
        type: "status",
        run: this.control.run,
        queue: this.control.queue,
        ...(this.#infoChanged ? { session: this.#info } : {}),
      });
      this.#infoChanged = false;
    }
  }

  // -------------------------------------------------------------------------
  // Instructions from the model
  // -------------------------------------------------------------------------

  #handle(instruction: Exclude<Instruction, { type: "operation_result" }>): void {
    switch (instruction.type) {
      case "run_action":
        void this.#run(instruction);
        return;
      case "submit":
        void this.control
          .submit(instruction.text)
          .then((result) => this.#link.result(instruction.id, result));
        return;
      case "query_assist":
        void this.#query(instruction.id, instruction.assist, instruction.text);
        return;
      case "request_closed":
        this.#close(instruction.request, instruction.answer as RequestAnswer<unknown>);
        return;
    }
  }

  #close(id: string, answer: RequestAnswer<unknown>): void {
    const resolve = this.#requests.get(id);
    if (!resolve) return;
    this.#requests.delete(id);
    resolve(answer);
    // An answered request resumes a run that is held.
    if (answer.status === "answered") this.control.resumePaused();
  }

  async #run(instruction: Extract<Instruction, { type: "run_action" }>): Promise<void> {
    const entry = this.#actions.get(instruction.action);
    if (!entry?.run) {
      this.#link.result(instruction.id, {
        outcome: "rejected",
        code: "unknown_action",
        message: `no action ${instruction.action} in the driver`,
      });
      return;
    }
    try {
      const detail = await entry.run({
        args: instruction.args,
        connection: instruction.connection,
        writer: instruction.writer,
      });
      this.#link.result(
        instruction.id,
        detail instanceof Accepted
          ? {
              outcome: "accepted",
              ...(detail.detail === undefined ? {} : { detail: detail.detail }),
            }
          : { outcome: "done", ...(detail === undefined ? {} : { detail }) },
      );
    } catch (error) {
      this.#link.result(
        instruction.id,
        error instanceof Rejection
          ? {
              outcome: "rejected",
              code: error.code,
              ...(error.message !== error.code ? { message: error.message } : {}),
            }
          : {
              outcome: "rejected",
              code: "failed",
              message: error instanceof Error ? error.message : String(error),
            },
      );
    }
  }

  async #query(id: string, assist: string, text: string): Promise<void> {
    const entry = this.#assists.get(assist);
    if (!entry) {
      this.#link.result(id, { outcome: "rejected", code: "unknown_assist" });
      return;
    }
    try {
      const candidates = [...(await entry.provider.candidates(text))];
      const result = { outcome: "candidates" as const, candidates };
      // What an extension computed must not make the driver's record invalid.
      if (!validator("DriverResult").Check(result))
        throw new Error(`invalid candidates: ${firstError("DriverResult", result)}`);
      this.#link.result(id, result);
    } catch (error) {
      this.#link.result(id, {
        outcome: "rejected",
        code: "failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // -------------------------------------------------------------------------
  // Operations on the model
  // -------------------------------------------------------------------------

  async #setDraft(op: "set_draft" | "append_draft", destination: string, text: string) {
    await this.#link.operation({ op, destination, text });
  }

  #withdraw(registration: string, local: () => void): Registration {
    return {
      dispose: async () => {
        local();
        await this.#link.operation({ op: "withdraw", registration });
      },
    };
  }

  /** Installs the functions first, then declares; a refusal takes them back. */
  #registerActions(definitions: readonly ActionDefinition[]): Promise<Registration> {
    const installed = definitions.filter(
      (definition) => definition.run && !this.#actions.has(definition.id),
    );
    for (const definition of installed) this.#actions.set(definition.id, definition);
    return this.#declare(
      {
        op: "declare_actions",
        actions: definitions.map((definition) => ({
          id: definition.id,
          ...(definition.class ? { class: definition.class } : {}),
          ...(definition.title ? { title: definition.title } : {}),
          ...(definition.keys ? { keys: [...definition.keys] } : {}),
          runs: definition.run ? ("driver" as const) : ("screen" as const),
        })),
      },
      () => {
        for (const definition of installed)
          if (this.#actions.get(definition.id) === definition) this.#actions.delete(definition.id);
      },
    );
  }

  #registerAssist(provider: AssistProvider): Promise<Registration> {
    const installed = !this.#assists.has(provider.id);
    const entry = { provider };
    if (installed) this.#assists.set(provider.id, entry);
    return this.#declare({ op: "declare_assist", id: provider.id, title: provider.title }, () => {
      if (this.#assists.get(provider.id) === entry) this.#assists.delete(provider.id);
    });
  }

  /** Declares to the model; `remove` takes back what was installed, on a refusal or withdrawal. */
  #declare(operation: Operation, remove: () => void = () => {}): Promise<Registration> {
    return quiet(
      this.#link.operation(operation).then(
        (value) => this.#withdraw(value.registration!, remove),
        (error) => {
          remove();
          throw error;
        },
      ),
    );
  }

  #request<T>(
    kind: "choice" | "confirm",
    options: { title: string; message?: string; signal?: AbortSignal; supplement?: boolean },
    choices: string[],
  ): Promise<RequestAnswer<T>> {
    const { signal } = options;
    // Requests made while stopping are cancelled at once.
    if (this.control.phase === "stopping" || signal?.aborted)
      return Promise.resolve({ status: "cancelled" });
    return new Promise((resolve, reject) => {
      // The request is known by its id as soon as the model answers, so a close that comes in
      // the same read as the id finds it.
      const opened = (value: OperationValue) => {
        const id = value.request!;
        const onAbort = () =>
          void this.#link.operation({ op: "cancel_request", request: id }).catch(() => {});
        this.#requests.set(id, (answer) => {
          signal?.removeEventListener("abort", onAbort);
          resolve(answer as RequestAnswer<T>);
        });
        if (signal?.aborted) onAbort();
        else signal?.addEventListener("abort", onAbort, { once: true });
      };
      this.#link
        .operation(
          {
            op: "open_request",
            kind,
            title: options.title,
            ...(options.message === undefined ? {} : { message: options.message }),
            options: choices,
            supplement: options.supplement ?? true,
          },
          opened,
        )
        .catch(reject);
    });
  }

  #context(): KeelContext {
    const { control, timeline } = this;
    return {
      actions: { register: (definitions) => this.#registerActions(definitions) },
      items: {
        present: (kind, renderer) => this.#declare({ op: "present", kind, renderer }),
        decorateTool: (tool, owner, decorate) => ({
          dispose: timeline.decorate(tool, owner, decorate),
        }),
        notice: (level: NoticeLevel, text: string) => timeline.notice(level, text),
      },
      requests: {
        choice: (options) => this.#request("choice", options, [...options.options]),
        confirm: (options) => this.#request("confirm", options, ["Yes", "No"]),
      },
      drafts: { set: (destination, text) => quiet(this.#setDraft("set_draft", destination, text)) },
      assists: {
        register: (provider) => this.#registerAssist(provider),
        list: async () => (await this.#link.operation({ op: "list_assists" })).assists ?? [],
        query: async (id, text) => {
          const entry = this.#assists.get(id);
          if (!entry) throw new Rejection("unknown_assist");
          return entry.provider.candidates(text);
        },
      },
      run: { info: () => control.run },
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

  /**
   * Ends the driver: nothing more reaches the model, the requests extensions wait on are
   * cancelled, and Pi is aborted.
   */
  async dispose(reason = "disposed"): Promise<void> {
    this.#link.end(reason);
    for (const resolve of this.#requests.values()) resolve({ status: "cancelled" });
    this.#requests.clear();
    this.#unsubscribe();
    this.#uninstall();
    if (!this.session.isIdle) await this.session.abort().catch(() => {});
    this.session.dispose();
  }

  /** Reports a model change Pi made. */
  modelChanged(model: string, previous: string | undefined): void {
    this.timeline.reduce({ type: "model_changed", previous, model });
    this.#setInfo({ model, thinking: this.session.thinkingLevel });
  }
}

interface Holder {
  driver?: Driver;
  /** Model changes Pi reported before the driver existed. */
  events: TimelineEvent[];
  /** The key configuration the keys extension read. */
  keys: unknown;
  keyError?: Rejection;
}

/** The required extension that reads `keybindings.json`, which the model applies. */
function keys(holder: Holder, configDir: string): ExtensionFactory {
  return () => {
    try {
      holder.keys = readJson(resolve(configDir, "keybindings.json"));
    } catch (error) {
      // Pi reports a throwing factory only as a load error; keep the code.
      holder.keyError = error as Rejection;
      throw error;
    }
  };
}

/** The required extension that follows model changes into the timeline. */
function projection(holder: Holder): ExtensionFactory {
  return (pi) => {
    pi.on("model_select", (event) => {
      const model = modelName(event.model);
      const previous = event.previousModel ? modelName(event.previousModel) : undefined;
      if (!holder.driver) {
        holder.events.push({ type: "model_changed", previous, model });
        return;
      }
      holder.driver.modelChanged(model, previous);
    });
  };
}

/** The required extension that holds a paused run between steps; see control.ts. */
function gates(holder: Holder): ExtensionFactory {
  const gate = (ctx: ExtensionContext) => holder.driver?.control.gate(ctx.signal) ?? true;
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
 * Pi's standard UI, unrendered: every call is logged by name and title, and answers what Pi's
 * own UI-less context answers, so nothing waits on it. Passing a context at all makes Pi
 * report `ctx.hasUI` as true; keel's UI is reached through `keel(ctx)` instead, which
 * extensions call explicitly.
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
