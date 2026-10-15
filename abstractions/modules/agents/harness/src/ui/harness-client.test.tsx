/**
 * Admission: the client is the boundary where extension data meets compiled
 * types, and its generations decide which extension may still change the
 * screen. A missed validation corrupts an item, a stale client that still
 * mutates leaks into the next session, and a lost copy leaves extensions
 * without the client. Controllers cover the operations; a real faux session
 * rendered by the Screen covers pi's copy of the context, reload, the status
 * line, and the run indicator.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { testRender, type JSX } from "@opentui/solid";
import { createFauxSession } from "../core/faux";
import { createSessionHost, verifyClientCopy } from "../core/session";
import type { ItemType, StageContentType } from "./controllers";
import { createClientHost, type HarnessUIClient, StaleClientError } from "./harness-client";
import { createHarnessUI } from "./harness-ui";
import { Screen } from "./screen";
import { composeLine, type LineSegment, statuslineSegments } from "./statusline";

const noteType: ItemType<{ text: string }, string> = {
  kind: "note",
  render: ({ value }) => value.text,
  sourceText: (value) => value.text,
  actions: {},
  validate: (value): value is { text: string } =>
    typeof (value as { text?: unknown })?.text === "string",
};
const privateType: ItemType<string, string> = {
  kind: "private",
  render: (props) => props.value,
  sourceText: (value) => value,
  actions: {},
};
const askType: StageContentType<{ question: string }, string> = {
  kind: "ask",
  defaultValue: { question: "" },
  render: ({ value }) => value.question,
  validate: (value): value is { question: string } =>
    typeof (value as { question?: unknown })?.question === "string",
};

function controllers() {
  const ui = createHarnessUI<string>();
  ui.timeline.registerType(noteType);
  ui.timeline.registerType(privateType);
  ui.stage.registerType(askType);
  ui.statusline.registerType({
    kind: "count",
    segment: (value: number) => ({ text: `n=${value}` }),
    validate: (value): value is number => typeof value === "number",
  });
  const { timeline, items, bindings, stage, statusline, regions } = ui.controllers;
  return {
    ui,
    timeline,
    stage,
    statusline,
    regions,
    host: createClientHost({ timeline, items, bindings, stage, statusline }),
  };
}

describe("client operations", () => {
  test("appended items are validated, replaced whole, and removed with their generation", () => {
    const { timeline, host } = controllers();
    const client = host.prepare();
    expect(() => client.timeline.append({ kind: "note", value: { text: 1 } })).toThrow(TypeError);
    expect(() => client.timeline.append({ kind: "private", value: "x" })).toThrow(/not available/);
    expect(() => client.timeline.append({ kind: "missing", value: {} })).toThrow(/No harness type/);
    expect(timeline.items()).toHaveLength(0);
    const handle = client.timeline.append({ kind: "note", value: { text: "one" } });
    expect(() => handle.update({ text: 2 })).toThrow(TypeError);
    expect(timeline.find(handle.id)?.sourceText()).toBe("one");
    handle.update({ text: "two" });
    expect(timeline.find(handle.id)?.sourceText()).toBe("two");
    const other = client.timeline.append({ kind: "note", value: { text: "kept until retire" } });
    handle.dispose();
    handle.dispose();
    expect(timeline.find(handle.id)).toBeUndefined();
    host.retire();
    expect(timeline.find(other.id)).toBeUndefined();
    expect(() => other.update({ text: "late" })).toThrow(StaleClientError);
    expect(() => client.timeline.append({ kind: "note", value: { text: "late" } })).toThrow(
      StaleClientError,
    );
    other.dispose();
  });

  test("a new generation is a new client; an old binding's disposal cannot remove a newer one", () => {
    const { ui, host } = controllers();
    const first = host.prepare();
    expect(host.prepare()).toBe(first);
    const old = first.timeline.bindTool("t", "note");
    host.retire();
    const second = host.prepare();
    expect(second).not.toBe(first);
    expect(ui.controllers.bindings.tool("t")).toBeUndefined();
    second.timeline.bindTool("t", "note");
    old.dispose();
    expect(ui.controllers.bindings.tool("t")?.kind).toBe("note");
    expect(() => first.timeline.bindTool("t", "note")).toThrow(StaleClientError);
  });

  test("status line contributions are keyed per client and never touch the built-in fields", () => {
    const { statusline, host } = controllers();
    statusline.setFields({ model: "m" });
    const client = host.prepare();
    client.statusline.setText({ position: "bottom", key: "a", text: "first" });
    client.statusline.setText({ position: "bottom", key: "a", text: "replaced" });
    const count = client.statusline.setItem({ position: "top", key: "b", kind: "count", value: 1 });
    expect(() => count.update("x")).toThrow(TypeError);
    expect(statusline.contributions("top")).toEqual([{ text: "n=1" }]);
    expect(statusline.contributions("bottom")).toEqual([{ text: "replaced" }]);
    host.retire();
    expect(statusline.contributions("bottom")).toEqual([]);
    expect(statusline.contributions("top")).toEqual([]);
    expect(statuslineSegments(statusline, "bottom")[0]?.text).toBe("m");
  });

  test("a stage request names a compiled kind, takes focus, and is cancelled with its generation", async () => {
    const { stage, regions, host } = controllers();
    const client = host.prepare();
    expect(() => client.stage.show({ kind: "ask", value: {}, preferredHeight: 2 })).toThrow(
      TypeError,
    );
    const handle = client.stage.show({ kind: "ask", value: { question: "?" }, preferredHeight: 2 });
    expect(stage.active()?.requester).toBe("extension");
    expect(regions.current()).toBe("stage");
    expect(() => handle.update({ question: 3 })).toThrow(TypeError);
    expect(handle.value()).toEqual({ question: "?" });
    host.retire();
    expect((await handle.closed).status).toBe("cancelled");
  });
});

const directories: string[] = [];
afterEach(async () => {
  for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true });
});

test("extensions receive the client through pi, keep it across reload as a new generation, and drive the screen", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "harness-client-"));
  directories.push(cwd);
  const recorder = join(cwd, "recorder.js");
  await writeFile(
    recorder,
    `
    export default function (pi) {
      pi.on("session_start", (_event, ctx) => { (globalThis.__harnessClients ??= []).push(ctx.ui.harness); });
    }
  `,
  );
  const { customization } = createFauxSession({
    tokensPerSecond: 40,
    responses: [
      fauxAssistantMessage(
        [fauxToolCall("example_shell", { command: "ls -la" }, { id: "shell-1" })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("finished ".repeat(12)),
    ],
  });
  const host = await createSessionHost({
    cwd,
    agentDir: join(cwd, "agent"),
    settingsManager: SettingsManager.inMemory({
      extensions: [
        resolve(import.meta.dir, "../contributions/harness-client-example.ts"),
        recorder,
      ],
    }),
    sessionManager: SessionManager.inMemory(cwd),
    customization,
  });
  const clients = () =>
    (globalThis as { __harnessClients?: HarnessUIClient[] }).__harnessClients ?? [];
  const setup = await testRender(() => <Screen host={host} startupNotices={[]} />, {
    width: 100,
    height: 30,
  });
  const frames = async (count = 3) => {
    for (let frame = 0; frame < count; frame++) {
      await Bun.sleep(20);
      await setup.flush();
      await setup.renderOnce();
    }
  };
  try {
    await frames();
    expect(clients()).toHaveLength(1);
    const first = clients()[0]!;
    expect(first.version).toBe(1);
    verifyClientCopy(host.runtime.session, first);
    expect(() => verifyClientCopy(host.runtime.session, {})).toThrow(/ctx.ui.harness/);
    expect(setup.captureCharFrame()).toContain("example: idle");
    expect(setup.captureCharFrame()).toContain("faux/faux");

    let settled = false;
    const run = host.runtime.session
      .prompt("go")
      .then(() => host.runtime.session.waitForIdle())
      .then(() => {
        settled = true;
      });
    // The indicator shows while the run streams, without taking focus.
    let sawIndicator = false;
    for (let frame = 0; frame < 150 && !settled; frame++) {
      await frames(1);
      sawIndicator ||= setup.captureCharFrame().includes("Working…");
    }
    await run;
    await frames();
    expect(sawIndicator).toBe(true);
    const frame = setup.captureCharFrame();
    expect(frame).not.toContain("Working…");
    // The bound tool uses the compiled bash presentation.
    expect(frame).toContain("$ ls -la");
    expect(frame).toContain("would run: ls -la");

    await host.runtime.session.reload();
    await frames();
    expect(clients()).toHaveLength(2);
    const second = clients()[1]!;
    expect(second).not.toBe(first);
    verifyClientCopy(host.runtime.session, second);
    expect(() =>
      first.statusline.setText({ position: "bottom", key: "late", text: "late" }),
    ).toThrow(StaleClientError);
    // The old generation's segment is gone and the new one's is shown once.
    expect(setup.captureCharFrame().match(/example: idle/g)).toHaveLength(1);
  } finally {
    delete (globalThis as { __harnessClients?: unknown }).__harnessClients;
    await host.dispose();
    setup.renderer.destroy();
  }
}, 30_000);

test("a status line keeps the model and context first when narrow", () => {
  const ui = createHarnessUI<JSX.Element>();
  const { statusline } = ui.controllers;
  statusline.setFields({
    model: "provider/model",
    thinking: "thinking high",
    context: "ctx 12% of 200k",
    totals: "↑1k ↓2k $0.010",
  });
  statusline.contribute("bottom", { text: "extension status" });
  const segments = statuslineSegments(statusline, "bottom");
  const narrow = (width: number) => segmentsText(segments, width);
  expect(narrow(200)).toContain("extension status");
  expect(narrow(55)).toBe("provider/model · thinking high · ctx 12% of 200k");
  expect(narrow(10)).toBe("…der/model");
});

function segmentsText(segments: LineSegment[], width: number): string {
  return composeLine(segments, width)
    .map((segment) => segment.text)
    .join(" · ");
}
