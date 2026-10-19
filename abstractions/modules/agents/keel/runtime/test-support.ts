/**
 * Runs a real keel runtime in the test process against Pi's faux provider,
 * in a temporary configuration directory, and follows what it emits the way
 * a screen does. Nothing touches the user's configuration or credentials.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  type FauxResponseStep,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { bundledExtensions } from "../extensions";
import { Mirror } from "../protocol/apply";
import type { InvokeResult, RuntimeOutput } from "../protocol/wire";
import { type Bundled, Runtime } from "./host";

export interface Harness {
  runtime: Runtime;
  records: RuntimeOutput[];
  mirror: Mirror;
  logs: string[];
  configDir: string;
  /**
   * Sends an invoke as `connection`, which saw `writerEpoch` (the current one
   * when omitted, none when null), and resolves with the runtime's result.
   */
  invoke(
    action: string,
    args?: unknown,
    connection?: string,
    writerEpoch?: number | null,
  ): Promise<InvokeResult>;
  writer(connection: string | null): void;
  /** Resolves once `check` holds for the mirrored state. */
  until(check: (mirror: Mirror) => boolean, timeout?: number): Promise<void>;
  /** Releases the `wait` tool's current call. */
  release(): void;
  started: string[];
  dispose(): Promise<void>;
}

/**
 * The faux provider as an extension, with a `wait` tool that blocks until the
 * test releases it, and an `ask` tool that waits for a keel request.
 */
function fixture(
  responses: FauxResponseStep[],
  hooks: { started: string[]; gate: { open?: () => void } },
  model: { contextWindow?: number; maxTokens?: number },
): ExtensionFactory {
  return (pi) => {
    const faux = fauxProvider({
      provider: "faux",
      models: [{ id: "faux", reasoning: true, ...model }],
    });
    faux.setResponses(responses);
    pi.registerProvider(faux.provider);
    pi.registerTool({
      name: "wait",
      label: "Wait",
      description: "Waits until the test releases it",
      parameters: Type.Object({}),
      async execute(id, _args, signal) {
        hooks.started.push(id);
        await new Promise<void>((resolve, reject) => {
          hooks.gate.open = resolve;
          signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
        return { content: [{ type: "text", text: `waited ${id}` }], details: {} };
      },
    });
  };
}

export async function harness(options: {
  responses?: FauxResponseStep[];
  /** Extension names or paths for extensions.json; the fixture is always listed first. */
  extensions?: string[];
  settings?: Record<string, unknown>;
  keybindings?: unknown;
  bundled?: Record<string, Bundled>;
  files?: Record<string, string>;
  cwd?: string;
  model?: { contextWindow?: number; maxTokens?: number };
  /** Sees every record the runtime writes, after this harness followed it. */
  observe?: (record: RuntimeOutput) => void;
}): Promise<Harness> {
  const configDir = mkdtempSync(join(tmpdir(), "keel-config-"));
  const cwd = options.cwd ?? mkdtempSync(join(tmpdir(), "keel-cwd-"));
  writeFileSync(
    join(configDir, "settings.json"),
    JSON.stringify({ defaultProvider: "faux", defaultModel: "faux", ...options.settings }),
  );
  writeFileSync(join(configDir, "models.json"), JSON.stringify({ providers: {} }));
  writeFileSync(
    join(configDir, "extensions.json"),
    JSON.stringify({ extensions: ["fixture", ...(options.extensions ?? [])] }),
  );
  if (options.keybindings !== undefined)
    writeFileSync(join(configDir, "keybindings.json"), JSON.stringify(options.keybindings));
  for (const [name, text] of Object.entries(options.files ?? {})) {
    mkdirSync(dirname(join(configDir, name)), { recursive: true });
    writeFileSync(join(configDir, name), text);
  }
  const records: RuntimeOutput[] = [];
  const mirror = new Mirror();
  const logs: string[] = [];
  const started: string[] = [];
  const gate: { open?: () => void } = {};
  const pending = new Map<string, (result: InvokeResult) => void>();
  let next = 0;
  let snapshotWaiter: (() => void) | undefined;
  const emit = (record: RuntimeOutput) => {
    records.push(structuredClone(record));
    if (record.type === "snapshot") {
      mirror.reset(record.snapshot);
      snapshotWaiter?.();
    } else if (record.type === "event" && mirror.state) mirror.apply(record.event);
    else if (record.type === "result") pending.get(record.id)?.(record.result);
    options.observe?.(record);
  };
  const runtime = await Runtime.start({
    cwd,
    configDir,
    emit,
    bundled: {
      ...bundledExtensions(),
      fixture: fixture(options.responses ?? [], { started, gate }, options.model ?? {}),
      ...options.bundled,
    },
    log: (line) => logs.push(line),
  });
  await new Promise<void>((resolve) => {
    snapshotWaiter = resolve;
    runtime.handle({ type: "snapshot_request", id: "s0" });
  });
  runtime.handle({ type: "writer", connection: "a", epoch: 1 });
  const h: Harness = {
    runtime,
    records,
    mirror,
    logs,
    configDir,
    started,
    invoke: (action, args, connection = "a", writerEpoch) =>
      new Promise((resolve) => {
        const id = `i${next++}`;
        pending.set(id, resolve);
        const epoch = writerEpoch === undefined ? runtime.writer.epoch : (writerEpoch ?? undefined);
        runtime.handle({
          type: "invoke",
          id,
          connection,
          invoke: { action, args, writerEpoch: epoch },
        });
      }),
    writer: (connection) =>
      runtime.handle({ type: "writer", connection, epoch: runtime.writer.epoch + 1 }),
    until: (check, timeout) => until(() => check(mirror), timeout),
    release: () => {
      const open = gate.open;
      gate.open = undefined;
      open?.();
    },
    dispose: () => runtime.dispose(),
  };
  return h;
}

/** Resolves once `check` holds, polling; fails after `timeout` milliseconds. */
export async function until(check: () => boolean, timeout = 5000): Promise<void> {
  const end = Date.now() + timeout;
  while (!check()) {
    if (Date.now() > end) throw new Error("condition not reached");
    await Bun.sleep(5);
  }
}

/** A model response that calls one tool. */
export const call = (name: string, id: string, args: Record<string, string> = {}) =>
  fauxAssistantMessage(fauxToolCall(name, args, { id }), { stopReason: "toolUse" });

/** Types the prompt as the writer and sends it, as a screen does. */
export async function send(h: Harness, text: string): Promise<InvokeResult> {
  const draft = h.mirror.state!.drafts.prompt!;
  const set = await h.invoke("draft.set", { destination: "prompt", text, base: draft.revision });
  if (set.outcome === "rejected") return set;
  const revision = (set.detail as { revision: number }).revision;
  return h.invoke("editor.submit", { destination: "prompt", revision });
}
