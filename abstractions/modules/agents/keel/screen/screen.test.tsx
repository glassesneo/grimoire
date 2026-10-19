// What a person at a keel screen relies on, against a real runtime with the
// faux provider: keys, focus, the stage, drafts, and the write right.
import { afterEach, expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { createSignal } from "solid-js";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { keel } from "../api";
import { Connection } from "./connection";
import { type KeelScreen, Screen, setupScreen } from "./screen";
import { call, until } from "../runtime/test-support";
import { linked } from "./test-support";
import { createRenderers } from "./ui/renderers";

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

async function open(options: Parameters<typeof linked>[0] = {}) {
  const { hub, h } = await linked(options);
  cleanup.push(() => h.dispose());
  const screens: { connection: Connection; screen: KeelScreen }[] = [];
  const add = async () => {
    const connection = await hub.connect();
    const screen = setupScreen(connection, {
      clipboard: { writeText: async () => true, dispose: async () => {} },
    });
    cleanup.push(() => screen.dispose());
    screens.push({ connection, screen });
    return { connection, screen };
  };
  return { hub, h, add, screens };
}

const key = (name: string, mods: { ctrl?: boolean; shift?: boolean; meta?: boolean } = {}) => ({
  name,
  ctrl: false,
  shift: false,
  meta: false,
  ...mods,
});
const texts = (c: Connection) => c.mirror.state!.items.map((item) => item.text);

/** Types into the editor as the native input would report it. */
const type = (screen: KeelScreen, text: string) => {
  const current = screen.drafts.text(screen.stage.destination());
  screen.edit(current + text, current.length + text.length);
};

test("typing and Enter send the prompt, the response appears, and the editor empties", async () => {
  const { add } = await open({ responses: [fauxAssistantMessage("Hello from faux")] });
  const { connection, screen } = await add();
  const setup = await testRender(() => <Screen screen={screen} cwd="/project" />, {
    width: 80,
    height: 24,
  });
  cleanup.push(() => setup.renderer.destroy());
  await setup.flush();
  setup.renderer.stdin.emit("data", Buffer.from("hi there\r"));
  await until(
    () =>
      texts(connection).includes("Hello from faux") &&
      connection.mirror.state!.run.phase === "idle",
  );
  await setup.flush();
  const frame = setup.captureCharFrame();
  expect(frame).toContain("> hi there");
  expect(frame).toContain("Hello from faux");
  expect(frame).toContain("writer");
  expect(screen.drafts.text("prompt")).toBe("");
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
  const { add } = await open({
    extensions: ["timeline"],
    keybindings: { "global.pause": "j" },
    responses: [call("wait", "w"), fauxAssistantMessage("x")],
  });
  const { connection, screen } = await add();
  screen.regions.requestFocus("timeline");
  expect(screen.key(key("j"))).toBe(true);
  // Pausing while idle is refused by the runtime; the key reached global.pause, not the cursor.
  await until(() => (screen.state.notice ?? "").startsWith("global.pause"));
  expect(screen.key(key("down"))).toBe(true);
  expect(texts(connection)).toEqual(
    expect.arrayContaining([expect.stringContaining("keybindings: global global.pause takes J")]),
  );
});

test("a request waits without taking focus; selected, the editor holds its supplement and Enter answers it", async () => {
  const answers: unknown[] = [];
  const asking: ExtensionFactory = (pi: ExtensionAPI) => {
    pi.registerTool({
      name: "ask",
      label: "Ask",
      description: "Asks the user",
      parameters: Type.Object({}),
      async execute(_id, _args, _signal, _update, ctx) {
        const answer = await keel(ctx).requests.choice({ title: "Pick", options: ["one", "two"] });
        answers.push(answer);
        return { content: [{ type: "text", text: "asked" }], details: {} };
      },
    });
  };
  const { add } = await open({
    bundled: { asking },
    extensions: ["asking"],
    responses: [call("ask", "a"), fauxAssistantMessage("done")],
  });
  const { connection, screen } = await add();
  type(screen, "go");
  screen.run("editor.submit");
  await until(() => connection.mirror.state!.requests.length === 1);
  // Arrival changes neither the selection nor focus; the prompt draft is kept.
  type(screen, "next prompt");
  expect(screen.stage.selected()).toBeUndefined();
  expect(screen.regions.current()).toBe("editor");
  screen.run("editor.stage_next");
  expect(screen.stage.selected()?.kind).toBe("request");
  expect(screen.drafts.text(screen.stage.destination())).toBe("");
  type(screen, "because");
  screen.run("editor.candidate_next");
  screen.run("editor.submit");
  await until(() => answers.length === 1);
  expect(answers).toEqual([{ status: "answered", value: "two", supplement: "because" }]);
  await until(() => screen.stage.selected() === undefined);
  // Back on the prompt, its draft is as it was.
  expect(screen.drafts.text("prompt")).toBe("next prompt");
  await until(() => connection.mirror.state!.run.phase === "idle");
});

test("stop needs a second press within a second on the same screen, and another action disarms", async () => {
  const { add, h } = await open({
    responses: [call("wait", "w"), fauxAssistantMessage("never")],
  });
  const first = await add();
  const second = await add();
  type(first.screen, "go");
  first.screen.run("editor.submit");
  await until(() => h.started.length === 1);
  first.screen.key(key("c", { ctrl: true }));
  expect(first.screen.state.armedUntil).toBeGreaterThan(0);
  first.screen.run("editor.focus_next");
  expect(first.screen.state.armedUntil).toBe(0);
  // Presses on two screens are not added together.
  first.screen.key(key("c", { ctrl: true }));
  second.screen.key(key("c", { ctrl: true }));
  await Bun.sleep(20);
  expect(first.connection.mirror.state!.run.phase).toBe("running");
  first.screen.key(key("c", { ctrl: true }));
  await until(() => first.connection.mirror.state!.run.phase === "idle");
  expect(texts(first.connection)).not.toContain("never");
});

test("the command input completes a name, then runs the chosen candidate's action", async () => {
  const { add } = await open({ extensions: ["commands", "model"] });
  const { connection, screen } = await add();
  screen.run("editor.command_open");
  expect(screen.stage.selected()?.info.id).toBe("command");
  type(screen, "think");
  await until(
    () => connection.mirror.state!.assists.find((a) => a.id === "command")!.candidates.length === 1,
  );
  screen.run("editor.submit");
  await until(() => connection.mirror.state!.drafts["assist:command"]!.text === "thinking ");
  screen.run("editor.command_open");
  await until(() =>
    connection.mirror
      .state!.assists.find((a) => a.id === "command")!
      .candidates.some((c) => c.label === "high"),
  );
  const candidates = connection.mirror.state!.assists.find((a) => a.id === "command")!.candidates;
  for (let i = 0; i < candidates.findIndex((c) => c.label === "high"); i++)
    screen.run("editor.candidate_next");
  screen.run("editor.submit");
  await until(() => connection.mirror.state!.session.thinking === "high");
});

test("a gap in the event sequence stops changes and replaces the mirror from a new snapshot", async () => {
  const { add } = await open();
  const { connection } = await add();
  const before = connection.mirror.seq;
  (connection.client as any).onRecord({
    v: 1,
    type: "event",
    "agent-id": "agent",
    engine: "keel",
    payload: { runtimeInstance: connection.mirror.runtimeInstance, seq: before + 5, changes: {} },
  });
  expect(["syncing", "live"]).toContain(connection.phase);
  await until(() => connection.phase === "live");
  expect(connection.mirror.seq).toBe(before);
});

test("a terminal too short for the editor draws nothing, and draws again when it grows", async () => {
  const { add } = await open({ responses: [] });
  const { screen } = await add();
  const setup = await testRender(() => <Screen screen={screen} cwd="/project" />, {
    width: 40,
    height: 1,
  });
  cleanup.push(() => setup.renderer.destroy());
  await setup.flush();
  expect(setup.captureCharFrame().trim()).toBe("");
  setup.resize(40, 12);
  await setup.flush();
  expect(setup.captureCharFrame()).toContain("writer");
});

test("an item whose kind maps to no renderer here is shown as its text", async () => {
  const marking: ExtensionFactory = (pi: ExtensionAPI) => {
    pi.on("session_start", (_event, ctx) => {
      keel(ctx).items.present("notice", "renderer.this.screen.lacks");
      keel(ctx).items.notice("info", "plain notice");
    });
  };
  const { add } = await open({ bundled: { marking }, extensions: ["marking"] });
  const { screen } = await add();
  const setup = await testRender(() => <Screen screen={screen} cwd="/project" />, {
    width: 60,
    height: 12,
  });
  cleanup.push(() => setup.renderer.destroy());
  await setup.flush();
  expect(setup.captureCharFrame()).toContain("plain notice");
});

test("Markdown, tool, and codemode renderers show what their items carry", async () => {
  const client: { onRecord: (record: unknown) => void } & Record<string, unknown> = {
    onRecord: () => {},
    onDisconnect: () => {},
    connected: Promise.resolve(),
    close: () => {},
  };
  const connection = new Connection(client as never);
  const item = (id: string, kind: string, data: unknown, extra: Record<string, unknown> = {}) => ({
    id,
    version: 1,
    kind,
    text: `${kind} as text`,
    data,
    ...extra,
  });
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
  client.onRecord({
    v: 1,
    type: "snapshot",
    "agent-id": "agent",
    engine: "keel",
    connection: "c1",
    lifecycle: "ready",
    writer: { connection: "c1", epoch: 1 },
    payload: {
      runtimeInstance: "r",
      seq: 0,
      state: {
        session: { id: "session", cwd: "/project", model: "faux/faux", thinking: null },
        run: { phase: "idle", compacting: false, retrying: false },
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
          item("n", "mystery", {}),
        ],
        queue: { steering: [], followUp: ["later"] },
        requests: [],
        assists: [],
        drafts: { prompt: { text: "", revision: 0 } },
        actions: [],
        keys: {},
        kinds: {
          response: "markdown.response",
          tool: "tool.generic",
          "tool/codemode": "tool.codemode",
          mystery: "renderer.nobody.has",
        },
      },
    },
  });
  const screen = setupScreen(connection);
  cleanup.push(() => screen.dispose());
  const setup = await testRender(() => <Screen screen={screen} cwd="/project" />, {
    width: 100,
    height: 30,
  });
  cleanup.push(() => setup.renderer.destroy());
  await setup.flush();
  await Bun.sleep(50);
  await setup.flush();
  const frame = setup.captureCharFrame();
  expect(frame).toContain("Heading");
  expect(frame).not.toContain("# Heading");
  expect(frame).not.toContain("**bold**");
  expect(frame).toContain("lookup query=keel · done");
  expect(frame).toContain("codemode 1 call · 0.4s · failed at line 2");
  expect(frame).toContain("· read path=notes.md · done");
  expect(frame).toContain("TypeError: cannot read property 'missing' of null");
  expect(frame).toContain("mystery as text");
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
  };
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
  const setup = await testRender(() => <Screen screen={screen} cwd="/project" />, {
    width: 60,
    height: 12,
  });
  cleanup.push(() => setup.renderer.destroy());
  await setup.flush();
  setup.renderer.stdin.emit("data", Buffer.from("typed"));
  await setup.flush();
  await Bun.sleep(20);
  await setup.flush();
  expect(setup.captureCharFrame()).not.toContain("typed");
  expect(setup.captureCharFrame()).toContain("view");
});

test("a key bound to global.stop needs a second press on the same screen, as the region stops do", async () => {
  const { add, h } = await open({
    keybindings: { "global.stop": "ctrl+x" },
    responses: [call("wait", "w"), fauxAssistantMessage("never")],
  });
  const { connection, screen } = await add();
  type(screen, "go");
  screen.run("editor.submit");
  await until(() => h.started.length === 1);
  screen.key(key("x", { ctrl: true }));
  await Bun.sleep(30);
  expect(connection.mirror.state!.run.phase).toBe("running");
  screen.key(key("x", { ctrl: true }));
  await until(() => connection.mirror.state!.run.phase === "idle");
  expect(texts(connection)).not.toContain("never");
});

test("typing between two stop presses disarms the first", async () => {
  const { add, h } = await open({
    responses: [call("wait", "w"), fauxAssistantMessage("done")],
  });
  const { connection, screen } = await add();
  type(screen, "go");
  screen.run("editor.submit");
  await until(() => h.started.length === 1);
  screen.key(key("c", { ctrl: true }));
  // A typed character reaches the editor, not an action.
  expect(screen.key(key("a"))).toBe(false);
  screen.key(key("c", { ctrl: true }));
  await Bun.sleep(30);
  expect(connection.mirror.state!.run.phase).toBe("running");
  h.release();
  await until(() => connection.mirror.state!.run.phase === "idle");
});

test("Enter sends what was typed, or nothing when the agent refused the typing", async () => {
  const { add, h } = await open({ responses: [fauxAssistantMessage("reply")] });
  const { connection, screen } = await add();
  // The agent changes the prompt draft before this screen's typing reaches it.
  h.runtime.store.setDraft("prompt", "theirs");
  type(screen, "mine");
  screen.run("editor.submit");
  await Bun.sleep(50);
  expect(texts(connection)).toEqual([]);
  expect(screen.drafts.text("prompt")).toBe("theirs");
  expect(screen.state.notice).toContain("not saved");
});

test("an assist candidate is accepted for the text typed, once its candidates have caught up", async () => {
  const runs: unknown[] = [];
  const slow: ExtensionFactory = (pi: ExtensionAPI) => {
    pi.on("session_start", (_event, ctx) => {
      const k = keel(ctx);
      k.actions.register([
        { id: "slow.run", class: "control", run: ({ args }) => void runs.push(args) },
      ]);
      k.assists.register({
        id: "slow",
        title: "Slow",
        candidates: async (text) => {
          await Bun.sleep(40);
          return [{ id: "only", label: text, action: { id: "slow.run", args: { text } } }];
        },
      });
    });
  };
  const { add } = await open({ bundled: { slow }, extensions: ["slow"] });
  const { screen } = await add();
  screen.stage.select("assist", "slow");
  type(screen, "typed");
  screen.run("editor.submit");
  await until(() => runs.length === 1);
  expect(runs).toEqual([{ text: "typed" }]);
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
