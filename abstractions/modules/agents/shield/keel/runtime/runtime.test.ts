// The runtime's own guarantees, on a real Pi session with the faux provider.
import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxText } from "@earendil-works/pi-ai";
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { keel } from "../api";
import { Mirror } from "../protocol/apply";
import type { RuntimeOutput } from "../protocol/wire";
import { call, type Harness, harness, send } from "./test-support";

let current: Harness | undefined;
afterEach(async () => {
  await current?.dispose();
  current = undefined;
});
const start = async (options: Parameters<typeof harness>[0]) => (current = await harness(options));

const texts = (h: Harness) => h.mirror.state!.items.map((item) => item.text);

test("a prompt is accepted before its response, and the response streams into items", async () => {
  const h = await start({ responses: [fauxAssistantMessage("Hello from faux")] });
  const result = await send(h, "hi");
  expect(result).toMatchObject({ outcome: "accepted", detail: { disposition: "started" } });
  await h.until(() => h.mirror.state!.run.phase === "idle" && texts(h).includes("Hello from faux"));
  expect(texts(h)).toEqual(["> hi", "Hello from faux", "Hello from faux"]);
  // The response's prose is its child; the sent prompt cleared its draft.
  expect(h.mirror.state!.items[2]!.parentId).toBe(h.mirror.state!.items[1]!.id);
  expect(h.mirror.state!.drafts.prompt!.text).toBe("");
});

test("events continue the snapshot without gaps, and a late snapshot equals the followed state", async () => {
  const h = await start({ responses: [fauxAssistantMessage([fauxText("one"), fauxText("two")])] });
  await send(h, "go");
  await h.until(
    () => h.mirror.state!.run.phase === "idle" && texts(h).some((t) => t.includes("two")),
  );
  const first = (h.records.find((r) => r.type === "snapshot") as any).snapshot.seq;
  const seqs = h.records.flatMap((r) =>
    r.type === "event" && r.event.seq > first ? [r.event.seq] : [],
  );
  expect(seqs.length).toBeGreaterThan(2);
  expect(seqs).toEqual(seqs.map((_, index) => first + 1 + index));
  const late = new Mirror();
  late.reset(h.runtime.store.snapshot());
  expect(late.state).toEqual(h.mirror.state!);
  expect(late.seq).toBe(h.mirror.seq);
});

test("only the writer writes; a write from the previous writer arriving after a change is refused", async () => {
  const h = await start({});
  const base = h.mirror.state!.drafts.prompt!.revision;
  expect(
    await h.invoke("draft.set", { destination: "prompt", text: "x", base }, "b"),
  ).toMatchObject({
    outcome: "rejected",
    code: "not_writer",
  });
  expect(
    await h.invoke("draft.set", { destination: "prompt", text: "x", base }, "a"),
  ).toMatchObject({
    outcome: "done",
  });
  h.writer("b");
  expect(
    await h.invoke("draft.set", { destination: "prompt", text: "late", base: base + 1 }, "a"),
  ).toMatchObject({ outcome: "rejected", code: "not_writer" });
  // A write the same screen sent under an older epoch is refused after it takes the write back.
  h.writer("a");
  const epoch = h.runtime.writer.epoch;
  const edit = { destination: "prompt", text: "old", base: base + 1 };
  expect(await h.invoke("draft.set", edit, "a", epoch - 2)).toMatchObject({ code: "not_writer" });
  expect(await h.invoke("draft.set", edit, "a", epoch)).toMatchObject({ outcome: "done" });
  // A write that names no epoch is not trusted to be current.
  expect(
    await h.invoke(
      "draft.set",
      { destination: "prompt", text: "no epoch", base: base + 2 },
      "a",
      null,
    ),
  ).toMatchObject({ code: "not_writer" });
  // Control and view actions do not need the write.
  expect(await h.invoke("global.resume", undefined, "a")).toMatchObject({ outcome: "done" });
  expect(await h.invoke("timeline.cursor_down", undefined, "a")).toMatchObject({
    outcome: "rejected",
    code: "unknown_action",
  });
});

test("an edit from an older revision is refused, and a sent draft is cleared only if unchanged", async () => {
  const h = await start({
    responses: [call("wait", "w"), fauxAssistantMessage("done")],
  });
  const set = (text: string, base: number) =>
    h.invoke("draft.set", { destination: "prompt", text, base });
  expect(await set("a", 0)).toMatchObject({ outcome: "done", detail: { revision: 1 } });
  expect(await set("b", 0)).toMatchObject({ outcome: "rejected", code: "stale_revision" });
  expect(await h.invoke("editor.submit", { destination: "prompt", revision: 0 })).toMatchObject({
    outcome: "rejected",
    code: "stale_revision",
  });
  expect(await h.invoke("editor.submit", { destination: "prompt", revision: 1 })).toMatchObject({
    outcome: "accepted",
  });
  await h.until(() => h.started.length === 1);
  // A follow-up typed while the run continues is queued; the newer draft survives.
  await set("follow", 2);
  const sent = h.invoke("editor.submit", { destination: "prompt", revision: 3 });
  await set("still typing", 3).then((r) => expect(r.outcome).toBe("done"));
  expect(await sent).toMatchObject({ outcome: "accepted", detail: { disposition: "queued" } });
  expect(h.mirror.state!.drafts.prompt!.text).toBe("still typing");
  h.release();
  await h.until((m) => m.state!.run.phase === "idle");
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
  expect(texts(h).filter((t) => t.includes("loaded"))).toEqual([]);
  expect(h.runtime.session.extensionRunner.getCommand("listed")).toBeDefined();
});

test("an extension named by a bare file name is read from the configuration directory", async () => {
  const h = await start({
    extensions: ["mine.ts"],
    files: {
      "mine.ts": `export default function (pi) { pi.registerCommand("mine", { handler: async () => {} }); }`,
    },
  });
  expect(h.runtime.session.extensionRunner.getCommand("mine")).toBeDefined();
});

test("an assist candidate is accepted only for the draft it was computed from", async () => {
  const runs: unknown[] = [];
  const echo: ExtensionFactory = (pi) => {
    pi.on("session_start", (_event, ctx) => {
      const k = keel(ctx);
      k.actions.register([
        { id: "echo.run", class: "control", run: ({ args }) => void runs.push(args) },
      ]);
      k.assists.register({
        id: "echo",
        title: "Echo",
        // Slower than a screen's Enter.
        candidates: async (text) => {
          await new Promise((resolve) => setTimeout(resolve, 50));
          return [{ id: "only", label: text, action: { id: "echo.run", args: { text } } }];
        },
      });
    });
  };
  const h = await start({ bundled: { echo }, extensions: ["echo"] });
  const assist = () => h.mirror.state!.assists.find((a) => a.id === "echo")!;
  await h.until(() => assist().revision === 0);
  // The draft moves on before its candidates are computed again.
  await h.invoke("draft.set", { destination: "assist:echo", text: "new text", base: 0 });
  const accept = (revision: number) =>
    h.invoke("assist.accept", { assist: "echo", candidate: "only", revision });
  expect(await accept(0)).toMatchObject({ code: "stale_revision" });
  expect(runs).toEqual([]);
  await h.until(() => assist().revision === 1);
  expect(await accept(1)).toMatchObject({ outcome: "done" });
  expect(runs).toEqual([{ text: "new text" }]);
});

test("a broken configuration file stops the start; missing ones mean defaults", async () => {
  await expect(harness({ files: { "keybindings.json": "{" } })).rejects.toMatchObject({
    code: "config_invalid",
  });
  await expect(
    harness({ files: { "extensions.json": '{"extensions": "x"}' } }),
  ).rejects.toMatchObject({
    code: "config_invalid",
  });
});

test("key problems are reported in the timeline and never stop the start", async () => {
  const h = await start({
    extensions: ["timeline"],
    keybindings: {
      "timeline.missing": "x",
      "timeline.cursor_down": ["q", "nosuchkey"],
      "timeline.cursor_up": "q",
      "global.stop": "j",
      "editor.submit": "a",
    },
  });
  const notices = texts(h).filter((t) => t.startsWith("keybindings:"));
  expect(notices).toEqual(
    expect.arrayContaining([
      "keybindings: unknown action timeline.missing",
      expect.stringContaining('unknown key name "nosuchkey"'),
      "keybindings: Q is bound to timeline.cursor_down and timeline.cursor_up; those bindings are dropped",
      expect.stringMatching(
        /^keybindings: global global.stop takes J before (timeline|stage).cursor_down$/,
      ),
      "keybindings: A for editor.submit types text in the editor; binding dropped",
    ]),
  );
  const keys = h.mirror.state!.keys;
  expect(keys["timeline.cursor_down"]).toEqual([]);
  expect(keys["timeline.cursor_up"]).toEqual([]);
  expect(keys["global.stop"]).toEqual(["j"]);
  expect(keys["editor.submit"]).toEqual([]);
  expect(keys["global.pause"]).toEqual([]);
});

test("removing an extension from the list removes its actions and presentations", async () => {
  const withIt = await start({ extensions: ["timeline", "markdown", "model"] });
  const ids = (h: Harness) => h.mirror.state!.actions.map((a) => a.id);
  expect(ids(withIt)).toContain("timeline.cursor_down");
  expect(ids(withIt)).toContain("global.model_set");
  expect(withIt.mirror.state!.kinds.response).toBe("markdown.response");
  await withIt.dispose();
  const without = await start({});
  expect(ids(without)).not.toContain("timeline.cursor_down");
  expect(ids(without)).not.toContain("global.model_set");
  expect(without.mirror.state!.kinds).toEqual({});
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
  expect(await send(h, "/ask")).toMatchObject({
    outcome: "accepted",
    detail: { disposition: "handled" },
  });
  expect(answers).toEqual([undefined, false, undefined]);
  expect(h.logs.filter((line) => line.includes("ctx.ui."))).toEqual([
    'keel: ctx.ui.select("Pick one") is not shown by keel',
    'keel: ctx.ui.confirm("Sure?") is not shown by keel',
    'keel: ctx.ui.input("Name") is not shown by keel',
    'keel: ctx.ui.notify("hello") is not shown by keel',
  ]);
  expect(h.mirror.state!.requests).toEqual([]);
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
  await send(h, "/replace");
  expect(outcomes).toEqual([{ cancelled: true }, { cancelled: true }, "refused"]);
  const session = h.runtime.session.sessionId;
  await send(h, "go");
  await h.until(() => h.started.length === 1);
  const waiting = send(h, "/after-run");
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(outcomes).toHaveLength(3);
  h.release();
  await waiting;
  expect(outcomes.at(-1)).toBe(true);
  expect(h.runtime.session.sessionId).toBe(session);
});

test("the runtime writes only wire records", async () => {
  const h = await start({ responses: [fauxAssistantMessage("x")] });
  await send(h, "x");
  await h.until((m) => m.state!.run.phase === "idle" && texts(h).includes("x"));
  const types = new Set(h.records.map((r: RuntimeOutput) => r.type));
  for (const type of types) expect(["ready", "snapshot", "event", "result"]).toContain(type);
});
