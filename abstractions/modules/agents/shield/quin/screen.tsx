import { createHostClipboard, createRendererClipboardAdapter, type ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard, useRenderer, useTerminalDimensions, type JSX } from "@opentui/solid";
import { createSignal, createEffect, For, Show, onCleanup } from "solid-js";
import { EditorView } from "./editor";
import { Controller, entryText, formatContext, formatUsage } from "./controller";

// Retains the harness's timeline / stage / wrapped textarea layout and palette.
export function Screen(props: { controller: Controller }): JSX.Element {
  const c = props.controller;
  const renderer = useRenderer();
  const dimensions = useTerminalDimensions();
  const [revision, setRevision] = createSignal(0);
  const [bodyHeight, setBodyHeight] = createSignal(2);
  const state = () => { revision(); return c; };
  let scroll: ScrollBoxRenderable | undefined;
  c.changed = () => setRevision(v => v + 1);
  c.scroll = amount => {
    if (!scroll) return;
    if (amount === "selection" && c.current) {
      const row = scroll.getRenderable(c.current.id);
      if (row) scroll.scrollTop = Math.max(0, row.y - scroll.y + scroll.scrollTop - Math.floor(scroll.height / 2));
    } else {
      const step = Math.max(1, amount.startsWith("half") ? Math.floor(scroll.height / 2) : scroll.height);
      scroll.scrollBy(amount.endsWith("down") ? step : -step, "absolute");
    }
  };
  let clipboard: ReturnType<typeof createHostClipboard> | undefined;
  try { clipboard = createHostClipboard(); } catch {}
  const fallback = createRendererClipboardAdapter(renderer);
  c.copy = async text => {
    try { if (clipboard && (await clipboard.writeText(text, { selection: "clipboard" })).status === "written") return true; } catch {}
    return fallback.writeText(text, "clipboard").status === "attempted";
  };
  useKeyboard(key => c.key(key));
  const timer = setInterval(() => { c.tick(); if (c.dialog?.expiresAt) c.changed(); }, 100);
  onCleanup(() => { clearInterval(timer); c.changed = () => {}; void clipboard?.dispose(); });
  createEffect(() => { const title = state().adapter.view.presentation.title; if (title) renderer.setTerminalTitle(title); });
  const stageHeight = () => state().dialog ? Math.min(8, Math.max(2, dimensions().height - bodyHeight() - 5)) : 0;
  // Only a dialog's input needs a label; the prompt editor is marked by its border and cursor, as in the harness.
  const dialogInput = () => state().dialog && ["input", "editor"].includes(c.dialog.method) ? `${c.dialog.method}: ${c.dialog.title}` : undefined;
  const queueText = () => { const q = state().adapter.view.queue; return [...q.steering.map(p => `steer: ${text(p)}`), ...q.followUp.map(p => `follow-up: ${text(p)}`)].join("\n"); };
  return <box width="100%" height="100%" flexDirection="column" backgroundColor="#1e1e2e">
    <text height={1} flexShrink={0} fg="#cad3f5">{`quin ${state().adapter.mode === "mock" ? "MOCK " : ""}${state().adapter.agent || ""} · ${process.cwd()}`}</text>
    <scrollbox ref={scroll} flexGrow={1} minHeight={1} stickyScroll stickyStart="bottom" focused={state().focus === "timeline"} onMouseDown={() => { c.armedUntil = 0; c.focus = "timeline"; c.changed(); }}>
      <For each={state().entries}>{e => <box id={e.id} flexDirection="column" paddingX={1} paddingBottom={1} backgroundColor={state().focus === "timeline" && state().current?.id === e.id ? "#24273a" : undefined}>
        <text fg={e.kind === "user" ? "#a6da95" : "#8aadf4"}>{`${state().focus === "timeline" && c.current?.id === e.id ? "▶ " : ""}${e.kind}${e.streaming ? " [streaming]" : ""}`}</text>
        <text fg="#cad3f5">{entryText(e, state().expanded.has(e.id))}</text>
      </box>}</For>
      <Show when={queueText()}><text fg="#eed49f">{queueText()}</text></Show>
    </scrollbox>
    <text height={1} flexShrink={0} fg="#eed49f">{`${state().adapter.mode === "mock" ? "MOCK · " : ""}${state().armedUntil ? "Press Ctrl+C again within 1s to interrupt" : `${state().status}${state().active ? " · Working" : " · Idle"}`}`}</text>
    <Show when={state().dialog}>
      <box height={stageHeight()} flexShrink={0} flexDirection="column" backgroundColor="#24273a" onMouseDown={() => { c.armedUntil = 0; c.focus = "stage"; c.changed(); }}>
        <text fg="#cad3f5">{`${state().focus === "stage" ? "▶ " : ""}${c.dialog.title} [observed pending; Esc cancels]${c.dialog.expiresAt ? ` ${Math.max(0, Math.ceil((c.dialog.expiresAt - Date.now()) / 1000))}s` : ""}`}</text>
        <Show when={state().dialog?.message}><text>{c.dialog.message}</text></Show>
        <Show when={state().choices.length > 0}><select flexGrow={1} minHeight={1} options={state().choices.map(name => ({ name, description: "" }))} selectedIndex={state().choice} showSelectionIndicator showDescription={false} /></Show>
      </box>
    </Show>
    <box height={Math.min(bodyHeight() + (dialogInput() ? 2 : 1), Math.max(3, dimensions().height - stageHeight() - 3))} flexShrink={0} flexDirection="column" border={["top"]} borderColor={state().focus === "editor" ? "#8aadf4" : "#6e738d"} onMouseDown={() => { c.armedUntil = 0; c.focus = "editor"; c.changed(); }}>
      <Show when={dialogInput()}><text height={1}>{dialogInput()}</text></Show>
      <EditorView onReader={read => { c.readEditor = read; }} text={state().text} cursor={state().cursor} bodyWidth={dimensions().width} bodyHeight={Math.max(1, Math.min(bodyHeight(), dimensions().height - stageHeight() - (dialogInput() ? 5 : 4)))} focused={state().focus === "editor"} onContentChange={(text, cursor) => c.setText(text, cursor)} onCursorChange={cursor => { c.cursor = cursor; c.changed(); }} onHeightChange={lines => setBodyHeight(Math.max(2, Math.min(8, lines)))} />
    </box>
    <text height={1} flexShrink={0} fg="#a5adcb">{[state().adapter.view.timeline.model, state().adapter.view.timeline.thinking, formatContext(state().stats?.contextUsage), state().stats ? formatUsage(state().stats!) : "", ...Object.values(state().adapter.view.presentation.status), "Tab focus · Ctrl+Q detach"].filter(Boolean).join(" · ")}</text>
  </box>;
}
const text = (p: any) => typeof p === "string" ? p : p.message || JSON.stringify(p);
