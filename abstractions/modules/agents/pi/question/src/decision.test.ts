import assert from "node:assert/strict";
import { KeybindingsManager, TUI_KEYBINDINGS, setKeybindings } from "@earendil-works/pi-tui";
import { DecisionComponent } from "./internal/tui.ts";

// The submitted answer is the user's selection: focus alone never selects an option.
// Observe submitted results from key input, not private draft state or rendered lines.
export default function verifyDecisions(): void {
  setKeybindings(new KeybindingsManager(TUI_KEYBINDINGS));
  const theme = {
    fg: (_color: string, text: string) => text,
    bg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  } as any;
  const tui = {
    terminal: { kittyProtocolActive: true, columns: 80, rows: 24 },
    requestRender() {},
  } as any;
  const submit = (keys: string[]) => {
    let result: any;
    const decision = new DecisionComponent({
      tui,
      theme,
      questions: [
        {
          id: "q",
          prompt: "Pick",
          kind: "multi",
          options: [
            { value: "a", label: "A" },
            { value: "b", label: "B", noteRequired: true },
          ],
        },
      ],
      done: (value) => (result = value),
    });
    for (const key of keys) if (result === undefined) decision.handleInput(key);
    // Confirm any remaining review step without adding input to the answer.
    for (let step = 0; step < 3 && result === undefined; step++) decision.handleInput("\r");
    assert.ok(result, "the decision was submitted");
    return result.responses.q;
  };

  // Given A selected and focus moved to B, which requires a note when selected,
  // confirming submits A alone.
  assert.deepEqual(
    submit([" ", "\x1b[B", "\r"]).values.map((item: any) => item.value),
    ["a"],
  );
  // Given B selected, its required note is still collected before submission.
  const noted = submit(["\x1b[B", " ", "\r", "w", "h", "y", "\r"]);
  assert.deepEqual(noted.values, [{ value: "b", note: "why" }]);
  console.log("question decision contract verified");
}
