/** quin's action ids and default chords. Detaching never stops Pi or answers a dialog. */
import type { Registration } from "../ui/controllers";
import type { ItemActions } from "../ui/item-actions";
import { KeyBindings, type Action, type Keymap } from "../ui/keys";
import { FOCUS_ORDER, regionText, type QuinUIInstance } from "../ui/quin-ui";

export interface QuinActions {
  submit: () => void;
  detach: () => void;
  interrupt: () => void;
  openCommand: () => void;
  timeline: Pick<ItemActions, "move" | "scroll" | "toggle" | "expand" | "collapse" | "copy">;
}
export const INTERRUPT_ACTION = "global.interrupt";

const defaults = {
  "global.detach": ["ctrl+q"],
  [INTERRUPT_ACTION]: ["ctrl+c"],
  "global.focus-next": ["tab"],
  "global.focus-previous": ["shift+tab"],
  "global.focus-editor": [],
  "global.focus-timeline": [],
  "global.focus-stage": [],
  "editor.submit": ["return", "kpenter"],
  "editor.open-command": ["ctrl+g"],
  "editor.command-next": ["ctrl+n"],
  "editor.command-previous": ["ctrl+p"],
  "editor.cancel-draft": ["escape"],
  "timeline.open-command": [":"],
  "timeline.cursor-down": ["j", "down"],
  "timeline.cursor-up": ["k", "up"],
  "timeline.toggle-item": ["return", "kpenter", "space"],
  "timeline.expand-item": ["l", "right"],
  "timeline.collapse-item": ["h", "left"],
  "timeline.copy-item": ["y"],
  "timeline.scroll-page-down": ["ctrl+f"],
  "timeline.scroll-page-up": ["ctrl+b"],
  "timeline.scroll-half-down": ["ctrl+d"],
  "timeline.scroll-half-up": ["ctrl+u"],
  "timeline.focus-editor": ["escape"],
  "stage.open-command": [":"],
  "stage.command-arguments": ["space"],
  "stage.cursor-down": ["j", "down", "ctrl+n"],
  "stage.cursor-up": ["k", "up", "ctrl+p"],
  "stage.confirm": ["return", "kpenter"],
  "stage.cancel": ["escape"],
  "stage.next-request": ["ctrl+f"],
  "stage.previous-request": ["ctrl+b"],
} satisfies Record<string, string[]>;
type ActionId = keyof typeof defaults;

function definitions(handlers?: Record<ActionId, Pick<Action, "run" | "when">>): Action[] {
  return (Object.keys(defaults) as ActionId[]).map((id) => ({
    id,
    keys: defaults[id],
    run: () => {},
    ...handlers?.[id],
    captureText: id === "stage.command-arguments",
  }));
}

/** The same validation at build time, before connecting, and when constructing the screen. */
export function checkKeymap(keymap: Keymap | undefined): void {
  const keys = new KeyBindings({ keymap, textRegions: regionText() });
  keys.register(definitions());
  keys.checkKeymap();
}

export function setupDefaultActions(
  ui: QuinUIInstance<unknown>,
  actions: QuinActions,
): Registration {
  const { regions, stage, editor, commands } = ui.controllers;
  const cycle = (delta: number) => {
    const available = FOCUS_ORDER.filter((region) => regions.isAvailable(region));
    const index = available.indexOf(regions.current());
    const next = available[(index + delta + available.length) % available.length];
    if (next) regions.requestFocus(next);
  };
  const runStage = (name: string) => {
    void stage.active()?.runAction(name);
  };
  return ui.actions.register(
    definitions({
      "global.detach": { run: actions.detach },
      [INTERRUPT_ACTION]: { run: actions.interrupt },
      "global.focus-next": { run: () => cycle(1) },
      "global.focus-previous": { run: () => cycle(-1) },
      "global.focus-editor": { run: () => regions.requestFocus("editor") },
      "global.focus-timeline": { run: () => regions.requestFocus("timeline") },
      "global.focus-stage": { run: () => regions.requestFocus("stage") },
      "editor.submit": { run: actions.submit },
      "editor.open-command": { run: actions.openCommand },
      "editor.command-next": {
        run: () => commands.move(1, true),
        when: () => commands.ownsDraft(),
      },
      "editor.command-previous": {
        run: () => commands.move(-1, true),
        when: () => commands.ownsDraft(),
      },
      "editor.cancel-draft": { run: () => editor.cancelDraft() },
      "timeline.open-command": { run: actions.openCommand },
      "timeline.cursor-down": { run: () => actions.timeline.move(1) },
      "timeline.cursor-up": { run: () => actions.timeline.move(-1) },
      "timeline.toggle-item": { run: () => actions.timeline.toggle() },
      "timeline.expand-item": { run: () => actions.timeline.expand() },
      "timeline.collapse-item": { run: () => actions.timeline.collapse() },
      "timeline.copy-item": {
        run: () => {
          void actions.timeline.copy();
        },
      },
      "timeline.scroll-page-down": { run: () => actions.timeline.scroll("page-down") },
      "timeline.scroll-page-up": { run: () => actions.timeline.scroll("page-up") },
      "timeline.scroll-half-down": { run: () => actions.timeline.scroll("half-down") },
      "timeline.scroll-half-up": { run: () => actions.timeline.scroll("half-up") },
      "timeline.focus-editor": { run: () => regions.requestFocus("editor") },
      "stage.open-command": { run: actions.openCommand },
      "stage.command-arguments": {
        run: () => runStage("arguments"),
        when: () =>
          ["name", "candidates"].includes(commands.value()?.mode ?? "") &&
          stage.active()?.id === commands.id(),
      },
      "stage.cursor-down": { run: () => runStage("next") },
      "stage.cursor-up": { run: () => runStage("previous") },
      "stage.confirm": { run: () => runStage("confirm") },
      "stage.cancel": { run: () => runStage("cancel") },
      "stage.next-request": { run: () => stage.moveRequest(1) },
      "stage.previous-request": { run: () => stage.moveRequest(-1) },
    }),
  );
}
