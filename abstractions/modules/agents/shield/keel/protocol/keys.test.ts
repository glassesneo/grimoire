// Key configuration rules a user relies on; types cannot reject a bad configuration.
import { expect, test } from "bun:test";
import { applyKeyConfig, ChordError, KeyTables, layerOf, parseChord } from "./keys";

const actions = [
  { id: "global.stop" },
  { id: "screen.take_write" },
  { id: "timeline.cursor_down", keys: ["j", "down"] },
  { id: "timeline.cursor_up", keys: ["k", "up"] },
  { id: "editor.submit", keys: ["return"] },
  { id: "stage.next", keys: ["l"] },
];

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

test("a configured key or list replaces the defaults, and an empty list unbinds", () => {
  const { keys, diagnostics } = applyKeyConfig(actions, {
    "global.stop": "ctrl+c",
    "timeline.cursor_down": ["n", "ctrl+n"],
    "editor.submit": [],
  });
  expect(diagnostics).toEqual([]);
  expect(keys["global.stop"]).toEqual(["ctrl+c"]);
  expect(keys["timeline.cursor_down"]).toEqual(["n", "ctrl+n"]);
  expect(keys["timeline.cursor_up"]).toEqual(["k", "up"]);
  expect(keys["editor.submit"]).toEqual([]);
  // Global actions have no defaults.
  expect(applyKeyConfig(actions, undefined).keys["global.stop"]).toEqual([]);
});

test("problems are reported and only the problematic bindings are dropped", () => {
  const { keys, diagnostics } = applyKeyConfig(actions, {
    "timeline.missing": "x",
    "timeline.cursor_down": ["q", "nosuchkey"],
    "timeline.cursor_up": "q",
    "editor.submit": ["a", "kpenter"],
    "stage.next": 3,
  });
  expect(diagnostics.map((d) => d.text)).toEqual([
    "keybindings: stage.next must be a key or a list of keys; ignored",
    "keybindings: unknown action timeline.missing",
    'keybindings: timeline.cursor_down: unknown key name "nosuchkey" in "nosuchkey"; binding dropped',
    "keybindings: A for editor.submit types text in the editor; binding dropped",
    "keybindings: Q is bound to timeline.cursor_down and timeline.cursor_up; those bindings are dropped",
  ]);
  expect(keys["timeline.cursor_down"]).toEqual([]);
  expect(keys["timeline.cursor_up"]).toEqual([]);
  expect(keys["editor.submit"]).toEqual(["kpenter"]);
  expect(keys["stage.next"]).toEqual(["l"]);
  expect(applyKeyConfig(actions, ["x"]).diagnostics[0]?.level).toBe("error");
});

test("a global key wins over a region's, which is reported, and resolution looks there first", () => {
  const { keys, diagnostics } = applyKeyConfig(actions, { "screen.take_write": "j" });
  expect(diagnostics).toEqual([
    {
      level: "warning",
      text: "keybindings: global screen.take_write takes J before timeline.cursor_down",
    },
  ]);
  const tables = new KeyTables(keys);
  expect(tables.global({ name: "j" })).toBe("screen.take_write");
  expect(tables.region("timeline", { name: "down" })).toBe("timeline.cursor_down");
  expect(tables.region("editor", { name: "return" })).toBe("editor.submit");
  expect(tables.region("editor", { name: "down" })).toBeUndefined();
  // Alt arrives from terminals as meta or option.
  const alt = new KeyTables({ "editor.x": ["alt+w"] });
  expect(alt.region("editor", { name: "w", meta: true } as never)).toBe("editor.x");
});

test("a global action's default keys are not bound; only the configuration binds it", () => {
  const { keys, diagnostics } = applyKeyConfig(
    [{ id: "global.stop", keys: ["ctrl+c"] }],
    undefined,
  );
  expect(keys["global.stop"]).toEqual([]);
  expect(diagnostics).toEqual([
    {
      level: "warning",
      text: "keybindings: global.stop is global, so its default keys are not bound",
    },
  ]);
  expect(
    applyKeyConfig([{ id: "global.stop", keys: ["ctrl+c"] }], { "global.stop": "ctrl+x" }).keys,
  ).toEqual({
    "global.stop": ["ctrl+x"],
  });
});
