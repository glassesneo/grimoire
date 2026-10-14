/**
 * Builds quin's UI controllers around one agent connection and renders them.
 * Setup runs outside rendering, so a keymap error fails startup with its
 * message instead of a broken screen.
 */
import { type CliRenderer, engine } from "@opentui/core";
import { type JSX, useRenderer } from "@opentui/solid";
import { createSignal, onCleanup, onMount, type Signal } from "solid-js";
import { setupCommands } from "./contributions/commands";
import { INTERRUPT_ACTION, setupDefaultActions, type QuinActions } from "./contributions/default";
import type { Controller } from "./controller";
import { bridgeDialogs } from "./dialogs";
import { queuedPrompts, registerTimelineTypes } from "./timeline";
import { createItemActions, type ClipboardWriter, type TimelineScrollBox } from "./ui/item-actions";
import type { StatuslineContribution } from "./ui/statusline";
import { formatChord, type Keymap } from "./ui/keys";
import { ScreenLayout } from "./ui/layout";
import { createQuinUI, type QuinUIInstance } from "./ui/quin-ui";
import { setupCommandUI } from "./ui/commands";
import { setupStageUI, StageView } from "./ui/stage";
import { useVersion } from "./ui/state";
import { TimelineView } from "./ui/timeline";
import { formatContext, formatUsage } from "./usage";

export interface QuinScreen {
  ui: QuinUIInstance<JSX.Element>;
  controller: Controller;
  actions: QuinActions;
  /** Set by the view once its scrollbox exists. */
  setScroll(scroll: TimelineScrollBox | undefined): void;
  /** Applies following and anchoring to the laid-out timeline; the view calls it every frame. */
  frame(): void;
  /** Rows the overlays cover over the timeline's bottom and top edges, as the layout reports them. */
  overlay: Signal<number>;
  topInset: Signal<number>;
  /** Blank rows after the history that keep an anchored item in place. */
  slack(): number;
  /** Set by the view once the native editor exists. */
  setEditorReader(read: () => { text: string; cursor: number }): void;
  queued(): { steering: string[]; followUp: string[] };
  dispose(): void;
}

export function setupScreen(controller: Controller, options: { keymap?: Keymap; renderer?: CliRenderer; clipboard?: ClipboardWriter; cwd?: string } = {}): QuinScreen {
  const c = controller;
  // An accepted prompt follows the latest output again, as in the harness.
  const ui = createQuinUI<JSX.Element>({ sendPrompt: async text => { const accepted = await c.sendPrompt(text); if (accepted) itemActions.follow(); return accepted; }, keymap: options.keymap, notify: text => c.fail(text) });
  const { timeline, editor, statusline, runState, keys, regions } = ui.controllers;
  let scroll: TimelineScrollBox | undefined;
  let readEditor: (() => { text: string; cursor: number }) | undefined;
  const overlay = createSignal(0);
  const topInset = createSignal(0);
  const [slack, setSlack] = createSignal(0);
  const itemActions = createItemActions({
    timeline, scrollbox: () => scroll, overlayHeight: overlay[0], topInset: topInset[0],
    renderer: options.renderer, clipboard: options.clipboard, onSlackChange: setSlack,
    notify: (_level, text) => c.fail(text),
  });

  const actions: QuinActions = {
    submit: () => {
      // Content-change callbacks may lag a batch of terminal input containing Enter.
      const latest = readEditor?.();
      if (latest) editor.setText(latest.text, latest.cursor);
      if (editor.activeDraft()) editor.submitDraft();
      else void editor.submitPrompt();
    },
    detach: () => c.detach(),
    interrupt: () => { if (c.interrupt() === "idle") editor.setText(""); },
    timeline: itemActions,
    openCommand: () => ui.controllers.commands.open(),
  };

  const stageUI = setupStageUI(ui);
  const commandUI = setupCommandUI(ui);
  const { registrations: typeRegistrations, projector } = registerTimelineTypes(timeline);
  const registrations = [...typeRegistrations, ...setupCommands(ui, c), setupDefaultActions(ui, actions)];
  try {
    keys.checkKeymap();
  } catch (error) {
    for (const registration of registrations) registration.dispose();
    commandUI.dispose();
    stageUI.dispose();
    throw error;
  }
  const stopDialogs = bridgeDialogs({ controller: c, ui, ...stageUI });
  c.onEditorText = text => editor.setText(text);

  // Entering the timeline puts an off-screen cursor on the latest item.
  let lastRegion = regions.current();
  const unsubscribeRegions = regions.subscribe(() => {
    const region = regions.current();
    if (region === "timeline" && lastRegion !== "timeline") itemActions.reveal();
    lastRegion = region;
  });
  const statuses = new Map<string, StatuslineContribution>();
  const notice = statusline.contribute("top", { text: "" });
  const chord = (id: string) => { const first = keys.chords(id)[0]; return first ? formatChord(first) : undefined; };
  const hint = statusline.contribute("bottom", { text: "" });
  let shown: unknown;
  const refresh = () => {
    const view = c.adapter.view;
    // Records that leave the timeline as it was, such as a notice or the interrupt key, keep its items.
    const items = projector.project(view.timeline.entries);
    if (items !== shown) timeline.replace(shown = items);
    statusline.setFields({
      session: `${c.adapter.mode === "mock" ? "MOCK " : ""}${c.adapter.agent ?? ""}`,
      cwd: options.cwd ?? process.cwd(),
      model: view.timeline.model ?? "",
      thinking: view.timeline.thinking ? `thinking ${view.timeline.thinking}` : "",
      context: formatContext(c.stats?.contextUsage),
      totals: c.stats ? formatUsage(c.stats) : "",
    });
    notice.update({ text: c.status });
    for (const [key, contribution] of statuses) if (!(key in view.presentation.status)) { contribution.dispose(); statuses.delete(key); }
    for (const [key, text] of Object.entries(view.presentation.status)) {
      const existing = statuses.get(key);
      if (existing) existing.update({ text });
      else statuses.set(key, statusline.contribute("bottom", { text }));
    }
    hint.update({ text: [chord("global.focus-next") && `${chord("global.focus-next")} focus`, chord("global.detach") && `${chord("global.detach")} detach`].filter(Boolean).join(" · ") });
    runState.setActive(c.active);
    const interrupt = chord(INTERRUPT_ACTION);
    runState.setMessage(c.armedUntil && interrupt ? `Press ${interrupt} again within 1s to interrupt` : undefined);
  };
  refresh();
  const unsubscribe = c.subscribe(refresh);
  const timer = setInterval(() => c.tick(), 100);

  return {
    ui,
    controller: c,
    actions,
    setScroll: element => { scroll = element; },
    frame: () => itemActions.frame(),
    overlay,
    topInset,
    slack,
    setEditorReader: read => { readEditor = read; },
    queued: () => queuedPrompts(c.adapter.view.queue),
    dispose: () => {
      clearInterval(timer);
      unsubscribe();
      unsubscribeRegions();
      stopDialogs();
      for (const registration of registrations) registration.dispose();
      commandUI.dispose();
    stageUI.dispose();
      void itemActions.dispose();
    },
  };
}

export function Screen(props: { screen: QuinScreen; onTitle?(title: string): void }): JSX.Element {
  const { ui, controller } = props.screen;
  const version = useVersion(controller, ui.controllers.regions);
  const [overlay, setOverlay] = props.screen.overlay;
  const [topInset, setTopInset] = props.screen.topInset;
  // Item scrolling animates on OpenTUI's timeline engine, driven by this renderer.
  const renderer = useRenderer();
  onMount(() => engine.attach(renderer));
  onCleanup(() => { engine.detach(); props.screen.dispose(); });
  let lastTitle: string | null = null;
  const title = () => {
    version();
    const next = controller.adapter.view.presentation.title;
    if (next && next !== lastTitle) { lastTitle = next; props.onTitle?.(next); }
    return null;
  };
  return (
    <box width="100%" height="100%" backgroundColor="#1e1e2e">
      {title()}
      <ScreenLayout
        ui={ui}
        statuslines
        onOverlayHeight={setOverlay}
        onTopInset={setTopInset}
        onKey={action => { if (action?.id !== INTERRUPT_ACTION) controller.disarm(); }}
        onEditorReader={props.screen.setEditorReader}
        stage={() => <StageView ui={ui} />}
        timeline={
          <TimelineView
            timeline={ui.controllers.timeline}
            focused={(version(), ui.controllers.regions.current() === "timeline")}
            queued={(version(), props.screen.queued())}
            topInset={topInset()}
            overlayHeight={overlay()}
            slack={props.screen.slack()}
            scrollRef={props.screen.setScroll}
            onFrame={props.screen.frame}
          />
        }
      />
    </box>
  );
}
