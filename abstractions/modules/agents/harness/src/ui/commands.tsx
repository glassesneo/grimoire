import type { InputRenderable } from "@opentui/core";
import type { JSX } from "@opentui/solid";
import { createEffect, Show } from "solid-js";
import type { CommandController, CommandValue } from "./command-controller";
import type { StageContentType, StageRenderProps } from "./controllers";
import type { HarnessUIInstance } from "./harness-ui";

function CommandNameInput(props: { value: CommandValue; focused: boolean; controller: CommandController<JSX.Element> }) {
  let input: InputRenderable | undefined;
  let lastQuery: string | undefined;
  let lastCursor: number | undefined;
  let applyingSnapshot = false;
  createEffect(() => {
    const { query, queryCursor } = props.value;
    if (!input) return;
    const replace = query !== lastQuery && input.value !== query;
    applyingSnapshot = true;
    try {
      if (replace) input.value = query;
      if (replace || queryCursor !== lastCursor) input.cursorOffset = queryCursor;
      lastQuery = query; lastCursor = queryCursor;
    } finally { applyingSnapshot = false; }
  });
  return <input ref={input} flexShrink={0} focused={props.focused}
    onPaste={(event) => {
      const text = new TextDecoder().decode(event.bytes);
      if (/\s/.test(text)) { event.preventDefault(); props.controller.setQuery(text); }
    }}
    onInput={(query) => {
      if (!input || applyingSnapshot) return;
      props.controller.setQuery(query, input.cursorOffset);
      if (input.value !== props.value.query) {
        applyingSnapshot = true;
        try { input.value = props.value.query; input.cursorOffset = props.value.queryCursor; }
        finally { applyingSnapshot = false; }
      }
    }}
    onCursorChange={() => {
      if (input && !applyingSnapshot && input.value === props.value.query) props.controller.setQueryCursor(input.cursorOffset);
    }} />;
}

function CommandView(props: StageRenderProps<CommandValue, JSX.Element> & { controller: CommandController<JSX.Element> }) {
  const options = () => props.value.mode === "name"
    ? props.controller.names(props.value.query).map((command) => ({ name: command.name, description: command.description }))
    : props.value.filtered.map((candidate) => ({ name: `${candidate.current ? "* " : ""}${candidate.label}`, description: candidate.description ?? candidate.value }));
  return <box height="100%" flexDirection="column" backgroundColor="#1e1e2e" overflow="hidden">
    <text height={1} flexShrink={0}>{`command${props.value.command ? `: ${props.value.command.name}` : ""}`}</text>
    <Show when={props.value.mode === "name"}>
      <CommandNameInput value={props.value} focused={props.focused} controller={props.controller} />
    </Show>
    <Show when={props.value.mode === "arguments"}>
      <text height={1} flexShrink={0}>{`arguments in editor: ${props.value.command?.name}`}</text>
    </Show>
    <Show when={props.value.mode === "loading" || props.value.mode === "executing"} fallback={
      <select flexGrow={1} minHeight={0} showDescription showSelectionIndicator options={options()} selectedIndex={props.value.cursor} />
    }><text>{props.value.mode}</text></Show>
  </box>;
}

export function setupCommandUI(ui: HarnessUIInstance<JSX.Element>) {
  const controller = ui.controllers.commands;
  const type: StageContentType<CommandValue, JSX.Element> = {
    kind: "command",
    defaultValue: { query: "", queryCursor: 0, cursor: 0, mode: "name", candidates: [], filtered: [] },
    acceptsText: (value) => value.mode === "name",
    render: (props) => <CommandView {...props} controller={controller} />,
    actions: {
      next: () => controller.move(1), previous: () => controller.move(-1),
      confirm: () => controller.confirm(), cancel: () => controller.cancel(),
      arguments: () => controller.arguments(),
    },
  };
  controller.setType(type);
  const registration = ui.stage.registerType(type);
  return { dispose: () => { controller.dispose(); registration.dispose(); } };
}
