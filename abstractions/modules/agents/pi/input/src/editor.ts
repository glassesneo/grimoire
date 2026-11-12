import { CustomEditor, type KeybindingsManager, type Theme } from "@earendil-works/pi-coding-agent";
import {
  Editor,
  isKeyRepeat,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type AutocompleteProvider,
  type Component,
  type EditorTheme,
  type Focusable,
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
  /** Shows the palette above the conversation; `close` removes it. */
  showPalette: (open: (theme: Theme, close: () => void) => Component) => void;
}

/** Frames the palette editor as a titled box; its input and focus belong to the editor. */
class PaletteOverlay implements Component, Focusable {
  #focused = false;
  constructor(
    private readonly palette: Editor,
    private readonly theme: Theme,
    private readonly input: (data: string) => void,
    private readonly blurred: () => void,
  ) {}

  get focused(): boolean {
    return this.#focused;
  }

  set focused(value: boolean) {
    const lost = this.#focused && !value;
    this.#focused = value;
    this.palette.focused = value;
    // Another dialog took focus; an unseen palette must not keep capturing commands.
    if (lost) this.blurred();
  }

  handleInput(data: string): void {
    this.input(data);
  }

  render(width: number): string[] {
    const border = (text: string) => this.theme.fg("borderAccent", text);
    const inner = Math.max(1, width - 2);
    const title = ` ${this.theme.fg("accent", this.theme.bold("Command palette"))} `;
    const top = `${border("┌─")}${title}${border("─".repeat(Math.max(0, inner - 1 - visibleWidth(title))))}${border("┐")}`;
    // The editor's first row is its top rule, which the title row replaces.
    const body = this.palette
      .render(inner)
      .slice(1)
      .map((line) => {
        const cell = truncateToWidth(line, inner, "");
        return `${border("│")}${cell}${" ".repeat(Math.max(0, inner - visibleWidth(cell)))}${border("│")}`;
      });
    return [truncateToWidth(top, width, ""), ...body, border(`└${"─".repeat(inner)}┘`)];
  }

  invalidate(): void {
    this.palette.invalidate();
  }
}

/** A separate native editor owns palette input; the main buffer is never a command transport. */
export class InputEditor extends CustomEditor {
  #keys: InputKeys;
  #bindings: KeybindingsManager;
  #palette: Editor;
  #open = false;
  #close?: () => void;
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
    if (!this.#open) return;
    this.#open = false;
    this.#palette.focused = false;
    const close = this.#close;
    this.#close = undefined;
    close?.();
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
      this.#paletteInput(data);
      return;
    }
    if (this.#keys.palette.some((key) => matchesKey(data, key))) {
      this.#openPalette();
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

  #openPalette(): void {
    this.resetStop();
    this.#open = true;
    this.#palette.setText("/");
    this.#palette.handleInput("\t");
    this.#runtime?.showPalette((theme, close) => {
      this.#close = close;
      return new PaletteOverlay(
        this.#palette,
        theme,
        (data) => this.#paletteInput(data),
        () => this.closePalette(),
      );
    });
    this.tui.requestRender();
  }

  #paletteInput(data: string): void {
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
