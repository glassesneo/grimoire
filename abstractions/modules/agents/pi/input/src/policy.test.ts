import assert from "node:assert/strict";
import {
  CustomEditor,
  InteractiveMode,
  type ExtensionAPI,
  type KeybindingsManager as AppKeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import {
  CombinedAutocompleteProvider,
  KeybindingsManager,
  TUI_KEYBINDINGS,
  setKeybindings,
  type EditorTheme,
  type TUI,
} from "@earendil-works/pi-tui";
import { InputEditor } from "./editor.ts";
import registerInput from "./index.ts";
import { idleStop, reduceStop, settleMs, type StopState } from "./policy.ts";

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 20));
const theme = {
  borderColor: (s: string) => s,
  selectList: {
    selectedPrefix: (s: string) => s,
    selectedText: (s: string) => s,
    description: (s: string) => s,
    scrollInfo: (s: string) => s,
    noMatch: (s: string) => s,
  },
} as EditorTheme;
// The fixture supplies only the inherited key-matching API used by the editor, not file reloads.
const bindings = new KeybindingsManager(TUI_KEYBINDINGS, {
  "tui.editor.deleteToLineEnd": [],
  "app.model.cycleForward": [],
  "tui.select.up": ["up", "ctrl+p"],
  "tui.select.down": ["down", "ctrl+n"],
  "tui.editor.cursorUp": ["up", "ctrl+p"],
  "tui.editor.cursorDown": ["down", "ctrl+n"],
}) as unknown as AppKeybindingsManager;

/** Runs in Pi's loader so the check uses exactly the SDK shipped by the selected package. */
export default async function contracts(): Promise<void> {
  setKeybindings(bindings);
  const tui = {
    terminal: { kittyProtocolActive: true, columns: 80, rows: 24 },
    requestRender() {},
  } as unknown as TUI;
  const handlers = new Map<string, (event: any, ctx: any) => void>();
  let editor: InputEditor;
  let idle = true;
  let aborted = 0;
  const ctx = {
    mode: "tui",
    isIdle: () => idle,
    abort: () => {
      aborted++;
    },
    ui: {
      notify() {},
      setEditorComponent(factory: any) {
        editor = factory(tui, theme, bindings);
      },
    },
  };
  registerInput({
    on: (name: string, handler: any) => {
      handlers.set(name, handler);
    },
  } as unknown as ExtensionAPI);
  const emit = (name: string, event = {}) => handlers.get(name)?.(event, ctx);
  emit("session_start", { reason: "startup" });
  editor!.focused = true;
  const e = editor!;
  const submitted: string[] = [];
  // Exercise Pi's actual interactive command router with inert command implementations.
  const native = {
    defaultEditor: new CustomEditor(tui, theme, bindings),
    editor: e,
    showSettingsSelector() {
      e.focused = false;
    },
    async handleCopyCommand() {
      submitted.push("copy");
    },
    async handleClearCommand() {},
    showSessionSelector() {
      e.focused = false;
    },
    showTreeSelector() {
      e.focused = false;
    },
    showUserMessageSelector() {
      e.focused = false;
    },
    async handleCloneCommand() {},
    async handleImportCommand(text: string) {
      submitted.push(text);
    },
  };
  (
    InteractiveMode.prototype as unknown as { setupEditorSubmitHandler(this: unknown): void }
  ).setupEditorSubmitHandler.call(native);
  e.onSubmit = native.defaultEditor.onSubmit;
  e.setAutocompleteProvider(
    new CombinedAutocompleteProvider(
      [
        { name: "copy", description: "copy text" },
        { name: "settings" },
        { name: "new" },
        { name: "resume" },
        { name: "tree" },
        { name: "fork" },
        { name: "clone" },
        {
          name: "import",
          getArgumentCompletions: (prefix: string) =>
            prefix === "exam" ? [{ value: "example.jsonl", label: "example.jsonl" }] : null,
        },
        { name: "skill:demo" },
      ],
      "/tmp",
    ),
  );
  const palette = async (query: string, dispatch = true) => {
    e.handleInput("\x0b");
    await tick();
    for (const char of query) e.handleInput(char);
    await tick();
    if (dispatch) {
      e.handleInput("\r");
      await tick();
    }
  };
  const draft = "日本語 draft";
  e.setText(draft);
  e.handleInput("\x1b[D");
  const cursor = e.getCursor();
  await palette("copx", false);
  e.handleInput("\x7f");
  await tick();
  e.handleInput("\r");
  await tick();
  assert.deepEqual(submitted, ["copy"]);
  assert.equal(e.getText(), draft);
  assert.deepEqual(e.getCursor(), cursor);

  // Completion followed by literal arguments still dispatches through the native router.
  await palette("imp", false);
  e.handleInput("\t");
  await tick();
  e.handleInput("\x1b[200~example.jsonl\x1b[201~");
  await tick();
  e.handleInput("\r");
  await tick();
  assert.equal(submitted.at(-1), "/import example.jsonl");
  assert.equal(e.getText(), draft);
  assert.deepEqual(e.getCursor(), cursor);
  await palette("import exam");
  assert.equal(submitted.at(-1), "/import example.jsonl");
  assert.equal(e.getText(), draft);

  // With no candidates, the palette retains native multiline cursor movement and submission.
  const nativeSubmit = e.onSubmit;
  let literal = "";
  e.onSubmit = (text) => {
    literal = text;
  };
  await palette("no-such-command", false);
  e.handleInput("\x1b[200~ first\nsecond\x1b[201~");
  await tick();
  e.handleInput("\x10");
  e.handleInput("\x05");
  e.handleInput("!");
  await tick();
  e.handleInput("\r");
  await tick();
  assert.equal(literal, "/no-such-command first!\nsecond");
  e.onSubmit = nativeSubmit;
  assert.equal(e.getText(), draft);

  // Palette editing/cancellation cannot destroy main-editor paste expansion or undo.
  e.handleInput("\x1b[200~" + "long paste ".repeat(100) + "\x1b[201~");
  const expanded = e.getExpandedText();
  const pasteCursor = e.getCursor();
  await palette("copy");
  assert.equal(e.getExpandedText(), expanded);
  assert.deepEqual(e.getCursor(), pasteCursor);
  await palette("no-such-command", false);
  e.handleInput("\x03");
  assert.equal(e.getExpandedText(), expanded);
  assert.deepEqual(e.getCursor(), pasteCursor);
  e.handleInput("\x1f");
  assert.equal(e.getText(), draft);

  // Completed replacements clear; cancelled selectors and rejected operations keep the draft.
  for (const command of ["new", "clone", "import missing.jsonl", "resume", "fork", "tree"]) {
    e.setText(draft);
    await palette(command);
    emit("session_before_switch", { reason: "resume" });
    e.focused = true;
    e.handleInput("\x1b[D");
    assert.equal(e.getText(), draft, command);
  }
  await palette("tree");
  emit("session_tree");
  e.setText("historical user prompt");
  e.focused = true;
  assert.equal(e.getText(), "historical user prompt");
  for (const reason of ["new", "resume", "fork"]) {
    e.setText(draft);
    emit("session_shutdown", { reason });
    assert.equal(e.getText(), draft, "shutdown alone does not confirm replacement success");
    emit("session_start", { reason });
    assert.equal(e.getText(), "");
  }
  e.setText("selected fork prompt");
  assert.equal(e.getText(), "selected fork prompt");

  // Waiting UI takes focus without leaving an invisible palette or armed stop behind.
  idle = false;
  await palette("cop", false);
  emit("tool_call", { toolName: "question" });
  e.focused = false;
  emit("ui_prompt_start");
  e.focused = true;
  emit("ui_prompt_end");
  e.handleInput("\x1b");
  assert.equal(aborted, 0);
  emit("agent_end");
  e.handleInput("\x1b");
  assert.equal(aborted, 1, "agent_end is not idle while continuation is pending");
  e.handleInput("\x1b");
  e.focused = false;
  e.focused = true;
  e.handleInput("\x1b");
  assert.equal(aborted, 1, "selector focus changes reset stop confirmation");
  e.resetStop();
  e.setText("/");
  e.handleInput("\t");
  await tick();
  e.handleInput("\x1b");
  e.handleInput("\x1b");
  assert.equal(aborted, 1, "native completion cancellation cannot arm stop");
  idle = true;
  emit("agent_settled");
  e.handleInput("\x03");
  assert.equal(e.getText(), "");

  // Time and protocol are owned policy; no terminal clock or keyboard is needed here.
  const initial: StopState = idleStop;
  const press = (state: StopState, key: string, now: number, extra = {}) =>
    reduceStop(state, {
      type: "key",
      running: true,
      repeatKnown: true,
      key,
      now,
      ...extra,
    });
  const settle = (state: StopState, now: number) => reduceStop(state, { type: "settle", now });
  // Plays key events at the given times, then settles after the last one.
  const play = (key: string, times: number[]) => {
    let state = initial;
    let stopped = false;
    for (const now of times) {
      const next = press(state, key, now, { repeatKnown: false });
      stopped ||= next.effect === "stop";
      state = next.state;
    }
    return stopped || settle(state, times.at(-1)! + settleMs).effect === "stop";
  };
  for (const key of ["escape", "ctrl+c"]) {
    const first = press(initial, key, 100);
    assert.equal(press(first.state, key, 1600).effect, "stop");
    assert.notEqual(press(first.state, key, 1601).effect, "stop");
    assert.notEqual(press(first.state, key === "escape" ? "ctrl+c" : "escape", 110).effect, "stop");
    assert.equal(press(first.state, key, 110, { repeat: true }).effect, "none");
    // Without repeat reports, a double press stops once quiet follows it.
    assert.ok(play(key, [100, 400]), "a double press stops");
    assert.ok(!play(key, [100, 1700]), "a press after the window starts over");
    // A held key: macOS initial delay, then auto-repeat; it never stops, even after release.
    const held = [100, 280, 295, 310, 325, 340];
    assert.ok(!play(key, held), "a held key does not stop");
    assert.ok(play(key, [...held, 900, 1100]), "a fresh double press after release stops");
  }

  // A `!` command is stopped by the same confirmation, without an agent run.
  idle = true;
  const user = handlers.get("user_bash")!({ command: "sleep 30", cwd: process.cwd() }, ctx) as any;
  const started = Date.now();
  const run = user.operations.exec("sleep 30", process.cwd(), { onData() {} });
  await tick();
  e.handleInput("\x1b");
  e.handleInput("\x1b");
  const outcome = await run.then(
    (result: unknown) => result,
    (error: unknown) => error,
  );
  assert.ok(Date.now() - started < 10_000, `the ! command was stopped: ${String(outcome)}`);
  assert.equal(aborted, 1, "stopping a ! command does not abort the agent");
  console.log("pi-input behavior contracts passed");
}
