import { CustomEditor, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import {
  Editor,
  isKeyRepeat,
  matchesKey,
  type AutocompleteProvider,
  type EditorTheme,
  type KeyId,
  type TUI,
} from "@earendil-works/pi-tui";
import { idleStop, reduceStop, settleMs, stopWindowMs, type StopState } from "./policy.ts";

export interface InputKeys {
  palette: readonly KeyId[];
  stop: readonly KeyId[];
}

interface Runtime {
  running: () => boolean;
  abort: () => void;
  notify: (message: string) => void;
}

/** A separate native editor owns palette input; the main buffer is never a command transport. */
export class InputEditor extends CustomEditor {
  #keys: InputKeys;
  #bindings: KeybindingsManager;
  #palette: Editor;
  #open = false;
  #command?: string;
  #stop: StopState = idleStop;
  #settle?: ReturnType<typeof setTimeout>;
  #runtime?: Runtime;

  constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager, keys: InputKeys) {
    super(tui, theme, keybindings);
    this.#keys = keys;
    this.#bindings = keybindings;
    this.#palette = new Editor(tui, theme);
    this.#palette.onSubmit = (text) => {
      void this.#dispatch(text);
    };
    // Editor declares focused as an own field. Observe actual focus transfers, not renders.
    let focused = this.focused;
    Object.defineProperty(this, "focused", {
      configurable: true,
      get: () => focused,
      set: (value: boolean) => {
        if (focused !== value) this.resetStop();
        focused = value;
        this.#palette.focused = value && this.#open;
        if (!value) this.closePalette();
      },
    });
  }

  setRuntime(runtime: Runtime): void {
    this.#runtime = runtime;
  }

  override setAutocompleteProvider(provider: AutocompleteProvider): void {
    super.setAutocompleteProvider(provider);
    this.#palette.setAutocompleteProvider(provider);
  }

  closePalette(): void {
    this.#open = false;
    this.#palette.focused = false;
    this.resetStop();
    this.tui.requestRender();
  }

  resetStop(): void {
    clearTimeout(this.#settle);
    this.#stop = idleStop;
  }

  /** Only completed operations may discard the draft. Before-events can still be cancelled. */
  sessionReplaced(): void {
    this.#command = undefined;
    super.setText("");
    this.closePalette();
  }

  treeNavigated(): void {
    if (this.#command === "tree") {
      this.#command = undefined;
      super.setText("");
    }
    this.resetStop();
  }

  override setText(text: string): void {
    // Native command dispatch clears its transport buffer. That is not our draft.
    if (this.#command !== undefined) return;
    super.setText(text);
  }

  override handleInput(data: string): void {
    // Returning from a cancelled native selector leaves the original buffer intact.
    if (!this.#open) this.#command = undefined;
    if (this.#open) {
      if (this.#bindings.matches(data, "tui.select.cancel")) this.closePalette();
      else {
        // Unlike ordinary editing, palette Enter also dispatches argument completions.
        if (
          this.#bindings.matches(data, "tui.select.confirm") &&
          this.#palette.isShowingAutocomplete()
        ) {
          this.#palette.handleInput("\t");
        }
        this.#palette.handleInput(data);
      }
      this.tui.requestRender();
      return;
    }
    if (this.#keys.palette.some((key) => matchesKey(data, key))) {
      this.resetStop();
      this.#open = true;
      this.#palette.focused = this.focused;
      this.#palette.setText("/");
      this.#palette.handleInput("\t");
      this.tui.requestRender();
      return;
    }
    const stopKey = this.#keys.stop.find((key) => matchesKey(data, key));
    if (stopKey) {
      // Cancelling native completion is not the first half of an agent stop.
      if (this.isShowingAutocomplete() && this.#bindings.matches(data, "tui.select.cancel")) {
        this.resetStop();
        super.handleInput(data);
        return;
      }
      const decision = reduceStop(this.#stop, {
        type: "key",
        key: stopKey,
        now: Date.now(),
        running: this.#runtime?.running() ?? false,
        repeat: isKeyRepeat(data),
        repeatKnown: this.tui.terminal.kittyProtocolActive,
      });
      this.#applyStop(decision);
      return;
    }
    super.handleInput(data);
  }

  #applyStop(decision: ReturnType<typeof reduceStop>): void {
    clearTimeout(this.#settle);
    this.#stop = decision.state;
    if (decision.effect === "clear-input") super.setText("");
    if (decision.effect === "stop") this.#runtime?.abort();
    if (decision.effect === "armed")
      this.#runtime?.notify(
        `Press ${decision.state.key} again within ${stopWindowMs / 1000} seconds to stop.`,
      );
    // Without repeat reports, a second press stops once no auto-repeat follows it.
    if (decision.effect === "pending")
      this.#settle = setTimeout(
        () => this.#applyStop(reduceStop(this.#stop, { type: "settle", now: Date.now() })),
        settleMs,
      );
  }

  override render(width: number): string[] {
    if (!this.#open) return super.render(width);
    return this.#palette.render(width);
  }

  override get capturesViewportInput(): boolean {
    return this.#open ? this.#palette.capturesViewportInput : super.capturesViewportInput;
  }

  async #dispatch(text: string): Promise<void> {
    this.closePalette();
    const command = text.trim().split(/\s+/)[0]?.slice(1) ?? "";
    this.#command = command;
    try {
      // Pi assigns this callback as an own data field. Do not shadow it with an accessor.
      // Its type returns void, but Pi's command dispatch is async; wait for it to settle.
      const submitted: unknown = this.onSubmit?.(text);
      await submitted;
    } catch (error) {
      this.#runtime?.notify(
        `Command failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      // Native selectors return before the selection completes. Keep their draft guard
      // until success is observed or input returns to this editor after cancellation.
      if (!["resume", "tree", "fork"].includes(command)) this.#command = undefined;
      this.tui.requestRender();
    }
  }
}
