// What a person at a keel screen relies on, against a scripted agent: keys, focus, the
// stage, drafts, the write right, and what the screen does with records it cannot trust.
import { afterEach, expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { createSignal } from "solid-js";
import type { Item, RequestInfo, State } from "../protocol/wire";
import { Connection } from "./connection";
import { type KeelScreen, Screen, setupScreen } from "./screen";
import { FakeHub, fixture, TIMELINE, until } from "./test-support";
import { createRenderers } from "./ui/renderers";

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

async function open(hub = new FakeHub()) {
  const add = async () => {
    const connection = await hub.connect();
    const screen = setupScreen(connection, {
      clipboard: { writeText: async () => true, dispose: async () => {} },
    });
    cleanup.push(() => screen.dispose());
    return { connection, screen };
  };
  return { hub, add };
}

async function render(screen: KeelScreen, width = 80, height = 24) {
  const setup = await testRender(() => <Screen screen={screen} cwd="/project" />, {
    width,
    height,
  });
  cleanup.push(() => setup.renderer.destroy());
  await setup.flush();
  return setup;
}

/** The frame once it shows `text`, each look after a finished render; fails after 5 s. */
async function showing(setup: Awaited<ReturnType<typeof render>>, text: string) {
  const end = Date.now() + 5000;
  for (;;) {
    await setup.flush();
    const frame = setup.captureCharFrame();
    if (frame.includes(text)) return frame;
    if (Date.now() > end) throw new Error(`the screen never showed ${text}`);
    await Bun.sleep(20);
  }
}

const key = (name: string, mods: { ctrl?: boolean; shift?: boolean; meta?: boolean } = {}) => ({
  name,
  ctrl: false,
  shift: false,
  meta: false,
  ...mods,
});

/** Types into the editor as the native input would report it. */
const type = (screen: KeelScreen, text: string) => {
  const current = screen.drafts.text(screen.stage.destination());
  screen.edit(current + text, current.length + text.length);
};

const notice = (id: string, text: string): Item => ({
  id,
  version: 1,
  kind: "notice",
  text,
  data: { level: "info", text },
});

const request = (id: string, supplement: boolean): RequestInfo => ({
  id,
  kind: "choice",
  title: "Pick",
  options: ["one", "two"],
  ...(supplement ? { destination: `request:${id}` } : {}),
});

test("typing and Enter send the prompt revision that holds the text, and the editor follows the model", async () => {
  const { hub, add } = await open();
  hub.handlers.set("editor.submit", () => {
    hub.publish({
      drafts: { prompt: { text: "", revision: 2 } },
      items: [notice("user-0", "> hi there")],
      order: ["user-0"],
    });
    return { outcome: "accepted", appliedSeq: hub.seq, detail: { disposition: "started" } };
  });
  const { screen } = await add();
  const setup = await render(screen);
  setup.renderer.stdin.emit("data", Buffer.from("hi there\r"));
  await until(() => hub.sent("editor.submit").length === 1);
  expect(hub.sent("editor.submit")[0]!.args).toEqual({ destination: "prompt", revision: 1 });
  expect(hub.sent("draft.set").at(-1)!.args).toEqual({
    destination: "prompt",
    text: "hi there",
    base: 0,
  });
  await until(() => screen.drafts.text("prompt") === "");
  await setup.flush();
  const frame = setup.captureCharFrame();
  expect(frame).toContain("> hi there");
  expect(frame).toContain("writer");
});

test("a second screen views: its typing is refused until it takes the write, which the first loses", async () => {
  const { add } = await open();
  const first = await add();
  const second = await add();
  expect(first.connection.writable).toBe(true);
  expect(second.connection.writable).toBe(false);
  type(second.screen, "x");
  expect(second.screen.drafts.text("prompt")).toBe("");
  expect(second.screen.state.notice).toContain("views only");
  // A viewer may still run control actions such as taking the write.
  expect(second.screen.key(key("w", { meta: true }))).toBe(true);
  await until(() => second.connection.writable && !first.connection.writable);
  type(second.screen, "mine");
  await until(() => second.connection.mirror.state!.drafts.prompt!.text === "mine");
  // The first screen follows the new text and may no longer change it.
  await until(() => first.screen.drafts.text("prompt") === "mine");
  type(first.screen, "!");
  expect(first.screen.drafts.text("prompt")).toBe("mine");
});

test("a global key is looked up before the focused region's", async () => {
  const { hub, add } = await open(new FakeHub(fixture(TIMELINE, { "global.pause": ["j"] })));
  const { screen } = await add();
  screen.regions.requestFocus("timeline");
  expect(screen.key(key("j"))).toBe(true);
  await until(() => hub.sent("global.pause").length === 1);
  // A region's own key still reaches its action, which this screen runs itself.
  expect(screen.key(key("down"))).toBe(true);
  expect(hub.sent("timeline.cursor_down")).toEqual([]);
});

test("a request waits without taking focus; selected, the editor holds its supplement and Enter answers with it", async () => {
  const { hub, add } = await open();
  const { screen } = await add();
  type(screen, "next prompt");
  hub.publish({
    requests: [request("r0", true)],
    drafts: { ...hub.state.drafts, "request:r0": { text: "", revision: 0 } },
  });
  await until(() => screen.stage.waiting() === 1);
  expect(screen.stage.selected()).toBeUndefined();
  expect(screen.regions.current()).toBe("editor");
  screen.run("editor.stage_next");
  expect(screen.stage.selected()?.kind).toBe("request");
  expect(screen.drafts.text(screen.stage.destination())).toBe("");
  type(screen, "because");
  screen.run("editor.candidate_next");
  screen.run("editor.submit");
  await until(() => hub.sent("request.answer").length === 1);
  expect(hub.sent("request.answer")[0]!.args).toEqual({ request: "r0", value: "two", revision: 1 });
  hub.publish({ requests: [], drafts: { prompt: hub.state.drafts.prompt! } });
  await until(() => screen.stage.selected() === undefined);
  // Back on the prompt, its draft is as it was.
  expect(screen.drafts.text("prompt")).toBe("next prompt");
});

test("a request without a supplement takes no typing, keeps the prompt as it was, and Enter answers it", async () => {
  const { hub, add } = await open();
  const { screen } = await add();
  const setup = await render(screen);
  setup.renderer.stdin.emit("data", Buffer.from("draft"));
  await until(() => hub.state.drafts.prompt?.text === "draft");
  hub.publish({ requests: [request("r1", false)] });
  await until(() => screen.stage.waiting() === 1);
  // Its arrival takes no focus and leaves the prompt in the editor.
  expect(screen.regions.current()).toBe("editor");
  screen.run("editor.stage_next");
  await setup.flush();
  expect(setup.captureCharFrame()).toContain("no supplement; Enter answers");
  setup.renderer.stdin.emit("data", Buffer.from("typed"));
  await setup.flush();
  await Bun.sleep(20);
  await setup.flush();
  expect(setup.captureCharFrame()).not.toContain("typed");
  setup.renderer.stdin.emit("data", Buffer.from("\r"));
  await until(() => hub.sent("request.answer").length === 1);
  expect(hub.sent("request.answer")[0]!.args).toEqual({ request: "r1", value: "one" });
  // Nothing typed went to any draft, the prompt's included, and nothing says the answer failed.
  expect(hub.sent("draft.set").map((invocation) => invocation.args)).toEqual([
    { destination: "prompt", text: "draft", base: 0 },
  ]);
  expect(hub.state.drafts.prompt!.text).toBe("draft");
  await until(() => !(screen.state.notice ?? "").includes("Enter answers"));
});

test("a request without a supplement arriving while the timeline is focused leaves focus there", async () => {
  const { hub, add } = await open(new FakeHub(fixture(TIMELINE)));
  const { screen } = await add();
  screen.regions.requestFocus("timeline");
  hub.publish({ requests: [request("r1", false)] });
  await until(() => screen.stage.waiting() === 1);
  expect(screen.regions.current()).toBe("timeline");
  expect(screen.stage.selected()).toBeUndefined();
});

test("stop needs a second press within a second on the same screen, and another action disarms", async () => {
  const { hub, add } = await open();
  const first = await add();
  const second = await add();
  first.screen.key(key("c", { ctrl: true }));
  expect(first.screen.state.armedUntil).toBeGreaterThan(0);
  first.screen.run("editor.focus_next");
  expect(first.screen.state.armedUntil).toBe(0);
  // Presses on two screens are not added together.
  first.screen.key(key("c", { ctrl: true }));
  second.screen.key(key("c", { ctrl: true }));
  await Bun.sleep(20);
  expect(hub.sent("global.stop")).toEqual([]);
  first.screen.key(key("c", { ctrl: true }));
  await until(() => hub.sent("global.stop").length === 1);
});

test("a key bound to global.stop needs a second press on the same screen, as the region stops do", async () => {
  const { hub, add } = await open(new FakeHub(fixture([], { "global.stop": ["ctrl+x"] })));
  const { screen } = await add();
  screen.key(key("x", { ctrl: true }));
  await Bun.sleep(30);
  expect(hub.sent("global.stop")).toEqual([]);
  screen.key(key("x", { ctrl: true }));
  await until(() => hub.sent("global.stop").length === 1);
});

test("typing between two stop presses disarms the first", async () => {
  const { hub, add } = await open();
  const { screen } = await add();
  screen.key(key("c", { ctrl: true }));
  // A typed character reaches the editor, not an action.
  expect(screen.key(key("a"))).toBe(false);
  screen.key(key("c", { ctrl: true }));
  await Bun.sleep(30);
  expect(hub.sent("global.stop")).toEqual([]);
});

test("an assist candidate is accepted for the text typed, once its candidates have caught up", async () => {
  const hub = new FakeHub();
  hub.state = {
    ...hub.state,
    assists: [
      { id: "slow", title: "Slow", destination: "assist:slow", revision: 0, candidates: [] },
    ],
    drafts: { ...hub.state.drafts, "assist:slow": { text: "", revision: 0 } },
  };
  const { add } = await open(hub);
  const { screen } = await add();
  screen.stage.select("assist", "slow");
  type(screen, "typed");
  screen.run("editor.submit");
  await until(() => hub.state.drafts["assist:slow"]!.revision === 1);
  await Bun.sleep(40);
  expect(hub.sent("assist.accept")).toEqual([]);
  hub.publish({
    assists: [
      {
        ...hub.state.assists[0]!,
        revision: 1,
        candidates: [{ id: "only", label: "typed", action: { id: "slow.run" } }],
      },
    ],
  });
  await until(() => hub.sent("assist.accept").length === 1);
  expect(hub.sent("assist.accept")[0]!.args).toEqual({
    assist: "slow",
    candidate: "only",
    revision: 1,
  });
});

test("Enter sends nothing when the model refused the typing, and the editor shows the model's text", async () => {
  const { hub, add } = await open();
  const { screen } = await add();
  // The model's prompt changes before this screen's typing reaches it.
  hub.publish({ drafts: { prompt: { text: "theirs", revision: 1 } } });
  const stale = hub.handlers.get("draft.set")!;
  hub.handlers.set("draft.set", async (invocation) => {
    await Bun.sleep(10);
    return stale({ ...invocation, args: { ...invocation.args, base: 0 } });
  });
  await until(() => screen.drafts.text("prompt") === "theirs");
  screen.edit("mine", 4);
  screen.run("editor.submit");
  await Bun.sleep(60);
  expect(hub.sent("editor.submit")).toEqual([]);
  expect(screen.drafts.text("prompt")).toBe("theirs");
  expect(screen.state.notice).toContain("not saved");
});

test("a gap in the event sequence asks for a new snapshot, which brings what the screen missed", async () => {
  const { hub, add } = await open();
  const { connection } = await add();
  const asked = hub.snapshots;
  // An event the screen never received moves the agent on.
  hub.state = { ...hub.state, items: [notice("notice-0", "missed")] };
  hub.seq += 1;
  (connection.client as any).onRecord({
    v: 1,
    type: "event",
    "agent-id": "agent",
    engine: "keel",
    payload: { instance: hub.instance, seq: hub.seq + 1, changes: {} },
  });
  await until(() => hub.snapshots === asked + 1 && connection.phase === "live");
  expect(connection.mirror.state!.items.map((item) => item.text)).toEqual(["missed"]);
});

/** Delivers records to a screen's connection in one read, as the hub's socket does. */
const deliver = (connection: Connection, records: Record<string, unknown>[]) => {
  for (const record of records)
    (connection.client as any).onRecord({ v: 1, "agent-id": "agent", engine: "keel", ...record });
};

const snapshotRecord = (hub: FakeHub, state: State) => ({
  type: "snapshot",
  connection: "c1",
  lifecycle: "ready",
  writer: { connection: "c1", epoch: hub.epoch },
  payload: { instance: hub.instance, seq: hub.seq + 10, state },
});

test("a record that does not conform is not applied: the screen closes, keeps what it showed, and says why", async () => {
  const { hub, add } = await open();
  hub.publish({ items: [notice("notice-0", "kept on screen")], order: ["notice-0"] });
  const { connection, screen } = await add();
  const setup = await render(screen, 60, 12);
  const seq = connection.mirror.seq;
  // A snapshot that would replace everything follows in the same read; it must not apply.
  deliver(connection, [
    {
      type: "event",
      payload: {
        instance: hub.instance,
        seq: seq + 1,
        changes: { items: [notice("notice-1", "never shown")], drafts: { prompt: { text: 1 } } },
      },
    },
    snapshotRecord(hub, { ...hub.state, items: [notice("notice-2", "after the invalid one")] }),
  ]);
  expect(connection.phase).toBe("ended");
  expect(connection.mirror.seq).toBe(seq);
  expect(hub.clients).toHaveLength(0);
  expect(hub.writer).toBeUndefined();
  await setup.flush();
  const frame = setup.captureCharFrame();
  expect(frame).toContain("kept on screen");
  expect(frame).not.toContain("never shown");
  expect(frame).not.toContain("after the invalid one");
  expect(connection.notice).toContain("invalid event");
});

test("an invalid snapshot is not applied either, and the screen closes", async () => {
  const { hub, add } = await open();
  const { connection } = await add();
  const seq = connection.mirror.seq;
  deliver(connection, [
    snapshotRecord(hub, { ...hub.state, drafts: { prompt: { text: "x" } } } as never),
  ]);
  expect(connection.phase).toBe("ended");
  expect(connection.mirror.seq).toBe(seq);
  expect(connection.notice).toContain("invalid snapshot");
  expect(hub.clients).toHaveLength(0);
});

test("an invalid result closes the screen and is reported as of unknown effect", async () => {
  const { hub, add } = await open();
  hub.handlers.set("global.pause", () => ({ outcome: "maybe" }) as never);
  const { connection, screen } = await add();
  screen.run("global.pause");
  await until(() => connection.phase === "ended");
  expect(connection.notice).toContain("invalid result");
  expect(hub.clients).toHaveLength(0);
});

test("an unknown outcome is reported and not retried", async () => {
  const { hub, add } = await open();
  hub.handlers.set("global.pause", () => ({ outcome: "unknown", code: "acceptance_unknown" }));
  const { screen } = await add();
  screen.run("global.pause");
  await until(() => (screen.state.notice ?? "").includes("acceptance_unknown"));
  expect(screen.state.notice).toContain("not sent again");
  await Bun.sleep(20);
  expect(hub.sent("global.pause")).toHaveLength(1);
});

test("an agent that ends leaves its last items and drafts on the screen", async () => {
  const { hub, add } = await open();
  hub.publish({ items: [notice("notice-0", "the last words")], order: ["notice-0"] });
  const { connection, screen } = await add();
  const setup = await render(screen, 60, 12);
  setup.renderer.stdin.emit("data", Buffer.from("unsent"));
  await until(() => hub.state.drafts.prompt?.text === "unsent");
  deliver(connection, [
    { type: "management", payload: { op: "lifecycle", state: "exited", detail: { exitCode: 0 } } },
  ]);
  expect(connection.phase).toBe("ended");
  await setup.flush();
  const frame = setup.captureCharFrame();
  expect(frame).toContain("the last words");
  expect(frame).toContain("unsent");
  expect(frame).toContain("exited");
});

test("a terminal too short for the editor draws nothing, and draws again when it grows", async () => {
  const { add } = await open();
  const { screen } = await add();
  const setup = await render(screen, 40, 1);
  expect(setup.captureCharFrame().trim()).toBe("");
  setup.resize(40, 12);
  await setup.flush();
  expect(setup.captureCharFrame()).toContain("writer");
});

test("an item whose kind maps to no renderer here is shown as its text", async () => {
  const hub = new FakeHub();
  hub.state = {
    ...hub.state,
    items: [notice("notice-0", "plain notice")],
    kinds: { notice: "renderer.this.screen.lacks" },
  };
  const { add } = await open(hub);
  const { screen } = await add();
  const setup = await render(screen, 60, 12);
  expect(setup.captureCharFrame()).toContain("plain notice");
});

test("Markdown, tool, and codemode renderers show what their items carry", async () => {
  const item = (id: string, kind: string, data: unknown, extra: Record<string, unknown> = {}) =>
    ({ id, version: 1, kind, text: `${kind} as text`, data, ...extra }) as Item;
  const failedScript = {
    callId: "s",
    name: "codemode",
    args: { available: true, value: { code: "await tools.read({});\nnull.missing;" } },
    state: "error",
    result: { text: "Script failed", images: [], partial: false },
    calls: [
      { name: "read", args: { available: true, value: { path: "notes.md" } }, state: "done" },
    ],
    extra: {
      codemode: {
        code: "await tools.read({});\nnull.missing;",
        wallTime: "0.4s",
        output: "",
        images: [],
        error: "TypeError: cannot read property 'missing' of null",
        location: { kind: "located", line: 2 },
      },
    },
  };
  const hub = new FakeHub();
  hub.state = {
    ...hub.state,
    items: [
      item("r", "response", {
        thinking: "",
        hasThinking: false,
        thinkingWithheld: false,
        body: "# Heading\nSome **bold** words",
        streaming: false,
      }),
      item(
        "t",
        "tool",
        {
          callId: "t",
          name: "lookup",
          args: { available: true, value: { query: "keel" } },
          state: "done",
          result: { text: "found it", images: [], partial: false },
          calls: [],
        },
        { variant: "lookup" },
      ),
      item("s", "tool", failedScript, { variant: "codemode" }),
      item("n", "notice", { level: "info", text: "x" }),
    ],
    queue: { steering: [], followUp: ["later"] },
    kinds: {
      response: "markdown.response",
      tool: "tool.generic",
      "tool/codemode": "tool.codemode",
      notice: "renderer.nobody.has",
    },
  };
  const { add } = await open(hub);
  const { screen } = await add();
  const setup = await render(screen, 100, 30);
  // Markdown is rendered asynchronously; each look waits for a finished frame.
  const frame = await showing(setup, "Heading");
  expect(frame).not.toContain("# Heading");
  expect(frame).not.toContain("**bold**");
  // What each item carries is shown; the separators between are not the point.
  expect(frame).toMatch(/lookup.*query=keel.*done/);
  expect(frame).toMatch(/codemode.*1 call.*0\.4s.*failed at line 2/);
  expect(frame).toMatch(/read.*path=notes\.md.*done/);
  expect(frame).toContain("TypeError: cannot read property 'missing' of null");
  expect(frame).toContain("notice as text");
  expect(frame).toContain("queued: later");
});

test("expanded scripts keep their source, line numbers, and error marker when the source changes", async () => {
  const [script, setScript] = createSignal({
    code: Array.from({ length: 9 }, (_, i) => `source_${i + 1}`).join("\n"),
    line: 9,
  });
  const value = {
    id: "script",
    version: 1,
    kind: "tool",
    text: "script",
    data: {
      callId: "s",
      name: "codemode",
      args: { available: false },
      state: "error",
      calls: [],
      extra: {
        codemode: {
          get code() {
            return script().code;
          },
          output: "",
          location: {
            kind: "located",
            get line() {
              return script().line;
            },
          },
        },
      },
    },
  } as unknown as Item;
  const renderer = createRenderers()["tool.codemode"]!;
  const setup = await testRender(
    () => renderer.renderDetails!({ value, id: value.id, version: 1, expanded: true }),
    { width: 60, height: 20 },
  );
  cleanup.push(() => setup.renderer.destroy());
  await setup.flush();
  expect(setup.captureCharFrame()).toMatch(/9 source_9\s+← error/);
  setScript({ code: `${script().code}\nsource_10`, line: 10 });
  await setup.flush();
  const frame = setup.captureCharFrame();
  expect(frame).toContain("1 source_1");
  expect(frame).toMatch(/10 source_10\s+← error/);
  expect(frame).not.toMatch(/9 source_9\s+← error/);
});

test("a viewer's typing does not stay in its editor", async () => {
  const { add } = await open();
  await add();
  const { screen } = await add();
  const setup = await render(screen, 60, 12);
  setup.renderer.stdin.emit("data", Buffer.from("typed"));
  await setup.flush();
  await Bun.sleep(20);
  await setup.flush();
  expect(setup.captureCharFrame()).not.toContain("typed");
  expect(setup.captureCharFrame()).toContain("view");
});

test("before the agent's state arrives, the close keys still close the screen", async () => {
  let detached = 0;
  const client = {
    onRecord: () => {},
    onDisconnect: () => {},
    connected: Promise.resolve(),
    close: () => {},
  };
  const connection = new Connection(client as never);
  connection.onDetach = () => detached++;
  const screen = setupScreen(connection);
  cleanup.push(() => screen.dispose());
  expect(screen.key(key("q", { ctrl: true }))).toBe(true);
  expect(detached).toBe(1);
});
