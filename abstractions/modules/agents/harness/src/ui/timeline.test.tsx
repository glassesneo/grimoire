/**
 * Behavioral tests for the timeline: the live reducer, the projection into
 * selectable items, and the viewport.
 *
 * Admission: these are repository-owned and consumer-visible. A drifting part
 * id loses a streaming update, a wrong parent hides a call, an expandability
 * switch hides data or promises none, a copy writes decoration instead of the
 * source, and a scroll target or anchor moves what the reader is looking at.
 * Type and build checks cannot see those. The model is tested through its pure
 * functions, scroll arithmetic against a fake scrollbox, and anchoring against
 * real layout, asserting coordinates and ids rather than whole frames. Native
 * host/OSC52 delivery is faked here and left to the manual terminal check.
 */
import { describe, expect, test } from "bun:test";
import { engine, type ScrollBoxRenderable } from "@opentui/core";
import { ManualClock } from "@opentui/core/testing";
import { testRender, type JSX } from "@opentui/solid";
import { createSignal } from "solid-js";
import {
  reduceTimeline,
  type SessionEntry,
  splitFencedBlocks,
  type TimelineEvent,
  type TimelineState,
  timelineState,
} from "../core/session-entries";
import { ItemTypeRegistry, type ItemType, type TimelineItem } from "./controllers";
import { TimelineBindings } from "./harness-client";
import { createItemActions, type TimelineScrollBox } from "./item-actions";
import { TimelineProjector, TimelineView } from "./timeline";
import { createTimelineTypes, type ToolSnapshot } from "./timeline-types";

const noteType: ItemType<{ text: string }, string> = {
  kind: "note",
  render: ({ value }) => value.text,
  sourceText: (value) => value.text,
  actions: {},
};

function timelineWithNotes(...texts: string[]) {
  const timeline = new ItemTypeRegistry<string>();
  const factory = timeline.registerType(noteType);
  for (const text of texts) timeline.append(factory.create({ text }));
  return timeline;
}

function fakeBox(options: {
  rows?: Record<string, { y: number; height: number }>;
  height: number;
  scrollHeight: number;
  scrollTop?: number;
}): TimelineScrollBox {
  return {
    scrollTop: options.scrollTop ?? 0,
    scrollHeight: options.scrollHeight,
    height: options.height,
    y: 0,
    getRenderable(id) {
      const row = options.rows?.[id];
      return row ? { ...row, y: row.y - this.scrollTop } : undefined;
    },
  };
}

/** Advances a ManualClock and steps the native engine by the elapsed time. */
function frameDriver(): (ms: number) => void {
  const clock = new ManualClock();
  let last = clock.now();
  return (ms: number) => {
    clock.advance(ms);
    engine.update(clock.now() - last);
    last = clock.now();
  };
}

const event = (value: unknown) => value as TimelineEvent;
const assistant = (content: unknown[], stopReason = "stop") => ({ role: "assistant", content, stopReason });
function run(...events: unknown[]): TimelineState {
  return events.reduce<TimelineState>((state, next) => reduceTimeline(state, event(next)), timelineState([]));
}

function projectionFixture() {
  const timeline = new ItemTypeRegistry<JSX.Element>();
  const types = createTimelineTypes();
  for (const type of Object.values(types)) timeline.registerType(type as ItemType<unknown, JSX.Element>);
  const bindings = new TimelineBindings();
  const diagnostics: string[] = [];
  const projector = new TimelineProjector({ types, registry: timeline, bindings, diagnose: (message) => diagnostics.push(message) });
  return { timeline, types, bindings, projector, diagnostics, project: (entries: readonly SessionEntry[]) => projector.project(entries) };
}

describe("live reducer", () => {
  test("keeps ids while a response streams and puts its tools after it", () => {
    let state = run(
      { type: "message_start", message: assistant([]) },
      { type: "message_update", message: assistant([{ type: "text", text: "first" }]) },
    );
    const id = state.entries[0]!.id;
    state = reduceTimeline(state, event({ type: "message_update", message: assistant([{ type: "text", text: "first second" }]) }));
    expect(state.entries[0]!.id).toBe(id);
    expect(state.entries[0]!.version).toBe(1);
    state = reduceTimeline(state, event({
      type: "message_end",
      message: assistant([{ type: "text", text: "first second" }, { type: "toolCall", id: "t1", name: "read", arguments: { path: "a" } }], "toolUse"),
    }));
    expect(state.entries.map((entry) => entry.kind)).toEqual(["assistant", "tool"]);
    expect(state.entries[0]!.id).toBe(id);
  });

  test("a tool-only reply is no response item, and a failed reply keeps its error", () => {
    const toolOnly = run(
      { type: "message_start", message: assistant([]) },
      { type: "message_end", message: assistant([{ type: "toolCall", id: "t1", name: "bash", arguments: {} }], "toolUse") },
    );
    expect(toolOnly.entries.map((entry) => entry.kind)).toEqual(["tool"]);
    const failed = run(
      { type: "message_start", message: assistant([]) },
      { type: "message_end", message: { ...assistant([], "error"), errorMessage: "overloaded" } },
    );
    expect(failed.entries).toMatchObject([{ kind: "assistant", stopReason: "error", errorMessage: "overloaded" }]);
  });

  test("nested calls follow their parent in start order, keep results, and settle as unfinished", () => {
    const state = run(
      { type: "message_start", message: assistant([]) },
      { type: "message_end", message: assistant([{ type: "toolCall", id: "c", name: "codemode", arguments: { code: "x" } }], "toolUse") },
      { type: "tool_execution_start", toolCallId: "c", toolName: "codemode", args: { code: "x" } },
      { type: "tool_execution_start", toolCallId: "c/1", toolName: "probe", args: { n: 1 }, parentToolCallId: "c" },
      { type: "tool_execution_start", toolCallId: "c/2", toolName: "probe", args: { n: 2 }, parentToolCallId: "c" },
      { type: "tool_execution_end", toolCallId: "c/2", toolName: "probe", result: { content: [{ type: "text", text: "two" }] }, isError: false, parentToolCallId: "c" },
      { type: "tool_execution_update", toolCallId: "c/1", toolName: "probe", args: {}, partialResult: { content: [{ type: "text", text: "partial" }] }, parentToolCallId: "c" },
      { type: "agent_settled" },
    );
    const tools = state.entries.filter((entry) => entry.kind === "tool");
    expect(tools.map((tool) => tool.callId)).toEqual(["c", "c/1", "c/2"]);
    expect(tools[1]).toMatchObject({ parentId: tools[0]!.id, state: "unfinished", result: { partial: true } });
    expect(tools[2]).toMatchObject({ parentId: tools[0]!.id, state: "done", result: { content: [{ type: "text", text: "two" }] } });
    expect(tools[0]!.state).toBe("unfinished");
  });

  test("groups retry attempts, tracks compaction, and marks only real configuration changes", () => {
    const state = run(
      { type: "auto_retry_start", attempt: 1, maxAttempts: 3, delayMs: 100, errorMessage: "busy" },
      { type: "agent_start" },
      { type: "auto_retry_start", attempt: 2, maxAttempts: 3, delayMs: 200, errorMessage: "busy again" },
      { type: "auto_retry_end", success: true, attempt: 2 },
      { type: "compaction_start", reason: "manual" },
      { type: "compaction_end", reason: "manual", result: undefined, aborted: false, willRetry: false, errorMessage: "no model" },
      { type: "thinking_level_changed", level: "high" },
      { type: "thinking_level_changed", level: "low" },
      { type: "model_changed", previous: "a/one", model: "b/two" },
    );
    expect(state.entries.map((entry) => entry.kind)).toEqual(["retry", "compaction", "config", "config"]);
    expect(state.entries[0]).toMatchObject({ state: "succeeded", attempts: [{ error: "busy" }, { error: "busy again" }] });
    expect(state.entries[1]).toMatchObject({ state: "failed", errorMessage: "no model" });
    // The first thinking level seen is the initial configuration, not a change.
    expect(state.entries[2]).toMatchObject({ setting: "thinking", from: "high", to: "low" });
    expect(state.entries[3]).toMatchObject({ setting: "model", from: "a/one", to: "b/two" });
  });
});

describe("splitFencedBlocks", () => {
  test("keeps a backtick block raw, with its language and body separate", () => {
    expect(splitFencedBlocks("before\n```ts\nconst x = 1;\n```\nafter")).toEqual([
      { type: "text", text: "before" },
      { type: "code", language: "ts", body: "const x = 1;", sourceText: "```ts\nconst x = 1;\n```" },
      { type: "text", text: "after" },
    ]);
  });

  test("accepts tilde fences; an unclosed fence is text unless open fences are blocks", () => {
    expect(splitFencedBlocks("~~~\nbody\n~~~")).toEqual([{ type: "code", language: "", body: "body", sourceText: "~~~\nbody\n~~~" }]);
    expect(splitFencedBlocks("```sh\necho hi")).toEqual([{ type: "text", text: "```sh\necho hi" }]);
    expect(splitFencedBlocks("a\n```sh\necho hi", { openFences: true })).toEqual([
      { type: "text", text: "a" },
      { type: "code", language: "sh", body: "echo hi", sourceText: "```sh\necho hi", open: true },
    ]);
  });

  test("does not mistake an inline triple for a block start", () => {
    expect(splitFencedBlocks("a ``` b")).toEqual([{ type: "text", text: "a ``` b" }]);
    expect(splitFencedBlocks("")).toEqual([]);
  });
});

describe("projection", () => {
  const response = (id: string, version: number, parts: unknown[], streaming = false): SessionEntry =>
    ({ kind: "assistant", id, version, parts, streaming, stopReason: streaming ? undefined : "stop", errorMessage: undefined }) as SessionEntry;
  const tool = (overrides: Partial<Extract<SessionEntry, { kind: "tool" }>>): SessionEntry => ({
    kind: "tool", id: "s/t", version: 0, callId: "t", scope: "s", parentId: undefined, name: "generic", ordinal: 0,
    args: { available: true, value: {} }, state: "done", result: undefined, errorSummary: undefined, nestedIncomplete: false,
    ...overrides,
  });

  test("a response is one parent of its thinking, prose, and code, in source order", () => {
    const { project } = projectionFixture();
    const items = project([response("r", 3, [
      { type: "thinking", text: "plan", withheld: false },
      { type: "text", text: "hello\n```ts\nconst x = 1;\n```\nbye" },
    ])]);
    expect(items.map((item) => [item.id, item.kind, item.parentId])).toEqual([
      ["r", "response", undefined],
      ["r:thinking:0", "thinking", "r"],
      ["r:text:1:part:0", "prose", "r"],
      ["r:text:1:part:1", "code", "r"],
      ["r:text:1:part:2", "prose", "r"],
    ]);
    // Copying the parent gives the prose and code as written, without thinking.
    expect(items[0]!.sourceText()).toBe("hello\n```ts\nconst x = 1;\n```\nbye");
    expect(items[3]!.sourceText()).toBe("```ts\nconst x = 1;\n```");
    expect(items[1]!.sourceText()).toBe("plan");
  });

  test("a streamed open fence keeps its part id when the fence closes", () => {
    const { project } = projectionFixture();
    const before = project([response("r", 0, [{ type: "text", text: "a\n```ts\nlet" }], true)]);
    const after = project([response("r", 1, [{ type: "text", text: "a\n```ts\nlet v = 1\n```\nb" }], true)]);
    expect(before.map((item) => item.id)).toEqual(["r", "r:text:0:part:0", "r:text:0:part:1"]);
    expect(after.map((item) => item.id).slice(0, 3)).toEqual(before.map((item) => item.id));
  });

  test("withheld thinking has nothing to copy and never exposes its signature", () => {
    const { project } = projectionFixture();
    const items = project([response("r", 0, [{ type: "thinking", text: "", withheld: true }])]);
    expect(items.map((item) => item.kind)).toEqual(["response", "thinking"]);
    expect(items[1]!.sourceText()).toBeUndefined();
    expect(items[0]!.sourceText()).toBeUndefined();
  });

  test("user images are selectable children that start expanded, copied as metadata", () => {
    const { project } = projectionFixture();
    const items = project([{ kind: "user", id: "u", version: 0, text: "look", images: [{ type: "image", data: "AAAA", mimeType: "image/png" }] }]);
    expect(items.map((item) => [item.kind, item.parentId, item.initiallyExpanded])).toEqual([["user", undefined, false], ["image", "u", true]]);
    expect(items[1]!.sourceText()).toBe("image 1 (image/png, 3 B)");
  });

  test("expandability follows the data, not the tool's name", () => {
    const { project } = projectionFixture();
    const long = Array.from({ length: 8 }, (_, index) => `line ${index}`).join("\n");
    const cases: [SessionEntry, boolean][] = [
      [tool({ name: "read", result: { content: [{ type: "text", text: long }], details: undefined, partial: false } }), false],
      [tool({ name: "read", result: { content: [{ type: "image", data: "AAAA", mimeType: "image/png" }], details: undefined, partial: false } }), true],
      [tool({ name: "read", state: "error", result: { content: [{ type: "text", text: "missing" }], details: undefined, partial: false } }), false],
      [tool({ name: "read", state: "error", result: { content: [{ type: "text", text: long }], details: undefined, partial: false } }), true],
      [tool({ name: "generic", result: { content: [], details: undefined, partial: false } }), false],
      [tool({ name: "generic", result: { content: [{ type: "text", text: "out" }], details: undefined, partial: false } }), true],
      // A missing result is not an empty successful one, and has nothing to expand.
      [tool({ name: "generic", state: "missing" }), false],
      [tool({ name: "write", args: { available: true, value: { path: "f", content: "body" } } }), true],
      [tool({ name: "edit", result: { content: [{ type: "text", text: "ok" }], details: { diff: "-a\n+b" }, partial: false } }), true],
      [tool({ name: "edit", result: { content: [{ type: "text", text: "ok" }], details: undefined, partial: false } }), false],
    ];
    for (const [index, [base, expected]] of cases.entries()) {
      // Distinct ids: the projector reuses an unchanged entry's items.
      const entry = { ...base, id: `s/t${index}` } as SessionEntry;
      expect([entry.kind === "tool" && entry.name, project([entry])[0]!.expandable]).toEqual([entry.kind === "tool" && entry.name, expected]);
    }
  });

  test("nested calls are children of their parent tool and summarized on it", () => {
    const { project } = projectionFixture();
    const items = project([
      tool({ id: "s/c", callId: "c", name: "codemode", args: { available: true, value: { code: "x" } } }),
      tool({ id: "s/c/1", callId: "c/1", parentId: "s/c", name: "read", args: { available: false, bytes: 9000 }, state: "done" }),
    ]);
    expect(items.map((item) => [item.kind, item.parentId])).toEqual([["tool:codemode", undefined], ["tool:read", "s/c"]]);
    // A tool copies its original result; without one there is nothing to copy.
    expect(items[1]!.sourceText()).toBeUndefined();
  });

  test("bindings choose a compiled kind, and a rejected value falls back with the same id", () => {
    const { project, bindings, diagnostics } = projectionFixture();
    const entry = tool({ name: "mine", result: { content: [{ type: "text", text: "$ ok" }], details: undefined, partial: false } });
    const good = bindings.bindTool("mine", { kind: "tool:bash" });
    expect(project([entry])[0]!.kind).toBe("tool:bash");
    const bad = bindings.bindTool("mine", { kind: "tool:bash", project: () => ({ nonsense: true }) });
    const fallback = project([entry])[0]!;
    expect([fallback.kind, fallback.id]).toEqual(["tool", entry.id]);
    expect(diagnostics).toHaveLength(1);
    bad.dispose();
    expect(project([entry])[0]!.kind).toBe("tool:bash");
    good.dispose();
    expect(project([entry])[0]!.kind).toBe("tool");
  });

  test("an unchanged entry keeps its item objects", () => {
    const { project } = projectionFixture();
    const entries: SessionEntry[] = [{ kind: "notice", id: "n", version: 0, level: "info", text: "x" }];
    const first = project(entries);
    expect(project(entries)[0]).toBe(first[0]);
  });
});

describe("viewport", () => {
  const rows = {
    "timeline-0": { y: 0, height: 3 },
    "timeline-1": { y: 3, height: 3 },
    "timeline-2": { y: 6, height: 3 },
    "timeline-3": { y: 9, height: 3 },
  };

  test("navigation centers the selected item's first line, the last item included", () => {
    const timeline = timelineWithNotes("a", "b", "c", "d");
    const box = fakeBox({ rows, height: 9, scrollHeight: 20 });
    const actions = createItemActions({ timeline, scrollbox: () => box, overlayHeight: () => 2, topInset: () => 1 });
    const frame = frameDriver();
    try {
      // Usable rows are 1..6 of the viewport; the first line goes to row 3.
      actions.move(1);
      frame(120);
      expect(box.scrollTop).toBe(0);
      actions.move(1);
      frame(120);
      expect(box.getRenderable("timeline-2")!.y).toBe(3);
      // Not aligned to the end: the last item's first line is centered too.
      actions.move(1);
      frame(120);
      expect(box.getRenderable("timeline-3")!.y).toBe(3);
    } finally {
      void actions.dispose();
    }
  });

  test("manual scrolling never recenters the selection and resumes following only at the real end", () => {
    const timeline = timelineWithNotes("a", "b", "c", "d");
    const box = fakeBox({ rows, height: 6, scrollHeight: 30 });
    const actions = createItemActions({ timeline, scrollbox: () => box, overlayHeight: () => 0 });
    const frame = frameDriver();
    try {
      expect(actions.following()).toBe(true);
      actions.scroll("half-down");
      frame(120);
      expect(box.scrollTop).toBe(3);
      expect(timeline.cursor()).toBe("timeline-0");
      expect(actions.following()).toBe(false);
      // Content above grows: the first visible item stays on its row.
      rows["timeline-1"].y = 5;
      box.scrollTop = 3;
      actions.frame();
      expect(box.getRenderable("timeline-1")!.y).toBe(0);
      rows["timeline-1"].y = 3;
      actions.scroll("page-down");
      actions.scroll("page-down");
      actions.scroll("page-down");
      actions.scroll("page-down");
      frame(120);
      expect(box.scrollTop).toBe(24);
      expect(actions.following()).toBe(true);
    } finally {
      void actions.dispose();
    }
  });

  test("adds repeated page input to the in-flight target and clamps at the ends", () => {
    const timeline = timelineWithNotes("a", "b", "c");
    const box = fakeBox({ height: 10, scrollHeight: 100 });
    const actions = createItemActions({ timeline, scrollbox: () => box, overlayHeight: () => 0 });
    const frame = frameDriver();
    try {
      actions.scroll("half-down");
      frame(60);
      actions.scroll("half-down");
      frame(120);
      expect(box.scrollTop).toBe(10);
      box.scrollTop = 90;
      actions.scroll("page-down");
      frame(120);
      expect(box.scrollTop).toBe(90);
      box.scrollTop = 0;
      actions.scroll("page-up");
      frame(120);
      expect(box.scrollTop).toBe(0);
    } finally {
      void actions.dispose();
    }
  });

  test("reveal moves an off-screen cursor to the last visible item and keeps a visible one", () => {
    const timeline = timelineWithNotes("a", "b", "c", "d");
    const box = fakeBox({ rows, height: 6, scrollHeight: 15, scrollTop: 4 });
    const actions = createItemActions({ timeline, scrollbox: () => box, overlayHeight: () => 2 });
    const frame = frameDriver();
    try {
      timeline.setCursor("timeline-1");
      actions.reveal();
      frame(120);
      expect(timeline.cursor()).toBe("timeline-1");
      expect(box.scrollTop).toBe(4);
      timeline.setCursor("timeline-0");
      actions.reveal();
      frame(120);
      expect(timeline.cursor()).toBe("timeline-3");
    } finally {
      void actions.dispose();
    }
  });
});

describe("copy", () => {
  const writer = (written: string[], result = true) => ({
    writeText: async (text: string) => { written.push(text); return result; },
    dispose: async () => {},
  });

  test("copies the source text, not the render, and reports neither success nor a notice", async () => {
    const timeline = new ItemTypeRegistry<string>();
    const factory = timeline.registerType({ kind: "raw", render: ({ value }) => `rendered:${value}`, sourceText: (value: string) => `raw:${value}`, actions: {} });
    timeline.append(factory.create("alpha"));
    const written: string[] = [];
    const notices: string[] = [];
    const actions = createItemActions({ timeline, scrollbox: () => undefined, overlayHeight: () => 0, clipboard: writer(written), notify: (level, text) => notices.push(`${level}:${text}`) });
    await expect(actions.copy()).resolves.toBe(true);
    expect(written).toEqual(["raw:alpha"]);
    expect(notices).toEqual([]);
  });

  test("reports an item without source instead of writing anything", async () => {
    const timeline = new ItemTypeRegistry<string>();
    const factory = timeline.registerType({ kind: "none", render: () => "x", sourceText: () => undefined, actions: {} });
    timeline.append(factory.create(undefined));
    const written: string[] = [];
    const notices: string[] = [];
    const actions = createItemActions({ timeline, scrollbox: () => undefined, overlayHeight: () => 0, clipboard: writer(written), notify: (level, text) => notices.push(`${level}:${text}`) });
    await expect(actions.copy()).resolves.toBe(false);
    expect(written).toEqual([]);
    expect(notices).toHaveLength(1);
  });

  test("emits an error notice when no backend takes the text", async () => {
    const timeline = timelineWithNotes("a", "b");
    const notices: string[] = [];
    const actions = createItemActions({ timeline, scrollbox: () => undefined, overlayHeight: () => 0, clipboard: writer([], false), notify: (level, text) => notices.push(`${level}:${text}`) });
    await expect(actions.copy()).resolves.toBe(false);
    expect(notices).toHaveLength(1);
    expect(notices[0]?.startsWith("error:")).toBe(true);
  });
});

/** A rendered timeline with real layout, driven through the item actions. */
async function rendered(entries: readonly SessionEntry[], options: { width?: number; height?: number; overlay?: number } = {}) {
  const fixture = projectionFixture();
  fixture.timeline.replace(fixture.project(entries));
  let box: TimelineScrollBox | undefined;
  const [slack, setSlack] = createSignal(0);
  const overlay = options.overlay ?? 2;
  const actions = createItemActions({ timeline: fixture.timeline, scrollbox: () => box, overlayHeight: () => overlay, onSlackChange: setSlack });
  const setup = await testRender(
    () => <TimelineView timeline={fixture.timeline} focused overlayHeight={overlay} slack={slack()} scrollRef={(element) => { box = element; }} onFrame={actions.frame} />,
    { width: options.width ?? 50, height: options.height ?? 16 },
  );
  const settle = async () => {
    for (let index = 0; index < 4; index++) {
      engine.update(120);
      await setup.flush();
      await setup.renderOnce();
    }
  };
  await settle();
  const top = (id: string) => {
    const row = box!.getRenderable(id) as TimelineItem & { y: number } | undefined;
    return row ? row.y - box!.y : undefined;
  };
  return {
    ...fixture, actions, setup, settle, top, box: () => box!,
    dispose: async () => { await actions.dispose(); setup.renderer.destroy(); },
  };
}

const lines = (count: number, prefix: string) => Array.from({ length: count }, (_, index) => `${prefix} ${index}`).join("\n");
const bash = (id: string, output: string): SessionEntry => ({
  kind: "tool", id, version: 0, callId: id, scope: "s", parentId: undefined, name: "bash", ordinal: 0,
  args: { available: true, value: { command: `run ${id}` } }, state: "done",
  result: { content: [{ type: "text", text: output }], details: undefined, partial: false }, errorSummary: undefined, nestedIncomplete: false,
});
const note = (id: string, text: string): SessionEntry => ({ kind: "notice", id, version: 0, level: "info", text });

describe("rendered viewport", () => {
  test("opening and closing keep the item's first line and everything above it in place", async () => {
    const view = await rendered([note("n0", lines(6, "above")), bash("b1", lines(12, "out")), note("n2", lines(6, "below"))]);
    try {
      view.timeline.setCursor("b1");
      view.actions.move(0);
      await view.settle();
      const header = view.top("b1")!;
      const above = view.top("n0");
      view.actions.toggle();
      await view.settle();
      expect(view.timeline.isExpanded("b1")).toBe(true);
      expect(view.top("b1")).toBe(header);
      expect(view.top("n0")).toBe(above);
      view.actions.toggle();
      await view.settle();
      expect(view.top("b1")).toBe(header);
      expect(view.top("n0")).toBe(above);
    } finally {
      await view.dispose();
    }
  });

  test("closing at the end keeps the item in place with temporary blank rows, retired by navigation", async () => {
    const view = await rendered([note("n0", lines(10, "above")), bash("b1", lines(30, "out"))], { height: 14 });
    try {
      view.timeline.setCursor("b1");
      view.actions.toggle();
      await view.settle();
      // Read to the end of the long output, then close it from there.
      view.actions.scroll("page-down");
      view.actions.scroll("page-down");
      view.actions.scroll("page-down");
      await view.settle();
      view.timeline.setCursor("b1");
      view.actions.move(0);
      await view.settle();
      const header = view.top("b1")!;
      view.actions.collapse();
      await view.settle();
      expect(view.timeline.isExpanded("b1")).toBe(false);
      expect(view.top("b1")).toBe(header);
      const spacer = () => view.setup.renderer.root.findDescendantById("timeline-spacer")!.height;
      expect(spacer()).toBeGreaterThan(2);
      view.actions.move(-1);
      await view.settle();
      expect(spacer()).toBe(2);
      expect(view.top("n0")).toBeGreaterThanOrEqual(0);
      const box = view.box();
      expect(box.scrollTop).toBeLessThanOrEqual(Math.max(0, box.scrollHeight - box.height));
    } finally {
      await view.dispose();
    }
  });

  test("an off-screen item is revealed and toggled in one step, and h returns to an off-screen parent", async () => {
    const view = await rendered([
      note("n0", lines(4, "first")),
      { kind: "assistant", id: "r", version: 0, streaming: false, stopReason: "stop", errorMessage: undefined, parts: [{ type: "text", text: `${lines(20, "para")}\n\n\`\`\`ts\nconst x = 1;\n\`\`\`` }] },
      note("n2", lines(20, "later")),
    ], { height: 14 });
    try {
      view.timeline.setCursor("r");
      view.actions.toggle();
      await view.settle();
      const code = view.timeline.visibleItems().find((item) => item.kind === "code")!;
      view.timeline.setCursor(code.id);
      view.actions.move(0);
      await view.settle();
      // Scroll the parent away, then collapse from the child.
      view.actions.scroll("page-down");
      await view.settle();
      expect(view.top("r")! < 0 || view.top("r")! >= 12).toBe(true);
      view.actions.collapse();
      await view.settle();
      expect(view.timeline.cursor()).toBe("r");
      expect(view.timeline.isExpanded("r")).toBe(false);
      const header = view.top("r")!;
      expect(header).toBeGreaterThanOrEqual(0);
      expect(header).toBeLessThan(12);
    } finally {
      await view.dispose();
    }
  });
});

describe("TimelineView", () => {
  test("adds spacers as tall as the overlays, shows queues apart, and exposes its scrollbox", async () => {
    const { timeline, project } = projectionFixture();
    timeline.replace(project([{ kind: "user", id: "user-1", version: 0, text: "hi", images: [] }]));
    let box: TimelineScrollBox | undefined;
    const setup = await testRender(
      () => <TimelineView timeline={timeline} overlayHeight={2} topInset={1} queued={{ steering: ["now"], followUp: ["next"] }} scrollRef={(element) => { box = element; }} />,
      { width: 60, height: 20 },
    );
    await setup.flush();
    expect(setup.renderer.root.findDescendantById("timeline-spacer")?.height).toBe(2);
    expect(setup.renderer.root.findDescendantById("timeline-top-spacer")?.height).toBe(1);
    expect(typeof box?.getRenderable).toBe("function");
    expect(setup.captureCharFrame()).toContain("steering: now");
    expect(setup.captureCharFrame()).toContain("queued: next");
    setup.renderer.destroy();
  });

  test("wraps rows left of the scrollbar, marks the cursor only when focused, and keeps the bar above the overlay", async () => {
    const { timeline, project } = projectionFixture();
    timeline.replace(project(Array.from({ length: 6 }, (_, index): SessionEntry => note(`n${index}`, "x".repeat(60)))));
    timeline.setCursor(timeline.items().at(-1)!.id);
    const [focused, setFocused] = createSignal(false);
    const setup = await testRender(
      () => <TimelineView timeline={timeline} focused={focused()} overlayHeight={4} />,
      { width: 40, height: 16 },
    );
    await setup.flush();
    for (const line of setup.captureCharFrame().split("\n")) expect(/x/.test(line.slice(39))).toBe(false);
    // The selection is a leading marker, not a background.
    expect(setup.captureCharFrame()).not.toContain("❯");
    setFocused(true);
    await setup.flush();
    expect(setup.captureCharFrame()).toContain("❯");
    const box = setup.renderer.root.findDescendantById("timeline-scrollbox") as ScrollBoxRenderable;
    expect(box.verticalScrollBar.height).toBe(12);
    setup.renderer.destroy();
  });

  test("previews show four rendered rows and say how many follow", async () => {
    const { timeline, project } = projectionFixture();
    timeline.replace(project([bash("b", lines(9, "row"))]));
    const setup = await testRender(() => <TimelineView timeline={timeline} overlayHeight={0} />, { width: 40, height: 16 });
    for (let index = 0; index < 3; index++) { await setup.flush(); await setup.renderOnce(); }
    const frame = setup.captureCharFrame();
    expect(frame).toContain("row 3");
    expect(frame).not.toContain("row 4");
    expect(frame).toContain("5 more rows");
    setup.renderer.destroy();
  });
});

test("snapshots handed to bindings are plain data", () => {
  const { project, bindings } = projectionFixture();
  let seen: ToolSnapshot | undefined;
  bindings.bindTool("x", { kind: "tool", project: (snapshot) => { seen = snapshot; return snapshot; } });
  project([{ kind: "tool", id: "s/t", version: 0, callId: "t", scope: "s", parentId: undefined, name: "x", ordinal: 0, args: { available: true, value: { a: 1 } }, state: "running", result: undefined, errorSummary: undefined, nestedIncomplete: false }]);
  expect(JSON.parse(JSON.stringify(seen))).toEqual(seen as unknown as Record<string, unknown>);
  expect(seen).toMatchObject({ name: "x", state: "running", result: undefined, calls: [] });
});

describe("frame stability", () => {
  const response = (id: string, version: number, text: string, streaming: boolean, thinking?: string): SessionEntry => ({
    kind: "assistant", id, version, streaming, stopReason: streaming ? undefined : "stop", errorMessage: undefined,
    parts: [...(thinking ? [{ type: "thinking" as const, text: thinking, withheld: false }] : []), { type: "text", text }],
  });

  /** Row tops and the frame text for each of `count` frames, with no settling between them. */
  async function frames(view: Awaited<ReturnType<typeof rendered>>, ids: string[], count: number) {
    const result: { tops: (number | undefined)[]; text: string }[] = [];
    for (let index = 0; index < count; index++) {
      engine.update(16);
      await view.setup.renderOnce();
      result.push({ tops: ids.map((id) => view.top(id)), text: view.setup.captureCharFrame() });
    }
    return result;
  }

  test("moving the selection and toggling do not shift rows for a frame", async () => {
    const view = await rendered([
      response("r1", 0, lines(3, "first"), false, lines(2, "plan")),
      bash("b1", lines(9, "out")),
      response("r2", 0, lines(3, "second"), false, lines(6, "idea")),
      note("n3", "end"),
    ], { height: 40, overlay: 0 });
    try {
      const ids = ["r1", "b1", "r2", "n3"];
      const before = (await frames(view, ids, 1))[0]!.tops;
      view.timeline.setCursor("r1");
      for (const step of [() => view.timeline.moveCursor(1), () => view.timeline.moveCursor(1)]) {
        step();
        for (const frame of await frames(view, ids, 3)) expect(frame.tops).toEqual(before);
      }
      // Opening keeps every row above the item and the item's first line on the first frame.
      view.timeline.setCursor("b1");
      const header = view.top("b1");
      view.actions.toggle();
      for (const frame of await frames(view, ids, 3)) {
        expect(frame.tops.slice(0, 2)).toEqual([before[0], header]);
      }
    } finally {
      await view.dispose();
    }
  });

  test("a streaming reply does not blank or move the finished history above it", async () => {
    const finished = response("r1", 0, "finished answer stays visible", false, lines(6, "earlier thought"));
    const view = await rendered([finished, response("r2", 0, "stream", true)], { height: 30, overlay: 0 });
    try {
      // Markdown highlights asynchronously; start once the history is drawn.
      for (let wait = 0; wait < 20 && !view.setup.captureCharFrame().includes("finished answer stays visible"); wait++) {
        await Bun.sleep(20);
        await view.setup.renderOnce();
      }
      expect(view.setup.captureCharFrame()).toContain("finished answer stays visible");
      const top = view.top("r1");
      let text = "stream";
      for (let version = 1; version <= 10; version++) {
        text += ` token${version}`;
        view.timeline.replace(view.project([finished, response("r2", version, text, true)]));
        for (const frame of await frames(view, ["r1"], 1)) {
          expect(frame.text).toContain("finished answer stays visible");
          expect(frame.text).toContain("2 more rows");
          expect(frame.tops[0]).toBe(top);
        }
      }
    } finally {
      await view.dispose();
    }
  });
});

test("direct shell commands stream into their own entries and finish with their result", () => {
  const result = { output: "a\nb\n", exitCode: 0, cancelled: false, truncated: false };
  const state = run(
    { type: "bash_started", id: "one", command: "ls" },
    { type: "bash_started", id: "two", command: "sleep 1" },
    { type: "bash_execution_update", id: "one", delta: "a\n" },
    { type: "bash_execution_update", id: "two", delta: "z" },
    { type: "bash_finished", id: "one", result },
  );
  expect(state.entries).toMatchObject([
    { kind: "bash", running: false, command: "ls", output: "a\nb\n", exitCode: 0 },
    { kind: "bash", running: true, command: "sleep 1", output: "z" },
  ]);
});
