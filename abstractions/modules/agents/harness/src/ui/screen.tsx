import { engine } from "@opentui/core";
import { type JSX, useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid";
import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount } from "solid-js";
import { setupCommands } from "../contributions/commands";
import { setupCommandUI } from "./commands";
import { setupDefaultUI } from "../contributions/default";
import type { SessionHost } from "../core/session";
import {
  type NoticeLevel,
  modelName,
  notice,
  reduceTimeline,
  type SessionEntry,
  type TimelineEvent,
  type TimelineState,
  timelineState,
} from "../core/session-entries";
import { branchUsage, formatContext, formatUsage } from "../core/usage";
import { StageView, setupStageUI } from "./stage";
import type { ItemType } from "./controllers";
import { createClientHost } from "./harness-client";
import { createItemActions, type TimelineScrollBox } from "./item-actions";
import { createExtensionUI } from "./extension-ui";
import {
  allocateHeights,
  createHarnessUI,
  type HarnessUIActions,
  type HarnessUIInstance,
  type TimelineItemSink,
} from "./harness-ui";
import { EditorView } from "./editor";
import { RunStateIndicator, StatuslineView, statuslineSegments } from "./statusline";
import { type QueuedPrompts, TimelineProjector, TimelineView } from "./timeline";
import { createTimelineTypes } from "./timeline-types";

import { useVersion } from "./state";

export interface ScreenLayoutProps<Render = unknown> {
  ui: HarnessUIInstance<Render>;
  timeline: JSX.Element;
  stage?: () => JSX.Element;
  /** Show the one-row status lines above the timeline and below the editor. */
  statuslines?: boolean;
  /** Rows the overlays cover over the timeline's bottom and top edges. */
  onOverlayHeight?(rows: number): void;
  onTopInset?(rows: number): void;
}

/**
 * Timeline fills the screen; the editor is drawn over its bottom edge and stage
 * sits directly on top of the editor. The bottom status line sits under the
 * editor, the top one over the timeline's first row, and the run state
 * indicator over the timeline row just above the stage or editor. Only the
 * focused region's renderable takes focus, and the overlays are recomputed
 * from terminal size and content.
 */
export function ScreenLayout<Render>(props: ScreenLayoutProps<Render>): JSX.Element {
  const { regions, editor, stage, statusline, runState } = props.ui.controllers;
  const dimensions = useTerminalDimensions();
  const version = useVersion(regions, editor, stage, statusline, runState);

  const focusedRegion = () => (version(), regions.current());
  const snapshot = () => (version(), editor.snapshot());
  const stageActive = () => (version(), stage.hasActive());

  const hasStage = () =>
    stageActive() ? Boolean(props.stage) : Boolean(snapshot().assist?.items.length);
  const assistView = () => (
    <box flexDirection="column">
      <For each={snapshot().assist?.items ?? []}>
        {(item, index) => (
          <text>{`${index() === snapshot().assist?.cursor ? "▶ " : "  "}${item}`}</text>
        )}
      </For>
    </box>
  );

  // The one global key handler: resolve the focused region's binding, suppress
  // the key's native handling, then run the action exactly once.
  useKeyboard((key) => {
    const action = regions.resolve(key);
    if (!action) {
      return;
    }
    key.preventDefault();
    action();
  });

  const allocation = createMemo(() =>
    allocateHeights(
      dimensions().height,
      { preferredHeight: snapshot().preferredHeight },
      {
        preferredHeight: stageActive()
          ? (stage.active()?.preferredHeight ?? 0) + 1
          : (editor.snapshot().assist?.items.length ?? 0),
      },
      { top: props.statuslines, bottom: props.statuslines },
    ),
  );

  // The editor has no side border, so its body spans the whole terminal width
  // at every height and the textarea wrap measurement uses the same width.
  const bodyWidth = () => Math.max(1, dimensions().width);
  const below = () => allocation().editor + allocation().stage + allocation().bottom;
  const room = () => dimensions().height - allocation().top - below();
  // The indicator covers a timeline row only while the timeline keeps two others.
  const indicator = () => (version(), runState.snapshot() !== undefined) && room() >= 3;
  // A blank row separates the history from the bars and the indicator from
  // its neighbours, while the terminal is tall enough to spare them.
  const margin = () => (props.statuslines && room() >= 8 ? 1 : 0);
  const topInset = () => allocation().top + margin();
  const overlay = () => below() + margin() + (indicator() ? 1 + margin() : 0);

  createEffect(() => {
    props.onOverlayHeight?.(overlay());
  });
  createEffect(() => {
    props.onTopInset?.(topInset());
  });

  // A stage with no room left cannot hold focus; read
  // the reactive focus so a later request cannot leave it on a collapsed stage.
  createEffect(() => {
    if (allocation().stage === 0 && focusedRegion() === "stage") {
      regions.requestFocus("editor");
    }
  });

  return (
    <box width="100%" height="100%">
      <box
        id="harness-timeline"
        position="absolute"
        top={0}
        left={0}
        width="100%"
        height="100%"
        zIndex={1}
        focusable
        focused={focusedRegion() === "timeline"}
        onMouseDown={() => regions.requestFocus("timeline")}
      >
        {/* Keep the timeline laid out at full terminal size, but clip its paint at
            the transparent overlays so timeline glyphs do not show through. */}
        <box
          id="harness-timeline-clip"
          position="absolute"
          top={topInset()}
          left={0}
          width="100%"
          height={Math.max(0, dimensions().height - topInset() - overlay())}
          overflow="hidden"
        >
          <box
            position="absolute"
            top={-topInset()}
            left={0}
            width={dimensions().width}
            height={dimensions().height}
            flexDirection="column"
          >
            {props.timeline}
          </box>
        </box>
      </box>
      {allocation().top > 0 ? (
        <box
          id="harness-statusline-top"
          position="absolute"
          top={0}
          left={0}
          width="100%"
          height={1}
          zIndex={2}
        >
          <StatuslineView
            segments={(version(), statuslineSegments(statusline, "top"))}
            width={dimensions().width}
          />
        </box>
      ) : null}
      {indicator() ? (
        <box
          id="harness-run-state"
          position="absolute"
          left={2}
          right={0}
          bottom={below() + margin()}
          height={1}
          zIndex={2}
        >
          <RunStateIndicator controller={runState} />
        </box>
      ) : null}
      {hasStage() && allocation().stage > 0 ? (
        <box
          id="harness-stage"
          borderColor="#45475a"
          border={stageActive() && allocation().stage >= 3 ? ["top"] : false}
          position="absolute"
          left={0}
          bottom={allocation().editor + allocation().bottom}
          width="100%"
          height={allocation().stage}
          zIndex={3}
          focusable
          focused={focusedRegion() === "stage"}
          onMouseDown={() => regions.requestFocus("stage")}
        >
          {stageActive() ? props.stage?.() : assistView()}
        </box>
      ) : null}
      <box
        id="harness-editor"
        position="absolute"
        left={0}
        bottom={allocation().bottom}
        width="100%"
        height={allocation().editor}
        zIndex={2}
        title={
          allocation().chrome > 0
            ? `${focusedRegion() === "editor" ? "▶" : " "} ${snapshot().label ?? "prompt"} [${focusedRegion()}]`
            : undefined
        }
        onMouseDown={() => regions.requestFocus("editor")}
        // Border color is constant while chrome is absent: the `borderColor`
        // setter re-enables a border when it changes, and the `border` prop is
        // applied after it so the chrome-less frame wins.
        borderColor={
          allocation().chrome > 0 && focusedRegion() === "editor" ? "#89b4fa" : "#45475a"
        }
        border={allocation().chrome > 0 ? ["top", "bottom"] : false}
      >
        <EditorView
          text={snapshot().text}
          cursor={snapshot().cursor}
          bodyWidth={bodyWidth()}
          focused={focusedRegion() === "editor"}
          bodyHeight={allocation().body}
          onContentChange={(text, cursor) => editor.setText(text, cursor)}
          onCursorChange={(offset) => editor.setCursor(offset)}
          onHeightChange={(lines) => editor.reportHeight(lines)}
        />
      </box>
      {allocation().bottom > 0 ? (
        <box
          id="harness-statusline-bottom"
          position="absolute"
          bottom={0}
          left={0}
          width="100%"
          height={1}
          zIndex={2}
        >
          <StatuslineView
            segments={(version(), statuslineSegments(statusline, "bottom"))}
            width={dimensions().width}
          />
        </box>
      ) : null}
    </box>
  );
}

/** Events that change what the status lines report; streaming deltas do not. */
const STATUS_EVENTS = new Set<TimelineEvent["type"]>([
  "agent_settled",
  "message_end",
  "compaction_end",
  "thinking_level_changed",
  "model_changed",
  "session_info_changed",
  "entry_appended",
]);

/** Session events and contributions meet at the screen, not in its views. */
export function Screen(props: { host: SessionHost; startupNotices: readonly SessionEntry[] }) {
  const renderer = useRenderer();
  const session = () => props.host.runtime.session;
  const settings = () => ({
    model: session().model ? modelName(session().model!) : undefined,
    thinking: session().thinkingLevel,
  });
  // A resumed session starts with its history.
  const [state, setState] = createSignal<TimelineState>(
    timelineState([...props.host.history(), ...props.startupNotices], settings()),
  );
  // Messages waiting for the current run; each enters the timeline when it starts.
  const [queued, setQueued] = createSignal<QueuedPrompts>({ steering: [], followUp: [] });
  let scrollbox: TimelineScrollBox | undefined;
  const [overlayHeight, setOverlayHeight] = createSignal(0);
  const [topInset, setTopInset] = createSignal(0);
  const [slack, setSlack] = createSignal(0);
  const [hiddenThinkingLabel, setHiddenThinkingLabel] = createSignal<string | undefined>();
  const [storageUncertain, setStorageUncertain] = createSignal(false);

  const addNotice = (level: NoticeLevel, text: string) =>
    setState((current) => ({ ...current, entries: [...current.entries, notice(level, text)] }));

  /** Resolves once pi accepts or rejects the text, not when the run finishes. */
  const submit = (text: string) =>
    new Promise<boolean>((resolve) => {
      if (storageUncertain()) {
        addNotice(
          "error",
          "The session could not be saved, so nothing more is sent. Quit, fix the storage, and reopen the session with --session.",
        );
        resolve(false);
        return;
      }
      const accept = () => {
        itemActions.follow();
        resolve(true);
      };
      session()
        .prompt(text, {
          // pi applies streamingBehavior only when a run is in progress.
          streamingBehavior: "followUp",
          // Called once the prompt is accepted (started, queued, or handled),
          // never for a rejected one; pi's RPC mode answers its client from it.
          preflightResult: accept,
        })
        .then(accept, (error) => {
          addNotice("error", error instanceof Error ? error.message : String(error));
          resolve(false);
        });
    });

  // Contributed items live with the session's entries, so one projection orders both.
  const items: TimelineItemSink = {
    put: (id, kind, value) =>
      setState((current) => {
        const index = current.entries.findIndex((entry) => entry.id === id);
        const version = index === -1 ? 0 : current.entries[index]!.version + 1;
        const entry: SessionEntry = { kind: "contribution", id, version, type: kind, value };
        const entries = [...current.entries];
        if (index === -1) entries.push(entry);
        else entries[index] = entry;
        return { ...current, entries };
      }),
    remove: (id) =>
      setState((current) => ({
        ...current,
        entries: current.entries.filter((entry) => entry.id !== id),
      })),
  };
  const ui = createHarnessUI<JSX.Element>({
    sendPrompt: submit,
    items,
    notify: (text) => addNotice("error", text),
  });
  const { timeline, bindings, statusline, runState } = ui.controllers;
  const editor = ui.controllers.editor;
  const stageUI = setupStageUI(ui);
  const commandUI = setupCommandUI(ui);
  const commands = ui.controllers.commands;
  const clientHost = createClientHost({
    timeline,
    items,
    bindings,
    stage: ui.controllers.stage,
    statusline,
  });
  const extensionUI = createExtensionUI({
    ui,
    ...stageUI,
    notify: addNotice,
    client: () => clientHost.current(),
    setTitle: (title) => renderer.setTerminalTitle(title),
    setHiddenThinkingLabel,
  });
  const types = createTimelineTypes({ hiddenThinkingLabel });
  const itemTypeRegistrations = Object.values(types).map((type) =>
    timeline.registerType(type as ItemType<unknown, JSX.Element>),
  );
  const reported = new Set<string>();
  const projector = new TimelineProjector({
    types,
    registry: timeline,
    bindings,
    // Each problem once, so a streaming item does not repeat it.
    diagnose: (message) => {
      if (reported.has(message)) return;
      reported.add(message);
      queueMicrotask(() => addNotice("warning", message));
    },
  });
  const itemActions = createItemActions({
    timeline,
    scrollbox: () => scrollbox,
    overlayHeight,
    topInset,
    renderer,
    notify: addNotice,
    onSlackChange: setSlack,
  });

  const bindingsVersion = useVersion(bindings);
  createEffect(() => {
    bindingsVersion();
    timeline.replace(projector.project(state().entries));
  });

  const refreshStatus = () => {
    const current = session();
    const manager = current.sessionManager;
    statusline.setFields({
      session: manager.getSessionName() ?? manager.getSessionId().slice(0, 8),
      cwd: manager.getCwd(),
      model: settings().model ?? "no model",
      thinking: current.supportsThinking() ? `thinking ${current.thinkingLevel}` : "",
      context: formatContext(current.getContextUsage()),
      totals: formatUsage(branchUsage(manager.getBranch())),
    });
  };
  refreshStatus();

  const regionVersion = useVersion(ui.controllers.regions);
  const timelineFocused = () => (regionVersion(), ui.controllers.regions.current() === "timeline");
  // Entering the timeline puts an off-screen cursor on the latest item.
  createEffect(
    on(
      timelineFocused,
      (focused) => {
        if (focused) itemActions.reveal();
      },
      { defer: true },
    ),
  );

  const runStage = (action: string) => {
    const active = ui.controllers.stage.active();
    if (active) {
      void Promise.resolve()
        .then(() => active.runAction(action))
        .catch((error) => addNotice("error", String(error)));
      return;
    }
    const assist = editor.snapshot().assist;
    if (!assist) return;
    if (action === "next" || action === "previous") {
      editor.setAssist({
        ...assist,
        cursor: Math.max(
          0,
          Math.min(assist.items.length - 1, assist.cursor + (action === "next" ? 1 : -1)),
        ),
      });
    } else {
      if (action === "confirm" && assist.items[assist.cursor] !== undefined)
        editor.setText(assist.items[assist.cursor]!);
      editor.setAssist(undefined);
      ui.regions.requestFocus("editor");
    }
  };

  const actions: HarnessUIActions = {
    submit: () => {
      if (editor.activeDraft()) {
        editor.submitDraft();
      } else {
        void editor.submitPrompt();
      }
    },
    cancel: () => {
      if (editor.activeDraft()) {
        editor.cancelDraft();
        return;
      }
      if (!session().isIdle) {
        void session().abort();
      }
    },
    quit: () => {
      void disposeUI()
        .then(() => props.host.dispose())
        .finally(() => renderer.destroy());
    },
    focusFromEditor: (target) => editor.requestFocus(target),
    moveTimelineCursor: itemActions.move,
    scrollTimeline: itemActions.scroll,
    toggleTimelineItem: itemActions.toggle,
    expandTimelineItem: itemActions.expand,
    collapseTimelineItem: itemActions.collapse,
    copyTimelineItem: () => {
      void itemActions.copy();
    },
    moveStageCursor: (delta) => runStage(delta > 0 ? "next" : "previous"),
    confirmStage: () => runStage("confirm"),
    cancelStage: () => runStage("cancel"),
    openCommand: () => commands.open(),
    moveStageRequest: (delta) => ui.controllers.stage.moveRequest(delta),
    stageAcceptsText: () => commands.acceptsText(),
    commandArguments: () => {
      void commands.arguments();
    },
    commandOwnsDraft: () => commands.ownsDraft(),
    moveCommandDraftCursor: (delta) => commands.move(delta, true),
  };

  const registrations = [
    ...itemTypeRegistrations,
    ...setupCommands(ui, props.host, (text) => addNotice("info", text)),
    ...setupDefaultUI(ui, actions),
  ];
  let disposing: Promise<void> | undefined;
  const disposeUI = () =>
    (disposing ??= (async () => {
      clientHost.retire();
      commandUI.dispose();
      extensionUI.dispose();
      stageUI.dispose();
      for (const registration of registrations) registration.dispose();
      await itemActions.dispose();
    })());
  onCleanup(() => {
    void disposeUI();
  });

  const onEvent = (event: TimelineEvent) => {
    if (event.type === "queue_update") {
      setQueued({ steering: event.steering, followUp: event.followUp });
    }
    // Accepted work, including automatic continuation, until the session settles.
    if (event.type === "agent_start" || event.type === "compaction_start") runState.setActive(true);
    if (event.type === "agent_settled" || (event.type === "compaction_end" && session().isIdle))
      runState.setActive(false);
    setState((current) => reduceTimeline(current, event));
    // pi saves a message after its listeners return, so totals that include it are read a moment later.
    if (STATUS_EVENTS.has(event.type)) queueMicrotask(refreshStatus);
  };

  onCleanup(() => engine.detach());
  onMount(() => {
    engine.attach(renderer);
    props.host
      .bind({
        uiContext: extensionUI.context,
        onEvent,
        onExtensionError: (error) =>
          addNotice("error", `${error.extensionPath} (${error.event}): ${error.error}`),
        onShutdownRequest: actions.quit,
        onHistoryReplaced: (replacement) => {
          projector.reset();
          timeline.resetDisclosure();
          // Contributed items are not part of a history, so they stay.
          setState((current) =>
            timelineState(
              [
                ...props.host.history(),
                ...current.entries.filter((entry) => entry.kind === "contribution"),
              ],
              settings(),
            ),
          );
          setQueued({
            steering: replacement.getSteeringMessages(),
            followUp: replacement.getFollowUpMessages(),
          });
          runState.setActive(!replacement.isIdle);
          itemActions.follow();
          refreshStatus();
        },
        prepareClient: () => clientHost.prepare(),
        onShutdown: (reason) => {
          clientHost.retire();
          extensionUI.resetGeneration();
          commands.resetGeneration();
          // pi copies the UI context again while it reloads, before any later hook.
          if (reason === "reload" && !storageUncertain()) clientHost.prepare();
        },
        onStorageFailure: (error) => {
          setStorageUncertain(true);
          clientHost.retire();
          runState.setActive(false);
          addNotice(
            "error",
            `The session could not be saved (${error.message}). Its file may be incomplete; the run was stopped and nothing more is written. Quit, fix the storage, and reopen the session with --session.`,
          );
        },
        notify: addNotice,
      })
      .catch((error) => addNotice("error", error instanceof Error ? error.message : String(error)));
  });

  return (
    <ScreenLayout
      ui={ui}
      statuslines
      onOverlayHeight={setOverlayHeight}
      onTopInset={setTopInset}
      stage={() => <StageView ui={ui} />}
      timeline={
        <TimelineView
          timeline={timeline}
          focused={timelineFocused()}
          queued={queued()}
          overlayHeight={overlayHeight()}
          topInset={topInset()}
          slack={slack()}
          scrollRef={(element) => (scrollbox = element)}
          onFrame={itemActions.frame}
        />
      }
    />
  );
}
