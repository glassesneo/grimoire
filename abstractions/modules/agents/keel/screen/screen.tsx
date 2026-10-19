/**
 * One keel screen: the regions, the editor bound to the draft the stage
 * selects, the timeline, and the key dispatch, around a connection.
 *
 * Keys. A key is looked up in the global layer first, then in the focused
 * region's; a key neither binds goes to the focused region's native input, so
 * only the editor's engine ever types. Actions run here when they are the
 * screen's own (`local` in the state); every other action is invoked in the
 * runtime, which decides whether this screen may run it.
 *
 * Stop. The first press of a stop action, `global.stop` or a region's, arms
 * only this screen, and a second press within a second invokes `global.stop`;
 * any other key or action disarms. Before the agent's state arrives, Ctrl+Q
 * and Ctrl+C close the screen.
 */
import { engine, type KeyEvent } from "@opentui/core";
import { type JSX, useRenderer } from "@opentui/solid";
import { createSignal, onCleanup, onMount } from "solid-js";
import { chordsOf, formatChord, KeyTables, REGIONS } from "../protocol/keys";
import { type AssistInfo, type InvokeResult, PROMPT } from "../protocol/wire";
import type { Connection } from "./connection";
import { Drafts } from "./drafts";
import { ItemProjector } from "./items";
import { StageModel } from "./stage";
import { Emitter, TimelineTree, RegionController } from "./ui/controllers";
import { createItemActions, type ClipboardWriter, type TimelineScrollBox } from "./ui/item-actions";
import { ScreenLayout, minEditorHeight, maxEditorHeight } from "./ui/layout";
import { createRenderers, palette } from "./ui/renderers";
import { StageView } from "./stage-view";
import { useVersion } from "./ui/state";
import type { StatusSegment } from "./ui/statusline";
import { TimelineView } from "./ui/timeline";

const STOP_WINDOW_MS = 1000;
/** How long Enter waits for an assist's candidates to follow the text. */
const ASSIST_WAIT_MS = 3000;

/** The screen's own state that is not a region's: notices, stop arming, editor height. */
class ScreenState extends Emitter {
  notice: string | undefined;
  /** When the armed stop lapses; 0 while nothing is armed. */
  armedUntil = 0;
  editorHeight = minEditorHeight;
  cursor = 0;
  #noticeTimer: ReturnType<typeof setTimeout> | undefined;
  #armTimer: ReturnType<typeof setTimeout> | undefined;

  arm(): void {
    this.armedUntil = Date.now() + STOP_WINDOW_MS;
    clearTimeout(this.#armTimer);
    this.#armTimer = setTimeout(() => this.disarm(), STOP_WINDOW_MS);
    this.changed();
  }

  disarm(): void {
    if (!this.armedUntil) return;
    this.armedUntil = 0;
    clearTimeout(this.#armTimer);
    this.changed();
  }

  notify(text: string): void {
    this.notice = text;
    clearTimeout(this.#noticeTimer);
    this.#noticeTimer = setTimeout(() => {
      this.notice = undefined;
      this.changed();
    }, 6000);
    this.changed();
  }

  update(): void {
    this.changed();
  }

  dispose(): void {
    clearTimeout(this.#noticeTimer);
    clearTimeout(this.#armTimer);
  }
}

export interface KeelScreen {
  connection: Connection;
  regions: RegionController;
  timeline: TimelineTree<JSX.Element>;
  stage: StageModel;
  drafts: Drafts;
  state: ScreenState;
  /** Runs an action by id as its key would. */
  run: (id: string) => void;
  /** The editor's text changed by typing. */
  edit: (text: string, cursor: number) => void;
  /** Resolves a key; true when the screen took it. */
  key: (key: Pick<KeyEvent, "name" | "ctrl" | "shift" | "meta"> & { option?: boolean }) => boolean;
  setScroll: (scroll: TimelineScrollBox | undefined) => void;
  frame: () => void;
  overlay: ReturnType<typeof createSignal<number>>;
  topInset: ReturnType<typeof createSignal<number>>;
  slack: () => number;
  setEditorReader: (read: () => { text: string; cursor: number }) => void;
  dispose: () => void;
}

export function setupScreen(
  connection: Connection,
  options: {
    renderer?: Parameters<typeof createItemActions>[0]["renderer"];
    clipboard?: ClipboardWriter;
  } = {},
): KeelScreen {
  const c = connection;
  const state = new ScreenState();
  const regions = new RegionController();
  const timeline = new TimelineTree<JSX.Element>();
  const projector = new ItemProjector(timeline, createRenderers());
  const stage = new StageModel(() => c.mirror.state);
  const drafts = new Drafts({
    drafts: () => c.mirror.state?.drafts ?? {},
    writable: () => c.writable,
    invoke: (action, args) => c.invoke(action, args),
    notify: (text) => state.notify(text),
  });
  let tables = new KeyTables({});
  let keysSource: unknown;
  let scroll: TimelineScrollBox | undefined;
  let readEditor: (() => { text: string; cursor: number }) | undefined;
  const overlay = createSignal(0);
  const topInset = createSignal(0);
  const [slack, setSlack] = createSignal(0);
  const items = createItemActions({
    timeline,
    scrollbox: () => scroll,
    overlayHeight: overlay[0],
    topInset: topInset[0],
    renderer: options.renderer,
    clipboard: options.clipboard,
    onSlackChange: setSlack,
    notify: (_level, text) => state.notify(text),
  });

  const report = (action: string, result: InvokeResult) => {
    if (result.outcome !== "rejected") return;
    const hint =
      result.code === "not_writer"
        ? `; ${hintFor("screen.take_write", "editor.take_write") ?? "take the write"} to write`
        : "";
    state.notify(`${action}: ${result.message ?? result.code}${hint}`);
  };
  const invoke = async (action: string, args?: unknown) => {
    const result = await c.invoke(action, args);
    report(action, result);
    return result;
  };

  const hintFor = (...ids: string[]) => {
    const keys = c.mirror.state?.keys ?? {};
    for (const id of ids) {
      const chord = chordsOf(keys, id)[0];
      if (chord) return formatChord(chord);
    }
    return undefined;
  };

  /** Sends what the editor shows: the prompt, a request's answer, or an assist's candidate. */
  const submit = async () => {
    // Change callbacks can lag a batch of input that ends in Enter.
    const latest = readEditor?.();
    if (latest) edit(latest.text, latest.cursor);
    const target = stage.selected();
    const destination = stage.destination();
    const revision = await drafts.settle(destination);
    if (revision === undefined) return;
    if (target?.kind === "assist") {
      // The candidates offered must be the ones for the text as typed.
      const current = await caughtUp(target.info.id, revision);
      if (!current) return state.notify("The candidates did not follow the text; try again");
      const candidate = current.candidates[stage.cursor({ kind: "assist", info: current })];
      if (!candidate) return state.notify("No candidate to accept");
      const result = await invoke("assist.accept", {
        assist: current.id,
        candidate: candidate.id,
        revision,
      });
      if (result.outcome !== "rejected") stage.leave();
      return;
    }
    if (target?.kind === "request") {
      const value = target.info.options[stage.cursor(target)];
      if (value === undefined) return;
      await invoke("request.answer", { request: target.info.id, value, revision });
      return;
    }
    const result = await invoke("editor.submit", { destination: PROMPT, revision });
    if (result.outcome !== "rejected") items.follow();
  };

  /** The assist once its candidates follow `revision` of its draft, or undefined after a while. */
  const caughtUp = (id: string, revision: number) =>
    new Promise<AssistInfo | undefined>((resolve) => {
      const finish = (assist: AssistInfo | undefined) => {
        unsubscribe();
        clearTimeout(timer);
        resolve(assist);
      };
      const check = () => {
        const assist = c.mirror.state?.assists.find((entry) => entry.id === id);
        if (!assist || assist.revision > revision) finish(undefined);
        else if (assist.revision === revision) finish(assist);
      };
      const unsubscribe = c.subscribe(check);
      const timer = setTimeout(() => finish(undefined), ASSIST_WAIT_MS);
      check();
    });

  const stop = () => {
    if (!state.armedUntil) return state.arm();
    state.disarm();
    void invoke("global.stop");
  };

  const cycle = (delta: number) => {
    const available = REGIONS.filter((region) => regions.isAvailable(region));
    const index = available.indexOf(regions.current());
    const next = available[(index + delta + available.length) % available.length];
    if (next) regions.requestFocus(next);
  };

  const takeWrite = () =>
    void c.takeWrite().then(
      () => state.notify("This screen writes now"),
      (error) => state.notify(`take write: ${(error as Error).message}`),
    );

  /** One operation under every region's action id, and under any further ids. */
  const everywhere = (name: string, handler: () => void, ...ids: string[]) =>
    Object.fromEntries(
      [...REGIONS.map((region) => `${region}.${name}`), ...ids].map((id) => [id, handler]),
    );

  /** What the screen itself does for an action id; anything else is invoked in the runtime. */
  const local: Record<string, () => void> = {
    ...everywhere("stop", stop, "global.stop"),
    ...everywhere("take_write", takeWrite, "screen.take_write"),
    ...everywhere("detach", () => c.detach(), "screen.detach"),
    ...everywhere("focus_next", () => cycle(1)),
    ...everywhere("focus_previous", () => cycle(-1)),
    "editor.submit": () => void submit(),
    "stage.confirm": () => void submit(),
    "editor.stage_next": () => stage.move(1),
    "editor.stage_previous": () => stage.move(-1),
    "editor.stage_leave": () => stage.leave(),
    "stage.next": () => stage.move(1),
    "stage.previous": () => stage.move(-1),
    "stage.leave": () => {
      stage.leave();
      regions.requestFocus("editor");
    },
    "stage.cursor_down": () => stage.moveCursor(1),
    "stage.cursor_up": () => stage.moveCursor(-1),
    "editor.candidate_next": () => stage.moveCursor(1),
    "editor.candidate_previous": () => stage.moveCursor(-1),
    "editor.command_open": () => {
      if (!stage.select("assist", "command")) state.notify("The command input is not loaded");
    },
    "timeline.command_open": () => {
      if (stage.select("assist", "command")) regions.requestFocus("editor");
      else state.notify("The command input is not loaded");
    },
    "timeline.cursor_down": () => items.move(1),
    "timeline.cursor_up": () => items.move(-1),
    "timeline.toggle": () => items.toggle(),
    "timeline.expand": () => items.expand(),
    "timeline.collapse": () => items.collapse(),
    "timeline.copy": () => void items.copy(),
    "timeline.page_down": () => items.scroll("page-down"),
    "timeline.page_up": () => items.scroll("page-up"),
    "timeline.half_down": () => items.scroll("half-down"),
    "timeline.half_up": () => items.scroll("half-up"),
    "timeline.focus_editor": () => regions.requestFocus("editor"),
  };

  const run = (id: string) => {
    if (local[id] !== stop) state.disarm();
    const action = c.mirror.state?.actions.find((entry) => entry.id === id);
    if (!action) return state.notify(`No action ${id}`);
    const handler = local[id];
    if (handler) return handler();
    if (action.local) return state.notify(`This screen cannot run ${id}`);
    void invoke(id);
  };

  const key: KeelScreen["key"] = (input) => {
    const keys = c.mirror.state?.keys;
    if (keys && keys !== keysSource) {
      tables = new KeyTables(keys);
      keysSource = keys;
    }
    // Before the agent's state, and its keys, arrive, the close keys still close.
    if (!c.mirror.state && input.ctrl && (input.name === "q" || input.name === "c")) {
      c.detach();
      return true;
    }
    const id = tables.global(input) ?? tables.region(regions.current(), input);
    // Any other key, such as typing, is another operation and disarms stop.
    if (!id) {
      state.disarm();
      return false;
    }
    run(id);
    return true;
  };

  const edit = (text: string, cursor: number) => {
    state.disarm();
    const destination = stage.destination();
    if (!drafts.edit(destination, text)) return;
    state.cursor = cursor;
  };

  // Entering the timeline puts an off-screen cursor on the latest item.
  let lastRegion = regions.current();
  const unsubscribeRegions = regions.subscribe(() => {
    const region = regions.current();
    if (region === "timeline" && lastRegion !== "timeline") items.reveal();
    lastRegion = region;
  });
  const syncStageRegion = () => regions.setAvailable("stage", stage.selected() !== undefined);
  syncStageRegion();
  const unsubscribeStage = stage.subscribe(() => {
    syncStageRegion();
    state.cursor = drafts.text(stage.destination()).length;
  });

  c.onState = (applied) => {
    const mirrored = c.mirror.state;
    if (!mirrored) return;
    projector.sync(c.mirror, applied);
    stage.sync();
    drafts.sync();
    syncStageRegion();
  };
  // A snapshot may have arrived before this screen was set up.
  c.onState(undefined);

  return {
    connection: c,
    regions,
    timeline,
    stage,
    drafts,
    state,
    run,
    key,
    setScroll: (element) => {
      scroll = element;
    },
    frame: () => items.frame(),
    overlay,
    topInset,
    slack,
    setEditorReader: (read) => {
      readEditor = read;
    },
    edit,
    dispose: () => {
      unsubscribeRegions();
      unsubscribeStage();
      state.dispose();
      void items.dispose();
    },
  };
}

function statusTop(screen: KeelScreen, cwd: string): StatusSegment[] {
  const c = screen.connection;
  const session = c.mirror.state?.session;
  const role = c.phase !== "live" ? c.phase : c.writable ? "writer" : "viewer";
  return [
    { text: role, color: c.writable ? palette.success : palette.warning, priority: 0 },
    { text: session?.id.slice(0, 8) ?? "", color: palette.text, priority: 2 },
    { text: cwd, priority: 3, shrink: "end" },
    {
      text: [c.lifecycle === "ready" ? undefined : c.lifecycle, c.notice, screen.state.notice]
        .filter(Boolean)
        .join(" · "),
      color: palette.warning,
      priority: 1,
      shrink: "start",
    },
  ];
}

function statusBottom(screen: KeelScreen): StatusSegment[] {
  const state = screen.connection.mirror.state;
  const keys = state?.keys ?? {};
  const hint = (id: string, label: string) => {
    const chord = chordsOf(keys, id)[0];
    return chord ? `${formatChord(chord)} ${label}` : "";
  };
  const queue = state ? state.queue.steering.length + state.queue.followUp.length : 0;
  return [
    { text: state?.session.model ?? "no model", color: palette.text, priority: 0, shrink: "end" },
    { text: state?.session.thinking ? `thinking ${state.session.thinking}` : "", priority: 2 },
    { text: queue ? `${queue} queued` : "", priority: 1 },
    { text: hint("editor.focus_next", "focus"), priority: 5 },
    { text: hint("editor.detach", "detach"), priority: 6 },
  ];
}

function runMessage(screen: KeelScreen): string | undefined {
  const state = screen.connection.mirror.state;
  if (screen.state.armedUntil) {
    const chord = chordsOf(state?.keys ?? {}, `${screen.regions.current()}.stop`)[0];
    return `Press ${chord ? formatChord(chord) : "stop"} again within 1s to stop`;
  }
  if (!state) return undefined;
  const { phase, compacting, retrying } = state.run;
  if (phase === "paused") return "Paused";
  if (phase === "pausing") return "Pausing at the next step…";
  if (phase === "stopping") return "Stopping…";
  if (compacting) return "Compacting…";
  if (retrying) return "Waiting to retry…";
  if (phase === "running") return "Working…";
  return undefined;
}

export function Screen(props: { screen: KeelScreen; cwd: string }): JSX.Element {
  const screen = props.screen;
  const { regions, stage, drafts, state, connection } = screen;
  const version = useVersion(connection, regions, stage, drafts, state, screen.timeline);
  const [overlay, setOverlay] = screen.overlay;
  const [topInset, setTopInset] = screen.topInset;
  // Item scrolling animates on OpenTUI's timeline engine, driven by this renderer.
  const renderer = useRenderer();
  onMount(() => engine.attach(renderer));
  onCleanup(() => {
    engine.detach();
    screen.dispose();
  });
  const label = () => {
    version();
    const target = stage.selected();
    if (!target) return connection.writable ? undefined : "prompt (view only)";
    return target.kind === "request" ? `supplement: ${target.info.title}` : `${target.info.title}`;
  };
  return (
    <box width="100%" height="100%" backgroundColor="#1e1e2e">
      <ScreenLayout
        regions={regions}
        onKey={(key) => screen.key(key)}
        onOverlayHeight={setOverlay}
        onTopInset={setTopInset}
        editor={{
          text: () => (version(), drafts.text(stage.destination())),
          cursor: () => (
            version(),
            Math.min(state.cursor, drafts.text(stage.destination()).length)
          ),
          label,
          preferredHeight: () => (version(), state.editorHeight),
          reset: () => (version(), drafts.replaced(stage.destination())),
          onContentChange: (text, cursor) => screen.edit(text, cursor),
          onCursorChange: (cursor) => {
            state.cursor = cursor;
          },
          onHeightChange: (lines) => {
            const next = Math.max(minEditorHeight, Math.min(maxEditorHeight, lines));
            if (next !== state.editorHeight) {
              state.editorHeight = next;
              state.update();
            }
          },
          onReader: screen.setEditorReader,
        }}
        stage={{
          preferredHeight: () => {
            version();
            const target = stage.selected();
            if (!target) return stage.waiting() > 0 ? 1 : 0;
            const rows =
              target.kind === "request"
                ? target.info.options.length
                : Math.max(1, target.info.candidates.length);
            return rows + 2 + (target.kind === "request" && target.info.message ? 1 : 0);
          },
          view: () => <StageView screen={screen} version={version} />,
        }}
        status={{
          top: () => (version(), statusTop(screen, props.cwd)),
          bottom: () => (version(), statusBottom(screen)),
          run: () => (version(), runMessage(screen)),
        }}
        timeline={
          <TimelineView
            timeline={screen.timeline}
            focused={(version(), regions.current() === "timeline")}
            queued={(version(), connection.mirror.state?.queue)}
            topInset={topInset()}
            overlayHeight={overlay()}
            slack={screen.slack()}
            scrollRef={screen.setScroll}
            onFrame={screen.frame}
          />
        }
      />
    </box>
  );
}
