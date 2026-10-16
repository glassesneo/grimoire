// User-visible key/focus/dialog contracts cannot be checked by TypeScript or package builds.
import { test, expect } from "bun:test";
import { testRender } from "@opentui/solid";
import type { HubClient, Envelope } from "../client/protocol";
import { Controller } from "./controller";
import { Screen, setupScreen } from "./screen";
import { checkKeymap } from "./contributions/default";
import type { Keymap } from "./ui/keys";
import { emptyView, type Entry, type ViewPatch } from "./view";

const STATS = {
  tokens: { input: 12_345, output: 678, cacheRead: 2000, cacheWrite: 0 },
  cost: 0.0421,
  contextUsage: { tokens: 50_000, contextWindow: 200_000, percent: 25 },
};
let seq = 0;
const event = (record: Record<string, unknown>, patch: ViewPatch = { entries: [] }) =>
  ({
    v: 1,
    type: "event",
    "agent-id": "a",
    engine: "pi",
    "hub-instance": "h",
    seq: ++seq,
    payload: { op: "event", record, patch },
  }) as Envelope;
let dialogs: Record<string, any> = {};
const dialog = (record: Record<string, any>) => {
  dialogs = { ...dialogs, [record.id]: { ...record, expiresAt: null } };
  return event(record, { entries: [], dialogs });
};
const closeDialog = (id: string) => {
  dialogs = { ...dialogs };
  delete dialogs[id];
  return event({ type: "dialog_closed", id }, { entries: [], dialogs });
};

function fixture(options: { keymap?: Keymap; engine?: (payload: any) => Promise<any> } = {}) {
  const requests: any[] = [];
  let closes = 0,
    statsReads = 0;
  const timeouts: (number | undefined)[] = [];
  // Statusline reads are counted apart, so the operation lists below stay exact.
  const client = {
    onRecord: () => {},
    onDisconnect: () => {},
    close: () => closes++,
    engine: async (_: string, payload: any, timeout?: number) => {
      if (payload.record?.type === "get_session_stats") {
        statsReads++;
        return { success: true, payload: { data: STATS } };
      }
      requests.push(payload);
      timeouts.push(timeout);
      return options.engine ? options.engine(payload) : { success: true };
    },
  } as unknown as HubClient;
  const c = new Controller(client);
  seq = 0;
  dialogs = {};
  c.record({
    v: 1,
    type: "snapshot",
    "agent-id": "a",
    engine: "pi",
    "hub-instance": "h",
    seq: 0,
    payload: { view: emptyView(), lifecycle: "ready", mode: "mock" },
  } as Envelope);
  const screen = setupScreen(c, { keymap: options.keymap, cwd: "/project" });
  const { regions, keys, editor } = screen.ui.controllers;
  /** What the layout's key handler does for one key. */
  const press = (name: string, mods: { ctrl?: boolean; shift?: boolean } = {}) => {
    const action = keys.resolve(regions.current(), { name, ...mods });
    if (action?.id !== "global.interrupt") c.disarm();
    action?.run();
    return action?.id;
  };
  return {
    c,
    screen,
    regions,
    editor,
    press,
    requests,
    timeouts,
    closes: () => closes,
    statsReads: () => statsReads,
  };
}

// Model changes affect context immediately, including while an earlier stats read is outstanding.
test("model broadcasts refresh context stats and coalesce outstanding reads through the final model", async () => {
  const pending: ((value: any) => void)[] = [];
  const client = {
    onRecord: () => {},
    onDisconnect: () => {},
    close: () => {},
    engine: () => new Promise((resolve) => pending.push(resolve)),
  } as unknown as HubClient;
  const c = new Controller(client);
  c.record({
    v: 1,
    type: "snapshot",
    "agent-id": "a",
    engine: "pi",
    "hub-instance": "h",
    seq: 0,
    payload: { view: emptyView(), lifecycle: "ready", mode: "live" },
  } as Envelope);
  expect(pending).toHaveLength(1);
  c.record(event({ type: "shield_model" }));
  c.record(event({ type: "shield_model" }));
  expect(pending).toHaveLength(1);
  pending[0]!({ success: true, payload: { data: STATS } });
  await Bun.sleep(0);
  expect(pending).toHaveLength(2);
  const final = { ...STATS, contextUsage: { tokens: 50_000, contextWindow: 100_000, percent: 50 } };
  pending[1]!({ success: true, payload: { data: final } });
  await Bun.sleep(0);
  expect(c.stats?.contextUsage).toEqual(final.contextUsage);
  c.record(event({ type: "shield_model" }));
  expect(pending).toHaveLength(3);
  pending[2]!({ success: true, payload: { data: STATS } });
  await Bun.sleep(0);
  expect(c.stats?.contextUsage).toEqual(STATS.contextUsage);
});

test("the interrupt key is timed twice, idle clears input, and another operation disarms", () => {
  const f = fixture();
  f.editor.setText("draft");
  f.press("c", { ctrl: true });
  expect(f.editor.text()).toBe("");
  expect(f.closes()).toBe(0);
  f.c.adapter.view.run.active = true;
  expect(f.c.interrupt(1000)).toBe("armed");
  expect(f.requests).toEqual([]);
  f.press("x");
  expect(f.c.armedUntil).toBe(0);
  f.c.interrupt(1300);
  f.c.tick(2400);
  expect(f.c.armedUntil).toBe(0);
  f.c.interrupt(2500);
  expect(f.c.interrupt(2600)).toBe("sent");
  expect(f.requests).toEqual([{ op: "interrupt" }]);
  f.c.interrupt(3000);
  f.c.record(event({ type: "agent_settled" }, { entries: [], run: emptyView().run }));
  expect(f.c.armedUntil).toBe(0);
});

test("an input dialog opens a draft; Esc cancels it, and the hub's close restores focus", async () => {
  const f = fixture();
  f.regions.requestFocus("timeline");
  f.c.record(dialog({ type: "extension_ui_request", id: "d", method: "input", title: "Input" }));
  expect(f.regions.current()).toBe("editor");
  expect(f.editor.activeDraft()).toBe(true);
  f.editor.setText("answer");
  f.press("escape");
  await Bun.sleep(0);
  expect(f.requests).toEqual([{ op: "dialog_reply", id: "d", cancelled: true }]);
  expect(f.regions.current()).toBe("timeline");
  f.c.record(closeDialog("d"));
  expect(f.requests).toHaveLength(1);
});

test("an agent's reported end outlasts the connection closing; only an open agent shows disconnected", () => {
  const ends: [string, (f: ReturnType<typeof fixture>) => void][] = [
    [
      "failed",
      (f) => f.c.record({ v: 1, type: "agent_failed", "agent-id": "a", engine: "pi" } as Envelope),
    ],
    [
      "exited",
      (f) =>
        f.c.record({
          ...event({}),
          payload: { op: "lifecycle", state: "exited", detail: {} },
        } as Envelope),
    ],
    ["disconnected", () => {}],
  ];
  for (const [state, end] of ends) {
    const f = fixture();
    end(f);
    (f.c.client.onDisconnect as (e: Error) => void)(new Error("socket closed"));
    expect(f.c.adapter.lifecycle).toBe(state);
    expect(f.c.status).toContain(state);
  }
});

test("a select whose options are not a list offers no choice but can be cancelled", async () => {
  for (const options of [undefined, "one", { one: 1 }]) {
    const f = fixture();
    f.c.record(
      dialog({ type: "extension_ui_request", id: "d", method: "select", title: "Pick", options }),
    );
    f.press("return");
    await Bun.sleep(0);
    expect(f.requests).toEqual([]);
    f.press("escape");
    await Bun.sleep(0);
    expect(f.requests).toEqual([{ op: "dialog_reply", id: "d", cancelled: true }]);
  }
});

test("detach works from every region and never answers a dialog", () => {
  for (const region of ["editor", "timeline", "stage"]) {
    const f = fixture();
    f.c.record(
      dialog({ type: "extension_ui_request", id: "d", method: "confirm", title: "Continue?" }),
    );
    f.regions.requestFocus(region);
    expect(f.press("q", { ctrl: true })).toBe("global.detach");
    expect(f.closes()).toBe(1);
    expect(f.requests).toEqual([]);
  }
});

test("a dialog answered elsewhere closes here without a reply; several dialogs are switched in order", async () => {
  const f = fixture();
  f.c.record(
    dialog({
      type: "extension_ui_request",
      id: "a",
      method: "select",
      title: "First",
      options: ["x", "y"],
    }),
  );
  f.c.record(dialog({ type: "extension_ui_request", id: "b", method: "confirm", title: "Second" }));
  const stage = f.screen.ui.controllers.stage;
  expect(f.regions.current()).toBe("stage");
  expect(stage.position()).toEqual({ index: 1, total: 2 });
  f.press("f", { ctrl: true });
  expect(stage.position()).toEqual({ index: 2, total: 2 });
  f.c.record(closeDialog("b"));
  await Bun.sleep(0);
  expect(stage.position()).toEqual({ index: 1, total: 1 });
  f.press("j");
  f.press("return");
  await Bun.sleep(0);
  expect(f.requests).toEqual([{ op: "dialog_reply", id: "a", value: "y" }]);
});

test("a preflight dialog can reply while its parent prompt response remains pending", async () => {
  let resolvePrompt!: (value: any) => void;
  const prompt = new Promise((resolve) => {
    resolvePrompt = resolve;
  });
  const f = fixture({
    engine: async (payload) => (payload.op === "rpc" ? prompt : { success: true }),
  });
  f.editor.setText("prompt");
  f.press("return");
  await Bun.sleep(0);
  f.c.record(
    dialog({ type: "extension_ui_request", id: "d", method: "confirm", title: "Continue?" }),
  );
  f.press("return");
  await Bun.sleep(0);
  expect(f.requests).toEqual([
    { op: "rpc", record: { type: "prompt", message: "prompt" } },
    { op: "dialog_reply", id: "d", confirmed: true },
  ]);
  resolvePrompt({ success: true });
  await Bun.sleep(0);
  expect(f.editor.text()).toBe("");
});

test("scroll chords belong to the timeline; the editor keeps them", () => {
  const f = fixture();
  const scrolls: string[] = [];
  f.screen.actions.timeline.scroll = (amount) => scrolls.push(amount);
  for (const name of ["f", "b", "d", "u"]) expect(f.press(name, { ctrl: true })).toBeUndefined();
  f.regions.requestFocus("timeline");
  for (const name of ["f", "b", "d", "u"]) f.press(name, { ctrl: true });
  expect(scrolls).toEqual(["page-down", "page-up", "half-down", "half-up"]);
});

test("keypad Enter submits like Enter", async () => {
  const f = fixture();
  f.editor.setText("from keypad");
  f.press("kpenter");
  await Bun.sleep(0);
  expect(f.requests).toEqual([{ op: "rpc", record: { type: "prompt", message: "from keypad" } }]);
});

test("standalone keymap validation rejects malformed, unknown and conflicting bindings", () => {
  for (const value of [null, [], "bad"])
    expect(() => checkKeymap(value as any)).toThrow("object of action ids");
  expect(() => checkKeymap({ "global.missing": ["x"] })).toThrow("unknown actions");
  expect(() => checkKeymap({ "global.detach": ["ctrl+c"] })).toThrow("bound to both");
  expect(() => checkKeymap({ "editor.submit": ["space"] })).toThrow("could never run");
  expect(() => checkKeymap({ "global.detach": ["space"] })).not.toThrow();
});

test("a configured keymap replaces the default chords", () => {
  const f = fixture({
    keymap: { "global.detach": ["ctrl+x"], "global.focus-timeline": ["ctrl+o"] },
  });
  expect(f.press("q", { ctrl: true })).toBeUndefined();
  f.press("o", { ctrl: true });
  expect(f.regions.current()).toBe("timeline");
  f.press("x", { ctrl: true });
  expect(f.closes()).toBe(1);
  expect(() => fixture({ keymap: { "global.missing": ["x"] } })).toThrow(
    "unknown actions in keymap: global.missing",
  );
});

test("nested tools appear under their expanded parent", async () => {
  const f = fixture();
  const timeline = f.screen.ui.controllers.timeline;
  f.c.record(
    event(
      {},
      {
        entries: [
          {
            id: "t",
            kind: "tool",
            version: 0,
            name: "parent",
            state: "running",
            args: { available: false },
            parentId: null,
          },
          {
            id: "n",
            kind: "tool",
            version: 0,
            name: "child",
            state: "running",
            args: { available: false },
            parentId: "t",
          },
        ],
      },
    ),
  );
  await Bun.sleep(0);
  expect(timeline.visibleItems().map((item) => item.id)).toEqual(["t"]);
  f.regions.requestFocus("timeline");
  f.press("l");
  expect(timeline.visibleItems().map((item) => item.id)).toEqual(["t", "n"]);
});

test("native text plus Enter in one input batch submits the complete buffer", async () => {
  const f = fixture();
  const setup = await testRender(() => <Screen screen={f.screen} />, { width: 80, height: 24 });
  try {
    await setup.flush();
    setup.renderer.stdin.emit("data", Buffer.from("hello\r"));
    await setup.flush();
    await Bun.sleep(0);
    expect(f.requests[0]).toEqual({ op: "rpc", record: { type: "prompt", message: "hello" } });
    expect(f.editor.text()).toBe("");
  } finally {
    setup.renderer.destroy();
  }
});

test("renderer shows mock, run, tool state, queue, status totals, dialog, and interrupt confirmation", async () => {
  const f = fixture();
  await Bun.sleep(0);
  expect(f.statsReads()).toBe(1);
  f.c.record(
    event(
      {},
      {
        entries: [
          {
            id: "tool",
            kind: "tool",
            version: 0,
            name: "fixture",
            state: "running",
            args: { available: false },
          },
        ],
      },
    ),
  );
  f.c.adapter.view.queue.followUp = ["queued input"];
  f.c.adapter.view.run.active = true;
  f.c.record(event({ type: "message_end", message: { role: "user", content: "hi" } }));
  await Bun.sleep(0);
  expect(f.statsReads()).toBe(2);
  const setup = await testRender(() => <Screen screen={f.screen} />, { width: 120, height: 24 });
  try {
    await setup.flush();
    const first = setup.captureCharFrame();
    expect(first).toContain("MOCK");
    expect(first).toContain("⏺ fixture (arguments unavailable) · running…");
    expect(first).toContain("queued: queued input");
    expect(first).toContain("Working");
    expect(first).toContain("ctx 25% of 200k");
    expect(first).toContain("↑12k ↓678 R2.0k $0.042");
    expect(first).toContain("Tab focus");
    expect(first).not.toContain("[editor]");
    f.c.interrupt();
    await setup.flush();
    expect(setup.captureCharFrame()).toContain("Press Ctrl+C again within 1s to interrupt");
    f.c.record(
      dialog({
        type: "extension_ui_request",
        id: "d",
        method: "confirm",
        title: "Continue?",
        message: "A confirmation",
      }),
    );
    await setup.flush();
    expect(setup.captureCharFrame()).toContain("Continue?");
    expect(f.regions.current()).toBe("stage");
  } finally {
    setup.renderer.destroy();
  }
  expect(f.requests).toEqual([]);
});

/** Authoritative entries; Pi event reduction is tested at the hub, not in the renderer. */
function codemodeRun(
  code: string,
  content: { type: "text"; text: string }[],
  isError: boolean,
  nested: string[],
): Entry[] {
  const tool = (
    callId: string,
    name: string,
    args: unknown,
    ordinal: number,
    fields: object = {},
  ): Entry => ({
    id: `live:0/${callId}`,
    callId,
    kind: "tool",
    version: 0,
    name,
    ordinal,
    args: { available: true, value: args },
    state: "done",
    parentId: null,
    ...fields,
  });
  return [
    tool("c1", "codemode", { code }, 0, {
      state: isError ? "error" : "done",
      result: { content, details: {} },
    }),
    tool("r1", "read", { path: "b.txt" }, 1, {
      result: { content: [{ type: "text", text: "y\n" }] },
    }),
    ...nested.map((name, index) =>
      tool(
        `c1/${index + 1}`,
        name,
        name === "read" ? { path: "a.txt" } : { command: "echo hi" },
        index + 2,
        { parentId: "live:0/c1", result: { content: [{ type: "text", text: "x\n" }] } },
      ),
    ),
  ];
}

/** A tool item's call id, without the response that scopes it. */
const call = (id: string) => id.slice(id.indexOf("/") + 1);

async function renderRun(entries: Entry[], expand: string[] = []) {
  const f = fixture();
  f.c.record(event({}, { entries }));
  await Bun.sleep(0);
  const timeline = f.screen.ui.controllers.timeline;
  f.regions.requestFocus("timeline");
  for (const id of expand) {
    timeline.setCursor(id);
    f.press("l");
  }
  const setup = await testRender(() => <Screen screen={f.screen} />, { width: 100, height: 40 });
  try {
    await setup.flush();
    return {
      frame: setup.captureCharFrame(),
      visible: timeline.visibleItems().map((item) => item.id),
      f,
    };
  } finally {
    setup.renderer.destroy();
  }
}

test("a codemode script lists its calls in start order and ends with its output while collapsed", async () => {
  const code =
    'const a = await tools.read({ path: "a.txt" });\ntext(a);\nawait tools.bash({ command: "echo hi" });\nreturn { ok: 1 };';
  const content = [
    { type: "text" as const, text: "Script completed\nWall time 0.0 seconds\nOutput:\n" },
    { type: "text" as const, text: '==> text 1/2 <==\nx\n==> text 2/2 <==\n{"ok":1}' },
  ];
  const { frame, visible } = await renderRun(codemodeRun(code, content, false, ["read", "bash"]));
  expect(visible.filter((id) => id.includes("/")).map(call)).toEqual(["c1", "r1"]);
  const lines = frame.split("\n").map((line) => line.trimEnd());
  const header = lines.findIndex((line) => line.includes("⏵ codemode 2 calls · 0.0s · done"));
  expect(header).toBeGreaterThan(-1);
  // The selected script's range bar runs down its rows; the text follows it.
  expect(
    lines.slice(header + 1, header + 7).map((line) => line.replace(/^\s*[┃╹]?\s*/, "")),
  ).toEqual([
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
    {
      type: "text" as const,
      text: "Script error:\nTypeError: cannot read property 'missing' of null\n    at <anonymous> (codemode.js:2:1)\n\nTool calls made before the failure (they are not undone): read (ok)",
    },
  ];
  const collapsed = await renderRun(codemodeRun(code, content, true, ["read"]));
  expect(collapsed.frame).toContain("⏵ codemode 1 call · 0.0s · failed at line 2");
  expect(collapsed.frame).toContain("→ TypeError: cannot read property 'missing' of null");
  const script = collapsed.visible.find((id) => call(id) === "c1")!;
  const expanded = await renderRun(codemodeRun(code, content, true, ["read"]), [script]);
  expect(expanded.visible.filter((id) => id.includes("/")).map(call)).toEqual(["c1", "c1/1", "r1"]);
  const lines = expanded.frame.split("\n").map((line) => line.trimEnd());
  const header = lines.findIndex((line) =>
    line.includes("⏷ codemode 1 call · 0.0s · failed at line 2"),
  );
  expect(header).toBeGreaterThan(-1);
  expect(lines[header + 1]).toContain("⏺ read a.txt · done");
  expect(expanded.frame).toContain("javascript");
  expect(expanded.frame).toContain(' 1 await tools.read({ path: "a.txt" });');
  expect(expanded.frame).toContain("▶2 null.missing;  ← error");
  expect(expanded.frame).toContain("error at line 2");
});

test("retry items show their attempts and final state", async () => {
  const attempt = (attempt: number, maxAttempts: number, error: string) => ({
    attempt,
    maxAttempts,
    delayMs: 500,
    error,
  });
  const { frame, f } = await renderRun([
    {
      id: "r1",
      kind: "retry",
      version: 0,
      category: "response",
      state: "failed",
      attempts: [attempt(1, 2, "overloaded"), attempt(2, 2, "overloaded again")],
      finalError: "gave up",
    },
    {
      id: "r2",
      kind: "retry",
      version: 0,
      category: "summary",
      state: "ended",
      attempts: [attempt(1, 3, "summary failed")],
    },
    {
      id: "r3",
      kind: "retry",
      version: 0,
      category: "response",
      state: "succeeded",
      attempts: [attempt(1, 3, "temporary")],
    },
  ]);
  const items = f.screen.ui.controllers.timeline
    .items()
    .filter((item) => item.type.kind === "retry");
  expect(items.map((item) => (item.value as any).attempts.length)).toEqual([2, 1, 1]);
  for (const text of [
    "retry 2/2 · failed",
    "gave up",
    "summary retry 1/3 · ended",
    "retry 1/3 · succeeded",
  ])
    expect(frame).toContain(text);
  expect(frame).not.toContain("waiting to retry");
  expect(frame).not.toContain("retrying…");
});

const MODELS = {
  success: true,
  payload: {
    data: {
      models: [
        { provider: "b", id: "two", name: "Two" },
        { provider: "a", id: "one", name: "One" },
      ],
    },
  },
};

test("the palette opens from the timeline and the editor and runs a command chosen by name and candidate", async () => {
  for (const open of [
    (f: ReturnType<typeof fixture>) => {
      f.regions.requestFocus("timeline");
      f.press(":");
    },
    (f: ReturnType<typeof fixture>) => f.press("g", { ctrl: true }),
  ]) {
    const f = fixture({
      engine: async (payload) =>
        payload.record?.type === "get_available_models" ? MODELS : { success: true },
    });
    const commands = f.screen.ui.controllers.commands;
    open(f);
    expect(f.regions.current()).toBe("stage");
    expect(commands.names().map((command) => command.name)).toEqual([
      "model",
      "thinking",
      "compact",
    ]);
    // The name input takes typed characters, so j and : do not move or reopen.
    expect(f.press("j")).toBeUndefined();
    f.press("return");
    await Bun.sleep(0);
    expect(commands.value()?.filtered.map((candidate) => candidate.value)).toEqual([
      "a/one",
      "b/two",
    ]);
    f.press("j");
    f.press("return");
    await Bun.sleep(0);
    expect(f.requests).toEqual([
      { op: "rpc", record: { type: "get_available_models" } },
      { op: "rpc", record: { type: "set_model", provider: "b", modelId: "two" } },
    ]);
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
  f.editor.setText("keep the tests");
  f.press("return");
  await Bun.sleep(0);
  expect(f.requests).toEqual([
    { op: "rpc", record: { type: "compact", customInstructions: "keep the tests" } },
  ]);
  expect(commands.value()).toBeUndefined();
  expect(f.press("n", { ctrl: true })).toBeUndefined();
});

test("another client's model change reaches the view and the timeline", async () => {
  const f = fixture();
  f.c.adapter.view.timeline.model = "a/one";
  f.c.record(
    event(
      { type: "shield_model", model: { provider: "b", id: "two" } },
      {
        entries: [
          { id: "model", version: 0, kind: "config", setting: "model", from: "a/one", to: "b/two" },
        ],
        timeline: { response: null, nextOrdinal: 0, thinking: null, model: "b/two" },
      },
    ),
  );
  const setup = await testRender(() => <Screen screen={f.screen} />, { width: 100, height: 20 });
  try {
    await setup.flush();
    const frame = setup.captureCharFrame();
    expect(frame).toContain("── model: a/one → b/two");
  } finally {
    setup.renderer.destroy();
  }
});

test("Pi's editor text replaces the prompt, never the draft a dialog holds", async () => {
  const f = fixture();
  f.editor.setText("mine");
  f.c.record(dialog({ type: "extension_ui_request", id: "d", method: "input", title: "Input" }));
  f.editor.setText("answer");
  f.c.record(
    event({ type: "extension_ui_request", id: "e", method: "set_editor_text", text: "from pi" }),
  );
  expect(f.editor.text()).toBe("answer");
  f.press("escape");
  await Bun.sleep(0);
  expect(f.editor.text()).toBe("from pi");
});

test("sending to an agent that ended says why instead of doing nothing", async () => {
  const f = fixture();
  f.editor.setText("hello");
  f.c.record({
    v: 1,
    type: "event",
    "agent-id": "a",
    engine: "pi",
    "hub-instance": "h",
    seq: ++seq,
    payload: { op: "lifecycle", state: "exited", detail: { exitCode: 0 } },
  } as Envelope);
  f.press("return");
  await Bun.sleep(0);
  expect(f.requests).toEqual([]);
  expect(f.editor.text()).toBe("hello");
  expect(f.c.status).toContain("run quin again");
});

test("a request waits as long as the hub's deadline for its command", async () => {
  const f = fixture();
  await f.c.send({ op: "rpc", record: { type: "compact" } });
  await f.c.send({ op: "rpc", record: { type: "get_state" } });
  expect(f.timeouts).toEqual([605_000, 65_000]);
});

test("a burst updates only changed timeline items and preserves nested summaries and disclosure", async () => {
  const f = fixture();
  const timeline = f.screen.ui.controllers.timeline;
  const entries = codemodeRun("code", [], false, ["read"]);
  f.c.record(event({}, { entries }));
  await Bun.sleep(0);
  const unrelated = timeline.find("live:0/r1");
  timeline.setCursor("live:0/c1");
  timeline.expand();
  const child = entries[2]!;
  const revision = timeline.revision();
  f.c.record(event({}, { entries: [{ ...child, version: 1, state: "running" }] }));
  f.c.record(event({}, { entries: [{ ...child, version: 2, state: "error" }] }));
  await Bun.sleep(0);
  expect(timeline.revision()).toBe(revision + 1);
  expect(timeline.find("live:0/r1")).toBe(unrelated);
  expect(timeline.isExpanded("live:0/c1")).toBe(true);
  expect((timeline.find("live:0/c1")!.value as any).calls[0].state).toBe("error");
  expect((timeline.find(child.id)!.value as any).state).toBe("error");
  f.screen.dispose();
});

test("a call's arguments show as far as they have streamed", async () => {
  const f = fixture();
  const tool = {
    id: "live:0/c1",
    kind: "tool",
    version: 0,
    name: "codemode",
    state: "pending",
    args: { available: false },
  };
  const update = async (raw: string, entries: Entry[] = []) => {
    f.c.record(
      event(
        {},
        {
          entries,
          stream: {
            messageId: "live:0",
            message: { content: [{ type: "toolCall", id: "c1" }] },
            arguments: { "0": raw },
          },
        },
      ),
    );
    await Bun.sleep(0);
  };
  await update("", [tool]);
  const args = () => (f.screen.ui.controllers.timeline.find("live:0/c1")?.value as any)?.args;
  expect(args()).toEqual({ available: false });
  await update('{"code": "await tools.re');
  expect(args()).toEqual({ available: true, value: { code: "await tools.re" } });
  await update('{"code": "await tools.read()"}');
  expect(args()).toEqual({ available: true, value: { code: "await tools.read()" } });
});
