/**
 * Runs a real keel driver in the test process against Pi's faux provider, in a temporary
 * configuration directory. Its records are followed as the model receives them, and a
 * stand-in answers its operations with the model's records, validated against the contract;
 * the stand-in keeps no model state beyond what the answers need. What the model decides
 * (writers, drafts, requests, projection) is tested in Elixir against the real model; this
 * covers what only the driver does. Nothing touches the user's configuration or credentials.
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
import { validator } from "../protocol/contract";
import type {
  DriverRecord,
  DriverResult,
  Entry,
  Instruction,
  Operation,
  QueueInfo,
  RequestAnswer,
  RunInfo,
} from "../protocol/wire";
import { contentText } from "./content";
import { type Bundled, Driver } from "./driver";
import { ModelLink } from "./link";

type OpenRequest = Extract<Operation, { op: "open_request" }> & { id: string };

export interface Harness {
  driver: Driver;
  records: DriverRecord[];
  /** The entries as the model would hold them, in order. */
  entries(): Entry[];
  run(): RunInfo;
  queue(): QueueInfo;
  /** The operations the driver sent the model, of kind `op`, in order. */
  operations<K extends Operation["op"]>(op: K): Extract<Operation, { op: K }>[];
  /** Gives the driver the results of the operations held back. */
  releaseHeld(): void;
  /** Requests the driver opened and the model has not closed. */
  requests: Map<string, OpenRequest>;
  /** Action ids the driver declared and has not withdrawn, with where they run. */
  actions(): Map<string, "driver" | "screen">;
  logs: string[];
  started: string[];
  /** Runs a driver action as the model would, for a connection it judged a writer or not. */
  action(id: string, args?: unknown, writer?: boolean): Promise<DriverResult>;
  submit(text: string): Promise<DriverResult>;
  query(assist: string, text: string): Promise<DriverResult>;
  /** Closes a request as the model does when it is answered. */
  answer(request: string, answer: RequestAnswer): void;
  /** Resolves once `check` holds. */
  until(check: () => boolean, timeout?: number): Promise<void>;
  /** Releases the `wait` tool's current call. */
  release(): void;
  dispose(): Promise<void>;
}

/**
 * The faux provider as an extension, with a `wait` tool that blocks until the test releases
 * it.
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
  /** Action ids the stand-in refuses to declare, as the model refuses a taken id. */
  refuse?: string[];
  /** Kinds of operations whose results are held back until `releaseHeld`. */
  hold?: string[];
  /** Closes every request right after it opened, in the same read as its id. */
  answerOnOpen?: RequestAnswer;
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
  const records: DriverRecord[] = [];
  const logs: string[] = [];
  const started: string[] = [];
  const gate: { open?: () => void } = {};
  const entries = new Map<string, Entry>();
  let order: string[] = [];
  let run: RunInfo = { phase: "idle", compacting: false, retrying: false };
  let queue: QueueInfo = { steering: [], followUp: [] };
  const requests = new Map<string, OpenRequest>();
  const declared = new Map<string, { runs: "driver" | "screen"; registration: string }>();
  const assists = new Map<string, string>();
  const results = new Map<string, (result: DriverResult) => void>();
  let next = 0;

  let link: ModelLink;
  // Instructions the stand-in gives in one step reach the driver in one read, as the model's
  // records of one step reach its stdin: one after another, with no task between them.
  const batch: Instruction[] = [];
  const instruct = (instruction: Instruction) => {
    if (batch.length === 0)
      queueMicrotask(() => {
        for (const line of batch.splice(0)) link.receive(JSON.stringify(line));
      });
    batch.push(instruction);
  };
  const held: Instruction[] = [];
  const ok = (id: string, value: object, op: string) => {
    const result: Instruction = { type: "operation_result", id, outcome: "ok", value };
    if (options.hold?.includes(op)) held.push(result);
    else instruct(result);
  };
  const close = (request: string, answer: RequestAnswer) => {
    if (!requests.delete(request)) return;
    instruct({ type: "request_closed", request, answer });
  };

  const model = (record: DriverRecord) => {
    if (!validator("DriverRecord").Check(record))
      throw new Error(`the driver wrote an invalid record: ${JSON.stringify(record)}`);
    records.push(structuredClone(record));
    switch (record.type) {
      case "entries":
        for (const entry of record.entries) {
          if (!entries.has(entry.id) && !record.order) order.push(entry.id);
          entries.set(entry.id, entry);
        }
        if (record.order) order = [...record.order];
        return;
      case "status":
        if (record.run) run = record.run;
        if (record.queue) queue = record.queue;
        return;
      case "result":
        results.get(record.id)?.(record.result);
        results.delete(record.id);
        return;
      case "operation":
        return operation(record.id, record.operation);
      default:
        return;
    }
  };

  // Answers shaped as the model's records are; whether an operation is right is the model's
  // to decide and is tested there. Only ids the test names are refused.
  const operation = (id: string, op: Operation) => {
    const registration = `g${next++}`;
    switch (op.op) {
      case "declare_actions": {
        const refused = op.actions.find((action) => options.refuse?.includes(action.id));
        if (refused) {
          instruct({
            type: "operation_result",
            id,
            outcome: "rejected",
            code: "invalid_declaration",
            message: `declaring actions failed: ${refused.id}`,
          });
          return;
        }
        for (const action of op.actions)
          declared.set(action.id, { runs: action.runs, registration });
        return ok(id, { registration }, op.op);
      }
      case "declare_assist":
        assists.set(op.id, registration);
        return ok(id, { registration }, op.op);
      case "withdraw":
        for (const [action, entry] of declared)
          if (entry.registration === op.registration) declared.delete(action);
        for (const [assist, owner] of assists)
          if (owner === op.registration) assists.delete(assist);
        return ok(id, {}, op.op);
      case "list_assists":
        return ok(id, { assists: [...assists.keys()] }, op.op);
      case "set_draft":
      case "append_draft":
        return ok(id, { revision: next }, op.op);
      case "open_request": {
        const request = `r${next}`;
        requests.set(request, { ...op, id: request });
        ok(id, { request }, op.op);
        if (options.answerOnOpen) close(request, options.answerOnOpen);
        return;
      }
      case "cancel_request":
        ok(id, {}, op.op);
        return close(op.request, { status: "cancelled" });
      case "cancel_requests":
        ok(id, {}, op.op);
        for (const request of requests.keys()) close(request, { status: "cancelled" });
        return;
      default:
        return ok(id, { registration }, op.op);
    }
  };

  link = new ModelLink(model, (code, message) => {
    throw new Error(`${code}: ${message}`);
  });
  const ask = (instruction: Instruction & { id: string }) =>
    new Promise<DriverResult>((resolve) => {
      results.set(instruction.id, resolve);
      instruct(instruction);
    });
  const driver = await Driver.start({
    cwd,
    configDir,
    link,
    bundled: {
      ...bundledExtensions(),
      fixture: fixture(options.responses ?? [], { started, gate }, options.model ?? {}),
      ...options.bundled,
    },
    log: (line) => logs.push(line),
  });
  return {
    driver,
    records,
    entries: () => order.map((id) => entries.get(id)!),
    run: () => run,
    queue: () => queue,
    operations: (op) =>
      records.flatMap((record) =>
        record.type === "operation" && record.operation.op === op
          ? [record.operation as never]
          : [],
      ),
    releaseHeld: () => {
      for (const result of held.splice(0)) instruct(result);
    },
    requests,
    actions: () => new Map([...declared].map(([id, entry]) => [id, entry.runs])),
    logs,
    started,
    action: (action, args, writer = true) =>
      ask({
        type: "run_action",
        id: `i${next++}`,
        action,
        ...(args === undefined ? {} : { args }),
        connection: "a",
        writer,
      }),
    submit: (text) => ask({ type: "submit", id: `i${next++}`, text }),
    query: (assist, text) => ask({ type: "query_assist", id: `i${next++}`, assist, text }),
    answer: close,
    until,
    release: () => {
      const open = gate.open;
      gate.open = undefined;
      open?.();
    },
    dispose: () => driver.dispose(),
  };
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

/** The text a response entry holds, its text parts joined. */
export const said = (entry: Entry) =>
  entry.kind === "assistant" ? contentText(entry.parts) : undefined;

/** Whether a response said `text`. */
export const responded = (h: Harness, text: string) =>
  h.entries().some((entry) => said(entry) === text);

/** The tool entries named `name`. */
export const tools = (h: Harness, name: string) =>
  h
    .entries()
    .filter(
      (entry): entry is Extract<Entry, { kind: "tool" }> =>
        entry.kind === "tool" && entry.name === name,
    );

/** The texts of the user entries. */
export const prompts = (h: Harness) =>
  h.entries().flatMap((entry) => (entry.kind === "user" ? [entry.text] : []));

/** The texts of the notice entries. */
export const notices = (h: Harness) =>
  h.entries().flatMap((entry) => (entry.kind === "notice" ? [entry.text] : []));
