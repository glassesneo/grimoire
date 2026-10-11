import { expect, test } from "bun:test";
import { InputRenderable, PasteEvent, type Renderable } from "@opentui/core";
import { testRender, type JSX } from "@opentui/solid";
import { setupCommandUI } from "./commands";
import { StageView } from "./stage";
import { ScreenLayout } from "./screen";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { createSessionHost } from "../core/session";
import { createFauxSession } from "../core/faux";
import { setupDefaultUI } from "../contributions/default";
import { createHarnessUI } from "./harness-ui";
import type { CommandCandidate } from "./command-controller";

// These rules own native routing and drafts: neither SDK tests nor type checks
// can catch duplicate execution, label/value confusion, lost text or stale results.
function fixture() {
  const notices: string[] = [];
  const ui = createHarnessUI<string>({ notify: (text) => notices.push(text) });
  const { commands, editor, stage, regions } = ui.controllers;
  commands.setType({ kind: "command", defaultValue: { query: "", queryCursor: 0, cursor: 0, mode: "name", candidates: [], filtered: [] },
    acceptsText: (value) => value.mode === "name", render: () => "" });
  const registrations = setupDefaultUI(ui, {
    quit: () => {}, submit: () => { editor.submitDraft(); }, cancel: () => { editor.cancelDraft(); },
    focusFromEditor: (target) => editor.requestFocus(target), moveTimelineCursor: () => {}, scrollTimeline: () => {},
    toggleTimelineItem: () => {}, expandTimelineItem: () => {}, collapseTimelineItem: () => {}, copyTimelineItem: () => {},
    moveStageCursor: (delta) => commands.move(delta), confirmStage: () => { void commands.confirm(); }, cancelStage: () => commands.cancel(),
    openCommand: () => commands.open(), moveStageRequest: (delta) => stage.moveRequest(delta), stageAcceptsText: () => commands.acceptsText(),
    commandArguments: () => { void commands.arguments(); }, commandOwnsDraft: () => commands.ownsDraft(), moveCommandDraftCursor: (delta) => commands.move(delta, true),
  });
  return { ui, commands, editor, stage, regions, notices, dispose: () => { commands.dispose(); registrations.forEach((item) => item.dispose()); } };
}
const tick = () => Bun.sleep(0);

// Native Input sanitation and callbacks can defeat otherwise-correct controller
// validation; observe typed query and rejection, not paint or viewport dimensions.
test("native command input round-trips typing and rejects raw multiline paste", async () => {
  const f = fixture();
  const ui = f.ui as unknown as ReturnType<typeof createHarnessUI<JSX.Element>>;
  const commandUI = setupCommandUI(ui);
  const setup = await testRender(() => <ScreenLayout ui={ui} timeline={<text>timeline</text>} stage={() => <StageView ui={ui} />} />, { width: 80, height: 24 });
  try {
    f.ui.commands.register({ name: "new", description: "", acceptsArguments: false, execute: () => {} });
    f.commands.open(); await setup.flush(); await setup.mockInput.typeText("ne"); await setup.flush();
    expect(f.commands.value()?.query).toBe("ne");
    const findInput = (node: Renderable): InputRenderable | undefined => {
      if (node instanceof InputRenderable) return node;
      for (const child of node.getChildren()) { const input = findInput(child); if (input) return input; }
    };
    const input = findInput(setup.renderer.root)!;
    const paste = new PasteEvent(new TextEncoder().encode("ne\nw")); input.onPaste?.call(input, paste);
    expect(paste.defaultPrevented).toBe(true); expect(f.commands.value()?.query).toBe("ne"); expect(f.notices.length).toBeGreaterThan(0);
    input.cursorOffset = 1; await setup.flush(); expect(f.commands.value()?.queryCursor).toBe(1);
  } finally { commandUI.dispose(); f.dispose(); setup.renderer.destroy(); }
});

test("all launch bindings reuse one command, name input falls through, unknown names remain and execution runs once", async () => {
  const f = fixture(); const values: Array<string | undefined> = [];
  let finish!: () => void;
  f.ui.commands.register({ name: "job", description: "synthetic", acceptsArguments: false, execute: (value) => { values.push(value); return new Promise<void>((resolve) => { finish = resolve; }); } });
  expect(() => f.ui.commands.register({ name: "two names", description: "", acceptsArguments: false, execute: () => {} })).toThrow();
  expect(() => f.ui.commands.register({ name: "job", description: "", acceptsArguments: false, execute: () => {} })).toThrow();
  f.regions.resolve({ name: "g", ctrl: true })!(); const id = f.commands.id();
  for (const region of ["timeline", "stage"]) { f.regions.requestFocus(region); f.regions.resolve({ name: ":" })?.(); expect(f.commands.id()).toBe(id); }
  expect(f.regions.resolve({ name: "j" })).toBeUndefined(); expect(f.regions.resolve({ name: ":" })).toBeUndefined();
  f.commands.setQuery("missing"); await f.commands.confirm(); expect(f.commands.id()).toBe(id); expect(f.notices.length).toBeGreaterThan(0);
  f.commands.setQuery("bad argument"); expect(f.commands.value()?.query).toBe("missing");
  f.commands.setQuery("OB", 1); expect(f.commands.value()?.queryCursor).toBe(1);
  const running = f.commands.confirm(); await f.commands.confirm(); expect(values).toEqual([undefined]);
  f.commands.cancel(); expect(f.commands.id()).toBeUndefined();
  f.commands.open(); const next = f.commands.id(); finish(); await running;
  expect(f.commands.id()).toBe(next); f.dispose();
});

test("candidate drafts preserve prompt and validation failures, deliver values and reopen fresh after cancellation", async () => {
  const f = fixture(); const values: Array<string | undefined> = [];
  f.ui.commands.register({ name: "pick", description: "", acceptsArguments: true,
    candidates: () => [{ value: "provider/id/one", label: "First" }, { value: "provider/id/two", label: "Second" }], execute: (value) => { values.push(value); } });
  f.editor.setText("prompt kept"); f.commands.open(); const id = f.commands.id();
  await f.commands.arguments(); expect(f.editor.text()).toBe("");
  f.editor.setText("no match", 2); expect(f.editor.submitDraft()).toBe(false);
  expect(f.editor.snapshot().cursor).toBe(2); expect(f.editor.text()).toBe("no match"); expect(f.editor.activeDraft()).toBe(true);
  f.editor.setText("provider/id"); f.regions.resolve({ name: "n", ctrl: true })!();
  expect(f.commands.value()?.cursor).toBe(1);
  f.editor.submitDraft(); await tick(); expect(values).toEqual(["provider/id/two"]); expect(f.editor.text()).toBe("prompt kept");
  expect(f.commands.id()).toBeUndefined(); expect(f.regions.current()).toBe("editor");
  f.commands.open(); await f.commands.arguments(); f.editor.setText("First"); f.editor.cancelDraft(); await tick();
  expect(f.stage.active()?.id).toBe(f.commands.id()); expect(f.commands.id()).not.toBe(id); expect(f.commands.value()?.mode).toBe("name");
  await f.commands.arguments(); expect(f.editor.text()).toBe(""); f.commands.cancel();
  // Esc on stage requires explicitly leaving the editor.
  f.regions.requestFocus("stage"); f.commands.cancel(); await tick(); expect(f.editor.activeDraft()).toBe(false);
  expect(f.editor.text()).toBe("prompt kept"); f.dispose();
});

test("argument draft FIFO does not overwrite another active draft and free arguments remain raw", async () => {
  const f = fixture(); let argument: string | undefined;
  f.ui.commands.register({ name: "free", description: "", acceptsArguments: true, execute: (text) => { argument = text; } });
  const other = f.editor.openDraft({ destination: "other", label: "other", requester: "editor", initialText: "other text" });
  f.commands.open(); await f.commands.arguments(); expect(f.editor.text()).toBe("other text");
  f.editor.submitDraft(); await other; await tick(); expect(f.editor.text()).toBe("");
  const raw = "  /not-a-command\n{{template}}  "; f.editor.setText(raw); f.editor.submitDraft(); await tick();
  expect(argument).toBe(raw); f.dispose();
});

test("late candidate results cannot revive cancellation or generation failure; executing commands survive generation changes", async () => {
  const f = fixture(); let resolve!: (candidates: readonly CommandCandidate[]) => void; let executions = 0;
  f.ui.commands.register({ name: "pick", description: "", acceptsArguments: true,
    candidates: () => new Promise((done) => { resolve = done; }), execute: () => { executions++; } });
  f.commands.open(); const pending = f.commands.confirm(); f.commands.cancel(); resolve([{ value: "old", label: "old" }]); await pending;
  expect(f.commands.id()).toBeUndefined();
  f.commands.open(); const loading = f.commands.arguments(); f.commands.resetGeneration(); resolve([{ value: "stale", label: "stale" }]); await loading;
  expect(f.commands.id()).toBeUndefined(); expect(f.editor.activeDraft()).toBe(false); expect(executions).toBe(0);
  f.ui.commands.register({ name: "new", description: "", acceptsArguments: false, execute: () => { f.commands.resetGeneration(); executions++; } });
  f.commands.open(); f.commands.setQuery("new"); await f.commands.confirm(); expect(executions).toBe(1); expect(f.commands.id()).toBeUndefined(); f.dispose();
});

// Host owns the reload refusal shared with extension command actions; SDK reload
// is stubbed only to observe that no unsafe call crossed that boundary.
test("host and extension reload share streaming/compacting refusal and invoke idle reload once", async () => {
  const directory = await mkdtemp(join(tmpdir(), "harness-reload-rule-"));
  const faux = createFauxSession({ responses: [] });
  const host = await createSessionHost({ cwd: directory, agentDir: join(directory, "agent"), settingsManager: SettingsManager.inMemory(), sessionManager: SessionManager.inMemory(directory), customization: faux.customization });
  try {
    const session = host.runtime.session;
    let calls = 0; let extensionReload: (() => Promise<void>) | undefined;
    const originalBind = session.bindExtensions.bind(session);
    session.bindExtensions = async (options) => { extensionReload = options?.commandContextActions?.reload; await originalBind(options); };
    const f = fixture();
    const { createExtensionUI } = await import("./extension-ui");
    const type = { kind: "choice", defaultValue: { title: "", choices: [], cursor: 0 }, render: () => undefined };
    const extension = createExtensionUI({ ui: f.ui as never, choiceType: type, confirmType: type, notify: () => {} });
    await host.bind({ uiContext: extension.context, onEvent: () => {}, onExtensionError: () => {}, onShutdownRequest: () => {}, onHistoryReplaced: () => {} });
    session.reload = async () => { calls++; };
    for (const [streaming, compacting] of [[true, false], [false, true], [false, false]]) {
      Object.defineProperty(session, "isStreaming", { configurable: true, get: () => streaming });
      Object.defineProperty(session, "isCompacting", { configurable: true, get: () => compacting });
      if (streaming || compacting) { await expect(host.reload()).rejects.toThrow(); await expect(extensionReload!()).rejects.toThrow(); expect(calls).toBe(0); }
      else { await host.reload(); expect(calls).toBe(1); }
    }
    extension.dispose(); f.dispose();
  } finally { await host.dispose(); await rm(directory, { recursive: true, force: true }); }
});
