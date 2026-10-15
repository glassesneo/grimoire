/**
 * Admission: display records are the only place the harness keeps nested tool
 * results, and a wrong join shows results under the wrong call, leaks another
 * branch's data, or sends UI data to the model. Those depend on pi's real
 * persistence order and branch tree, so the tests run a real session with
 * pi's faux provider: a codemode parent that actually runs, calling a
 * temporary test tool and the read tool against a temporary directory.
 */
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { fixture } from "../ui/test-support";
import {
  DISPLAY_RECORD_TYPE,
  DisplayRecorder,
  parseDisplayRecord,
  readDisplayRecords,
} from "./display-records";
import { createFauxSession } from "./faux";
import { createSessionHost } from "./session";
import { restoreTimeline, type ToolEntry } from "./session-entries";

const directories: string[] = [];
afterEach(async () => {
  for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true });
});

const SCRIPT = [
  "const a = tools.probe({ label: 'second', delay: 30 });",
  "const b = tools.probe({ label: 'first', delay: 0 });",
  "const [x, y] = await Promise.all([a, b]);",
  "const file = await tools.read({ path: 'note.txt' });",
  "text(`script saw ${x} ${y}`);",
].join("\n");

async function setup(responses: Parameters<typeof createFauxSession>[0]["responses"]) {
  const cwd = await mkdtemp(join(tmpdir(), "harness-records-"));
  directories.push(cwd);
  await writeFile(join(cwd, "note.txt"), "file contents\n");
  const extension = join(cwd, "probe.js");
  await writeFile(
    extension,
    `
    export default function (pi) {
      pi.registerTool({
        name: "probe", label: "Probe", description: "Returns its label after a delay",
        parameters: { type: "object", properties: { label: { type: "string" }, delay: { type: "number" } } },
        async execute(_id, args) {
          await new Promise((resolve) => setTimeout(resolve, args.delay));
          return {
            content: [{ type: "text", text: "probe " + args.label }, { type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" }],
            details: { label: args.label },
          };
        },
      });
    }
  `,
  );
  const sessionDir = join(cwd, "sessions");
  const sessionManager = SessionManager.create(cwd, sessionDir);
  const { customization } = createFauxSession({ responses });
  const host = await createSessionHost({
    cwd,
    agentDir: join(cwd, "agent"),
    settingsManager: SettingsManager.inMemory({
      extensions: [extension],
      defaultTools: ["+codemode"],
      codemode: { mode: "only" },
    }),
    sessionManager,
    customization,
  });
  const ui = fixture();
  const notices: string[] = [];
  await host.bind({
    uiContext: ui.extension.context,
    onEvent: () => {},
    onExtensionError: (error) => notices.push(String(error.error)),
    onShutdownRequest: () => {},
    onHistoryReplaced: () => {},
    notify: (_, text) => notices.push(text),
  });
  return {
    cwd,
    sessionDir,
    sessionManager,
    host,
    notices,
    dispose: async () => {
      await host.dispose();
      ui.dispose();
    },
  };
}

const codemodeCall = (id: string) =>
  fauxAssistantMessage([fauxToolCall("codemode", { code: SCRIPT }, { id })], {
    stopReason: "toolUse",
  });

test("nested results survive reopening on their branch, in start order, outside the model's context", async () => {
  const run = await setup([codemodeCall("call-1"), fauxAssistantMessage("done")]);
  try {
    await run.host.runtime.session.prompt("go");
    await run.host.runtime.session.waitForIdle();
    const session = run.host.runtime.session;
    // Records are plain custom entries, which pi keeps out of model messages.
    const records = session.sessionManager
      .getBranch()
      .filter((entry) => entry.type === "custom" && entry.customType === DISPLAY_RECORD_TYPE);
    expect(records).toHaveLength(3);
    expect(JSON.stringify(session.messages)).not.toContain(DISPLAY_RECORD_TYPE);
    const context = JSON.stringify(session.sessionManager.buildSessionContext().messages);
    // The read result reached only the script, which did not print it.
    expect(context).not.toContain("file contents");
    expect(context).not.toContain(DISPLAY_RECORD_TYPE);
    const file = session.sessionManager.getSessionFile()!;
    await run.dispose();

    const reopened = SessionManager.open(file, run.sessionDir);
    const branch = reopened.getBranch();
    const entries = restoreTimeline(branch, readDisplayRecords(branch));
    const tools = entries.filter((entry): entry is ToolEntry => entry.kind === "tool");
    const root = tools.find((tool) => tool.parentId === undefined)!;
    expect(root.name).toBe("codemode");
    expect(root.state).toBe("done");
    const children = tools.filter((tool) => tool.parentId === root.id);
    // Start order, not completion order: "second" started first but ended last.
    expect(children.map((child) => child.name)).toEqual(["probe", "probe", "read"]);
    expect(
      children.map((child) =>
        child.args.available ? (child.args.value as { label?: string }).label : undefined,
      ),
    ).toEqual(["second", "first", undefined]);
    expect(children[0]!.result?.content).toEqual([
      { type: "text", text: "probe second" },
      { type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" },
    ]);
    expect(children[0]!.result?.details).toEqual({ label: "second" });
    expect(children[2]!.result?.content).toEqual([{ type: "text", text: "file contents\n" }]);
    // Each child follows its parent, and none repeats as a top-level item.
    expect(entries.indexOf(children[0]!)).toBe(entries.indexOf(root) + 1);
    expect(tools.filter((tool) => tool.callId === root.callId)).toHaveLength(1);
  } finally {
    await run.dispose();
  }
});

test("records of an abandoned branch stay there, and repeated call ids in another response do not collide", async () => {
  const run = await setup([
    codemodeCall("call-1"),
    fauxAssistantMessage("done"),
    codemodeCall("call-1"),
    fauxAssistantMessage("again"),
  ]);
  try {
    const session = run.host.runtime.session;
    const start = session.sessionManager.getLeafId();
    await session.prompt("first");
    await session.waitForIdle();
    const firstBranch = session.sessionManager.getBranch();
    // Return to before the first prompt and run the same call id again.
    if (start === null) session.sessionManager.resetLeaf();
    else session.sessionManager.branch(start);
    await session.prompt("second");
    await session.waitForIdle();

    const branch = session.sessionManager.getBranch();
    expect(branch.some((entry) => firstBranch.includes(entry) && entry.type === "custom")).toBe(
      false,
    );
    const entries = restoreTimeline(branch, readDisplayRecords(branch));
    const roots = entries.filter(
      (entry): entry is ToolEntry => entry.kind === "tool" && entry.parentId === undefined,
    );
    expect(roots).toHaveLength(1);
    const children = entries.filter(
      (entry): entry is ToolEntry => entry.kind === "tool" && entry.parentId === roots[0]!.id,
    );
    expect(children).toHaveLength(3);
    // The scope is the second response's own entry.
    expect(roots[0]!.scope).toBe(
      branch.find(
        (entry) =>
          entry.type === "message" &&
          entry.message.role === "assistant" &&
          entry.message.content.some((block) => block.type === "toolCall"),
      )!.id,
    );
  } finally {
    await run.dispose();
  }
});

test("sessions without records say what is unavailable instead of inventing results", () => {
  const manager = SessionManager.inMemory("/tmp");
  manager.appendMessage({ role: "user", content: "go", timestamp: 0 });
  manager.appendMessage(codemodeCall("call-1") as never);
  manager.appendMessage({
    role: "toolResult",
    toolCallId: "call-1",
    toolName: "codemode",
    isError: false,
    timestamp: 0,
    content: [{ type: "text", text: "Script completed\nWall time 0.1 seconds\nOutput:\n" }],
    nestedCalls: {
      complete: false,
      calls: [
        { id: "call-1/1", name: "probe", arguments: { label: "a" }, status: "ok" },
        { id: "call-1/2", name: "probe", argumentsBytes: 9000, status: "error", error: "boom" },
      ],
    },
  } as never);
  const branch = manager.getBranch();
  const entries = restoreTimeline(branch, readDisplayRecords(branch));
  const tools = entries.filter((entry): entry is ToolEntry => entry.kind === "tool");
  expect(tools[0]!.nestedIncomplete).toBe(true);
  expect(tools[1]!.result).toBeUndefined();
  expect(tools[1]!.state).toBe("done");
  expect(tools[2]!.args).toEqual({ available: false, bytes: 9000 });
  expect(tools[2]!.errorSummary).toBe("boom");
});

test("malformed and unknown records become a diagnostic without losing history", () => {
  const manager = SessionManager.inMemory("/tmp");
  const user = manager.appendMessage({ role: "user", content: "kept", timestamp: 0 });
  manager.appendCustomEntry(DISPLAY_RECORD_TYPE, { version: 2, recordId: "x" });
  manager.appendCustomEntry(DISPLAY_RECORD_TYPE, {
    version: 1,
    recordId: "y",
    revision: 0,
    originEntryId: user,
    kind: "retry",
    payload: { category: "nope" },
  });
  manager.appendCustomEntry(DISPLAY_RECORD_TYPE, {
    version: 1,
    recordId: "z",
    revision: 0,
    originEntryId: "elsewhere",
    kind: "compaction-status",
    payload: { state: "failed" },
  });
  const before = JSON.stringify(manager.getEntries());
  const branch = manager.getBranch();
  const entries = restoreTimeline(branch, readDisplayRecords(branch));
  expect(entries.some((entry) => entry.kind === "user" && entry.text === "kept")).toBe(true);
  const diagnostics = entries.filter((entry) => entry.kind === "notice");
  expect(diagnostics).toHaveLength(1);
  expect(JSON.stringify(diagnostics[0])).toContain("3 display records");
  expect(JSON.stringify(manager.getEntries())).toBe(before);
  expect("error" in parseDisplayRecord({ version: 1 })).toBe(true);
});

test("operations restore after their origin, latest revision once", () => {
  const manager = SessionManager.inMemory("/tmp");
  const user = manager.appendMessage({ role: "user", content: "go", timestamp: 0 });
  const record = (revision: number, state: string) => ({
    version: 1,
    recordId: "retry-1",
    revision,
    originEntryId: user,
    kind: "retry",
    payload: {
      category: "response",
      state,
      attempts: [{ attempt: 1, maxAttempts: 3, delayMs: 10, error: "overloaded" }],
    },
  });
  manager.appendCustomEntry(DISPLAY_RECORD_TYPE, record(0, "failed"));
  manager.appendCustomEntry(DISPLAY_RECORD_TYPE, record(1, "succeeded"));
  manager.appendCustomEntry(DISPLAY_RECORD_TYPE, record(1, "failed"));
  manager.appendMessage(fauxAssistantMessage("later") as never);
  const branch = manager.getBranch();
  const entries = restoreTimeline(branch, readDisplayRecords(branch));
  expect(entries.map((entry) => entry.kind)).toEqual(["user", "retry", "assistant"]);
  expect(entries[1]).toMatchObject({ state: "succeeded" });
});

test("a failed write restores the leaf, marks the entry unconfirmed, and stops writing", () => {
  const manager = SessionManager.inMemory("/tmp");
  const user = manager.appendMessage({ role: "user", content: "go", timestamp: 0 });
  const leaf = manager.getLeafId();
  let failures = 0;
  const failing = new Proxy(manager, {
    get(target, property, receiver) {
      if (property === "appendCustomEntry") {
        return (type: string, data: unknown) => {
          target.appendCustomEntry(type, data);
          throw new Error("disk full");
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const recorder = new DisplayRecorder(
    { sessionManager: failing },
    { notify: () => {}, onStorageFailure: () => failures++ },
  );
  recorder.observe({ type: "compaction_start", reason: "manual" });
  recorder.observe({
    type: "compaction_end",
    reason: "manual",
    result: undefined,
    aborted: false,
    willRetry: false,
    errorMessage: "too big",
  });
  recorder.flush();
  expect(failures).toBe(1);
  expect(recorder.storageFailed).toBe(true);
  expect(manager.getLeafId()).toBe(leaf);
  expect(recorder.unconfirmed.size).toBe(1);
  // In memory the entry exists but is off the branch and unconfirmed.
  const branch = manager.getBranch();
  expect(branch.map((entry) => entry.id)).toEqual([user]);
  recorder.observe({ type: "compaction_start", reason: "manual" });
  recorder.observe({
    type: "compaction_end",
    reason: "manual",
    result: undefined,
    aborted: true,
    willRetry: false,
  });
  recorder.flush();
  expect(failures).toBe(1);
});

test("a value that cannot be stored is reported and leaves the session untouched", () => {
  const manager = SessionManager.inMemory("/tmp");
  manager.appendMessage({ role: "user", content: "go", timestamp: 0 });
  const assistant = manager.appendMessage(
    fauxAssistantMessage([fauxToolCall("codemode", { code: "x" }, { id: "root" })]) as never,
  );
  const notices: string[] = [];
  const recorder = new DisplayRecorder(
    { sessionManager: manager },
    { notify: (_, text) => notices.push(text), onStorageFailure: () => {} },
  );
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  recorder.observe({
    type: "tool_execution_start",
    toolCallId: "root/1",
    toolName: "probe",
    args: cyclic,
    parentToolCallId: "root",
  });
  recorder.observe({
    type: "tool_execution_end",
    toolCallId: "root/1",
    toolName: "probe",
    result: { content: [], details: { big: 10n } },
    isError: false,
    parentToolCallId: "root",
  });
  recorder.flush();
  const records = manager.getBranch().filter((entry) => entry.type === "custom");
  // Unstorable arguments and details are left out rather than failing the record.
  expect(records).toHaveLength(1);
  const payload = (
    records[0] as { data: { originEntryId: string; payload: Record<string, unknown> } }
  ).data;
  expect(payload.originEntryId).toBe(assistant);
  expect("args" in payload.payload).toBe(false);
  expect("details" in payload.payload).toBe(false);
  expect(notices).toEqual([]);
});

test("a failed write on disk leaves the saved history intact, stops the session, and only a fresh reopen shows what reached the file", async () => {
  const run = await setup([
    codemodeCall("call-1"),
    fauxAssistantMessage("done"),
    fauxAssistantMessage("never sent"),
  ]);
  try {
    const session = run.host.runtime.session;
    const manager = session.sessionManager as SessionManager & { _persist(entry: unknown): void };
    // The file write is pi's private step; the record reaches the file and the
    // write then fails, as when storage fails after writing.
    const persist = manager._persist.bind(manager);
    const failedParents: (string | null)[] = [];
    manager._persist = (entry: unknown) => {
      persist(entry);
      const written = entry as { customType?: string; parentId: string | null };
      if (written.customType === DISPLAY_RECORD_TYPE) {
        failedParents.push(written.parentId);
        throw new Error("disk full");
      }
    };
    await session.prompt("go");
    await session.waitForIdle();
    expect(run.host.storageFailed).toBe(true);
    // One write failed, and nothing more was attempted.
    expect(failedParents).toHaveLength(1);
    // In memory, the leaf is back where the failed write started.
    expect(session.sessionManager.getLeafId()).toBe(failedParents[0]!);
    expect(session.sessionManager.getBranch().some((entry) => entry.type === "custom")).toBe(false);
    expect(
      run.host
        .history()
        .some(
          (entry) =>
            entry.kind === "tool" && entry.parentId !== undefined && entry.result !== undefined,
        ),
    ).toBe(false);
    const file = session.sessionManager.getSessionFile()!;

    // From disk, the history is whole, and the record that reached the file is read as written.
    const reopened = SessionManager.open(file, run.sessionDir);
    const branch = reopened.getBranch();
    const messages = (entries: typeof branch) =>
      entries.filter((entry) => entry.type === "message").map((entry) => entry.id);
    expect(messages(branch)).toEqual(messages(session.sessionManager.getBranch()));
    expect(branch.filter((entry) => entry.type === "custom")).toHaveLength(1);
  } finally {
    await run.dispose();
  }
});

test("branch usage counts the active branch only, and nested calls once", async () => {
  const { branchUsage } = await import("./usage");
  const usage = (input: number, cost: number) => ({
    input,
    output: 1,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: input + 1,
    cost: { input: cost, output: 0, cacheRead: 0, cacheWrite: 0, total: cost },
  });
  const manager = SessionManager.inMemory("/tmp");
  const root = manager.appendMessage({ role: "user", content: "go", timestamp: 0 });
  manager.appendMessage({ ...fauxAssistantMessage("abandoned"), usage: usage(100, 1) } as never);
  manager.branch(root);
  manager.appendMessage({
    ...fauxAssistantMessage([fauxToolCall("codemode", { code: "x" }, { id: "c" })]),
    usage: usage(10, 0.1),
  } as never);
  // A tool result's usage already includes its nested calls; records carry none.
  manager.appendMessage({
    role: "toolResult",
    toolCallId: "c",
    toolName: "codemode",
    content: [],
    isError: false,
    timestamp: 0,
    usage: usage(5, 0.05),
  } as never);
  manager.appendCustomEntry(DISPLAY_RECORD_TYPE, { usage: usage(1000, 10) });
  const totals = branchUsage(manager.getBranch());
  expect(totals.input).toBe(15);
  expect(totals.cost).toBeCloseTo(0.15);
});

test("restored configuration changes appear where they happened, the initial values not as changes", () => {
  const manager = SessionManager.inMemory("/tmp");
  manager.appendModelChange("faux", "one");
  manager.appendThinkingLevelChange("off");
  manager.appendMessage({ role: "user", content: "go", timestamp: 0 });
  manager.appendModelChange("faux", "two");
  manager.appendThinkingLevelChange("high");
  manager.appendMessage(fauxAssistantMessage("reply") as never);
  const branch = manager.getBranch();
  const entries = restoreTimeline(branch, readDisplayRecords(branch));
  expect(entries.map((entry) => entry.kind)).toEqual(["user", "config", "config", "assistant"]);
  expect(entries[1]).toMatchObject({ setting: "model", from: "faux/one", to: "faux/two" });
  expect(entries[2]).toMatchObject({ setting: "thinking", from: "off", to: "high" });
  // The response itself carries no added configuration label.
  expect(Object.keys(entries[3]!)).not.toContain("model");
});

test("one run reusing a root call id keeps each response's nested results apart", async () => {
  const run = await setup([
    codemodeCall("call-1"),
    codemodeCall("call-1"),
    fauxAssistantMessage("done"),
  ]);
  try {
    const session = run.host.runtime.session;
    await session.prompt("go");
    await session.waitForIdle();
    const branch = session.sessionManager.getBranch();
    expect(
      branch.filter((entry) => entry.type === "custom" && entry.customType === DISPLAY_RECORD_TYPE),
    ).toHaveLength(6);
    const entries = restoreTimeline(branch, readDisplayRecords(branch));
    const roots = entries.filter(
      (entry): entry is ToolEntry => entry.kind === "tool" && entry.parentId === undefined,
    );
    expect(roots).toHaveLength(2);
    for (const root of roots) {
      const children = entries.filter(
        (entry): entry is ToolEntry => entry.kind === "tool" && entry.parentId === root.id,
      );
      expect(children.map((child) => [child.name, child.result !== undefined])).toEqual([
        ["probe", true],
        ["probe", true],
        ["read", true],
      ]);
    }
  } finally {
    await run.dispose();
  }
});

test("the host announces a direct shell command's start and result, tagged like its output", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "harness-bash-"));
  directories.push(cwd);
  const host = await createSessionHost({
    cwd,
    agentDir: join(cwd, "agent"),
    settingsManager: SettingsManager.inMemory({}),
    sessionManager: SessionManager.inMemory(cwd),
  });
  const ui = fixture();
  const events: { type: string; id?: string }[] = [];
  try {
    await host.bind({
      uiContext: ui.extension.context,
      onEvent: (event) => events.push(event as { type: string; id?: string }),
      onExtensionError: () => {},
      onShutdownRequest: () => {},
      onHistoryReplaced: () => {},
    });
    const result = await host.runtime.session.executeBash("echo hello");
    const bash = events.filter((event) => event.type.startsWith("bash_"));
    expect(bash.map((event) => event.type)).toEqual([
      "bash_started",
      "bash_execution_update",
      "bash_finished",
    ]);
    expect(new Set(bash.map((event) => event.id)).size).toBe(1);
    expect(bash.at(-1)).toMatchObject({ result: { output: result.output, exitCode: 0 } });
  } finally {
    await host.dispose();
    ui.dispose();
  }
});
