import { readFileSync } from "node:fs";
import {
  createLocalBashOperations,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { InputEditor, type InputKeys } from "./editor.ts";

const keys = JSON.parse(readFileSync(new URL("./keys.json", import.meta.url), "utf8")) as InputKeys;

export default function registerInput(pi: ExtensionAPI): void {
  let editor: InputEditor | undefined;
  let context: ExtensionContext | undefined;
  // A `!` command runs outside the agent, so isIdle() does not cover it. Pi's own local
  // backend runs it here with an added signal that the confirmed stop can abort.
  let bash: AbortController | undefined;
  pi.on("user_bash", () => ({
    operations: {
      async exec(command, cwd, options) {
        const controller = new AbortController();
        bash = controller;
        try {
          return await createLocalBashOperations().exec(command, cwd, {
            ...options,
            signal: options.signal
              ? AbortSignal.any([options.signal, controller.signal])
              : controller.signal,
          });
        } finally {
          if (bash === controller) bash = undefined;
          editor?.resetStop();
        }
      },
    },
  }));
  pi.on("session_start", (event, ctx) => {
    context = ctx;
    if (ctx.mode !== "tui") return;
    ctx.ui.setEditorComponent((tui, theme, keybindings) => {
      editor ??= new InputEditor(tui, theme, keybindings, keys);
      editor.setRuntime({
        running: () => bash !== undefined || (context ? !context.isIdle() : false),
        abort: () => (bash ? bash.abort() : context?.abort()),
        notify: (message) => context?.ui.notify(message, "warning"),
      });
      return editor;
    });
    if (event.reason === "new" || event.reason === "resume" || event.reason === "fork")
      editor?.sessionReplaced();
  });
  pi.on("agent_start", (_event, ctx) => {
    context = ctx;
    editor?.resetStop();
  });
  // agent_end can precede retries and queued continuations; it is not an idle boundary.
  pi.on("agent_settled", (_event, ctx) => {
    context = ctx;
    editor?.resetStop();
  });
  pi.on("ui_prompt_start", () => editor?.closePalette());
  pi.on("ui_prompt_end", () => editor?.resetStop());
  pi.on("tool_call", (event) => {
    if (event.toolName === "question") editor?.closePalette();
  });
  pi.on("session_shutdown", () => editor?.closePalette());
  pi.on("session_tree", () => editor?.treeNavigated());
}
