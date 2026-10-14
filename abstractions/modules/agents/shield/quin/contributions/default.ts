/**
 * quin's built-in actions and their default chords. The ids are the names a
 * keymap uses; see `ui/keys.ts`. Detaching never stops Pi or answers a
 * dialog, and no Esc binding interrupts a run: only `global.interrupt` does.
 */
import type { Registration } from "../ui/controllers";
import type { ItemActions } from "../ui/item-actions";
import { FOCUS_ORDER, type QuinUIInstance } from "../ui/quin-ui";

/** Behaviour the screen supplies; the actions here only route keys to it. */
export interface QuinActions {
  /** Submit the editor's draft, or the prompt when no draft is open. */
  submit(): void;
  /** Detach from the agent without stopping it or answering its dialogs. */
  detach(): void;
  /** Idle, clear the input; during a run, arm and then interrupt. */
  interrupt(): void;
  openCommand(): void;
  /** Timeline cursor, disclosure, scrolling, and copying; see `ui/item-actions.ts`. */
  timeline: Pick<ItemActions, "move" | "scroll" | "toggle" | "expand" | "collapse" | "copy">;
}

export const INTERRUPT_ACTION = "global.interrupt";

export function setupDefaultActions(ui: QuinUIInstance<unknown>, actions: QuinActions): Registration {
  const { regions, stage, editor, commands } = ui.controllers;
  const cycle = (delta: number) => {
    const available = FOCUS_ORDER.filter((region) => regions.isAvailable(region));
    const index = available.indexOf(regions.current());
    const next = available[(index + delta + available.length) % available.length];
    if (next) regions.requestFocus(next);
  };
  const runStage = (name: string) => { void stage.active()?.runAction(name); };
  return ui.actions.register([
    { id: "global.detach", keys: ["ctrl+q"], run: actions.detach },
    { id: INTERRUPT_ACTION, keys: ["ctrl+c"], run: actions.interrupt },
    { id: "global.focus-next", keys: ["tab"], run: () => cycle(1) },
    { id: "global.focus-previous", keys: ["shift+tab"], run: () => cycle(-1) },
    // Unbound by default: direct focus moves, as the harness's Ctrl+E/O/K.
    { id: "global.focus-editor", run: () => regions.requestFocus("editor") },
    { id: "global.focus-timeline", run: () => regions.requestFocus("timeline") },
    { id: "global.focus-stage", run: () => regions.requestFocus("stage") },

    { id: "editor.submit", keys: ["return", "kpenter"], run: actions.submit },
    { id: "editor.open-command", keys: ["ctrl+g"], run: () => actions.openCommand() },
    // While the palette drafts a command's argument here, these pick among its candidates.
    { id: "editor.command-next", keys: ["ctrl+n"], run: () => commands.move(1, true), when: () => commands.ownsDraft() },
    { id: "editor.command-previous", keys: ["ctrl+p"], run: () => commands.move(-1, true), when: () => commands.ownsDraft() },
    { id: "editor.cancel-draft", keys: ["escape"], run: () => editor.cancelDraft() },

    { id: "timeline.open-command", keys: [":"], run: () => actions.openCommand() },
    { id: "timeline.cursor-down", keys: ["j", "down"], run: () => actions.timeline.move(1) },
    { id: "timeline.cursor-up", keys: ["k", "up"], run: () => actions.timeline.move(-1) },
    { id: "timeline.toggle-item", keys: ["return", "kpenter", "space"], run: () => actions.timeline.toggle() },
    { id: "timeline.expand-item", keys: ["l", "right"], run: () => actions.timeline.expand() },
    { id: "timeline.collapse-item", keys: ["h", "left"], run: () => actions.timeline.collapse() },
    { id: "timeline.copy-item", keys: ["y"], run: () => { void actions.timeline.copy(); } },
    { id: "timeline.scroll-page-down", keys: ["ctrl+f"], run: () => actions.timeline.scroll("page-down") },
    { id: "timeline.scroll-page-up", keys: ["ctrl+b"], run: () => actions.timeline.scroll("page-up") },
    { id: "timeline.scroll-half-down", keys: ["ctrl+d"], run: () => actions.timeline.scroll("half-down") },
    { id: "timeline.scroll-half-up", keys: ["ctrl+u"], run: () => actions.timeline.scroll("half-up") },
    { id: "timeline.focus-editor", keys: ["escape"], run: () => regions.requestFocus("editor") },

    // Typed characters reach a stage that takes text, such as the palette's name input.
    { id: "stage.open-command", keys: [":"], run: () => actions.openCommand() },
    { id: "stage.command-arguments", keys: ["space"], run: () => runStage("arguments") },
    { id: "stage.cursor-down", keys: ["j", "down", "ctrl+n"], run: () => runStage("next") },
    { id: "stage.cursor-up", keys: ["k", "up", "ctrl+p"], run: () => runStage("previous") },
    { id: "stage.confirm", keys: ["return", "kpenter"], run: () => runStage("confirm") },
    { id: "stage.cancel", keys: ["escape"], run: () => runStage("cancel") },
    { id: "stage.next-request", keys: ["ctrl+f"], run: () => stage.moveRequest(1) },
    { id: "stage.previous-request", keys: ["ctrl+b"], run: () => stage.moveRequest(-1) },
  ]);
}
