/**
 * The stage: the selected request with its options, or the selected assist
 * with its candidates, and the screen's cursor among them. With nothing
 * selected it says how many requests wait.
 */
import type { JSX } from "solid-js";
import { For } from "solid-js";
import { chordsOf, formatChord } from "../protocol/keys";
import type { KeelScreen } from "./screen";
import { palette } from "./ui/renderers";

export function StageView(props: { screen: KeelScreen; version: () => number }): JSX.Element {
  const { stage, connection, regions } = props.screen;
  const target = () => (props.version(), stage.selected());
  const focused = () => (props.version(), regions.current() === "stage");
  const hint = () => {
    const chord = chordsOf(connection.mirror.state?.keys ?? {}, "editor.stage_next")[0];
    return chord ? ` · ${formatChord(chord)} to show` : "";
  };
  return (
    <box height="100%" flexDirection="column" overflow="hidden" backgroundColor="#1e1e2e">
      {(() => {
        const current = target();
        if (!current) {
          const waiting = (props.version(), stage.waiting());
          return (
            <text fg={palette.warning}>
              {`${waiting} request${waiting === 1 ? "" : "s"} waiting${hint()}`}
            </text>
          );
        }
        const cursor = (props.version(), stage.cursor(current));
        const rows =
          current.kind === "request"
            ? current.info.options.map((option) => ({ label: option, detail: "", current: false }))
            : current.info.candidates.map((candidate) => ({
                label: candidate.label,
                detail: candidate.detail ?? "",
                current: candidate.current ?? false,
              }));
        return (
          <box flexDirection="column">
            <text fg={palette.accent}>
              {`${focused() ? "▶ " : ""}${current.kind === "request" ? "request" : "assist"}: ${current.info.title}`}
            </text>
            {current.kind === "request" && current.info.message ? (
              <text>{current.info.message}</text>
            ) : null}
            {rows.length === 0 ? <text fg={palette.dim}>no candidates</text> : null}
            <For each={rows}>
              {(row, index) => (
                <text fg={index() === cursor ? palette.text : palette.dim}>
                  {`${index() === cursor ? "› " : "  "}${row.label}${row.current ? " (current)" : ""}${row.detail ? `  ${row.detail}` : ""}`}
                </text>
              )}
            </For>
          </box>
        );
      })()}
    </box>
  );
}
