/**
 * The screen's three regions. The editor's rows are taken from the bottom
 * first; the stage sits on top of it, and the timeline fills the screen
 * behind both. Status lines and the stage give up rows before the editor
 * does. A stage with no rows cannot hold focus, which then returns to the
 * editor. A terminal too short for the editor body draws nothing until it
 * grows again.
 */
import { type JSX, useKeyboard, useTerminalDimensions } from "@opentui/solid";
import type { KeyEvent } from "@opentui/core";
import { createEffect, createMemo } from "solid-js";
import type { RegionController } from "./controllers";
import { EditorView } from "./editor";
import { useVersion } from "./state";
import { RunStateIndicator, type StatusSegment, StatuslineView } from "./statusline";

export const minEditorHeight = 2;
export const maxEditorHeight = 8;
const maxStageHeight = 10;
const editorChromeHeight = 2;

export interface HeightAllocation {
  /** Total rows the editor occupies, including its border. */
  editor: number;
  /** Rows available to the editor body. */
  body: number;
  /** Border rows: 0 when the terminal is too short to afford them. */
  chrome: number;
  stage: number;
  /** Rows of the status line above the timeline, and of the one below the editor. */
  top: number;
  bottom: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * The editor keeps its body; the status lines go first, then the stage
 * shrinks, then the editor border. A terminal shorter than the minimum body
 * gets no allocation at all.
 */
export function allocateHeights(
  terminalRows: number,
  editorPreferred: number,
  stagePreferred: number,
): HeightAllocation | undefined {
  const height = Math.max(0, Math.floor(terminalRows));
  if (height < minEditorHeight) return undefined;
  const body = clamp(Math.floor(editorPreferred), minEditorHeight, maxEditorHeight);
  const fitted = Math.min(body, height);
  let chrome = height >= fitted + editorChromeHeight ? editorChromeHeight : 0;
  let stage = clamp(Math.floor(stagePreferred), 0, maxStageHeight);
  stage = Math.min(stage, Math.max(0, height - fitted - chrome));
  if (fitted + chrome + stage > height) chrome = 0;
  const free = height - fitted - chrome - stage;
  const bottom = free >= 2 ? 1 : 0;
  const top = free - bottom >= 2 ? 1 : 0;
  return { editor: fitted + chrome, body: fitted, chrome, stage, top, bottom };
}

export interface EditorBinding {
  text: () => string;
  cursor: () => number;
  /** Shown in the editor's border when it holds something other than the prompt. */
  label: () => string | undefined;
  preferredHeight: () => number;
  /** Changes when an edit was refused; see EditorView. */
  reset: () => number;
  onContentChange: (text: string, cursor: number) => void;
  onCursorChange: (cursor: number) => void;
  onHeightChange: (lines: number) => void;
  /** Reads the native editor's text, which can run ahead of its change callbacks. */
  onReader?: (read: () => { text: string; cursor: number }) => void;
}

interface ScreenLayoutProps {
  regions: RegionController;
  editor: EditorBinding;
  timeline: JSX.Element;
  /** Rows the stage asks for, 0 when it shows nothing, and its content. */
  stage: { preferredHeight: () => number; view: () => JSX.Element };
  status: {
    top: () => StatusSegment[];
    bottom: () => StatusSegment[];
    run: () => string | undefined;
  };
  /** Every key; returns true when the screen took it. */
  onKey: (key: KeyEvent) => boolean;
  onOverlayHeight: (rows: number) => void;
  onTopInset: (rows: number) => void;
}

export function ScreenLayout(props: ScreenLayoutProps): JSX.Element {
  const dimensions = useTerminalDimensions();
  const version = useVersion(props.regions);
  const focused = () => (version(), props.regions.current());

  // The one key handler: the screen resolves global keys, then the focused
  // region's, before the native input sees the key.
  useKeyboard((key) => {
    if (props.onKey(key)) key.preventDefault();
  });

  const allocation = createMemo(() =>
    allocateHeights(
      dimensions().height,
      props.editor.preferredHeight(),
      props.stage.preferredHeight(),
    ),
  );

  const below = () => {
    const a = allocation();
    return a ? a.editor + a.stage + a.bottom : 0;
  };
  const room = () => dimensions().height - (allocation()?.top ?? 0) - below();
  const indicator = () => props.status.run() !== undefined && room() >= 3;
  const margin = () => (room() >= 8 ? 1 : 0);
  const topInset = () => (allocation()?.top ?? 0) + margin();
  const overlay = () => below() + margin() + (indicator() ? 1 + margin() : 0);

  createEffect(() => props.onOverlayHeight(overlay()));
  createEffect(() => props.onTopInset(topInset()));

  // A stage without rows cannot hold focus.
  createEffect(() => {
    if ((allocation()?.stage ?? 0) === 0 && focused() === "stage")
      props.regions.requestFocus("editor");
  });

  return (
    <box width="100%" height="100%">
      {allocation() ? (
        <>
          <box
            id="keel-timeline"
            position="absolute"
            top={0}
            left={0}
            width="100%"
            height="100%"
            zIndex={1}
            focusable
            focused={focused() === "timeline"}
            onMouseDown={() => props.regions.requestFocus("timeline")}
          >
            {/* The timeline keeps the full size, clipped at the overlays so nothing shows through. */}
            <box
              id="keel-timeline-clip"
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
          {allocation()!.top > 0 ? (
            <box position="absolute" top={0} left={0} width="100%" height={1} zIndex={2}>
              <StatuslineView segments={props.status.top()} width={dimensions().width} />
            </box>
          ) : null}
          {indicator() ? (
            <box
              position="absolute"
              left={2}
              right={0}
              bottom={below() + margin()}
              height={1}
              zIndex={2}
            >
              <RunStateIndicator message={props.status.run} />
            </box>
          ) : null}
          {allocation()!.stage > 0 ? (
            <box
              id="keel-stage"
              borderColor="#45475a"
              border={allocation()!.stage >= 3 ? ["top"] : false}
              position="absolute"
              left={0}
              bottom={allocation()!.editor + allocation()!.bottom}
              width="100%"
              height={allocation()!.stage}
              zIndex={3}
              focusable
              focused={focused() === "stage"}
              onMouseDown={() => props.regions.requestFocus("stage")}
            >
              {props.stage.view()}
            </box>
          ) : null}
          <box
            id="keel-editor"
            position="absolute"
            left={0}
            bottom={allocation()!.bottom}
            width="100%"
            height={allocation()!.editor}
            zIndex={2}
            title={
              allocation()!.chrome > 0 && props.editor.label()
                ? `${focused() === "editor" ? "▶" : " "} ${props.editor.label()}`
                : undefined
            }
            onMouseDown={() => props.regions.requestFocus("editor")}
            // The border color is constant without chrome: the `borderColor`
            // setter re-enables a border when it changes.
            borderColor={allocation()!.chrome > 0 && focused() === "editor" ? "#89b4fa" : "#45475a"}
            border={allocation()!.chrome > 0 ? ["top", "bottom"] : false}
          >
            <EditorView
              text={props.editor.text()}
              cursor={props.editor.cursor()}
              bodyWidth={Math.max(1, dimensions().width)}
              focused={focused() === "editor"}
              bodyHeight={allocation()!.body}
              reset={props.editor.reset()}
              onContentChange={props.editor.onContentChange}
              onCursorChange={props.editor.onCursorChange}
              onHeightChange={props.editor.onHeightChange}
              onReader={props.editor.onReader}
            />
          </box>
          {allocation()!.bottom > 0 ? (
            <box position="absolute" bottom={0} left={0} width="100%" height={1} zIndex={2}>
              <StatuslineView segments={props.status.bottom()} width={dimensions().width} />
            </box>
          ) : null}
        </>
      ) : null}
    </box>
  );
}
