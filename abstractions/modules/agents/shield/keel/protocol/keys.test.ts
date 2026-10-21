// How a screen reads the chords the model publishes and resolves keys against them; the
// configuration rules themselves are the model's (hub/test/keys_test.exs).
import { expect, test } from "bun:test";
import { ChordError, KeyTables, layerOf, parseChord } from "./keys";

test("every key name parses alone and under every modifier combination", () => {
  const printable = Array.from({ length: 0x7f - 0x21 }, (_, i) =>
    String.fromCharCode(0x21 + i),
  ).filter((c) => !/[A-Z]/.test(c));
  const names = [...printable, "space", "tab", "return", "kpenter", "escape", "up", "f12"];
  const combos = [
    [],
    ["ctrl"],
    ["shift"],
    ["alt"],
    ["ctrl", "shift"],
    ["ctrl", "alt", "shift"],
  ] as const;
  for (const name of names)
    for (const mods of combos)
      expect(parseChord([...mods, name].join("+"))).toEqual({
        name,
        ...Object.fromEntries(mods.map((mod) => [mod, true])),
      });
  for (const text of ["", "ctrl+", "hyper+x", "x+ctrl", "ctrl++x", "enter", "esc", "Q", "pgdn"])
    expect(() => parseChord(text)).toThrow(ChordError);
  expect(() => parseChord("ctrl+Q")).toThrow("use shift+q");
});

test("an action's layer is its region, and anything else is global", () => {
  expect(layerOf("timeline.cursor_down")).toBe("timeline");
  expect(layerOf("global.stop")).toBe("global");
  expect(layerOf("screen.take_write")).toBe("global");
  expect(layerOf("model.set")).toBe("global");
});

test("keys resolve in the global layer, then in the focused region's", () => {
  const tables = new KeyTables({
    "screen.take_write": ["j"],
    "timeline.cursor_down": ["j", "down"],
    "editor.submit": ["return"],
  });
  expect(tables.global({ name: "j" })).toBe("screen.take_write");
  expect(tables.region("timeline", { name: "down" })).toBe("timeline.cursor_down");
  expect(tables.region("editor", { name: "return" })).toBe("editor.submit");
  expect(tables.region("editor", { name: "down" })).toBeUndefined();
  // Alt arrives from terminals as meta or option.
  const alt = new KeyTables({ "editor.x": ["alt+w"] });
  expect(alt.region("editor", { name: "w", meta: true } as never)).toBe("editor.x");
});
