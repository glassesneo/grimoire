// What only the driver does, on a real Pi session with the faux provider: entries from Pi's
// events, extension loading, declarations and their functions, decorators, assists, and
// requests extensions wait on.
import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxText } from "@earendil-works/pi-ai";
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { keel, type KeelContext, type Registration, type ToolCall } from "../api";
import { Refused } from "./link";
import { Timeline, type TimelineEvent } from "./timeline";
import { call, type Harness, harness, notices, prompts, responded, tools } from "./test-support";

let current: Harness | undefined;
afterEach(async () => {
  await current?.dispose();
  current = undefined;
});
const start = async (options: Parameters<typeof harness>[0]) => (current = await harness(options));
const idle = (h: Harness) => h.run().phase === "idle";

test("a prompt is accepted before its response, which streams into one entry", async () => {
  const h = await start({ responses: [fauxAssistantMessage([fauxText("one"), fauxText("two")])] });
  expect(await h.submit("hi")).toEqual({ outcome: "submitted", disposition: "started" });
  await h.until(() => idle(h) && responded(h, "one\ntwo"));
  expect(prompts(h)).toEqual(["hi"]);
  const response = h.entries().find((entry) => entry.kind === "assistant")!;
  // Each update of the response went out as the same entry with a higher version.
  const versions = h.records.flatMap((record) =>
    record.type === "entries"
      ? record.entries.filter((e) => e.id === response.id).map((e) => e.version)
      : [],
  );
  expect(versions.length).toBeGreaterThan(1);
  expect(versions).toEqual([...versions].sort((a, b) => a - b));
  expect(h.records.some((record) => record.type === "entries" && record.order)).toBe(false);
});

test("a prompt Pi refuses before reporting is refused, and stopping refuses new ones", async () => {
  const h = await start({ responses: [call("wait", "w"), fauxAssistantMessage("done")] });
  const session = h.driver.session;
  const prompt = session.prompt.bind(session);
  session.prompt = () => Promise.reject(new Error("no model"));
  expect(await h.submit("x")).toEqual({
    outcome: "rejected",
    code: "refused",
    message: "no model",
  });
  session.prompt = prompt;
  await h.submit("go");
  await h.until(() => h.started.length === 1);
  const stop = h.action("global.stop");
  expect(await h.submit("during stop")).toMatchObject({ outcome: "rejected", code: "stopping" });
  expect(await stop).toEqual({ outcome: "accepted" });
  await h.until(() => idle(h) && h.driver.session.isIdle);
});

test("a prompt Pi ends without reporting is unknown, never refused", async () => {
  const h = await start({});
  const session = h.driver.session;
  session.prompt = () => Promise.resolve();
  expect(await h.submit("x")).toMatchObject({ outcome: "unknown", code: "acceptance_unknown" });
});

test("only listed extensions load: settings, packages, and project directories are not searched", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "keel-cwd-"));
  const sentinel = (name: string) =>
    `export default function (pi) { pi.on("session_start", () => { throw new Error("${name} loaded"); }); }`;
  mkdirSync(join(cwd, ".pi/extensions"), { recursive: true });
  writeFileSync(join(cwd, ".pi/extensions/project.ts"), sentinel("project"));
  const listed = join(cwd, "listed.ts");
  writeFileSync(
    listed,
    `export default function (pi) { pi.registerCommand("listed", { handler: async () => {} }); }`,
  );
  const h = await start({
    cwd,
    extensions: [listed],
    settings: { extensions: [join(cwd, ".pi/extensions/project.ts")] },
    files: { "extensions/global.ts": "" },
  });
  expect(notices(h).filter((t) => t.includes("loaded"))).toEqual([]);
  expect(h.driver.session.extensionRunner.getCommand("listed")).toBeDefined();
});

test("an extension named by a bare file name is read from the configuration directory", async () => {
  const h = await start({
    extensions: ["mine.ts"],
    files: {
      "mine.ts": `export default function (pi) { pi.registerCommand("mine", { handler: async () => {} }); }`,
    },
  });
  expect(h.driver.session.extensionRunner.getCommand("mine")).toBeDefined();
});

test("a broken configuration file stops the start; the key configuration goes to the model as read", async () => {
  await expect(harness({ files: { "keybindings.json": "{" } })).rejects.toMatchObject({
    code: "config_invalid",
  });
  await expect(
    harness({ files: { "extensions.json": '{"extensions": "x"}' } }),
  ).rejects.toMatchObject({
    code: "config_invalid",
  });
  const h = await start({ keybindings: { "global.stop": "j" } });
  expect(h.records.find((record) => record.type === "ready")).toMatchObject({
    keys: { "global.stop": "j" },
  });
});

test("declarations are complete when the driver is ready, and leave with their extension", async () => {
  const withIt = await start({ extensions: ["timeline", "markdown", "model"] });
  const ready = withIt.records.findIndex((record) => record.type === "ready");
  const operations = withIt.records.slice(ready).filter((record) => record.type === "operation");
  expect(operations).toEqual([]);
  expect(withIt.actions().get("timeline.cursor_down")).toBe("screen");
  expect(withIt.actions().get("global.model_set")).toBe("driver");
  expect(withIt.actions().get("global.stop")).toBe("driver");
  await withIt.dispose();
  current = undefined;
  const without = await start({});
  expect(without.actions().has("timeline.cursor_down")).toBe(false);
  expect(without.actions().has("global.model_set")).toBe(false);
});

test("a refused declaration rejects whoever awaits it, unhandled by nobody, and takes its function back", async () => {
  const outcomes: unknown[] = [];
  const declaring: ExtensionFactory = (pi) => {
    pi.on("session_start", async (_event, ctx) => {
      const k = keel(ctx);
      // Not awaited: the model shows its refusal; nothing else may break.
      void k.actions.register([{ id: "taken.quiet", run: () => "quiet" }]);
      await k.actions
        .register([{ id: "taken.loud", run: () => "loud" }])
        .catch((error: unknown) => outcomes.push(error instanceof Refused && error.code));
    });
  };
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => void unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  let h: Harness;
  try {
    h = await start({
      bundled: { declaring },
      extensions: ["declaring"],
      refuse: ["taken.quiet", "taken.loud"],
    });
    await Bun.sleep(10);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
  expect(unhandled).toEqual([]);
  expect(outcomes).toEqual(["invalid_declaration"]);
  expect(await h.action("taken.loud")).toMatchObject({
    outcome: "rejected",
    code: "unknown_action",
  });
  expect(await h.action("taken.quiet")).toMatchObject({
    outcome: "rejected",
    code: "unknown_action",
  });
});

test("a withdrawn action runs no more, and one already running finishes", async () => {
  let registration: Registration | undefined;
  let finish: (() => void) | undefined;
  const slow: ExtensionFactory = (pi) => {
    pi.on("session_start", async (_event, ctx) => {
      registration = await keel(ctx).actions.register([
        {
          id: "slow.run",
          class: "control",
          run: () => new Promise<string>((resolve) => (finish = () => resolve("finished"))),
        },
      ]);
    });
  };
  const h = await start({ bundled: { slow }, extensions: ["slow"] });
  const running = h.action("slow.run");
  await h.until(() => finish !== undefined);
  await registration!.dispose();
  expect(h.actions().has("slow.run")).toBe(false);
  expect(await h.action("slow.run")).toMatchObject({ code: "unknown_action" });
  finish!();
  expect(await running).toEqual({ outcome: "done", detail: "finished" });
});

test("a decorator sees its own call and raw content, and runs again only when that call or the decorators change", async () => {
  const seen: ToolCall[] = [];
  let remove: (() => void) | undefined;
  const decorating: ExtensionFactory = (pi) => {
    pi.on("session_start", (_event, ctx) => {
      const decoration = keel(ctx).items.decorateTool("wait", "probe", (tool, content) => {
        seen.push(structuredClone(tool));
        return { calls: seen.length, content: content.length };
      });
      remove = () => decoration.dispose();
    });
  };
  const h = await start({
    bundled: { decorating },
    extensions: ["decorating"],
    responses: [call("wait", "w1"), fauxAssistantMessage("after")],
  });
  await h.submit("go");
  await h.until(() => h.started.length === 1);
  const before = seen.length;
  h.release();
  await h.until(() => idle(h) && responded(h, "after"));
  const [tool] = tools(h, "wait");
  expect(tool!.state).toBe("done");
  expect(seen.length).toBeGreaterThan(before);
  // The decorator sees the call as it is, never what decorators added or the calls it made.
  expect(seen.at(-1)).toMatchObject({ callId: "w1", name: "wait", state: "done" });
  expect(seen.at(-1)).not.toHaveProperty("extra");
  expect(seen.at(-1)).not.toHaveProperty("calls");
  expect(tool!.extra).toEqual({ probe: { calls: seen.length, content: 1 } });
  // Entries that are not this call do not run it.
  const settled = seen.length;
  h.driver.timeline.notice("info", "unrelated");
  await Bun.sleep(10);
  expect(seen.length).toBe(settled);
  remove!();
  await h.until(() => tools(h, "wait")[0]!.extra === undefined);
  expect(seen.length).toBe(settled);
});

test("an assist's candidates come from the driver; invalid ones and withdrawn assists are refused", async () => {
  let registration: Registration | undefined;
  const echo: ExtensionFactory = (pi) => {
    pi.on("session_start", async (_event, ctx) => {
      const k = keel(ctx);
      registration = await k.assists.register({
        id: "echo",
        title: "Echo",
        candidates: (text) =>
          text === "bad"
            ? ([{ id: "x" }] as never)
            : [{ id: "only", label: text, action: { id: "echo.run", args: { text } } }],
      });
      expect(await k.assists.list()).toContain("echo");
    });
  };
  const h = await start({ bundled: { echo }, extensions: ["echo"] });
  expect(await h.query("echo", "hi")).toEqual({
    outcome: "candidates",
    candidates: [{ id: "only", label: "hi", action: { id: "echo.run", args: { text: "hi" } } }],
  });
  expect(await h.query("echo", "bad")).toMatchObject({ outcome: "rejected", code: "failed" });
  await registration!.dispose();
  expect(await h.query("echo", "hi")).toMatchObject({
    outcome: "rejected",
    code: "unknown_assist",
  });
});

test("a request an extension waits on is the model's to close; it may take no supplement, and an abort cancels it", async () => {
  const answers: unknown[] = [];
  const controller = new AbortController();
  const asking: ExtensionFactory = (pi) => {
    pi.on("session_start", async (_event, ctx) => {
      const k = keel(ctx);
      await k.actions.register([
        {
          id: "test.ask",
          class: "control",
          run: () => {
            void k.requests.confirm({ title: "Sure?" }).then((a) => answers.push(a));
            void k.requests
              .choice({ title: "Pick", options: ["a", "b"], supplement: false })
              .then((a) => answers.push(a));
            void k.requests
              .choice({ title: "Later", options: ["x"], signal: controller.signal })
              .then((a) => answers.push(a));
          },
        },
      ]);
    });
  };
  const h = await start({ bundled: { asking }, extensions: ["asking"] });
  await h.action("test.ask");
  await h.until(() => h.requests.size === 3);
  const [confirm, choice] = [...h.requests.values()];
  expect(confirm).toMatchObject({ kind: "confirm", options: ["Yes", "No"], supplement: true });
  expect(choice).toMatchObject({ kind: "choice", supplement: false });
  h.answer(confirm!.id, { status: "answered", value: true, supplement: "because" });
  h.answer(choice!.id, { status: "answered", value: "b" });
  controller.abort();
  await h.until(() => answers.length === 3);
  expect(answers).toEqual([
    { status: "answered", value: true, supplement: "because" },
    { status: "answered", value: "b" },
    { status: "cancelled" },
  ]);
});

test("Pi's standard UI is answered without being shown, and logged", async () => {
  const answers: unknown[] = [];
  const h = await start({
    bundled: {
      asker: (pi) => {
        pi.registerCommand("ask", {
          handler: async (_args, ctx) => {
            answers.push(await ctx.ui.select("Pick one", ["a", "b"]));
            answers.push(await ctx.ui.confirm("Sure?", "really"));
            answers.push(await ctx.ui.input("Name"));
            ctx.ui.notify("hello");
          },
        });
      },
    },
    extensions: ["asker"],
  });
  expect(await h.submit("/ask")).toEqual({ outcome: "submitted", disposition: "handled" });
  expect(answers).toEqual([undefined, false, undefined]);
  // Each call is logged by its name, so it can be found.
  const logged = h.logs.filter((line) => line.includes("ctx.ui."));
  for (const name of ["select", "confirm", "input", "notify"])
    expect(logged.some((line) => line.includes(`ctx.ui.${name}(`))).toBe(true);
  expect(h.requests.size).toBe(0);
});

test("a command cannot replace the session, and one waiting for idle waits for the run", async () => {
  const outcomes: unknown[] = [];
  const replacing: ExtensionFactory = (pi) => {
    pi.registerCommand("replace", {
      handler: async (_args, ctx) => {
        outcomes.push(await ctx.newSession());
        outcomes.push(await ctx.fork("x"));
        outcomes.push(
          await ctx.reload().then(
            () => "reloaded",
            () => "refused",
          ),
        );
      },
    });
    pi.registerCommand("after-run", {
      handler: async (_args, ctx) => {
        await ctx.waitForIdle();
        outcomes.push(ctx.isIdle());
      },
    });
  };
  const h = await start({
    bundled: { replacing },
    extensions: ["replacing"],
    responses: [call("wait", "w"), fauxAssistantMessage("done")],
  });
  await h.submit("/replace");
  expect(outcomes).toEqual([{ cancelled: true }, { cancelled: true }, "refused"]);
  const session = h.driver.session.sessionId;
  await h.submit("go");
  await h.until(() => h.started.length === 1);
  const waiting = h.submit("/after-run");
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(outcomes).toHaveLength(3);
  h.release();
  await waiting;
  expect(outcomes.at(-1)).toBe(true);
  expect(h.driver.session.sessionId).toBe(session);
});

test("a decorator does not run again when the calls its tool made change, and runs when another decorator comes", async () => {
  let runs = 0;
  let k: KeelContext | undefined;
  const scripting: ExtensionFactory = (pi) => {
    pi.registerTool({
      name: "script",
      label: "Script",
      description: "Calls wait twice",
      parameters: Type.Object({}),
      async execute(_id, _args, _signal, _update, ctx) {
        await ctx.executeTool("wait", {});
        await ctx.executeTool("wait", {});
        return { content: [{ type: "text", text: "script done" }], details: {} };
      },
    });
    pi.on("session_start", (_event, ctx) => {
      k = keel(ctx);
      k.items.decorateTool("script", "probe", () => ++runs);
    });
  };
  const h = await start({
    bundled: { scripting },
    extensions: ["scripting"],
    responses: [call("script", "s1"), fauxAssistantMessage("after")],
  });
  await h.submit("go");
  await h.until(() => h.started.length === 1);
  const whileRunning = runs;
  // The script's nested calls start, finish, and start again; the script itself does not change.
  h.release();
  await h.until(() => h.started.length === 2);
  expect(tools(h, "wait")).toHaveLength(2);
  expect(runs).toBe(whileRunning);
  h.release();
  await h.until(() => idle(h) && responded(h, "after"));
  const finished = runs;
  k!.items.decorateTool("script", "other", () => "more");
  await h.until(() => tools(h, "script")[0]!.extra?.other === "more");
  expect(runs).toBe(finished + 1);
});

test("an entry inserted before others goes out with the complete order", () => {
  const timeline = new Timeline();
  const event = (value: unknown) => value as TimelineEvent;
  timeline.reduce(
    event({ type: "tool_execution_start", toolCallId: "t1", toolName: "read", args: {} }),
  );
  expect(timeline.take()).not.toHaveProperty("order");
  // The response's text arrives after its tool started, and goes before it.
  timeline.reduce(
    event({
      type: "message_update",
      message: { role: "assistant", content: [{ type: "text", text: "Reading." }] },
    }),
  );
  const taken = timeline.take()!;
  expect(taken.entries.map((entry) => entry.kind)).toEqual(["assistant"]);
  expect(taken.order).toEqual([taken.entries[0]!.id, "response-0/t1"]);
});

test("a request closed in the same read that gave its id is answered", async () => {
  const answers: unknown[] = [];
  const asking: ExtensionFactory = (pi) => {
    pi.on("session_start", async (_event, ctx) => {
      const k = keel(ctx);
      await k.actions.register([
        {
          id: "test.ask",
          class: "control",
          run: () =>
            void k.requests.choice({ title: "Pick", options: ["a"] }).then((a) => answers.push(a)),
        },
      ]);
    });
  };
  const h = await start({
    bundled: { asking },
    extensions: ["asking"],
    answerOnOpen: { status: "answered", value: "a", supplement: "" },
  });
  await h.action("test.ask");
  await h.until(() => answers.length === 1);
  expect(answers).toEqual([{ status: "answered", value: "a", supplement: "" }]);
});

test("stopping right after an extension asked cancels its request", async () => {
  const answers: unknown[] = [];
  const asking: ExtensionFactory = (pi) => {
    pi.on("session_start", async (_event, ctx) => {
      const k = keel(ctx);
      await k.actions.register([
        {
          id: "test.ask",
          class: "control",
          run: () =>
            void k.requests.choice({ title: "Pick", options: ["a"] }).then((a) => answers.push(a)),
        },
      ]);
    });
  };
  const h = await start({ bundled: { asking }, extensions: ["asking"] });
  void h.action("test.ask");
  await h.action("global.stop");
  await h.until(() => answers.length === 1);
  expect(answers).toEqual([{ status: "cancelled" }]);
});

test("stopping reports the stop before asking the model to cancel, and never waits for its answer", async () => {
  const h = await start({
    hold: ["cancel_requests"],
    responses: [call("wait", "w1"), fauxAssistantMessage("never")],
  });
  await h.submit("go");
  await h.until(() => h.started.length === 1);
  expect(await h.action("global.stop")).toEqual({ outcome: "accepted" });
  await h.until(() => idle(h) && h.driver.session.isIdle);
  const stopping = h.records.findIndex(
    (record) => record.type === "status" && record.run?.phase === "stopping",
  );
  const cancel = h.records.findIndex(
    (record) => record.type === "operation" && record.operation.op === "cancel_requests",
  );
  expect(stopping).toBeGreaterThan(-1);
  expect(stopping).toBeLessThan(cancel);
  h.releaseHeld();
});

test("an ending driver sends nothing more and takes nothing more, an answer it still awaited included", async () => {
  let k: KeelContext | undefined;
  let ran = false;
  const capturing: ExtensionFactory = (pi) => {
    pi.on("session_start", async (_event, ctx) => {
      k = keel(ctx);
      await k.actions.register([
        { id: "test.late", class: "control", run: () => void (ran = true) },
      ]);
    });
  };
  const h = await start({ bundled: { capturing }, extensions: ["capturing"], hold: ["set_draft"] });
  const pending = k!.drafts.set("prompt", "x").then(
    () => "resolved",
    () => "rejected",
  );
  const waiting = k!.requests.choice({ title: "Pick", options: ["a"] });
  await h.until(() => h.requests.size === 1);
  const before = h.records.length;
  await h.dispose();
  current = undefined;
  expect(await waiting).toEqual({ status: "cancelled" });
  expect(await pending).toBe("rejected");
  // The held answer and a later instruction arrive; neither fails the driver or runs anything.
  h.releaseHeld();
  void h.action("test.late");
  await Bun.sleep(20);
  expect(ran).toBe(false);
  h.driver.timeline.notice("info", "after the end");
  await Bun.sleep(10);
  expect(h.records.length).toBe(before);
});
