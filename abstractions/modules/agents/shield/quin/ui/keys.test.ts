// Keymap rules a configuration relies on; types cannot reject a bad keymap.
import { expect, test } from "bun:test";
import { KeyBindings, KeymapError, parseChord } from "./keys";

const actions = (log: string[]) => [
  { id: "global.detach", keys: ["ctrl+q"], run: () => log.push("detach") },
  { id: "timeline.down", keys: ["j", "down"], run: () => log.push("down") },
  { id: "editor.submit", keys: ["return"], run: () => log.push("submit") },
];
const key = (name: string, mods: { ctrl?: boolean; shift?: boolean } = {}) => ({ name, ...mods });

test("chords parse modifiers and the key name", () => {
  expect(parseChord("ctrl+shift+f")).toEqual({ name: "f", ctrl: true, shift: true });
  expect(parseChord("kpenter")).toEqual({ name: "kpenter" });
  expect(parseChord("ctrl++")).toEqual({ name: "+", ctrl: true });
  expect(() => parseChord("hyper+x")).toThrow(KeymapError);
});

test("the focused region wins, then the global layer", () => {
  const log: string[] = [];
  const keys = new KeyBindings();
  keys.register([...actions(log), { id: "timeline.detach-here", keys: ["ctrl+q"], run: () => log.push("timeline") }]);
  keys.resolve("timeline", key("q", { ctrl: true }))?.run();
  keys.resolve("editor", key("q", { ctrl: true }))?.run();
  expect(log).toEqual(["timeline", "detach"]);
});

test("a keymap replaces an action's chords, and an empty list unbinds it", () => {
  const log: string[] = [];
  const keys = new KeyBindings({ keymap: { "timeline.down": ["n"], "global.detach": [] } });
  keys.register(actions(log));
  keys.checkKeymap();
  expect(keys.resolve("timeline", key("j"))).toBeUndefined();
  expect(keys.resolve("timeline", key("n"))?.id).toBe("timeline.down");
  expect(keys.resolve("timeline", key("q", { ctrl: true }))).toBeUndefined();
});

test("typed characters reach a region that accepts text", () => {
  const keys = new KeyBindings({ acceptsText: (region) => region === "editor" });
  keys.register([{ id: "global.colon", keys: [":"], run: () => {} }, ...actions([])]);
  expect(keys.resolve("editor", key(":"))).toBeUndefined();
  expect(keys.resolve("timeline", key(":"))?.id).toBe("global.colon");
  expect(keys.resolve("editor", key("return"))?.id).toBe("editor.submit");
});

test("unknown actions, conflicts, and malformed keymaps are rejected", () => {
  const unknown = new KeyBindings({ keymap: { "timeline.missing": ["x"] } });
  unknown.register(actions([]));
  expect(() => unknown.checkKeymap()).toThrow("unknown actions in keymap: timeline.missing");
  // The same chord in another layer only shadows; within a layer it conflicts.
  const conflict = new KeyBindings({ keymap: { "timeline.down": ["ctrl+q", "x"] } });
  conflict.register(actions([]));
  expect(() => conflict.register([{ id: "timeline.other", keys: ["x"], run: () => {} }])).toThrow("X is bound to both timeline.down and timeline.other");
  expect(conflict.resolve("timeline", key("x"))?.id).toBe("timeline.down");
  expect(() => new KeyBindings({ keymap: { detach: ["x"] } })).toThrow(KeymapError);
  expect(() => new KeyBindings({ keymap: { "global.detach": "ctrl+q" as any } })).toThrow(KeymapError);
});
