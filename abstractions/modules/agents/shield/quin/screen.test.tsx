// User-visible key/focus/dialog contracts cannot be checked by TypeScript or package builds.
import { test, expect } from "bun:test";
import { testRender } from "@opentui/solid";
import type { HubClient, Envelope } from "../client/protocol";
import { Controller } from "./controller";
import { Screen, setupScreen } from "./screen";
import type { Keymap } from "./ui/keys";
import { emptyView } from "./view";

const STATS = { tokens: { input: 12_345, output: 678, cacheRead: 2000, cacheWrite: 0 }, cost: 0.0421, contextUsage: { tokens: 50_000, contextWindow: 200_000, percent: 25 } };
let seq = 0;
const event = (record: Record<string, unknown>, observedAt = Date.now()) =>
  ({ v: 1, type: "event", "agent-id": "a", engine: "pi", "hub-instance": "h", seq: ++seq, payload: { op: "event", record, observedAt } }) as Envelope;

function fixture(options: { keymap?: Keymap; engine?: (payload: any) => Promise<any> } = {}) {
  const requests: any[] = [];
  let closes = 0, statsReads = 0;
  // Statusline reads are counted apart, so the operation lists below stay exact.
  const client = {
    onRecord: () => {}, onDisconnect: () => {}, close: () => closes++,
    engine: async (_: string, payload: any) => {
      if (payload.record?.type === "get_session_stats") { statsReads++; return { success: true, payload: { data: STATS } }; }
      requests.push(payload);
      return options.engine ? options.engine(payload) : { success: true };
    },
  } as unknown as HubClient;
  const c = new Controller(client);
  seq = 0;
  c.record({ v: 1, type: "snapshot", "agent-id": "a", engine: "pi", "hub-instance": "h", seq: 0, payload: { view: emptyView(), lifecycle: "ready", mode: "mock" } } as Envelope);
  const screen = setupScreen(c, { keymap: options.keymap, cwd: "/project" });
  const { regions, keys, editor } = screen.ui.controllers;
  /** What the layout's key handler does for one key. */
  const press = (name: string, mods: { ctrl?: boolean; shift?: boolean } = {}) => {
    const action = keys.resolve(regions.current(), { name, ...mods });
    if (action?.id !== "global.interrupt") c.disarm();
    action?.run();
    return action?.id;
  };
  return { c, screen, regions, editor, press, requests, closes: () => closes, statsReads: () => statsReads };
}

test("the interrupt key is timed twice, idle clears input, and another operation disarms", () => {
  const f = fixture(); f.editor.setText("draft"); f.press("c", { ctrl: true });
  expect(f.editor.text()).toBe(""); expect(f.closes()).toBe(0);
  f.c.adapter.view.run.active = true;
  expect(f.c.interrupt(1000)).toBe("armed"); expect(f.requests).toEqual([]);
  f.press("x"); expect(f.c.armedUntil).toBe(0);
  f.c.interrupt(1300); f.c.tick(2400); expect(f.c.armedUntil).toBe(0);
  f.c.interrupt(2500); expect(f.c.interrupt(2600)).toBe("sent"); expect(f.requests).toEqual([{ op: "interrupt" }]);
  f.c.interrupt(3000);
  f.c.record(event({ type: "agent_settled" }));
  expect(f.c.armedUntil).toBe(0);
});

test("an input dialog opens a draft; Esc cancels it, and the hub's close restores focus", async () => {
  const f = fixture(); f.regions.requestFocus("timeline");
  f.c.record(event({ type: "extension_ui_request", id: "d", method: "input", title: "Input" }));
  expect(f.regions.current()).toBe("editor"); expect(f.editor.activeDraft()).toBe(true);
  f.editor.setText("answer"); f.press("escape"); await Bun.sleep(0);
  expect(f.requests).toEqual([{ op: "dialog_reply", id: "d", cancelled: true }]);
  expect(f.regions.current()).toBe("timeline");
  f.c.record(event({ type: "dialog_closed", id: "d" }));
  expect(f.requests).toHaveLength(1);
});

test("an agent's reported end outlasts the connection closing; only an open agent shows disconnected", () => {
  const ends: [string, (f: ReturnType<typeof fixture>) => void][] = [
    ["failed", f => f.c.record({ v: 1, type: "agent_failed", "agent-id": "a", engine: "pi" } as Envelope)],
    ["exited", f => f.c.record({ ...event({}), payload: { op: "lifecycle", state: "exited", detail: {} } } as Envelope)],
    ["disconnected", () => {}],
  ];
  for (const [state, end] of ends) {
    const f = fixture(); end(f);
    (f.c.client.onDisconnect as (e: Error) => void)(new Error("socket closed"));
    expect(f.c.adapter.lifecycle).toBe(state);
    expect(f.c.status).toContain(state);
  }
});

test("a select whose options are not a list offers no choice but can be cancelled", async () => {
  for (const options of [undefined, "one", { one: 1 }]) {
    const f = fixture();
    f.c.record(event({ type: "extension_ui_request", id: "d", method: "select", title: "Pick", options }));
    f.press("return"); await Bun.sleep(0);
    expect(f.requests).toEqual([]);
    f.press("escape"); await Bun.sleep(0);
    expect(f.requests).toEqual([{ op: "dialog_reply", id: "d", cancelled: true }]);
  }
});

test("detach works from every region and never answers a dialog", () => {
  for (const region of ["editor", "timeline", "stage"]) {
    const f = fixture();
    f.c.record(event({ type: "extension_ui_request", id: "d", method: "confirm", title: "Continue?" }));
    f.regions.requestFocus(region);
    expect(f.press("q", { ctrl: true })).toBe("global.detach");
    expect(f.closes()).toBe(1); expect(f.requests).toEqual([]);
  }
});

test("a dialog answered elsewhere closes here without a reply; several dialogs are switched in order", async () => {
  const f = fixture();
  f.c.record(event({ type: "extension_ui_request", id: "a", method: "select", title: "First", options: ["x", "y"] }));
  f.c.record(event({ type: "extension_ui_request", id: "b", method: "confirm", title: "Second" }));
  const stage = f.screen.ui.controllers.stage;
  expect(f.regions.current()).toBe("stage"); expect(stage.position()).toEqual({ index: 1, total: 2 });
  f.press("f", { ctrl: true }); expect(stage.position()).toEqual({ index: 2, total: 2 });
  f.c.record(event({ type: "dialog_closed", id: "b" })); await Bun.sleep(0);
  expect(stage.position()).toEqual({ index: 1, total: 1 });
  f.press("j"); f.press("return"); await Bun.sleep(0);
  expect(f.requests).toEqual([{ op: "dialog_reply", id: "a", value: "y" }]);
});

test("a preflight dialog can reply while its parent prompt response remains pending", async () => {
  let resolvePrompt!: (value: any) => void;
  const prompt = new Promise(resolve => { resolvePrompt = resolve; });
  const f = fixture({ engine: async payload => payload.op === "rpc" ? prompt : { success: true } });
  f.editor.setText("prompt");
  f.press("return"); await Bun.sleep(0);
  f.c.record(event({ type: "extension_ui_request", id: "d", method: "confirm", title: "Continue?" }));
  f.press("return"); await Bun.sleep(0);
  expect(f.requests).toEqual([
    { op: "rpc", record: { type: "prompt", message: "prompt" } },
    { op: "dialog_reply", id: "d", confirmed: true },
  ]);
  resolvePrompt({ success: true }); await Bun.sleep(0);
  expect(f.editor.text()).toBe("");
});

test("scroll chords belong to the timeline; the editor keeps them", () => {
  const f = fixture(); const scrolls: string[] = []; f.screen.actions.timeline.scroll = amount => scrolls.push(amount);
  for (const name of ["f", "b", "d", "u"]) expect(f.press(name, { ctrl: true })).toBeUndefined();
  f.regions.requestFocus("timeline");
  for (const name of ["f", "b", "d", "u"]) f.press(name, { ctrl: true });
  expect(scrolls).toEqual(["page-down", "page-up", "half-down", "half-up"]);
});

test("keypad Enter submits like Enter", async () => {
  const f = fixture(); f.editor.setText("from keypad"); f.press("kpenter"); await Bun.sleep(0);
  expect(f.requests).toEqual([{ op: "rpc", record: { type: "prompt", message: "from keypad" } }]);
});

test("a configured keymap replaces the default chords", () => {
  const f = fixture({ keymap: { "global.detach": ["ctrl+x"], "global.focus-timeline": ["ctrl+o"] } });
  expect(f.press("q", { ctrl: true })).toBeUndefined();
  f.press("o", { ctrl: true }); expect(f.regions.current()).toBe("timeline");
  f.press("x", { ctrl: true }); expect(f.closes()).toBe(1);
  expect(() => fixture({ keymap: { "global.missing": ["x"] } })).toThrow("unknown actions in keymap: global.missing");
});

test("nested tools appear under their expanded parent", () => {
  const f = fixture(); const timeline = f.screen.ui.controllers.timeline;
  f.c.adapter.view.timeline.entries = [
    { id: "t", kind: "tool", version: 0, name: "parent", state: "running", args: { available: false }, parentId: null },
    { id: "n", kind: "tool", version: 0, name: "child", state: "running", args: { available: false }, parentId: "t" },
  ];
  f.c.record(event({ type: "queue_update", steering: [], followUp: [] }));
  expect(timeline.visibleItems().map(item => item.id)).toEqual(["t"]);
  f.regions.requestFocus("timeline"); f.press("l");
  expect(timeline.visibleItems().map(item => item.id)).toEqual(["t", "n"]);
});

test("native text plus Enter in one input batch submits the complete buffer", async () => {
  const f = fixture();
  const setup = await testRender(() => <Screen screen={f.screen} />, { width: 80, height: 24 });
  try {
    await setup.flush();
    setup.renderer.stdin.emit("data", Buffer.from("hello\r"));
    await setup.flush(); await Bun.sleep(0);
    expect(f.requests[0]).toEqual({ op: "rpc", record: { type: "prompt", message: "hello" } });
    expect(f.editor.text()).toBe("");
  } finally { setup.renderer.destroy(); }
});

test("renderer shows mock, run, tool state, queue, status totals, dialog, and interrupt confirmation", async () => {
  const f = fixture(); await Bun.sleep(0);
  expect(f.statsReads()).toBe(1);
  f.c.adapter.view.timeline.entries = [{ id: "tool", kind: "tool", version: 0, name: "fixture", state: "running", args: { available: false } }];
  f.c.adapter.view.queue.followUp = ["queued input"];
  f.c.adapter.view.run.active = true;
  f.c.record(event({ type: "message_end", message: { role: "user", content: "hi" } })); await Bun.sleep(0);
  expect(f.statsReads()).toBe(2);
  const setup = await testRender(() => <Screen screen={f.screen} />, { width: 120, height: 24 });
  try {
    await setup.flush(); const first = setup.captureCharFrame();
    expect(first).toContain("MOCK"); expect(first).toContain("⏺ fixture (arguments unavailable) · running…"); expect(first).toContain("queued: queued input"); expect(first).toContain("Working");
    expect(first).toContain("ctx 25% of 200k"); expect(first).toContain("↑12k ↓678 R2.0k $0.042");
    expect(first).toContain("Tab focus"); expect(first).not.toContain("[editor]");
    f.c.interrupt(); await setup.flush(); expect(setup.captureCharFrame()).toContain("Press Ctrl+C again within 1s to interrupt");
    f.c.record(event({ type: "extension_ui_request", id: "d", method: "confirm", title: "Continue?", message: "A confirmation" }));
    await setup.flush(); expect(setup.captureCharFrame()).toContain("Continue?"); expect(f.regions.current()).toBe("stage");
  } finally { setup.renderer.destroy(); }
  expect(f.requests).toEqual([]);
});

/** Pi's events for one response whose calls are a codemode script and a direct read, as the pinned runtime emits them. */
function codemodeRun(code: string, content: { type: "text"; text: string }[], isError: boolean, nested: string[]) {
  const message = { role: "assistant", content: [{ type: "toolCall", id: "c1", name: "codemode", arguments: { code } }, { type: "toolCall", id: "r1", name: "read", arguments: { path: "b.txt" } }], stopReason: "toolUse" };
  const calls = nested.map((name, index) => ({ id: `c1/${index + 1}`, name, args: name === "read" ? { path: "a.txt" } : { command: "echo hi" } }));
  return [
    { type: "agent_start" },
    { type: "message_start", message: { role: "assistant", content: [] } },
    { type: "message_end", message },
    { type: "tool_execution_start", toolCallId: "c1", toolName: "codemode", args: { code } },
    { type: "tool_execution_start", toolCallId: "r1", toolName: "read", args: { path: "b.txt" } },
    // The script's calls are recorded after the direct read that started before them.
    ...calls.flatMap(call => [
      { type: "tool_execution_start", toolCallId: call.id, toolName: call.name, args: call.args, parentToolCallId: "c1" },
      { type: "tool_execution_end", toolCallId: call.id, toolName: call.name, result: { content: [{ type: "text", text: "x\n" }] }, isError: false, parentToolCallId: "c1" },
    ]),
    { type: "tool_execution_end", toolCallId: "c1", toolName: "codemode", result: { content, details: {} }, isError },
    { type: "tool_execution_end", toolCallId: "r1", toolName: "read", result: { content: [{ type: "text", text: "y\n" }] }, isError: false },
    { type: "agent_settled" },
  ];
}

/** A tool item's call id, without the response that scopes it. */
const call = (id: string) => id.slice(id.indexOf("/") + 1);

async function renderRun(records: Record<string, unknown>[], expand: string[] = []) {
  const f = fixture();
  for (const record of records) f.c.record(event(record));
  const timeline = f.screen.ui.controllers.timeline;
  f.regions.requestFocus("timeline");
  for (const id of expand) { timeline.setCursor(id); f.press("l"); }
  const setup = await testRender(() => <Screen screen={f.screen} />, { width: 100, height: 40 });
  try { await setup.flush(); return { frame: setup.captureCharFrame(), visible: timeline.visibleItems().map(item => item.id), f }; }
  finally { setup.renderer.destroy(); }
}

test("a codemode script lists its calls in start order and ends with its output while collapsed", async () => {
  const code = 'const a = await tools.read({ path: "a.txt" });\ntext(a);\nawait tools.bash({ command: "echo hi" });\nreturn { ok: 1 };';
  const content = [
    { type: "text" as const, text: "Script completed\nWall time 0.0 seconds\nOutput:\n" },
    { type: "text" as const, text: '==> text 1/2 <==\nx\n==> text 2/2 <==\n{"ok":1}' },
  ];
  const { frame, visible } = await renderRun(codemodeRun(code, content, false, ["read", "bash"]));
  expect(visible.filter(id => id.includes("/")).map(call)).toEqual(["c1", "r1"]);
  const lines = frame.split("\n").map(line => line.trimEnd());
  const header = lines.findIndex(line => line.includes("⏵ codemode 2 calls · 0.0s · done"));
  expect(header).toBeGreaterThan(-1);
  // The selected script's range bar runs down its rows; the text follows it.
  expect(lines.slice(header + 1, header + 7).map(line => line.replace(/^\s*[┃╹]?\s*/, ""))).toEqual([
    "· read a.txt · done",
    "· $ echo hi · done",
    "→ ==> text 1/2 <==",
    "x",
    "==> text 2/2 <==",
    "ok 1",
  ]);
  expect(frame).toContain("⏺ read b.txt · done");
});

test("an expanded codemode script shows its calls as children before the next call, and its source", async () => {
  const code = 'await tools.read({ path: "a.txt" });\nnull.missing;';
  const content = [
    { type: "text" as const, text: "Script failed\nWall time 0.0 seconds\nOutput:\n" },
    { type: "text" as const, text: "Script error:\nTypeError: cannot read property 'missing' of null\n    at <anonymous> (codemode.js:2:1)\n\nTool calls made before the failure (they are not undone): read (ok)" },
  ];
  const collapsed = await renderRun(codemodeRun(code, content, true, ["read"]));
  expect(collapsed.frame).toContain("⏵ codemode 1 call · 0.0s · failed at line 2");
  expect(collapsed.frame).toContain("→ TypeError: cannot read property 'missing' of null");
  const script = collapsed.visible.find(id => call(id) === "c1")!;
  const expanded = await renderRun(codemodeRun(code, content, true, ["read"]), [script]);
  expect(expanded.visible.filter(id => id.includes("/")).map(call)).toEqual(["c1", "c1/1", "r1"]);
  const lines = expanded.frame.split("\n").map(line => line.trimEnd());
  const header = lines.findIndex(line => line.includes("⏷ codemode 1 call · 0.0s · failed at line 2"));
  expect(header).toBeGreaterThan(-1);
  expect(lines[header + 1]).toContain("⏺ read a.txt · done");
  expect(expanded.frame).toContain("javascript");
  expect(expanded.frame).toContain(' 1 await tools.read({ path: "a.txt" });');
  expect(expanded.frame).toContain("▶2 null.missing;  ← error");
  expect(expanded.frame).toContain("error at line 2");
});

test("a retry sequence is one item that collects its attempts, and each sequence ends in its final state", async () => {
  const retry = (attempt: number, maxAttempts: number, errorMessage: string, type = "auto_retry_start") => ({ type, attempt, maxAttempts, delayMs: 500, errorMessage });
  const { frame, f } = await renderRun([
    retry(1, 2, "overloaded"), { type: "agent_start" }, retry(2, 2, "overloaded again"), { type: "agent_start" },
    { type: "auto_retry_end", success: false, attempt: 2, finalError: "gave up" },
    retry(1, 3, "summary failed", "summarization_retry_scheduled"),
    { type: "summarization_retry_attempt_start", source: "compaction", reason: "threshold" },
    { type: "summarization_retry_finished" },
    retry(1, 3, "temporary"), { type: "agent_start" }, { type: "auto_retry_end", success: true, attempt: 1 },
  ]);
  const items = f.screen.ui.controllers.timeline.items().filter(item => item.type.kind === "retry");
  expect(items.map(item => (item.value as any).attempts.length)).toEqual([2, 1, 1]);
  for (const text of ["retry 2/2 · failed", "gave up", "summary retry 1/3 · ended", "retry 1/3 · succeeded"]) expect(frame).toContain(text);
  expect(frame).not.toContain("waiting to retry");
  expect(frame).not.toContain("retrying…");
});

const MODELS = { success: true, payload: { data: { models: [{ provider: "b", id: "two", name: "Two" }, { provider: "a", id: "one", name: "One" }] } } };

test("the palette opens from the timeline and the editor and runs a command chosen by name and candidate", async () => {
  for (const open of [(f: ReturnType<typeof fixture>) => { f.regions.requestFocus("timeline"); f.press(":"); }, (f: ReturnType<typeof fixture>) => f.press("g", { ctrl: true })]) {
    const f = fixture({ engine: async payload => payload.record?.type === "get_available_models" ? MODELS : { success: true } });
    const commands = f.screen.ui.controllers.commands;
    open(f);
    expect(f.regions.current()).toBe("stage");
    expect(commands.names().map(command => command.name)).toEqual(["model", "thinking", "compact"]);
    // The name input takes typed characters, so j and : do not move or reopen.
    expect(f.press("j")).toBeUndefined();
    f.press("return"); await Bun.sleep(0);
    expect(commands.value()?.filtered.map(candidate => candidate.value)).toEqual(["a/one", "b/two"]);
    f.press("j"); f.press("return"); await Bun.sleep(0);
    expect(f.requests).toEqual([{ op: "rpc", record: { type: "get_available_models" } }, { op: "rpc", record: { type: "set_model", provider: "b", modelId: "two" } }]);
    expect(commands.value()).toBeUndefined();
  }
});

test("a command's argument is drafted in the editor, and the editor's candidate keys apply only to that draft", async () => {
  const f = fixture();
  expect(f.press("n", { ctrl: true })).toBeUndefined();
  f.press("g", { ctrl: true });
  const commands = f.screen.ui.controllers.commands;
  commands.setQuery("compact");
  f.press("space");
  expect(f.regions.current()).toBe("editor");
  expect(f.press("n", { ctrl: true })).toBe("editor.command-next");
  f.editor.setText("keep the tests"); f.press("return"); await Bun.sleep(0);
  expect(f.requests).toEqual([{ op: "rpc", record: { type: "compact", customInstructions: "keep the tests" } }]);
  expect(commands.value()).toBeUndefined();
  expect(f.press("n", { ctrl: true })).toBeUndefined();
});

test("another client's model change reaches the view and the timeline", async () => {
  const f = fixture();
  f.c.adapter.view.timeline.model = "a/one";
  f.c.record(event({ type: "quin_model", model: { provider: "b", id: "two" } }));
  const setup = await testRender(() => <Screen screen={f.screen} />, { width: 100, height: 20 });
  try {
    await setup.flush();
    const frame = setup.captureCharFrame();
    expect(frame).toContain("── model: a/one → b/two");
  } finally { setup.renderer.destroy(); }
});
