/** The screen layout, copied from the harness's `ScreenLayout`. */
import { type JSX, useKeyboard, useTerminalDimensions } from "@opentui/solid";
import { createEffect, createMemo } from "solid-js";
import { EditorView } from "./editor";
import type { Action } from "./keys";
import { allocateHeights, type QuinUIInstance } from "./quin-ui";
import { useVersion } from "./state";
import { RunStateIndicator, StatuslineView, statuslineSegments } from "./statusline";

interface ScreenLayoutProps<Render = unknown> {
  ui: QuinUIInstance<Render>;
  timeline: JSX.Element;
  stage?: () => JSX.Element;
  /** Show the one-row status lines above the timeline and below the editor. */
  statuslines?: boolean;
  /** Rows the overlays cover over the timeline's bottom and top edges. */
  onOverlayHeight?: (rows: number) => void;
  onTopInset?: (rows: number) => void;
  /** Every key, with the action it resolved to; called before the action runs. */
  onKey?: (action: Action | undefined) => void;
  /** Reads the native editor's text, which can run ahead of its change callbacks. */
  onEditorReader?: (read: () => { text: string; cursor: number }) => void;
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
  const { regions, keys, editor, stage, statusline, runState } = props.ui.controllers;
  const dimensions = useTerminalDimensions();
  const version = useVersion(regions, editor, stage, statusline, runState);

  const focusedRegion = () => (version(), regions.current());
  const snapshot = () => (version(), editor.snapshot());
  const stageActive = () => (version(), stage.hasActive());

  const hasStage = () => stageActive() && Boolean(props.stage);

  // The one global key handler: resolve the focused region's binding, suppress
  // the key's native handling, then run the action exactly once.
  useKeyboard((key) => {
    const action = keys.resolve(regions.current(), key);
    props.onKey?.(action);
    if (!action) {
      return;
    }
    key.preventDefault();
    action.run();
  });

  const allocation = createMemo(() =>
    allocateHeights(
      dimensions().height,
      { preferredHeight: snapshot().preferredHeight },
      {
        preferredHeight: stageActive() ? (stage.active()?.preferredHeight ?? 0) + 1 : 0,
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
  const indicator = () => (version(), runState.message() !== undefined) && room() >= 3;
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
        id="quin-timeline"
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
          id="quin-timeline-clip"
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
          id="quin-statusline-top"
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
          id="quin-run-state"
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
          id="quin-stage"
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
          {props.stage?.()}
        </box>
      ) : null}
      <box
        id="quin-editor"
        position="absolute"
        left={0}
        bottom={allocation().bottom}
        width="100%"
        height={allocation().editor}
        zIndex={2}
        // Only a draft is labelled; the prompt is marked by the border color and cursor.
        title={
          allocation().chrome > 0 && snapshot().label
            ? `${focusedRegion() === "editor" ? "▶" : " "} ${snapshot().label}`
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
          onReader={props.onEditorReader}
        />
      </box>
      {allocation().bottom > 0 ? (
        <box
          id="quin-statusline-bottom"
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
