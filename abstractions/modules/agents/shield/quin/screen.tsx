/**
 * Builds quin's UI controllers around one agent connection and renders them.
 * Setup runs outside rendering, so a keymap error fails startup with its
 * message instead of a broken screen.
 */
import { type CliRenderer, createHostClipboard, createRendererClipboardAdapter, type ScrollBoxRenderable } from "@opentui/core";
import type { JSX } from "@opentui/solid";
import { createSignal, onCleanup } from "solid-js";
import { INTERRUPT_ACTION, setupDefaultActions, type QuinActions } from "./contributions/default";
import type { Controller } from "./controller";
import { bridgeDialogs } from "./dialogs";
import { entryType, scrollTimeline, timelineSync, TimelineView } from "./timeline";
import type { StatuslineContribution } from "./ui/statusline";
import { formatChord, type Keymap } from "./ui/keys";
import { ScreenLayout } from "./ui/layout";
import { createQuinUI, type QuinUIInstance } from "./ui/quin-ui";
import { setupStageUI, StageView } from "./ui/stage";
import { useVersion } from "./ui/state";
import { formatContext, formatUsage } from "./usage";

export interface QuinScreen {
  ui: QuinUIInstance<JSX.Element>;
  controller: Controller;
  actions: QuinActions;
  /** Set by the view once its scrollbox exists. */
  setScroll(scroll: ScrollBoxRenderable): void;
  /** Set by the view once the native editor exists. */
  setEditorReader(read: () => { text: string; cursor: number }): void;
  queued(): string;
  dispose(): void;
}

export function setupScreen(controller: Controller, options: { keymap?: Keymap; renderer?: CliRenderer; cwd?: string } = {}): QuinScreen {
  const c = controller;
  const ui = createQuinUI<JSX.Element>({ sendPrompt: text => c.sendPrompt(text), keymap: options.keymap });
  const { timeline, editor, statusline, runState, keys } = ui.controllers;
  let scroll: ScrollBoxRenderable | undefined;
  let readEditor: (() => { text: string; cursor: number }) | undefined;

  let clipboard: ReturnType<typeof createHostClipboard> | undefined;
  try { clipboard = createHostClipboard(); } catch {}
  const fallback = options.renderer ? createRendererClipboardAdapter(options.renderer) : undefined;
  const copy = async (text: string) => {
    try { if (clipboard && (await clipboard.writeText(text, { selection: "clipboard" })).status === "written") return true; } catch {}
    return fallback?.writeText(text, "clipboard").status === "attempted";
  };

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
    scrollTimeline: amount => scrollTimeline(scroll, amount),
    revealCursor: () => { const id = timeline.cursor(); if (id) scrollTimeline(scroll, { reveal: id }); },
    copyTimelineItem: () => {
      const text = timeline.currentItem()?.sourceText();
      if (text !== undefined) void copy(text).then(ok => c.fail(ok ? "Copied" : "Clipboard unavailable"));
    },
  };

  const stageUI = setupStageUI(ui);
  const registrations = [timeline.registerType(entryType), setupDefaultActions(ui, actions)];
  try {
    keys.checkKeymap();
  } catch (error) {
    for (const registration of registrations) registration.dispose();
    stageUI.dispose();
    throw error;
  }
  const stopDialogs = bridgeDialogs({ controller: c, ui, ...stageUI });
  c.onEditorText = text => editor.setText(text);

  const sync = timelineSync(timeline, entryType);
  const statuses = new Map<string, StatuslineContribution>();
  const notice = statusline.contribute("top", { text: "" });
  const chord = (id: string) => { const first = keys.chords(id)[0]; return first ? formatChord(first) : undefined; };
  const hint = statusline.contribute("bottom", { text: "" });
  const refresh = () => {
    const view = c.adapter.view;
    sync(view.timeline.entries);
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
    setEditorReader: read => { readEditor = read; },
    queued: () => {
      const q = c.adapter.view.queue;
      const text = (p: any) => typeof p === "string" ? p : p.message || JSON.stringify(p);
      return [...q.steering.map(p => `steer: ${text(p)}`), ...q.followUp.map(p => `follow-up: ${text(p)}`)].join("\n");
    },
    dispose: () => {
      clearInterval(timer);
      unsubscribe();
      stopDialogs();
      for (const registration of registrations) registration.dispose();
      stageUI.dispose();
      void clipboard?.dispose();
    },
  };
}

export function Screen(props: { screen: QuinScreen; onTitle?(title: string): void }): JSX.Element {
  const { ui, controller } = props.screen;
  const version = useVersion(controller, ui.controllers.regions);
  const [overlay, setOverlay] = createSignal(0);
  const [topInset, setTopInset] = createSignal(0);
  onCleanup(() => props.screen.dispose());
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
            scrollRef={props.screen.setScroll}
          />
        }
      />
    </box>
  );
}
